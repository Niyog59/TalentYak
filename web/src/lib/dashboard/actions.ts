"use server";

import { revalidatePath } from "next/cache";
import { requireCoach, requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";

/*
 * A person's own dashboard marks. The database decides what may be marked
 * and how far a "handled" mark reaches (set_dashboard_mark); nothing here
 * touches the check-in, request, plan or conversation the mark points at.
 */

const KEY = /^(msg|checkin|proposal|plan|planver|exp|appt):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SNOOZE_HOURS = new Set([4, 24, 72]);

function markError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("mark_not_permitted")) return "That isn't yours to mark any more. Refresh the page.";
  if (m.includes("suspended")) return "Your account is paused. Contact support.";
  return "That didn't save. Please try again.";
}

async function mark(area: "client" | "coach", item: string, action: "snoozed" | "handled" | "dismissed", until: string | null, userId: string): Promise<ActionState> {
  if (!KEY.test(item)) return fail("That item couldn't be found. Refresh the page.");
  const limit = await rateLimit("dashboard_mark", userId, 120, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("set_dashboard_mark", { p_area: area, p_item: item, p_action: action, p_until: until });
  if (error) return fail(markError(error.message));
  revalidatePath(area === "coach" ? "/coach" : "/account");
  return succeed();
}

export async function snoozeTaskAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach");
  const hours = Number(field(form, "hours", 3));
  if (!SNOOZE_HOURS.has(hours)) return fail("Choose how long to snooze it for.");
  const r = await mark("coach", field(form, "item", 60), "snoozed", new Date(Date.now() + hours * 3_600_000).toISOString(), session.userId);
  return r.ok ? succeed("Snoozed. It comes back sooner if it falls due.") : r;
}

export async function markHandledAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach");
  const item = field(form, "item", 60);
  if (!item.startsWith("msg:")) return fail("Only a conversation can be marked as needing no reply.");
  const r = await mark("coach", item, "handled", null, session.userId);
  return r.ok ? succeed("Marked as needing no reply. It comes back if the client writes again.") : r;
}

export async function dismissNoticeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account");
  const item = field(form, "item", 60);
  if (!/^(planver|exp):/.test(item)) return fail("That notice can't be dismissed.");
  return mark("client", item, "dismissed", null, session.userId);
}

export async function clearMarkAction(_: ActionState, form: FormData): Promise<ActionState> {
  const area = field(form, "area", 10);
  const item = field(form, "item", 60);
  if ((area !== "coach" && area !== "client") || !KEY.test(item)) return fail("That item couldn't be found. Refresh the page.");
  if (area === "coach") await requireCoach("/coach");
  else await requireOnboarded("/account");
  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("clear_dashboard_mark", { p_area: area, p_item: item });
  if (error) return fail(markError(error.message));
  revalidatePath(area === "coach" ? "/coach" : "/account");
  return succeed("Back in your list.");
}
