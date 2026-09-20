"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionState, fail, field } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/rate-limit";

export async function acceptInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const token = field(form, "token", 100);
  const session = await requireOnboarded(`/invite/${token}`);

  const limit = await rateLimit("invite_accept", session.userId, 10, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  // An unconfirmed address proves nothing about who owns it.
  if (!session.emailConfirmed) return fail("Confirm your email address first, using the link we sent you, then open the invitation again.");
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return fail("This invitation link is not valid. Ask for a new one.");

  const admin = createAdminClient();
  if (!admin) return fail("Invitations can't be accepted right now.");
  // Server-only function: it matches the invitation's email against THIS
  // account's email, so a forwarded link is useless to anyone else.
  const { error } = await admin.rpc("accept_coach_invitation", {
    p_token_hash: createHash("sha256").update(token).digest("hex"),
    p_user_id: session.userId,
  });
  if (error) return fail(friendlyError(error, "This invitation couldn't be accepted. Ask for a new one."));

  redirect("/coach/profile");
}
