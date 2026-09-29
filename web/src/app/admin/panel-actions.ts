"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { kickWorker } from "@/lib/worker/outbox";
import { MODE_LABEL, checkChange, featureSpec, isFeatureKey, type FeatureMode } from "@/lib/features/registry";
import { getFeatureStates, readinessContext, readinessOf } from "@/lib/features/server";
import { featureImpact } from "@/lib/admin/impact";

/*
 * Founder panel actions added in M17. Each one runs requireAdmin() (a second
 * factor completed in this session) and then calls the database AS the
 * founder: the database checks the admin rule again, applies the product's
 * own rules, and writes the change history with who, when and why.
 */

const GENERIC = "That didn't work and nothing was changed. Please try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return supabase;
}

// ---------------------------------------------------------------------------
// Feature controls
// ---------------------------------------------------------------------------

export async function setFeatureModeAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/features");
  const key = field(form, "key", 40);
  const to = field(form, "mode", 20) as FeatureMode;
  const reason = field(form, "reason", 1000);
  const version = Number(field(form, "version", 10));
  const restores = field(form, "restores", 40);
  if (!isFeatureKey(key) || !["on", "read_only", "off", "test_only"].includes(to) || !Number.isInteger(version)) return fail(GENERIC);
  if (reason.length < 3) return fail("Say why — it's kept in the history.", { fieldErrors: { reason: "Required." } });

  // The same checks the page showed, run again now: another tab may have
  // changed something since.
  const [{ modes, ok }, ctx] = await Promise.all([getFeatureStates(), readinessContext()]);
  if (!ok) return fail("The current settings couldn't be read, so nothing was changed. Try again.");
  const check = checkChange(modes, key, to, readinessOf(ctx)[key], ctx);
  if (check.errors.length) return fail(check.errors.join(" "));
  if (check.highImpact && form.get("confirm") !== "on") {
    return fail("This affects people using TalentYak. Tick the confirmation after reading the impact, then apply.", { fieldErrors: { confirm: "Required." } });
  }

  // What the founder was shown, recorded with the change (counts only).
  const impact = await featureImpact(key);
  const { data, error } = await (await db()).rpc("admin_set_feature_mode", {
    p_key: key,
    p_mode: to,
    p_reason: reason,
    p_expected_version: version,
    p_impact: { counts: impact.filter((i) => i.count.ok).map((i) => ({ label: i.label, count: i.count.ok ? i.count.value : null })) },
    p_restores: UUID.test(restores) ? restores : null,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  const closed = Number((data as { rooms_closed?: number })?.rooms_closed ?? 0);
  if (closed) kickWorker();
  revalidatePath("/admin", "layout");
  return succeed(
    `${featureSpec(key).label}: now ${MODE_LABEL[to].toLowerCase()}. It applies to the next thing anyone does — no deployment needed.` +
      (closed ? ` ${closed} open call room${closed === 1 ? " is" : "s are"} being closed.` : "") +
      (restores ? " Restoring a setting doesn't undo anything that already happened (refunds, cancellations, messages sent)." : ""),
  );
}

export async function setTestAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/features");
  const profileId = field(form, "profile_id", 40);
  const member = form.get("member") === "1";
  const reason = field(form, "reason", 500);
  if (!UUID.test(profileId)) return fail(GENERIC);
  if (reason.length < 3) return fail("Say why — it's kept in the history.", { fieldErrors: { reason: "Required." } });
  const { data, error } = await (await db()).rpc("admin_set_test_account", { p_profile: profileId, p_member: member, p_reason: reason });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath("/admin/features");
  revalidatePath(`/admin/accounts/${profileId}`);
  if (!data) return succeed("No change: it was already set that way.");
  return succeed(member ? "Added to the test list. Features set to \"test accounts only\" now work for this account." : "Removed from the test list.");
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function setAccountSuspensionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/accounts");
  const profileId = field(form, "profile_id", 40);
  const suspend = form.get("suspend") === "1";
  const reason = field(form, "reason", 500);
  if (!UUID.test(profileId)) return fail(GENERIC);
  if (profileId === session.userId) return fail("You can't suspend your own account.");
  if (reason.length < 3) return fail("Record why — it's kept in the history.", { fieldErrors: { reason: "Required." } });
  if (suspend && form.get("confirm") !== "on") return fail("Tick the confirmation. Suspending signs this person out of everything on their next action.", { fieldErrors: { confirm: "Required." } });
  const { data, error } = await (await db()).rpc("admin_set_account_suspension", { p_profile: profileId, p_suspend: suspend, p_reason: reason });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker(); // a suspension closes any call room the person is in
  revalidatePath(`/admin/accounts/${profileId}`);
  if (!data) return succeed("No change: it was already set that way.");
  return succeed(suspend
    ? "Suspended. They can't use their account from their next action; paid coaching is paused, nothing is deleted, and no refund is made automatically."
    : "Reinstated. Paid coaching resumes if its paid time hasn't run out.");
}

// ---------------------------------------------------------------------------
// Support cases
// ---------------------------------------------------------------------------

export async function assignSupportCaseAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/support");
  const caseId = field(form, "case_id", 40);
  const owner = field(form, "owner", 40);
  if (!UUID.test(caseId)) return fail(GENERIC);
  const ownerId = owner === "me" ? session.userId : UUID.test(owner) ? owner : null;
  const { error } = await (await db()).rpc("admin_assign_support_case", { p_case: caseId, p_owner: ownerId });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/support/${caseId}`);
  revalidatePath("/admin/support");
  return succeed(ownerId ? "Owner set." : "Owner cleared.");
}

export async function addSupportNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/support");
  const caseId = field(form, "case_id", 40);
  const body = field(form, "body", 4000);
  if (!UUID.test(caseId)) return fail(GENERIC);
  if (!body) return fail("Write the note first.", { fieldErrors: { body: "Required." } });
  const { error } = await (await db()).rpc("admin_add_support_note", { p_case: caseId, p_body: body });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/support/${caseId}`);
  return succeed("Note added. Only administrators see it.");
}
