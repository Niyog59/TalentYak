import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { ExpectationNote } from "@/components/checkins/expectation";
import { FeedbackEditor } from "@/components/checkins/feedback-editor";
import { AnswersView, FeedbackView, RevisionList, SnapshotView } from "@/components/checkins/views";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { completeReviewAction, discardFeedbackAction, linkStepAction } from "@/lib/checkins/actions";
import { buildSnapshot, checkinDetail, coachQueue, reviewExpectation } from "@/lib/checkins/server";
import { COACH_GROUP_LABEL, coachGroup, periodLabel, wasLate } from "@/lib/checkins/status";
import { localDate } from "@/lib/programmes/content";
import { plansForEnrollment } from "@/lib/programmes/server";
import { KIND_LABEL } from "@/lib/programmes/labels";

export const metadata = { title: "Check-in review" };
export const dynamic = "force-dynamic";

const EVENT_WORDS: Record<string, string> = {
  created: "Asked",
  submitted: "Sent by the client",
  corrected: "Corrected by the client",
  reopened: "Reopened by a correction",
  feedback_published: "Feedback published",
  completed: "Review marked complete",
  transferred: "Handed to the current coach after a coach change",
  flagged: "Flagged for TalentYak after a coach change",
  resolved: "Resolved by TalentYak",
  step_linked: "Plan update linked to a next step",
  step_unlinked: "Plan link removed from a next step",
  missed: "Closed unsent",
  cancelled: "Closed",
};

export default async function CoachCheckinPage({ params }: { params: Promise<{ checkinId: string }> }) {
  const { checkinId } = await params;
  const session = await requireCoach(`/coach/check-ins/${checkinId}`);
  const tz = session.provider.timezone;
  // Row-level security decides: a former coach, another coach, or a coach
  // whose client's sharing choice excludes this gets "not found".
  const detail = await checkinDetail(checkinId);
  if (!detail || detail.checkin.status === "open") notFound();
  const { checkin: c, questions, submissions, feedback } = detail;

  const supabase = await createClient();
  const [queue, expectation, plans] = await Promise.all([coachQueue(), reviewExpectation(checkinId), plansForEnrollment(c.enrollment_id)]);
  const row = (queue ?? []).find((r) => r.checkin_id === checkinId);
  const mayReview = Boolean(row?.may_review);
  const clientName = row?.client_name ?? "Your client";
  const group = row ? coachGroup(row, new Date()) : null;

  // The follow-up conversation: only the one this coach is part of now.
  const { data: convo } = supabase
    ? await supabase.from("conversations").select("id, provider_id").eq("enrollment_id", c.enrollment_id).eq("provider_id", session.provider.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const latest = submissions.at(-1)!;
  const published = feedback.filter((f) => f.published_at).sort((a, b) => b.published_at!.localeCompare(a.published_at!));
  const myDraft = feedback.find((f) => !f.published_at && f.provider_id === session.provider.id) ?? null;
  const covers = published.some((f) => f.refers_to_revision >= (c.review_revision ?? 1));
  const versions = plans.flatMap((p) => p.versions.filter((v) => v.published_at).map((v) => ({ ...v, kind: p.kind })));
  const firstSnap = submissions[0]?.progress_snapshot ?? null;
  const now = firstSnap
    ? await buildSnapshot({
        enrollmentId: c.enrollment_id,
        plans,
        from: c.period_start,
        to: c.period_end,
        today: localDate(new Date(), c.timezone),
        timeZone: c.timezone,
        weightUnit: firstSnap.weight.unit,
        lengthUnit: firstSnap.measurements[0]?.unit ?? "cm",
      }).catch(() => null)
    : null;
  const linkable = versions.filter((v) => c.first_submitted_at && v.published_at! >= c.first_submitted_at && !v.withdrawn_at);

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/check-ins" className="text-brand underline underline-offset-4">← Check-ins</Link></p>
      <PageHeader title={`${clientName} · ${periodLabel(c.period_start, c.period_end)}`}>
        Sent {formatDate(c.first_submitted_at, tz, true)}{wasLate(c) ? " (after the due time)" : ""}
        {c.current_revision > 1 ? ` · corrected, now version ${c.current_revision}` : ""} · responsible coach: {detail.coachName}
      </PageHeader>
      <p className="mt-3 flex flex-wrap gap-2">
        {group ? <StatusPill tone={group === "reviewed" ? "good" : group === "overdue" ? "bad" : "neutral"}>{COACH_GROUP_LABEL[group]}</StatusPill> : null}
        {!mayReview && c.status !== "reviewed" ? <StatusPill>Read only</StatusPill> : null}
      </p>

      {c.status === "reopened" ? (
        <Notice>Your client changed something that matters after your feedback. Your earlier feedback is kept and still refers to the version it answered. Publish updated feedback, then mark the review complete again.</Notice>
      ) : null}
      {!mayReview && (c.status === "submitted" || c.status === "reopened") ? (
        <Notice tone="bad">You can read this but not reply now — coaching may be paused after a check-in sent outside paid time, ended, suspended, or handed to another coach.</Notice>
      ) : null}

      {expectation && (c.status === "submitted" || c.status === "reopened") ? (
        <ExpectationNote e={expectation} viewer="coach" timeZone={tz} supportHref="/coach/support" />
      ) : null}

      <nav aria-label="Related" className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        <Link href={`/coach/programmes/clients/${c.enrollment_id}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Plans</Link>
        <Link href={`/coach/programmes/clients/${c.enrollment_id}/progress`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Progress and logs</Link>
        {convo ? <Link href={`/coach/messages/${convo.id}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Messages</Link> : null}
        <Link href={`/coach/check-ins/clients/${c.enrollment_id}`} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Schedule</Link>
      </nav>

      <Panel title="Answers" id="answers" description={submissions.length > 1 ? `Version ${latest.revision} (latest). Changes from the version before are marked. Your client's answers can't be edited by anyone else.` : undefined}>
        <AnswersView questions={questions} answers={latest.answers} previous={submissions.length > 1 ? submissions.at(-2)!.answers : null} />
        {latest.change_note ? <p className="mt-3 text-sm">Client&rsquo;s note on the change: &ldquo;{latest.change_note}&rdquo;</p> : null}
        <div className="mt-4"><RevisionList submissions={submissions} timeZone={tz} /></div>
        {submissions.length > 1 ? (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Earlier versions</summary>
            <div className="mt-2 space-y-4">
              {submissions.slice(0, -1).reverse().map((s) => (
                <div key={s.id}>
                  <p className="font-semibold">Version {s.revision} · {formatDate(s.submitted_at, tz, true)}</p>
                  <AnswersView questions={questions} answers={s.answers} />
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel title="Progress in this period" id="progress">
        <SnapshotView snapshot={firstSnap} current={now} timeZone={tz} />
      </Panel>

      {published.length ? (
        <Panel title="Published feedback" id="published">
          <div className="space-y-4">
            {published.map((f) => (
              <div key={f.id}>
                <FeedbackView
                  feedback={f}
                  timeZone={tz}
                  submissions={submissions}
                  planLabel={f.plan_id ? "Linked plan" : null}
                  planHref={f.plan_id ? `/coach/programmes/clients/${c.enrollment_id}` : null}
                  conversationHref={f.conversation_id && convo && f.conversation_id === convo.id ? `/coach/messages/${convo.id}` : null}
                  versionLink={(id) => {
                    const v = versions.find((x) => x.id === id);
                    return v ? { versionId: id, label: `${KIND_LABEL[v.kind]}, version ${v.version}`, href: `/coach/programmes/clients/${c.enrollment_id}/${v.kind}/preview?v=${id}` } : { versionId: id, label: "A published plan version", href: null };
                  }}
                />
                {mayReview && f.provider_id === session.provider.id
                  ? f.next_steps.filter((s) => s.kind === "plan_change").map((s) => {
                      const linked = f.links.find((l) => l.step_key === s.key);
                      return (
                        <ActionForm key={s.key} action={linkStepAction} className="mt-2 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                          <input type="hidden" name="feedback_id" value={f.id} />
                          <input type="hidden" name="step_key" value={s.key} />
                          <input type="hidden" name="checkin_id" value={c.id} />
                          <label className="block text-sm font-semibold">
                            Plan update that delivered &ldquo;{s.text}&rdquo;
                            <select name="version_id" defaultValue={linked?.plan_version_id ?? ""} className="mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-paper px-3 font-normal">
                              <option value="">Not published yet</option>
                              {linkable.map((v) => <option key={v.id} value={v.id}>{KIND_LABEL[v.kind]}, version {v.version} — published {formatDate(v.published_at, tz)}</option>)}
                            </select>
                          </label>
                          <SubmitButton variant="secondary" pendingLabel="Saving…">Save link</SubmitButton>
                          {!linkable.length ? <p className="text-sm text-ink-muted sm:col-span-2">No plan version has been published since this check-in was sent. <Link href={`/coach/programmes/clients/${c.enrollment_id}`} className="text-brand underline underline-offset-4">Publish it through the plan screens</Link> first.</p> : null}
                        </ActionForm>
                      );
                    })
                  : null}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {mayReview ? (
        <Panel title={published.length ? "Update your feedback" : "Your feedback"} id="feedback" description="Your client sees nothing until you publish.">
          <FeedbackEditor
            checkinId={c.id}
            initial={myDraft ? { body: myDraft.body, next_steps: myDraft.next_steps, plan_id: myDraft.plan_id, conversation_id: myDraft.conversation_id } : null}
            plans={plans.filter((p) => p.provider_id === session.provider.id).map((p) => ({ id: p.id, label: KIND_LABEL[p.kind] }))}
            hasConversation={Boolean(convo)}
            republish={published.length > 0}
          />
          {myDraft ? (
            <ActionForm action={discardFeedbackAction} className="mt-4">
              <input type="hidden" name="feedback_id" value={myDraft.id} />
              <input type="hidden" name="checkin_id" value={c.id} />
              <SubmitButton variant="secondary" pendingLabel="Discarding…">Discard draft</SubmitButton>
              <p className="mt-1 text-sm text-ink-muted">Draft saved {formatDate(myDraft.updated_at, tz, true)}.</p>
            </ActionForm>
          ) : null}
        </Panel>
      ) : null}

      {mayReview && (c.status === "submitted" || c.status === "reopened") ? (
        <Panel title="Finish the review" id="complete">
          {covers ? (
            <ActionForm action={completeReviewAction}>
              <input type="hidden" name="checkin_id" value={c.id} />
              <SubmitButton pendingLabel="Marking…">Mark review complete</SubmitButton>
              <p className="mt-2 text-sm text-ink-muted">Moves it to Reviewed. Your client already has your published feedback.</p>
            </ActionForm>
          ) : (
            <p className="text-ink-muted">Publish feedback on the latest answers (version {c.review_revision ?? c.current_revision}) first. Opening this page doesn&rsquo;t count as a review.</p>
          )}
        </Panel>
      ) : null}

      <Panel title="History" id="events">
        <ol className="space-y-1 text-sm">
          {detail.events.map((e, i) => (
            <li key={i}>{formatDate(e.created_at, tz, true)} · {EVENT_WORDS[e.kind] ?? e.kind}</li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
