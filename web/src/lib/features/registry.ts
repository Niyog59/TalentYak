/**
 * The feature register: every product capability the founder can switch, what
 * each mode means, what it depends on, and whether it is ready at all.
 *
 * Two separate questions, never merged:
 *
 *   · Readiness — is it built, and is its setup done? Decided by code and
 *     configuration. A switch cannot change it.
 *   · Availability — the founder's setting (on / read-only / off / test
 *     accounts only). Stored in the database, changed without a deployment.
 *
 * What people actually get is the stricter of the two. Turning something "on"
 * never activates an unbuilt feature, never completes missing setup, and never
 * approves a policy: those stay blockers until they are resolved properly.
 *
 * Security, sign-in, authorisation, the live-payment gate and the change
 * history are deliberately NOT on this list. No switch can turn them off.
 *
 * Pure: shared by the founder panel, the server checks and the tests.
 */

export const FEATURE_KEYS = [
  "programmes",
  "logging",
  "check_ins",
  "messaging",
  "attachments",
  "bookings",
  "calls",
  "new_sales",
  "public_profiles",
  "waitlist",
  "coach_changing",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureMode = "on" | "read_only" | "off" | "test_only";
export type FeatureModes = Record<FeatureKey, FeatureMode>;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export const MODE_LABEL: Record<FeatureMode, string> = {
  on: "On",
  read_only: "Read-only",
  off: "Off",
  test_only: "Test accounts only",
};

/** How open a mode is. A feature can't be more open than what it relies on. */
const OPENNESS: Record<FeatureMode, number> = { off: 0, read_only: 1, test_only: 2, on: 3 };

export interface ModeSpec {
  mode: FeatureMode;
  /** normal: stops new activity, keeps what is under way. emergency: also stops work already under way. */
  kind: "normal" | "emergency" | "testing";
  explanation: string;
  /** Needs an explicit confirmation before it is applied. */
  highImpact: boolean;
}

export interface Dependency {
  feature: FeatureKey;
  why: string;
}

export interface ReadinessContext {
  dailyConfigured: boolean;
  resendConfigured: boolean;
  stripeMode: "live" | "test" | "unconfigured";
  /** Every reason live billing still refuses (policies, flag, legal). */
  liveBlockers: string[];
  callsFulfillmentReady: boolean;
  /** Unresolved founder decisions, by feature. */
  unresolvedPrerequisites: { feature: FeatureKey; blocksMode: FeatureMode; description: string }[];
}

export interface Readiness {
  state: "built" | "needs_setup" | "not_built";
  blockers: string[];
}

export interface FeatureSpec {
  key: FeatureKey;
  label: string;
  summary: string;
  audiences: string;
  modes: ModeSpec[];
  defaultMode: FeatureMode;
  existingWork: string;
  dependencies: Dependency[];
  enforcement: string;
  readiness: (ctx: ReadinessContext) => Readiness;
}

const built = (): Readiness => ({ state: "built", blockers: [] });

const TEST_ONLY = (what: string): ModeSpec => ({
  mode: "test_only",
  kind: "testing",
  explanation: `Only accounts on the test list can ${what}. Everyone else sees it as paused.`,
  highImpact: true,
});

export const FEATURES: FeatureSpec[] = [
  {
    key: "programmes",
    label: "Programmes",
    summary: "Coaches write and publish workout and nutrition plans for their clients.",
    audiences: "Coaches (writing), clients (following).",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Coaches create, draft and publish plans as usual.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "No new plans, drafts, edits or publications. Clients keep following their current plan; updates already scheduled still take effect; sessions can still be moved.",
        highImpact: true,
      },
      TEST_ONLY("start or publish plans"),
    ],
    existingWork: "Published plans and history are untouched and stay readable. Drafts already started stay saved, unchanged, and can be finished once it is back on.",
    dependencies: [],
    enforcement: "Coach screens, plan actions and the database refuse new plans and publications.",
    readiness: built,
  },
  {
    key: "logging",
    label: "Workout and progress logging",
    summary: "Clients record workouts, body readings, photos and food.",
    audiences: "Clients (writing), their current coach (reading).",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Clients save entries as usual.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "New entries wait safely on the client's device and save automatically when logging is back. Everything already saved stays readable.",
        highImpact: true,
      },
      TEST_ONLY("save new entries"),
    ],
    existingWork: "Nothing saved is changed or hidden. Entries made while paused are kept on the device, not lost.",
    dependencies: [],
    enforcement: "The saving service answers \"held\", and the database refuses the write, so the device keeps the entry.",
    readiness: built,
  },
  {
    key: "check_ins",
    label: "Check-ins",
    summary: "Scheduled client check-ins and coach feedback.",
    audiences: "Clients and coaches.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Check-ins are requested on each coach's schedule.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "No new check-in requests and no new schedules. Check-ins already requested can still be sent, and coaches can still finish their reviews.",
        highImpact: true,
      },
      TEST_ONLY("receive new check-in requests"),
    ],
    existingWork: "Requests already made, drafts, submissions and feedback are kept. Periods skipped while paused are not asked for later (no backlog).",
    dependencies: [],
    enforcement: "Schedule actions and the database refuse new schedules; the scheduled job skips new requests.",
    readiness: built,
  },
  {
    key: "messaging",
    label: "Messaging",
    summary: "Private conversations between a client and their coach.",
    audiences: "Clients and coaches. Support contact is separate and always stays open.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Clients and coaches message as usual.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "No new messages. Conversations stay readable; unsent text stays in the box. Support stays reachable.",
        highImpact: true,
      },
      {
        mode: "off",
        kind: "emergency",
        explanation: "Emergency: conversations are hidden in the app and nothing can be sent, including by tabs already open. Nothing is deleted.",
        highImpact: true,
      },
      TEST_ONLY("send messages"),
    ],
    existingWork: "Every conversation is kept exactly as it is. Nothing is deleted in any mode.",
    dependencies: [],
    enforcement: "Conversation screens, the send action and the database refuse new messages; email alerts stop while it is off.",
    readiness: built,
  },
  {
    key: "attachments",
    label: "Photos and clips in messages and check-ins",
    summary: "Clients and coaches attach photos or short clips.",
    audiences: "Clients and coaches.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Attachments can be added and viewed.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "No new attachments. Existing ones can still be viewed by the people allowed to see them. Text still works.",
        highImpact: true,
      },
      {
        mode: "off",
        kind: "emergency",
        explanation: "Emergency: no new attachments, and existing message and check-in attachments are not shown. Nothing is deleted.",
        highImpact: true,
      },
      TEST_ONLY("add attachments"),
    ],
    existingWork: "Stored files are kept. Progress and food photos belong to logging and are not affected here.",
    dependencies: [],
    enforcement: "The upload service, the media service and the database refuse; private files are only ever served through short-lived links.",
    readiness: built,
  },
  {
    key: "bookings",
    label: "Session bookings",
    summary: "Clients and coaches suggest and agree session times.",
    audiences: "Clients and coaches.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "New requests and suggestions can be made.", highImpact: false },
      {
        mode: "read_only",
        kind: "normal",
        explanation: "No new requests or suggestions (including moving a session). Confirmed sessions and agreed weekly series go ahead; requests already waiting can be answered; anyone can still cancel.",
        highImpact: true,
      },
      TEST_ONLY("request or suggest sessions"),
    ],
    existingWork: "Confirmed sessions are never cancelled by this switch.",
    dependencies: [{ feature: "calls", why: "A new session is held as a call. Booking with calls unavailable would create sessions nobody can join." }],
    enforcement: "Calendar screens, the booking actions and the database refuse new requests.",
    readiness: built,
  },
  {
    key: "calls",
    label: "Video and audio calls",
    summary: "Private calls for booked sessions.",
    audiences: "Clients and coaches with a confirmed session.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "People on a confirmed session can join its call.", highImpact: false },
      {
        mode: "off",
        kind: "emergency",
        explanation: "Emergency: nobody can join a call, including for confirmed sessions, and any call in progress is closed. Sessions themselves are not cancelled.",
        highImpact: true,
      },
      TEST_ONLY("join calls"),
    ],
    existingWork: "Sessions stay booked. People affected should be contacted about rearranging.",
    dependencies: [],
    enforcement: "The join service and the database refuse passes; switching off closes open rooms through the normal closing job.",
    readiness: (ctx) => {
      const blockers: string[] = [];
      if (!ctx.dailyConfigured) blockers.push("The call service key (Daily) is not set on this deployment.");
      if (!ctx.callsFulfillmentReady) {
        blockers.push("A payment method must be added in the Daily dashboard before any call can run (this can't be checked from here). Packages with calls stay unsellable for real money until calls are marked ready.");
      }
      return { state: blockers.length ? "needs_setup" : "built", blockers };
    },
  },
  {
    key: "new_sales",
    label: "New purchases",
    summary: "Customers buy a coach's package.",
    audiences: "New and returning customers.",
    defaultMode: "on",
    modes: [
      {
        mode: "on",
        kind: "normal",
        explanation: "Whoever the launch rules allow can buy: today, protected testers in test mode only. Real money still needs every launch lock open.",
        highImpact: false,
      },
      {
        mode: "off",
        kind: "normal",
        explanation: "Nobody can start a purchase; visitors see the waitlist. Paid coaching, renewals and cancellations carry on untouched.",
        highImpact: true,
      },
      TEST_ONLY("start a purchase"),
    ],
    existingWork: "Existing coaching is never ended. A checkout already open on the payment page can still complete — that payment is real and is honoured.",
    dependencies: [{ feature: "public_profiles", why: "Buying starts from a coach's public profile." }],
    enforcement: "The checkout page, the checkout action and the database refuse new checkouts.",
    readiness: (ctx) => {
      const blockers: string[] = [];
      if (ctx.stripeMode === "unconfigured") blockers.push("Stripe is not configured on this deployment.");
      if (ctx.stripeMode !== "live") blockers.push("Live payments are off: only test purchases are possible.");
      for (const b of ctx.liveBlockers) blockers.push(b);
      return { state: blockers.length ? "needs_setup" : "built", blockers };
    },
  },
  {
    key: "public_profiles",
    label: "Public coach profiles",
    summary: "The Start coaching page and each coach's public profile.",
    audiences: "Everyone visiting the website.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Approved, published coaches are listed publicly.", highImpact: false },
      {
        mode: "off",
        kind: "normal",
        explanation: "Coach pages show a short \"back soon\" note with the waitlist. Coaches' profiles and publication settings are not changed.",
        highImpact: true,
      },
    ],
    existingWork: "No profile is unpublished or edited; switching back on shows them again.",
    dependencies: [],
    enforcement: "The public pages and the sitemap.",
    readiness: built,
  },
  {
    key: "waitlist",
    label: "Waitlist",
    summary: "Visitors register interest before buying is open.",
    audiences: "Website visitors.",
    defaultMode: "on",
    modes: [
      { mode: "on", kind: "normal", explanation: "Visitors can join; confirmation emails are sent.", highImpact: false },
      {
        mode: "off",
        kind: "normal",
        explanation: "No new sign-ups. Existing entries are kept, confirmation links still work, and anyone can still remove themselves.",
        highImpact: true,
      },
    ],
    existingWork: "Existing entries are kept. Leaving the waitlist always works.",
    dependencies: [],
    enforcement: "The waitlist page, its action and the database refuse new entries.",
    readiness: (ctx) =>
      ctx.resendConfigured
        ? built()
        : { state: "needs_setup", blockers: ["Email sending (Resend and a verified sender) is not configured, so confirmation emails can't go out."] },
  },
  {
    key: "coach_changing",
    label: "Changing coach",
    summary: "A client asks to move to another available coach; TalentYak confirms the move.",
    audiences: "Paying clients.",
    defaultMode: "off",
    modes: [
      {
        mode: "off",
        kind: "normal",
        explanation: "Clients don't see the option and new requests are refused. Requests already made are still decided through the normal workflow.",
        highImpact: false,
      },
      TEST_ONLY("request a coach change"),
      {
        mode: "on",
        kind: "normal",
        explanation: "Eligible clients can ask to move to a coach who is accepting clients; TalentYak confirms each move.",
        highImpact: true,
      },
    ],
    existingWork: "Current coaching continues unchanged until a move is confirmed. Open requests are never dropped when it is switched off.",
    dependencies: [],
    enforcement: "The client's screen, the request action and the database refuse new requests.",
    readiness: built,
  },
];

export const NOT_BUILT: { label: string; note: string }[] = [
  { label: "Exercise form review", note: "Per-set clips with coach feedback (AAF-PROG-08). Only a clip on a check-in exists today." },
  { label: "Coach directory search and comparison", note: "The public marketplace directory is deferred. The Start coaching page lists founding coaches only." },
  { label: "Messaging a coach before buying", note: "Not approved (TY-MSG-05). Pre-purchase questions go to support." },
  { label: "Automatic payouts", note: "Payouts are recorded by hand after money is sent; no transfer provider is connected." },
];

export function featureSpec(key: FeatureKey): FeatureSpec {
  return FEATURES.find((f) => f.key === key)!;
}

export function modeSpec(key: FeatureKey, mode: FeatureMode): ModeSpec | undefined {
  return featureSpec(key).modes.find((m) => m.mode === mode);
}

export function defaultModes(): FeatureModes {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.defaultMode])) as FeatureModes;
}

/** Features that list `key` as something they rely on. */
export function dependents(key: FeatureKey): FeatureSpec[] {
  return FEATURES.filter((f) => f.dependencies.some((d) => d.feature === key));
}

export interface ChangeCheck {
  errors: string[];
  warnings: string[];
  highImpact: boolean;
}

/**
 * Would this change leave a broken workflow, or ask for something the switch
 * can't do? Errors block the change; warnings are shown before confirming.
 */
export function checkChange(current: FeatureModes, key: FeatureKey, to: FeatureMode, readiness: Readiness, ctx: Pick<ReadinessContext, "unresolvedPrerequisites">): ChangeCheck {
  const spec = featureSpec(key);
  const errors: string[] = [];
  const warnings: string[] = [];
  const target = spec.modes.find((m) => m.mode === to);

  if (!target) errors.push(`${MODE_LABEL[to]} isn't a supported mode for ${spec.label.toLowerCase()}.`);
  if (current[key] === to) errors.push("It is already set that way.");
  if (readiness.state === "not_built" && to !== "off") errors.push(`${spec.label} isn't built, so it can't be switched on.`);
  for (const p of ctx.unresolvedPrerequisites) {
    if (p.feature === key && p.blocksMode === to) errors.push(`Needs a founder policy decision first: ${p.description}`);
  }

  const next = { ...current, [key]: to };
  // What this feature relies on must be at least as open as it will be.
  for (const dep of spec.dependencies) {
    if (OPENNESS[next[dep.feature]] < OPENNESS[to] && OPENNESS[to] >= OPENNESS.test_only) {
      errors.push(`${featureSpec(dep.feature).label} is ${MODE_LABEL[next[dep.feature]].toLowerCase()}. ${dep.why} Change ${featureSpec(dep.feature).label.toLowerCase()} first.`);
    }
  }
  // Anything relying on this feature must not become more open than it.
  for (const other of dependents(key)) {
    if (OPENNESS[next[other.key]] >= OPENNESS.test_only && OPENNESS[to] < OPENNESS[next[other.key]]) {
      const why = other.dependencies.find((d) => d.feature === key)!.why;
      errors.push(`${other.label} is ${MODE_LABEL[next[other.key]].toLowerCase()} and relies on this. ${why} Pause ${other.label.toLowerCase()} first.`);
    }
  }

  if (readiness.state === "needs_setup" && (to === "on" || to === "test_only")) {
    warnings.push(`Setup is incomplete, so it won't fully work yet: ${readiness.blockers[0]}`);
  }
  if (key === "waitlist" && to === "off" && next.new_sales !== "on") {
    warnings.push("New purchases aren't open either, so visitors will have no way to register interest. The site will point them to support instead.");
  }
  if (key === "public_profiles" && to === "off" && next.waitlist !== "on") {
    warnings.push("The waitlist is off too, so the coach pages will only show the support contact.");
  }

  return { errors, warnings, highImpact: Boolean(target?.highImpact) };
}

/**
 * What a person actually gets: the founder's setting, limited by readiness.
 * "test" means only listed test accounts can start new activity.
 */
export function effectiveAvailability(mode: FeatureMode, readiness: Readiness): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  if (readiness.state === "not_built") return { label: "Not built", tone: "neutral" };
  if (mode === "off") return { label: "Off", tone: "bad" };
  if (mode === "read_only") return { label: "Paused — existing work continues", tone: "warn" };
  if (readiness.state === "needs_setup") return { label: mode === "test_only" ? "Test accounts only, setup incomplete" : "On, but setup incomplete", tone: "warn" };
  if (mode === "test_only") return { label: "Test accounts only", tone: "warn" };
  return { label: "On", tone: "good" };
}

/** Is new activity allowed for this person under this mode? */
export function modeAllows(mode: FeatureMode, isTestAccount: boolean): boolean {
  return mode === "on" || (mode === "test_only" && isTestAccount);
}
