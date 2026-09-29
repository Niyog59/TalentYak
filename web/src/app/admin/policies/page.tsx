import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, Details, Section, Table } from "@/components/admin/ui";
import { listPolicies } from "@/lib/policy/registry";
import { evaluateLiveReadiness, isLiveBillingFlagSet } from "@/lib/policy/live-gate";
import { stripeMode } from "@/lib/payments/stripe";
import { CURRENT_LEGAL } from "@/lib/legal";
import { FULFILLMENT } from "@/lib/fulfillment";
import { posthogConfig } from "@/lib/analytics/posthog";
import { isDailyConfigured, isResendConfigured } from "@/lib/env";

export const metadata = { title: "Policies & launch" };

/*
 * Three different things, kept apart on purpose:
 *   · viewing a setting (everything on this page),
 *   · approving a policy (a founder decision, recorded in the decision
 *     register and applied as a new policy version — never a button here),
 *   · activating an operational capability (feature controls; and live
 *     payments only once every lock below is open).
 */

const OPEN_DECISIONS: { id: string; topic: string; blocks: string }[] = [
  { id: "OPEN-08", topic: "Coach change money rules: price differences, the part-used paid period, call allowances, refunds or credits", blocks: "Changing coach for real clients" },
  { id: "AAF-TERM-05", topic: "Cancellation and refunds for prepaid (multi-month) packages", blocks: "Selling prepaid packages" },
  { id: "OPEN-01a", topic: "Charging in more than one currency; how conversions and rounding are shown", blocks: "Multi-currency sales" },
  { id: "OPEN-02a", topic: "Auto-renewal consent and protecting existing prices", blocks: "Plan price changes for existing clients" },
  { id: "OPEN-05", topic: "Session notice periods, no-shows and make-up sessions", blocks: "Nothing automatic — outcomes are recorded only" },
  { id: "OPEN-07", topic: "How plan changes reach existing subscribers", blocks: "Changing a plan someone already bought" },
  { id: "OPEN-10", topic: "Market scope, vetting evidence, adults only, retention periods, recording consent", blocks: "Automatic deletion; wider launch" },
  { id: "OPEN-12", topic: "Stripe settlement and the balance buffer", blocks: "Live payouts at scale" },
  { id: "OPEN-13", topic: "How coaches in Nepal are paid (payout route)", blocks: "Any automatic transfer" },
  { id: "TY-EXP-05", topic: "Approved wording for TalentYak's section of the welcome & expectations", blocks: "Public launch" },
  { id: "TY-CALL-10", topic: "Spending on the call service beyond the free minutes", blocks: "Nothing yet — watch usage" },
];

export default async function PoliciesPage() {
  await requireAdmin("/admin/policies");
  const supabase = (await createClient())!;
  const [{ data: retention }, { data: env }, { data: prereqs }] = await Promise.all([
    supabase.from("retention_settings").select("destructive_execution_enabled").maybeSingle(),
    supabase.from("platform_environment").select("kind").maybeSingle(),
    supabase.from("feature_prerequisites").select("key, feature_key, blocks_mode, description, resolved"),
  ]);

  const policies = listPolicies();
  const current = policies.filter((p) => !p.supersededBy);
  const superseded = policies.filter((p) => p.supersededBy);
  const live = evaluateLiveReadiness();
  const unbuilt = Object.values(FULFILLMENT).filter((f) => !f.ready);

  return (
    <div>
      <AdminHeader eyebrow="System" title="Policies & launch safeguards">
        <p>
          Viewing a rule here doesn&rsquo;t change it. <strong className="text-ink">Approving a policy</strong> is a founder decision recorded in the
          decision register and applied as a new policy version by an engineer. <strong className="text-ink">Switching a feature</strong> happens
          in <Link href="/admin/features" className="text-brand underline">feature controls</Link> and can never approve a policy or open live
          payments.
        </p>
      </AdminHeader>

      <Section id="safeguards" title="Safeguards" description="These stay off until their conditions are met. None of them can be changed from this panel.">
        <Details
          items={[
            ["Live payments", live.ready && CURRENT_LEGAL.approved && stripeMode() === "live" && isLiveBillingFlagSet()
              ? <Badge key="l" tone="good">Open</Badge>
              : <span key="l" className="flex flex-wrap items-center gap-2"><Badge tone="bad">Off</Badge> Stripe {stripeMode()}, live flag {isLiveBillingFlagSet() ? "set" : "not set"}.</span>],
            ["Automatic payouts", <span key="p" className="flex flex-wrap items-center gap-2"><Badge tone="bad">Off</Badge> No transfer provider is connected (OPEN-13). Payouts are sent by you and then recorded.</span>],
            ["Automatic deletion (retention)", retention?.destructive_execution_enabled
              ? <Badge key="r" tone="warn">On — check this</Badge>
              : <span key="r" className="flex flex-wrap items-center gap-2"><Badge tone="bad">Off</Badge> Holds and deletion requests are handled by hand.</span>],
            ["Database", env?.kind === "production" ? "Production database" : "Shared test database — a separate production database is a launch blocker."],
          ]}
        />
      </Section>

      <Section id="live" title="What still blocks real payments">
        <ul className="list-disc space-y-1 pl-5">
          {live.blockers.map((b) => <li key={b}>{b}</li>)}
          {!CURRENT_LEGAL.approved ? <li>Terms of service and privacy notice are drafts ({CURRENT_LEGAL.termsVersion}, {CURRENT_LEGAL.privacyVersion}).</li> : null}
          {unbuilt.map((f) => <li key={f.label}>Not ready: {f.label} ({f.module}) — packages that include it can&rsquo;t be sold for real money.</li>)}
          {env?.kind !== "production" ? <li>A separate production database.</li> : null}
        </ul>
      </Section>

      <Section id="setup" title="Launch setup" description="Configuration this panel can check. Where it can't check something, it says so.">
        <Details
          items={[
            ["Email sending", isResendConfigured() ? "Configured" : "Not configured — confirmations and notices can't go out"],
            ["Support email", process.env.SUPPORT_EMAIL ? "Set" : "Not set — no support address is shown to customers"],
            ["Call service (Daily)", isDailyConfigured() ? "Key set. A payment method must be on the Daily account before calls run — not checkable from here." : "Not configured"],
            ["Analytics (PostHog)", posthogConfig() ? "Project key set. Collection happens on the production site only; confirm events arrive in PostHog." : "Not connected — no analytics are collected"],
            ["Stripe webhook", process.env.STRIPE_WEBHOOK_SECRET ? "Signing secret set" : "Not set — payments can't be recorded"],
          ]}
        />
      </Section>

      <Section id="decisions" title="Decisions still open" description="Recorded in the decision register. Each keeps something switched off until you decide.">
        <Table
          caption="Open founder decisions"
          head={["Ref", "Decision", "Keeps off"]}
          empty=""
          rows={[
            ...OPEN_DECISIONS.map((d) => [<span key="i" className="font-semibold">{d.id}</span>, d.topic, d.blocks]),
            ...((prereqs ?? []).filter((p) => !p.resolved && !OPEN_DECISIONS.some((d) => p.description.startsWith(d.id))).map((p) => [p.key, p.description, `${p.feature_key} → ${p.blocks_mode}`])),
          ]}
        />
      </Section>

      <Section id="register" title="Policy register" description="Every rule the product runs on. Sandbox defaults are implemented and tested but blocked from real payments until approved.">
        <Table
          caption="Current policies"
          head={["Policy", "Status", "Since", "Source"]}
          empty=""
          rows={current.map((p) => [
            <span key="i" className="font-mono text-[0.875rem]">{p.id}</span>,
            p.status === "confirmed" ? <Badge key="s" tone="good">Approved</Badge> : <Badge key="s" tone="warn">Sandbox default — awaiting approval</Badge>,
            p.effectiveFrom,
            <span key="src" className="text-[0.875rem] text-ink-muted">{p.source}</span>,
          ])}
        />
        <details className="mt-4">
          <summary className="inline-flex min-h-10 cursor-pointer items-center text-brand underline">{superseded.length} earlier versions (kept so old records stay explicable)</summary>
          <ul className="mt-2 grid gap-1 text-[0.9375rem] text-ink-muted">
            {superseded.map((p) => <li key={p.id}><span className="font-mono">{p.id}</span> → replaced by <span className="font-mono">{p.supersededBy}</span></li>)}
          </ul>
        </details>
      </Section>
    </div>
  );
}
