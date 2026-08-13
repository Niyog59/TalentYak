import "server-only";
import { Resend } from "resend";
import { env, isResendConfigured } from "@/lib/env";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!isResendConfigured()) return null;
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

/** Returns true on success; false when unconfigured or failed. */
export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  const client = getResend();
  if (!client) return false;
  const { error } = await client.emails.send({
    from: env.emailFrom,
    to: args.to,
    subject: args.subject,
    html: args.html,
  });
  return !error;
}

/* ------------------------------------------------------------------ */
/* Templates — plain, dignified HTML matching the brand voice.        */
/* ------------------------------------------------------------------ */

function shell(body: string): string {
  return `
<div style="background:#F5F3EF;padding:40px 16px;font-family:Georgia,serif;color:#1B2A4A">
  <div style="max-width:560px;margin:0 auto">
    <p style="font-size:20px;letter-spacing:-0.01em;margin:0 0 24px">Ghartira <span style="color:#8a8579;font-size:14px">घरतिर</span></p>
    <div style="border-top:1px solid #DDD6CB;padding-top:24px;font-size:15px;line-height:1.7">
      ${body}
    </div>
    <p style="margin-top:32px;font-size:12px;color:#8a8579">
      Ghartira · Houston, Texas &amp; Kathmandu, Nepal ·
      <a href="mailto:hello@ghartira.com" style="color:#B8734A">hello@ghartira.com</a>
    </p>
  </div>
</div>`;
}

export function bookingConfirmationEmail(vars: {
  customerName: string;
  serviceName: string;
}): { subject: string; html: string } {
  return {
    subject: `We received your booking — ${vars.serviceName}`,
    html: shell(`
      <p>Dear ${vars.customerName},</p>
      <p>Thank you. We have received your booking for <strong>${vars.serviceName}</strong>.</p>
      <p>A coordinator will review the details and contact you within 24 hours
      to confirm everything — nothing is scheduled until you approve it.</p>
      <p>If anything is urgent, reply to this email directly.</p>
      <p>— Ghartira</p>
    `),
  };
}

export function reminderEmail(vars: {
  customerName: string;
  subjectLine: string;
  bodyHtml: string;
}): { subject: string; html: string } {
  return {
    subject: vars.subjectLine,
    html: shell(`
      <p>Dear ${vars.customerName},</p>
      ${vars.bodyHtml}
      <p>— Ghartira</p>
    `),
  };
}

export function recordingDeliveryEmail(vars: {
  customerName: string;
  serviceName: string;
  links: { label: string; url: string }[];
}): { subject: string; html: string } {
  const linksHtml = vars.links
    .map(
      (l) =>
        `<p><a href="${l.url}" style="color:#B8734A">${l.label}</a></p>`,
    )
    .join("");
  return {
    subject: `Your recording — ${vars.serviceName}`,
    html: shell(`
      <p>Dear ${vars.customerName},</p>
      <p>The recording of <strong>${vars.serviceName}</strong> is ready.
      It is yours to keep, always included:</p>
      ${linksHtml}
      <p>These links are valid for 7 days — download and keep copies.
      If a link expires, reply and we will send a fresh one.</p>
      <p>— Ghartira</p>
    `),
  };
}
