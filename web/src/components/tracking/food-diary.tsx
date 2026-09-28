"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { MediaUploader } from "@/components/media/uploader";
import { formatDay } from "@/lib/format";
import { listItems, newId, removeItem, send, writeItem, type StoredOp } from "@/lib/tracking/device";
import { parseAmount, parseWhole } from "@/lib/tracking/units";
import { heldMessage } from "@/components/tracking/save-badge";
import { FoodPhoto } from "@/components/tracking/food-photo";
import { MEAL_LABEL, type Meal } from "@/lib/tracking/labels";

/*
 * One day of the food diary. A photo, a few words, or both; calories and
 * protein only if the client knows them — nothing is estimated from a photo
 * and nothing is looked up. A day with entries is a partial record until the
 * client says it is complete, and a day with none is unrecorded, not zero.
 */


export interface FoodEntryView {
  id: string;
  meal: Meal;
  description: string | null;
  media_id: string | null;
  mediaState: string | null;
  kcal: number | null;
  protein_g: number | null;
  revision: number;
}

interface Draft {
  id: string | null;
  revision: number;
  meal: Meal;
  description: string;
  mediaId: string | null;
  kcal: string;
  protein: string;
}

const blankDraft = (): Draft => ({ id: null, revision: 0, meal: "breakfast", description: "", mediaId: null, kcal: "", protein: "" });

export function FoodDiary({
  viewerId,
  enrollmentId,
  date,
  today,
  entries,
  complete,
  live,
  held,
  pausedNotice,
}: {
  viewerId: string;
  enrollmentId: string;
  date: string;
  today: string;
  entries: FoodEntryView[];
  complete: boolean;
  live: boolean;
  held: "paused" | "ended" | "suspended" | "unavailable" | null;
  pausedNotice: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<StoredOp[]>([]);
  const [uploaderKey, setUploaderKey] = useState(0);
  const canAdd = live || held === "paused";

  const readWaiting = () =>
    setWaiting(
      listItems(viewerId).filter(
        (i): i is StoredOp => i.kind === "op" && i.body.op === "food.save" && (i.body.entry as { date?: string; enrollmentId?: string })?.date === date && (i.body.entry as { enrollmentId?: string }).enrollmentId === enrollmentId,
      ),
    );
  useEffect(() => {
    const timer = window.setTimeout(readWaiting, 0);
    const on = () => readWaiting();
    window.addEventListener("talentyak:tracking-changed", on);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("talentyak:tracking-changed", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function run(op: StoredOp, done: string) {
    writeItem(viewerId, op);
    setBusy(true);
    const r = await send(op.body);
    setBusy(false);
    if (r.status === "saved") {
      removeItem(viewerId, "op", op.id);
      setMessage({ bad: false, text: done });
      router.refresh();
      window.dispatchEvent(new Event("talentyak:tracking-changed"));
      return true;
    }
    if (r.status === "offline") {
      writeItem(viewerId, { ...op, state: "offline" });
      setMessage({ bad: false, text: "No connection. Kept on this device — it will save when you're back online." });
    } else if (r.status === "held") {
      writeItem(viewerId, { ...op, state: "held" });
      setMessage({ bad: true, text: r.reason === "paused" ? `${pausedNotice} Kept on this device until coaching resumes.` : heldMessage(r.reason) });
    } else if (r.status === "conflict") {
      removeItem(viewerId, "op", op.id);
      setMessage({ bad: true, text: "This entry was changed or removed on another device. The page has been refreshed with the saved version — make your change again if you still want it." });
      router.refresh();
    } else {
      writeItem(viewerId, { ...op, state: "failed", message: r.message });
      setMessage({ bad: true, text: r.message });
    }
    window.dispatchEvent(new Event("talentyak:tracking-changed"));
    return r.status !== "failed";
  }

  async function saveDraft() {
    const kcal = draft.kcal.trim() ? parseWhole(draft.kcal) : null;
    const protein = draft.protein.trim() ? parseAmount(draft.protein) : null;
    if (draft.kcal.trim() && (kcal === null || kcal > 10000)) return setMessage({ bad: true, text: "Calories: a whole number, like 450." });
    if (draft.protein.trim() && (protein === null || protein > 1000)) return setMessage({ bad: true, text: "Protein: a number of grams, like 30." });
    if (!draft.description.trim() && !draft.mediaId && kcal === null && protein === null) return setMessage({ bad: true, text: "Add a photo, a few words, or a number." });
    const id = draft.id ?? newId();
    const body = {
      op: "food.save",
      entry: { id, enrollmentId, date, meal: draft.meal, description: draft.description.trim().slice(0, 1000), mediaId: draft.mediaId, kcal: draft.kcal.trim(), proteinG: draft.protein.trim() },
      baseRevision: draft.revision,
    };
    const ok = await run(
      { v: 1, kind: "op", id: `food:${id}`, body, href: `/account/progress/${enrollmentId}/food?date=${date}`, label: `Food — ${MEAL_LABEL[draft.meal]}, ${formatDay(date)}`, state: "pending", updatedAt: Date.now() },
      draft.id ? "Entry updated." : "Entry saved.",
    );
    if (ok) {
      setDraft(blankDraft());
      setUploaderKey((k) => k + 1);
    }
  }

  const withNumbers = entries.filter((e) => e.kcal !== null || e.protein_g !== null);
  const kcalTotal = entries.reduce((s, e) => s + (e.kcal ?? 0), 0);
  const kcalCount = entries.filter((e) => e.kcal !== null).length;
  const proteinTotal = entries.reduce((s, e) => s + (e.protein_g ?? 0), 0);
  const proteinCount = entries.filter((e) => e.protein_g !== null).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper-raised p-4">
        <p>
          <span className="font-semibold">
            {entries.length === 0 ? "Nothing recorded for this day" : complete ? "Marked complete" : "Partial record"}
          </span>
          <span className="block text-sm text-ink-muted">
            {entries.length === 0
              ? "A day with no entries is unrecorded — never counted as eating nothing."
              : complete
                ? "You've said this is everything you ate this day."
                : `${entries.length} entr${entries.length === 1 ? "y" : "ies"} so far. Mark the day complete when it's everything.`}
          </span>
        </p>
        {canAdd && entries.length ? (
          <Button
            size="sm"
            variant={complete ? "secondary" : "primary"}
            disabled={busy}
            onClick={() =>
              void run(
                { v: 1, kind: "op", id: `foodday:${enrollmentId}:${date}`, body: { op: "food.day", enrollmentId, date, complete: !complete }, href: `/account/progress/${enrollmentId}/food?date=${date}`, label: `Food diary — ${formatDay(date)} ${complete ? "not complete" : "complete"}`, state: "pending", updatedAt: Date.now() },
                complete ? "Marked as a partial record." : "Marked complete.",
              )
            }
          >
            {complete ? "Not complete after all" : "This is everything for the day"}
          </Button>
        ) : null}
      </div>

      {withNumbers.length ? (
        <p className="mt-3 text-ink-muted">
          {kcalCount ? <>Calories you entered: <span className="tabular font-semibold text-ink">{kcalTotal}</span> (from {kcalCount} of {entries.length} entries). </> : null}
          {proteinCount ? <>Protein you entered: <span className="tabular font-semibold text-ink">{Math.round(proteinTotal * 10) / 10} g</span> (from {proteinCount} of {entries.length}).</> : null}
          {!complete ? " Only what you typed — the day isn't marked complete." : ""}
        </p>
      ) : null}

      {message ? <p role={message.bad ? "alert" : "status"} className={`mt-3 font-medium ${message.bad ? "text-danger" : "text-brand"}`}>{message.text}</p> : null}

      {waiting.length ? (
        <div className="mt-4 rounded-lg border border-danger bg-danger-tint p-3">
          <p className="font-semibold">Waiting on this device</p>
          <ul className="mt-1 list-disc pl-6">
            {waiting.map((w) => {
              const e = w.body.entry as { meal: Meal; description?: string };
              return <li key={w.id}>{MEAL_LABEL[e.meal] ?? "Entry"}{e.description ? ` — ${e.description.slice(0, 60)}` : ""}</li>;
            })}
          </ul>
        </div>
      ) : null}

      {entries.length ? (
        <ul className="mt-4 space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap gap-4">
                <FoodPhoto mediaId={e.media_id} state={e.mediaState} alt={`Food photo, ${MEAL_LABEL[e.meal]}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{MEAL_LABEL[e.meal]}</p>
                  {e.description ? <p className="mt-1 whitespace-pre-line">{e.description}</p> : null}
                  {e.kcal !== null || e.protein_g !== null ? (
                    <p className="tabular mt-1 text-ink-muted">
                      {[e.kcal !== null ? `${e.kcal} kcal` : "", e.protein_g !== null ? `${e.protein_g} g protein` : ""].filter(Boolean).join(" · ")} <span className="text-sm">(your numbers)</span>
                    </p>
                  ) : null}
                  {canAdd ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button size="sm" variant="quiet" onClick={() => { setDraft({ id: e.id, revision: e.revision, meal: e.meal, description: e.description ?? "", mediaId: e.media_id, kcal: e.kcal?.toString() ?? "", protein: e.protein_g?.toString() ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        Edit
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => { if (window.confirm("Delete this entry?")) void run({ v: 1, kind: "op", id: `fooddel:${e.id}`, body: { op: "food.delete", id: e.id, revision: e.revision }, href: `/account/progress/${enrollmentId}/food?date=${date}`, label: `Delete food entry — ${formatDay(date)}`, state: "pending", updatedAt: Date.now() }, "Entry deleted."); }}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                  {e.media_id && e.mediaState && e.mediaState !== "deleted" ? (
                    <Button size="sm" variant="quiet" onClick={async () => {
                      if (!window.confirm("Remove this photo? The file is deleted. This can't be undone.")) return;
                      const r = await send({ op: "media.remove", mediaId: e.media_id });
                      setMessage(r.status === "saved" ? { bad: false, text: "Photo removed." } : { bad: true, text: r.status === "failed" ? r.message : "You're offline. Remove it when you're connected." });
                      if (r.status === "saved") router.refresh();
                    }}>
                      Remove photo
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd ? (
        <section aria-labelledby="add-food" className="mt-6 rounded-xl border border-line bg-surface p-4">
          <h3 id="add-food" className="text-lg font-semibold">{draft.id ? "Edit entry" : `Add to ${date === today ? "today" : formatDay(date, { weekday: "long", month: "short", day: "numeric" })}`}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block font-semibold">Meal</span>
              <select value={draft.meal} onChange={(e) => setDraft({ ...draft, meal: e.target.value as Meal })} className="mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3">
                {(Object.keys(MEAL_LABEL) as Meal[]).map((m) => <option key={m} value={m}>{MEAL_LABEL[m]}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="block font-semibold">What you had <span className="font-normal text-ink-muted">(optional if you add a photo)</span></span>
            <textarea value={draft.description} maxLength={1000} rows={2} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="e.g. dal bhat, one plate, extra saag" className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2" />
          </label>
          <div className="mt-3">
            {draft.mediaId ? (
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-brand">Photo attached.</span>
                <Button size="sm" variant="quiet" onClick={() => setDraft({ ...draft, mediaId: null })}>Don&rsquo;t attach it</Button>
              </p>
            ) : live ? (
              <MediaUploader key={uploaderKey} purpose="food_photo" enrollmentId={enrollmentId} imagesOnly label="Photo (optional)" help="Private to you and your current coach. Nothing is worked out from the photo." onUploaded={(id) => setDraft((d) => ({ ...d, mediaId: id }))} />
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block font-semibold">Calories <span className="font-normal text-ink-muted">(if you know)</span></span>
              <input inputMode="numeric" value={draft.kcal} onChange={(e) => setDraft({ ...draft, kcal: e.target.value.slice(0, 6) })} className="tabular mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3" />
            </label>
            <label className="block">
              <span className="block font-semibold">Protein, g <span className="font-normal text-ink-muted">(if you know)</span></span>
              <input inputMode="decimal" value={draft.protein} onChange={(e) => setDraft({ ...draft, protein: e.target.value.slice(0, 6) })} className="tabular mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3" />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void saveDraft()}>{busy ? "Saving…" : draft.id ? "Save changes" : "Save entry"}</Button>
            {draft.id ? <Button variant="secondary" onClick={() => setDraft(blankDraft())}>Cancel</Button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
