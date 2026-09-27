"use server";

import { revalidatePath } from "next/cache";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { expectationsError } from "@/lib/expectations/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records that the client has read one presented version. It records that and
 * nothing else: no price, plan, fee, refund or access is touched, and not
 * acknowledging never takes anything away.
 */
export async function acknowledgeExpectationsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const enrollmentId = field(form, "enrollment_id", 40);
  const presentationId = field(form, "presentation_id", 40);
  const session = await requireOnboarded(`/account/expectations/${enrollmentId}`);
  if (!UUID.test(enrollmentId) || !UUID.test(presentationId)) return fail("This document isn't available to you.");

  // The box starts unticked and must be ticked by the person, every time.
  if (form.get("understood") !== "on") {
    return fail("Tick the box to confirm you've read these expectations.", { fieldErrors: { understood: "Required to record that you've read it." } });
  }

  const limit = await rateLimit("expectations_ack", session.userId, 20, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error } = await supabase.rpc("acknowledge_expectations", { p_presentation: presentationId });
  if (error) return fail(expectationsError(error.message, "That didn't save. Please try again."));

  revalidatePath(`/account/expectations/${enrollmentId}`);
  return succeed("Thank you — recorded.");
}
