"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import { Paragraphs } from "@/components/programmes/workout-view";
import type { ExerciseCore, Session } from "@/lib/programmes/content";
import {
  confirmedSets,
  entryName,
  identityOf,
  LOAD_KIND_LABEL,
  prescribedFor,
  setText,
  suggestedStatus,
  targetText,
  type ExerciseEntry,
  type LoadBasis,
  type LoadKind,
  type SetEntry,
  type WorkoutDoc,
  type WorkoutStatus,
} from "@/lib/tracking/workout";
import { convertWeight, parseAmount, parseWhole, roundTo, trimNumber, WEIGHT_STEP, type WeightUnit } from "@/lib/tracking/units";
import {
  newId,
  readItem,
  removeItem,
  send,
  listItems,
  writeItem,
  type HeldState,
  type SaveState,
  type StoredWorkoutDraft,
} from "@/lib/tracking/device";
import { SaveBadge, heldMessage } from "@/components/tracking/save-badge";
import { formatDay } from "@/lib/format";

/*
 * Logging a workout, one set at a time.
 *
 * THE FLOW for each exercise: what it is → what you did last time → today's
 * entry → "Complete set". A set is recorded only when the client confirms it;
 * the coach's target and last time's numbers are shown beside the inputs and
 * can be copied in with one tap, but never count as done on their own.
 *
 * SAVING. Every change is kept on this device first (so a refresh, a closed
 * tab or a dropped connection loses nothing), then sent. A save that did not
 * get an answer is re-sent exactly as it was, so the server recognises it and
 * nothing is recorded twice. If the workout changed on another device, nothing
 * is overwritten: the client chooses which version to keep. While coaching is
 * paused, entries stay on this device and are saved once it resumes.
 */

type Inputs = StoredWorkoutDraft["inputs"][string];
const EMPTY_INPUTS: Inputs = { load: "", reps: "", seconds: "", rpe: "" };

interface Previous {
  date: string;
  entry: ExerciseEntry;
}

interface Conflict {
  duplicate: boolean;
  missing: boolean;
  server: { doc: WorkoutDoc; revision: number } | null;
}

const RETRY_MS = [2000, 5000, 15000, 30000, 60000];

const numberInput =
  "tabular block min-h-12 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-3 text-lg aria-[invalid=true]:border-danger";

function Stepper({
  label,
  value,
  onChange,
  step,
  decimals,
  placeholder,
  unit,
  inputMode,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  decimals: number;
  placeholder?: string;
  unit?: ReactNode;
  inputMode: "decimal" | "numeric";
  invalid?: boolean;
}) {
  const id = useId();
  const bump = (d: number) => {
    const current = parseAmount(value) ?? parseAmount(placeholder ?? "") ?? 0;
    onChange(trimNumber(Math.max(0, roundTo(current + d, decimals)), decimals));
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      <div className="mt-1 flex items-stretch gap-1">
        <button type="button" onClick={() => bump(-step)} className="min-h-12 min-w-11 rounded-lg border border-line-strong bg-surface text-xl font-semibold" aria-label={`${label}: less`}>
          −
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            inputMode={inputMode}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value.slice(0, 8))}
            aria-invalid={invalid || undefined}
            className={`${numberInput} text-center`}
          />
        </div>
        <button type="button" onClick={() => bump(step)} className="min-h-12 min-w-11 rounded-lg border border-line-strong bg-surface text-xl font-semibold" aria-label={`${label}: more`}>
          +
        </button>
      </div>
      {unit ? <div className="mt-1 text-center text-sm text-ink-muted">{unit}</div> : null}
    </div>
  );
}

function RestTimer({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const done = left === 0;
  const buzzed = useRef(false);
  useEffect(() => {
    if (done && !buzzed.current) {
      buzzed.current = true;
      try {
        navigator.vibrate?.(200);
      } catch {
        /* not supported */
      }
    }
  }, [done]);
  return (
    <div className="fixed inset-x-0 bottom-20 z-30 px-4 md:bottom-6" role="timer" aria-live={done ? "assertive" : "off"}>
      <div className="mx-auto flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-brand bg-surface p-3 shadow-lg">
        <p className="tabular text-lg font-semibold">
          {done ? "Rest done — next set when you're ready" : `Rest ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`}
        </p>
        <div className="flex gap-2">
          {!done ? <Button variant="secondary" size="sm" onClick={() => setEndsAt((t) => t + 30_000)}>+30 s</Button> : null}
          <Button variant={done ? "primary" : "quiet"} size="sm" onClick={onDone}>{done ? "OK" : "Skip rest"}</Button>
        </div>
      </div>
    </div>
  );
}

export interface WorkoutLoggerProps {
  viewerId: string;
  workoutId: string;
  /** The server's copy, when one exists. */
  initial: { doc: WorkoutDoc; revision: number } | null;
  /** What a new workout starts as. */
  fresh: WorkoutDoc;
  /** The prescription this workout follows — the version it was started under. Null when unplanned. */
  session: Session | null;
  versionNote: string | null;
  previous: Record<string, Previous>;
  weightUnit: WeightUnit;
  writeState: HeldState | "live" | "not_permitted";
  pausedNotice: string;
  today: string;
  zoneLabel: string;
  href: string;
  label: string;
  backHref: string;
}

export function WorkoutLogger(props: WorkoutLoggerProps) {
  const { viewerId, workoutId, session, weightUnit } = props;
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<WorkoutDoc>(props.initial?.doc ?? props.fresh);
  const [inputs, setInputs] = useState<Record<string, Inputs>>({});
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: 0 });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  // A rest period: its length, and a counter so each set starts a fresh timer.
  const [rest, setRest] = useState<{ seconds: number; n: number } | null>(null);
  const [restOn, setRestOn] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ exercise: string; set: string } | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishStatus, setFinishStatus] = useState<Exclude<WorkoutStatus, "in_progress">>("completed");
  const [addName, setAddName] = useState("");
  const [announce, setAnnounce] = useState("");

  // What the server last confirmed, and a save still waiting for its answer.
  const base = useRef(props.initial?.revision ?? 0);
  const pendingSave = useRef<StoredWorkoutDraft["saveId"]>(null);
  const pendingDoc = useRef<{ doc: WorkoutDoc; base: number } | null>(null);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const retryIndex = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const debounce = useRef<number | null>(null);
  // The latest document and typed values, for handlers and timers. Updated
  // alongside their state in every change, never during render.
  const docRef = useRef<WorkoutDoc>(props.initial?.doc ?? props.fresh);
  const inputsRef = useRef<Record<string, Inputs>>({});
  const conflictRef = useRef<Conflict | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const loaded = useRef(false);
  const [savedOnce, setSavedOnce] = useState(Boolean(props.initial));

  const canWrite = props.writeState === "live" || props.writeState === "paused" || props.writeState === "logging_paused";
  const held: HeldState | null = props.writeState === "live" || props.writeState === "not_permitted" ? null : props.writeState;

  // ---------------------------------------------------------------- storage
  const persist = useCallback(
    (state: SaveState["kind"], message?: string) => {
      writeItem(viewerId, {
        v: 1,
        kind: "workout",
        id: docRef.current.id,
        doc: docRef.current,
        baseRevision: base.current,
        saveId: pendingSave.current,
        dirty: dirty.current || pendingDoc.current !== null,
        inputs: inputsRef.current,
        href: props.href,
        label: props.label,
        state,
        message,
        updatedAt: Date.now(),
      });
    },
    [viewerId, props.href, props.label],
  );

  // Load what this device holds, once, after the first paint (storage is
  // not available during server rendering).
  useEffect(() => {
    if (loaded.current) return;
    const timer = window.setTimeout(() => {
      // Marked inside the timer so a development double-mount still loads.
      loaded.current = true;
      try {
        setRestOn(window.localStorage.getItem("talentyak:rest-timer") !== "off");
      } catch {
        /* default on */
      }
      const local = readItem<StoredWorkoutDraft>(viewerId, "workout", workoutId);
      if (!local && !props.initial) {
        // Already started this session on this day on this device, under another id?
        const same = listItems(viewerId).find(
          (i): i is StoredWorkoutDraft =>
            i.kind === "workout" && i.id !== workoutId && i.doc.enrollmentId === props.fresh.enrollmentId &&
            i.doc.sessionKey !== null && i.doc.sessionKey === props.fresh.sessionKey && i.doc.performedOn === props.fresh.performedOn,
        );
        if (same) {
          router.replace(same.href);
          return;
        }
      }
      if (local) {
        inputsRef.current = local.inputs ?? {};
        setInputs(inputsRef.current);
        if (local.baseRevision > 0) setSavedOnce(true);
        if (local.dirty) {
          docRef.current = local.doc;
          setDoc(local.doc);
          base.current = local.baseRevision;
          pendingSave.current = local.saveId;
          pendingDoc.current = local.saveId ? { doc: local.doc, base: local.baseRevision } : null;
          dirty.current = true;
          let c: Conflict | null = null;
          if (props.initial && props.initial.revision !== local.baseRevision && !local.saveId) c = { duplicate: false, missing: false, server: props.initial };
          else if (!props.initial && local.baseRevision > 0 && !local.saveId) c = { duplicate: false, missing: true, server: null };
          conflictRef.current = c;
          setConflict(c);
          setSave(c ? { kind: "conflict", duplicate: false } : { kind: "pending" });
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------- sync
  const scheduleRetry = useCallback((fn: () => void) => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    const wait = RETRY_MS[Math.min(retryIndex.current, RETRY_MS.length - 1)];
    retryIndex.current++;
    retryTimer.current = window.setTimeout(fn, wait);
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    if (!dirty.current && !pendingDoc.current) return;
    if (conflictRef.current) return;
    if (held) {
      setSave({ kind: "held", reason: held });
      persist("held");
      return;
    }
    if (props.writeState !== "live") return;
    if (inFlight.current) return;
    inFlight.current = true;

    // Re-send an unanswered save exactly as it was; otherwise send what is here now.
    let attempt = pendingDoc.current;
    if (!attempt) {
      attempt = { doc: docRef.current, base: base.current };
      pendingDoc.current = attempt;
      pendingSave.current = newId();
      dirty.current = false;
    }
    persist("saving");
    setSave({ kind: "saving" });

    const r = await send({ op: "workout.save", doc: attempt.doc, baseRevision: attempt.base, saveId: pendingSave.current });
    inFlight.current = false;

    if (r.status === "saved") {
      base.current = Number(r.data.revision) || base.current;
      setSavedOnce(true);
      pendingDoc.current = null;
      pendingSave.current = null;
      retryIndex.current = 0;
      // Anything changed while this save was in flight goes next.
      const more = dirty.current;
      setSave(more ? { kind: "pending" } : { kind: "saved", at: Date.now() });
      if (more) {
        persist("pending");
        void syncRef.current();
      } else if (docRef.current.status !== "in_progress") {
        // Finished and safely on the server: no reason to keep a copy here.
        removeItem(viewerId, "workout", docRef.current.id);
      } else {
        persist("saved");
      }
      return;
    }
    if (r.status === "offline") {
      setSave({ kind: "offline" });
      persist("offline");
      scheduleRetry(() => void syncRef.current());
      return;
    }
    if (r.status === "held") {
      setSave({ kind: "held", reason: r.reason });
      persist("held");
      return;
    }
    if (r.status === "conflict") {
      // The unanswered save is resolved by the client's choice, not re-sent.
      pendingDoc.current = null;
      pendingSave.current = null;
      dirty.current = true;
      const d = r.data as { duplicate?: boolean; missing?: boolean; server?: { doc: WorkoutDoc; revision: number } | null };
      const c = { duplicate: Boolean(d.duplicate), missing: Boolean(d.missing), server: d.server ?? null };
      conflictRef.current = c;
      setConflict(c);
      setSave({ kind: "conflict", duplicate: c.duplicate });
      persist("conflict");
      return;
    }
    if (r.retryable) {
      setSave({ kind: "failed", message: r.message, retryable: true });
      persist("failed", r.message);
      scheduleRetry(() => void syncRef.current());
    } else {
      // Refused as sent: nothing to retry until the client changes something.
      pendingDoc.current = null;
      pendingSave.current = null;
      dirty.current = true;
      setSave({ kind: "failed", message: r.message, retryable: false });
      persist("failed", r.message);
    }
  }, [held, persist, props.writeState, scheduleRetry, viewerId]);

  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // Try again when the connection returns or the page comes back into view.
  useEffect(() => {
    if (!ready) return;
    const again = () => {
      retryIndex.current = 0;
      void syncRef.current();
    };
    window.addEventListener("online", again);
    document.addEventListener("visibilitychange", again);
    if (dirty.current || pendingDoc.current) again();
    return () => {
      window.removeEventListener("online", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [ready]);

  useEffect(() => () => {
    if (retryTimer.current) window.clearTimeout(retryTimer.current);
    if (debounce.current) window.clearTimeout(debounce.current);
  }, []);

  /** Apply a change: keep it on this device at once, send it now or shortly. */
  const change = useCallback(
    (fn: (d: WorkoutDoc) => WorkoutDoc, when: "now" | "soon" = "now") => {
      const next = fn(docRef.current);
      docRef.current = next;
      setDoc(next);
      dirty.current = true;
      setSave((s) => (s.kind === "conflict" || s.kind === "held" ? s : { kind: "pending" }));
      persist("pending");
      if (debounce.current) window.clearTimeout(debounce.current);
      if (when === "now") void syncRef.current();
      else debounce.current = window.setTimeout(() => void syncRef.current(), 1200);
    },
    [persist],
  );

  const setInput = (exerciseId: string, patch: Partial<Inputs>) => {
    const next = { ...inputsRef.current, [exerciseId]: { ...(inputsRef.current[exerciseId] ?? EMPTY_INPUTS), ...patch } };
    inputsRef.current = next;
    setInputs(next);
    persist(dirty.current ? "pending" : save.kind);
  };

  const updateEntry = (id: string, fn: (e: ExerciseEntry) => ExerciseEntry, when: "now" | "soon" = "now") =>
    change((d) => ({ ...d, exercises: d.exercises.map((e) => (e.id === id ? fn(e) : e)) }), when);

  // --------------------------------------------------------------- conflict
  const keepMine = () => {
    const c = conflictRef.current;
    if (!c) return;
    conflictRef.current = null;
    setConflict(null);
    if (c.duplicate && c.server) {
      // Put this device's entries into the record that already exists.
      const oldId = docRef.current.id;
      const moved = { ...docRef.current, id: c.server.doc.id };
      docRef.current = moved;
      setDoc(moved);
      removeItem(viewerId, "workout", oldId);
      base.current = c.server.revision;
      dirty.current = true;
      window.history.replaceState(null, "", props.href.replace(oldId, moved.id));
    } else {
      base.current = c.server?.revision ?? 0;
      dirty.current = true;
    }
    setSave({ kind: "pending" });
    persist("pending");
    void syncRef.current();
  };

  const useSaved = () => {
    const c = conflictRef.current;
    conflictRef.current = null;
    setConflict(null);
    dirty.current = false;
    pendingDoc.current = null;
    pendingSave.current = null;
    if (!c?.server) {
      removeItem(viewerId, "workout", docRef.current.id);
      router.push(props.backHref);
      return;
    }
    if (c.duplicate) {
      removeItem(viewerId, "workout", docRef.current.id);
      router.replace(props.href.replace(docRef.current.id, c.server.doc.id).split("?")[0]);
      return;
    }
    docRef.current = c.server.doc;
    setDoc(c.server.doc);
    setSavedOnce(true);
    base.current = c.server.revision;
    setSave({ kind: "saved", at: Date.now() });
    persist("saved");
  };

  // --------------------------------------------------------------- sets
  const amountKind = (e: ExerciseEntry, p: ExerciseCore | null): "reps" | "seconds" =>
    p?.target.type === "duration" ? "seconds" : e.sets.some((s) => s.seconds !== null && s.reps === null) ? "seconds" : "reps";

  function readSet(e: ExerciseEntry, p: ExerciseCore | null, id: string, extra: boolean, index: number): SetEntry | string {
    const v = inputsRef.current[e.id] ?? EMPTY_INPUTS;
    const kind = amountKind(e, p);
    const load = e.loadKind === "none" ? null : parseAmount(v.load);
    if (v.load.trim() && load === null) return "Enter the weight as a number, like 17.5.";
    if (load !== null && load > 1000) return "That weight is too high.";
    const reps = kind === "reps" ? parseWhole(v.reps) : null;
    const secs = kind === "seconds" ? parseWhole(v.seconds) : null;
    if (kind === "reps" && (v.reps.trim() ? reps === null || reps > 1000 : true)) return "Enter how many reps you did.";
    if (kind === "seconds" && (v.seconds.trim() ? secs === null || secs < 1 || secs > 36000 : true)) return "Enter how many seconds.";
    const rpe = v.rpe.trim() ? parseAmount(v.rpe) : null;
    if (v.rpe.trim() && (rpe === null || rpe < 1 || rpe > 10)) return "Effort is a number from 1 to 10.";
    return { id, setIndex: index, loadValue: load, loadUnit: load === null ? null : unitOf(e), reps, seconds: secs, rpe, extra };
  }

  const unitIn = (e: ExerciseEntry, values: Record<string, Inputs>): WeightUnit => values[e.id]?.unit ?? e.sets.at(-1)?.loadUnit ?? weightUnit;
  const unitOf = (e: ExerciseEntry): WeightUnit => unitIn(e, inputsRef.current);

  function completeSet(e: ExerciseEntry, p: ExerciseCore | null) {
    const target = p?.sets ?? null;
    const extra = target !== null && e.sets.length >= target;
    const set = readSet(e, p, newId(), extra, e.sets.length + 1);
    if (typeof set === "string") {
      setErrors((x) => ({ ...x, [e.id]: set }));
      return;
    }
    setErrors((x) => ({ ...x, [e.id]: "" }));
    updateEntry(e.id, (x) => ({ ...x, status: "active", sets: [...x.sets, set] }));
    setAnnounce(`Set ${set.setIndex} of ${entryName(e, session).name} recorded.`);
    const restFor = p?.restSeconds ?? null;
    if (restOn && restFor) setRest((r) => ({ seconds: restFor, n: (r?.n ?? 0) + 1 }));
  }

  function saveEdit(e: ExerciseEntry, p: ExerciseCore | null, s: SetEntry) {
    const edited = readSet(e, p, s.id, s.extra, s.setIndex);
    if (typeof edited === "string") {
      setErrors((x) => ({ ...x, [e.id]: edited }));
      return;
    }
    setErrors((x) => ({ ...x, [e.id]: "" }));
    updateEntry(e.id, (x) => ({ ...x, sets: x.sets.map((y) => (y.id === s.id ? edited : y)) }));
    setEditing(null);
  }

  function removeSet(e: ExerciseEntry, s: SetEntry) {
    updateEntry(e.id, (x) => ({ ...x, sets: x.sets.filter((y) => y.id !== s.id).map((y, i) => ({ ...y, setIndex: i + 1 })) }));
    if (editing?.set === s.id) setEditing(null);
  }

  function fillFrom(e: ExerciseEntry, source: SetEntry | null, p: ExerciseCore | null) {
    if (source) {
      setInput(e.id, {
        load: source.loadValue !== null && source.loadUnit ? trimNumber(convertWeight(source.loadValue, source.loadUnit, unitOf(e)), 2) : "",
        reps: source.reps !== null ? String(source.reps) : "",
        seconds: source.seconds !== null ? String(source.seconds) : "",
      });
    } else if (p) {
      setInput(e.id, {
        load: p.load ? trimNumber(convertWeight(p.load.amount, p.load.unit, unitOf(e)), 2) : "",
        reps: p.target.type === "reps" ? String(p.target.max ?? p.target.min) : "",
        seconds: p.target.type === "duration" ? String(p.target.seconds) : "",
      });
    }
  }

  // ----------------------------------------------------------------- finish
  const suggestion = useMemo(() => suggestedStatus(doc, session), [doc, session]);
  const openFinish = () => {
    setFinishStatus(doc.status !== "in_progress" ? doc.status : suggestion);
    setFinishOpen(true);
  };
  const finish = () => {
    change((d) => ({ ...d, status: finishStatus }));
    setFinishOpen(false);
    setRest(null);
    setAnnounce("Workout finished.");
  };

  const discardLocal = () => {
    if (!window.confirm("Remove this workout's unsaved entries from this device? This can't be undone.")) return;
    removeItem(viewerId, "workout", docRef.current.id);
    router.push(props.backHref);
  };

  const deleteWorkout = async () => {
    if (!window.confirm("Delete this workout record? Your coach will no longer see it. This can't be undone.")) return;
    const r = await send({ op: "workout.delete", id: docRef.current.id, revision: base.current });
    if (r.status === "saved") {
      removeItem(viewerId, "workout", docRef.current.id);
      router.push(props.backHref);
      router.refresh();
    } else if (r.status === "conflict") {
      setSave({ kind: "failed", message: "This workout changed on another device. Reload before deleting it.", retryable: false });
    } else if (r.status === "held") {
      setSave({ kind: "held", reason: r.reason });
    } else {
      setSave({ kind: "failed", message: r.status === "offline" ? "You're offline. Delete it when you're connected." : r.message, retryable: false });
    }
  };

  // ------------------------------------------------------------------ view
  if (!ready) {
    return <p className="mt-8 text-ink-muted" role="status">Loading your workout…</p>;
  }

  const done = confirmedSets(doc);
  const finished = doc.status !== "in_progress";
  const locked = !canWrite;

  return (
    <div className="mt-6">
      <p className="sr-only" aria-live="polite">{announce}</p>

      {/* Sticky status: saving is never silent. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-b-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SaveBadge state={save} neverSaved={!savedOnce && save.kind === "saved"} onRetry={() => { retryIndex.current = 0; void syncRef.current(); }} />
          <span className="tabular text-sm text-ink-muted">
            {done} set{done === 1 ? "" : "s"} recorded{finished ? ` · ${doc.status === "completed" ? "completed" : doc.status === "partial" ? "partly done" : "skipped"}` : ""}
          </span>
        </div>
      </div>

      {held ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger bg-danger-tint p-4">
          <p className="font-medium">{held === "paused" ? props.pausedNotice : heldMessage(held)}</p>
          {held === "paused" ? (
            <p className="mt-1">
              Anything you enter now is kept on this device and saved when coaching resumes.{" "}
              <Link href="/account/billing" className="underline">Update your card</Link>.
            </p>
          ) : null}
          {held !== "paused" && save.kind !== "saved" ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={discardLocal}>Remove unsaved entries from this device</Button>
          ) : null}
        </div>
      ) : null}

      {conflict ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger bg-danger-tint p-4">
          <p className="font-semibold">
            {conflict.missing
              ? "This workout was deleted on another device."
              : conflict.duplicate
                ? "You already have a record of this session for this day, from another device."
                : "This workout was changed on another device since this one last saved."}
          </p>
          <p className="mt-1">Nothing has been overwritten. Choose which to keep:</p>
          {conflict.server ? (
            <p className="mt-1 text-sm">Saved version: {confirmedSets(conflict.server.doc)} sets. This device: {done} sets.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={keepMine}>{conflict.missing ? "Save it again" : "Keep this device's version"}</Button>
            <Button size="sm" variant="secondary" onClick={useSaved}>{conflict.missing ? "Discard it" : "Use the saved version"}</Button>
          </div>
        </div>
      ) : null}

      {props.versionNote ? <p className="mt-4 text-sm text-ink-muted">{props.versionNote}</p> : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-sm font-semibold">Date trained</span>
          <input
            type="date"
            value={doc.performedOn}
            max={props.today}
            disabled={locked}
            onChange={(e) => e.target.value && change((d) => ({ ...d, performedOn: e.target.value }), "soon")}
            className="mt-1 min-h-11 rounded-lg border border-line-strong bg-surface px-3"
          />
        </label>
        <p className="pb-2 text-sm text-ink-muted">Dates follow your time zone ({props.zoneLabel}).</p>
        <label className="flex min-h-11 items-center gap-2 pb-1">
          <input
            type="checkbox"
            checked={restOn}
            onChange={(e) => {
              setRestOn(e.target.checked);
              if (!e.target.checked) setRest(null);
              try {
                window.localStorage.setItem("talentyak:rest-timer", e.target.checked ? "on" : "off");
              } catch {
                /* per-device convenience only */
              }
            }}
            className="size-5 accent-brand"
          />
          <span>Rest timer</span>
        </label>
      </div>

      {doc.title !== null ? (
        <label className="mt-4 block">
          <span className="block font-semibold">Workout name</span>
          <input
            value={doc.title}
            maxLength={80}
            disabled={locked}
            onChange={(e) => change((d) => ({ ...d, title: e.target.value }), "soon")}
            className="mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3"
          />
        </label>
      ) : null}

      <ol className="mt-6 space-y-5">
        {doc.exercises.map((e, index) => {
          const p = prescribedFor(e, session);
          const planned = session?.exercises.find((x) => x.key === e.exerciseKey) ?? null;
          const { name, insteadOf } = entryName(e, session);
          const prev = props.previous[identityOf(e)] ?? null;
          const kind = amountKind(e, p);
          const v = inputs[e.id] ?? EMPTY_INPUTS;
          const unit = unitIn(e, inputs);
          const target = p?.sets ?? null;
          const nextIndex = e.sets.length + 1;
          const prevSet = prev?.entry.sets[nextIndex - 1] ?? prev?.entry.sets.at(-1) ?? null;
          const complete = target !== null && e.sets.filter((s) => !s.extra).length >= target;
          const canChangeIdentity = e.sets.length === 0 && !locked;
          return (
            <li key={e.id} className={`rounded-2xl border bg-surface ${e.status === "skipped" ? "border-dashed border-line-strong opacity-80" : complete ? "border-brand" : "border-line"}`}>
              <div className="px-4 pt-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">
                      <span className="text-ink-muted">{index + 1}. </span>
                      {name}
                    </h2>
                    {insteadOf ? <p className="text-ink-muted">Instead of {insteadOf}</p> : null}
                  </div>
                  <p className={`tabular shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${complete ? "bg-brand text-white" : "bg-paper-raised"}`}>
                    {e.status === "skipped" ? "Skipped" : target !== null ? `${Math.min(e.sets.filter((s) => !s.extra).length, target)}/${target}` : `${e.sets.length} set${e.sets.length === 1 ? "" : "s"}`}
                    {complete ? <Icon name="check" className="ml-1 inline size-4" /> : null}
                  </p>
                </div>

                {p ? (
                  <p className="mt-2 rounded-lg bg-paper-raised px-3 py-2">
                    <span className="text-sm font-semibold text-ink-muted">Coach&rsquo;s target: </span>
                    {targetText(p)}
                  </p>
                ) : e.exerciseKey && e.performedName ? (
                  <p className="mt-2 text-sm text-ink-muted">Your own substitute — recorded as what you did, kept apart from {insteadOf}&rsquo;s history.</p>
                ) : null}

                <div className="mt-3 rounded-lg border border-line px-3 py-2">
                  <p className="text-sm font-semibold text-ink-muted">
                    Last time{prev ? ` · ${formatDay(prev.date, { weekday: "short", month: "short", day: "numeric" })}` : ""}
                  </p>
                  {prev ? (
                    <ol className="tabular mt-1 space-y-0.5">
                      {prev.entry.sets.map((s) => (
                        <li key={s.id}>
                          <span className="text-ink-muted">Set {s.setIndex}:</span> {setText(prev.entry, s)}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-1 text-ink-muted">No earlier result for this exercise yet.</p>
                  )}
                </div>
              </div>

              {/* Today's confirmed sets */}
              {e.sets.length ? (
                <ol className="mt-3 divide-y divide-line border-y border-line">
                  {e.sets.map((s) => (
                    <li key={s.id} className="px-4 py-2 sm:px-5">
                      {editing?.set === s.id ? (
                        <div className="space-y-3">
                          <p className="font-semibold">Correct set {s.setIndex}</p>
                          <SetInputs e={e} p={p} kind={kind} v={v} unit={unit} onInput={(patch) => setInput(e.id, patch)} error={errors[e.id]} />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => saveEdit(e, p, s)}>Save correction</Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="tabular">
                            <Icon name="check" className="mr-1 inline size-4 text-brand" />
                            <span className="font-semibold">Set {s.setIndex}{s.extra ? " (extra)" : ""}:</span> {setText(e, s)}
                          </p>
                          {!locked ? (
                            <span className="flex gap-1">
                              <Button size="sm" variant="quiet" onClick={() => { fillFrom(e, s, p); setEditing({ exercise: e.id, set: s.id }); }}>
                                Edit<span className="sr-only"> set {s.setIndex}</span>
                              </Button>
                              <Button size="sm" variant="quiet" onClick={() => removeSet(e, s)}>
                                Remove<span className="sr-only"> set {s.setIndex}</span>
                              </Button>
                            </span>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : null}

              {/* Today's entry */}
              {e.status !== "skipped" && !locked && !editing ? (
                <div className="px-4 py-4 sm:px-5">
                  <p className="font-semibold">
                    {complete ? `Extra set ${nextIndex}` : `Set ${nextIndex}${target ? ` of ${target}` : ""}`}
                    {prevSet ? <span className="font-normal text-ink-muted"> · last time {setText(prev!.entry, prevSet)}</span> : null}
                  </p>
                  <div className="mt-2">
                    <SetInputs e={e} p={p} kind={kind} v={v} unit={unit} onInput={(patch) => setInput(e.id, patch)} error={errors[e.id]} placeholders={{
                      load: prevSet?.loadValue != null && prevSet.loadUnit ? trimNumber(convertWeight(prevSet.loadValue, prevSet.loadUnit, unit), 2) : p?.load ? trimNumber(convertWeight(p.load.amount, p.load.unit, unit), 2) : "",
                      reps: prevSet?.reps != null ? String(prevSet.reps) : p?.target.type === "reps" ? String(p.target.min) : "",
                      seconds: prevSet?.seconds != null ? String(prevSet.seconds) : p?.target.type === "duration" ? String(p.target.seconds) : "",
                    }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prevSet ? <Button size="sm" variant="secondary" onClick={() => fillFrom(e, prevSet, p)}>Same as last time</Button> : null}
                    {p && (p.load || p.target.type !== "none") ? <Button size="sm" variant="secondary" onClick={() => fillFrom(e, null, p)}>Use target</Button> : null}
                  </div>
                  <Button className="mt-3 w-full sm:w-auto" onClick={() => completeSet(e, p)}>
                    <Icon name="check" className="size-5" />
                    {complete ? "Add extra set" : `Complete set ${nextIndex}`}
                  </Button>
                </div>
              ) : null}

              <details className="border-t border-line px-4 py-2 sm:px-5">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">Options, notes and instructions<span className="sr-only"> for {name}</span></summary>
                <div className="space-y-4 pb-3">
                  {planned ? (
                    <fieldset disabled={!canChangeIdentity}>
                      <legend className="font-semibold">What you&rsquo;re doing</legend>
                      {!canChangeIdentity && !locked ? <p className="text-sm text-ink-muted">Remove this exercise&rsquo;s sets to change it — they belong to what you recorded.</p> : null}
                      <div className="mt-1 space-y-1">
                        <Radio name={`${e.id}-which`} checked={!e.alternativeKey && !e.performedName} onChange={() => updateEntry(e.id, (x) => ({ ...x, alternativeKey: null, performedName: null }))}>
                          {planned.name} <span className="text-ink-muted">(as planned)</span>
                        </Radio>
                        {planned.alternatives.map((a) => (
                          <Radio key={a.key} name={`${e.id}-which`} checked={e.alternativeKey === a.key} onChange={() => updateEntry(e.id, (x) => ({ ...x, alternativeKey: a.key, performedName: null }))}>
                            {a.name} <span className="text-ink-muted">(coach&rsquo;s alternative)</span>
                          </Radio>
                        ))}
                        <Radio name={`${e.id}-which`} checked={Boolean(e.performedName)} onChange={() => updateEntry(e.id, (x) => ({ ...x, alternativeKey: null, performedName: x.performedName ?? "My own substitute" }))}>
                          Something else
                        </Radio>
                        {e.performedName ? (
                          <label className="block pl-8">
                            <span className="sr-only">Name of what you did instead</span>
                            <input value={e.performedName} maxLength={80} onChange={(ev) => updateEntry(e.id, (x) => ({ ...x, performedName: ev.target.value || " " }), "soon")} className="min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3" />
                          </label>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}

                  <fieldset disabled={!canChangeIdentity}>
                    <legend className="font-semibold">What the weight means</legend>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {(Object.keys(LOAD_KIND_LABEL) as LoadKind[]).map((k) => (
                        <Radio key={k} name={`${e.id}-kind`} checked={e.loadKind === k} onChange={() => updateEntry(e.id, (x) => ({ ...x, loadKind: k, loadBasis: k === "weight" ? x.loadBasis : null }))}>
                          {LOAD_KIND_LABEL[k]}
                          <span className="block text-sm text-ink-muted">
                            {k === "weight" ? "The weight you lifted" : k === "bodyweight" ? "Your own body, plus any weight added" : k === "assisted" ? "Enter the assistance — less means harder" : "Time or reps only"}
                          </span>
                        </Radio>
                      ))}
                    </div>
                    {e.loadKind === "weight" ? (
                      <div className="mt-2 grid gap-1 sm:grid-cols-3">
                        {([[null, "Barbell or machine"], ["per_hand", "Per hand (each dumbbell)"], ["total", "Both together"]] as [LoadBasis | null, string][]).map(([b, l]) => (
                          <Radio key={String(b)} name={`${e.id}-basis`} checked={e.loadBasis === b} onChange={() => updateEntry(e.id, (x) => ({ ...x, loadBasis: b }))}>{l}</Radio>
                        ))}
                      </div>
                    ) : null}
                  </fieldset>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Unit</span>
                    {(["kg", "lb"] as WeightUnit[]).map((u) => (
                      <Button key={u} size="sm" variant={unit === u ? "primary" : "secondary"} aria-pressed={unit === u} onClick={() => setInput(e.id, { unit: u })}>
                        {u}
                      </Button>
                    ))}
                  </div>

                  {!locked ? (
                    e.status === "skipped" ? (
                      <Button size="sm" variant="secondary" onClick={() => updateEntry(e.id, (x) => ({ ...x, status: "active" }))}>Undo skip</Button>
                    ) : e.sets.length === 0 ? (
                      <Button size="sm" variant="secondary" onClick={() => updateEntry(e.id, (x) => ({ ...x, status: "skipped" }))}>Skip this exercise</Button>
                    ) : null
                  ) : null}
                  {!locked && !e.exerciseKey && e.sets.length === 0 ? (
                    <Button size="sm" variant="quiet" onClick={() => change((d) => ({ ...d, exercises: d.exercises.filter((x) => x.id !== e.id).map((x, i) => ({ ...x, position: i })) }))}>Remove this exercise</Button>
                  ) : null}

                  <label className="block">
                    <span className="block font-semibold">Notes <span className="font-normal text-ink-muted">(optional — your coach sees these)</span></span>
                    <textarea value={e.notes} maxLength={1000} rows={2} disabled={locked} onChange={(ev) => updateEntry(e.id, (x) => ({ ...x, notes: ev.target.value }), "soon")} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2" />
                  </label>

                  {p && (p.notes || p.demoUrl) ? (
                    <div>
                      <p className="font-semibold">How to do it</p>
                      <Paragraphs text={p.notes} className="mt-1" />
                    </div>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>

      {!locked ? (
        <div className="mt-5 rounded-2xl border border-dashed border-line-strong p-4">
          <label className="block font-semibold" htmlFor="add-exercise">Add an exercise</label>
          <div className="mt-2 flex gap-2">
            <input id="add-exercise" value={addName} maxLength={80} placeholder="e.g. Walking lunge" onChange={(e) => setAddName(e.target.value)} className="min-h-12 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3" />
            <Button
              variant="secondary"
              disabled={!addName.trim()}
              onClick={() => {
                const nm = addName.trim().slice(0, 80);
                change((d) => ({
                  ...d,
                  exercises: [...d.exercises, { id: newId(), position: d.exercises.length, exerciseKey: null, alternativeKey: null, performedName: nm, status: "active", loadKind: "weight", loadBasis: null, notes: "", sets: [] }],
                }));
                setAddName("");
              }}
            >
              <Icon name="plus" className="size-5" />Add
            </Button>
          </div>
          {session ? <p className="mt-1 text-sm text-ink-muted">Added exercises are recorded as extras, separate from your plan.</p> : null}
        </div>
      ) : null}

      <section aria-labelledby="finish-heading" className="mt-8 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 id="finish-heading" className="text-xl font-semibold">{finished ? "This workout" : "Finish"}</h2>
        <label className="mt-3 block">
          <span className="block font-semibold">How it went <span className="font-normal text-ink-muted">(optional — your coach sees this)</span></span>
          <textarea value={doc.notes} maxLength={2000} rows={3} disabled={locked} onChange={(ev) => change((d) => ({ ...d, notes: ev.target.value }), "soon")} className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2" />
        </label>

        {!locked && !finishOpen ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={openFinish}>{finished ? "Change how it's marked" : "Finish workout"}</Button>
            {!finished && done === 0 && session ? (
              <Button variant="secondary" onClick={() => { setFinishStatus("skipped"); setFinishOpen(true); }}>I skipped this session</Button>
            ) : null}
          </div>
        ) : null}

        {finishOpen ? (
          <fieldset className="mt-4">
            <legend className="font-semibold">Mark it as</legend>
            <p className="text-sm text-ink-muted">
              Suggested from what you recorded: {suggestion === "completed" ? "completed" : suggestion === "partial" ? "partly done" : "skipped"}. You decide.
            </p>
            <div className="mt-2 space-y-1">
              {(["completed", "partial", "skipped"] as const).map((s) => (
                <Radio key={s} name="finish-status" checked={finishStatus === s} onChange={() => setFinishStatus(s)}>
                  {s === "completed" ? "Completed" : s === "partial" ? "Partly done" : "Skipped"}
                </Radio>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={finish}>Save</Button>
              <Button variant="secondary" onClick={() => setFinishOpen(false)}>Keep logging</Button>
            </div>
          </fieldset>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-4">
          <Link href={props.backHref} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
            Back
          </Link>
          {!locked && savedOnce ? (
            <Button variant="quiet" onClick={() => void deleteWorkout()}>Delete this workout record</Button>
          ) : null}
        </div>
      </section>

      {rest !== null ? <RestTimer key={rest.n} seconds={rest.seconds} onDone={() => setRest(null)} /> : null}
    </div>
  );
}

function Radio({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-paper-raised">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-5 shrink-0 accent-brand" />
      <span>{children}</span>
    </label>
  );
}

function SetInputs({
  e,
  p,
  kind,
  v,
  unit,
  onInput,
  error,
  placeholders,
}: {
  e: ExerciseEntry;
  p: ExerciseCore | null;
  kind: "reps" | "seconds";
  v: Inputs;
  unit: WeightUnit;
  onInput: (patch: Partial<Inputs>) => void;
  error?: string;
  placeholders?: { load: string; reps: string; seconds: string };
}) {
  const errorId = useId();
  const loadLabel =
    e.loadKind === "assisted" ? "Assistance" : e.loadKind === "bodyweight" ? "Added weight" : e.loadBasis === "per_hand" ? "Weight per hand" : e.loadBasis === "total" ? "Weight, both together" : "Weight";
  return (
    <div aria-describedby={error ? errorId : undefined}>
      <div className={`grid gap-3 ${e.loadKind === "none" ? "grid-cols-1" : "grid-cols-2"}`}>
        {e.loadKind !== "none" ? (
          <Stepper label={loadLabel} value={v.load} onChange={(x) => onInput({ load: x })} step={WEIGHT_STEP[unit]} decimals={2} placeholder={placeholders?.load} unit={unit} inputMode="decimal" invalid={Boolean(error)} />
        ) : null}
        {kind === "reps" ? (
          <Stepper label="Reps" value={v.reps} onChange={(x) => onInput({ reps: x })} step={1} decimals={0} placeholder={placeholders?.reps} inputMode="numeric" invalid={Boolean(error)} />
        ) : (
          <Stepper label="Seconds" value={v.seconds} onChange={(x) => onInput({ seconds: x })} step={5} decimals={0} placeholder={placeholders?.seconds} inputMode="numeric" invalid={Boolean(error)} />
        )}
      </div>
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-brand">Effort (optional){p?.effort ? ` · target ${p.effort}` : ""}</summary>
        <label className="block max-w-40">
          <span className="block text-sm">How hard, 1–10</span>
          <input inputMode="decimal" value={v.rpe} onChange={(x) => onInput({ rpe: x.target.value.slice(0, 4) })} className={numberInput} />
        </label>
      </details>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 flex gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
