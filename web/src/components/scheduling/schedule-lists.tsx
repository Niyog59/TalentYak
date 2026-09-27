import Link from "next/link";
import { ProposalActions } from "@/components/scheduling/proposal-actions";
import type { ScheduleAppointment, ScheduleProposal } from "@/lib/scheduling/server";
import {
  APPOINTMENT_STATE_LABEL,
  HOLD_REASON_LABEL,
  PROPOSAL_STATE_LABEL,
  bothZones,
  durationLabel,
  type AppointmentState,
} from "@/lib/scheduling/types";

const tone: Record<string, string> = {
  booked: "bg-brand-tint",
  tentative: "bg-accent-tint",
  on_hold: "bg-accent-tint",
  held: "bg-paper-raised",
};

export function ProposalList({
  proposals,
  viewerId,
  viewerTz,
  durationsFor,
  empty,
}: {
  proposals: ScheduleProposal[];
  viewerId: string;
  viewerTz: string;
  durationsFor: (p: ScheduleProposal) => { durations: number[]; fixed?: number | null };
  empty: string;
}) {
  if (proposals.length === 0) return <p className="text-ink-muted">{empty}</p>;
  return (
    <ul className="grid gap-4">
      {proposals.map((p) => {
        const mine = p.proposed_by === viewerId;
        const d = durationsFor(p);
        const minutes = Math.round(p.duration_minutes);
        return (
          <li key={p.id} className="rounded-xl border border-line bg-surface p-4">
            <p className="text-sm font-semibold text-ink-muted">
              {mine ? `You suggested to ${p.otherName}` : `${p.otherName} suggested`} · {PROPOSAL_STATE_LABEL[p.state]}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {p.replaces_appointment_id ? "New time: " : ""}{bothZones(p.starts_at, viewerTz, p.otherTz, p.otherName)}
            </p>
            <p className="text-sm">
              {durationLabel(minutes)}
              {p.recurrence === "weekly" ? ` · every week, kept at this local time in ${p.reference_timezone}` : ""}
              {p.series_scope === "future" ? " · this and later sessions" : ""}
              {p.kind === "consultation" ? " · one-off session" : ""}
            </p>
            {p.state === "pending" ? (
              <>
                <p className="mt-1 text-xs text-ink-muted">Not booked. Expires {bothZones(p.expires_at, viewerTz, null, "")} if nobody answers.</p>
                <ProposalActions
                  proposalId={p.id}
                  mine={mine}
                  kind={p.kind}
                  durations={d.durations}
                  fixedDuration={d.fixed}
                  viewerTz={viewerTz}
                  otherTz={p.otherTz}
                  otherLabel={p.otherName}
                />
              </>
            ) : p.state_reason && p.state !== "countered" ? (
              <p className="mt-1 text-sm">{p.state_reason}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AppointmentList({
  appointments,
  viewerTz,
  hrefFor,
  empty,
}: {
  appointments: ScheduleAppointment[];
  viewerTz: string;
  hrefFor: (a: ScheduleAppointment) => string;
  empty: string;
}) {
  if (appointments.length === 0) return <p className="text-ink-muted">{empty}</p>;
  return (
    <ul className="grid gap-3">
      {appointments.map((a) => {
        const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
        return (
          <li key={a.id}>
            <Link href={hrefFor(a)} className="block rounded-xl border border-line bg-surface p-4 hover:border-brand">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{a.otherName}{a.kind === "consultation" ? " · one-off session" : a.series_id ? " · weekly" : ""}</span>
                <span className={`rounded-full px-3 py-0.5 text-sm font-semibold ${tone[a.state] ?? "bg-paper-raised"}`}>
                  {APPOINTMENT_STATE_LABEL[a.state as AppointmentState] ?? a.state}
                </span>
              </span>
              <span className="mt-1 block">{bothZones(a.starts_at, viewerTz, a.otherTz, a.otherName)}</span>
              <span className="block text-sm text-ink-muted">{durationLabel(minutes)}</span>
              {a.state === "on_hold" && a.state_reason ? <span className="mt-1 block text-sm">{HOLD_REASON_LABEL[a.state_reason] ?? a.state_reason}</span> : null}
              {a.time_note ? <span className="mt-1 block text-sm">Clock change: {a.time_note}.</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
