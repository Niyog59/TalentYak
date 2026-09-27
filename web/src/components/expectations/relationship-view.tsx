import Link from "next/link";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton } from "@/components/form/fields";
import { ExpectationsDocument } from "@/components/expectations/document";
import { ExpectationsChanges } from "@/components/expectations/changes";
import { PrintButton } from "@/components/expectations/print-button";
import { diffCoach, diffPlatform } from "@/lib/expectations/diff";
import type { EnrollmentDocument } from "@/lib/expectations/server";
import { SOURCE_LABEL } from "@/lib/expectations/types";
import { formatDate } from "@/lib/format";
import { acknowledgeExpectationsAction } from "@/app/(marketing)/account/expectations/actions";

/**
 * One relationship's welcome document, for the client or their current coach.
 * Shows the newest presented version (or the one chosen from history), what
 * changed from the version before it, and — for the client only — the
 * acknowledgement box. Acknowledging is optional: coaching continues either way.
 */
export function RelationshipExpectations({
  doc,
  viewer,
  clientName,
  selectedId,
  basePath,
  messagesHref,
  timeZone,
}: {
  doc: EnrollmentDocument;
  viewer: "customer" | "coach";
  clientName: string;
  selectedId?: string;
  basePath: string;
  messagesHref?: string | null;
  timeZone?: string | null;
}) {
  const current = doc.presentations.find((p) => p.id === selectedId) ?? doc.presentations[0] ?? null;
  const previous = current?.previous_id ? doc.presentations.find((p) => p.id === current.previous_id) ?? null : null;
  const isNewest = current && current.id === doc.presentations[0]?.id;

  const comparable = current?.coach && current.platform && previous?.coach && previous.platform ? { current, previous } : null;
  const platformChanged = comparable ? comparable.previous.platform!.id !== comparable.current.platform!.id : false;
  const coachChanged = comparable ? comparable.previous.coach!.id !== comparable.current.coach!.id : false;
  const changes = comparable
    ? [
        ...(platformChanged ? diffPlatform(comparable.previous.platform!, comparable.current.platform!) : []),
        ...(coachChanged ? diffCoach(comparable.previous.coach!, comparable.current.coach!) : []),
      ]
    : null;
  // A summary belongs to the side that changed in THIS version, never carried
  // over from an earlier revision of the other side.
  const summaries = [
    ...(platformChanged && current?.platform?.change_summary ? [{ from: "From TalentYak", text: current.platform.change_summary }] : []),
    ...(coachChanged && current?.coach?.change_summary ? [{ from: `In ${current.coachName}'s words`, text: current.coach.change_summary }] : []),
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {messagesHref ? (
          <Link href={messagesHref} className="font-semibold text-brand underline underline-offset-4">← Back to messages</Link>
        ) : <span />}
        {current ? <PrintButton /> : null}
      </div>

      {doc.purchasedWithout ? (
        <p role="note" className="rounded-lg border border-line-strong bg-paper-raised p-4">
          {viewer === "customer" ? "You" : `${clientName}`} joined before TalentYak had a welcome document, so none was part of the
          original purchase. {current ? "The version below was shared afterwards." : "None has been shared yet."} The original plan
          and its terms are unchanged.
        </p>
      ) : null}

      {!current ? (
        <p className="rounded-lg border border-line p-4 text-ink-muted">
          {viewer === "customer"
            ? "Your coach hasn't shared a welcome & expectations document with you yet."
            : "No welcome & expectations document has been shared with this client yet. Publishing yours shares it with your current clients."}
        </p>
      ) : !current.coach || !current.platform ? (
        <p className="rounded-lg border border-line p-4 text-ink-muted">This version isn&rsquo;t available to you any more.</p>
      ) : (
        <>
          {changes && isNewest ? <ExpectationsChanges changes={changes} summaries={summaries} /> : null}

          <ExpectationsDocument
            platform={current.platform}
            coach={current.coach}
            coachName={current.coachName}
            coachPhotoUrl={current.coachPhotoUrl}
            plan={doc.plan}
            personal={{
              clientName,
              startDate: doc.startedAt,
              presentedAt: current.presented_at,
              source: current.source,
              acknowledgedAt: current.acknowledged_at,
              acknowledgementRequested: current.acknowledgement_requested,
            }}
            previewLabel={isNewest ? undefined : "An earlier version — kept exactly as it was shown"}
            timeZone={timeZone}
          />

          {viewer === "customer" && !current.acknowledged_at ? (
            <section aria-labelledby="ack-heading" className="rounded-2xl border border-line bg-surface p-5 print:hidden">
              <h2 id="ack-heading" className="text-xl font-semibold">Confirm you&rsquo;ve read it</h2>
              <p className="mt-1 text-sm text-ink-muted">
                This only records that you&rsquo;ve read it. It doesn&rsquo;t change your price, fees, refunds or plan, and your coaching continues whether or not you tick it.
              </p>
              <ActionForm action={acknowledgeExpectationsAction} className="mt-4 grid gap-4">
                <input type="hidden" name="enrollment_id" value={doc.enrollmentId} />
                <input type="hidden" name="presentation_id" value={current.id} />
                <CheckboxField name="understood" required label="I've read and understand these expectations" />
                <div><SubmitButton pendingLabel="Saving…">Confirm</SubmitButton></div>
              </ActionForm>
            </section>
          ) : null}
        </>
      )}

      {doc.presentations.length > 1 ? (
        <section aria-labelledby="history-heading" className="print:hidden">
          <h2 id="history-heading" className="text-xl font-semibold">Every version shared</h2>
          <ul className="mt-3 space-y-2">
            {doc.presentations.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3">
                <Link href={`${basePath}?v=${p.id}`} aria-current={p.id === current?.id ? "page" : undefined} className="font-semibold text-brand underline underline-offset-4 aria-[current=page]:text-ink">
                  {p.coach ? `Coach version ${p.coach.version}` : "Earlier version"}{p.platform ? ` · TalentYak version ${p.platform.version}` : ""}
                </Link>
                <span className="text-sm text-ink-muted">
                  {formatDate(p.presented_at, timeZone)} · {SOURCE_LABEL[p.source]} ·{" "}
                  {p.acknowledged_at ? `read ${formatDate(p.acknowledged_at, timeZone)}` : p.acknowledgement_requested ? "not yet acknowledged" : "for information"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
