import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { CASE_STATE_LABEL, SUPPORT_CATEGORIES, categoryLabel } from "@/lib/support/categories";
import { openSupportCaseAction } from "@/lib/support/actions";

/**
 * Report a problem, and see what happened to earlier reports. Shared by the
 * client and coach areas. Only the reporter and TalentYak see a case — never
 * the other person in the conversation.
 */
/** Starting points from the dashboards' "Need help?" links. */
const ABOUT_HINT: Record<string, string> = {
  coach_unavailable: "Tell us which coach, since when, and what you've tried. Your coach isn't told unless we need to contact them.",
  call_failed: "Say which session and what happened. You can also report it from that session's page, so we see which one straight away.",
};

export async function SupportContent({
  conversationId,
  timeZone,
  category = "",
  about: topic = null,
}: {
  conversationId: string | null;
  timeZone: string;
  category?: string;
  about?: string | null;
}) {
  const supabase = (await createClient())!;
  const [{ data: cases }, conversation] = await Promise.all([
    supabase
      .from("support_cases")
      .select("id, category, state, description, resolution_note, created_at, resolved_at, conversation_id")
      .order("created_at", { ascending: false })
      .limit(20),
    conversationId ? supabase.rpc("conversation_status", { p_conversation: conversationId }) : Promise.resolve({ data: null }),
  ]);
  const about = conversation.data as { role: string; coach_name: string; client_name: string } | null;
  const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" }).format(new Date(iso));

  return (
    <div className="grid gap-8">
      <section aria-labelledby="new-case" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="new-case" className="text-xl font-semibold">Report a problem</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Only TalentYak sees what you write here. {about ? `${about.role === "customer" ? about.coach_name : about.client_name} is not told.` : ""}
          {" "}If someone is in immediate danger, contact your local emergency services first.
        </p>
        <ActionForm action={openSupportCaseAction} className="mt-4 grid gap-4" resetOnSuccess>
          {about && conversationId ? (
            <>
              <input type="hidden" name="conversation_id" value={conversationId} />
              <p className="rounded-lg bg-paper-raised px-3 py-2 text-sm">
                About your conversation with <strong>{about.role === "customer" ? about.coach_name : about.client_name}</strong>. TalentYak
                staff can read that conversation only if they need to for this case; that access is recorded and expires.
              </p>
            </>
          ) : null}
          {topic && ABOUT_HINT[topic] ? <p className="rounded-lg bg-paper-raised px-3 py-2 text-sm">{ABOUT_HINT[topic]}</p> : null}
          <SelectField
            name="category"
            label="What is it about?"
            required
            defaultValue={SUPPORT_CATEGORIES.some((c) => c.value === category) ? category : ""}
            options={[{ value: "", label: "Choose one" }, ...SUPPORT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]}
          />
          <TextArea name="description" label="What happened?" required rows={5} maxLength={2000} help="Include what you need from us. Don't include card numbers or passwords." />
          <div><SubmitButton pendingLabel="Sending…">Send to TalentYak</SubmitButton></div>
        </ActionForm>
        {env.supportEmail ? (
          <p className="mt-4 text-sm text-ink-muted">
            Can&rsquo;t use this form? Email <a className="underline" href={`mailto:${env.supportEmail}`}>{env.supportEmail}</a>.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="my-cases">
        <h2 id="my-cases" className="text-xl font-semibold">Your reports</h2>
        {(cases ?? []).length === 0 ? (
          <p className="mt-2 text-ink-muted">You haven&rsquo;t reported anything.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {(cases ?? []).map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{categoryLabel(c.category)}</span>
                  <span className="rounded-full bg-paper-raised px-2 py-0.5 text-xs font-semibold">{CASE_STATE_LABEL[c.state] ?? c.state}</span>
                </p>
                <p className="text-sm text-ink-muted">Sent {date(c.created_at)}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{c.description}</p>
                {c.resolution_note ? (
                  <p className="mt-2 rounded-lg bg-brand-tint px-3 py-2 text-sm">
                    <strong>TalentYak:</strong> {c.resolution_note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
