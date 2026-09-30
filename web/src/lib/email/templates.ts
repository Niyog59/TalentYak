/**
 * Every email TalentYak sends, as pure functions: data in, subject + HTML +
 * plain text out. No sending, no database — so each can be tested on its own.
 *
 * Rules applied to every template:
 *   · every interpolated value is escaped
 *   · a plain-text alternative is generated for every message
 *   · no health details in any subject line or preview (invariant 3)
 *   · no grief details anywhere (invariant 2)
 *   · no exclamation marks, no urgency, no tracking pixels
 */

import { escapeHtml, htmlToText, safeUrl } from "@/lib/email/escape";
import { formatMinorAsDecimal } from "@/lib/money/money";
import { isCurrencyCode } from "@/lib/money/currency";
import { coachTerms } from "@/lib/coach-agreement";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = "#124F43";
const INK = "#182B2A";
const MUTED = "#556563";
const PAPER = "#FCFCFA";
const LINE = "#DDD6CB";

function money(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  if (!isCurrencyCode(code)) return `${minor} ${escapeHtml(code)}`;
  return `${formatMinorAsDecimal(minor, code)} ${code}`;
}

function date(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timeZone || "UTC",
    }).format(new Date(iso)) + (timeZone ? "" : " (UTC)");
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * A moment, with its time and the zone it is stated in.
 *
 * The zone name is not decoration. The two people on a coaching call are in
 * Nepal and abroad, and a time with no zone is the single easiest way to make
 * somebody miss a session they paid for.
 */
function dateTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "";
  const zone = timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return `${iso.slice(0, 16).replace("T", " ")} UTC`;
  }
}

function button(href: string, label: string): string {
  const url = safeUrl(href);
  if (!url) return "";
  return `<p style="margin:28px 0"><a href="${url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:${MUTED}">If the button does not work, copy this address into your browser:<br>${url}</p>`;
}

function shell(bodyHtml: string, supportEmail?: string | null): string {
  const contact = supportEmail
    ? ` · <a href="mailto:${escapeHtml(supportEmail)}" style="color:${BRAND}">${escapeHtml(supportEmail)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${PAPER}">
<div style="padding:40px 16px;font-family:Arial,Helvetica,sans-serif;color:${INK}">
  <div style="max-width:560px;margin:0 auto">
    <p style="margin:0 0 24px;font-size:24px;font-weight:700;color:${BRAND}">TalentYak</p>
    <div style="border-top:1px solid ${LINE};padding-top:24px;font-size:16px;line-height:1.6">${bodyHtml}</div>
    <p style="margin-top:32px;font-size:13px;color:${MUTED}">TalentYak${contact}</p>
  </div>
</div></body></html>`;
}

function build(subject: string, body: string, supportEmail?: string | null): RenderedEmail {
  const html = shell(body, supportEmail);
  return { subject, html, text: htmlToText(html) };
}

const greet = (name?: string | null) => `<p>Hello${name ? ` ${escapeHtml(name)}` : ""},</p>`;

export interface TemplateContext {
  siteUrl: string;
  supportEmail?: string | null;
}

// ---------------------------------------------------------------------------

export function coachInvitationEmail(
  ctx: TemplateContext,
  d: { inviteUrl: string; expiresAt: string },
): RenderedEmail {
  return build(
    "You're invited to coach on TalentYak",
    `${greet()}
<p>You've been invited to join TalentYak as a coach.</p>
<p>On TalentYak you create your own plans, set your own prices and decide what each plan includes. TalentYak handles finding clients, taking payment and support, and keeps ${escapeHtml(coachTerms().ongoingCommission)} of what customers pay for ongoing coaching.</p>
<p>Accepting creates your coach account. Your profile is reviewed before it is shown to customers.</p>
${button(d.inviteUrl, "Accept invitation")}
<p style="color:${MUTED}">This invitation works once and expires on ${escapeHtml(date(d.expiresAt))}. It was sent to this address, and it can only be accepted by signing in with it.</p>`,
    ctx.supportEmail,
  );
}

export function purchaseConfirmedEmail(
  ctx: TemplateContext,
  d: {
    customerName?: string | null;
    coachName: string;
    planTitle: string;
    amountMinor: number;
    currency: string;
    recurring: boolean;
    paidThrough?: string | null;
    timezone?: string | null;
  },
): RenderedEmail {
  return build(
    `Your plan with ${d.coachName} is confirmed`,
    `${greet(d.customerName)}
<p>Your payment went through and your plan is active.</p>
<table style="border-collapse:collapse;margin:16px 0">
<tr><td style="padding:4px 16px 4px 0;color:${MUTED}">Coach</td><td>${escapeHtml(d.coachName)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:${MUTED}">Plan</td><td>${escapeHtml(d.planTitle)}</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:${MUTED}">Paid</td><td>${escapeHtml(money(d.amountMinor, d.currency))}${d.recurring ? " per month" : ""}</td></tr>
${d.paidThrough ? `<tr><td style="padding:4px 16px 4px 0;color:${MUTED}">Paid through</td><td>${escapeHtml(date(d.paidThrough, d.timezone))}</td></tr>` : ""}
</table>
${d.recurring ? "<p>This plan renews monthly. You can cancel any time from your billing page; the time you've already paid for continues until its end date.</p>" : ""}
${button(`${ctx.siteUrl}/account/billing`, "View billing")}`,
    ctx.supportEmail,
  );
}

export function newClientEmail(
  ctx: TemplateContext,
  d: { coachName?: string | null; planTitle: string; customerFirstName?: string | null },
): RenderedEmail {
  return build(
    "You have a new client on TalentYak",
    `${greet(d.coachName)}
<p>${d.customerFirstName ? escapeHtml(d.customerFirstName) : "A new client"} has started your plan <strong>${escapeHtml(d.planTitle)}</strong>.</p>
${button(`${ctx.siteUrl}/coach`, "Open your coach area")}`,
    ctx.supportEmail,
  );
}

export function paymentFailedEmail(
  ctx: TemplateContext,
  d: { customerName?: string | null; planTitle: string; paidThrough?: string | null; timezone?: string | null },
): RenderedEmail {
  return build(
    "We couldn't take your renewal payment",
    `${greet(d.customerName)}
<p>Your renewal for <strong>${escapeHtml(d.planTitle)}</strong> didn't go through. Card providers sometimes decline payments for reasons that have nothing to do with you.</p>
${d.paidThrough ? `<p>Your plan continues until ${escapeHtml(date(d.paidThrough, d.timezone))}, the end of the time you've already paid for. Nothing you've recorded has been lost.</p>` : ""}
<p>You can update your payment details from your billing page.</p>
${button(`${ctx.siteUrl}/account/billing`, "Update payment details")}`,
    ctx.supportEmail,
  );
}

export function subscriptionCancellingEmail(
  ctx: TemplateContext,
  d: { customerName?: string | null; planTitle: string; endsAt?: string | null; timezone?: string | null },
): RenderedEmail {
  return build(
    "Your plan won't renew",
    `${greet(d.customerName)}
<p>Your plan <strong>${escapeHtml(d.planTitle)}</strong> is set to end${d.endsAt ? ` on ${escapeHtml(date(d.endsAt, d.timezone))}` : ""}. You won't be charged again.</p>
<p>Cancelling isn't a refund, and it doesn't delete your account or your history.</p>
${button(`${ctx.siteUrl}/account/billing`, "View billing")}`,
    ctx.supportEmail,
  );
}

export function subscriptionEndedEmail(
  ctx: TemplateContext,
  d: { customerName?: string | null; planTitle: string },
): RenderedEmail {
  return build(
    "Your plan has ended",
    `${greet(d.customerName)}
<p>Your plan <strong>${escapeHtml(d.planTitle)}</strong> has ended. Your account and your history are still here.</p>
${button(`${ctx.siteUrl}/coaches`, "Browse coaches")}`,
    ctx.supportEmail,
  );
}

export function refundProcessedEmail(
  ctx: TemplateContext,
  d: { customerName?: string | null; amountMinor: number; currency: string },
): RenderedEmail {
  return build(
    "Your refund has been processed",
    `${greet(d.customerName)}
<p>We've refunded ${escapeHtml(money(d.amountMinor, d.currency))} to your original payment method. Banks usually take 5 to 10 business days to show it.</p>`,
    ctx.supportEmail,
  );
}

export function coachChangedCustomerEmail(
  ctx: TemplateContext,
  d: { customerName?: string | null; newCoachName: string; effectiveAt: string; timezone?: string | null },
): RenderedEmail {
  return build(
    "Your coach change is confirmed",
    `${greet(d.customerName)}
<p>From ${escapeHtml(date(d.effectiveAt, d.timezone))}, your coach is <strong>${escapeHtml(d.newCoachName)}</strong>. Your plan and price haven't changed.</p>`,
    ctx.supportEmail,
  );
}

export function coachChangedPreviousCoachEmail(
  ctx: TemplateContext,
  d: { coachName?: string | null; effectiveAt: string },
): RenderedEmail {
  return build(
    "A client has moved to another coach",
    `${greet(d.coachName)}
<p>At the client's request, one of your clients moved to another coach from ${escapeHtml(date(d.effectiveAt))}. Earnings for coaching you delivered remain yours.</p>`,
    ctx.supportEmail,
  );
}

export function coachChangedNewCoachEmail(
  ctx: TemplateContext,
  d: { coachName?: string | null; effectiveAt: string },
): RenderedEmail {
  return build(
    "You have a new client on TalentYak",
    `${greet(d.coachName)}
<p>A client has moved to you from another coach, from ${escapeHtml(date(d.effectiveAt))}.</p>
${button(`${ctx.siteUrl}/coach`, "Open your coach area")}`,
    ctx.supportEmail,
  );
}

export function payoutPaidEmail(
  ctx: TemplateContext,
  d: { coachName?: string | null; amountMinor: number; currency: string; paidAt: string; reference?: string | null },
): RenderedEmail {
  return build(
    "A payout has been sent",
    `${greet(d.coachName)}
<p>A payout of ${escapeHtml(money(d.amountMinor, d.currency))} was recorded as sent on ${escapeHtml(date(d.paidAt))}. How long it takes to arrive depends on the transfer route.</p>
${d.reference ? `<p>Transfer reference: <strong>${escapeHtml(d.reference)}</strong>. Quote this if you need to ask your bank or transfer service about it.</p>` : ""}
${button(`${ctx.siteUrl}/coach/earnings`, "View earnings")}`,
    ctx.supportEmail,
  );
}

export function profileApprovedEmail(ctx: TemplateContext, d: { coachName?: string | null }): RenderedEmail {
  return build(
    "Your coach profile is approved",
    `${greet(d.coachName)}
<p>Your coach profile has been approved. You can now publish it, publish your plans, and choose when to accept new clients.</p>
${button(`${ctx.siteUrl}/coach`, "Open your coach area")}`,
    ctx.supportEmail,
  );
}

export function adminAlertEmail(ctx: TemplateContext, d: { title: string; detail: string; path: string }): RenderedEmail {
  return build(
    `Needs attention: ${d.title}`,
    `<p>${escapeHtml(d.detail)}</p>${button(`${ctx.siteUrl}${d.path}`, "Open the founder console")}`,
    ctx.supportEmail,
  );
}

export function retentionNoticeEmail(
  ctx: TemplateContext,
  d: { daysBefore: number; deletionDueAt: string; resourceLabel: string; timezone?: string | null },
): RenderedEmail {
  return build(
    `Some of your TalentYak data is scheduled for deletion in ${d.daysBefore} day${d.daysBefore === 1 ? "" : "s"}`,
    `${greet()}
<p>Your ${escapeHtml(d.resourceLabel)} is scheduled to be deleted on ${escapeHtml(date(d.deletionDueAt, d.timezone))}, because it has passed the period we keep it for.</p>
<p>If you'd like a copy first, you can request an export before that date.</p>
${button(`${ctx.siteUrl}/account`, "Review your data")}`,
    ctx.supportEmail,
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
//
// A session email states the time in the recipient's own zone and names the
// zone, because the two people on a call are in Nepal and in North America or
// Australia, and "3pm" alone has sent somebody to the wrong hour before.

export function appointmentConfirmedEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; timezone?: string | null; path?: string },
): RenderedEmail {
  return build(
    "Your session is booked",
    `${greet(d.name)}
<p>Your session with ${escapeHtml(d.otherPartyName)} is booked for <strong>${escapeHtml(dateTime(d.startsAt, d.timezone))}</strong>.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "View your sessions")}`,
    ctx.supportEmail,
  );
}

export function appointmentChangedEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; previousStartsAt?: string | null; timezone?: string | null; path?: string },
): RenderedEmail {
  return build(
    "Your session has moved",
    `${greet(d.name)}
<p>Your session with ${escapeHtml(d.otherPartyName)} has been moved${
      d.previousStartsAt ? ` from ${escapeHtml(dateTime(d.previousStartsAt, d.timezone))}` : ""
    } to <strong>${escapeHtml(dateTime(d.startsAt, d.timezone))}</strong>.</p>
<p>Nothing else about your plan changes.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "View your sessions")}`,
    ctx.supportEmail,
  );
}

export function appointmentCancelledEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; byCoach: boolean; timezone?: string | null; path?: string },
): RenderedEmail {
  return build(
    "Your session has been cancelled",
    `${greet(d.name)}
<p>The session with ${escapeHtml(d.otherPartyName)} on ${escapeHtml(dateTime(d.startsAt, d.timezone))} has been cancelled${
      d.byCoach ? " by your coach" : ""
    }.</p>
<p>You can arrange another time with them whenever it suits you both.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "See your sessions")}`,
    ctx.supportEmail,
  );
}

/**
 * What was recorded about a session. The outcome in plain words, a link, and
 * how to say it's wrong. The note the coach may have written stays in the app.
 */
export function sessionOutcomeEmail(
  ctx: TemplateContext,
  d: {
    name?: string | null;
    otherPartyName: string;
    startsAt: string;
    timezone?: string | null;
    outcomeLabel: string;
    technical: boolean;
    correction: boolean;
    byTalentYak: boolean;
    forCoach: boolean;
    path?: string;
  },
): RenderedEmail {
  const who = d.byTalentYak ? "TalentYak" : escapeHtml(d.otherPartyName);
  const help = d.technical
    ? `<p>A technical problem is never counted against you. From the session page you can try the call again while its room is open, message ${d.forCoach ? "your client" : "your coach"}, suggest a new time, or tell TalentYak what happened.</p>`
    : d.forCoach
      ? ""
      : `<p>If this isn't right, open the session and choose &ldquo;This isn&rsquo;t right&rdquo;. TalentYak will look into it; nothing is changed without a record.</p>`;
  return build(
    d.correction ? "A session record was corrected" : "Your session has been recorded",
    `${greet(d.name)}
<p>${who} ${d.correction ? "corrected the record of" : "recorded"} your session${d.forCoach ? "" : ` with ${escapeHtml(d.otherPartyName)}`} on ${escapeHtml(dateTime(d.startsAt, d.timezone))} as: <strong>${escapeHtml(d.outcomeLabel)}</strong>.</p>
${help}
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "Open the session")}`,
    ctx.supportEmail,
  );
}

export function appointmentReminderEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; timezone?: string | null; path?: string },
): RenderedEmail {
  return build(
    "A reminder about your session",
    `${greet(d.name)}
<p>Your session with ${escapeHtml(d.otherPartyName)} is at <strong>${escapeHtml(dateTime(d.startsAt, d.timezone))}</strong>.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "View your sessions")}
<p style="font-size:13px;color:${MUTED}">You can turn session reminders off in your email settings. Booking changes and cancellations will still reach you.</p>`,
    ctx.supportEmail,
  );
}

export function reservationExpiredEmail(
  ctx: TemplateContext,
  d: { name?: string | null; startsAt: string; timezone?: string | null },
): RenderedEmail {
  return build(
    "A held session time has been released",
    `${greet(d.name)}
<p>The time you were holding — ${escapeHtml(dateTime(d.startsAt, d.timezone))} — has been released, because the booking was not finished.</p>
<p>Nothing was charged. The time may still be free.</p>
${button(`${ctx.siteUrl}/account`, "Book a session")}`,
    ctx.supportEmail,
  );
}

/**
 * Scheduling (M09). Like every session email: the time in the recipient's own
 * zone with the zone named, the other person's name, a link — and nothing
 * about what the session is for.
 */
export function appointmentProposedEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; timezone?: string | null; reschedule: boolean; weekly: boolean; path: string },
): RenderedEmail {
  return build(
    d.reschedule ? "A new time has been suggested for your session" : "A session time has been suggested",
    `${greet(d.name)}
<p>${escapeHtml(d.otherPartyName)} suggested ${d.weekly ? "a weekly session starting" : "a session at"} <strong>${escapeHtml(dateTime(d.startsAt, d.timezone))}</strong>${d.reschedule ? " in place of your current time" : ""}.</p>
<p>Nothing is booked until you accept. You can also suggest another time.</p>
${button(`${ctx.siteUrl}${d.path}`, "Answer the suggestion")}`,
    ctx.supportEmail,
  );
}

export function appointmentProposalUpdateEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; timezone?: string | null; state: string; path: string },
): RenderedEmail {
  const what = d.state === "declined" ? `${escapeHtml(d.otherPartyName)} declined the time you suggested`
    : d.state === "expired" ? "The time you suggested wasn't answered in time, so it has lapsed"
    : d.state === "conflicted" ? "The time you suggested couldn't be confirmed, because it was no longer free"
    : "Your suggested time has been answered";
  return build(
    "About the session time you suggested",
    `${greet(d.name)}
<p>${what} (${escapeHtml(dateTime(d.startsAt, d.timezone))}).</p>
<p>Nothing was booked. You can suggest another time.</p>
${button(`${ctx.siteUrl}${d.path}`, "Suggest another time")}`,
    ctx.supportEmail,
  );
}

export function appointmentOnHoldEmail(
  ctx: TemplateContext,
  d: { name?: string | null; otherPartyName: string; startsAt: string; timezone?: string | null; reason: string; path: string },
): RenderedEmail {
  const why = d.reason === "payment_paused" ? "coaching is paused until the payment is sorted. It comes back if the payment goes through and the time is still free"
    : d.reason === "conflict" ? "something else is now booked at that time. Please agree a new time"
    : d.reason === "payment_issue" ? "there's a problem with the payment for it"
    : "an account involved needs attention from TalentYak support";
  return build(
    "A session is on hold",
    `${greet(d.name)}
<p>Your session with ${escapeHtml(d.otherPartyName)} on ${escapeHtml(dateTime(d.startsAt, d.timezone))} is on hold, because ${why}.</p>
${button(`${ctx.siteUrl}${d.path}`, "See the session")}`,
    ctx.supportEmail,
  );
}

export function consultationNeedsRebookingEmail(ctx: TemplateContext, d: { name?: string | null }): RenderedEmail {
  return build(
    "Your payment arrived after the held time was released",
    `${greet(d.name)}
<p>Your payment for a one-off session came through after the time you chose had been released, so that time wasn't kept for you.</p>
<p>Nothing has been lost: TalentYak will help you choose a new time, or refund you if you'd prefer. You don't need to do anything yet.</p>
${button(`${ctx.siteUrl}/account/appointments`, "See your sessions")}`,
    ctx.supportEmail,
  );
}

export function consultationRebookEmail(ctx: TemplateContext, d: { name?: string | null }): RenderedEmail {
  return build(
    "Choose a new time for your session",
    `${greet(d.name)}
<p>Your one-off session is ready to be booked again. Choose a time that suits you.</p>
${button(`${ctx.siteUrl}/account/appointments`, "Choose a time")}`,
    ctx.supportEmail,
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * WHAT THIS DELIBERATELY DOES NOT CONTAIN: the message. Not in the subject,
 * not in the body, not in a preview line. A coaching conversation carries
 * injuries, weights, and what somebody is struggling with — invariant 3. The
 * email says that a message is waiting and where to read it, and nothing else.
 */
export function unreadMessagesEmail(
  ctx: TemplateContext,
  d: { name?: string | null; fromName: string; count: number; path?: string },
): RenderedEmail {
  const plural = d.count === 1 ? "message" : "messages";
  return build(
    `You have ${d.count} unread ${plural} on TalentYak`,
    `${greet(d.name)}
<p>${escapeHtml(d.fromName)} sent you ${d.count} ${plural} you haven't read yet.</p>
<p>They're in your TalentYak messages — we don't include what was said in email.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "Read your messages")}
<p style="font-size:13px;color:${MUTED}">You can turn these emails off in your email settings.</p>`,
    ctx.supportEmail,
  );
}

export function expectationsUpdatedEmail(
  ctx: TemplateContext,
  d: { name?: string | null; coachName: string; path?: string },
): RenderedEmail {
  return build(
    "An updated welcome & expectations from your coach",
    `${greet(d.name)}
<p>${escapeHtml(d.coachName)} has shared an updated Coaching Welcome &amp; Expectations — what you and your coach can expect from each other. Please read it when you have a moment.</p>
<p>Your price, your plan and your coaching haven't changed, and nothing is paused while you read it.</p>
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account"}`, "Read what changed")}
<p style="font-size:13px;color:${MUTED}">You can turn these emails off in your email settings.</p>`,
    ctx.supportEmail,
  );
}

/**
 * A plan version was published, or a planned update was cancelled. Names the
 * coach and when it starts — never what the plan says, which may describe an
 * injury or a diet.
 */
export function planUpdatedEmail(
  ctx: TemplateContext,
  d: { name?: string | null; coachName: string; kind: "workout" | "nutrition"; event: "published" | "withdrawn"; first: boolean; startsLabel: string | null; path?: string },
): RenderedEmail {
  const what = d.kind === "workout" ? "workout plan" : "nutrition plan";
  const subject =
    d.event === "withdrawn"
      ? `A planned change to your ${what} was cancelled`
      : d.first
        ? `Your ${what} is ready`
        : d.startsLabel
          ? `Your ${what} changes on ${d.startsLabel}`
          : `Your ${what} has been updated`;
  const body =
    d.event === "withdrawn"
      ? `<p>${escapeHtml(d.coachName)} cancelled a planned change to your ${what}. Nothing changes: keep following your current plan.</p>`
      : d.first
        ? `<p>${escapeHtml(d.coachName)} has written your ${what}${d.startsLabel ? `, starting ${escapeHtml(d.startsLabel)}` : ""}.</p>`
        : `<p>${escapeHtml(d.coachName)} has updated your ${what}${d.startsLabel ? `. The new version starts ${escapeHtml(d.startsLabel)}; until then, keep following your current plan` : ""}. Your coach's note about what changed is on the plan page.</p>
<p>Anything you've already done stays exactly as it was.</p>`;
  return build(
    subject,
    `${greet(d.name)}
${body}
${button(`${ctx.siteUrl}${d.path?.startsWith("/") ? d.path : "/account/plan"}`, "Open your plan")}
<p style="font-size:13px;color:${MUTED}">You can turn these emails off in your email settings.</p>`,
    ctx.supportEmail,
  );
}

/**
 * Check-in notices. A summary and a link: never an answer, a photo, a
 * weight, or anything the client or coach wrote.
 */
export type CheckinNoticeEvent = "due_soon" | "late" | "submitted" | "corrected" | "review_overdue" | "transferred" | "feedback" | "closed";

export function checkinNoticeEmail(
  ctx: TemplateContext,
  d: { event: CheckinNoticeEvent; name?: string | null; clientName?: string | null; coachName?: string | null; dueAt?: string | null; timeZone?: string | null; path: string },
): RenderedEmail {
  const client = escapeHtml(d.clientName || "Your client");
  const coach = escapeHtml(d.coachName || "Your coach");
  const due = d.dueAt ? dateTime(d.dueAt, d.timeZone) : "";
  const copy: Record<CheckinNoticeEvent, [string, string, string]> = {
    due_soon: ["Your check-in is due soon", `<p>Your check-in for ${coach} is due ${escapeHtml(due)}. It takes about two minutes, and your workouts, weight and food diary are added for you.</p><p>If it's not a good week, that's fine — missing one never affects your coaching.</p>`, "Open your check-in"],
    late: ["Your check-in is still open", `<p>Your check-in for ${coach} is still open. Late is fine — send it whenever suits you, or leave it.</p>`, "Open your check-in"],
    submitted: [`${d.clientName || "A client"} sent a check-in`, `<p>${client} sent a check-in. Their answers and the period's progress are waiting for you.</p>`, "Review the check-in"],
    corrected: [`${d.clientName || "A client"} updated a check-in`, `<p>${client} changed something in a check-in that may matter for your feedback. The original and any feedback you gave are kept.</p>`, "See what changed"],
    review_overdue: ["A check-in is waiting for your review", `<p>A check-in from ${client} is past the reply time you set, or has waited a while. If you're away, update your away dates so your client sees the right expectation.</p>`, "Review the check-in"],
    transferred: [`A check-in from ${d.clientName || "your new client"} is yours to review`, `<p>After a coach change, a check-in ${client} sent is now yours to review, within what they agreed to share.</p>`, "Review the check-in"],
    feedback: [`${d.coachName || "Your coach"} replied to your check-in`, `<p>${coach} has published feedback on your check-in.</p>`, "Read the feedback"],
    closed: ["A check-in from before your coach change was closed", `<p>A check-in you sent before changing coach has been closed, because of what you chose to share with your new coach. Nothing you wrote was shown to anyone new. You can share anything important in your next check-in or in messages.</p>`, "See your check-ins"],
  };
  const [subject, body, action] = copy[d.event];
  return build(
    subject,
    `${greet(d.name)}
${body}
${button(`${ctx.siteUrl}${d.path.startsWith("/") ? d.path : "/account"}`, action)}
<p style="font-size:13px;color:${MUTED}">You can turn check-in emails off in your email settings.</p>`,
    ctx.supportEmail,
  );
}

/**
 * A controlled test of the email pipeline, sent only by
 * scripts/send-test-notification.mjs to an address the founder named. It says
 * plainly what it is, so nobody mistakes it for account activity.
 */
export function deliveryCheckEmail(ctx: TemplateContext, d: { name?: string | null }): RenderedEmail {
  return build(
    "TalentYak delivery check",
    `${greet(d.name)}
<p>This is a deliberate test of TalentYak's email pipeline. It was queued on purpose and sent by the background worker.</p>
<p>No action is needed, and nothing has changed on your account.</p>`,
    ctx.supportEmail,
  );
}


// ---------------------------------------------------------------------------
// Waitlist (M16). Sent to an address, not an account. Each email says exactly
// what the person signed up for and carries a withdraw link.
// ---------------------------------------------------------------------------

export function waitlistConfirmEmail(
  ctx: TemplateContext,
  d: { firstName?: string | null; confirmUrl: string; withdrawUrl: string; coachName?: string | null },
): RenderedEmail {
  return build(
    "Confirm you'd like to hear when TalentYak coaching opens",
    `${greet(d.firstName)}
<p>Someone — we hope you — asked to be told when coaching ${d.coachName ? `with ${escapeHtml(d.coachName)} ` : ""}can be booked on TalentYak.</p>
${button(d.confirmUrl, "Confirm my email")}
<p>Once confirmed, we'll email you only when coaching${d.coachName ? ` with ${escapeHtml(d.coachName)}` : ""} becomes available to buy. No newsletters, no other marketing. A notice doesn't hold a place for you, and there's no set start date yet.</p>
<p style="color:${MUTED}">Didn't ask for this? Ignore this email and nothing happens — or <a href="${safeUrl(d.withdrawUrl)}" style="color:${BRAND}">remove this address</a> now.</p>`,
    ctx.supportEmail,
  );
}

export function waitlistNoticeEmail(
  ctx: TemplateContext,
  d: { firstName?: string | null; coachName?: string | null; url: string; withdrawUrl: string },
): RenderedEmail {
  return build(
    d.coachName ? `${d.coachName} is taking new clients on TalentYak` : "TalentYak coaching is open",
    `${greet(d.firstName)}
<p>You asked us to tell you when coaching ${d.coachName ? `with ${escapeHtml(d.coachName)} ` : ""}could be bought. It can now.</p>
${button(d.url, d.coachName ? `See ${d.coachName}'s plans` : "See the coaches")}
<p>This email doesn't reserve a place. Places are limited and go to whoever completes checkout first; the page shows whether a coach still has room.</p>
<p style="color:${MUTED}">You're getting this because you joined the TalentYak waitlist. <a href="${safeUrl(d.withdrawUrl)}" style="color:${BRAND}">Remove me from the list</a>.</p>`,
    ctx.supportEmail,
  );
}

// ---------------------------------------------------------------------------
// Coach applications (M18). Sent to the applicant's own account. They say
// what happened and what comes next — never a reviewer's notes or reasons,
// and never a promised timeline.
// ---------------------------------------------------------------------------

export function coachApplicationReceivedEmail(ctx: TemplateContext, d: { name?: string | null }): RenderedEmail {
  return build(
    "We've received your TalentYak coach application",
    `${greet(d.name)}
<p>Thank you for applying to coach with TalentYak. Your application has reached us.</p>
<p><strong>What happens next.</strong> We review applications when we have openings, so there's no fixed timeline. We may email you to arrange a short call. When there's a decision, we'll email you.</p>
<p>Until then you can correct your application, add qualifications, or withdraw it at any time.</p>
${button(`${ctx.siteUrl}/account/coach-application`, "See your application")}
<p style="color:${MUTED}">Applying is free. Being accepted doesn't guarantee clients.</p>`,
    ctx.supportEmail,
  );
}

export type CoachApplicationDecision = "approved" | "waitlisted" | "declined";

export function coachApplicationDecisionEmail(ctx: TemplateContext, d: { name?: string | null; decision: CoachApplicationDecision }): RenderedEmail {
  switch (d.decision) {
    case "approved":
      return build(
        "You've been accepted to coach with TalentYak",
        `${greet(d.name)}
<p>Good news: we'd like you to coach with TalentYak.</p>
<p>Next, read how TalentYak works for coaches — including what you earn and when you're paid — and the coach agreement. If you're happy, sign it to set up your coach account. You can also decline.</p>
${button(`${ctx.siteUrl}/account/coach-application/agreement`, "Read the coach agreement")}
<p style="color:${MUTED}">Nothing is shown to customers until you've completed your profile and TalentYak has given final approval. Being accepted doesn't guarantee clients.</p>`,
        ctx.supportEmail,
      );
    case "waitlisted":
      return build(
        "An update on your TalentYak coach application",
        `${greet(d.name)}
<p>Thank you for your patience. We don't have an opening for you right now, but we'd like to keep your application on our waitlist for when we do.</p>
<p>You don't need to do anything. You can still update your application or withdraw it at any time.</p>
${button(`${ctx.siteUrl}/account/coach-application`, "See your application")}`,
        ctx.supportEmail,
      );
    case "declined":
      return build(
        "An update on your TalentYak coach application",
        `${greet(d.name)}
<p>Thank you for applying to coach with TalentYak. We're not able to offer you a place this time.</p>
<p>You can delete your application and everything in it from your application page whenever you like.</p>
${button(`${ctx.siteUrl}/account/coach-application`, "See your application")}`,
        ctx.supportEmail,
      );
  }
}
