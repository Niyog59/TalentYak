"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { MediaUploader } from "@/components/media/uploader";
import { SaveBadge, heldMessage } from "@/components/tracking/save-badge";
import { mayBeRequired, LIMITS, type Answer, type Answers, type Question } from "@/lib/checkins/questions";
import { clearDeviceCheckin, readDevice, sendCheckin, writeDevice } from "@/lib/checkins/device";
import type { HeldState, SaveState } from "@/lib/tracking/device";
import type { WriteState } from "@/lib/tracking/server";

/*
 * Answering a check-in. Every change is kept on this device first (a closed
 * tab or a dropped connection loses nothing), then saved as a draft. Sending
 * uses an id chosen here and kept until the server confirms, so pressing Send
 * again after a lost answer is recognised and never sends twice. While
 * coaching is paused, answers stay on this device and the saved draft is
 * kept; both are there to finish after renewing.
 */

const RETRY_MS = [2000, 5000, 15000, 30000, 60000];

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "offline" }
  | { kind: "held"; reason: HeldState }
  | { kind: "conflict" }
  | { kind: "refused"; message: string }
  | { kind: "failed"; message: string };

interface Props {
  viewerId: string;
  checkinId: string;
  enrollmentId: string;
  questions: Question[];
  mode: "first" | "correct";
  serverDraft: { answers: Answers; revision: number; base_submission_revision: number } | null;
  lastSent: Answers | null;
  submittedRevision: number;
  writeState: WriteState;
  pausedNotice: string;
  doneHref: string;
}

function isHeld(s: WriteState): s is HeldState {
  return s === "paused" || s === "ended" || s === "suspended" || s === "unavailable";
}

export function CheckinForm(props: Props) {
  const { viewerId, checkinId, questions } = props;
  const router = useRouter();
  const formId = useId();
  const draftMatches = props.serverDraft && props.serverDraft.base_submission_revision === props.submittedRevision;
  const initial: Answers = draftMatches ? props.serverDraft!.answers : props.lastSent ?? {};

  const [answers, setAnswers] = useState<Answers>(initial);
  const [changeNote, setChangeNote] = useState("");
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: 0 });
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });
  const [missing, setMissing] = useState<string[]>([]);
  const [conflict, setConflict] = useState<{ answers: Answers | null; revision: number; sent: boolean } | null>(null);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);

  const answersRef = useRef<Answers>(initial);
  const noteRef = useRef("");
  const base = useRef(draftMatches ? props.serverDraft!.revision : 0);
  const saveId = useRef<string | null>(null);
  const submitId = useRef<string | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const conflictRef = useRef(false);
  const retryIndex = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const debounce = useRef<number | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const loaded = useRef(false);

  const live = props.writeState === "live";
  const held = isHeld(props.writeState) ? props.writeState : null;

  const persist = useCallback(() => {
    writeDevice(viewerId, checkinId, {
      answers: answersRef.current,
      baseRevision: base.current,
      saveId: saveId.current,
      submitId: submitId.current,
      changeNote: noteRef.current,
      dirty: dirty.current || saveId.current !== null,
    });
  }, [viewerId, checkinId]);

  // What this device holds, once, after the first paint.
  useEffect(() => {
    if (loaded.current) return;
    const timer = window.setTimeout(() => {
      loaded.current = true;
      const local = readDevice(viewerId, checkinId);
      if (local && (local.dirty || local.submitId)) {
        answersRef.current = local.answers;
        setAnswers(local.answers);
        noteRef.current = local.changeNote ?? "";
        setChangeNote(noteRef.current);
        base.current = local.baseRevision;
        saveId.current = local.saveId;
        submitId.current = local.submitId;
        dirty.current = local.dirty;
        setRestored(true);
        // Saved elsewhere since this device last spoke to the server.
        const serverRevision = draftMatches ? props.serverDraft!.revision : 0;
        if (!local.saveId && local.baseRevision !== serverRevision && local.dirty) {
          conflictRef.current = true;
          setConflict({ answers: draftMatches ? props.serverDraft!.answers : null, revision: serverRevision, sent: false });
          setSave({ kind: "conflict", duplicate: false });
        } else {
          setSave(held ? { kind: "held", reason: held } : { kind: "pending" });
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleRetry = useCallback((fn: () => void) => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    const wait = RETRY_MS[Math.min(retryIndex.current, RETRY_MS.length - 1)];
    retryIndex.current++;
    retryTimer.current = window.setTimeout(fn, wait);
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    if (!dirty.current && !saveId.current) return;
    if (conflictRef.current || submitId.current) return;
    if (held) {
      setSave({ kind: "held", reason: held });
      persist();
      return;
    }
    if (!live || inFlight.current) return;
    inFlight.current = true;
    if (!saveId.current) {
      saveId.current = crypto.randomUUID();
      dirty.current = false;
    }
    const sent = answersRef.current;
    persist();
    setSave({ kind: "saving" });
    const r = await sendCheckin({ op: "draft.save", checkinId, answers: sent, baseRevision: base.current, saveId: saveId.current });
    inFlight.current = false;
    if (r.status === "ok") {
      base.current = Number(r.data.revision) || base.current;
      saveId.current = null;
      retryIndex.current = 0;
      const more = dirty.current;
      setSave(more ? { kind: "pending" } : { kind: "saved", at: Date.now() });
      persist();
      if (more) void syncRef.current();
      return;
    }
    if (r.status === "offline") {
      setSave({ kind: "offline" });
      persist();
      scheduleRetry(() => void syncRef.current());
      return;
    }
    if (r.status === "held") {
      setSave({ kind: "held", reason: r.reason as HeldState });
      persist();
      return;
    }
    if (r.status === "conflict") {
      saveId.current = null;
      dirty.current = true;
      conflictRef.current = true;
      const d = r.data as { revision?: number; answers?: Answers; missing?: boolean };
      setConflict({ answers: d.answers ?? null, revision: Number(d.revision) || 0, sent: Boolean(d.missing) });
      setSave({ kind: "conflict", duplicate: false });
      persist();
      return;
    }
    saveId.current = null;
    dirty.current = true;
    const message = r.message;
    setSave({ kind: "failed", message, retryable: r.status === "failed" });
    persist();
    if (r.status === "failed") scheduleRetry(() => void syncRef.current());
  }, [held, live, persist, scheduleRetry, checkinId]);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    if (!ready) return;
    const again = () => {
      retryIndex.current = 0;
      void syncRef.current();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    if (dirty.current || saveId.current) again();
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [ready]);

  useEffect(() => () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    if (debounce.current) window.clearTimeout(debounce.current);
  }, []);

  function setAnswer(key: string, value: Answer | undefined) {
    const next = { ...answersRef.current };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    answersRef.current = next;
    setAnswers(next);
    dirty.current = true;
    if (missing.length) setMissing((m) => m.filter((label) => questions.find((q) => q.key === key)?.label !== label));
    setSave((s) => (s.kind === "conflict" || s.kind === "held" ? s : { kind: "pending" }));
    persist();
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void syncRef.current(), 1200);
  }

  function resolve(keep: "mine" | "saved") {
    if (!conflict) return;
    if (keep === "saved" && conflict.answers) {
      answersRef.current = conflict.answers;
      setAnswers(conflict.answers);
      dirty.current = false;
    } else {
      dirty.current = true;
    }
    base.current = conflict.revision;
    conflictRef.current = false;
    setConflict(null);
    setSave(dirty.current ? { kind: "pending" } : { kind: "saved", at: Date.now() });
    persist();
    void syncRef.current();
  }

  async function submit() {
    if (sendState.kind === "sending") return;
    const needed = questions.filter((q) => q.required && mayBeRequired(q) && answersRef.current[q.key] === undefined).map((q) => q.label);
    setMissing(needed);
    if (needed.length) {
      setSendState({ kind: "refused", message: "A few answers are still needed before sending." });
      return;
    }
    if (held) {
      setSendState({ kind: "held", reason: held });
      return;
    }
    if (!submitId.current) submitId.current = crypto.randomUUID();
    persist();
    setSendState({ kind: "sending" });
    const r = await sendCheckin({
      op: "submit",
      checkinId,
      answers: answersRef.current,
      submitId: submitId.current,
      baseRevision: props.submittedRevision,
      changeNote: noteRef.current,
    });
    if (r.status === "ok") {
      clearDeviceCheckin(viewerId, checkinId);
      submitId.current = null;
      dirty.current = false;
      setSendState({ kind: "idle" });
      router.replace(`${props.doneHref}?sent=1`);
      router.refresh();
      return;
    }
    if (r.status === "offline") {
      setSendState({ kind: "offline" });
      scheduleRetry(() => void submit());
      return;
    }
    // Anything but a lost connection: this attempt is over; the next press is a new one.
    submitId.current = null;
    persist();
    if (r.status === "held") setSendState({ kind: "held", reason: r.reason as HeldState });
    else if (r.status === "conflict") setSendState({ kind: "conflict" });
    else if (r.status === "refused") {
      if (r.missing?.length) setMissing(r.missing);
      setSendState({ kind: "refused", message: r.message });
    } else setSendState({ kind: "failed", message: r.message });
  }

  const sending = sendState.kind === "sending";
  const disabled = !live || sending;

  return (
    <div>
      {held ? (
        <p role="alert" className="mt-5 rounded-lg border border-danger bg-danger-tint p-4 font-medium">
          {held === "paused" ? props.pausedNotice : heldMessage(held)} Your answers are kept on this device{props.serverDraft ? " and your saved draft is kept too" : ""} — you can finish and send once coaching is active again.
        </p>
      ) : null}
      {restored ? <p className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-3 text-sm">Restored the answers kept on this device.</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <SaveBadge state={save} onRetry={() => void syncRef.current()} neverSaved={save.kind === "saved" && save.at === 0 && !props.serverDraft} />
      </div>

      {conflict ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger bg-danger-tint p-4">
          {conflict.sent ? (
            <>
              <p className="font-semibold">This check-in was sent from another device.</p>
              <p className="mt-1">Nothing was lost. Reload to see what was sent — you can still correct it.</p>
              <Button className="mt-3" size="sm" onClick={() => { clearDeviceCheckin(viewerId, checkinId); router.refresh(); }}>Reload</Button>
            </>
          ) : (
            <>
              <p className="font-semibold">These answers were changed on another device since this one last saved.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button size="sm" onClick={() => resolve("mine")}>Keep this device&rsquo;s answers</Button>
                {conflict.answers ? <Button size="sm" variant="secondary" onClick={() => resolve("saved")}>Use the saved answers</Button> : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {missing.length ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger bg-danger-tint p-4">
          <p className="font-semibold">Still needed before sending:</p>
          <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : null}

      <ol className="mt-6 space-y-6">
        {questions.map((q, i) => {
          const needed = Boolean(q.required && mayBeRequired(q));
          const invalid = missing.includes(q.label);
          const id = `${formId}-${q.key}`;
          const hint = needed ? "Needed" : q.sensitive ? "Optional — skip it if you prefer" : "Optional";
          return (
            <li key={q.key} className="rounded-xl border border-line bg-surface p-4 sm:p-5">
              {q.kind === "rating" ? (
                <fieldset aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}>
                  <legend className="text-lg font-semibold">{i + 1}. {q.label}</legend>
                  <p id={`${id}-hint`} className="text-sm text-ink-muted">{hint}{q.help ? ` · ${q.help}` : ""}</p>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border text-lg font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${answers[q.key] === n ? "border-brand bg-brand text-white" : "border-line-strong bg-paper"} ${disabled ? "opacity-70" : ""}`}>
                        <input type="radio" className="sr-only" name={id} value={n} checked={answers[q.key] === n} disabled={disabled} onChange={() => setAnswer(q.key, n)} />
                        {n}
                      </label>
                    ))}
                  </div>
                  {q.low || q.high ? (
                    <p className="mt-1.5 flex justify-between gap-4 text-sm text-ink-muted"><span>1 · {q.low}</span><span>5 · {q.high}</span></p>
                  ) : null}
                  {!needed && answers[q.key] !== undefined && !disabled ? (
                    <button type="button" className="mt-2 min-h-11 text-sm text-brand underline underline-offset-4" onClick={() => setAnswer(q.key, undefined)}>Clear this answer</button>
                  ) : null}
                </fieldset>
              ) : q.kind === "text" || q.kind === "long_text" ? (
                <div>
                  <label htmlFor={id} className="block text-lg font-semibold">{i + 1}. {q.label}</label>
                  <p id={`${id}-hint`} className="text-sm text-ink-muted">{hint}{q.help ? ` · ${q.help}` : ""}</p>
                  {q.kind === "text" ? (
                    <input id={id} className="mt-2 block min-h-12 w-full rounded-lg border border-line-strong bg-paper px-3 text-base aria-[invalid=true]:border-danger" maxLength={LIMITS.text}
                      value={typeof answers[q.key] === "string" ? (answers[q.key] as string) : ""} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
                      onChange={(e) => setAnswer(q.key, e.target.value)} />
                  ) : (
                    <textarea id={id} rows={3} className="mt-2 block w-full rounded-lg border border-line-strong bg-paper p-3 text-base aria-[invalid=true]:border-danger" maxLength={LIMITS.longText}
                      value={typeof answers[q.key] === "string" ? (answers[q.key] as string) : ""} disabled={disabled} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`}
                      onChange={(e) => setAnswer(q.key, e.target.value)} />
                  )}
                </div>
              ) : (
                <Attachments q={q} index={i} hint={hint} ids={Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : []} disabled={disabled}
                  enrollmentId={props.enrollmentId} onChange={(ids) => setAnswer(q.key, ids)} />
              )}
            </li>
          );
        })}
      </ol>

      {props.mode === "correct" ? (
        <div className="mt-6">
          <label htmlFor={`${formId}-note`} className="block font-semibold">What did you change? <span className="font-normal text-ink-muted">(optional)</span></label>
          <textarea id={`${formId}-note`} rows={2} maxLength={300} className="mt-2 block w-full rounded-lg border border-line-strong bg-paper p-3 text-base" value={changeNote} disabled={disabled}
            onChange={(e) => { noteRef.current = e.target.value; setChangeNote(e.target.value); persist(); }} />
          <p className="mt-1 text-sm text-ink-muted">Your original answers and any feedback on them are kept. If the change matters, your coach is asked to take another look.</p>
        </div>
      ) : null}

      <div className="sticky bottom-20 z-10 mt-8 rounded-xl border border-line bg-surface p-4 shadow-sm md:bottom-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void submit()} disabled={disabled} aria-describedby={`${formId}-send-status`}>
            {sending ? "Sending…" : props.mode === "correct" ? "Send the correction" : "Send to my coach"}
          </Button>
          <p id={`${formId}-send-status`} role="status" aria-live="polite" className="text-sm">
            {sendState.kind === "offline"
              ? "No connection — not sent yet. Your answers are kept here and will be sent when you're back online."
              : sendState.kind === "held"
                ? `Not sent. ${sendState.reason === "paused" ? props.pausedNotice : heldMessage(sendState.reason)}`
                : sendState.kind === "conflict"
                  ? "Not sent: this check-in changed on another device. Reload to see the latest — your answers are kept here."
                  : sendState.kind === "refused" || sendState.kind === "failed"
                    ? `Not sent — ${sendState.message}`
                    : props.mode === "correct"
                      ? "Sending adds a new version; the original stays."
                      : "Late is fine — send it whenever you can."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Attachments({ q, index, hint, ids, disabled, enrollmentId, onChange }: {
  q: Question;
  index: number;
  hint: string;
  ids: string[];
  disabled: boolean;
  enrollmentId: string;
  onChange: (ids: string[]) => void;
}) {
  const cap = q.kind === "photo" ? LIMITS.photos : LIMITS.videos;
  return (
    <div>
      <p className="text-lg font-semibold">{index + 1}. {q.label}</p>
      <p className="text-sm text-ink-muted">{hint}{q.help ? ` · ${q.help}` : ""}</p>
      {ids.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ids.map((id) => (
            <li key={id} className="rounded-lg border border-line p-2">
              {q.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/${id}?variant=preview`} alt="Attached photo" className="aspect-[3/4] w-full rounded bg-brand-tint object-contain" />
              ) : (
                <p className="flex aspect-video items-center justify-center rounded bg-brand-tint p-2 text-center text-sm">Clip attached</p>
              )}
              {!disabled ? (
                <button type="button" className="mt-1 min-h-11 text-sm text-brand underline underline-offset-4" onClick={() => onChange(ids.filter((x) => x !== id))}>Remove from this check-in</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {ids.length < cap && !disabled ? (
        <div className="mt-3">
          <MediaUploader
            purpose="checkin_attachment"
            enrollmentId={enrollmentId}
            imagesOnly={q.kind === "photo"}
            label={q.kind === "photo" ? "Add a photo" : "Add a clip"}
            help="Private: only you and your coach can see it. Location and device details are removed."
            onUploaded={(id) => onChange([...ids, id])}
          />
        </div>
      ) : null}
      {ids.length ? <p className="mt-2 text-sm text-ink-muted">A file removed here stays in your private files, where you can delete it.</p> : null}
    </div>
  );
}
