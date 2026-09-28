import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton } from "@/components/form/fields";
import { Panel } from "@/components/ui/panel";
import { PendingEntries } from "@/components/tracking/pending-entries";
import { ProgressOverview, RangePicker } from "@/components/tracking/progress-overview";
import { TrackingHeader } from "@/components/tracking/tracking-nav";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { saveTrackingPreferencesAction } from "@/lib/tracking/actions";
import { clientTracking } from "@/lib/tracking/context";
import { buildOverview } from "@/lib/tracking/overview";
import { resolveRange } from "@/lib/tracking/progress";

export const metadata: Metadata = { title: "Your progress" };
export const dynamic = "force-dynamic";

export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; exercise?: string }>;
}) {
  const [{ enrollmentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}`);
  const range = resolveRange(sp, ctx.today);
  const overview = await buildOverview({
    enrollmentId,
    plans: ctx.plans,
    range,
    today: ctx.today,
    timeZone: ctx.tz,
    weightUnit: ctx.prefs.weight_unit,
    lengthUnit: ctx.prefs.length_unit,
  });
  const keep: Record<string, string> = range.id === "custom" ? { from: range.from, to: range.to } : { range: range.id };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <TrackingHeader
        base={ctx.base}
        current="overview"
        title="Your progress"
        subtitle={`${ctx.enrollment.planTitle} with ${ctx.enrollment.coachName}. Only you and your current coach can see this.`}
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        focus={ctx.focus}
        coachName={ctx.enrollment.coachName}
      />
      <PendingEntries viewerId={ctx.session.userId} live={ctx.writeState === "live"} pausedNotice={PAUSED_FOR_PAYMENT_NOTICE} />

      <nav aria-label="Record something" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href={`/account/plan/${enrollmentId}`}>Today&rsquo;s workout</ButtonLink>
        <ButtonLink href={`${ctx.base}/body`} variant="secondary">Add weight or measurements</ButtonLink>
        <ButtonLink href={`${ctx.base}/food`} variant="secondary">Food diary</ButtonLink>
      </nav>

      <RangePicker range={range} base={ctx.base} />

      <div className="mt-6">
        <ProgressOverview
          overview={overview}
          range={range}
          weightUnit={ctx.prefs.weight_unit}
          lengthUnit={ctx.prefs.length_unit}
          who="client"
          workoutHref={(id) => `${ctx.base}/workouts/${id}`}
          exerciseParam={sp.exercise}
          exerciseHref={(key) => `${ctx.base}?${new URLSearchParams({ ...keep, exercise: key }).toString()}#perf-heading`}
        />
      </div>

      <Panel title="Units and reminders" id="settings">
        <ActionForm action={saveTrackingPreferencesAction} className="grid gap-4 sm:grid-cols-2">
          <SelectField name="weight_unit" label="Weights in" required defaultValue={ctx.prefs.weight_unit} options={[{ value: "kg", label: "Kilograms (kg)" }, { value: "lb", label: "Pounds (lb)" }]} />
          <SelectField name="length_unit" label="Measurements in" required defaultValue={ctx.prefs.length_unit} options={[{ value: "cm", label: "Centimetres (cm)" }, { value: "in", label: "Inches (in)" }]} />
          <CheckboxField
            name="log_reminders"
            className="sm:col-span-2"
            defaultChecked={ctx.prefs.log_reminders}
            label="A gentle reminder in the evening if a planned workout isn't logged yet"
            help="At most one a day, only on days your plan has a session, and only here in your notifications — never an email."
          />
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
