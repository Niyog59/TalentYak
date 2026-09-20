"use server";

import { revalidatePath } from "next/cache";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";

/**
 * The person's own control over their inbox and what reaches their email.
 *
 * Every one of these runs as the signed-in person through the anon-key client,
 * so the database decides what they may touch. None of them uses the admin
 * client: reading somebody else's inbox should be impossible here, not merely
 * unimplemented.
 */

export async function markAllReadAction(): Promise<ActionState> {
  await requireOnboarded("/account/notifications");
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return fail(friendlyError(error, "Those couldn't be marked as read. Please try again."));
  revalidatePath("/account/notifications");
  revalidatePath("/account", "layout");
  const n = typeof data === "number" ? data : 0;
  return succeed(n === 0 ? "Nothing was unread." : n === 1 ? "Marked as read." : `${n} marked as read.`);
}

export async function markReadAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOnboarded("/account/notifications");
  const id = field(form, "notification_id", 40);
  if (!id) return fail("That couldn't be marked as read.");

  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return fail(friendlyError(error, "That couldn't be marked as read. Please try again."));
  revalidatePath("/account/notifications");
  revalidatePath("/account", "layout");
  return succeed("Marked as read.");
}

/**
 * Saves every optional preference in one submission.
 *
 * Essential categories are not read from the form at all. A checkbox for one is
 * never rendered, and if one were posted the database would refuse it — the
 * rule lives in `set_notification_preference`, not in this screen.
 */
export async function savePreferencesAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOnboarded("/account/notifications/preferences");
  const supabase = (await createClient())!;

  const { data: categories, error: readError } = await supabase
    .from("notification_categories")
    .select("id, essential")
    .eq("essential", false);
  if (readError) return fail(friendlyError(readError, "Your settings couldn't be loaded. Nothing was changed."));

  const failures: string[] = [];
  for (const category of categories ?? []) {
    const enabled = field(form, `category:${category.id}`, 5) === "on";
    const { error } = await supabase.rpc("set_notification_preference", {
      p_category: category.id,
      p_email_enabled: enabled,
    });
    if (error) failures.push(category.id);
  }

  if (failures.length) {
    return fail("Some settings couldn't be saved. Please try again.");
  }

  revalidatePath("/account/notifications/preferences");
  return succeed("Saved. This takes effect on the next email we send.");
}
