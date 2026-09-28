import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { mediaSession, UUID } from "@/lib/media/session";
import { localDate } from "@/lib/programmes/content";
import { plansForEnrollment } from "@/lib/programmes/server";
import { trackingPreferences } from "@/lib/tracking/server";
import { cleanText } from "@/lib/expectations/text";
import { correctionChanges, normalizeAnswers, type Answers, type Question } from "@/lib/checkins/questions";
import { buildSnapshot } from "@/lib/checkins/server";
import type { ProgressSnapshot } from "@/lib/checkins/snapshot";

/**
 * A client's check-in answers: saving a draft, and sending.
 *
 * A route rather than server actions for the same reason as tracking: the
 * device must tell a dropped connection from a refusal, a conflict from a
 * pause, and retry only what is worth retrying.
 *
 *   200 saved / sent                      {ok, revision, status?}
 *   409 changed elsewhere                 {conflict, revision, answers?}
 *   423 held until coaching is live       {held}
 *   422 refused as it is                  {error, missing?}
 *   401 / 429 / 500                       sign in again / slow down / try again
 *
 * Sending is made on the client's behalf by our server, which assembles the
 * period's progress summary from the client's own records — a device can
 * never write that summary itself. Nothing a client wrote is ever logged.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const HELD = ["paused", "ended", "suspended", "unavailable"] as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function dbFailure(error: { message?: string; code?: string } | null) {
  const message = error?.message ?? "";
  const held = HELD.find((s) => message.includes(`checkin_${s}`));
  if (held) return json({ held }, 423);
  if (message.includes("checkin_not_permitted")) return json({ error: "This check-in isn't yours to change." }, 422);
  if (message.includes("checkin_closed")) return json({ error: "This check-in is closed and can't be sent now." }, 422);
  if (message.includes("checkin_attachment_invalid")) return json({ error: "One of the attached files isn't available any more. Remove it and try again." }, 422);
  if (/_invalid|check constraint|violates/.test(message)) return json({ error: "That couldn't be saved as it is. Reload the page and try again." }, 422);
  console.error("[checkins] save failed:", error?.code ?? "unknown");
  return json({ error: "That didn't save. It's kept on this device — try again." }, 500);
}

export async function POST(request: Request) {
  const session = await mediaSession();
  if (!session) return json({ error: "Sign in again to save." }, 401);

  const limit = await rateLimit("checkin_save", session.userId, 600, 3600, "allow");
  if (!limit.allowed) return json({ error: "Too many saves in a short time. Your answers are kept on this device." }, 429);

  if (Number(request.headers.get("content-length") ?? 0) > 80_000) return json({ error: "That check-in is too long to save." }, 422);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "That request couldn't be read." }, 400);
  }

  const supabase = (await createClient())!;
  const op = String(body.op ?? "");
  const checkinId = String(body.checkinId ?? "");
  if (!UUID.test(checkinId)) return json({ error: "That check-in couldn't be found." }, 422);

  // Row-level security returns the row only to its own client (or a coach,
  // who is refused below): the ownership check is the database's.
  const { data: checkin } = await supabase
    .from("checkins")
    .select("id, enrollment_id, customer_id, template_version_id, current_revision, period_start, period_end, timezone, status")
    .eq("id", checkinId)
    .maybeSingle();
  if (!checkin || checkin.customer_id !== session.userId) return json({ error: "That check-in couldn't be found." }, 422);
  const { data: tv } = await supabase.from("checkin_template_versions").select("questions").eq("id", checkin.template_version_id).maybeSingle();
  const questions = (tv?.questions ?? []) as Question[];

  switch (op) {
    case "draft.save": {
      const { answers } = normalizeAnswers(questions, body.answers, false);
      const saveId = typeof body.saveId === "string" && UUID.test(body.saveId) ? body.saveId : null;
      const base = Number.isInteger(body.baseRevision) ? (body.baseRevision as number) : 0;
      const { data, error } = await supabase.rpc("save_checkin_draft", { p_checkin: checkinId, p_answers: answers, p_base_revision: base, p_save_id: saveId });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision: number; conflict?: boolean; answers?: Answers; missing?: boolean; submitted_revision?: number };
      return r.ok ? json({ ok: true, revision: r.revision }) : json(r, 409);
    }

    case "draft.discard": {
      const { error } = await supabase.rpc("discard_checkin_draft", { p_checkin: checkinId });
      return error ? dbFailure(error) : json({ ok: true });
    }

    case "submit": {
      const submitId = typeof body.submitId === "string" && UUID.test(body.submitId) ? body.submitId : null;
      if (!submitId) return json({ error: "That couldn't be sent. Reload the page and try again." }, 422);
      const base = Number.isInteger(body.baseRevision) ? (body.baseRevision as number) : -1;
      // A repeat of a send whose reply was lost: already recorded, so say so
      // before anything else (the database recognises it too).
      const { data: already } = await supabase.from("checkin_submissions").select("revision").eq("checkin_id", checkinId).eq("submit_id", submitId).maybeSingle();
      if (already) return json({ ok: true, revision: already.revision, status: checkin.status, replayed: true });
      const { answers, mediaIds, problems, missing } = normalizeAnswers(questions, body.answers, true);
      if (problems.length) return json({ error: `Please check: ${problems.join(" ")}` }, 422);
      if (missing.length) return json({ error: "A few answers are still needed before sending.", missing }, 422);

      let substantive = true;
      if (checkin.current_revision > 0) {
        const { data: prev } = await supabase
          .from("checkin_submissions")
          .select("answers")
          .eq("checkin_id", checkinId)
          .eq("revision", checkin.current_revision)
          .maybeSingle();
        const change = correctionChanges(questions, ((prev?.answers ?? {}) as Answers), answers);
        if (change.changed.length === 0) return json({ error: "Nothing has changed from what you sent." }, 422);
        substantive = change.substantive;
      }

      // The period's progress as the client's records stand now, read with the
      // client's own session. If it can't be built, the check-in still goes
      // and says the summary is unavailable — it never blocks sending.
      let snapshot: ProgressSnapshot | null = null;
      try {
        const [plans, prefs] = await Promise.all([plansForEnrollment(checkin.enrollment_id), trackingPreferences(session.userId)]);
        snapshot = await buildSnapshot({
          enrollmentId: checkin.enrollment_id,
          plans,
          from: checkin.period_start,
          to: checkin.period_end,
          today: localDate(new Date(), checkin.timezone),
          timeZone: checkin.timezone,
          weightUnit: prefs.weight_unit,
          lengthUnit: prefs.length_unit,
        });
      } catch {
        snapshot = null;
      }

      const admin = createAdminClient();
      if (!admin) return json({ error: "Sending isn't available in this environment." }, 500);
      const { data, error } = await admin.rpc("submit_checkin", {
        p_actor: session.userId,
        p_checkin: checkinId,
        p_answers: answers,
        p_media: mediaIds,
        p_submit_id: submitId,
        p_base_revision: base,
        p_substantive: substantive,
        p_change_note: cleanText(body.changeNote, 300) || null,
        p_snapshot: snapshot,
      });
      if (error) return dbFailure(error);
      const r = data as { ok: boolean; revision: number; status: string; conflict?: boolean; substantive?: boolean; replayed?: boolean };
      return r.ok ? json(r) : json(r, 409);
    }

    default:
      return json({ error: "Unknown request." }, 400);
  }
}
