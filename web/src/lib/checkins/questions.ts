/*
 * Check-in questions and answers. Pure: shared by the coach's template
 * editor, the client's form, the save route and the tests. The database
 * re-checks the shape (checkin_questions_valid) and owns every access rule.
 *
 * Answers are stored per question key:
 *   text / long_text   a string
 *   rating             a whole number 1-5
 *   photo / video      the ids of the client's own uploaded files
 * A question left blank is simply absent — never stored as zero or "no".
 */

export type QuestionKind = "text" | "long_text" | "rating" | "photo" | "video";

export interface Question {
  key: string;
  kind: QuestionKind;
  label: string;
  help?: string;
  /** Never true for a sensitive question, a photo or a clip. */
  required?: boolean;
  /** Personal enough that the client must always be able to skip it. */
  sensitive?: boolean;
  /** Rating end labels. */
  low?: string;
  high?: string;
}

export type Answer = string | number | string[];
export type Answers = Record<string, Answer>;

export const KIND_LABEL: Record<QuestionKind, string> = {
  text: "Short answer",
  long_text: "Longer answer",
  rating: "Rating 1–5",
  photo: "Photos (optional)",
  video: "Form-check clip (optional)",
};

export const LIMITS = {
  questions: 20,
  label: 200,
  help: 300,
  end: 40,
  text: 300,
  longText: 2000,
  photos: 3,
  videos: 1,
  media: 6,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const KINDS = new Set<QuestionKind>(["text", "long_text", "rating", "photo", "video"]);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(CONTROL, "").trim().slice(0, max) : "";
}

export const isAttachment = (q: Pick<Question, "kind">) => q.kind === "photo" || q.kind === "video";
/** Sensitive questions and attachments are always the client's choice. */
export const mayBeRequired = (q: Pick<Question, "kind" | "sensitive">) => !isAttachment(q) && !q.sensitive;

function newKey(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The weekly starter: about two minutes. Four quick ratings, two optional
 * sentences, and an optional photo or clip.
 */
export function starterQuestions(): Question[] {
  return [
    { key: newKey(), kind: "rating", label: "How has your energy been this week?", low: "Very low", high: "Great", required: true },
    { key: newKey(), kind: "rating", label: "How have you been sleeping?", low: "Poorly", high: "Very well", required: true },
    { key: newKey(), kind: "rating", label: "How has your hunger been?", low: "Hungry a lot", high: "Comfortable", sensitive: true },
    { key: newKey(), kind: "rating", label: "How well are you recovering between sessions?", low: "Still sore or tired", high: "Fully recovered", required: true },
    { key: newKey(), kind: "long_text", label: "What was hardest this week?", help: "A sentence is plenty. Skip it if nothing stands out." },
    { key: newKey(), kind: "long_text", label: "What would help most from your coach?", help: "A question, a change, or anything you'd like support with." },
    { key: newKey(), kind: "photo", label: "Progress photos", help: "Only if you want to. Only your coach can see them.", sensitive: true },
    { key: newKey(), kind: "video", label: "A form-check clip", help: "A short clip of a lift you'd like your coach to look at." },
  ];
}

export const STARTER_TITLE = "Weekly check-in";

/** A coach's questions, cleaned. Problems are in words the coach can act on. */
export function normalizeQuestions(input: unknown): { questions: Question[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(input) || input.length === 0) return { questions: [], problems: ["Add at least one question."] };
  if (input.length > LIMITS.questions) problems.push(`Use at most ${LIMITS.questions} questions.`);
  const seen = new Set<string>();
  const questions: Question[] = [];
  input.slice(0, LIMITS.questions).forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const kind = r.kind as QuestionKind;
    const label = clean(r.label, LIMITS.label);
    let key = typeof r.key === "string" ? r.key.toLowerCase() : "";
    if (!isUuid(key) || seen.has(key)) key = newKey();
    seen.add(key);
    if (!KINDS.has(kind)) {
      problems.push(`Question ${i + 1}: choose what kind of answer it takes.`);
      return;
    }
    if (!label) problems.push(`Question ${i + 1} needs some wording.`);
    const q: Question = { key, kind, label };
    const help = clean(r.help, LIMITS.help);
    if (help) q.help = help;
    if (r.sensitive === true) q.sensitive = true;
    if (r.required === true && mayBeRequired(q)) q.required = true;
    if (kind === "rating") {
      const low = clean(r.low, LIMITS.end);
      const high = clean(r.high, LIMITS.end);
      if (low) q.low = low;
      if (high) q.high = high;
    }
    questions.push(q);
  });
  return { questions, problems };
}

export interface NormalizedAnswers {
  answers: Answers;
  mediaIds: string[];
  problems: string[];
  /** Required questions left blank (only reported when sending). */
  missing: string[];
}

/**
 * The client's answers against the questions they were asked. Unknown keys
 * are dropped; blanks are left out. `forSubmit` also checks required
 * questions — a draft can be saved half-finished.
 */
export function normalizeAnswers(questions: Question[], raw: unknown, forSubmit: boolean): NormalizedAnswers {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: Answers = {};
  const mediaIds: string[] = [];
  const problems: string[] = [];
  const missing: string[] = [];

  for (const q of questions) {
    const v = input[q.key];
    if (q.kind === "text" || q.kind === "long_text") {
      const text = clean(v, q.kind === "text" ? LIMITS.text : LIMITS.longText);
      if (text) answers[q.key] = text;
    } else if (q.kind === "rating") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
      if (Number.isInteger(n) && n >= 1 && n <= 5) answers[q.key] = n;
      else if (v !== undefined && v !== null && v !== "") problems.push(`"${q.label}": choose a number from 1 to 5.`);
    } else {
      const ids = Array.isArray(v) ? [...new Set(v.filter(isUuid).map((s) => s.toLowerCase()))] : [];
      const cap = q.kind === "photo" ? LIMITS.photos : LIMITS.videos;
      if (ids.length > cap) problems.push(`"${q.label}": at most ${cap} ${q.kind === "photo" ? "photos" : "clip"}.`);
      const kept = ids.slice(0, cap);
      if (kept.length) {
        answers[q.key] = kept;
        mediaIds.push(...kept);
      }
    }
    if (forSubmit && q.required && mayBeRequired(q) && answers[q.key] === undefined) missing.push(q.label);
  }
  if (mediaIds.length > LIMITS.media) problems.push(`Attach at most ${LIMITS.media} files in one check-in.`);
  return { answers, mediaIds: [...new Set(mediaIds)], problems, missing };
}

function comparable(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
}

/** Edit distance, bounded: stops early once it exceeds `cap`. */
export function editDistance(a: string, b: string, cap = 50): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Does a correction change anything the coach relies on?
 *
 *   · a rating changed, an answer added or removed, an attachment added or
 *     removed                                                → substantive
 *   · wording changed beyond a typo: more than 3 characters, or more than a
 *     tenth of the answer                                    → substantive
 *   · spacing, capitals, punctuation or a small typo only    → minor
 *
 * Decided on the server; the client never chooses its own label.
 */
export function correctionChanges(questions: Question[], before: Answers, after: Answers): { substantive: boolean; changed: string[] } {
  const changed: string[] = [];
  let substantive = false;
  for (const q of questions) {
    const a = before[q.key];
    const b = after[q.key];
    if (a === undefined && b === undefined) continue;
    if (a === undefined || b === undefined) {
      changed.push(q.key);
      substantive = true;
      continue;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      const x = [...(Array.isArray(a) ? a : [])].sort().join(",");
      const y = [...(Array.isArray(b) ? b : [])].sort().join(",");
      if (x !== y) {
        changed.push(q.key);
        substantive = true;
      }
      continue;
    }
    if (typeof a === "number" || typeof b === "number") {
      if (a !== b) {
        changed.push(q.key);
        substantive = true;
      }
      continue;
    }
    if (a === b) continue;
    changed.push(q.key);
    const x = comparable(a);
    const y = comparable(b);
    if (x === y) continue;
    const d = editDistance(x, y, 3);
    if (d > 3 || d > Math.max(x.length, y.length) * 0.1) substantive = true;
  }
  return { substantive, changed };
}

/** Readable text for one answer (attachments are shown by the page itself). */
export function answerText(q: Question, a: Answer | undefined): string | null {
  if (a === undefined) return null;
  if (q.kind === "rating" && typeof a === "number") {
    const end = a <= 1 && q.low ? ` — ${q.low}` : a >= 5 && q.high ? ` — ${q.high}` : "";
    return `${a} of 5${end}`;
  }
  if (typeof a === "string") return a;
  return null;
}
