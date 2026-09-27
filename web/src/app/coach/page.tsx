import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { PROVIDER_STATUS_LABEL, formatMinor } from "@/lib/format";
import { setCapacityAction } from "./actions";

export const metadata = { title: "Overview" };

interface CapacitySummary {
  status: string;
  max_active_clients: number | null;
  capacity_ceiling: number | null;
  accepting_new_clients: boolean;
  published_at: string | null;
  commitments: number;
  held_checkouts: number;
}

export default async function CoachOverviewPage() {
  const session = await requireCoach("/coach");
  const supabase = (await createClient())!;
  const { provider } = session;

  const [{ data: capacity }, { data: profile }, { data: offers }, { data: balances }, { data: liveExpectations }, { count: hourWindows }] = await Promise.all([
    supabase.rpc("my_capacity_summary"),
    supabase.from("provider_public_profiles").select("display_name, bio, languages").eq("provider_id", provider.id).maybeSingle(),
    supabase.from("offers").select("id, status").eq("provider_id", provider.id),
    supabase.from("coach_balances").select("*").eq("provider_id", provider.id),
    supabase.from("coach_expectation_versions").select("id").eq("provider_id", provider.id)
      .not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
    supabase.from("availability_windows").select("id", { count: "exact", head: true }).eq("provider_id", provider.id),
  ]);
  const cap = capacity as CapacitySummary | null;
  const onSale = (offers ?? []).filter((o) => o.status === "published").length;

  const steps: { done: boolean; label: string; href: string }[] = [
    { done: Boolean(profile?.bio && profile.bio.length >= 40 && profile.languages?.length && provider.timezone), label: "Complete your profile", href: "/coach/profile" },
    { done: !["onboarding", "invited"].includes(provider.status), label: "Submit your profile for review", href: "/coach/profile" },
    { done: provider.status === "approved", label: "Get approved", href: "/coach/profile" },
    { done: onSale > 0, label: "Publish a plan with your price", href: "/coach/plans" },
    { done: Boolean(liveExpectations), label: "Publish your welcome & expectations (needed before anyone can buy)", href: "/coach/expectations" },
    { done: (hourWindows ?? 0) > 0, label: "Set the hours clients can book you", href: "/coach/calendar#hours" },
    { done: Boolean(provider.published_at), label: "Make your profile public", href: "/coach/profile" },
    { done: Boolean(cap?.accepting_new_clients), label: "Open for new clients", href: "#capacity" },
  ];

  return (
    <div>
      <PageHeader title={`Hello, ${provider.display_name}`}>
        <StatusPill tone={provider.status === "approved" ? "good" : provider.status === "suspended" ? "bad" : "neutral"}>
          {PROVIDER_STATUS_LABEL[provider.status] ?? provider.status}
        </StatusPill>
      </PageHeader>

      {provider.status === "submitted" || provider.status === "in_review" ? (
        <Notice>Your profile is being reviewed. You can keep preparing your plans while you wait; you can publish them once you&rsquo;re approved.</Notice>
      ) : null}

      <Panel title="Getting set up" id="setup">
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-3">
              <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${s.done ? "border-brand bg-brand text-white" : "border-line-strong"}`}>
                {s.done ? "✓" : i + 1}
              </span>
              <Link href={s.href} className="underline-offset-4 hover:underline">
                {s.label}
              </Link>
              <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Clients and capacity"
        id="capacity"
        description="You decide how many clients you take and whether you're open for new ones. The limit can't go below the clients you already have."
      >
        {cap ? (
          <>
            <p>
              <strong>{cap.commitments}</strong> current client{cap.commitments === 1 ? "" : "s"}
              {cap.held_checkouts ? <> · {cap.held_checkouts} checkout{cap.held_checkouts === 1 ? "" : "s"} in progress</> : null}
              {" · "}limit {cap.max_active_clients ?? "none"}
              {cap.capacity_ceiling ? <> · TalentYak has set a maximum of {cap.capacity_ceiling} for now</> : null}
            </p>
            <ActionForm action={setCapacityAction} className="mt-4 grid gap-4 sm:max-w-md">
                  <TextField
                    name="max_active_clients"
                    label="Most clients at one time"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={500}
                    required={false}
                    defaultValue={cap.max_active_clients ? String(cap.max_active_clients) : ""}
                  />
                  <CheckboxField name="unlimited" label="No limit" defaultChecked={cap.max_active_clients === null && !cap.capacity_ceiling} />
                  <CheckboxField
                    name="accepting"
                    label="Accepting new clients"
                    defaultChecked={cap.accepting_new_clients}
                    help={provider.status !== "approved" ? "Available once you're approved." : undefined}
                  />
                  <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </ActionForm>
          </>
        ) : (
          <p className="text-ink-muted">Capacity couldn&rsquo;t be loaded. Refresh the page to try again.</p>
        )}
      </Panel>

      <Panel title="Earnings at a glance" id="earnings">
        {(balances ?? []).length === 0 ? (
          <p className="text-ink-muted">No earnings yet. They appear here when a client pays.</p>
        ) : (
          <ul className="space-y-1">
            {(balances ?? []).map((b) => (
              <li key={b.currency}>
                {b.currency}: {formatMinor(b.eligible_minor, b.currency)} ready to be paid · {formatMinor(b.pending_minor, b.currency)} pending
              </li>
            ))}
          </ul>
        )}
        <Link href="/coach/earnings" className="mt-3 inline-block font-semibold text-brand underline underline-offset-4">
          See earnings and statements
        </Link>
      </Panel>
    </div>
  );
}
