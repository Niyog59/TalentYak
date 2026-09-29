import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { AdminHeader, Badge, ErrorNote, Figures, Section, Table } from "@/components/admin/ui";
import { attemptCount, loaded } from "@/lib/admin/loaded";
import { formatDate } from "@/lib/format";
import { isResendConfigured } from "@/lib/env";
import { retryJobAction } from "../actions";
import { daysAgoIso } from "@/lib/admin/range";

export const metadata = { title: "Jobs & deliveries" };

/*
 * The machinery behind notices and background work. A retry runs the same
 * job again: jobs are keyed so a retry never sends an email twice for one
 * event, never charges, refunds or pays twice. Recipient addresses are shown
 * only in the delivery log, where diagnosing a bounce needs them.
 */
export default async function OperationsPage() {
  const session = await requireAdmin("/admin/operations");
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;
  const head = { count: "exact" as const, head: true };
  const since = daysAgoIso(1);

  const [jobs, deliveries, events, ops, queued, done24, failed24] = await Promise.all([
    supabase.from("outbox").select("id, topic, state, attempts, last_error, created_at, scheduled_for").in("state", ["failed", "blocked"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_deliveries").select("id, template, recipient_email, state, provider_message_id, error, created_at").order("created_at", { ascending: false }).limit(50),
    supabase.from("provider_events").select("id, event_type, processing_state, attempts, last_error, received_at").in("processing_state", ["failed", "processing", "received"]).order("received_at", { ascending: false }).limit(50),
    supabase.rpc("admin_coaching_operations"),
    attemptCount(() => supabase.from("outbox").select("id", head).eq("state", "pending")),
    attemptCount(() => supabase.from("outbox").select("id", head).eq("state", "done").gte("created_at", since)),
    attemptCount(() => supabase.from("outbox").select("id", head).in("state", ["failed", "blocked"]).gte("created_at", since)),
  ]);
  const o = (ops.data ?? {}) as Record<string, number>;

  return (
    <div>
      <AdminHeader eyebrow="System" title="Jobs & deliveries">
        <p>
          Emails, notices and background work. <strong className="text-ink">Retry</strong> runs a job again safely — never sending the same
          message twice for one event and never repeating a charge, refund or payout. The scheduled worker also runs every few minutes by itself.
        </p>
      </AdminHeader>

      <Section title="Right now" id="now">
        <Figures
          items={[
            { label: "Jobs waiting to run", value: queued },
            { label: "Jobs finished (24 hours)", value: done24 },
            { label: "Jobs failed or blocked (24 hours)", value: failed24 },
            { label: "Email sending", value: loaded(isResendConfigured() ? "Configured" : "Not configured"), note: isResendConfigured() ? undefined : "Emails wait as blocked jobs" },
          ]}
        />
      </Section>

      <Section id="jobs" title="Failed or blocked jobs" description="Blocked means something must be configured first (for example email). Failed means it ran out of automatic retries.">
        {jobs.error ? <ErrorNote /> : (
          <Table
            caption="Failed or blocked jobs"
            head={["Created", "Job", "State", "Attempts", "Last error", ""]}
            empty="Nothing failed."
            rows={(jobs.data ?? []).map((j) => [
              formatDate(j.created_at, tz, true),
              <span key="t" className="font-mono text-[0.875rem]">{j.topic}</span>,
              <Badge key="s" tone={j.state === "failed" ? "bad" : "warn"}>{j.state}</Badge>,
              String(j.attempts),
              <span key="e" className="break-all text-[0.875rem]">{(j.last_error ?? "").slice(0, 200)}</span>,
              <ActionForm key="r" action={retryJobAction}>
                <input type="hidden" name="job_id" value={j.id} />
                <SubmitButton pendingLabel="Queuing…" variant="quiet">Retry</SubmitButton>
              </ActionForm>,
            ])}
          />
        )}
      </Section>

      <Section id="deliveries" title="What actually reached people" description="A job finishing isn't an email arriving. 'Accepted' means the sending service took it; bounces and complaints are recorded as they're reported. 'Uncertain' means the outcome was never learned.">
        {deliveries.error ? <ErrorNote /> : (
          <Table
            caption="Recent email deliveries"
            head={["Sent", "Template", "To", "State", "Error"]}
            empty="No email has been sent yet."
            rows={(deliveries.data ?? []).map((d) => [
              formatDate(d.created_at, tz, true),
              d.template,
              <span key="to" className="break-all text-[0.875rem]">{d.recipient_email}</span>,
              <Badge key="s" tone={["bounced", "complained", "failed"].includes(d.state) ? "bad" : d.state === "uncertain" ? "warn" : "good"}>{d.state}</Badge>,
              <span key="e" className="break-all text-[0.875rem]">{(d.error ?? "").slice(0, 160)}</span>,
            ])}
          />
        )}
      </Section>

      <Section id="media" title="Upload processing" description="Counts only: TalentYak doesn't open private photos or clips.">
        {ops.error ? <ErrorNote /> : (
          <Figures
            items={[
              { label: "Processing now", value: loaded(Number(o.media_processing ?? 0)) },
              { label: "Failed (30 days)", value: loaded(Number(o.media_failed_30d ?? 0)), note: "The person sees why and can try again from their screen" },
              { label: "Call rooms open", value: loaded(Number(o.calls_open_now ?? 0)) },
              { label: "Call failures (30 days)", value: loaded(Number(o.calls_interrupted_30d ?? 0)) },
            ]}
          />
        )}
      </Section>

      <Section id="events" title="Stripe events not yet processed" description="Retried automatically from Stripe's own copy by the scheduled job. Payment truth only ever comes from these signed events.">
        {events.error ? <ErrorNote /> : (
          <Table
            caption="Unprocessed Stripe events"
            head={["Received", "Type", "State", "Attempts", "Error"]}
            empty="All Stripe events processed."
            rows={(events.data ?? []).map((e) => [formatDate(e.received_at, tz, true), e.event_type, e.processing_state, String(e.attempts), <span key="e" className="break-all text-[0.875rem]">{(e.last_error ?? "").slice(0, 200)}</span>])}
          />
        )}
      </Section>

      <p className="mt-6 text-[0.9375rem] text-ink-muted">
        Retention holds and deletion requests are on <Link href="/admin/retention" className="text-brand underline">Data &amp; retention</Link>.
      </p>
    </div>
  );
}
