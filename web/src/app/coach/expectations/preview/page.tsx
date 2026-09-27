import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ExpectationsDocument } from "@/components/expectations/document";
import { Notice } from "@/components/ui/panel";
import { coachPhotoUrl } from "@/lib/storage/photos";
import { getLivePlatform, getMyCoachVersions } from "@/lib/expectations/server";
import { COACH_STARTER } from "@/lib/expectations/template";
import type { PlanFacts } from "@/lib/expectations/types";

export const metadata = { title: "Preview · Welcome & expectations" };
export const dynamic = "force-dynamic";

const PLAN_FIELDS =
  "id, title, service_type, calls_included_per_month, call_duration_minutes, check_in_cadence, response_time_hours, programme_included, programme_review_cadence, form_review_included, messaging_channel, additional_inclusions, published_at, superseded_at";

export default async function CoachExpectationsPreviewPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan: planId } = await searchParams;
  const session = await requireCoach("/coach/expectations/preview");
  const { provider } = session;
  const supabase = (await createClient())!;

  const [{ draft, live }, platform, { data: offers }, { data: profile }] = await Promise.all([
    getMyCoachVersions(provider.id),
    getLivePlatform(),
    supabase.from("offers").select(`id, status, offer_versions(${PLAN_FIELDS})`).eq("provider_id", provider.id),
    supabase.from("provider_public_profiles").select("photo_path").eq("provider_id", provider.id).maybeSingle(),
  ]);

  const coach = draft ?? live ?? { ...COACH_STARTER, version: 1 };
  const plans = ((offers ?? []) as { id: string; status: string; offer_versions: (PlanFacts & { id: string; published_at: string | null; superseded_at: string | null })[] }[])
    .flatMap((o) => o.offer_versions.filter((v) => v.published_at && !v.superseded_at));
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const label = draft ? `Preview of draft version ${draft.version} — not published` : live ? `Preview of live version ${live.version}` : "Preview of the starter template — not published";

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-4 print:hidden">
        <Link href="/coach/expectations" className="font-semibold text-brand underline underline-offset-4">← Back to editing</Link>
      </p>
      {plans.length > 1 ? (
        <nav aria-label="Preview with a plan" className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-sm print:hidden">
          <span className="font-semibold">Show with plan:</span>
          {plans.map((p) => (
            <Link key={p.id} href={`/coach/expectations/preview?plan=${p.id}`} aria-current={p.id === plan?.id ? "page" : undefined} className="underline underline-offset-4 aria-[current=page]:font-semibold">
              {p.title}
            </Link>
          ))}
        </nav>
      ) : null}
      {!plan ? <div className="mb-4"><Notice>You have no published plan yet, so plan details aren&rsquo;t shown. Each client sees the details of the plan they bought.</Notice></div> : null}
      {platform ? (
        <ExpectationsDocument
          platform={platform}
          coach={coach}
          coachName={provider.display_name}
          coachPhotoUrl={coachPhotoUrl(profile?.photo_path)}
          plan={plan}
          personal={{
            clientName: "Sample client (not a real person)",
            startDate: new Date().toISOString(),
            presentedAt: new Date().toISOString(),
            source: "purchase",
            acknowledgedAt: null,
            acknowledgementRequested: true,
          }}
          previewLabel={label}
          timeZone={provider.timezone}
        />
      ) : (
        <Notice tone="bad">
          TalentYak hasn&rsquo;t published its own section of this document yet, so the full preview isn&rsquo;t available. You can still write and publish yours.
        </Notice>
      )}
    </div>
  );
}
