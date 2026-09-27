import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppointmentList, ProposalList } from "@/components/scheduling/schedule-lists";
import { ProposeForm } from "@/components/scheduling/propose-form";
import { SlotRequestForm } from "@/components/scheduling/slot-picker";
import { coachScheduleSettings, freeSlots, loadSchedule } from "@/lib/scheduling/server";
import { durationLabel } from "@/lib/scheduling/types";

export const metadata: Metadata = { title: "Your sessions", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CustomerAppointmentsPage({ searchParams }: { searchParams: Promise<{ duration?: string }> }) {
  const { duration: wanted } = await searchParams;
  const session = await requireOnboarded("/account/appointments");
  const tz = session.profile.timezone ?? "UTC";
  const supabase = (await createClient())!;

  const [schedule, { data: enrollments }, { data: consultations }] = await Promise.all([
    loadSchedule("customer", { userId: session.userId }),
    supabase.from("enrollments").select("id, provider_id, state").eq("customer_id", session.userId).in("state", ["active", "paused"]),
    supabase.from("purchases").select("id, provider_id, state, inclusions_snapshot, requires_review, review_reason")
      .eq("customer_id", session.userId).eq("service_type", "one_off_consultation").in("state", ["active", "ended"]),
  ]);

  // Coach names and zones for relationships this person can already see.
  const providerIds = [...new Set([...(enrollments ?? []).map((e) => e.provider_id), ...(consultations ?? []).map((c) => c.provider_id)])];
  const admin = createAdminClient();
  const { data: coaches } = admin && providerIds.length
    ? await admin.from("providers").select("id, display_name, timezone").in("id", providerIds)
    : { data: [] as { id: string; display_name: string; timezone: string | null }[] };
  const coach = (id: string) => (coaches ?? []).find((c) => c.id === id);

  const live = new Set(schedule.upcoming.map((a) => a.purchase_id).filter(Boolean));
  const rebook = (consultations ?? []).filter((c) => c.state === "active" && !live.has(c.id));
  const waiting = (consultations ?? []).filter((c) => c.requires_review && c.review_reason === "consultation_slot_expired");

  const settingsByProvider = new Map(await Promise.all(providerIds.map(async (id) => [id, await coachScheduleSettings(id)] as const)));
  const incoming = schedule.proposals.filter((p) => p.state === "pending" && p.proposed_by !== session.userId);
  const mine = schedule.proposals.filter((p) => p.state === "pending" && p.proposed_by === session.userId);
  const recent = schedule.proposals.filter((p) => p.state !== "pending" && p.proposed_by === session.userId);
  const durationsFor = (p: { provider_id: string; kind: string; duration_minutes: number }) => ({
    durations: settingsByProvider.get(p.provider_id)?.durations_minutes ?? [p.duration_minutes],
    fixed: p.kind === "consultation" ? p.duration_minutes : null,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <Link href="/account" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">← Your account</Link>
      <h1 className="mt-4 font-display text-4xl">Your sessions</h1>
      <p className="mt-2 text-ink-muted">Times are shown in your time zone ({tz}). Change it in your account settings.</p>

      <section className="mt-10" aria-labelledby="answer-heading">
        <h2 id="answer-heading" className="text-2xl font-semibold">Waiting for your answer</h2>
        <div className="mt-4">
          <ProposalList proposals={incoming} viewerId={session.userId} viewerTz={tz} durationsFor={durationsFor} empty="Nothing to answer." />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="text-2xl font-semibold">Upcoming</h2>
        <div className="mt-4">
          <AppointmentList appointments={schedule.upcoming} viewerTz={tz} hrefFor={(a) => `/account/appointments/${a.id}`} empty="No sessions booked." />
        </div>
      </section>

      {waiting.length ? (
        <section className="mt-10 rounded-2xl border border-line-strong bg-paper-raised p-5" aria-labelledby="waiting-heading">
          <h2 id="waiting-heading" className="text-xl font-semibold">A payment arrived after your held time was released</h2>
          <p className="mt-2">Nothing is lost. TalentYak will help you choose a new time or refund you. You don&rsquo;t need to do anything yet.</p>
        </section>
      ) : null}

      {rebook.map((c) => {
        const who = coach(c.provider_id);
        const minutes = Number((c.inclusions_snapshot as { call_duration_minutes?: number })?.call_duration_minutes) || 30;
        return (
          <section key={c.id} className="mt-10 rounded-2xl border border-line bg-surface p-5" aria-label={`Book your session with ${who?.display_name ?? "your coach"}`}>
            <h2 className="text-xl font-semibold">Choose a time for your session with {who?.display_name ?? "your coach"}</h2>
            <p className="text-sm text-ink-muted">{durationLabel(minutes)} · one-off session · {who?.display_name ?? "Your coach"} confirms the time</p>
            <div className="mt-4">
              <ConsultSlots providerId={c.provider_id} purchaseId={c.id} minutes={minutes} tz={tz} coachTz={who?.timezone ?? tz} />
            </div>
          </section>
        );
      })}

      {(enrollments ?? []).filter((e) => e.state === "active").map((e) => {
        const who = coach(e.provider_id);
        const s = settingsByProvider.get(e.provider_id);
        const durations = s?.durations_minutes ?? [60];
        const duration = durations.includes(Number(wanted)) ? Number(wanted) : durations.includes(60) ? 60 : durations[0];
        return (
          <section key={e.id} className="mt-10 rounded-2xl border border-line bg-surface p-5" aria-label={`Book a time with ${who?.display_name ?? "your coach"}`}>
            <h2 className="text-xl font-semibold">Book a time with {who?.display_name ?? "your coach"}</h2>
            <p className="text-sm text-ink-muted">
              Choose a free time and {who?.display_name ?? "your coach"} confirms it{s?.auto_confirm_client_requests ? " (usually straight away)" : ""}. There&rsquo;s no limit on how often you meet unless your plan says so.
            </p>
            <form className="mt-3 flex flex-wrap items-end gap-2" method="get">
              <label className="grid gap-1 font-semibold">
                Length
                <select name="duration" defaultValue={String(duration)} className="min-h-11 rounded-[3px] border border-line bg-white/60 px-3">
                  {durations.map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
                </select>
              </label>
              <button type="submit" className="min-h-11 rounded-lg border border-line-strong px-4 font-semibold">Show times</button>
            </form>
            <div className="mt-4">
              <CoachingSlots providerId={e.provider_id} enrollmentId={e.id} duration={duration} tz={tz} coachTz={who?.timezone ?? tz} />
            </div>
            <details className="mt-4">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Suggest a different time</summary>
              <div className="mt-3">
                <ProposeForm enrollmentId={e.id} durations={durations} viewerTz={tz} otherTz={who?.timezone} otherLabel={who?.display_name ?? "Your coach"} />
              </div>
            </details>
          </section>
        );
      })}

      {(enrollments ?? []).some((e) => e.state === "paused") ? (
        <p className="mt-10 rounded-lg border border-line-strong bg-paper-raised p-4">
          Coaching is paused until the payment is sorted, so new sessions can&rsquo;t be booked. Sessions already booked are on hold and come back when the payment goes through.{" "}
          <Link href="/account/billing" className="underline">Billing</Link>
        </p>
      ) : null}

      <section className="mt-10" aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="text-2xl font-semibold">Your suggestions</h2>
        <div className="mt-4">
          <ProposalList proposals={[...mine, ...recent]} viewerId={session.userId} viewerTz={tz} durationsFor={durationsFor} empty="None waiting." />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="past-heading">
        <h2 id="past-heading" className="text-2xl font-semibold">Past</h2>
        <div className="mt-4">
          <AppointmentList appointments={schedule.past} viewerTz={tz} hrefFor={(a) => `/account/appointments/${a.id}`} empty="No past sessions." />
        </div>
      </section>
    </div>
  );
}

async function CoachingSlots({ providerId, enrollmentId, duration, tz, coachTz }: { providerId: string; enrollmentId: string; duration: number; tz: string; coachTz: string }) {
  const slots = await freeSlots(providerId, duration);
  return <SlotRequestForm slots={slots} viewerTz={tz} coachTz={coachTz} duration={duration} enrollmentId={enrollmentId} />;
}

async function ConsultSlots({ providerId, purchaseId, minutes, tz, coachTz }: { providerId: string; purchaseId: string; minutes: number; tz: string; coachTz: string }) {
  const slots = await freeSlots(providerId, minutes);
  return <SlotRequestForm slots={slots} viewerTz={tz} coachTz={coachTz} duration={minutes} kind="consultation" purchaseId={purchaseId} />;
}
