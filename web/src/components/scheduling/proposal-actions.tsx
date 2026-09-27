"use client";

import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { ProposeForm } from "@/components/scheduling/propose-form";
import { respondAction } from "@/lib/scheduling/actions";

/**
 * The explicit actions on a pending suggestion. Only these change the
 * calendar — never a chat message that happens to mention a time.
 */
export function ProposalActions({
  proposalId,
  mine,
  durations,
  fixedDuration,
  viewerTz,
  otherTz,
  otherLabel,
  kind = "coaching",
}: {
  proposalId: string;
  /** The viewer made this suggestion: they may withdraw it, not accept it. */
  mine: boolean;
  durations: number[];
  fixedDuration?: number | null;
  viewerTz: string;
  otherTz?: string | null;
  otherLabel: string;
  kind?: "coaching" | "consultation";
}) {
  if (mine) {
    return (
      <ActionForm action={respondAction} className="mt-2">
        <input type="hidden" name="proposal_id" value={proposalId} />
        <SubmitButton name="action" value="withdraw" variant="quiet" pendingLabel="Withdrawing…">Withdraw suggestion</SubmitButton>
      </ActionForm>
    );
  }
  return (
    <div className="mt-2 grid gap-2">
      <ActionForm action={respondAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="proposal_id" value={proposalId} />
        <SubmitButton name="action" value="accept" pendingLabel="Confirming…">Accept</SubmitButton>
        <SubmitButton name="action" value="decline" variant="secondary" pendingLabel="Declining…">Decline</SubmitButton>
      </ActionForm>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Suggest another time</summary>
        <div className="mt-3">
          <ProposeForm
            kind={kind}
            counterOf={proposalId}
            durations={durations}
            fixedDuration={fixedDuration}
            viewerTz={viewerTz}
            otherTz={otherTz}
            otherLabel={otherLabel}
            allowWeekly={false}
            submitLabel="Suggest this time instead"
          />
        </div>
      </details>
    </div>
  );
}
