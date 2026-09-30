import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLICATION_STATUSES,
  APPLICANT_STATUS,
  EMAILED_STATUSES,
  applicantCanEdit,
  checkApplication,
  mergeChoices,
  nextStatuses,
  safeLink,
  type ApplicationFields,
} from "@/lib/coach-applications/rules";

const good: ApplicationFields = {
  full_name: "Asha Gurung",
  country: "NP",
  timezone: "Asia/Kathmandu",
  languages: ["Nepali", "English"],
  specialties: ["Beginners"],
  experience_years: "3-5",
  experience: "Five years coaching adults in a Kathmandu gym.",
  online_experience: "",
  instagram: "",
  website: "",
  profile_url: "",
  availability: "Weekday evenings, 10 hours a week",
  new_client_capacity: "",
  consistency_answer: "Start with three short sessions a week and check in every Sunday.",
};
const tz = (z: string) => z === "Asia/Kathmandu" || z === "Europe/London";

test("a complete application with only the required answers passes", () => {
  assert.deepEqual(checkApplication(good, tz), {});
});

test("each missing required answer is named on its own field", () => {
  const e = checkApplication({ ...good, full_name: "", country: "", timezone: "", languages: [], specialties: [], experience_years: "", experience: "", availability: "", consistency_answer: "" }, tz);
  assert.deepEqual(Object.keys(e).sort(), ["availability", "consistency_answer", "country", "experience", "experience_years", "full_name", "languages", "specialties", "timezone"]);
});

test("optional answers stay optional, but bad links and numbers are refused", () => {
  assert.deepEqual(checkApplication({ ...good, instagram: "@asha.fit", website: "https://asha.example", new_client_capacity: "8" }, tz), {});
  const e = checkApplication({ ...good, instagram: "not a handle!", website: "javascript:alert(1)", profile_url: "ftp://x.y", new_client_capacity: "500" }, tz);
  assert.ok(e.instagram && e.website && e.profile_url && e.new_client_capacity);
});

test("over-long answers are refused with the limit stated", () => {
  const e = checkApplication({ ...good, consistency_answer: "x".repeat(2001), experience: "y".repeat(2001) }, tz);
  assert.match(e.consistency_answer, /2000/);
  assert.match(e.experience, /2000/);
});

test("ticked choices and 'Other' merge without duplicates", () => {
  assert.deepEqual(mergeChoices(["Nepali", "English"], "english, Sherpa , ,Tamang"), ["Nepali", "English", "Sherpa", "Tamang"]);
});

test("status changes mirror the database: withdrawn is final, a signed approval can't be undone", () => {
  assert.deepEqual(nextStatuses("withdrawn", false), []);
  assert.deepEqual(nextStatuses("draft", false), [], "founders can't act on a draft");
  assert.deepEqual(nextStatuses("approved", true), []);
  assert.ok(nextStatuses("approved", false).includes("declined"));
  assert.deepEqual(nextStatuses("declined", false), ["reviewing"]);
  for (const s of APPLICATION_STATUSES) assert.ok(!nextStatuses(s, false).includes(s), `${s} can't change to itself`);
});

test("only decisions email the applicant, and interviews look like reviewing to them", () => {
  assert.deepEqual([...EMAILED_STATUSES].sort(), ["approved", "declined", "waitlisted"]);
  assert.equal(APPLICANT_STATUS.interview.label, APPLICANT_STATUS.reviewing.label);
});

test("the applicant can correct an application only before a final decision", () => {
  assert.ok(applicantCanEdit("draft") && applicantCanEdit("new") && applicantCanEdit("waitlisted"));
  assert.ok(!applicantCanEdit("approved") && !applicantCanEdit("declined") && !applicantCanEdit("withdrawn"));
});

test("links shown to founders are only ever http(s)", () => {
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("@asha.fit"), "https://instagram.com/asha.fit");
  assert.equal(safeLink("https://asha.example/"), "https://asha.example/");
  assert.equal(safeLink(null), null);
});

test("no status message promises a timeline", () => {
  for (const s of Object.values(APPLICANT_STATUS)) assert.doesNotMatch(`${s.label} ${s.detail}`, /\b(within|days?|weeks?|hours?)\b/i);
});
