"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, succeed } from "@/lib/actions";
import { cleanText } from "@/lib/expectations/text";
import { PLATFORM_FIELDS, POLICY_LINK_OPTIONS, expectationsError, type PlatformExpectationsContent } from "@/lib/expectations/types";

/*
 * TalentYak's own section. Admin role and a verified second factor are checked
 * here and again by the database on every call (is_admin() requires aal2).
 */

export async function savePlatformExpectationsAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/expectations");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");

  const content = {} as PlatformExpectationsContent;
  for (const f of PLATFORM_FIELDS) content[f.key] = cleanText(form.get(f.key), f.max);
  // Only links from the fixed list survive; anything else is dropped here and
  // would be refused by the database anyway.
  const chosen = form.getAll("policy_links").map(String);
  content.policy_links = POLICY_LINK_OPTIONS.map((o) => o.href).filter((h) => chosen.includes(h));

  const { data: draftId, error } = await supabase.rpc("admin_save_platform_expectations_draft", { p: content });
  if (error || !draftId) return fail(expectationsError(error?.message, "That didn't save. Please try again."));

  if (form.get("intent") !== "publish") {
    revalidatePath("/admin/expectations");
    return succeed("Draft saved. Nobody sees it until you publish.");
  }

  const material = form.get("material") === "on";
  const { data, error: publishError } = await supabase.rpc("admin_publish_platform_expectations", {
    p_draft: draftId,
    p_material: material,
    p_summary: cleanText(form.get("change_summary"), 500) || null,
  });
  revalidatePath("/admin/expectations");
  if (publishError || !data) return fail(expectationsError(publishError?.message, "Draft saved, but publishing failed."));
  const r = data as { version: number; presented: number };
  return succeed(`TalentYak version ${r.version} is published.${r.presented ? ` Shared with ${r.presented} current client${r.presented === 1 ? "" : "s"}.` : ""}`);
}
