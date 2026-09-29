import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDailyConfigured, isResendConfigured } from "@/lib/env";
import { stripeMode } from "@/lib/payments/stripe";
import { evaluateLiveReadiness } from "@/lib/policy/live-gate";
import { CURRENT_LEGAL } from "@/lib/legal";
import { FULFILLMENT } from "@/lib/fulfillment";
import {
  FEATURES,
  FEATURE_KEYS,
  isFeatureKey,
  modeAllows,
  type FeatureKey,
  type FeatureMode,
  type FeatureModes,
  type Readiness,
  type ReadinessContext,
} from "@/lib/features/registry";

/*
 * Switch checks for pages, actions, API routes and jobs.
 *
 * The setting is read from the database on every request (memoised within
 * one request), so a change takes effect without a deployment and an old
 * browser tab is refused on its next action. If the settings can't be read,
 * nothing new is allowed: an unknown state never opens anything. The
 * database enforces the same switches underneath, so a check forgotten here
 * still can't let activity through.
 */

export interface FeatureStates {
  ok: boolean;
  modes: FeatureModes;
}

const ALL_OFF = Object.fromEntries(FEATURE_KEYS.map((k) => [k, "off"])) as FeatureModes;

export const getFeatureStates = cache(async (): Promise<FeatureStates> => {
  // Modes are public; reading them needs no session, so public pages don't
  // become dependent on the visitor's cookies.
  const supabase = createAdminClient() ?? (await createClient());
  if (!supabase) return { ok: false, modes: ALL_OFF };
  const { data, error } = await supabase.rpc("feature_modes");
  if (error || !Array.isArray(data)) return { ok: false, modes: ALL_OFF };
  const modes = { ...ALL_OFF };
  for (const row of data as { key: string; mode: FeatureMode }[]) {
    if (isFeatureKey(row.key)) modes[row.key] = row.mode;
  }
  return { ok: true, modes };
});

/** Is the signed-in person on the test-account list? Asked once per request. */
const amTestAccount = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  if (!supabase) return false;
  const { data } = await supabase.rpc("am_feature_test_account");
  return data === true;
});

export async function featureMode(key: FeatureKey): Promise<FeatureMode> {
  return (await getFeatureStates()).modes[key];
}

/** May the person making this request start new activity in this feature? */
export async function featureAllowsMe(key: FeatureKey): Promise<boolean> {
  const mode = await featureMode(key);
  if (mode === "on") return true;
  if (mode !== "test_only") return false;
  return amTestAccount();
}

/** For the public, signed-out site: only a plain "on" counts. */
export async function featureOnForEveryone(key: FeatureKey): Promise<boolean> {
  return (await featureMode(key)) === "on";
}

/** Whether a given account may, for server code acting on someone's behalf (jobs). */
export async function featureAllowsAccount(key: FeatureKey, profileId: string | null): Promise<boolean> {
  const mode = await featureMode(key);
  if (mode === "on") return true;
  if (mode !== "test_only" || !profileId) return false;
  const admin = createAdminClient();
  if (!admin) return false;
  const { data } = await admin.rpc("is_feature_test_account", { p_profile: profileId });
  return modeAllows(mode, data === true);
}

export const PAUSED_MESSAGE: Record<FeatureKey, string> = {
  programmes: "Plan changes are paused by TalentYak for now. Current plans stay available to follow.",
  logging: "Saving new entries is paused by TalentYak for now. Your entries are kept on this device and save automatically when it's back.",
  check_ins: "New check-in schedules are paused by TalentYak for now. Check-ins already requested can still be sent and reviewed.",
  messaging: "Sending messages is paused by TalentYak for now. What you wrote has not been sent. Your earlier messages are still here.",
  attachments: "Adding photos and clips is paused by TalentYak for now. You can still send text.",
  bookings: "New session requests are paused by TalentYak for now. Confirmed sessions go ahead, and you can still answer requests already waiting or cancel.",
  calls: "Calls are unavailable right now. Please contact support if this affects a session.",
  new_sales: "New purchases are paused right now. Nothing has been charged.",
  public_profiles: "Coach profiles are unavailable right now.",
  waitlist: "The waitlist is closed right now.",
  coach_changing: "Changing coach isn't available right now. You can contact support about your coaching.",
};

/** null when allowed; otherwise the plain-language reason to show. */
export async function featureRefusal(key: FeatureKey): Promise<string | null> {
  return (await featureAllowsMe(key)) ? null : PAUSED_MESSAGE[key];
}

/** Everything readiness needs to know about this deployment. */
export async function readinessContext(): Promise<ReadinessContext> {
  const live = evaluateLiveReadiness();
  const liveBlockers = [...live.blockers];
  if (!CURRENT_LEGAL.approved) liveBlockers.push("Terms of service and privacy notice are drafts.");

  let unresolved: ReadinessContext["unresolvedPrerequisites"] = [];
  const supabase = await createClient();
  if (supabase) {
    const { data } = await supabase.from("feature_prerequisites").select("feature_key, blocks_mode, description, resolved").eq("resolved", false);
    unresolved = ((data ?? []) as { feature_key: string; blocks_mode: FeatureMode; description: string }[])
      .filter((p) => isFeatureKey(p.feature_key))
      .map((p) => ({ feature: p.feature_key as FeatureKey, blocksMode: p.blocks_mode, description: p.description }));
  }

  return {
    dailyConfigured: isDailyConfigured(),
    resendConfigured: isResendConfigured(),
    stripeMode: stripeMode(),
    liveBlockers,
    callsFulfillmentReady: FULFILLMENT.calls.ready,
    unresolvedPrerequisites: unresolved,
  };
}

export function readinessOf(ctx: ReadinessContext): Record<FeatureKey, Readiness> {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.readiness(ctx)])) as Record<FeatureKey, Readiness>;
}
