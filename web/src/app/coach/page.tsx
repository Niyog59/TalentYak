import Link from "next/link";
import { Suspense } from "react";
import { requireCoach, type ProviderSummary, type SessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { LiveRefresh, SectionFailed } from "@/components/dashboard/live";
import { RoleSwitch } from "@/components/dashboard/role-switch";
import { TaskQueue } from "@/components/dashboard/task-queue";
import { PROVIDER_STATUS_LABEL, PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { coachDashboard, type CoachClientRow, type CoachDashboard } from "@/lib/dashboard/coach";
import { ago, buildQueue, earningsByCurrency, isFilter, type Queue } from "@/lib/dashboard/tasks";
import { KIND_LABEL as PLAN_KIND_LABEL } from "@/lib/programmes/labels";
import { APPOINTMENT_STATE_LABEL, durationLabel } from "@/lib/scheduling/types";
import { clockTime } from "@/lib/calls/window";
import { setCapacityAction } from "./actions";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

type Coach = SessionContext & { provider: ProviderSummary };

const PAYOUT_STATE: Record<string, string> = {
  prepared: "Being prepared",
  submitted: "Being sent",
  paid: "Paid",
  failed: "Failed — will be retried",
  returned: "Returned",
  cancelled: "Cancelled",
};

export default async function CoachOverviewPage({ searchParams }: { searchParams: Promise<{ task?: string; q?: string }> }) {
  const [session, sp] = await Promise.all([requireCoach("/coach"), searchParams]);
  const { provider } = session;
  const supabase = (await createClient())!;
  // Someone who also buys coaching gets a switch to their own client dashboard.
  const { count: ownCoaching } = await supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("customer_id", session.userId);

  return (
    <div>
      <PageHeader title={`Hello, ${provider.display_name}`} actions={ownCoaching ? <RoleSwitch current="coach" /> : undefined}>
        <StatusPill tone={provider.status === "approved" ? "good" : provider.status === "suspended" ? "bad" : "neutral"}>
          {PROVIDER_STATUS_LABEL[provider.status] ?? provider.status}
        </StatusPill>
      </PageHeader>

      {provider.status === "submitted" || provider.status === "in_review" ? (
        <Notice>Your profile is being reviewed. You can keep preparing your plans while you wait; you can publish them once you&rsquo;re approved.</Notice>
      ) : null}

      <Suspense fallback={<Loading />}>
        <Dashboard session={session} filter={isFilter(sp.task) ? sp.task : "all"} q={(sp.q ?? "").slice(0, 60)} />
      </Suspense>
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="mt-8 rounded-2xl border border-line bg-surface p-6">
      <p role="status">Loading what needs your attention…</p>
    </div>
  );
}

async function Dashboard({ session, filter, q }: { session: Coach; filter: Parameters<typeof TaskQueue>[0]["filter"]; q: string }) {
  const d = await coachDashboard(session);
  const nowMs = Date.parse(d.now);
  const tz = session.provider.timezone;
  const queue = buildQueue(d.tasks, d.marks.ok ? d.marks.data : [], nowMs);
  const setup = await setupSteps(session);
  const setupDone = setup.every((s) => s.done);

  return (
    <>
      <LiveRefresh loadedAt={clockTime(d.now, tz)} />

      {d.away.ok && d.away.data?.away_until && Date.parse(d.away.data.away_until) > nowMs ? (
        <Notice>
          You&rsquo;re marked as away until {formatDate(d.away.data.away_until, tz)}. Clients are told when to expect a reply.{" "}
          <Link href="/coach/messages/availability" className="font-semibold text-brand underline underline-offset-4">Change</Link>
        </Notice>
      ) : null}

      {!setupDone ? <Setup steps={setup} /> : null}

      <section aria-labelledby="attention" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="attention" className="text-2xl font-semibold">Needs your attention</h2>
          {d.unreadMessages !== null ? (
            <Link href="/coach/messages" className="font-semibold text-brand underline underline-offset-4">
              {d.unreadMessages ? `${d.unreadMessages} unread message${d.unreadMessages === 1 ? "" : "s"}` : "Messages"}
            </Link>
          ) : null}
        </div>
        <p className="mt-1 text-ink-muted">Each item leaves this list when the work itself is done — not when you open it.</p>
        <div className="mt-4">
          <TaskQueue queue={queue} filter={filter} failed={d.failed} marksFailed={!d.marks.ok} nowMs={nowMs} tz={tz} />
        </div>
      </section>

      <Panel title="Today" id="today" description={`Your time zone: ${tz ?? "not set"}.`}>
        {!d.today.ok ? (
          <SectionFailed what="Today's sessions" />
        ) : d.today.data.length === 0 ? (
          <p className="text-ink-muted">No sessions today. <Link href="/coach/calendar" className="text-brand underline underline-offset-4">Calendar</Link></p>
        ) : (
          <ul className="divide-y divide-line">
            {d.today.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="tabular">{clockTime(a.starts_at, tz)}</span> · {a.otherName}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {durationLabel(Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000))} · {a.kind === "consultation" ? "one-off session" : "coaching"} · {APPOINTMENT_STATE_LABEL[a.state]}
                    {a.purpose ? ` · ${a.purpose}` : ""}
                  </p>
                </div>
                <Link
                  href={`/coach/calendar/appointments/${a.id}`}
                  className={`inline-flex min-h-11 items-center rounded-lg px-4 font-semibold ${a.joinable ? "bg-brand text-white hover:bg-brand-strong" : "border border-line-strong hover:border-ink"}`}
                >
                  {a.joinable ? "Join call" : "Details"}<span className="sr-only">: {a.otherName} at {clockTime(a.starts_at, tz)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Clients d={d} queue={queue} q={q} nowMs={nowMs} tz={tz} />

      <Panel title="Plans" id="plans" description="Clients waiting for a programme, drafts to finish, and updates you've scheduled.">
        {!d.plans.ok ? (
          <SectionFailed what="Your clients' plans" />
        ) : (
          <PlansSummary plans={d.plans.data} tz={tz} />
        )}
      </Panel>

      <Panel title="Recent activity" id="activity" description="What clients recorded in the last 7 days, one line each. Opening a client shows the detail.">
        {!d.clients.ok ? <SectionFailed what="Recent activity" /> : <RecentActivity clients={d.clients.data} />}
      </Panel>

      <Panel title="Clients and capacity" id="capacity">
        {!d.capacity.ok ? (
          <SectionFailed what="Your capacity" />
        ) : (
          <>
            <p>
              <strong>{d.capacity.data.commitments}</strong> current client{d.capacity.data.commitments === 1 ? "" : "s"}
              {d.capacity.data.held_checkouts ? <> · {d.capacity.data.held_checkouts} checkout{d.capacity.data.held_checkouts === 1 ? "" : "s"} in progress</> : null}
              {" · "}limit {d.capacity.data.max_active_clients ?? "none"}
              {d.capacity.data.capacity_ceiling ? <> · TalentYak has set a maximum of {d.capacity.data.capacity_ceiling} for now</> : null}
            </p>
            <p className="mt-1">
              <StatusPill tone={d.capacity.data.accepting_new_clients ? "good" : "neutral"}>
                {d.capacity.data.accepting_new_clients ? "Accepting new clients" : "Not accepting new clients"}
              </StatusPill>
            </p>
            <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
              <Link href="/coach/calendar#hours-heading" className="font-semibold text-brand underline underline-offset-4">Weekly hours</Link>
              <Link href="/coach/calendar#exceptions-heading" className="font-semibold text-brand underline underline-offset-4">Days off</Link>
              <Link href="/coach/messages/availability" className="font-semibold text-brand underline underline-offset-4">Away and reply times</Link>
            </p>
            <details className="mt-4">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Change your limit or availability for new clients</summary>
              <p className="mt-2 text-ink-muted">The limit can&rsquo;t go below the clients you already have.</p>
              <ActionForm action={setCapacityAction} className="mt-3 grid gap-4 sm:max-w-md">
                <TextField
                  name="max_active_clients"
                  label="Most clients at one time"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={500}
                  required={false}
                  defaultValue={d.capacity.data.max_active_clients ? String(d.capacity.data.max_active_clients) : ""}
                />
                <CheckboxField name="unlimited" label="No limit" defaultChecked={d.capacity.data.max_active_clients === null && !d.capacity.data.capacity_ceiling} />
                <CheckboxField
                  name="accepting"
                  label="Accepting new clients"
                  defaultChecked={d.capacity.data.accepting_new_clients}
                  help={session.provider.status !== "approved" ? "Available once you're approved." : undefined}
                />
                <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
              </ActionForm>
            </details>
          </>
        )}
      </Panel>

      <Panel
        title="Earnings"
        id="earnings"
        description="Each currency separately — amounts in different currencies are never added together. Pending means the coaching it pays for hasn't been delivered yet."
      >
        {!d.earnings.ok ? <SectionFailed what="Your earnings" /> : <Earnings data={d.earnings.data} tz={tz} />}
        <Link href="/coach/earnings" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
          Earnings, statements and every payout
        </Link>
      </Panel>

      {setupDone ? (
        <details className="mt-8">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Your setup (all done)</summary>
          <Setup steps={setup} />
        </details>
      ) : null}
    </>
  );
}

async function setupSteps(session: Coach) {
  const supabase = (await createClient())!;
  const { provider } = session;
  const [{ data: capacity }, { data: profile }, { data: offers }, { data: liveExpectations }, { count: hourWindows }] = await Promise.all([
    supabase.rpc("my_capacity_summary"),
    supabase.from("provider_public_profiles").select("display_name, bio, languages").eq("provider_id", provider.id).maybeSingle(),
    supabase.from("offers").select("id, status").eq("provider_id", provider.id),
    supabase.from("coach_expectation_versions").select("id").eq("provider_id", provider.id).not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
    supabase.from("availability_windows").select("id", { count: "exact", head: true }).eq("provider_id", provider.id),
  ]);
  const onSale = (offers ?? []).filter((o) => o.status === "published").length;
  return [
    { done: Boolean(profile?.bio && profile.bio.length >= 40 && profile.languages?.length && provider.timezone), label: "Complete your profile", href: "/coach/profile" },
    { done: !["onboarding", "invited"].includes(provider.status), label: "Submit your profile for review", href: "/coach/profile" },
    { done: provider.status === "approved", label: "Get approved", href: "/coach/profile" },
    { done: onSale > 0, label: "Publish a plan with your price", href: "/coach/plans" },
    { done: Boolean(liveExpectations), label: "Publish your welcome & expectations (needed before anyone can buy)", href: "/coach/expectations" },
    { done: (hourWindows ?? 0) > 0, label: "Set the hours clients can book you", href: "/coach/calendar#hours-heading" },
    { done: Boolean(provider.published_at), label: "Make your profile public", href: "/coach/profile" },
    { done: Boolean((capacity as { accepting_new_clients?: boolean } | null)?.accepting_new_clients), label: "Open for new clients", href: "#capacity-heading" },
  ];
}

function Setup({ steps }: { steps: { done: boolean; label: string; href: string }[] }) {
  return (
    <Panel title="Getting set up" id="setup">
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${s.done ? "border-brand bg-brand text-white" : "border-line-strong"}`}>
              {s.done ? "✓" : i + 1}
            </span>
            <Link href={s.href} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{s.label}</Link>
            <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function coachingStatus(c: CoachClientRow): { text: string; tone: "good" | "neutral" | "bad" } {
  if (c.enrollmentState === "paused") return { text: "Paused — payment", tone: "neutral" };
  if (c.purchaseState === "cancelling") return { text: "Ends at the end of the paid period", tone: "neutral" };
  if (c.purchaseState === "past_due") return { text: "Payment being retried", tone: "neutral" };
  if (c.enrollmentState === "active") return { text: "Active", tone: "good" };
  return { text: PURCHASE_STATE_LABEL[c.purchaseState] ?? c.purchaseState, tone: "neutral" };
}

function lastActivity(c: CoachClientRow, nowMs: number): string {
  const a = c.activity;
  if (!a) return "Activity couldn't be loaded";
  if (!a.recordsVisible) return c.enrollmentState === "paused" ? "Records are hidden while coaching is paused" : "Records aren't shown to you right now";
  const items: [string | null, string][] = [
    [a.lastWorkoutOn, "Logged a workout"],
    [a.lastCheckinAt, "Sent a check-in"],
    [a.lastMessageAt, "Sent you a message"],
    [a.lastBodyOn, "Recorded weight or measurements"],
    [a.lastFoodOn, "Food diary"],
  ];
  const latest = items
    .filter((x): x is [string, string] => Boolean(x[0]))
    .map(([at, what]) => ({ what, at, ms: Date.parse(at.length === 10 ? `${at}T12:00:00Z` : at) }))
    .sort((x, y) => y.ms - x.ms)[0];
  // No activity is a fact, never a label about the client.
  return latest ? `${latest.what} ${ago(latest.at, nowMs)}` : `Nothing recorded since ${formatDate(c.assignedFrom, null)}`;
}

function Clients({ d, queue, q, nowMs, tz }: { d: CoachDashboard; queue: Queue; q: string; nowMs: number; tz: string | null }) {
  return (
    <Panel title="Clients" id="clients" description="Current clients. Last activity is what they recorded, as a fact — not a judgement.">
      <form method="get" action="/coach#clients-heading" role="search" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 font-semibold">
          Find a client
          <input name="q" type="search" defaultValue={q} maxLength={60} className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg border border-line-strong px-4 font-semibold hover:border-ink">Search</button>
        {q ? <Link href="/coach#clients-heading" className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Clear</Link> : null}
      </form>
      {!d.clients.ok ? (
        <div className="mt-4"><SectionFailed what="Your client list" /></div>
      ) : d.clients.data.length === 0 ? (
        <p className="mt-4 text-ink-muted">No clients yet. When someone signs up to one of your plans and their payment goes through, they appear here.</p>
      ) : (
        (() => {
          const list = d.clients.data.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
          if (!list.length) return <p className="mt-4 text-ink-muted">No current client matches &ldquo;{q}&rdquo;.</p>;
          return (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {list.map((c) => {
                const status = coachingStatus(c);
                const next = queue.open.find((t) => t.enrollmentId === c.enrollmentId);
                return (
                  <li key={c.enrollmentId} className="grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold">{c.name}</span>
                        <StatusPill tone={status.tone}>{status.text}</StatusPill>
                      </p>
                      <p className="text-sm text-ink-muted">
                        {c.offerTitle} · with you since {formatDate(c.assignedFrom, tz)}
                        {c.paidThrough ? ` · paid until ${formatDate(c.paidThrough, tz)}` : ""}
                      </p>
                      <p className="text-sm">{lastActivity(c, nowMs)}</p>
                      <p className="text-sm">
                        <span className="font-semibold">Next: </span>
                        {next ? <Link href={next.href} className="text-brand underline underline-offset-4">{next.title}</Link> : <span className="text-ink-muted">{d.failed.length ? "not everything could be checked — see above" : "nothing waiting"}</span>}
                      </p>
                    </div>
                    <nav aria-label={`${c.name}: open`} className="flex flex-wrap gap-x-4 text-sm font-semibold">
                      <Link href={`/coach/programmes/clients/${c.enrollmentId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Plans</Link>
                      <Link href={`/coach/programmes/clients/${c.enrollmentId}/progress`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Progress</Link>
                      <Link href={`/coach/check-ins/clients/${c.enrollmentId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Check-ins</Link>
                      {c.conversationId ? <Link href={`/coach/messages/${c.conversationId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Messages</Link> : null}
                    </nav>
                  </li>
                );
              })}
            </ul>
          );
        })()
      )}
    </Panel>
  );
}

function PlansSummary({ plans, tz }: { plans: NonNullable<Extract<CoachDashboard["plans"], { ok: true }>["data"]>; tz: string | null }) {
  const awaiting = plans.filter((p) => p.awaitingWorkout);
  const drafts = plans.filter((p) => p.drafts.length);
  const scheduled = plans.flatMap((p) => p.scheduled.map((s) => ({ ...s, p })));
  if (!awaiting.length && !drafts.length && !scheduled.length) return <p className="text-ink-muted">Every current client has a published workout plan, and nothing is drafted or scheduled.</p>;
  return (
    <div className="grid gap-5 md:grid-cols-3">
      <div>
        <h3 className="font-semibold">Waiting for a workout plan</h3>
        {awaiting.length ? (
          <ul className="mt-1 space-y-1">
            {awaiting.map((p) => <li key={p.enrollmentId}><Link href={`/coach/programmes/clients/${p.enrollmentId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">{p.name}</Link></li>)}
          </ul>
        ) : <p className="mt-1 text-ink-muted">None.</p>}
      </div>
      <div>
        <h3 className="font-semibold">Drafts to finish</h3>
        {drafts.length ? (
          <ul className="mt-1 space-y-1">
            {drafts.flatMap((p) => p.drafts.map((dr) => (
              <li key={`${p.enrollmentId}-${dr.kind}`}>
                <Link href={`/coach/programmes/clients/${p.enrollmentId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">{p.name}: {PLAN_KIND_LABEL[dr.kind as "workout" | "nutrition"]?.toLowerCase() ?? dr.kind}</Link>
                <span className="text-sm text-ink-muted"> · edited {formatDate(dr.updatedAt, tz)}</span>
              </li>
            )))}
          </ul>
        ) : <p className="mt-1 text-ink-muted">None.</p>}
      </div>
      <div>
        <h3 className="font-semibold">Scheduled updates</h3>
        {scheduled.length ? (
          <ul className="mt-1 space-y-1">
            {scheduled.map((s) => (
              <li key={`${s.p.enrollmentId}-${s.kind}-${s.version}`}>
                <Link href={`/coach/programmes/clients/${s.p.enrollmentId}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">{s.p.name}</Link>
                <span className="text-sm text-ink-muted"> · {PLAN_KIND_LABEL[s.kind as "workout" | "nutrition"]?.toLowerCase() ?? s.kind} version {s.version} from {formatDate(s.from, tz)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-ink-muted">None.</p>}
      </div>
    </div>
  );
}

function RecentActivity({ clients }: { clients: CoachClientRow[] }) {
  const lines = clients
    .filter((c) => c.activity?.recordsVisible)
    .map((c) => {
      const a = c.activity!;
      const parts = [
        a.workouts ? `${a.workouts} workout${a.workouts === 1 ? "" : "s"} logged` : null,
        a.checkins ? `${a.checkins === 1 ? "a check-in" : `${a.checkins} check-in versions`} sent` : null,
        a.body ? "weight or measurements recorded" : null,
        a.foodDays ? `food diary on ${a.foodDays} day${a.foodDays === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      return { c, parts };
    })
    .filter((l) => l.parts.length)
    .slice(0, 8);
  const hidden = clients.filter((c) => c.activity && !c.activity.recordsVisible).length;
  return (
    <>
      {lines.length ? (
        <ul className="divide-y divide-line">
          {lines.map(({ c, parts }) => (
            <li key={c.enrollmentId} className="py-2.5">
              <Link href={`/coach/programmes/clients/${c.enrollmentId}/progress`} className="font-semibold text-brand underline underline-offset-4">{c.label}</Link>
              <span className="text-ink-muted"> · {parts.join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">Nothing recorded by your clients in the last 7 days.</p>
      )}
      {hidden ? <p className="mt-2 text-sm text-ink-muted">{hidden} client{hidden === 1 ? "'s" : "s'"} records aren&rsquo;t shown to you right now, so they&rsquo;re not counted here.</p> : null}
    </>
  );
}

function Earnings({ data, tz }: { data: NonNullable<Extract<CoachDashboard["earnings"], { ok: true }>["data"]>; tz: string | null }) {
  const byCurrency = earningsByCurrency(data.balances);
  return (
    <>
      {byCurrency.length === 0 ? (
        <p className="text-ink-muted">No earnings yet. They appear here when a client pays.</p>
      ) : (
        <ul className="divide-y divide-line">
          {byCurrency.map((b) => (
            <li key={b.currency} className="py-3">
              <p className="font-semibold">{b.currency}</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-ink-muted">Pending</dt><dd className="tabular">{formatMinor(b.pending, b.currency)}</dd></div>
                <div><dt className="text-ink-muted">Earned, not yet paid</dt><dd className="tabular font-semibold">{formatMinor(b.earnedUnpaid, b.currency)}</dd></div>
                <div><dt className="text-ink-muted">Paid to you</dt><dd className="tabular">{formatMinor(b.paid, b.currency)}</dd></div>
                {b.held ? <div><dt className="text-ink-muted">Held (card dispute)</dt><dd className="tabular">{formatMinor(b.held, b.currency)}</dd></div> : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {data.payouts.length ? (
        <>
          <h3 className="mt-5 font-semibold">Latest payouts</h3>
          <ul className="mt-1 divide-y divide-line text-sm">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="tabular">{formatMinor(p.amount_minor, p.currency)}</span>
                {/* A paid date only when a transfer was recorded as sent. */}
                <span className="text-ink-muted">{PAYOUT_STATE[p.state] ?? p.state}{p.paid_at ? ` · ${formatDate(p.paid_at, tz)}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
