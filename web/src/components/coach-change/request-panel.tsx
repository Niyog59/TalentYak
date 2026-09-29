import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { formatDate } from "@/lib/format";
import { requestCoachChangeAction, withdrawCoachChangeAction } from "@/app/(marketing)/account/customer-actions";

/*
 * Asking to change coach (AAF-OPS-01). The client chooses a replacement who
 * can take them on now — or lets TalentYak suggest one — and decides what the
 * new coach may see from before. Nothing changes until TalentYak confirms the
 * move; until then the current coach, plan and price carry on as they are.
 */

export const HISTORY_CHOICES = [
  {
    value: "none",
    label: "Nothing from before",
    help: "Your new coach starts fresh. Your records stay yours to read.",
  },
  {
    value: "programme_and_logs",
    label: "My training plans and logs",
    help: "Plans, workouts, body readings, food diary and check-in answers without photos or clips.",
  },
  {
    value: "full",
    label: "Everything, including progress photos and clips",
    help: "Gives your new coach the fullest picture, including private photos and videos.",
  },
] as const;

export interface OpenCoachChange {
  id: string;
  created_at: string;
  preferred_name: string | null;
  consented_history_scope: string | null;
}

export async function CoachChangePanel({
  enrollmentId,
  open,
  allowed,
  timeZone,
}: {
  enrollmentId: string;
  open: OpenCoachChange | null;
  allowed: boolean;
  timeZone: string | null;
}) {
  if (open) {
    const shared = HISTORY_CHOICES.find((c) => c.value === open.consented_history_scope)?.label;
    return (
      <div className="mt-3 rounded-lg border border-line bg-paper-raised p-3 text-sm">
        <p className="font-semibold">You&rsquo;ve asked to change coach ({formatDate(open.created_at, timeZone)}).</p>
        <p className="mt-1 text-ink-muted">
          {open.preferred_name ? `You asked for ${open.preferred_name}. ` : "TalentYak will suggest a coach. "}
          {shared ? `What they may see from before: ${shared.toLowerCase()}. ` : ""}
          Your current coaching carries on unchanged until TalentYak confirms the move with you.
        </p>
        <ActionForm action={withdrawCoachChangeAction} className="mt-2">
          <input type="hidden" name="request_id" value={open.id} />
          <SubmitButton variant="quiet" pendingLabel="Withdrawing…">Withdraw my request</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  // Switched off (or test accounts only, and this isn't one): no entry point.
  if (!allowed) return null;

  const supabase = (await createClient())!;
  const { data } = await supabase.rpc("coach_change_candidates", { p_enrollment: enrollmentId });
  const candidates = (data ?? []) as { provider_id: string; display_name: string; slug: string | null }[];

  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-brand underline">Ask to change coach</summary>
      <ActionForm action={requestCoachChangeAction} className="mt-3 grid gap-4">
        <input type="hidden" name="enrollment_id" value={enrollmentId} />
        <TextArea name="reason" label="What isn't working?" required rows={3} maxLength={2000} help="Only TalentYak sees this, not your coach." />
        <SelectField
          name="preferred_provider_id"
          label="Who would you like instead?"
          required={false}
          defaultValue=""
          help={candidates.length
            ? "Only coaches who can take on a new client right now are listed. TalentYak confirms their place before anything changes."
            : "No other coach can take on a new client right now. TalentYak will look for one and contact you."}
          options={[
            { value: "", label: "Let TalentYak suggest a coach" },
            ...candidates.map((c) => ({ value: c.provider_id, label: c.display_name })),
          ]}
        />
        <fieldset className="grid gap-2">
          <legend className="font-semibold">What may your new coach see from before?</legend>
          {HISTORY_CHOICES.map((c) => (
            <label key={c.value} className="flex min-h-11 items-start gap-3 rounded-lg border border-line bg-surface p-3">
              <input type="radio" name="history_scope" value={c.value} required defaultChecked={c.value === "none"} className="mt-1 size-5" />
              <span>
                <span className="block font-medium">{c.label}</span>
                <span className="block text-sm text-ink-muted">{c.help}</span>
              </span>
            </label>
          ))}
          <p className="text-sm text-ink-muted">
            Your private conversations with your current coach are never shared: your new coach starts a new conversation, and you
            keep your old one to read.
          </p>
        </fieldset>
        <div className="rounded-lg bg-paper-raised p-3 text-sm">
          <p className="font-semibold">What happens next</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
            <li>Nothing changes until TalentYak confirms the move with you. Your plan, price and paid dates stay as they are.</li>
            <li>When it takes effect, sessions booked with your current coach are cancelled and both of you are told; you book new times with your new coach.</li>
            <li>Your current coach stops seeing your records from then on. Check-ins waiting for feedback move to your new coach only if what you share covers them.</li>
          </ul>
        </div>
        <CheckboxField name="consent" label="I understand, and I agree to share what I chose above with my new coach." />
        <div><SubmitButton pendingLabel="Sending…" variant="secondary">Send request</SubmitButton></div>
      </ActionForm>
    </details>
  );
}
