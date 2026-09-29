import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Figures, Section } from "@/components/admin/ui";
import { loaded } from "@/lib/admin/loaded";
import { FEATURES, MODE_LABEL } from "@/lib/features/registry";
import { getFeatureStates } from "@/lib/features/server";

export const metadata = { title: "Coaching operations" };

/*
 * How coaching is running, in counts. TalentYak doesn't read plans, logged
 * values, check-in answers or messages (AAF-PLAN-05, TY-TRACK-07, TY-MSG-04),
 * so this page never shows them — only how much is happening and where a
 * person is needed.
 */
export default async function CoachingOperationsPage() {
  await requireAdmin("/admin/coaching");
  const supabase = (await createClient())!;
  const [{ data, error }, states] = await Promise.all([supabase.rpc("admin_coaching_operations"), getFeatureStates()]);
  const o = (data ?? {}) as Record<string, number | Record<string, number>>;
  const n = (k: string) => loaded(Number(o[k] ?? 0));
  const rel = (o.relationships ?? {}) as Record<string, number>;
  const coachingFeatures = FEATURES.filter((f) => ["programmes", "logging", "check_ins", "messaging", "attachments", "bookings", "calls"].includes(f.key));

  return (
    <div>
      <AdminHeader eyebrow="Coaching" title="Coaching operations">
        <p>
          How much coaching is happening, and where it&rsquo;s stuck. Coaches run their own programmes; TalentYak doesn&rsquo;t read plans,
          logged results, check-in answers or messages, so none are shown here.
        </p>
      </AdminHeader>

      {error ? (
        <div className="mt-6"><ErrorNote /></div>
      ) : (
        <>
          <Section title="Relationships" id="relationships">
            <Figures
              items={[
                { label: "Active", value: loaded(rel.active ?? 0) },
                { label: "Paused for payment", value: loaded(rel.paused ?? 0), note: "History readable, new coaching paused" },
                { label: "Starting", value: loaded(rel.pending ?? 0) },
                { label: "Ended", value: loaded(rel.ended ?? 0) },
              ]}
            />
          </Section>
          <Section title="Programmes and logging" id="programmes">
            <Figures
              items={[
                { label: "Plan versions published (7 days)", value: n("plans_published_7d") },
                { label: "Plan updates scheduled", value: n("plan_updates_scheduled"), note: "Take effect on a later day" },
                { label: "Workouts logged (7 days)", value: n("workouts_logged_7d") },
                { label: "Uploads processing now", value: n("media_processing") },
              ]}
            />
          </Section>
          <Section title="Check-ins" id="checkins" actions={<Link href="/admin/check-ins" className="text-brand underline">Check-ins needing TalentYak</Link>}>
            <Figures
              items={[
                { label: "Requested, not yet sent", value: n("checkins_open") },
                { label: "Waiting for coach feedback", value: n("checkins_awaiting_review") },
                { label: "Flagged after a coach change", value: n("checkins_flagged"), href: "/admin/check-ins" },
                { label: "Conversations active (7 days)", value: n("conversations_active_7d") },
              ]}
            />
          </Section>
          <Section title="Sessions and calls" id="sessions" actions={<Link href="/admin/scheduling" className="text-brand underline">Scheduling &amp; calls</Link>}>
            <Figures
              items={[
                { label: "Upcoming sessions", value: n("sessions_upcoming") },
                { label: "Session requests waiting", value: n("requests_pending") },
                { label: "Sessions on hold", value: n("sessions_on_hold"), note: "Need the coach or TalentYak", href: "/admin/scheduling" },
                { label: "Call rooms open now", value: n("calls_open_now") },
                { label: "Technical failures (30 days)", value: n("calls_interrupted_30d"), note: "Recorded outcomes" },
                { label: "Uploads failed (30 days)", value: n("media_failed_30d"), href: "/admin/operations#media" },
                { label: "Messaging settings", value: loaded(<Link key="m" href="/admin/features?change=messaging#messaging" className="text-brand underline">{MODE_LABEL[states.modes.messaging]}</Link>) },
                { label: "Attachments", value: loaded(<Link key="a" href="/admin/features?change=attachments#attachments" className="text-brand underline">{MODE_LABEL[states.modes.attachments]}</Link>) },
              ]}
            />
          </Section>
        </>
      )}

      <Section title="Switches for coaching features" id="switches" actions={<Link href="/admin/features" className="text-brand underline">Feature controls</Link>}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {coachingFeatures.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span>{f.label}</span>
              <Badge tone={states.modes[f.key] === "on" ? "good" : states.modes[f.key] === "off" ? "bad" : "warn"}>{MODE_LABEL[states.modes[f.key]]}</Badge>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
