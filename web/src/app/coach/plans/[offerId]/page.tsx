import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { EarningsPreview } from "@/components/coach/earnings-preview";
import { DataTable, Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { OFFER_STATUS_LABEL, formatDate, formatMinor } from "@/lib/format";
import { CHARGE_CURRENCIES } from "@/lib/payments/currencies";
import { CURRENT_COMMISSION_POLICY_ID } from "@/lib/policy/registry";
import { undeliverableInclusions } from "@/lib/fulfillment";
import {
  deleteDraftAction,
  newVersionAction,
  publishVersionAction,
  removePriceAction,
  saveDraftAction,
  setPriceAction,
  setSaleStateAction,
} from "../../actions";

export const metadata = { title: "Plan" };

interface Version {
  id: string;
  version: number;
  title: string;
  description: string;
  service_type: "recurring_coaching" | "one_off_consultation";
  billing_structure: string;
  calls_included_per_month: number | null;
  call_duration_minutes: number | null;
  check_in_cadence: string | null;
  response_time_hours: number | null;
  programme_included: boolean;
  programme_review_cadence: string | null;
  form_review_included: boolean;
  messaging_channel: string | null;
  intended_client: string | null;
  additional_inclusions: string[];
  commission_policy_id: string;
  published_at: string | null;
  superseded_at: string | null;
  row_version: number;
  offer_prices: { id: string; currency: string; amount_minor: number }[];
}

function Inclusions({ v }: { v: Version }) {
  const items: [string, string][] = [
    ["Training programme", v.programme_included ? `Included${v.programme_review_cadence ? `, reviewed ${v.programme_review_cadence}` : ""}` : "Not included"],
    ["Calls", v.calls_included_per_month ? `${v.calls_included_per_month} a month, ${v.call_duration_minutes} minutes each` : "Not included"],
    ["Check-ins", v.check_in_cadence ?? "Not included"],
    ["Messaging", v.messaging_channel ?? "Not included"],
    ["Replies within", v.response_time_hours ? `${v.response_time_hours} hours` : "Not stated"],
    ["Exercise form review", v.form_review_included ? "Included" : "Not included"],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
      {items.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="font-semibold">{k}</dt>
          <dd className="text-ink-muted">{val}</dd>
        </div>
      ))}
      {v.additional_inclusions.length ? (
        <div className="contents">
          <dt className="font-semibold">Also included</dt>
          <dd className="text-ink-muted">{v.additional_inclusions.join("; ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default async function CoachPlanPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const session = await requireCoach(`/coach/plans/${offerId}`);
  const supabase = (await createClient())!;

  const { data: offer } = await supabase
    .from("offers")
    .select("id, status, provider_id, offer_versions(*, offer_prices(id, currency, amount_minor))")
    .eq("id", offerId)
    .eq("provider_id", session.provider.id)
    .maybeSingle();
  if (!offer) notFound();

  const versions = ([...(offer.offer_versions ?? [])] as Version[]).sort((a, b) => b.version - a.version);
  const live = versions.find((v) => v.published_at && !v.superseded_at) ?? null;
  const draft = versions.find((v) => !v.published_at) ?? null;
  const history = versions.filter((v) => v.published_at && v.superseded_at);
  const approved = session.provider.status === "approved" && !session.provider.suspended_at;
  const recurring = (draft ?? live)?.service_type === "recurring_coaching";
  const hidden = (id: string) => (
    <>
      <input type="hidden" name="offer_id" value={offer.id} />
      <input type="hidden" name="version_id" value={id} />
    </>
  );

  return (
    <div>
      <p>
        <Link href="/coach/plans" className="text-brand underline underline-offset-4">← All plans</Link>
      </p>
      <PageHeader title={(draft ?? live)?.title ?? "Plan"}>
        <StatusPill tone={offer.status === "published" ? "good" : "neutral"}>{OFFER_STATUS_LABEL[offer.status]}</StatusPill>{" "}
        {recurring ? "Monthly coaching" : "One-off session"}
      </PageHeader>

      {live ? (
        <Panel title={`On sale now — version ${live.version}`} id="live" description={`Published ${formatDate(live.published_at, session.provider.timezone)}. A published version can't be edited; clients who signed up keep exactly these terms.`}>
          <p className="whitespace-pre-line">{live.description}</p>
          <div className="mt-4"><Inclusions v={live} /></div>
          <div className="mt-4 space-y-2">
            {live.offer_prices.map((p) => (
              <EarningsPreview key={p.currency} amountMinor={p.amount_minor} currency={p.currency} serviceType={live.service_type} commissionPolicyId={live.commission_policy_id} recurring={recurring} />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {!draft ? (
              <ActionForm action={newVersionAction}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <SubmitButton pendingLabel="Creating…" variant="secondary">Change price or inclusions</SubmitButton>
              </ActionForm>
            ) : null}
            {offer.status === "published" ? (
              <ActionForm action={setSaleStateAction}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="state" value="paused" />
                <SubmitButton pendingLabel="Pausing…" variant="secondary">Pause new sign-ups</SubmitButton>
              </ActionForm>
            ) : null}
            {offer.status === "paused" ? (
              <ActionForm action={setSaleStateAction}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="state" value="published" />
                <SubmitButton pendingLabel="Resuming…">Resume sign-ups</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {draft ? (
        <>
          <Panel title={`Draft — version ${draft.version}`} id="draft" description={live ? "Changes here don't affect the version on sale until you publish." : "Nobody can see this plan until you publish it."}>
            <ActionForm action={saveDraftAction} className="grid gap-5" noticeFirst>
              {hidden(draft.id)}
              <input type="hidden" name="row_version" value={draft.row_version} />
              <TextField name="title" label="Plan name" required defaultValue={draft.title} maxLength={120} />
              <TextArea name="description" label="Description" required={false} defaultValue={draft.description} maxLength={4000} rows={5} help="What the client gets and how it works, in your own words." />
              <TextField name="intended_client" label="Who it's for" required={false} defaultValue={draft.intended_client ?? ""} maxLength={300} />
              <fieldset className="grid gap-4 rounded-xl border border-line p-4">
                <legend className="px-1 font-semibold">What&rsquo;s included</legend>
                <CheckboxField name="programme_included" label="A training programme written by me" defaultChecked={draft.programme_included} />
                <TextField name="programme_review_cadence" label="Programme reviewed" required={false} defaultValue={draft.programme_review_cadence ?? ""} placeholder="e.g. every 4 weeks" maxLength={60} />
                <input type="hidden" name="service_type" value={draft.service_type} />
                {draft.service_type === "one_off_consultation" ? (
                  <TextField name="call_duration_minutes" label="Session length (minutes)" required inputMode="numeric" defaultValue={draft.call_duration_minutes?.toString() ?? ""} help="Shown before purchase. The client picks a time from your calendar when they buy." />
                ) : (
                  <>
                    <TextField name="calls_included_per_month" label="Video or audio calls a month" required={false} inputMode="numeric" defaultValue={draft.calls_included_per_month?.toString() ?? ""} help="Only if this plan includes a set number of calls. Leave empty for flexible coaching: you and your client arrange sessions as needed, with no quota." />
                    <TextField name="call_duration_minutes" label="Minutes per call" required={false} inputMode="numeric" defaultValue={draft.call_duration_minutes?.toString() ?? ""} />
                  </>
                )}
                <TextField name="check_in_cadence" label="Check-ins" required={false} defaultValue={draft.check_in_cadence ?? ""} placeholder="e.g. weekly" maxLength={60} />
                <TextField name="messaging_channel" label="Messaging" required={false} defaultValue={draft.messaging_channel ?? ""} placeholder="e.g. in-app messages" maxLength={60} />
                <TextField name="response_time_hours" label="I reply within (hours)" required={false} inputMode="numeric" defaultValue={draft.response_time_hours?.toString() ?? ""} />
                <CheckboxField name="form_review_included" label="Exercise form review from videos" defaultChecked={draft.form_review_included} />
                <TextArea name="additional_inclusions" label="Anything else included" required={false} defaultValue={draft.additional_inclusions.join("\n")} rows={3} help="One per line. Up to 20." />
              </fieldset>
              <div>
                <SubmitButton pendingLabel="Saving…">Save draft</SubmitButton>
              </div>
            </ActionForm>
          </Panel>

          <Panel title="Price" id="price" description="Set a price in each currency you want to be paid in. Clients are charged in the currency they choose from these.">
            <DataTable
              caption="Prices on this draft"
              head={["Currency", "Price", "What you receive", ""]}
              empty="No price yet."
              rows={draft.offer_prices.map((p) => [
                p.currency,
                formatMinor(p.amount_minor, p.currency),
                <EarningsPreview key="e" amountMinor={p.amount_minor} currency={p.currency} serviceType={draft.service_type} commissionPolicyId={CURRENT_COMMISSION_POLICY_ID} recurring={recurring} />,
                <ActionForm key="r" action={removePriceAction}>
                  {hidden(draft.id)}
                  <input type="hidden" name="price_id" value={p.id} />
                  <SubmitButton pendingLabel="Removing…" variant="quiet">Remove</SubmitButton>
                </ActionForm>,
              ])}
            />
            <ActionForm action={setPriceAction} resetOnSuccess className="mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              {hidden(draft.id)}
              <SelectField name="currency" label="Currency" required defaultValue="USD" options={CHARGE_CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} />
              <TextField name="amount" label={recurring ? "Price per month" : "Price"} required inputMode="decimal" placeholder="80" maxLength={12} />
              <div>
                <SubmitButton pendingLabel="Saving…" variant="secondary">Set price</SubmitButton>
              </div>
            </ActionForm>
          </Panel>

          <Panel title="Publish" id="publish">
            {!approved ? (
              <p>You can publish once your coach profile has been approved.</p>
            ) : (
              <ActionForm action={publishVersionAction} className="grid gap-4">
                {hidden(draft.id)}
                <p>
                  Publishing puts this version on sale{live ? ` and replaces version ${live.version} for new sign-ups` : ""}. Clients already signed up keep the terms they bought.
                </p>
                {undeliverableInclusions(draft).length ? (
                  <Notice>
                    Some things this plan includes aren&rsquo;t built into TalentYak yet ({undeliverableInclusions(draft).map((f) => f.label.toLowerCase()).join(", ")}). While TalentYak is in test mode that&rsquo;s fine; real payments stay switched off until they work.
                  </Notice>
                ) : null}
                <CheckboxField name="confirm" required label="I've checked the description, inclusions and prices. I understand a published version can't be edited." />
                <div>
                  <SubmitButton pendingLabel="Publishing…">Publish version {String(draft.version)}</SubmitButton>
                </div>
              </ActionForm>
            )}
            <ActionForm action={deleteDraftAction} className="mt-4">
              {hidden(draft.id)}
              <SubmitButton pendingLabel="Discarding…" variant="quiet">Discard this draft</SubmitButton>
            </ActionForm>
          </Panel>
        </>
      ) : null}

      {offer.status !== "archived" && (live || offer.status === "paused") ? (
        <Panel title="Archive" id="archive" description="Stops new sign-ups permanently. Clients already on this plan keep it until they cancel.">
          <ActionForm action={setSaleStateAction} className="grid gap-3">
            <input type="hidden" name="offer_id" value={offer.id} />
            <input type="hidden" name="state" value="archived" />
            <CheckboxField name="confirm" required label="Archive this plan" />
            <div>
              <SubmitButton pendingLabel="Archiving…" variant="secondary">Archive</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}

      {history.length ? (
        <Panel title="Earlier versions" id="history" description="Kept for the clients who signed up under them.">
          <DataTable
            caption="Earlier versions"
            head={["Version", "Published", "Replaced", "Prices"]}
            empty=""
            rows={history.map((v) => [
              String(v.version),
              formatDate(v.published_at, session.provider.timezone),
              formatDate(v.superseded_at, session.provider.timezone),
              v.offer_prices.map((p) => formatMinor(p.amount_minor, p.currency)).join(" / "),
            ])}
          />
        </Panel>
      ) : null}
    </div>
  );
}
