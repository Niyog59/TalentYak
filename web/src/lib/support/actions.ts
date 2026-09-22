"use server";

import { revalidatePath } from "next/cache";
import { getSession, isOnboarded, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { SUPPORT_CATEGORIES } from "@/lib/support/categories";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Either participant reporting a problem. Runs as them; the database decides. */
export async function openSupportCaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session || !isOnboarded(session)) return fail("Sign in to report a problem.");

  const category = field(form, "category", 20);
  const description = field(form, "description", 2000);
  const conversation = field(form, "conversation_id", 36);
  if (!SUPPORT_CATEGORIES.some((c) => c.value === category)) {
    return fail("Choose what the problem is about.", { fieldErrors: { category: "Choose one." } });
  }
  if (description.length < 10) {
    return fail("Tell us a little more.", { fieldErrors: { description: "At least a sentence, please." }, values: { description } });
  }

  const supabase = await createClient();
  if (!supabase) return fail("That didn't send. Please try again.");
  const { error } = await supabase.rpc("open_support_case", {
    p_category: category,
    p_description: description,
    p_conversation: UUID.test(conversation) ? conversation : null,
  });
  if (error) {
    if (error.message.includes("rate_limited")) return fail("You've opened several cases today. We'll reply to those first.");
    if (error.message.includes("not_found")) return fail("That conversation isn't available to you.");
    return fail("That didn't send. Please try again.", { values: { description } });
  }
  revalidatePath("/account/support");
  revalidatePath("/coach/support");
  return succeed("Sent. TalentYak will look into it and reply here.");
}

// --- Founder console --------------------------------------------------------

export async function updateSupportCaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/support");
  const id = field(form, "case_id", 36);
  const state = field(form, "state", 20);
  const note = field(form, "note", 2000);
  if (!UUID.test(id)) return fail("Unknown case.");
  const supabase = await createClient();
  const { error } = await supabase!.rpc("admin_update_support_case", { p_case: id, p_state: state, p_note: note || null });
  if (error) {
    if (error.message.includes("note_required")) return fail("Write what was done before resolving.", { fieldErrors: { note: "Required to resolve." } });
    return fail("That didn't save. Please try again.");
  }
  revalidatePath(`/admin/support/${id}`);
  revalidatePath("/admin/support");
  return succeed(state === "resolved" ? "Resolved. Any message access for this case has ended." : "Saved.");
}

export async function grantMessageAccessAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/support");
  const id = field(form, "case_id", 36);
  const reason = field(form, "reason", 500);
  if (!UUID.test(id)) return fail("Unknown case.");
  if (reason.length < 10) return fail("Give the reason you need to read this conversation.", { fieldErrors: { reason: "At least a sentence." } });
  const supabase = await createClient();
  const { error } = await supabase!.rpc("admin_grant_case_message_access", { p_case: id, p_reason: reason });
  if (error) {
    if (error.message.includes("case_resolved")) return fail("This case is resolved. Reopen it first.");
    if (error.message.includes("no_conversation")) return fail("This case isn't about a conversation.");
    return fail("Access wasn't granted. Please try again.");
  }
  revalidatePath(`/admin/support/${id}`);
  return succeed("Access granted to you for this case. It is recorded and expires automatically.");
}

export async function revokeMessageAccessAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/support");
  const access = field(form, "access_id", 36);
  const caseId = field(form, "case_id", 36);
  if (!UUID.test(access)) return fail("Unknown grant.");
  const supabase = await createClient();
  const { error } = await supabase!.rpc("admin_revoke_case_message_access", { p_access: access });
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath(`/admin/support/${caseId}`);
  return succeed("Access ended.");
}
