import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextArea } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { PhotoCompare, type PhotoView } from "@/components/tracking/photos";
import { FoodPhoto } from "@/components/tracking/food-photo";
import { ProgressOverview, RangePicker } from "@/components/tracking/progress-overview";
import { formatDay } from "@/lib/format";
import { localDate } from "@/lib/programmes/content";
import { coachingIsLive, myClient, plansForEnrollment } from "@/lib/programmes/server";
import { setTrackingFocusAction } from "@/lib/tracking/actions";
import { FOCUS_LABEL, MEAL_LABEL } from "@/lib/tracking/labels";
import { buildOverview } from "@/lib/tracking/overview";
import { resolveRange } from "@/lib/tracking/progress";
import { clientBasics, foodDays, progressPhotos, trackingFocus, trackingPreferences } from "@/lib/tracking/server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Client progress" };
export const dynamic = "force-dynamic";

/*
 * What the client has recorded, for their current coach to review. Read-only:
 * a coach never edits a client's results. What appears is decided by the
 * database — records from before this coach took over appear only if the
 * client chose to share them, photos by the stricter rule.
 */
export default async function CoachClientProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; exercise?: string }>;
}) {
  const [{ enrollmentId }, sp] = await Promise.all([params, searchParams]);
  const base = `/coach/programmes/clients/${enrollmentId}/progress`;
  await requireCoach(base);
  const client = await myClient(enrollmentId);
  if (!client) notFound();
  const basics = await clientBasics(enrollmentId);
  if (!basics) notFound();

  const today = localDate(new Date(), basics.timezone);
  const range = resolveRange(sp, today);
  const supabase = await createClient();
  const { data: assignment } = supabase
    ? await supabase.from("enrollment_assignments").select("id").eq("enrollment_id", enrollmentId).is("effective_to", null).maybeSingle()
    : { data: null };
  const [live, plans, prefs, focus, photos, food] = await Promise.all([
    coachingIsLive(enrollmentId),
    plansForEnrollment(enrollmentId),
    trackingPreferences(basics.customerId),
    trackingFocus(enrollmentId, (assignment?.id as string | undefined) ?? null),
    progressPhotos(enrollmentId),
    foodDays(enrollmentId, range.from, range.to),
  ]);
  const overview = await buildOverview({
    enrollmentId,
    plans,
    range,
    today,
    timeZone: basics.timezone,
    weightUnit: prefs.weight_unit,
    lengthUnit: prefs.length_unit,
  });
  const keep: Record<string, string> = range.id === "custom" ? { from: range.from, to: range.to } : { range: range.id };
  const photosInRange: PhotoView[] = photos.filter((p) => p.takenOn >= range.from && p.takenOn <= range.to);

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href={`/coach/programmes/clients/${enrollmentId}`} className="text-brand underline underline-offset-4">← {client.client_name}&rsquo;s programme</Link></p>
      <PageHeader title={`${client.client_name}: progress`}>
        What {client.client_name} has recorded, as they recorded it. You can review it; you can&rsquo;t change it. Shown in their units ({prefs.weight_unit}, {prefs.length_unit}).
      </PageHeader>

      {!live ? (
        <Notice tone="bad">
          Coaching with {client.client_name} is paused, so they can&rsquo;t add new entries and you can&rsquo;t change what you ask them to track. Everything already recorded stays here.
        </Notice>
      ) : null}

      <Panel title="What you'd find useful to track" id="focus" description="Your client sees this as a suggestion. Every field stays optional for them — photos and measurements especially.">
        {live ? (
          <ActionForm action={setTrackingFocusAction}>
            <input type="hidden" name="enrollment_id" value={enrollmentId} />
            <fieldset>
              <legend className="sr-only">Fields</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(FOCUS_LABEL).map(([id, label]) => (
                  <label key={id} className="flex min-h-11 items-center gap-3">
                    <input type="checkbox" name="fields" value={id} defaultChecked={focus?.fields.includes(id)} className="size-5 accent-brand" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <TextArea name="note" label="A note for your client" defaultValue={focus?.note ?? ""} rows={3} maxLength={500} className="mt-4" />
            <div className="mt-4">
              <SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton>
            </div>
          </ActionForm>
        ) : focus ? (
          <p>{focus.fields.map((f) => FOCUS_LABEL[f] ?? f).join(" · ") || "Nothing marked."}</p>
        ) : (
          <p className="text-ink-muted">Nothing marked.</p>
        )}
      </Panel>

      <RangePicker range={range} base={base} />

      <div className="mt-6">
        <ProgressOverview
          overview={overview}
          range={range}
          weightUnit={prefs.weight_unit}
          lengthUnit={prefs.length_unit}
          who="coach"
          workoutHref={(id) => `${base}/workouts/${id}`}
          exerciseParam={sp.exercise}
          exerciseHref={(key) => `${base}?${new URLSearchParams({ ...keep, exercise: key }).toString()}#perf-heading`}
        />
      </div>

      <Panel title="Progress photos" id="photos" description="Private. Each opens through a link that expires after two minutes.">
        {photosInRange.length ? (
          <>
            <PhotoCompare photos={photosInRange} />
            <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photosInRange.filter((p) => p.state === "ready").map((p) => (
                <li key={p.id}>
                  <a href={`/api/media/${p.mediaId}`} className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${p.mediaId}?variant=preview`} alt={`Progress photo, ${formatDay(p.takenOn)}${p.pose ? `, ${p.pose}` : ""}`} className="aspect-[3/4] w-full rounded-lg bg-brand-tint object-contain" />
                  </a>
                  <p className="mt-1 text-sm">{formatDay(p.takenOn, { month: "short", day: "numeric", year: "numeric" })}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-muted">No progress photos in this period that you can see. Photos are optional, and earlier ones are shared with a new coach only if the client chose to.</p>
        )}
      </Panel>

      <Panel title="Food diary" id="food" description="Entries as the client made them. Numbers are theirs, typed only when they knew them. A day with no entries is unrecorded, not zero.">
        {food.length ? (
          <ul className="space-y-4">
            {food.slice(0, 21).map((d) => (
              <li key={d.date} className="rounded-xl border border-line p-4">
                <p className="font-semibold">
                  {formatDay(d.date, { weekday: "long", month: "short", day: "numeric" })}
                  <span className="font-normal text-ink-muted"> · {d.entries.length ? (d.complete ? "marked complete" : "partial record") : "no entries"}</span>
                </p>
                <ul className="mt-2 space-y-3">
                  {d.entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-3">
                      <FoodPhoto mediaId={e.media_id} state={e.mediaState} alt={`Food photo, ${MEAL_LABEL[e.meal]}, ${formatDay(d.date)}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{MEAL_LABEL[e.meal]}</p>
                        {e.description ? <p className="whitespace-pre-line">{e.description}</p> : null}
                        {e.kcal !== null || e.protein_g !== null ? (
                          <p className="tabular text-ink-muted">{[e.kcal !== null ? `${e.kcal} kcal` : "", e.protein_g !== null ? `${e.protein_g} g protein` : ""].filter(Boolean).join(" · ")} (client&rsquo;s numbers)</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">No food diary entries in this period.</p>
        )}
      </Panel>

      <p className="mt-8 text-sm text-ink-muted">Structured check-ins and written feedback on these records are coming separately.</p>
    </div>
  );
}
