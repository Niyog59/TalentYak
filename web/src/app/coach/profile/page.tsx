import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { PROVIDER_STATUS_LABEL, formatDate } from "@/lib/format";
import { canonicalTimezone, timezoneOptions } from "@/lib/preferences";
import { coachPhotoUrl } from "@/lib/storage/photos";
import { saveProfileAction, setProfilePublishedAction, submitProfileAction, uploadPhotoAction } from "../actions";

export const metadata = { title: "Profile" };

export default async function CoachProfilePage() {
  const session = await requireCoach("/coach/profile");
  const { provider } = session;
  const supabase = (await createClient())!;

  const { data: profile } = await supabase
    .from("provider_public_profiles")
    .select("display_name, headline, bio, approach, specialties, languages, experience_since, photo_path, photo_pending_path, photo_pending_at, photo_review_note, row_version")
    .eq("provider_id", provider.id)
    .maybeSingle();

  if (!profile) {
    return (
      <Notice tone="bad">
        Your coach profile record is missing. Contact TalentYak support so it can be restored — nothing you do here can fix it.
      </Notice>
    );
  }

  // The pending photo lives in a private bucket: shown to its owner through a
  // short-lived signed link, never a public one.
  let pendingPreview: string | null = null;
  if (profile.photo_pending_path) {
    const { data } = await createAdminClient()!.storage.from("coach-photos-pending").createSignedUrl(profile.photo_pending_path, 300);
    pendingPreview = data?.signedUrl ?? null;
  }

  const photo = coachPhotoUrl(profile.photo_path);
  const canSubmit = ["onboarding", "invited"].includes(provider.status);
  const approved = provider.status === "approved" && !provider.suspended_at;
  const tzOptions = [{ value: "", label: "Choose your timezone" }, ...timezoneOptions().map((z) => ({ value: z, label: z.replaceAll("_", " ") }))];

  return (
    <div>
      <PageHeader title="Your profile">
        <p>
          What clients see when they choose a coach.{" "}
          <StatusPill tone={approved ? "good" : "neutral"}>{PROVIDER_STATUS_LABEL[provider.status]}</StatusPill>{" "}
          {provider.published_at ? <StatusPill tone="good">Public</StatusPill> : <StatusPill>Hidden</StatusPill>}
        </p>
      </PageHeader>

      {provider.published_at && provider.slug ? (
        <p className="mt-4">
          <Link href={`/coaches/${provider.slug}`} className="font-semibold text-brand underline underline-offset-4">
            View your public page
          </Link>
        </p>
      ) : null}

      <Panel title="About you" id="about">
        <ActionForm action={saveProfileAction} className="grid gap-5" noticeFirst>
          <input type="hidden" name="row_version" value={profile.row_version} />
          <TextField name="display_name" label="Name clients see" required defaultValue={profile.display_name} maxLength={80} autoComplete="name" />
          <TextField name="headline" label="Headline" required={false} defaultValue={profile.headline ?? ""} maxLength={200} help="One line, e.g. “Strength coaching for busy parents”." />
          <TextArea name="bio" label="About you" required defaultValue={profile.bio ?? ""} maxLength={4000} rows={6} help="A few sentences about your background and who you help. At least a couple of sentences before you submit." />
          <TextArea name="approach" label="How you coach" required={false} defaultValue={profile.approach ?? ""} maxLength={2000} rows={4} />
          <TextField name="specialties" label="Specialties" required={false} defaultValue={(profile.specialties ?? []).join(", ")} help="Separate with commas. Up to 12." />
          <TextField name="languages" label="Languages you coach in" required defaultValue={(profile.languages ?? []).join(", ")} help="Separate with commas, e.g. Nepali, English." />
          <TextField name="experience_since" label="Coaching since (year)" required={false} inputMode="numeric" maxLength={4} defaultValue={profile.experience_since ? profile.experience_since.slice(0, 4) : ""} />
          <SelectField name="timezone" label="Your timezone" required defaultValue={canonicalTimezone(provider.timezone ?? session.profile.timezone) ?? ""} options={tzOptions} help="Clients see call times converted from this." />
          <div>
            <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Photo" id="photo" description="A clear, recent photo of your face. It's checked before it appears publicly. Location data is removed from every upload.">
        <div className="flex flex-wrap items-start gap-6">
          <div>
            <p className="font-semibold">Public photo</p>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={`${profile.display_name}`} width={160} height={160} className="mt-2 size-40 rounded-xl object-cover" />
            ) : (
              <p className="mt-2 text-ink-muted">None yet.</p>
            )}
          </div>
          {pendingPreview ? (
            <div>
              <p className="font-semibold">Waiting for review</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingPreview} alt="Your photo waiting for review" width={160} height={160} className="mt-2 size-40 rounded-xl object-cover" />
              <p className="mt-1 text-sm text-ink-muted">Uploaded {formatDate(profile.photo_pending_at, provider.timezone, true)}</p>
            </div>
          ) : null}
        </div>
        {profile.photo_review_note ? (
          <Notice tone="bad">Your last photo wasn&rsquo;t approved: {profile.photo_review_note}</Notice>
        ) : null}
        <ActionForm action={uploadPhotoAction} className="mt-5 grid gap-4 sm:max-w-md">
          <div>
            <label htmlFor="photo-input" className="block font-semibold">Choose a photo</label>
            <input id="photo-input" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-2 block w-full text-sm" aria-describedby="photo-help" />
            <p id="photo-help" className="mt-1.5 text-sm text-ink-muted">JPEG, PNG or WebP, up to 5 MB.</p>
          </div>
          <CheckboxField name="consent" required label="I'm happy for this photo to appear on my public TalentYak profile." />
          <div>
            <SubmitButton pendingLabel="Uploading…" variant="secondary">Upload photo</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Review and visibility" id="visibility">
        {canSubmit ? (
          <>
            <p>When your profile is ready, submit it. TalentYak checks new coaches once; after approval you publish your own plans and prices.</p>
            <ActionForm action={submitProfileAction} className="mt-4">
              <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
            </ActionForm>
          </>
        ) : null}
        {provider.status === "submitted" || provider.status === "in_review" ? (
          <p>Your profile has been submitted and is waiting for review.</p>
        ) : null}
        {approved ? (
          <ActionForm action={setProfilePublishedAction} className="grid gap-3">
            <p>
              {provider.published_at
                ? "Your profile is public. Hiding it removes you from the coach list and closes new sign-ups. Existing clients are not affected."
                : "Your profile is approved but hidden. Make it public so clients can find you."}
            </p>
            <input type="hidden" name="publish" value={provider.published_at ? "false" : "true"} />
            <div>
              <SubmitButton pendingLabel="Saving…" variant={provider.published_at ? "secondary" : "primary"}>
                {provider.published_at ? "Hide my profile" : "Make my profile public"}
              </SubmitButton>
            </div>
          </ActionForm>
        ) : null}
        {provider.status === "suspended" ? <p>Your account is suspended, so your profile can&rsquo;t be made public.</p> : null}
      </Panel>
    </div>
  );
}
