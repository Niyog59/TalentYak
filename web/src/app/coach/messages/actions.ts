"use server";

import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { endOfDayInZone, parseWorkingHours } from "@/lib/messaging/availability";

/**
 * The coach's own working hours, usual response time and away status. These
 * are the coach's statements to their clients — not platform deadlines — and
 * are shown as such. Saved through the coach's own session; the table's
 * policies limit each coach to their own row.
 */
export async function saveAvailabilityAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/messages/availability");
  const tz = session.provider.timezone ?? "UTC";

  const { hours, error } = parseWorkingHours((name) => field(form, name, 10));
  if (error) return fail(error);

  const expectation = field(form, "response_expectation", 200) || null;
  const awayDate = field(form, "away_until", 10);
  const awayUntil = awayDate ? endOfDayInZone(awayDate, tz) : null;
  if (awayDate && !awayUntil) return fail("Enter the date you'll be back.", { fieldErrors: { away_until: "Enter a date." } });
  if (awayUntil && awayUntil.getTime() <= Date.now()) {
    return fail("That date has already passed.", { fieldErrors: { away_until: "Choose today or a later date." } });
  }
  const awayNote = awayUntil ? field(form, "away_note", 200) || null : null;

  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error: saveError } = await supabase.from("coach_messaging_profiles").upsert({
    provider_id: session.provider.id,
    working_hours: hours,
    response_expectation: expectation,
    away_until: awayUntil?.toISOString() ?? null,
    away_note: awayNote,
  });
  if (saveError) return fail("That didn't save. Please try again.");

  revalidatePath("/coach/messages/availability");
  return succeed("Saved. Your clients see this in your conversations.");
}
