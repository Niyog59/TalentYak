import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { mediaSession, UUID } from "@/lib/media/session";
import { deleteOwnMedia } from "@/lib/media";
import { isDateOnly } from "@/lib/programmes/content";
import { normalizeWorkoutDoc, toWire } from "@/lib/tracking/workout";
import { workoutById } from "@/lib/tracking/server";
import { cleanText } from "@/lib/expectations/text";
import { parseAmount, parseWhole } from "@/lib/tracking/units";

/**
 * Every client tracking write: workouts, body entries, food diary, photos.
 *
 * A route rather than server actions because the device needs to tell a
 * dropped connection from a refusal, a conflict from a pause, and retry only
 * what is worth retrying. Each answer is one of:
 *
 *   200 saved                    {ok, revision | token}
 *   409 changed elsewhere        {conflict | duplicate, ..., server}
 *   423 held until coaching is live again   {held: "paused" | "ended" | ...}
 *   422 refused as invalid       {error}
 *   401 / 429 / 500              sign in again / slow down / try again
 *
 * The database functions decide ownership, dates and whether coaching is
 * live; this route shapes input and turns their answers into those statuses.
 * Nothing about the content is ever logged: health data does not belong in a
 * diagnostic log.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const HELD = ["paused", "ended", "suspended", "unavailable"] as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function dbFailure(error: { message?: string } | null) {
  const message = error?.message ?? "";
  const held = HELD.find((s) => message.includes(`tracking_${s}`));
  if (held) return json({ held }, 423);
  if (message.includes("tracking_not_permitted")) return json({ error: "That isn't yours to change." }, 422);
  if (message.includes("tracking_date_invalid")) return json({ error: "Choose a date that isn't in the future (and within the last two years)." }, 422);
  if (message.includes("body_entry_empty")) return json({ error: "Enter at least one reading." }, 422);
  if (message.includes("body_entry_invalid")) return json({ error: "One of those readings is outside the range we accept. Check the number and unit." }, 422);
  if (/reference_invalid|_invalid|check constraint|violates/.test(message)) {
    return json({ error: "That entry couldn't be saved as it is. Reload the page and try again." }, 422);
  }
  if (message.includes("duplicate key")) return json({ error: "retry" }, 500);
  console.error("[tracking] save failed:", error && "code" in error ? (error as { code?: string }).code : "unknown");
  return json({ error: "That didn't save. It's kept on this device — try again." }, 500);
}

const blank = (v: unknown) => v === null || v === undefined || v === "";
const num = (v: unknown) => (blank(v) ? null : parseAmount(typeof v === "number" ? v : String(v)));

export async function POST(request: Request) {
  const session = await mediaSession();
  if (!session) return json({ error: "Sign in again to save." }, 401);

  // Generous: a workout saves as each set is confirmed.
  const limit = await rateLimit("tracking_save", session.userId, 1200, 3600, "allow");
  if (!limit.allowed) return json({ error: "Too many saves in a short time. Your entries are kept on this device." }, 429);

  if (Number(request.headers.get("content-length") ?? 0) > 250_000) return json({ error: "That workout is too large to save." }, 422);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "That request couldn't be read." }, 400);
  }

  const supabase = (await createClient())!;
  const op = String(body.op ?? "");

  switch (op) {
    case "workout.save": {
      const { doc, problems } = normalizeWorkoutDoc(body.doc);
      if (!doc) return json({ error: `Please fix: ${problems.join(" ")}` }, 422);
      const saveId = typeof body.saveId === "string" && UUID.test(body.saveId) ? body.saveId : null;
      const base = Number.isInteger(body.baseRevision) ? (body.baseRevision as number) : 0;
      const { data, error } = await supabase.rpc("save_workout_log", { p_doc: toWire(doc), p_base_revision: base, p_save_id: saveId });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision: number; conflict?: boolean; duplicate?: boolean; existing_id?: string; missing?: boolean };
      if (r.ok) return json({ ok: true, revision: r.revision });
      const serverId = r.duplicate ? r.existing_id! : doc.id;
      const server = r.missing ? null : await workoutById(serverId);
      return json({ ...r, server: server ? { doc: server.doc, revision: server.revision } : null }, 409);
    }

    case "workout.fetch": {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json({ error: "Not found." }, 404);
      const found = await workoutById(id);
      return found ? json({ ok: true, doc: found.doc, revision: found.revision }) : json({ error: "Not found." }, 404);
    }

    case "workout.delete": {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json({ error: "Not found." }, 422);
      const { data, error } = await supabase.rpc("delete_workout_log", { p_id: id, p_revision: Number(body.revision) || 0 });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision?: number };
      return r.ok ? json({ ok: true }) : json({ conflict: true, revision: r.revision }, 409);
    }

    case "body.save": {
      const enrollmentId = String(body.enrollmentId ?? "");
      const date = String(body.date ?? "");
      if (!UUID.test(enrollmentId) || !isDateOnly(date)) return json({ error: "Choose a date." }, 422);
      const keys = ["weight", "waist", "hips", "chest", "arm"] as const;
      const readings = keys.map((k) => num(body[k]));
      if (keys.some((k, i) => readings[i] === null && !blank(body[k]))) return json({ error: "Enter numbers only, like 72.5." }, 422);
      const [weight, waist, hips, chest, arm] = readings;
      const { data, error } = await supabase.rpc("save_body_entry", {
        p_enrollment: enrollmentId,
        p_date: date,
        p_weight: weight,
        p_weight_unit: body.weightUnit === "lb" ? "lb" : "kg",
        p_waist: waist,
        p_hips: hips,
        p_chest: chest,
        p_arm: arm,
        p_length_unit: body.lengthUnit === "in" ? "in" : "cm",
        p_base: body.force === true ? null : typeof body.base === "string" ? body.base : "",
      });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; token: string; conflict?: boolean };
      return r.ok ? json({ ok: true, token: r.token }) : json({ conflict: true, token: r.token }, 409);
    }

    case "food.save": {
      const e = (body.entry ?? {}) as Record<string, unknown>;
      const id = String(e.id ?? "");
      const enrollmentId = String(e.enrollmentId ?? "");
      const date = String(e.date ?? "");
      const meal = ["breakfast", "lunch", "dinner", "snack", "other"].includes(String(e.meal)) ? String(e.meal) : "other";
      if (!UUID.test(id) || !UUID.test(enrollmentId) || !isDateOnly(date)) return json({ error: "Choose a date." }, 422);
      const description = cleanText(e.description, 1000) || null;
      const mediaId = typeof e.mediaId === "string" && UUID.test(e.mediaId) ? e.mediaId : null;
      const kcal = blank(e.kcal) ? null : parseWhole(String(e.kcal));
      const protein = num(e.proteinG);
      if ((kcal === null && !blank(e.kcal)) || (kcal !== null && kcal > 10000)) {
        return json({ error: "Calories must be a whole number up to 10,000." }, 422);
      }
      if ((protein === null && !blank(e.proteinG)) || (protein !== null && protein > 1000)) {
        return json({ error: "Protein must be a number of grams up to 1,000." }, 422);
      }
      if (!description && !mediaId && kcal === null && protein === null) return json({ error: "Add a photo, a note or a number." }, 422);
      const { data, error } = await supabase.rpc("save_food_entry", {
        p_entry: { id, enrollment_id: enrollmentId, eaten_on: date, meal, description, media_id: mediaId, kcal, protein_g: protein },
        p_base_revision: Number.isInteger(body.baseRevision) ? body.baseRevision : 0,
      });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision: number; conflict?: boolean; missing?: boolean };
      return r.ok ? json({ ok: true, revision: r.revision }) : json({ ...r }, 409);
    }

    case "food.delete": {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json({ error: "Not found." }, 422);
      const { data, error } = await supabase.rpc("delete_food_entry", { p_id: id, p_revision: Number(body.revision) || 0 });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision?: number };
      return r.ok ? json({ ok: true }) : json({ conflict: true, revision: r.revision }, 409);
    }

    case "food.day": {
      const enrollmentId = String(body.enrollmentId ?? "");
      const date = String(body.date ?? "");
      if (!UUID.test(enrollmentId) || !isDateOnly(date)) return json({ error: "Choose a date." }, 422);
      const { error } = await supabase.rpc("set_food_day", { p_enrollment: enrollmentId, p_day: date, p_complete: body.complete === true });
      return error ? dbFailure(error) : json({ ok: true });
    }

    case "photo.save": {
      const enrollmentId = String(body.enrollmentId ?? "");
      const mediaId = String(body.mediaId ?? "");
      const date = String(body.date ?? "");
      const pose = ["front", "side", "back", "other"].includes(String(body.pose)) ? String(body.pose) : null;
      if (!UUID.test(enrollmentId) || !UUID.test(mediaId) || !isDateOnly(date)) return json({ error: "Choose a date." }, 422);
      const { error } = await supabase.rpc("save_progress_photo", { p_enrollment: enrollmentId, p_media: mediaId, p_date: date, p_pose: pose });
      return error ? dbFailure(error) : json({ ok: true });
    }

    case "media.remove": {
      // M08's own deletion — the same rule and the same code path as the
      // photos page. Allowed whatever the relationship's state.
      const mediaId = String(body.mediaId ?? "");
      if (!UUID.test(mediaId)) return json({ error: "Not found." }, 422);
      await supabase.rpc("remove_progress_photo", { p_media: mediaId });
      const removed = await deleteOwnMedia(supabase, mediaId);
      return removed ? json({ ok: true }) : json({ error: "That couldn't be removed. It may already be gone." }, 422);
    }

    default:
      return json({ error: "Unknown request." }, 400);
  }
}
