import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, Details, EmptyNote, Section, Table } from "@/components/admin/ui";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { PROVIDER_STATUS_LABEL, formatDate } from "@/lib/format";
import {
  EMAILED_STATUSES,
  STATUS_LABEL,
  STATUS_TONE,
  countryLabel,
  experienceLabel,
  nextStatuses,
  safeLink,
  type ApplicationStatus,
} from "@/lib/coach-applications/rules";
import {
  addApplicationNoteAction,
  checkCertificateAction,
  resendAcceptanceAction,
  saveChecklistAction,
  setApplicationStatusAction,
} from "../actions";

export const metadata = { title: "Coach application" };

const CHECK_LABEL: Record<string, string> = {
  unverified: "Not checked",
  verified: "Checked",
  could_not_verify: "Couldn't be checked",
};

const EVENT_LABEL: Record<string, string> = {
  created: "Started a draft",
  submitted: "Sent the application",
  updated: "Corrected their answers",
  status_changed: "Changed the status",
  withdrawn: "Withdrew the application",
  agreement_signed: "Signed the coach agreement",
  agreement_declined: "Declined the coach agreement",
  certificate_added: "Added a qualification",
  certificate_removed: "Removed a qualification",
  certificate_file_added: "Attached a certificate file",
  certificate_checked: "Recorded a qualification check",
  checklist_updated: "Updated the reviewer checklist",
  acceptance_resent: "Sent the onboarding invitation again",
  note_added: "Added a private note",
};

interface Application {
  id: string;
  profile_id: string;
  status: ApplicationStatus;
  full_name: string;
  country: string;
  timezone: string;
  languages: string[];
  specialties: string[];
  experience_years: string;
  experience: string;
  online_experience: string | null;
  instagram: string | null;
  website: string | null;
  profile_url: string | null;
  availability: string;
  new_client_capacity: number | null;
  consistency_answer: string;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  withdrawn_reason: string | null;
  agreement_version: string | null;
  agreement_signed_at: string | null;
  agreement_signed_name: string | null;
  provider_id: string | null;
  acceptance_sends: number;
  profiles: { email: string } | { email: string }[] | null;
}

function ExternalLink({ value }: { value: string | null }) {
  const href = safeLink(value);
  if (!value) return <span>—</span>;
  if (!href) return <span>{value}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand underline underline-offset-4">
      {value}
    </a>
  );
}

const email = (p: Application["profiles"]) => (Array.isArray(p) ? p[0] : p)?.email ?? "";

export default async function CoachApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdmin(`/admin/coach-applications/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tz = session.profile.timezone;
  const supabase = (await createClient())!;

  const { data } = await supabase.from("coach_applications").select("*, profiles(email)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const app = data as Application;

  const [{ data: certs }, { data: checklist }, { data: notes }, { data: events }, { data: provider }] = await Promise.all([
    supabase.from("coach_application_certificates").select("id, qualification, issuing_body, expires_on, file_kind, file_bytes, verification_state, verified_detail, verified_at").eq("application_id", id).order("created_at"),
    supabase.from("coach_application_checklist").select("qualification_checked, communication, beginner_scenario, healthcare_referral, updated_at").eq("application_id", id).maybeSingle(),
    supabase.from("coach_application_notes").select("id, body, created_at, profiles(email)").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("coach_application_events").select("id, kind, from_status, to_status, actor_kind, reason, created_at, profiles(email)").eq("application_id", id).order("created_at", { ascending: false }).limit(100),
    app.provider_id ? supabase.from("providers").select("id, status").eq("id", app.provider_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const next = nextStatuses(app.status, Boolean(app.agreement_signed_at));
  const emailOf = (p: unknown) => (Array.isArray(p) ? (p[0] as { email?: string } | undefined)?.email : (p as { email?: string } | null)?.email) ?? "a former administrator";

  return (
    <div>
      <p><Link href="/admin/coach-applications" className="text-brand underline underline-offset-4">← All applications</Link></p>
      <AdminHeader eyebrow="Coach application" title={app.full_name}>
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>
          {app.status === "withdrawn" && app.withdrawn_reason === "declined_agreement" ? <Badge>Declined the agreement</Badge> : null}
          <span className="break-all">{email(app.profiles)}</span>
          <span>· Sent {app.submitted_at ? formatDate(app.submitted_at, tz, true) : "—"}</span>
          <Link href={`/admin/accounts/${app.profile_id}`} className="text-brand underline">Account</Link>
        </p>
      </AdminHeader>

      <Section title="Answers" id="answers">
        <Details
          items={[
            ["Country", countryLabel(app.country)],
            ["Time zone", app.timezone],
            ["Languages", app.languages.join(", ")],
            ["Coaching for", experienceLabel(app.experience_years)],
            ["Specialties", app.specialties.join(", ")],
            ["Experience", <span key="e" className="whitespace-pre-line text-ink">{app.experience}</span>],
            ["Online coaching", <span key="o" className="whitespace-pre-line">{app.online_experience || "—"}</span>],
            ["Weekly availability", <span key="av" className="whitespace-pre-line">{app.availability}</span>],
            ["New clients they could take", app.new_client_capacity === null ? "—" : String(app.new_client_capacity)],
            ["Instagram", <ExternalLink key="i" value={app.instagram} />],
            ["Website", <ExternalLink key="w" value={app.website} />],
            ["Other profile", <ExternalLink key="p" value={app.profile_url} />],
          ]}
        />
        <h3 className="mt-6 font-semibold">How would you help a busy beginner stay consistent?</h3>
        <p className="mt-2 whitespace-pre-line">{app.consistency_answer}</p>
        <p className="mt-4 text-sm text-ink-muted">Links open the applicant&rsquo;s own pages in a new tab. Follower counts aren&rsquo;t a requirement for acceptance.</p>
      </Section>

      <Section
        title="Qualifications"
        id="qualifications"
        description="Checking a qualification is separate from approving the application. An uploaded file never counts as checked — record only what you confirmed, for example with the issuer's register. Checked qualifications carry over to the coach's profile if they sign."
      >
        {(certs ?? []).length === 0 ? (
          <EmptyNote>No qualifications added.</EmptyNote>
        ) : (
          <ul className="divide-y divide-line">
            {(certs ?? []).map((c) => (
              <li key={c.id} className="py-4">
                <p className="font-semibold">
                  {c.qualification} <span className="font-normal text-ink-muted">— {c.issuing_body}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.9375rem] text-ink-muted">
                  <span>{c.expires_on ? `Expires ${formatDate(c.expires_on, "UTC")}` : "No expiry given"}</span>
                  <Badge tone={c.verification_state === "verified" ? "good" : c.verification_state === "could_not_verify" ? "bad" : "neutral"}>{CHECK_LABEL[c.verification_state]}</Badge>
                  {c.verified_detail ? <span>“{c.verified_detail}”</span> : null}
                  {c.file_kind ? (
                    <a href={`/admin/coach-applications/certificate/${c.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
                      {c.file_kind === "pdf" ? "Download PDF" : "View photo"}
                    </a>
                  ) : (
                    <span>No file</span>
                  )}
                </p>
                {c.file_kind === "pdf" ? <p className="mt-1 text-sm text-ink-muted">PDFs are checked for scripts and embedded files when uploaded, and only ever download. Open them in your usual PDF viewer.</p> : null}
                <ActionForm action={checkCertificateAction} className="mt-3 grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
                  <input type="hidden" name="application_id" value={app.id} />
                  <input type="hidden" name="certificate_id" value={c.id} />
                  <SelectField
                    name="state"
                    label="Check"
                    required
                    defaultValue={c.verification_state}
                    options={[
                      { value: "unverified", label: "Not checked" },
                      { value: "verified", label: "Checked — confirmed" },
                      { value: "could_not_verify", label: "Couldn't be checked" },
                    ]}
                  />
                  <TextField name="detail" label="What you checked" required={false} maxLength={300} defaultValue={c.verified_detail ?? ""} />
                  <SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Reviewer checklist" id="checklist" description="For your own review. It's never shown to the applicant. Follower count isn't on it and isn't a requirement.">
        <ActionForm action={saveChecklistAction} className="grid gap-4">
          <input type="hidden" name="application_id" value={app.id} />
          <CheckboxField name="qualification_checked" defaultChecked={checklist?.qualification_checked ?? false} label="Qualifications verified with the issuer (or none claimed)" />
          <CheckboxField name="communication" defaultChecked={checklist?.communication ?? false} label="Communicates clearly and kindly (written answers, and the call if you had one)" />
          <CheckboxField name="beginner_scenario" defaultChecked={checklist?.beginner_scenario ?? false} label="Handled a fictional busy-beginner client scenario sensibly" />
          <CheckboxField name="healthcare_referral" defaultChecked={checklist?.healthcare_referral ?? false} label="Recognises when to refer a client to a healthcare professional (pain, injury, medical conditions, pregnancy, disordered eating)" />
          <div className="flex flex-wrap items-center gap-4">
            <SubmitButton pendingLabel="Saving…" variant="secondary">Save checklist</SubmitButton>
            {checklist?.updated_at ? <span className="text-sm text-ink-muted">Last saved {formatDate(checklist.updated_at, tz, true)}</span> : null}
          </div>
        </ActionForm>
      </Section>

      <Section
        title="Decision"
        id="decision"
        description="Interviews are arranged by hand: email the applicant, set the status to Interview, and keep notes below. Approved, Waitlisted and Declined each email the applicant once; your reason is never included."
      >
        {next.length === 0 ? (
          <p className="text-ink-muted">
            {app.agreement_signed_at ? "The applicant has signed the coach agreement; their coach account now follows the coach review." : "No further changes are possible for this application."}
          </p>
        ) : (
          <ActionForm action={setApplicationStatusAction} className="grid gap-4 sm:max-w-xl">
            <input type="hidden" name="application_id" value={app.id} />
            <SelectField
              name="status"
              label={`Change from ${STATUS_LABEL[app.status]} to`}
              required
              options={next.map((s) => ({ value: s, label: `${STATUS_LABEL[s]}${EMAILED_STATUSES.includes(s) ? " — emails the applicant" : ""}` }))}
            />
            <TextArea name="reason" label="Private reason" required={false} rows={3} maxLength={1000} help="Kept in the history for administrators only. Never emailed or shown to the applicant." />
            <CheckboxField name="confirm" label="I understand Approved, Waitlisted and Declined send the applicant an email." />
            <div><SubmitButton pendingLabel="Saving…">Apply</SubmitButton></div>
          </ActionForm>
        )}
      </Section>

      {app.status === "approved" ? (
        <Section title="Onboarding" id="onboarding" description="Approval invites the applicant to read and sign the coach agreement. It doesn't activate them or show them any customer information.">
          <Details
            items={[
              ["Invitation emails sent", String(app.acceptance_sends)],
              ["Agreement", app.agreement_signed_at ? `Signed ${formatDate(app.agreement_signed_at, tz, true)} as “${app.agreement_signed_name}” (${app.agreement_version})` : "Not signed yet"],
              [
                "Coach account",
                provider ? (
                  <Link key="c" href={`/admin/coaches/${provider.id}`} className="text-brand underline">
                    {PROVIDER_STATUS_LABEL[provider.status] ?? provider.status} — open for final approval
                  </Link>
                ) : "Created when they sign",
              ],
            ]}
          />
          {!app.agreement_signed_at ? (
            <ActionForm action={resendAcceptanceAction} className="mt-5">
              <input type="hidden" name="application_id" value={app.id} />
              <SubmitButton pendingLabel="Sending…" variant="secondary">Send onboarding invitation again</SubmitButton>
            </ActionForm>
          ) : (
            <p className="mt-4 text-ink-muted">Next, they complete their profile, plans, availability and payout details and send them for review. You give final approval on the coach page; public listing still follows the coach&rsquo;s own publish setting and the Public coach profiles switch.</p>
          )}
        </Section>
      ) : null}

      <Section title="Private notes" id="notes" description="Administrators only. Never shown or emailed to the applicant.">
        <ActionForm action={addApplicationNoteAction} resetOnSuccess className="grid gap-3">
          <input type="hidden" name="application_id" value={app.id} />
          <TextArea name="body" label="Add a note" required rows={3} maxLength={4000} />
          <div><SubmitButton pendingLabel="Adding…" variant="secondary">Add note</SubmitButton></div>
        </ActionForm>
        <ul className="mt-6 grid gap-4">
          {(notes ?? []).map((n) => (
            <li key={n.id} className="rounded-lg border border-line p-4">
              <p className="whitespace-pre-line">{n.body}</p>
              <p className="mt-2 text-sm text-ink-muted">{emailOf(n.profiles)} · {formatDate(n.created_at, tz, true)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="History" id="history">
        <Table
          caption="Application history"
          head={["When", "Who", "What", "Change", "Private reason"]}
          empty="No history."
          rows={(events ?? []).map((e) => [
            formatDate(e.created_at, tz, true),
            e.actor_kind === "applicant" ? "Applicant" : emailOf(e.profiles),
            EVENT_LABEL[e.kind] ?? e.kind,
            e.from_status || e.to_status ? `${e.from_status ? STATUS_LABEL[e.from_status as ApplicationStatus] ?? e.from_status : "—"} → ${e.to_status ? STATUS_LABEL[e.to_status as ApplicationStatus] ?? e.to_status : "—"}` : "",
            e.reason ?? "",
          ])}
        />
      </Section>
    </div>
  );
}
