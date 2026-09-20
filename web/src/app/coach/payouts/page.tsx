import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { Facts, Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { setPayoutDestinationAction } from "../actions";

export const metadata = { title: "Payout details" };

interface Destination {
  channel: string;
  masked_reference: string;
  account_holder_name: string | null;
  country: string | null;
  currency: string;
  review_state: "pending_review" | "approved" | "rejected";
  created_at: string;
}

export default async function CoachPayoutsPage() {
  const session = await requireCoach("/coach/payouts");
  const supabase = (await createClient())!;
  const { data } = await supabase.rpc("get_my_payout_destination");
  const destination = data as Destination | null;
  const verified = session.aal === "aal2";

  return (
    <div>
      <PageHeader title="Payout details">
        Where TalentYak sends your earnings. For your protection, changing these needs your authenticator app, and new details
        are checked before any money is sent to them.
      </PageHeader>

      <Notice>
        TalentYak hasn&rsquo;t confirmed which transfer services it will use to pay coaches in Nepal yet. Enter the details you&rsquo;d like
        to be paid through; you&rsquo;ll be contacted if they need to change before the first payout.
      </Notice>

      <Panel title="Current details" id="current">
        {destination ? (
          <Facts
            items={[
              ["Method", destination.channel],
              ["Account", destination.masked_reference],
              ["Account holder", destination.account_holder_name ?? "—"],
              ["Country", destination.country ?? "—"],
              ["Currency", destination.currency],
              [
                "Status",
                <StatusPill key="s" tone={destination.review_state === "approved" ? "good" : destination.review_state === "rejected" ? "bad" : "neutral"}>
                  {destination.review_state === "approved" ? "Checked" : destination.review_state === "rejected" ? "Not accepted — please update" : "Waiting to be checked"}
                </StatusPill>,
              ],
              ["Added", formatDate(destination.created_at, session.provider.timezone)],
            ]}
          />
        ) : (
          <p className="text-ink-muted">No payout details yet. Payouts can&rsquo;t be sent until you add them.</p>
        )}
      </Panel>

      <Panel title={destination ? "Change details" : "Add details"} id="change">
        {!verified ? (
          <div>
            <p>
              {session.hasVerifiedFactor
                ? "Confirm it's you with a code from your authenticator app first."
                : "Set up an authenticator app first. It stops anyone who learns your password from redirecting your earnings."}
            </p>
            <Link href="/account/security?next=/coach/payouts&reason=payouts" className="mt-3 inline-block font-semibold text-brand underline underline-offset-4">
              {session.hasVerifiedFactor ? "Confirm it's you" : "Set up two-factor authentication"}
            </Link>
          </div>
        ) : (
          <ActionForm action={setPayoutDestinationAction} className="grid gap-4 sm:max-w-lg">
            <TextField name="channel" label="How you want to be paid" required maxLength={40} placeholder="e.g. bank transfer, eSewa, Wise" />
            <TextField name="account_reference" label="Account number or ID" required maxLength={120} autoComplete="off" help="Exactly as your bank or service shows it. Only the last few characters are shown afterwards." />
            <TextField name="account_holder_name" label="Account holder name" required={false} maxLength={120} autoComplete="name" />
            <TextField name="country" label="Country code" required={false} maxLength={2} placeholder="NP" />
            <SelectField
              name="currency"
              label="Currency you'll receive"
              required
              defaultValue="USD"
              options={["USD", "NPR", "GBP", "EUR", "AUD", "CAD", "NZD", "INR"].map((c) => ({ value: c, label: c }))}
            />
            <div>
              <SubmitButton pendingLabel="Saving…">Save payout details</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Panel>
    </div>
  );
}
