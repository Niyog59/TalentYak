import "server-only";
import { Resend } from "resend";
import { env, isResendConfigured } from "@/lib/env";

export { escapeHtml, htmlToText, safeUrl } from "@/lib/email/escape";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!isResendConfigured()) return null;
  if (!resend) resend = new Resend(env.resendApiKey);
  return resend;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sent to the provider so a retried send cannot deliver the same message twice. */
  idempotencyKey: string;
  replyTo?: string;
}

/**
 * What actually happened. "Sent" is not one of the options, because it is not
 * something we can know: the provider can ACCEPT a message and still fail to
 * deliver it. Delivery, bounces and complaints arrive later, separately.
 */
export type SendResult =
  | { status: "accepted"; providerMessageId: string }
  | { status: "unconfigured"; reason: string }
  | { status: "failed"; retryable: boolean; reason: string };

export type EmailTransport = (email: OutgoingEmail) => Promise<SendResult>;

/**
 * Addresses that must never be emailed: reserved test domains. Test fixtures use
 * them, and sending to one would bounce and damage the sending domain's
 * reputation before a single real customer exists.
 */
export function isReservedTestAddress(address: string): boolean {
  return /@[^@]*\.(test|invalid|example|localhost)$/i.test(address.trim()) || /@example\.(com|org|net)$/i.test(address.trim());
}

export const resendTransport: EmailTransport = async (email) => {
  const client = getResend();
  if (!client) {
    return { status: "unconfigured", reason: "RESEND_API_KEY and EMAIL_FROM must both be set, on a verified sending domain." };
  }

  try {
    const { data, error } = await client.emails.send(
      {
        from: env.emailFrom,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { replyTo: email.replyTo } : {}),
      },
      { idempotencyKey: email.idempotencyKey },
    );

    if (error) {
      const name = (error as { name?: string }).name ?? "";
      // Configuration problems are not worth retrying every few minutes; quota
      // and transient provider errors are.
      const permanent = [
        "validation_error",
        "invalid_from_address",
        "missing_api_key",
        "invalid_api_key",
        "restricted_api_key",
        "invalid_access",
      ].includes(name);
      if (name === "invalid_from_address" || name === "missing_api_key" || name === "invalid_api_key") {
        return { status: "unconfigured", reason: `${name}: ${error.message}` };
      }
      return { status: "failed", retryable: !permanent, reason: `${name}: ${error.message}` };
    }

    return { status: "accepted", providerMessageId: data?.id ?? "unknown" };
  } catch (err) {
    // A network error mid-request means we genuinely do not know whether the
    // provider accepted it. The idempotency key makes a retry safe.
    return { status: "failed", retryable: true, reason: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
};

/** Legacy helper kept for callers that only need a boolean. */
export async function sendEmail(args: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  const { htmlToText } = await import("@/lib/email/escape");
  const result = await resendTransport({
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text ?? htmlToText(args.html),
    idempotencyKey: `legacy:${args.to}:${args.subject}:${Date.now()}`,
  });
  return result.status === "accepted";
}
