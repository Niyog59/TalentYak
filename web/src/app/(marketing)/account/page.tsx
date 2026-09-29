import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireOnboarded, type SessionContext } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { Button, ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InstallHelp } from "@/components/pwa/install-help";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextArea } from "@/components/form/fields";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { CoachChangePanel } from "@/components/coach-change/request-panel";
import { featureAllowsMe } from "@/lib/features/server";
import { SignOutForm } from "@/components/tracking/sign-out-form";
import { LiveRefresh } from "@/components/dashboard/live";
import { RoleSwitch } from "@/components/dashboard/role-switch";
import { EarlierCoaching, GettingStarted, OneOffSessions, RelationshipCard, SupportBlock, TodayWorkouts, TodoList, Updates } from "@/components/dashboard/client-home";
import { clientDashboard } from "@/lib/dashboard/client";
import { clockTime } from "@/lib/calls/window";

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
        <h1 className="font-display text-5xl">Your account</h1>
        <p className="mt-4 text-lg text-ink-muted">Accounts aren&rsquo;t available in this environment.</p>
        <InstallHelp className="mt-10" />
      </div>
    );
  }

  const session = await requireOnboarded("/account");
  const { profile } = session;
  const tz = profile.timezone;
  const isCoach = Boolean(session.provider && session.provider.status !== "retired");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-ink-muted">{profile.preferred_name || profile.full_name || session.email}</p>
          <h1 className="font-display text-4xl sm:text-5xl">Today</h1>
          <p className="mt-1 text-ink-muted">
            {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz ?? "UTC" }).format(new Date())} · times in your time zone ({tz ?? "UTC"})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isCoach ? <RoleSwitch current="client" /> : null}
          <SignOutForm>
            <Button variant="secondary" size="sm" type="submit" className="min-h-11">Log out</Button>
          </SignOutForm>
        </div>
      </div>

      {(await searchParams).notice === "password_updated" ? (
        <p role="status" className="mt-6 rounded-lg border border-line bg-brand-tint p-3 font-medium">
          Your new password is saved. Use it next time you sign in.
        </p>
      ) : null}

      <Suspense fallback={<p role="status" aria-busy="true" className="mt-8 rounded-2xl border border-line bg-surface p-6">Loading your day…</p>}>
        <ClientHome session={session} />
      </Suspense>

      <Suspense fallback={null}>
        <ManageCoaching session={session} isCoach={isCoach} />
      </Suspense>

      <InstallHelp className="mt-12" />
    </div>
  );
}

async function ClientHome({ session }: { session: SessionContext }) {
  const tz = session.profile.timezone;
  const d = await clientDashboard(session);
  const nowMs = Date.parse(d.now);
  const unreadMessages = d.messages.ok ? d.messages.data.reduce((n, c) => n + c.unread, 0) : null;
  const hasCoaching = d.current.length + d.ended.length + d.pending.length > 0;
  const inbox = (
    <nav aria-label="Inbox" className="mt-6 flex flex-wrap gap-3">
      <ButtonLink href="/account/messages" variant="secondary" size="sm" className="min-h-11">
        Messages{unreadMessages ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-sm text-white">{unreadMessages}<span className="sr-only"> unread</span></span> : null}
      </ButtonLink>
      <ButtonLink href="/account/notifications" variant="secondary" size="sm" className="min-h-11">
        Notifications{d.unreadNotifications ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-sm text-white">{d.unreadNotifications}<span className="sr-only"> unread</span></span> : null}
      </ButtonLink>
      <ButtonLink href="/account/appointments" variant="secondary" size="sm" className="min-h-11">Sessions</ButtonLink>
    </nav>
  );
  return (
    <>
      <LiveRefresh loadedAt={clockTime(d.now, tz)} />
      {hasCoaching ? (
        <>
          <TodayWorkouts d={d} />
          {inbox}
          {d.current.length ? <TodoList d={d} nowMs={nowMs} tz={tz} /> : null}
          <GettingStarted d={d} />
          {d.current.map((r) => <RelationshipCard key={r.e.id} r={r} d={d} tz={tz} />)}
          <OneOffSessions d={d} tz={tz} />
          <Updates d={d} tz={tz} />
          <EarlierCoaching d={d} />
        </>
      ) : (
        <>
          <EmptyState
            className="mt-8"
            headingLevel="h2"
            icon="coaches"
            title="No coaching yet"
            actions={
              <>
                <ButtonLink href="/coaches">Find a coach</ButtonLink>
                <ButtonLink href="/account/training-profile" variant="secondary">Tell coaches about your training</ButtonLink>
              </>
            }
          >
            When you start coaching, today&rsquo;s workout, your sessions, check-ins and messages from your coach appear here.
          </EmptyState>
          {inbox}
          <OneOffSessions d={d} tz={tz} />
        </>
      )}
      {hasCoaching ? <SupportBlock /> : null}
    </>
  );
}

/** The coaching you've bought: billing state, and asking to change coach. */
async function ManageCoaching({ session, isCoach }: { session: SessionContext; isCoach: boolean }) {
  const { profile } = session;
  const tz = profile.timezone;
  const supabase = (await createClient())!;

  const [{ data: purchases }, { data: enrollments }, { data: requests }, { data: bookings }] =
    await Promise.all([
      supabase
        .from("purchases")
        .select("id, state, service_type, charge_currency, charge_amount_minor, paid_through_at, created_at, inclusions_snapshot, provider_id")
        .eq("customer_id", session.userId)
        .neq("state", "pending_payment")
        .order("created_at", { ascending: false }),
      supabase.from("enrollments").select("id, purchase_id, state, provider_id").eq("customer_id", session.userId),
      supabase.from("coach_change_requests").select("id, enrollment_id, state, created_at, consented_history_scope, preferred_provider_id").eq("customer_id", session.userId).eq("state", "requested"),
      supabase.from("bookings").select("id, status, created_at, services(name)").eq("customer_id", session.userId).order("created_at", { ascending: false }),
    ]);

  const coachChangeAllowed = await featureAllowsMe("coach_changing");
  // A customer can read the profile of any coach they bought from, even one who
  // is no longer public (migration 0025).
  const providerIds = [...new Set([...(purchases ?? []).map((p) => p.provider_id), ...(enrollments ?? []).map((e) => e.provider_id), ...(requests ?? []).map((r) => r.preferred_provider_id).filter(Boolean)])];
  const { data: coaches } = providerIds.length
    ? await supabase.from("provider_public_profiles").select("provider_id, display_name").in("provider_id", providerIds)
    : { data: [] };
  // The coach delivering it now: after a coach change that is not the coach the plan was bought from.
  const coachName = (p: { id: string; provider_id: string }) => {
    const current = (enrollments ?? []).find((e) => e.purchase_id === p.id)?.provider_id ?? p.provider_id;
    return coaches?.find((c) => c.provider_id === current)?.display_name ?? "Your coach";
  };

  return (
    <>
      {/* Nothing bought yet: the welcome above already says how to start. */}
      <section aria-labelledby="plans-heading" className="mt-12" hidden={(purchases ?? []).length === 0}>
        <h2 id="plans-heading" className="text-2xl font-semibold">Your coaching and billing</h2>
        {(purchases ?? []).length === 0 ? null : (
          <ul className="mt-5 space-y-4">
            {(purchases ?? []).map((p) => {
              const enrollment = (enrollments ?? []).find((e) => e.purchase_id === p.id);
              const openRequest = enrollment ? (requests ?? []).find((r) => r.enrollment_id === enrollment.id) ?? null : null;
              const title = (p.inclusions_snapshot as { title?: string })?.title ?? "Plan";
              return (
                <li key={p.id} className="rounded-xl border border-line bg-surface p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-lg font-semibold">{title}</p>
                    <span className="rounded-full bg-paper-raised px-3 py-1 text-sm font-semibold">{PURCHASE_STATE_LABEL[p.state] ?? p.state}</span>
                  </div>
                  <p className="text-ink-muted">
                    with {coachName(p)} · {formatMinor(p.charge_amount_minor, p.charge_currency)}
                    {p.service_type === "recurring_coaching" ? " a month" : ""}
                  </p>
                  {p.paid_through_at ? <p className="mt-1 text-sm">Paid until {formatDate(p.paid_through_at, tz)}</p> : null}
                  {enrollment ? (
                    <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                      <Link href={`/account/plan/${enrollment.id}`} className="text-brand underline underline-offset-4">Workout &amp; nutrition plan</Link>
                      <Link href={`/account/expectations/${enrollment.id}`} className="text-brand underline underline-offset-4">Welcome &amp; expectations</Link>
                    </p>
                  ) : null}
                  {p.state === "past_due" ? (
                    <p role="alert" className="mt-2 font-medium">
                      {/* Founder-approved wording (payment_failure.v2). Before the paid
                          period runs out coaching continues; after it, new coaching is
                          paused until this is fixed — the words are the same either way. */}
                      {PAUSED_FOR_PAYMENT_NOTICE}{" "}
                      <Link href="/account/billing" className="underline">Update your card</Link>
                      {enrollment?.state === "paused" ? "." : ` to keep your coaching${p.paid_through_at ? ` past ${formatDate(p.paid_through_at, tz)}` : ""}.`}
                    </p>
                  ) : null}
                  {enrollment && ["active", "paused"].includes(enrollment.state) ? (
                    <CoachChangePanel
                      enrollmentId={enrollment.id}
                      allowed={coachChangeAllowed}
                      timeZone={tz}
                      open={openRequest ? {
                        id: openRequest.id,
                        created_at: openRequest.created_at,
                        consented_history_scope: openRequest.consented_history_scope,
                        preferred_name: coaches?.find((c) => c.provider_id === openRequest.preferred_provider_id)?.display_name ?? (openRequest.preferred_provider_id ? "the coach you chose" : null),
                      } : null}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(bookings ?? []).length > 0 ? (
        <section aria-labelledby="bookings-heading" className="mt-12">
          <h2 id="bookings-heading" className="text-2xl font-semibold">Earlier bookings</h2>
          <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface">
            {(bookings ?? []).map((b) => {
              const service = (Array.isArray(b.services) ? b.services[0] : b.services) as { name: string } | null;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
                  <div>
                    <p className="font-semibold">{service?.name ?? "Service"}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">Booked {formatDate(b.created_at, tz)}</p>
                  </div>
                  <span className="rounded-full bg-paper-raised px-3 py-1 text-sm font-semibold capitalize">{b.status}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <nav aria-label="Account" className="mt-12 flex flex-wrap gap-3">
        <ButtonLink href="/account/plan" variant="secondary" size="sm" className="min-h-11">Your plan</ButtonLink>
        <ButtonLink href="/account/progress" variant="secondary" size="sm" className="min-h-11">Progress &amp; logs</ButtonLink>
        <ButtonLink href="/account/media" variant="secondary" size="sm" className="min-h-11">Photos and clips</ButtonLink>
        <ButtonLink href="/account/training-profile" variant="secondary" size="sm" className="min-h-11">Training &amp; food profile</ButtonLink>
        <ButtonLink href="/account/billing" variant="secondary" size="sm" className="min-h-11">Billing</ButtonLink>
        <ButtonLink href="/account/security" variant="secondary" size="sm" className="min-h-11">Sign-in security</ButtonLink>
        <ButtonLink href="/account/support" variant="secondary" size="sm" className="min-h-11">Report a problem</ButtonLink>
        {isCoach ? <ButtonLink href="/coach" variant="secondary" size="sm" className="min-h-11">Coach area</ButtonLink> : null}
        {profile.role === "admin" ? <ButtonLink href="/admin" variant="secondary" size="sm" className="min-h-11">Founder console</ButtonLink> : null}
      </nav>
    </>
  );
}
