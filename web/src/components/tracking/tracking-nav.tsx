import Link from "next/link";
import type { ReactNode } from "react";
import { FOCUS_LABEL } from "@/lib/tracking/labels";
import type { TrackingFocus, WriteState } from "@/lib/tracking/server";
import { Paragraphs } from "@/components/programmes/workout-view";

/* The client's tracking area: its header, tabs and the notices every tab shares. */

const TABS = [
  { id: "overview", label: "Progress", path: "" },
  { id: "workouts", label: "Workouts", path: "/workouts" },
  { id: "body", label: "Body & photos", path: "/body" },
  { id: "food", label: "Food diary", path: "/food" },
] as const;

export function TrackingHeader({
  base,
  current,
  title,
  subtitle,
  writeState,
  pausedNotice,
  focus,
  coachName,
  children,
}: {
  base: string;
  current: (typeof TABS)[number]["id"];
  title: string;
  subtitle: string;
  writeState: WriteState;
  pausedNotice: string;
  focus?: TrackingFocus | null;
  coachName?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <p><Link href="/account" className="text-brand underline underline-offset-4">← Your account</Link></p>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">{title}</h1>
      <p className="mt-2 text-lg text-ink-muted">{subtitle}</p>
      <nav aria-label="Tracking" className="mt-6 -mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-2">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={`${base}${t.path}`}
                aria-current={current === t.id ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full border px-4 font-semibold ${current === t.id ? "border-brand bg-brand text-white" : "border-line-strong bg-surface"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {writeState === "paused" ? (
        <p role="alert" className="mt-5 rounded-lg border border-danger bg-danger-tint p-4 font-medium">
          {pausedNotice} New entries are kept on this device and saved when coaching resumes.{" "}
          <Link href="/account/billing" className="underline">Update your card</Link>.
        </p>
      ) : writeState === "ended" ? (
        <p role="note" className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">This coaching has ended. Everything you recorded stays here for you to read; new entries can&rsquo;t be added.</p>
      ) : writeState === "unavailable" ? (
        <p role="note" className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">Coaching isn&rsquo;t active right now — for example, during a coach change. New entries wait on this device until it is.</p>
      ) : null}

      {focus && (focus.fields.length || focus.note) ? (
        <aside aria-label="What your coach finds useful" className="mt-5 rounded-xl border border-brand bg-brand-tint p-4">
          <p className="font-semibold">{coachName ?? "Your coach"} finds these useful to track</p>
          {focus.fields.length ? <p className="mt-1">{focus.fields.map((f) => FOCUS_LABEL[f] ?? f).join(" · ")}</p> : null}
          {focus.note ? <Paragraphs text={focus.note} className="mt-1" /> : null}
          <p className="mt-1 text-sm text-ink-muted">All optional — photos and measurements especially. Record what&rsquo;s useful to you.</p>
        </aside>
      ) : null}
      {children}
    </>
  );
}
