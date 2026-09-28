import type { Metadata } from "next";
import { Panel } from "@/components/ui/panel";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { BodyEntry, type BodyDayView } from "@/components/tracking/body-entry";
import { PendingEntries } from "@/components/tracking/pending-entries";
import { PhotoCompare, ProgressPhotos } from "@/components/tracking/photos";
import { TrackingHeader } from "@/components/tracking/tracking-nav";
import { addDays } from "@/lib/programmes/content";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { clientTracking } from "@/lib/tracking/context";
import { bodyEntries, progressPhotos } from "@/lib/tracking/server";

export const metadata: Metadata = { title: "Body and photos" };
export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export default async function BodyPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}/body`);
  const [days, photos] = await Promise.all([bodyEntries(enrollmentId, addDays(ctx.today, -730), addDays(ctx.today, 1)), progressPhotos(enrollmentId)]);
  const view: BodyDayView[] = days.map((d) => ({
    date: d.date,
    token: d.token,
    weight: d.weight
      ? {
          kg: Number(d.weight.weight_kg),
          value: d.weight.entered_value !== null ? Number(d.weight.entered_value) : Number(d.weight.weight_kg),
          unit: d.weight.entered_value !== null && d.weight.entered_unit ? d.weight.entered_unit : "kg",
        }
      : null,
    cm: d.measurements
      ? { waist: n(d.measurements.waist_cm), hips: n(d.measurements.hip_cm), chest: n(d.measurements.chest_cm), arm: n(d.measurements.arm_cm) }
      : null,
  }));
  const live = ctx.writeState === "live";
  const held = ctx.writeState === "live" || ctx.writeState === "not_permitted" ? null : ctx.writeState;
  const focusMeasures = Boolean(ctx.focus?.fields.some((f) => ["waist", "hips", "chest", "arm"].includes(f)));
  const processing = photos.some((p) => p.state !== "ready" && p.state !== "failed");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      {processing ? <AutoRefresh everySeconds={5} forSeconds={180} /> : null}
      <TrackingHeader
        base={ctx.base}
        current="body"
        title="Body and photos"
        subtitle="Weight, measurements and progress photos — each optional, each dated. Record whatever is useful to you."
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        focus={ctx.focus}
        coachName={ctx.enrollment.coachName}
      />
      <PendingEntries viewerId={ctx.session.userId} live={live} pausedNotice={PAUSED_FOR_PAYMENT_NOTICE} />

      <Panel title="Weight and measurements" id="body" description={`Dates follow your time zone (${ctx.zoneLabel}). You can go back and add or correct an earlier date.`}>
        <BodyEntry
          viewerId={ctx.session.userId}
          enrollmentId={enrollmentId}
          today={ctx.today}
          days={view}
          weightUnit={ctx.prefs.weight_unit}
          lengthUnit={ctx.prefs.length_unit}
          live={live}
          held={held}
          pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
          showMeasurements={focusMeasures || view.some((d) => d.cm)}
        />
      </Panel>

      <Panel title="Progress photos" id="photos" description="Private: only you and your current coach can see them, and only through links that expire after two minutes.">
        <ProgressPhotos viewerId={ctx.session.userId} enrollmentId={enrollmentId} today={ctx.today} photos={photos} live={live} />
      </Panel>

      <Panel title="Compare side by side" id="compare">
        <PhotoCompare photos={photos} />
      </Panel>
    </div>
  );
}
