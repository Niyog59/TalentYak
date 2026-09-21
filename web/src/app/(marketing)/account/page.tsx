import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { Button, ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InstallHelp } from "@/components/pwa/install-help";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextArea } from "@/components/form/fields";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { requestCoachChangeAction } from "./customer-actions";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
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
  const supabase = (await createClient())!;

  const [{ data: purchases }, { data: enrollments }, { data: requests }, { data: bookings }, { count: unread }] =
    await Promise.all([
      supabase
        .from("purchases")
        .select("id, state, service_type, charge_currency, charge_amount_minor, paid_through_at, created_at, inclusions_snapshot, provider_id")
        .eq("customer_id", session.userId)
        .neq("state", "pending_payment")
        .order("created_at", { ascending: false }),
      supabase.from("enrollments").select("id, purchase_id, state").eq("customer_id", session.userId),
      supabase.from("coach_change_requests").select("enrollment_id, state, created_at").eq("customer_id", session.userId).eq("state", "requested"),
      supabase.from("bookings").select("id, status, created_at, services(name)").eq("customer_id", session.userId).order("created_at", { ascending: false }),
      // Row-level security scopes this to the signed-in person.
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);

  // A customer can read the profile of any coach they bought from, even one who
  // is no longer public (migration 0025).
  const providerIds = [...new Set((purchases ?? []).map((p) => p.provider_id))];
  const { data: coaches } = providerIds.length
    ? await supabase.from("provider_public_profiles").select("provider_id, display_name").in("provider_id", providerIds)
    : { data: [] };
  const coachName = (p: { provider_id: string }) => coaches?.find((c) => c.provider_id === p.provider_id)?.display_name ?? "Your coach";

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-4xl sm:text-5xl">{profile.preferred_name || profile.full_name || "Your account"}</h1>
          <p className="mt-2 break-all text-ink-muted">{session.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="secondary" type="submit">Log out</Button>
        </form>
      </div>

      <nav aria-label="Account" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/account/notifications" variant="secondary" size="sm">
          Notifications{unread ? <span className="ml-1.5 rounded-full bg-brand px-1.5 text-sm text-white">{unread}</span> : null}
        </ButtonLink>
        <ButtonLink href="/account/media" variant="secondary" size="sm">Photos and clips</ButtonLink>
        <ButtonLink href="/account/billing" variant="secondary" size="sm">Billing</ButtonLink>
        <ButtonLink href="/account/security" variant="secondary" size="sm">Sign-in security</ButtonLink>
        {session.provider ? <ButtonLink href="/coach" variant="secondary" size="sm">Coach area</ButtonLink> : null}
        {profile.role === "admin" ? <ButtonLink href="/admin" variant="secondary" size="sm">Founder console</ButtonLink> : null}
      </nav>

      <section aria-labelledby="plans-heading" className="mt-12">
        <h2 id="plans-heading" className="text-2xl font-semibold">Your coaching</h2>
        {(purchases ?? []).length === 0 ? (
          <EmptyState className="mt-5" headingLevel="h3" icon="coaches" title="No plans yet" actions={<ButtonLink href="/coaches">Find a coach</ButtonLink>}>
            When you sign up with a coach, your plan appears here.
          </EmptyState>
        ) : (
          <ul className="mt-5 space-y-4">
            {(purchases ?? []).map((p) => {
              const enrollment = (enrollments ?? []).find((e) => e.purchase_id === p.id);
              const openRequest = enrollment && (requests ?? []).some((r) => r.enrollment_id === enrollment.id);
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
                  {p.state === "past_due" ? (
                    <p role="alert" className="mt-2 font-medium">
                      Your last payment didn&rsquo;t go through. <Link href="/account/billing" className="underline">Update your card</Link> to keep your coaching.
                    </p>
                  ) : null}
                  {enrollment && ["active", "paused"].includes(enrollment.state) ? (
                    openRequest ? (
                      <p className="mt-3 text-sm">You&rsquo;ve asked to change coach. TalentYak will be in touch.</p>
                    ) : (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-brand underline">Ask to change coach</summary>
                        <ActionForm action={requestCoachChangeAction} className="mt-3 grid gap-3">
                          <input type="hidden" name="enrollment_id" value={enrollment.id} />
                          <TextArea name="reason" label="What isn't working?" required rows={3} maxLength={2000} help="Only TalentYak sees this, not your coach." />
                          <div><SubmitButton pendingLabel="Sending…" variant="secondary">Send request</SubmitButton></div>
                        </ActionForm>
                      </details>
                    )
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

      <InstallHelp className="mt-12" />
    </div>
  );
}
