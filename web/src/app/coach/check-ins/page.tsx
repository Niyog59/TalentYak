import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { createStarterTemplateAction } from "@/lib/checkins/actions";
import { coachQueue, myCheckinTemplates } from "@/lib/checkins/server";
import { COACH_GROUP_LABEL, coachGroup, periodLabel, type CoachGroup } from "@/lib/checkins/status";
import { myClients } from "@/lib/programmes/server";

export const metadata = { title: "Check-ins" };
export const dynamic = "force-dynamic";

const ORDER: CoachGroup[] = ["overdue", "awaiting", "reopened", "feedback_sent", "reviewed"];

export default async function CoachCheckinsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireCoach("/coach/check-ins");
  const tz = session.provider.timezone;
  const [{ show }, queue, templates, clients] = await Promise.all([searchParams, coachQueue(), myCheckinTemplates(), myClients()]);
  const now = new Date();
  const rows = (queue ?? []).map((r) => ({ ...r, group: coachGroup(r, now) }));
  const active = templates.filter((t) => !t.archived_at);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Check-ins">
        Your clients&rsquo; regular updates, with their progress for the period alongside. Opening one never marks it reviewed: publish feedback, then mark it complete.
      </PageHeader>

      {queue === null ? <Notice tone="bad">The queue couldn&rsquo;t be loaded. Refresh to try again.</Notice> : null}

      {ORDER.map((g) => {
        const list = rows.filter((r) => r.group === g);
        if (g === "reviewed" && show !== "reviewed") {
          return list.length ? (
            <p key={g} className="mt-8"><Link href="?show=reviewed" className="text-brand underline underline-offset-4">Show {list.length} reviewed check-in{list.length === 1 ? "" : "s"}</Link></p>
          ) : null;
        }
        return (
          <Panel key={g} title={`${COACH_GROUP_LABEL[g]} (${list.length})`} id={`q-${g}`}>
            {list.length === 0 ? (
              <p className="text-ink-muted">{g === "awaiting" ? "Nothing waiting. New check-ins appear here as clients send them." : "None."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {list.map((r) => (
                  <li key={r.checkin_id} className="py-3">
                    <Link href={`/coach/check-ins/${r.checkin_id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-semibold text-brand underline underline-offset-4">{r.client_name} · {periodLabel(r.period_start, r.period_end)}</span>
                        <span className="block text-sm text-ink-muted">
                          Sent {formatDate(r.first_submitted_at, tz, true)}
                          {r.current_revision > 1 ? ` · corrected (version ${r.current_revision})` : ""}
                          {r.review_due && g !== "reviewed" ? ` · your stated reply time: ${formatDate(r.review_due, tz, true)}` : ""}
                          {!r.mine ? ` · responsible: ${r.responsible_name}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {!r.may_review && g !== "reviewed" ? <StatusPill>Read only</StatusPill> : null}
                        {g === "overdue" ? <StatusPill tone="bad">Past your reply time</StatusPill> : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}

      <Panel title="Clients' schedules" id="clients" description="Each client's check-in cadence, pauses and breaks.">
        {!clients?.length ? (
          <p className="text-ink-muted">No current clients.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {clients.map((c) => (
              <li key={c.enrollment_id}>
                <Link href={`/coach/check-ins/clients/${c.enrollment_id}`} className="flex min-h-11 items-center rounded-lg border border-line px-3 text-brand underline underline-offset-4">
                  {c.client_name} · {c.offer_title ?? "Coaching"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Your templates" id="templates" description="Reusable question sets. Editing one saves a new version: check-ins already sent keep the questions they were asked with.">
        {active.length ? (
          <ul className="mb-4 space-y-2">
            {active.map((t) => (
              <li key={t.id}>
                <Link href={`/coach/check-ins/templates/${t.id}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">{t.title}</Link>
                <span className="text-sm text-ink-muted"> · version {t.latest_version}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-ink-muted">No templates yet. The weekly starter asks about energy, sleep, hunger, recovery, what was hardest and what would help — about two minutes, with optional photos or a form-check clip.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <ActionForm action={createStarterTemplateAction}>
            <SubmitButton pendingLabel="Creating…" variant={active.length ? "secondary" : "primary"}>Start from the weekly starter</SubmitButton>
          </ActionForm>
          <ButtonLink href="/coach/check-ins/templates/new" variant="secondary">Write your own</ButtonLink>
        </div>
        {templates.length > active.length ? <p className="mt-3 text-sm text-ink-muted">{templates.length - active.length} archived.</p> : null}
      </Panel>
    </div>
  );
}
