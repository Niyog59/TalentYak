import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendEmail,
  bookingConfirmationEmail,
  reminderEmail,
  recordingDeliveryEmail,
} from "@/lib/email";
import { getDownloadUrl } from "@/lib/recordings";

/**
 * Notification job queue. Verticals enqueue; the processor sends.
 * Kinds:
 *  - booking_confirmation  { customerName, serviceName }
 *  - reminder              { customerName, subjectLine, bodyHtml }
 *  - recording_delivery    { customerName, serviceName, recordingIds }
 */
export async function enqueueJob(args: {
  kind: string;
  recipientEmail: string;
  subject: string;
  payload: Record<string, unknown>;
  bookingId?: string;
  scheduledFor?: Date;
}) {
  const admin = createAdminClient();
  if (!admin) return;
  await admin.from("notification_jobs").insert({
    kind: args.kind,
    recipient_email: args.recipientEmail,
    subject: args.subject,
    payload: args.payload,
    booking_id: args.bookingId ?? null,
    scheduled_for: (args.scheduledFor ?? new Date()).toISOString(),
  });
}

interface JobRow {
  id: string;
  kind: string;
  recipient_email: string;
  subject: string;
  payload: Record<string, unknown>;
}

/** Processes due jobs; returns counts. Called by Vercel Cron. */
export async function processDueJobs(): Promise<{
  sent: number;
  failed: number;
}> {
  const admin = createAdminClient();
  if (!admin) return { sent: 0, failed: 0 };

  const { data: jobs } = await admin
    .from("notification_jobs")
    .select("id, kind, recipient_email, subject, payload")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(50);

  let sent = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as JobRow[]) {
    try {
      const rendered = await renderJob(job);
      const ok = rendered
        ? await sendEmail({
            to: job.recipient_email,
            subject: rendered.subject,
            html: rendered.html,
          })
        : false;

      await admin
        .from("notification_jobs")
        .update(
          ok
            ? { status: "sent", sent_at: new Date().toISOString() }
            : { status: "failed", error: "send failed or unconfigured" },
        )
        .eq("id", job.id);
      ok ? sent++ : failed++;
    } catch (err) {
      await admin
        .from("notification_jobs")
        .update({ status: "failed", error: String(err) })
        .eq("id", job.id);
      failed++;
    }
  }

  return { sent, failed };
}

async function renderJob(
  job: JobRow,
): Promise<{ subject: string; html: string } | null> {
  const p = job.payload;
  switch (job.kind) {
    case "booking_confirmation":
      return bookingConfirmationEmail({
        customerName: String(p.customerName ?? "friend"),
        serviceName: String(p.serviceName ?? "your service"),
      });
    case "reminder":
      return reminderEmail({
        customerName: String(p.customerName ?? "friend"),
        subjectLine: job.subject,
        bodyHtml: String(p.bodyHtml ?? ""),
      });
    case "recording_delivery": {
      const admin = createAdminClient();
      if (!admin) return null;
      const ids = (p.recordingIds ?? []) as string[];
      const { data: recs } = await admin
        .from("recordings")
        .select("id, r2_key, label")
        .in("id", ids);
      const links: { label: string; url: string }[] = [];
      for (const rec of recs ?? []) {
        const url = await getDownloadUrl(rec.r2_key);
        if (url) links.push({ label: rec.label ?? "Recording", url });
      }
      if (links.length === 0) return null;
      return recordingDeliveryEmail({
        customerName: String(p.customerName ?? "friend"),
        serviceName: String(p.serviceName ?? "your ceremony"),
        links,
      });
    }
    default:
      // Unknown kinds fail visibly rather than silently vanish.
      return null;
  }
}
