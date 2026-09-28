import type { Metadata } from "next";
import { requireOnboarded } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel } from "@/components/ui/panel";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea } from "@/components/form/fields";
import { MediaUploader } from "@/components/media/uploader";
import { RetryProcessingButton } from "@/components/media/retry-button";
import { LINK_SECONDS } from "@/lib/media";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from "@/lib/media/sniff";
import { formatDate } from "@/lib/format";
import { deleteMediaAction, requestDeletionAction } from "./actions";

export const metadata: Metadata = { title: "Your photos and clips" };
export const dynamic = "force-dynamic";

interface Report {
  source?: { bytes?: number; width?: number; height?: number };
  output?: { bytes?: number; width?: number; height?: number };
  permanent?: boolean;
}

interface Row {
  id: string;
  purpose: string;
  media_kind: string;
  state: string;
  failure_reason: string | null;
  metadata_stripped: boolean;
  source_path: string | null;
  processing_attempts: number;
  processing_report: Report | null;
  recorded_at: string;
}

const PURPOSE_LABEL: Record<string, string> = {
  progress_photo: "Progress photo",
  form_review_clip: "Form review clip",
  chat_attachment: "Attachment",
  food_photo: "Food photo",
  checkin_attachment: "Check-in attachment",
};

const STATE_LABEL: Record<string, string> = {
  reserved: "Upload not finished",
  uploaded: "Processing",
  processing: "Processing",
  failed: "Couldn't be used",
};

const mb = (bytes?: number) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "—");

export default async function MediaPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
        <h1 className="font-display text-5xl">Your photos and clips</h1>
        <p className="mt-4 text-lg text-ink-muted">Accounts aren&rsquo;t available in this environment.</p>
      </div>
    );
  }

  const session = await requireOnboarded("/account/media");
  const supabase = (await createClient())!;

  // Row-level security scopes this to the owner. The customer's own media is
  // theirs for as long as they have an account, whoever is coaching them now.
  const { data } = await supabase
    .from("media_assets")
    .select("id, purpose, media_kind, state, failure_reason, metadata_stripped, source_path, processing_attempts, processing_report, recorded_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as Row[];
  const pending = rows.some((r) => r.state === "uploaded" || r.state === "processing");

  // Which coaching relationship new uploads belong to. That, and the date, is
  // what decides whether a future coach may ever see them.
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .in("state", ["active", "paused"])
    .limit(1)
    .maybeSingle();

  // An open deletion request, if there is one. RLS scopes this to the person.
  const { data: openRequest } = await supabase
    .from("deletion_requests")
    .select("id, state, requested_at")
    .in("state", ["received", "in_review"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      {/* While something is processing, re-read the page so it appears when ready. */}
      {pending ? <AutoRefresh everySeconds={5} forSeconds={300} /> : null}

      <PageHeader title="Your photos and clips">
        <p>
          Progress photos and form-review clips. These are yours: they stay with your account if you
          change coach, and you can delete any of them at any time.
        </p>
      </PageHeader>

      <nav aria-label="Account" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/account" variant="secondary" size="sm">Your account</ButtonLink>
        <ButtonLink href="/account/notifications" variant="secondary" size="sm">Notifications</ButtonLink>
      </nav>

      <Panel
        title="Add something"
        description="Before anything is shown to your coach, photos are re-saved and clips are re-encoded, which removes location, device details and other hidden information, and makes them smaller."
        className="mt-8"
      >
        <MediaUploader
          purpose="progress_photo"
          enrollmentId={enrollment?.id ?? null}
          label="Choose a photo or clip"
          help={`Photos: JPEG, HEIC (iPhone), PNG, WebP or AVIF, up to ${MAX_PHOTO_BYTES / 1048576} MB. Clips: MP4, MOV or WebM, up to ${MAX_VIDEO_BYTES / 1048576} MB and ${MAX_VIDEO_SECONDS / 60} minutes.`}
        />
        {!enrollment ? (
          <p className="mt-3 text-sm text-ink-muted">
            You have no active coaching, so anything you add now is visible only to you until a
            coaching plan starts.
          </p>
        ) : null}
      </Panel>

      <section aria-labelledby="media-heading" className="mt-10">
        <h2 id="media-heading" className="text-2xl font-semibold">
          What you&rsquo;ve added
        </h2>

        {rows.length === 0 ? (
          <EmptyState icon="camera" title="Nothing yet" className="mt-4">
            Photos and clips you add appear here. Only you and your current coach can open them, and
            only ever through a link that expires.
          </EmptyState>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {rows.map((row) => {
              const label = PURPOSE_LABEL[row.purpose] ?? "File";
              const when = formatDate(row.recorded_at, session.profile.timezone);
              const report = row.processing_report;
              const retryable =
                row.state === "failed" && Boolean(row.source_path) && !report?.permanent && row.processing_attempts < 5;
              return (
                <li key={row.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{row.media_kind === "video" ? "Clip" : label}</p>
                      <p className="text-sm text-ink-muted">
                        <time dateTime={row.recorded_at}>{when}</time>
                      </p>
                    </div>
                    {row.state !== "ready" ? (
                      <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 text-sm text-ink-muted">
                        {STATE_LABEL[row.state] ?? row.state}
                      </span>
                    ) : null}
                  </div>

                  {row.state === "ready" && row.media_kind === "image" ? (
                    <a href={`/api/media/${row.id}`} className="mt-3 block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/media/${row.id}?variant=preview`}
                        alt={`${label} from ${when}`}
                        className="aspect-square w-full rounded-lg bg-brand-tint object-contain"
                      />
                    </a>
                  ) : null}

                  {row.state === "ready" && row.media_kind === "video" ? (
                    <video
                      controls
                      playsInline
                      preload="none"
                      poster={`/api/media/${row.id}?variant=preview`}
                      src={`/api/media/${row.id}`}
                      className="mt-3 aspect-square w-full rounded-lg bg-ink object-contain"
                      aria-label={`Clip from ${when}`}
                    />
                  ) : null}

                  {row.state === "uploaded" || row.state === "processing" ? (
                    <p className="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-ink-muted">
                      {row.media_kind === "video"
                        ? "Removing hidden details and making it smaller. Clips usually take under a minute."
                        : "Removing hidden details. This takes a few seconds."}
                      <br />
                      Only you can see it until it&rsquo;s done.
                    </p>
                  ) : null}

                  {row.state === "ready" && row.metadata_stripped && report?.source?.bytes && report.output?.bytes ? (
                    <p className="mt-2 text-sm text-ink-muted">
                      {mb(report.source.bytes)} → {mb(report.output.bytes)} · {report.output.width}×{report.output.height} ·
                      location and device details removed
                    </p>
                  ) : null}

                  {row.failure_reason ? <p className="mt-2 text-sm text-danger">{row.failure_reason}</p> : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.state === "ready" ? (
                      <ButtonLink href={`/api/media/${row.id}?download=1`} variant="secondary" size="sm" prefetch={false}>
                        Download
                      </ButtonLink>
                    ) : null}
                    {retryable ? <RetryProcessingButton id={row.id} /> : null}
                    {row.state !== "processing" ? (
                      <ActionForm action={deleteMediaAction}>
                        <input type="hidden" name="media_id" value={row.id} />
                        <SubmitButton variant="quiet" pendingLabel="Deleting…">Delete</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Panel title="Who can see these" className="mt-10">
        <ul className="list-disc space-y-2 pl-6 text-ink-muted">
          <li>You, always.</li>
          <li>
            Your <strong>current</strong> coach, for anything added while they have been coaching
            you. A coach who is no longer yours loses access immediately.
          </li>
          <li>
            A <strong>new</strong> coach sees photos and clips from before they took over only if
            you chose to share your full history when you changed coach.
          </li>
          <li>
            Nobody opens a file directly. Each view is a link that stops working after{" "}
            {LINK_SECONDS / 60} minutes.
          </li>
        </ul>
      </Panel>

      <Panel
        title="Ask us to delete your data"
        description="Deleting a single photo above is instant. This is for asking us to remove everything we hold about you."
        className="mt-6"
      >
        {openRequest ? (
          <p role="status" className="rounded-lg border border-line bg-brand-tint p-3">
            We received your request on {formatDate(openRequest.requested_at, session.profile.timezone)}.
            It is {openRequest.state === "in_review" ? "being reviewed" : "waiting to be reviewed"}. We&rsquo;ll
            confirm by email before anything is removed.
          </p>
        ) : (
          <ActionForm action={requestDeletionAction} noticeFirst>
            <p className="text-ink-muted">
              Your photos, clips and coaching records are deleted. Payment records are kept because
              the law requires it, with your name removed. We confirm by email before anything is
              removed.
            </p>
            <TextArea name="note" label="Anything we should know (optional)" required={false} maxLength={1000} className="mt-4" />
            <CheckboxField name="confirm" label="I want TalentYak to delete my data" className="mt-4" />
            <div className="mt-4">
              <SubmitButton variant="secondary" pendingLabel="Sending…">Send deletion request</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
