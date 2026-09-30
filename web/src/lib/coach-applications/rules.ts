/**
 * Coach applications: the statuses, the choices on the form, and the checks
 * run on what an applicant typed.
 *
 * The database (0062) enforces the same limits and the same status changes;
 * this module exists so the form can say exactly what is wrong before a
 * round-trip, and so the founder panel only offers changes that will work.
 * Pure: shared by pages, actions and tests.
 */

export const APPLICATION_STATUSES = ["draft", "new", "reviewing", "interview", "approved", "waitlisted", "declined", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

/** What the founder sees. */
export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: "Draft",
  new: "New",
  reviewing: "Reviewing",
  interview: "Interview",
  approved: "Approved",
  waitlisted: "Waitlisted",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/** Badge colour in the founder panel. Status is always also written as a word. */
export const STATUS_TONE: Record<ApplicationStatus, "good" | "warn" | "bad" | "neutral" | "info"> = {
  draft: "neutral",
  new: "info",
  reviewing: "warn",
  interview: "warn",
  approved: "good",
  waitlisted: "neutral",
  declined: "bad",
  withdrawn: "neutral",
};

/**
 * What the applicant sees. Deliberately plain, and never more than the
 * founder has decided: "Interview" is shown as being reviewed, because the
 * founder arranges any call by hand and says so in their own words.
 */
export const APPLICANT_STATUS: Record<ApplicationStatus, { label: string; detail: string }> = {
  draft: { label: "Not sent yet", detail: "Your answers are saved. Add any qualifications, then send your application." },
  new: { label: "Received", detail: "We've received your application. We review applications when we have openings, so there's no fixed timeline." },
  reviewing: { label: "Being reviewed", detail: "We're reviewing your application. We may email you to arrange a short call." },
  interview: { label: "Being reviewed", detail: "We're reviewing your application. We may email you to arrange a short call." },
  approved: { label: "Accepted", detail: "Congratulations — we'd like you to coach with TalentYak. Read and sign the coach agreement to set up your coach account." },
  waitlisted: { label: "On our waitlist", detail: "We'd like to keep your application for when we have more openings. You don't need to do anything; you can still update it." },
  declined: { label: "Not accepted", detail: "We're not able to offer you a place this time. Thank you for applying." },
  withdrawn: { label: "Withdrawn", detail: "This application is closed. You can delete your details below." },
};

/** Statuses the applicant can still correct. Mirrors coach_application_editable() in 0062. */
export function applicantCanEdit(status: ApplicationStatus): boolean {
  return ["draft", "new", "reviewing", "interview", "waitlisted"].includes(status);
}

/** Mirrors coach_application_next_statuses() in 0062. */
export function nextStatuses(status: ApplicationStatus, agreementSigned: boolean): ApplicationStatus[] {
  switch (status) {
    case "new":
      return ["reviewing", "interview", "approved", "waitlisted", "declined"];
    case "reviewing":
      return ["interview", "approved", "waitlisted", "declined"];
    case "interview":
      return ["reviewing", "approved", "waitlisted", "declined"];
    case "waitlisted":
      return ["reviewing", "interview", "approved", "declined"];
    case "declined":
      return ["reviewing"];
    case "approved":
      return agreementSigned ? [] : ["reviewing", "waitlisted", "declined"];
    default:
      return [];
  }
}

/** The statuses that email the applicant. Everything else is internal. */
export const EMAILED_STATUSES: readonly ApplicationStatus[] = ["approved", "waitlisted", "declined"];

// ---------------------------------------------------------------------------
// Choices on the form
// ---------------------------------------------------------------------------

export const SPECIALTIES = [
  "Beginners",
  "General fitness",
  "Strength training",
  "Fat loss",
  "Muscle gain",
  "Mobility and flexibility",
  "Running and endurance",
  "Healthy eating habits",
  "Women's fitness",
  "Older adults",
  "Home workouts",
  "Sports performance",
] as const;

export const LANGUAGES = ["Nepali", "English", "Hindi", "Maithili", "Nepal Bhasa (Newari)", "Bhojpuri", "Tamang", "Gurung", "Magar", "Tharu"] as const;

/** Where applicants are based. Coaches are expected mainly in Nepal. */
export const COUNTRIES = [
  { value: "NP", label: "Nepal" },
  { value: "IN", label: "India" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "AU", label: "Australia" },
  { value: "CA", label: "Canada" },
  { value: "NZ", label: "New Zealand" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "QA", label: "Qatar" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "KW", label: "Kuwait" },
  { value: "MY", label: "Malaysia" },
  { value: "JP", label: "Japan" },
  { value: "KR", label: "South Korea" },
  { value: "HK", label: "Hong Kong" },
  { value: "SG", label: "Singapore" },
  { value: "DE", label: "Germany" },
  { value: "PT", label: "Portugal" },
  { value: "other", label: "Somewhere else" },
] as const;

export function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.value === code)?.label ?? code;
}

export const EXPERIENCE_YEARS = [
  { value: "lt1", label: "Less than a year" },
  { value: "1-2", label: "1–2 years" },
  { value: "3-5", label: "3–5 years" },
  { value: "6-10", label: "6–10 years" },
  { value: "10+", label: "More than 10 years" },
] as const;

export function experienceLabel(value: string): string {
  return EXPERIENCE_YEARS.find((e) => e.value === value)?.label ?? value;
}

/** Recorded with each application, so we know which notice the person saw. */
export const APPLICATION_PRIVACY_VERSION = "coach-application-privacy.v1";

export const MAX_CERTIFICATES = 5;

// ---------------------------------------------------------------------------
// Checking what was typed
// ---------------------------------------------------------------------------

export interface ApplicationFields {
  full_name: string;
  country: string;
  timezone: string;
  languages: string[];
  specialties: string[];
  experience_years: string;
  experience: string;
  online_experience: string;
  instagram: string;
  website: string;
  profile_url: string;
  availability: string;
  new_client_capacity: string;
  consistency_answer: string;
}

export const LIMITS = {
  full_name: 120,
  experience: 2000,
  online_experience: 1500,
  instagram: 200,
  website: 300,
  profile_url: 300,
  availability: 500,
  consistency_answer: 2000,
  other_item: 60,
} as const;

const INSTAGRAM = /^(@?[A-Za-z0-9._]{1,30}|https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._/?=-]+)$/;
const WEB_LINK = /^https?:\/\/[^\s<>"]+\.[^\s<>"]+$/;

/**
 * Field-by-field problems, in words the applicant can act on. Empty when the
 * answers are acceptable. `validTimezone` is passed in so this stays pure.
 */
export function checkApplication(f: ApplicationFields, validTimezone: (tz: string) => boolean): Record<string, string> {
  const e: Record<string, string> = {};
  const len = (s: string) => [...s].length;

  if (len(f.full_name) < 2) e.full_name = "Enter your full name.";
  else if (len(f.full_name) > LIMITS.full_name) e.full_name = `Keep your name under ${LIMITS.full_name} characters.`;

  if (!COUNTRIES.some((c) => c.value === f.country)) e.country = "Choose the country you live in.";
  if (!validTimezone(f.timezone)) e.timezone = "Choose your time zone.";

  if (f.languages.length === 0) e.languages = "Choose at least one language you can coach in.";
  else if (f.languages.length > 10) e.languages = "Choose up to 10 languages.";
  else if (f.languages.some((l) => len(l) > LIMITS.other_item)) e.languages = `Keep each language under ${LIMITS.other_item} characters.`;

  if (f.specialties.length === 0) e.specialties = "Choose at least one area you coach.";
  else if (f.specialties.length > 12) e.specialties = "Choose up to 12 areas.";
  else if (f.specialties.some((s) => len(s) > LIMITS.other_item)) e.specialties = `Keep each area under ${LIMITS.other_item} characters.`;

  if (!EXPERIENCE_YEARS.some((y) => y.value === f.experience_years)) e.experience_years = "Choose how long you've been coaching.";
  if (len(f.experience) < 20) e.experience = "Tell us a little more — at least 20 characters.";
  else if (len(f.experience) > LIMITS.experience) e.experience = `Keep this under ${LIMITS.experience} characters.`;

  if (len(f.online_experience) > LIMITS.online_experience) e.online_experience = `Keep this under ${LIMITS.online_experience} characters.`;

  if (f.instagram && (len(f.instagram) > LIMITS.instagram || !INSTAGRAM.test(f.instagram))) {
    e.instagram = "Enter your Instagram handle (like @yourname) or a link starting https://instagram.com/.";
  }
  if (f.website && (len(f.website) > LIMITS.website || !WEB_LINK.test(f.website))) e.website = "Enter a full web address starting with https://.";
  if (f.profile_url && (len(f.profile_url) > LIMITS.profile_url || !WEB_LINK.test(f.profile_url))) e.profile_url = "Enter a full web address starting with https://.";

  if (len(f.availability) < 5) e.availability = "Tell us roughly when and how many hours a week you could coach.";
  else if (len(f.availability) > LIMITS.availability) e.availability = `Keep this under ${LIMITS.availability} characters.`;

  if (f.new_client_capacity && !/^\d{1,3}$/.test(f.new_client_capacity)) e.new_client_capacity = "Enter a whole number, or leave it empty.";
  else if (f.new_client_capacity && Number(f.new_client_capacity) > 100) e.new_client_capacity = "Enter a number between 0 and 100.";

  if (len(f.consistency_answer) < 30) e.consistency_answer = "Please write at least a couple of sentences (30 characters or more).";
  else if (len(f.consistency_answer) > LIMITS.consistency_answer) e.consistency_answer = `Keep this under ${LIMITS.consistency_answer} characters.`;

  return e;
}

/** Ticked options plus anything typed in "Other", de-duplicated, empty entries dropped. */
export function mergeChoices(ticked: string[], other: string): string[] {
  const extra = other.split(",").map((s) => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...ticked, ...extra]) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** A link to show a founder: only http(s), otherwise nothing clickable. */
export function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^@?[A-Za-z0-9._]{1,30}$/.test(value)) return `https://instagram.com/${value.replace(/^@/, "")}`;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
