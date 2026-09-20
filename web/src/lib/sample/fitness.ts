/*
 * SAMPLE DATA — reference screens only.
 *
 * Every person, price, time and number here is invented to show layout.
 * Names are deliberately generic ("Sample coach A", "Client C") so nobody can
 * mistake them for real TalentYak coaches or customers. Coach biographies and
 * credentials are shown as placeholders, never invented.
 *
 * Live routes must never import this file. Later modules replace it with
 * real data in the same shapes.
 */

export interface SampleInclusions {
  programme: string;
  revision: string;
  calls: string | null;
  checkIns: string | null;
  messaging: string | null;
  formReview: string | null;
  nutrition: string | null;
}

export interface SamplePlan {
  id: string;
  name: string;
  kind: "Ongoing coaching";
  priceMinor: number;
  currency: string;
  billing: string;
  summary: string;
  inclusions: SampleInclusions;
}

export interface SampleConsultation {
  name: string;
  priceMinor: number;
  currency: string;
  durationMinutes: number;
  modality: string;
  purpose: string;
}

export interface SampleCoach {
  slug: string;
  name: string;
  initials: string;
  basedIn: string;
  timeZone: string;
  focus: string[];
  languages: string[];
  plans: SamplePlan[];
  consultation: SampleConsultation;
  /** Open slots as absolute instants; displayed in the viewer's timezone. */
  openSlots: string[];
}

export const sampleCoaches: SampleCoach[] = [
  {
    slug: "sample-coach-a",
    name: "Sample coach A",
    initials: "A",
    basedIn: "Kathmandu, Nepal",
    timeZone: "Asia/Kathmandu",
    focus: ["Strength", "Fat loss"],
    languages: ["Nepali", "English"],
    plans: [
      {
        id: "a-weekly-calls",
        name: "Strength foundations",
        kind: "Ongoing coaching",
        priceMinor: 8500,
        currency: "USD",
        billing: "per month, charged monthly",
        summary:
          "A training plan built around your equipment, with a weekly call to review how it's going.",
        inclusions: {
          programme: "Personal training plan",
          revision: "Reviewed monthly and changed when your coach thinks it helps",
          calls: "1 video or audio call a week, 30 minutes",
          checkIns: "Weekly written check-in",
          messaging: "Replies within 24 hours on weekdays",
          formReview: "Form videos reviewed with written feedback",
          nutrition: null,
        },
      },
      {
        id: "a-check-ins",
        name: "Plan and check-ins",
        kind: "Ongoing coaching",
        priceMinor: 5500,
        currency: "USD",
        billing: "per month, charged monthly",
        summary: "Your plan and a weekly written check-in, without scheduled calls.",
        inclusions: {
          programme: "Personal training plan",
          revision: "Reviewed monthly and changed when your coach thinks it helps",
          calls: null,
          checkIns: "Weekly written check-in",
          messaging: "Replies within 48 hours",
          formReview: "Up to 4 form videos a month",
          nutrition: null,
        },
      },
    ],
    consultation: {
      name: "One-off consultation",
      priceMinor: 3000,
      currency: "USD",
      durationMinutes: 45,
      modality: "Video or audio call",
      purpose:
        "Talk through your goals and training history and get specific advice. No ongoing programme is included.",
    },
    openSlots: ["2026-09-16T01:00:00Z", "2026-09-16T23:30:00Z", "2026-09-17T13:00:00Z"],
  },
  {
    slug: "sample-coach-b",
    name: "Sample coach B",
    initials: "B",
    basedIn: "Pokhara, Nepal",
    timeZone: "Asia/Kathmandu",
    focus: ["General fitness", "Mobility"],
    languages: ["Nepali", "English"],
    plans: [
      {
        id: "b-monthly",
        name: "Everyday fitness",
        kind: "Ongoing coaching",
        priceMinor: 7000,
        currency: "USD",
        billing: "per month, charged monthly",
        summary: "Short, realistic sessions for busy weeks, adjusted as your schedule changes.",
        inclusions: {
          programme: "Personal training plan",
          revision: "Changed when your coach thinks it helps",
          calls: "1 video or audio call a month, 45 minutes",
          checkIns: "Check-in every two weeks",
          messaging: "Replies within 24 hours",
          formReview: "Up to 2 form videos a month",
          nutrition: "General eating guidance — not medical advice",
        },
      },
    ],
    consultation: {
      name: "One-off consultation",
      priceMinor: 2500,
      currency: "USD",
      durationMinutes: 30,
      modality: "Video or audio call",
      purpose: "A single session for advice on your routine. No ongoing programme is included.",
    },
    openSlots: ["2026-09-16T02:15:00Z", "2026-09-18T00:00:00Z"],
  },
];

/* ---------------------------- Customer ---------------------------- */

export const sampleCustomer = {
  name: "Sample customer",
  timeZone: "America/Chicago",
  weightUnit: "kg" as const,
  coachName: "Sample coach A",
  planName: "Strength foundations",
};

export interface SampleExercise {
  id: string;
  name: string;
  sets: number;
  targetReps: string;
  restSeconds: number;
  /** What the customer recorded last time this exercise was prescribed. */
  previous: string | null;
  coachNote?: string;
  formVideoRequested?: boolean;
  weighted: boolean;
}

export const sampleWorkout = {
  title: "Lower body",
  programme: "Strength foundations",
  programmeVersion: 2,
  week: 3,
  day: 1,
  estimatedMinutes: 50,
  exercises: [
    {
      id: "goblet-squat",
      name: "Goblet squat",
      sets: 4,
      targetReps: "8–10",
      restSeconds: 90,
      previous: "3 × 10 at 16 kg",
      coachNote: "Pause for one second at the bottom of each rep.",
      formVideoRequested: true,
      weighted: true,
    },
    {
      id: "romanian-deadlift",
      name: "Romanian deadlift",
      sets: 3,
      targetReps: "10",
      restSeconds: 90,
      previous: "3 × 10 at 20 kg",
      weighted: true,
    },
    {
      id: "split-squat",
      name: "Split squat",
      sets: 3,
      targetReps: "8 each side",
      restSeconds: 60,
      previous: "3 × 8 at bodyweight",
      weighted: true,
    },
    {
      id: "plank",
      name: "Plank",
      sets: 3,
      targetReps: "30–40 seconds",
      restSeconds: 45,
      previous: null,
      weighted: false,
    },
  ] satisfies SampleExercise[],
};

export const sampleNextCall = {
  startsAt: "2026-09-16T01:00:00Z",
  durationMinutes: 30,
  modality: "Video call",
  coachName: "Sample coach A",
  coachTimeZone: "Asia/Kathmandu",
};

/** Daily entries are optional — gaps are normal and shown as gaps. */
export const sampleWeights: { date: string; kg: number }[] = [
  { date: "2026-08-12", kg: 73.8 },
  { date: "2026-08-15", kg: 73.4 },
  { date: "2026-08-19", kg: 73.6 },
  { date: "2026-08-22", kg: 73.1 },
  { date: "2026-08-26", kg: 72.9 },
  { date: "2026-08-29", kg: 73.2 },
  { date: "2026-09-02", kg: 72.7 },
  { date: "2026-09-05", kg: 72.8 },
  { date: "2026-09-08", kg: 72.4 },
];

export const sampleFeedback = [
  {
    id: "f1",
    date: "2026-09-09",
    from: "Sample coach A",
    about: "Goblet squat form video",
    text: "Depth looked steadier than last week. Keep the same weight and add the one-second pause before going heavier.",
  },
  {
    id: "f2",
    date: "2026-09-03",
    from: "Sample coach A",
    about: "Weekly check-in",
    text: "Good consistency with four sessions. Your plan stays the same for now — it's still working.",
  },
];

export const sampleHistory = [
  { id: "h1", date: "2026-09-09", title: "Upper body", done: "5 of 5 exercises", note: "Push-ups felt easier" },
  { id: "h2", date: "2026-09-07", title: "Lower body", done: "4 of 4 exercises", note: null },
  { id: "h3", date: "2026-09-05", title: "Conditioning", done: "3 of 4 exercises", note: "Stopped early — short on time" },
  { id: "h4", date: "2026-09-02", title: "Upper body", done: "5 of 5 exercises", note: null },
];

/* ------------------------------ Coach ------------------------------ */

export const sampleCoachOverview = {
  coachName: "Sample coach A",
  coachTimeZone: "Asia/Kathmandu",
  needsReview: [
    {
      id: "r1",
      kind: "Check-in",
      client: "Client C",
      clientId: "client-c",
      detail: "Weekly check-in submitted",
      at: "2026-09-10T15:20:00Z",
    },
    {
      id: "r2",
      kind: "Form video",
      client: "Client A",
      clientId: "client-a",
      detail: "Goblet squat, set 2",
      at: "2026-09-10T02:05:00Z",
    },
    {
      id: "r3",
      kind: "Message",
      client: "Client D",
      clientId: "client-d",
      detail: "Asked whether to swap an exercise",
      at: "2026-09-09T22:40:00Z",
    },
  ],
  upcomingCalls: [
    {
      id: "c1",
      client: "Client A",
      startsAt: "2026-09-16T01:00:00Z",
      durationMinutes: 30,
      modality: "Video",
      clientTimeZone: "America/Chicago",
    },
    {
      id: "c2",
      client: "Client B",
      startsAt: "2026-09-16T13:30:00Z",
      durationMinutes: 45,
      modality: "Audio",
      clientTimeZone: "Europe/London",
    },
  ],
  clients: [
    { id: "client-a", name: "Client A", plan: "Strength foundations", timeZone: "America/Chicago", lastWorkout: "2026-09-09" },
    { id: "client-b", name: "Client B", plan: "Strength foundations", timeZone: "Europe/London", lastWorkout: "2026-09-08" },
    { id: "client-c", name: "Client C", plan: "Plan and check-ins", timeZone: "Australia/Sydney", lastWorkout: "2026-09-10" },
    { id: "client-d", name: "Client D", plan: "Plan and check-ins", timeZone: "America/New_York", lastWorkout: null },
  ],
};

export const sampleClientDetail = {
  id: "client-a",
  name: "Client A",
  plan: "Strength foundations",
  timeZone: "America/Chicago",
  startedOn: "2026-07-01",
  goals: "Get stronger for everyday life; train three times a week at home with dumbbells.",
  programme: {
    version: 2,
    publishedOn: "2026-09-01",
    previousVersions: [{ version: 1, publishedOn: "2026-07-01" }],
    days: [
      { title: "Lower body", items: ["Goblet squat — 4 × 8–10", "Romanian deadlift — 3 × 10", "Split squat — 3 × 8 each side", "Plank — 3 × 30–40 s"] },
      { title: "Upper body", items: ["Push-up — 4 × 8–12", "One-arm row — 3 × 10 each side", "Overhead press — 3 × 8", "Dead bug — 3 × 10"] },
      { title: "Conditioning", items: ["Brisk walk or bike — 20 min", "Step-ups — 3 × 12", "Farmer carry — 4 × 30 m"] },
    ],
  },
  checkIns: [
    { id: "k1", date: "2026-09-03", status: "Reviewed", summary: "4 sessions. Sleep better. Knee fine." },
    { id: "k2", date: "2026-08-27", status: "Reviewed", summary: "3 sessions. Work travel midweek." },
  ],
  media: [
    { id: "m1", kind: "Form video", label: "Goblet squat, set 2", date: "2026-09-10", reviewed: false },
    { id: "m2", kind: "Progress photo", label: "Front", date: "2026-09-01", reviewed: true },
  ],
};

/* ----------------------------- Founder ----------------------------- */

export const sampleFounderBookings = [
  { id: "BK-1042", customer: "Customer 1", coach: "Sample coach A", offer: "Strength foundations", amountMinor: 8500, currency: "USD", status: "Active", created: "2026-09-02" },
  { id: "BK-1041", customer: "Customer 2", coach: "Sample coach B", offer: "One-off consultation", amountMinor: 2500, currency: "USD", status: "Scheduled", created: "2026-09-01" },
  { id: "BK-1039", customer: "Customer 3", coach: "Sample coach A", offer: "Plan and check-ins", amountMinor: 5500, currency: "USD", status: "Payment failed", created: "2026-08-28" },
  { id: "BK-1036", customer: "Customer 4", coach: "Sample coach B", offer: "Everyday fitness", amountMinor: 7000, currency: "USD", status: "Coach change requested", created: "2026-08-24" },
];

export const sampleFounderCoaches = [
  { id: "sample-coach-a", name: "Sample coach A", clients: 4, capacity: 12, credentials: "Checked with issuer", status: "Active" },
  { id: "sample-coach-b", name: "Sample coach B", clients: 2, capacity: 8, credentials: "Waiting for issuer reply", status: "Onboarding" },
];
