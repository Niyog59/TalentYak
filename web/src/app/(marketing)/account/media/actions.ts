"use server";

import { revalidatePath } from "next/cache";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { deleteOwnMedia } from "@/lib/media";
import { friendlyError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/rate-limit";

/**
 * A person acting on their own media.
 *
 * Both actions run through the signed-in person's own client, so the database
 * decides what they may touch. Neither uses the admin client to look something
 * up "for convenience" — that is how a check gets skipped.
 */

export async function deleteMediaAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOnboarded("/account/media");
  const id = field(form, "media_id", 40);
  if (!id) return fail("That couldn't be deleted.");

  const supabase = (await createClient())!;
  const removed = await deleteOwnMedia(supabase, id);
  if (!removed) return fail("That couldn't be deleted. It may already be gone.");

  revalidatePath("/account/media");
  return succeed("Deleted. The file has been removed.");
}

/**
 * A person asking for their data to be deleted.
 *
 * This files a request; it does not erase anything on the spot. Financial
 * records are kept because the law requires it, and are anonymised instead.
 * The confirmation says that, rather than implying an instant wipe we would
 * then fail to deliver. Asking twice returns the same open request.
 */
export async function requestDeletionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account/media");
  if (field(form, "confirm", 5) !== "on") {
    return fail("Tick the box to confirm you want to ask for deletion.", { fieldErrors: { confirm: "Required." } });
  }

  const limit = await rateLimit("deletion_request", session.userId, 5, 24 * 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("request_own_deletion", { p_note: field(form, "note", 1000) || null });
  if (error) return fail(friendlyError(error, "Your request couldn't be sent. Please try again."));

  revalidatePath("/account/media");
  return succeed(
    "Request received. We'll confirm by email before anything is removed. Payment records are kept because the law requires it, with your name removed.",
  );
}
