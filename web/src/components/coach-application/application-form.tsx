"use client";

import Link from "next/link";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { ChoiceGroup } from "@/components/coach-application/choice-group";
import { saveApplicationAction } from "@/app/(marketing)/account/coach-application/actions";
import { COUNTRIES, EXPERIENCE_YEARS, LANGUAGES, LIMITS, SPECIALTIES } from "@/lib/coach-applications/rules";

/*
 * The coach application. Only what we use to decide is asked, and only the
 * essentials are required. Nothing here asks for bank details, identity
 * documents, client photos or client health information — and the form says
 * so, because people otherwise volunteer it.
 *
 * The form keeps everything typed when the server refuses it (ActionForm
 * submits through a transition), so a mistake in one field never costs the
 * rest of the answer.
 */

export interface ApplicationDefaults {
  full_name: string;
  country: string;
  timezone: string;
  languages: string[];
  specialties: string[];
  experience_years: string;
  experience: string;
  online_experience: string;
  instagram: string;
  website: string;
  profile_url: string;
  availability: string;
  new_client_capacity: string;
  consistency_answer: string;
}

function split(values: string[], known: readonly string[]) {
  const set = new Set(known.map((k) => k.toLowerCase()));
  return {
    ticked: values.filter((v) => set.has(v.toLowerCase())),
    other: values.filter((v) => !set.has(v.toLowerCase())).join(", "),
  };
}

function Group({ title, first = false, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <section className={`grid gap-6 ${first ? "" : "border-t border-line pt-8"}`}>
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ApplicationForm({
  applicationId,
  defaults,
  timezones,
}: {
  applicationId: string | null;
  defaults: ApplicationDefaults;
  timezones: string[];
}) {
  const langs = split(defaults.languages, LANGUAGES);
  const specs = split(defaults.specialties, SPECIALTIES);

  return (
    <ActionForm action={saveApplicationAction} noticeFirst className="grid gap-10">
      {applicationId ? <input type="hidden" name="application_id" value={applicationId} /> : null}

      <Group title="About you" first>
        <TextField name="full_name" label="Full name" required autoComplete="name" maxLength={LIMITS.full_name} defaultValue={defaults.full_name} />
        <div className="grid gap-6 sm:grid-cols-2">
          <SelectField
            name="country"
            label="Country you live in"
            required
            defaultValue={defaults.country}
            options={[{ value: "", label: "Choose…" }, ...COUNTRIES.map((c) => ({ value: c.value, label: c.label }))]}
          />
          <SelectField
            name="timezone"
            label="Your time zone"
            required
            defaultValue={defaults.timezone}
            options={[{ value: "", label: "Choose…" }, ...timezones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))]}
          />
        </div>
        <ChoiceGroup
          name="languages"
          legend="Languages you can coach in"
          help="Choose all that apply."
          options={LANGUAGES}
          selected={langs.ticked}
          otherLabel="Other languages"
          otherDefault={langs.other}
        />
      </Group>

      <Group title="Your coaching">
        <SelectField
          name="experience_years"
          label="How long have you been coaching?"
          required
          defaultValue={defaults.experience_years}
          options={[{ value: "", label: "Choose…" }, ...EXPERIENCE_YEARS.map((y) => ({ value: y.value, label: y.label }))]}
        />
        <TextArea
          name="experience"
          label="Your coaching experience"
          required
          rows={5}
          maxLength={LIMITS.experience}
          defaultValue={defaults.experience}
          help="Where you've coached, who you've worked with and what kind of results. Please don't include clients' names, photos or health details."
        />
        <ChoiceGroup
          name="specialties"
          legend="What you coach"
          help="Choose the areas you're confident coaching."
          options={SPECIALTIES}
          selected={specs.ticked}
          otherLabel="Other areas"
          otherDefault={specs.other}
        />
        <TextArea
          name="online_experience"
          label="Experience coaching online"
          required={false}
          rows={3}
          maxLength={LIMITS.online_experience}
          defaultValue={defaults.online_experience}
          help="For example, apps, video calls or messaging you've used with clients. It's fine if you haven't coached online yet."
        />
      </Group>

      <Group title="Where we can see your work">
        <p className="-mt-3 text-ink-muted">All optional. Your number of followers makes no difference to your application.</p>
        <TextField name="instagram" label="Instagram" required={false} maxLength={LIMITS.instagram} defaultValue={defaults.instagram} placeholder="@yourname" autoComplete="off" />
        <TextField name="website" label="Website" required={false} type="url" inputMode="url" maxLength={LIMITS.website} defaultValue={defaults.website} placeholder="https://" />
        <TextField name="profile_url" label="Another professional profile" required={false} type="url" inputMode="url" maxLength={LIMITS.profile_url} defaultValue={defaults.profile_url} placeholder="https://" help="For example LinkedIn, or a gym's staff page." />
      </Group>

      <Group title="Your time">
        <TextArea
          name="availability"
          label="Weekly availability"
          required
          rows={3}
          maxLength={LIMITS.availability}
          defaultValue={defaults.availability}
          help="Roughly which days and times you could coach, and about how many hours a week — in your own time zone."
        />
        <TextField
          name="new_client_capacity"
          label="How many new clients could you take on?"
          required={false}
          inputMode="numeric"
          maxLength={3}
          defaultValue={defaults.new_client_capacity}
          help="A rough number is fine. You'll set your own limit later."
          className="sm:max-w-xs"
        />
      </Group>

      <Group title="One question">
        <TextArea
          name="consistency_answer"
          label="How would you help a busy beginner stay consistent?"
          required
          rows={6}
          maxLength={LIMITS.consistency_answer}
          defaultValue={defaults.consistency_answer}
          help="A few sentences in your own words. There's no single right answer."
        />
      </Group>

      {applicationId ? null : (
        <CheckboxField
          name="privacy"
          required
          label={
            <>
              I&rsquo;ve read{" "}
              <Link href="/become-a-coach#privacy" className="text-brand underline underline-offset-4" target="_blank">
                how TalentYak uses my application
              </Link>
              .
            </>
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Saving…">{applicationId ? "Save changes" : "Save and continue"}</SubmitButton>
        {applicationId ? null : <p className="text-sm text-ink-muted">Next you can add qualifications, then send your application.</p>}
      </div>
    </ActionForm>
  );
}
