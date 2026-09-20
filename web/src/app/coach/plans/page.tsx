import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { OFFER_STATUS_LABEL, formatMinor } from "@/lib/format";
import { createPlanAction } from "../actions";

export const metadata = { title: "Plans & pricing" };

export default async function CoachPlansPage() {
  const session = await requireCoach("/coach/plans");
  const supabase = (await createClient())!;

  const { data: offers } = await supabase
    .from("offers")
    .select("id, status, created_at, offer_versions(id, version, title, service_type, published_at, superseded_at, offer_prices(currency, amount_minor))")
    .eq("provider_id", session.provider.id)
    .order("created_at", { ascending: false });

  const approved = session.provider.status === "approved" && !session.provider.suspended_at;

  return (
    <div>
      <PageHeader title="Plans & pricing">
        You choose what you offer and what you charge. TalentYak keeps 20% of each payment; you see exactly what you receive before you publish.
      </PageHeader>

      {!approved ? (
        <Notice>
          You can prepare plans now. You&rsquo;ll be able to publish them once your profile has been approved.
        </Notice>
      ) : null}

      <Panel title="Your plans" id="plans">
        {(offers ?? []).length === 0 ? (
          <EmptyState icon="plans" title="No plans yet" headingLevel="h3">
            Create your first plan below — for example monthly coaching, or a single consultation.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {(offers ?? []).map((offer) => {
              const versions = [...(offer.offer_versions ?? [])].sort((a, b) => b.version - a.version);
              const live = versions.find((v) => v.published_at && !v.superseded_at);
              const draft = versions.find((v) => !v.published_at);
              const shown = live ?? draft ?? versions[0];
              return (
                <li key={offer.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <Link href={`/coach/plans/${offer.id}`} className="text-lg font-semibold underline-offset-4 hover:underline">
                      {shown?.title ?? "Untitled plan"}
                    </Link>
                    <p className="text-sm text-ink-muted">
                      {shown?.service_type === "recurring_coaching" ? "Monthly coaching" : "One-off session"}
                      {live?.offer_prices?.length
                        ? ` · ${live.offer_prices.map((p) => formatMinor(p.amount_minor, p.currency)).join(" / ")}`
                        : ""}
                      {live ? ` · version ${live.version}` : ""}
                      {draft && live ? " · unpublished changes" : ""}
                    </p>
                  </div>
                  <StatusPill tone={offer.status === "published" ? "good" : "neutral"}>{OFFER_STATUS_LABEL[offer.status]}</StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Create a plan" id="create" description="Start with a name and the kind of plan. You'll add what's included and the price next.">
        <ActionForm action={createPlanAction} className="grid gap-4 sm:max-w-lg">
          <TextField name="title" label="Plan name" required maxLength={120} placeholder="e.g. Monthly strength coaching" />
          <SelectField
            name="kind"
            label="Kind of plan"
            required
            defaultValue="monthly"
            options={[
              { value: "monthly", label: "Monthly coaching — billed every month, client can cancel for the next month" },
              { value: "one_off", label: "One-off session — paid once" },
            ]}
            help="Longer commitments and prepaid packages aren't available yet: their cancellation and refund rules are still being decided."
          />
          <div>
            <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
