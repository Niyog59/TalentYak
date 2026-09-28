import type { PlanningContext } from "@/lib/programmes/server";
import { EQUIPMENT_LABEL, EXPERIENCE_LABEL } from "@/lib/programmes/labels";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

/*
 * What the client has told their coach, beside the plan being written. Health
 * notes are shown in their own box and say who can see them: the client and
 * their current coach — never TalentYak staff, never a previous coach.
 */

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="contents">
      <dt className="font-semibold">{label}</dt>
      <dd className={value ? "whitespace-pre-line" : "text-ink-muted"}>{value || "Not given"}</dd>
    </div>
  );
}

export function PlanningContextPanel({ ctx, timeZone, focus }: { ctx: PlanningContext; timeZone?: string | null; focus?: "workout" | "nutrition" }) {
  const t = ctx.training;
  const h = ctx.health;
  if (!t && !h && !ctx.bookingAnswers) {
    return (
      <p className="text-ink-muted">
        Your client hasn&rsquo;t filled in their training &amp; food profile yet. Ask them in messages — they can add it from their plan page.
      </p>
    );
  }
  const equipment = t?.equipment.length ? t.equipment.map((e) => EQUIPMENT_LABEL[e] ?? e).join(", ") : null;
  return (
    <div className="space-y-4">
      {t ? (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
          {focus !== "nutrition" ? (
            <>
              <Row label="Experience" value={[t.experience ? EXPERIENCE_LABEL[t.experience] : "", t.experience_note ?? ""].filter(Boolean).join(" — ")} />
              <Row label="Equipment" value={[equipment ?? "", t.equipment_note ?? ""].filter(Boolean).join(" — ")} />
              <Row label="Time per session" value={t.session_minutes ? `About ${t.session_minutes} minutes` : null} />
              <Row label="Days a week" value={t.days_per_week ? String(t.days_per_week) : null} />
            </>
          ) : null}
          {focus !== "workout" ? (
            <>
              <Row label="Food preferences" value={t.food_preferences} />
              <Row label="Local, affordable foods" value={t.local_foods} />
            </>
          ) : null}
        </dl>
      ) : null}

      <div className="rounded-lg border border-line-strong bg-paper-raised p-3">
        <p className="flex items-center gap-2 font-semibold">
          <Icon name="lock" className="size-4" /> Health notes — private to your client and you
        </p>
        {h && (h.limitations || h.allergies) ? (
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr]">
            <Row label="Injuries and limitations" value={h.limitations} />
            <Row label="Allergies and intolerances" value={h.allergies} />
          </dl>
        ) : (
          <p className="mt-1 text-ink-muted">None given.</p>
        )}
      </div>

      {ctx.bookingAnswers ? (
        <div>
          <p className="font-semibold">From their earlier booking questionnaire</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {Object.entries(ctx.bookingAnswers).map(([k, v]) => <Row key={k} label={k} value={v} />)}
          </dl>
        </div>
      ) : null}

      {t || h ? (
        <p className="text-sm text-ink-muted">
          Last updated by your client {formatDate([t?.updated_at, h?.updated_at].filter(Boolean).sort().at(-1) ?? null, timeZone)}.
        </p>
      ) : null}
    </div>
  );
}
