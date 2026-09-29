"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { clientIp, rateLimit, tooMany } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { enqueue, kickWorker } from "@/lib/worker/outbox";
import { countEvent } from "@/lib/site-events";
import { purchaseMode } from "@/lib/launch";
import { WAITLIST_CONSENT_VERSION } from "@/lib/waitlist/copy";
import { TOKEN_RE, confirmWaitlist, hashToken, newToken as token } from "@/lib/waitlist/server";
import { featureOnForEveryone } from "@/lib/features/server";

/*
 * The waitlist. A person gives an email, and optionally a first name and the
 * coach or plan they're interested in — nothing else, and nothing about their
 * health. They confirm by email before anything else is ever sent. Every email
 * carries a link that removes them. The browser gets the same answer whether
 * or not the address was already on the list.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function joinWaitlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email", 254).toLowerCase();
  const firstName = field(form, "first_name", 80);
  const provider = field(form, "coach", 40);
  const offer = field(form, "plan", 40);
  const values = { email, first_name: firstName };

  // A field people can't see; automated form-fillers can.
  if (field(form, "website", 200)) return succeed(CONFIRM_MESSAGE);
  if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.", { fieldErrors: { email: "Enter a valid email address." }, values });
  if (form.get("consent") !== "on") return fail("Tick the box to confirm what you're signing up for.", { fieldErrors: { consent: "Required." }, values });
  // Rechecked on submit: a page opened before the waitlist closed can't add to it.
  if (!(await featureOnForEveryone("waitlist"))) return fail("The waitlist is closed right now, so nothing was saved. Please check back soon.", { values });

  const [byIp, byEmail] = await Promise.all([
    rateLimit("waitlist_ip", await clientIp(), 10, 3600),
    rateLimit("waitlist_email", email, 4, 3600),
  ]);
  if (!byIp.allowed) return fail(tooMany(byIp), { values });
  if (!byEmail.allowed) return fail(tooMany(byEmail), { values });

  const admin = createAdminClient();
  if (!admin) return fail("The waitlist isn't available right now. Please try again later.", { values });

  const confirm = token();
  const link = token();
  const { data, error } = await admin.rpc("waitlist_register", {
    p_email: email,
    p_first_name: firstName || null,
    p_provider: UUID.test(provider) ? provider : null,
    p_offer: UUID.test(offer) ? offer : null,
    p_confirm_hash: confirm.hash,
    p_link_hash: link.hash,
    p_consent: WAITLIST_CONSENT_VERSION,
  });
  if (error || !data) {
    console.error("[waitlist] register failed:", error?.code ?? "unknown");
    return fail("That didn't go through. Please try again.", { values });
  }
  const r = data as { entry_id: string; send_confirmation: boolean; new: boolean; provider_id: string | null };

  if (r.send_confirmation) {
    let coachName: string | null = null;
    if (r.provider_id) {
      const { data: p } = await admin.from("provider_public_profiles").select("display_name").eq("provider_id", r.provider_id).maybeSingle();
      coachName = (p?.display_name as string) ?? null;
    }
    await enqueue({
      topic: "email.waitlist_confirm",
      payload: {
        entry_id: r.entry_id,
        confirm_url: `${env.siteUrl}/waitlist/confirm/${confirm.plain}`,
        withdraw_url: `${env.siteUrl}/waitlist/leave/${link.plain}`,
        coach_name: coachName,
      },
      dedupeKey: `waitlist_confirm:${confirm.hash}`,
    });
    kickWorker();
  }
  if (r.new) await countEvent("waitlist_registered", "");
  return succeed(CONFIRM_MESSAGE);
}

const CONFIRM_MESSAGE =
  "Thanks. Check your inbox for a link to confirm your email — nothing else is sent until you do. If this address is already confirmed, you're still on the list.";

/**
 * Confirming is a button press, not opening the link: mail scanners open
 * links, and a person should be the one who says yes.
 */
export async function confirmWaitlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const plain = field(form, "token", 80);
  const limit = await rateLimit("waitlist_confirm", await clientIp(), 30, 3600);
  if (!limit.allowed) return fail(tooMany(limit));
  const r = await confirmWaitlist(plain);
  if (!r.ok) return fail("This link has already been used or has been replaced by a newer one. If you've confirmed before, you're on the list; otherwise join again to get a fresh link.");
  return succeed("Confirmed. You're on the TalentYak waitlist — we'll email you when coaching you asked about can be bought.");
}

export async function leaveWaitlistAction(_: ActionState, form: FormData): Promise<ActionState> {
  const plain = field(form, "token", 80);
  if (!TOKEN_RE.test(plain)) return fail("That link isn't valid.");
  const limit = await rateLimit("waitlist_leave", await clientIp(), 30, 3600);
  if (!limit.allowed) return fail(tooMany(limit));
  const admin = createAdminClient();
  if (!admin) return fail("That didn't go through. Please try again.");
  const { data, error } = await admin.rpc("waitlist_withdraw", { p_hash: hashToken(plain) });
  if (error) return fail("That didn't go through. Please try again.");
  // Already gone reads the same as removed: the outcome the person wanted.
  void data;
  return succeed("Done. Your email has been removed from the TalentYak waitlist, and we won't email you about it again.");
}

// ---------------------------------------------------------------------------
// Founder: send an availability notice, by hand
// ---------------------------------------------------------------------------

export async function sendWaitlistNoticeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/waitlist");
  const provider = field(form, "coach", 40);
  if (form.get("confirm") !== "on") return fail("Tick the box to confirm you want to send this now.");
  const limit = await rateLimit("waitlist_notice", session.userId, 5, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  // Only announce what can actually be bought, and only through the
  // administrator's own session (RLS: admin with a second factor).
  // What an ordinary visitor would meet: a notice goes out only if they could buy.
  if (await purchaseMode(null) === "closed") {
    return fail("Buying isn't open to the public yet, so there's nothing to announce. Notices can be sent once purchasing is open.");
  }
  const supabase = (await createClient())!;
  let coachName: string | null = null;
  let url = `${env.siteUrl}/coaches`;
  if (UUID.test(provider)) {
    const { data: avail } = await supabase.rpc("coach_public_availability");
    const state = ((avail ?? []) as { provider_id: string; state: string }[]).find((a) => a.provider_id === provider)?.state;
    if (state !== "available") return fail("That coach isn't taking new clients right now, so a notice would be misleading.");
    const { data: c } = await supabase.from("public_coach_directory").select("display_name, slug").eq("provider_id", provider).maybeSingle();
    if (!c?.slug) return fail("That coach isn't public.");
    coachName = c.display_name as string;
    url = `${env.siteUrl}/coaches/${c.slug}`;
  }

  let q = supabase.from("waitlist_entries").select("id").eq("state", "confirmed").limit(500);
  if (UUID.test(provider)) q = q.or(`provider_id.eq.${provider},provider_id.is.null`);
  const { data: entries, error } = await q;
  if (error) return fail("The waitlist couldn't be read. Nothing was sent.");
  if (!entries?.length) return fail("Nobody confirmed on the list matches, so nothing was sent.");

  const admin = createAdminClient()!;
  const { data: notice, error: nErr } = await admin.from("waitlist_notices")
    .insert({ provider_id: UUID.test(provider) ? provider : null, sent_by: session.userId, recipients: entries.length }).select("id").single();
  if (nErr || !notice) return fail("That didn't go through. Nothing was sent.");

  for (const e of entries) {
    const link = token();
    await admin.from("waitlist_links").insert({ token_hash: link.hash, entry_id: e.id });
    await enqueue({
      topic: "email.waitlist_notice",
      payload: { entry_id: e.id, notice_id: notice.id, coach_name: coachName, url, withdraw_url: `${env.siteUrl}/waitlist/leave/${link.plain}` },
      dedupeKey: `waitlist_notice:${notice.id}:${e.id}`,
    });
  }
  await admin.from("waitlist_entries").update({ last_notified_at: new Date().toISOString() }).in("id", entries.map((e) => e.id));
  kickWorker();
  revalidatePath("/admin/waitlist");
  return succeed(`Queued ${entries.length} notice${entries.length === 1 ? "" : "s"}. Each person gets one email with a link to leave the list.`);
}
