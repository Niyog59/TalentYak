/*
 * The period's progress, as a check-in carries it. Pure.
 *
 * Built on the server from the client's own M12 records when they send the
 * check-in, and stored with that submission, so feedback always refers to
 * what was there at the time. Later additions or corrections are shown
 * separately — never by rewriting the stored summary.
 *
 * Missing is never zero: a day with nothing recorded is "not recorded", a
 * period with no weigh-in says so, and a planned session with no record is
 * "not logged" — not "skipped", not "failed".
 */

export interface SnapshotWorkout {
  date: string;
  label: string;
  status: "completed" | "partial" | "skipped" | "in_progress";
  planned: boolean;
}

export interface ProgressSnapshot {
  v: 1;
  capturedAt: string;
  period: { from: string; to: string };
  workouts: {
    hasPlan: boolean;
    inOrder: boolean;
    /** Planned sessions whose day has come. Null when no weekly plan applied. */
    due: number | null;
    completed: number;
    partial: number;
    skipped: number;
    notLogged: number;
    upcoming: number;
    unplanned: number;
    logged: SnapshotWorkout[];
  };
  weight: {
    unit: "kg" | "lb";
    readings: number;
    first: { date: string; value: number } | null;
    latest: { date: string; value: number } | null;
  };
  measurements: { unit: "cm" | "in"; label: string; readings: number; first: number | null; latest: number | null }[];
  food: {
    days: number;
    daysWithEntries: number;
    daysMarkedComplete: number;
    entries: number;
    entriesWithCalories: number;
    entriesWithProtein: number;
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n: number) => String(Math.round(n * 10) / 10);

export interface SnapshotLine {
  topic: "workouts" | "weight" | "measurements" | "food";
  text: string;
  /** Records are missing or partial — shown as such, not as zero. */
  incomplete: boolean;
}

/** The summary in plain sentences, with gaps named as gaps. */
export function describeSnapshot(s: ProgressSnapshot): SnapshotLine[] {
  const lines: SnapshotLine[] = [];
  const w = s.workouts;
  if (!w.hasPlan) {
    lines.push({ topic: "workouts", text: `No workout plan applied in this period. ${w.logged.length ? `${plural(w.logged.length, "workout")} recorded.` : "No workouts recorded."}`, incomplete: w.logged.length === 0 });
  } else if (w.inOrder || w.due === null) {
    lines.push({ topic: "workouts", text: `${plural(w.logged.filter((l) => l.planned).length, "planned session")} recorded (this plan is done in order, so there is no weekly target).`, incomplete: false });
  } else {
    const parts = [`${w.completed} of ${plural(w.due, "planned session")} completed`];
    if (w.partial) parts.push(`${w.partial} partly done`);
    if (w.skipped) parts.push(`${w.skipped} marked skipped`);
    lines.push({ topic: "workouts", text: parts.join(", ") + ".", incomplete: false });
    if (w.notLogged) {
      lines.push({ topic: "workouts", text: `${plural(w.notLogged, "planned session")} not logged — that means no record, not that it didn't happen.`, incomplete: true });
    }
    if (w.upcoming) lines.push({ topic: "workouts", text: `${plural(w.upcoming, "session")} still to come when this was sent.`, incomplete: false });
  }
  if (w.unplanned && w.hasPlan) lines.push({ topic: "workouts", text: `${plural(w.unplanned, "extra workout")} outside the plan.`, incomplete: false });

  const wt = s.weight;
  if (!wt.readings) {
    lines.push({ topic: "weight", text: "No weight recorded in this period.", incomplete: true });
  } else if (wt.readings === 1 || !wt.first || !wt.latest || wt.first.date === wt.latest.date) {
    lines.push({ topic: "weight", text: `One weigh-in: ${num(wt.latest!.value)} ${wt.unit}. Not enough readings to show a change.`, incomplete: true });
  } else {
    const d = wt.latest.value - wt.first.value;
    lines.push({
      topic: "weight",
      text: `${plural(wt.readings, "weigh-in")}: ${num(wt.first.value)} → ${num(wt.latest.value)} ${wt.unit} (${d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${num(Math.abs(d))} ${wt.unit}`}) between the first and latest readings.`,
      incomplete: false,
    });
  }

  const measured = s.measurements.filter((m) => m.readings > 0);
  if (measured.length) {
    lines.push({
      topic: "measurements",
      text: measured
        .map((m) => (m.readings > 1 && m.first !== null && m.latest !== null ? `${m.label} ${num(m.first)} → ${num(m.latest)} ${m.unit}` : `${m.label} ${num(m.latest ?? m.first ?? 0)} ${m.unit} (one reading)`))
        .join("; ") + ".",
      incomplete: false,
    });
  }

  const f = s.food;
  if (!f.daysWithEntries) {
    lines.push({ topic: "food", text: "No food diary entries in this period.", incomplete: true });
  } else {
    const unrecorded = f.days - f.daysWithEntries;
    lines.push({
      topic: "food",
      text: `Food diary on ${plural(f.daysWithEntries, "day")} of ${f.days} (${f.daysMarkedComplete} marked as the whole day, ${f.daysWithEntries - f.daysMarkedComplete} partial).${unrecorded ? ` ${plural(unrecorded, "day")} not recorded.` : ""}`,
      incomplete: unrecorded > 0 || f.daysMarkedComplete < f.daysWithEntries,
    });
    if (f.entries) {
      lines.push({
        topic: "food",
        text: `Calories typed on ${f.entriesWithCalories} of ${plural(f.entries, "entry", "entries")}, protein on ${f.entriesWithProtein}. Totals aren't calculated from partial records.`,
        incomplete: f.entriesWithCalories < f.entries || f.entriesWithProtein < f.entries,
      });
    }
  }
  return lines;
}

/**
 * What differs between the summary a check-in carried and the records now.
 * Empty when nothing changed. Worded as additions or corrections made
 * after sending, so feedback that referred to the original stays readable.
 */
export function snapshotChanges(sent: ProgressSnapshot, now: ProgressSnapshot): string[] {
  const out: string[] = [];
  const a = sent.workouts;
  const b = now.workouts;
  if (a.logged.length !== b.logged.length) {
    const d = b.logged.length - a.logged.length;
    out.push(d > 0 ? `${plural(d, "workout")} added for this period since it was sent.` : `${plural(-d, "workout")} removed from this period since it was sent.`);
  } else if (JSON.stringify(a.logged.map((l) => [l.date, l.status])) !== JSON.stringify(b.logged.map((l) => [l.date, l.status]))) {
    out.push("Workout records for this period were changed since it was sent.");
  }
  if (sent.weight.readings !== now.weight.readings || sent.weight.latest?.value !== now.weight.latest?.value || sent.weight.first?.value !== now.weight.first?.value) {
    out.push("Weight readings for this period changed since it was sent.");
  }
  // Compared value by value: a stored summary comes back with its keys in the
  // database's order, so the text of two equal summaries can differ.
  const m = (x: ProgressSnapshot) => x.measurements.map((r) => [r.label, r.readings, r.first, r.latest].join("|")).join(";");
  if (m(sent) !== m(now)) {
    out.push("Measurements for this period changed since it was sent.");
  }
  const fa = sent.food;
  const fb = now.food;
  if (fa.entries !== fb.entries || fa.daysWithEntries !== fb.daysWithEntries || fa.daysMarkedComplete !== fb.daysMarkedComplete) {
    out.push("Food diary entries for this period changed since it was sent.");
  }
  return out;
}

/** Anything the device sends as a snapshot is ignored; only the server builds one. */
export function isSnapshot(v: unknown): v is ProgressSnapshot {
  return Boolean(v && typeof v === "object" && (v as { v?: unknown }).v === 1 && (v as { period?: unknown }).period);
}
