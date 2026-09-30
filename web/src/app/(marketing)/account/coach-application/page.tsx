import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { featureAllowsMe } from "@/lib/features/server";
import { timezoneOptions } from "@/lib/preferences";
import { formatDate, PROVIDER_STATUS_LABEL } from "@/lib/format";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";
import { ApplicationForm, type ApplicationDefaults } from "@/components/coach-application/application-form";
import { Certificates, type CertificateRow } from "@/components/coach-application/certificates";
import { APPLICANT_STATUS, applicantCanEdit, type ApplicationStatus } from "@/lib/coach-applications/rules";
import { eraseApplicationAction, submitApplicationAction, withdrawApplicationAction } from "./actions";

export const metadata: Metadata = { title: "Your coach application", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE = "/account/coach-application";

interface Application extends ApplicationDefaults {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  withdrawn_reason: string | null;
  agreement_signed_at: string | null;
  provider_id: string | null;
  new_client_capacity: string;
}

const NOTICES: Record<string, string> = {
  saved: "Saved. Add any qualifications below, then send your application.",
  sent: "Application sent. We've emailed you a receipt, and we'll email you again when there's a decision.",
  deleted: "Your application and everything attached to it has been deleted.",
  declined: "Understood — you've chosen not to go ahead. Your certificate files are deleted, and you can delete the rest of your details below.",
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-6 flex gap-2 rounded-lg border border-line bg-brand-tint p-3 font-medium">
      <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success" />
      {children}
    </p>
  );
}

function StatusCard({ app, tz }: { app: Application; tz: string | null }) {
  const s = APPLICANT_STATUS[app.status];
  const withdrewAgreement = app.status === "withdrawn" && app.withdrawn_reason === "declined_agreement";
  return (
    <section aria-labelledby="status-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-brand">Status</p>
      <h2 id="status-heading" className="mt-1 font-display text-3xl">{withdrewAgreement ? "Closed" : s.label}</h2>
      <p className="mt-2 max-w-2xl text-ink-muted">
        {withdrewAgreement ? "You chose not to sign the coach agreement, so this application is closed." : s.detail}
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        {app.submitted_at ? `Sent ${formatDate(app.submitted_at, tz)}` : `Started ${formatDate(app.created_at, tz)}`}
        {app.decided_at && ["approved", "waitlisted", "declined"].includes(app.status) ? ` · Updated ${formatDate(app.decided_at, tz)}` : ""}
      </p>
    </section>
  );
}

export default async function CoachApplicationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireOnboarded(PAGE);
  const sp = await searchParams;
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;

  const { data: rows, error } = await supabase
    .from("coach_applications")
    .select("id, status, full_name, country, timezone, languages, specialties, experience_years, experience, online_experience, instagram, website, profile_url, availability, new_client_capacity, consistency_answer, created_at, submitted_at, decided_at, withdrawn_reason, agreement_signed_at, provider_id")
    .eq("profile_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(5);
  const apps = ((rows ?? []) as (Omit<Application, "new_client_capacity" | "online_experience" | "instagram" | "website" | "profile_url"> & {
    new_client_capacity: number | null;
    online_experience: string | null;
    instagram: string | null;
    website: string | null;
    profile_url: string | null;
  })[]).map((a) => ({
    ...a,
    new_client_capacity: a.new_client_capacity === null ? "" : String(a.new_client_capacity),
    online_experience: a.online_experience ?? "",
    instagram: a.instagram ?? "",
    website: a.website ?? "",
    profile_url: a.profile_url ?? "",
  })) as Application[];
  const open = apps.find((a) => !["declined", "withdrawn"].includes(a.status)) ?? null;
  const closed = open ? null : (apps[0] ?? null);
  const current = open ?? closed;
  const accepting = await featureAllowsMe("coach_applications");
  const notice = Object.keys(NOTICES).find((k) => sp[k]);

  let certificates: CertificateRow[] = [];
  if (current) {
    const { data } = await supabase.rpc("my_coach_application_certificates", { p_application: current.id });
    certificates = (data ?? []) as CertificateRow[];
  }

  const blankDefaults: ApplicationDefaults = {
    full_name: session.profile.full_name ?? "",
    country: "",
    timezone: session.profile.timezone ?? "",
    languages: [],
    specialties: [],
    experience_years: "",
    experience: "",
    online_experience: "",
    instagram: "",
    website: "",
    profile_url: "",
    availability: "",
    new_client_capacity: "",
    consistency_answer: "",
  };
  const zones = timezoneOptions();
  const alreadyCoach = Boolean(session.provider) && !open?.agreement_signed_at;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <p><Link href="/become-a-coach" className="text-brand underline underline-offset-4">← Become a coach</Link></p>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">Your coach application</h1>
      <p className="mt-3 text-lg text-ink-muted">Applying is free. We review applications when we have openings, and being accepted doesn&rsquo;t guarantee clients.</p>

      {notice ? <Notice>{NOTICES[notice]}</Notice> : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger bg-danger-tint p-3 font-medium">Your application couldn&rsquo;t be loaded. Refresh to try again.</p>
      ) : null}
      {!session.emailConfirmed ? (
        <p role="alert" className="mt-6 rounded-lg border border-danger bg-danger-tint p-3 font-medium">
          Confirm your email address first, using the link we sent you. <Link href="/account/confirm-email" className="underline">Send a new link</Link>.
        </p>
      ) : null}

      {alreadyCoach ? (
        <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-xl font-semibold">This account is already a TalentYak coach</h2>
          <p className="mt-2 text-ink-muted">There&rsquo;s no need to apply. Your coach area has everything you need.</p>
          <ButtonLink href="/coach" className="mt-5">Open your coach area</ButtonLink>
        </section>
      ) : current ? (
        <>
          <StatusCard app={current} tz={tz} />
          <CurrentApplication app={current} certificates={certificates} accepting={accepting} zones={zones} providerStatus={session.provider?.status ?? null} />
        </>
      ) : null}

      {!alreadyCoach && !open ? (
        accepting ? (
          <section aria-labelledby="apply-heading" className="mt-10">
            <h2 id="apply-heading" className="font-display text-3xl">{closed ? "Apply again" : "Apply to coach"}</h2>
            <p className="mt-2 text-ink-muted">
              Signed in as <strong>{session.email}</strong>. We&rsquo;ll use this address for your application. Required questions are marked; everything else is optional.
            </p>
            <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-8">
              <ApplicationForm applicationId={null} defaults={blankDefaults} timezones={zones} />
            </div>
          </section>
        ) : (
          <section className="mt-10 rounded-2xl border border-line bg-surface p-6">
            <h2 className="text-xl font-semibold">Applications are closed right now</h2>
            <p className="mt-2 text-ink-muted">We&rsquo;re not accepting new coach applications at the moment. Please check back later.</p>
          </section>
        )
      ) : null}
    </div>
  );
}

function CurrentApplication({
  app,
  certificates,
  accepting,
  zones,
  providerStatus,
}: {
  app: Application;
  certificates: CertificateRow[];
  accepting: boolean;
  zones: string[];
  providerStatus: string | null;
}) {
  const editable = applicantCanEdit(app.status);

  if (app.status === "approved") {
    if (!app.agreement_signed_at) {
      return (
        <section className="mt-6 rounded-2xl border border-brand/30 bg-brand-tint p-6">
          <h2 className="text-xl font-semibold">Next: read and sign the coach agreement</h2>
          <p className="mt-2">It explains how TalentYak works, what you earn and when you&rsquo;re paid, and what coaches agree to do. You can also choose not to go ahead.</p>
          <ButtonLink href={`${PAGE}/agreement`} className="mt-5">Read the agreement</ButtonLink>
        </section>
      );
    }
    const steps = [
      { label: "Coach agreement signed", done: true },
      { label: "Profile, plans, availability and payout details", done: providerStatus !== null && providerStatus !== "onboarding" },
      { label: "Final approval by TalentYak", done: providerStatus === "approved" },
    ];
    return (
      <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-xl font-semibold">Setting up your coach account</h2>
        <ol className="mt-4 grid gap-3">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3">
              <Icon name={s.done ? "check" : "clock"} className={`mt-0.5 size-5 shrink-0 ${s.done ? "text-success" : "text-ink-muted"}`} />
              <span>{s.label}{s.done ? "" : " — to do"}</span>
            </li>
          ))}
        </ol>
        {providerStatus ? <p className="mt-4 text-sm text-ink-muted">Coach account: {PROVIDER_STATUS_LABEL[providerStatus] ?? providerStatus}</p> : null}
        <ButtonLink href="/coach/profile" className="mt-5">Open your coach area</ButtonLink>
      </section>
    );
  }

  return (
    <>
      {app.status === "draft" ? (
        <section aria-labelledby="send-heading" className="mt-6 rounded-2xl border border-brand/30 bg-brand-tint p-6">
          <h2 id="send-heading" className="text-xl font-semibold">Ready to send?</h2>
          <p className="mt-2">Check your answers and qualifications below. You can still correct your application after sending it, until we make a decision.</p>
          {accepting ? (
            <ActionForm action={submitApplicationAction} className="mt-5 grid gap-3">
              <input type="hidden" name="application_id" value={app.id} />
              <div><SubmitButton pendingLabel="Sending…">Send my application</SubmitButton></div>
            </ActionForm>
          ) : (
            <p className="mt-3 font-semibold">Applications are closed right now, so this can&rsquo;t be sent yet. Your draft is saved.</p>
          )}
        </section>
      ) : null}

      <section id="qualifications" aria-labelledby="qualifications-heading" className="mt-10 scroll-mt-24">
        <h2 id="qualifications-heading" className="font-display text-3xl">Qualifications</h2>
        <p className="mt-2 text-ink-muted">
          Add up to five coaching or fitness qualifications. We check them with the organisation that issued them where we can; uploading a file doesn&rsquo;t mark it as checked.
        </p>
        <div className="mt-6">
          <Certificates applicationId={app.id} certificates={certificates} editable={editable} />
        </div>
      </section>

      {editable ? (
        <section aria-labelledby="answers-heading" className="mt-10">
          <h2 id="answers-heading" className="font-display text-3xl">Your answers</h2>
          <details className="mt-4 rounded-2xl border border-line bg-surface p-5 sm:p-8" open={app.status === "draft"}>
            <summary className="cursor-pointer font-semibold text-brand">{app.status === "draft" ? "Your answers" : "View or correct your answers"}</summary>
            <div className="mt-6">
              <ApplicationForm applicationId={app.id} defaults={app} timezones={zones} />
            </div>
          </details>
        </section>
      ) : null}

      <section aria-labelledby="leave-heading" className="mt-12 border-t border-line pt-8">
        <h2 id="leave-heading" className="text-xl font-semibold">Withdraw or delete</h2>
        {!["draft", "withdrawn", "declined"].includes(app.status) ? (
          <ActionForm action={withdrawApplicationAction} className="mt-4 grid gap-4 sm:max-w-xl">
            <input type="hidden" name="application_id" value={app.id} />
            <p className="text-ink-muted">Withdrawing stops the review and deletes your certificate files straight away.</p>
            <CheckboxField name="confirm" required label="I want to withdraw my application." />
            <div><SubmitButton pendingLabel="Withdrawing…" variant="secondary">Withdraw application</SubmitButton></div>
          </ActionForm>
        ) : null}
        <ActionForm action={eraseApplicationAction} className="mt-8 grid gap-4 sm:max-w-xl">
          <input type="hidden" name="application_id" value={app.id} />
          <p className="text-ink-muted">
            Deleting removes this application, your answers, your qualifications and their files for good. Your TalentYak account stays.
          </p>
          <CheckboxField name="confirm" required label="I want to delete my application and everything in it." />
          <div><SubmitButton pendingLabel="Deleting…" variant="secondary">Delete my application</SubmitButton></div>
        </ActionForm>
      </section>
    </>
  );
}
