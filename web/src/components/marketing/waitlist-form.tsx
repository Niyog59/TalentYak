import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { joinWaitlistAction } from "@/lib/waitlist/actions";
import { WAITLIST_CONSENT_LABEL } from "@/lib/waitlist/copy";

/**
 * Join the waitlist. Email, and optionally a first name and the coach or
 * plan — never anything about health. The coach and plan can come from the
 * page the person was on, so "join the waitlist for Maya" keeps that interest.
 */
export function WaitlistForm({
  coaches,
  coachId,
  planId,
  planLabel,
  compact = false,
}: {
  coaches: { id: string; name: string }[];
  coachId?: string | null;
  planId?: string | null;
  planLabel?: string | null;
  compact?: boolean;
}) {
  const fixedCoach = coachId ? coaches.find((c) => c.id === coachId) : undefined;
  return (
    <ActionForm action={joinWaitlistAction} className="grid gap-4" resetOnSuccess>
      <TextField name="email" label="Email" type="email" autoComplete="email" required />
      {compact ? null : <TextField name="first_name" label="First name" autoComplete="given-name" required={false} />}
      {fixedCoach ? (
        <>
          <input type="hidden" name="coach" value={fixedCoach.id} />
          {planId ? <input type="hidden" name="plan" value={planId} /> : null}
          <p className="text-sm">
            Interested in: <strong>{fixedCoach.name}</strong>
            {planLabel ? ` · ${planLabel}` : ""}
          </p>
        </>
      ) : coaches.length ? (
        <SelectField
          name="coach"
          label="Coach you're interested in"
          required={false}
          options={[{ value: "", label: "Any coach" }, ...coaches.map((c) => ({ value: c.id, label: c.name }))]}
        />
      ) : null}
      {/* Hidden from people; automated form-fillers fill it and are ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <CheckboxField name="consent" required label={WAITLIST_CONSENT_LABEL} />
      <div>
        <SubmitButton pendingLabel="Joining…">Join the waitlist</SubmitButton>
      </div>
    </ActionForm>
  );
}
