import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, DailyColumns, ErrorNote, Figures, PerCurrency, Section, Table, type CurrencyAmount } from "@/components/admin/ui";
import { failed, loaded, type Loaded } from "@/lib/admin/loaded";
import { loadAttention } from "@/lib/admin/attention";
import { resolveRange } from "@/lib/admin/range";
import { formatDate, formatMinor } from "@/lib/format";
import { evaluateLiveReadiness } from "@/lib/policy/live-gate";
import { CURRENT_LEGAL } from "@/lib/legal";
import { getFeatureStates, readinessContext, readinessOf } from "@/lib/features/server";
import { FEATURES, MODE_LABEL } from "@/lib/features/registry";

export const metadata = { title: "Overview" };

interface Metrics {
  accounts_new: number;
  sign_ins_distinct: number;
  sign_ins_counted_since: string | null;
  active_paying_clients_now: number;
  cancellation_requests: number;
  coaching_ended: number;
  failed_renewals: number;
  past_due_now: number;
  collected: (CurrencyAmount & { payments: number })[];
  refunds: (CurrencyAmount & { refunds: number })[];
  commission: CurrencyAmount[];
  coach_earnings: CurrencyAmount[];
  platform_subsidies: CurrencyAmount[];
  fees: CurrencyAmount[];
  fees_ever_recorded: boolean;
  coach_owed_now: (CurrencyAmount & { state: string })[];
  payouts_recorded: (CurrencyAmount & { items: number })[];
  excluded_test_purchases: number;
  series: { day: string; accounts: number; sign_ins: number; collected: Record<string, number> }[];
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
] as const;

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; test?: string }>;
}) {
  const session = await requireAdmin("/admin");
  const sp = await searchParams;
  const range = resolveRange(sp, session.profile.timezone);
  const includeTest = sp.test === "1";
  const supabase = (await createClient())!;

  const [metricsRes, attention, features, readiness] = await Promise.all([
    supabase.rpc("admin_overview_metrics", {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_tz: range.timeZone,
      p_include_test: includeTest,
    }),
    loadAttention(),
    getFeatureStates(),
    readinessContext(),
  ]);
  const m: Loaded<Metrics> = metricsRes.error || !metricsRes.data ? failed("Couldn't be loaded") : loaded(metricsRes.data as Metrics);
  const need = attention.filter((a) => !a.count.ok || a.count.value > 0).sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
  const clear = attention.filter((a) => a.count.ok && a.count.value === 0);

  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { range: range.key, from: range.key === "custom" ? range.fromDay : undefined, to: range.key === "custom" ? range.toDay : undefined, test: includeTest ? "1" : undefined, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/admin?${p.toString()}`;
  };

  const live = evaluateLiveReadiness();
  const readinessByKey = readinessOf(readiness);
  const notOn = FEATURES.filter((f) => features.modes[f.key] !== "on" || readinessByKey[f.key].state !== "built");
  const currencies = m.ok ? [...new Set([...m.value.collected, ...m.value.refunds, ...m.value.commission, ...m.value.coach_earnings, ...m.value.fees, ...m.value.payouts_recorded, ...m.value.coach_owed_now].map((r) => r.currency))].sort() : [];

  return (
    <div>
      <AdminHeader
        eyebrow="Overview"
        title="What needs you, and how it's going"
        actions={
          <nav aria-label="Reporting period" className="flex flex-wrap items-center gap-2">
            <ul className="flex rounded-lg border border-line-strong bg-surface p-0.5">
              {RANGES.map((r) => (
                <li key={r.key}>
                  <Link
                    href={qs({ range: r.key, from: undefined, to: undefined })}
                    aria-current={range.key === r.key ? "true" : undefined}
                    className={`flex min-h-10 items-center rounded-md px-3 text-[0.9375rem] font-semibold ${range.key === r.key ? "bg-brand text-white" : "text-ink hover:bg-paper-raised"}`}
                  >
                    {r.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        }
      >
        <p>
          <strong className="text-ink">{range.label}</strong> · times in {range.timeZone.replaceAll("_", " ")}
          {session.profile.timezone ? "" : " (set your timezone on your account to report in local time)"} ·{" "}
          {includeTest ? (
            <>
              <Badge tone="warn">Including test activity</Badge> <Link href={qs({ test: undefined })} className="text-brand underline underline-offset-4">Show real activity only</Link>
            </>
          ) : (
            <>
              real activity only · <Link href={qs({ test: "1" })} className="text-brand underline underline-offset-4">include test activity</Link>
            </>
          )}
        </p>
      </AdminHeader>

      <form action="/admin" method="get" className="mt-4 flex flex-wrap items-end gap-3 text-[0.9375rem]">
        <input type="hidden" name="range" value="custom" />
        {includeTest ? <input type="hidden" name="test" value="1" /> : null}
        <label className="grid gap-1 font-semibold">
          From
          <input type="date" name="from" defaultValue={range.fromDay} required className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <label className="grid gap-1 font-semibold">
          To
          <input type="date" name="to" defaultValue={range.toDay} required className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <button type="submit" className="min-h-10 rounded-lg border border-line-strong bg-surface px-4 font-semibold hover:bg-paper-raised">Show custom range</button>
        {range.corrected ? <p role="alert" className="basis-full font-medium text-danger">{range.corrected}</p> : null}
      </form>

      <Section
        id="attention"
        title={need.length ? `Needs attention · ${need.length}` : "Needs attention"}
        description="Everything waiting on a person, most time-sensitive first. Each links to where it's handled."
      >
        {need.length === 0 ? (
          <p className="font-medium text-ink">Nothing is waiting on you right now.</p>
        ) : (
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {need.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className="flex min-h-12 items-center justify-between gap-4 px-5 py-2.5 hover:bg-paper-raised/60">
                  <span className="flex min-w-0 items-center gap-3">
                    <Badge tone={a.count.ok ? (a.urgent ? "bad" : "warn") : "neutral"}>{a.group}</Badge>
                    <span className="truncate">{a.label}</span>
                  </span>
                  {a.count.ok ? (
                    <span className="font-display text-2xl tabular-nums text-ink-deep">{a.count.value}</span>
                  ) : (
                    <span className="text-[0.9375rem] font-semibold text-danger">Couldn&rsquo;t check</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {clear.length ? (
          <details className="mt-4 text-[0.9375rem]">
            <summary className="inline-flex min-h-10 cursor-pointer items-center text-ink-muted underline underline-offset-4">{clear.length} checks with nothing waiting</summary>
            <ul className="mt-2 grid gap-1 text-ink-muted sm:grid-cols-2">
              {clear.map((a) => <li key={a.label}>{a.label}: 0</li>)}
            </ul>
          </details>
        ) : null}
      </Section>

      {!m.ok ? (
        <Section title="Activity and money" id="activity">
          <ErrorNote>The figures couldn&rsquo;t be loaded. Nothing is shown rather than a figure that might be wrong. Refresh to try again.</ErrorNote>
        </Section>
      ) : (
        <>
          <Section id="people" title="People" description={`${range.label}. "Paying now" and "past due" are as of this moment.`}>
            <Figures
              items={[
                { label: "New accounts", value: loaded(m.value.accounts_new), href: "/admin/accounts" },
                {
                  label: "People who signed in",
                  value: loaded(m.value.sign_ins_distinct),
                  note: m.value.sign_ins_counted_since ? `Counted since ${formatDate(m.value.sign_ins_counted_since, range.timeZone)}` : "Counting starts with the next sign-in",
                },
                { label: "Paying clients now", value: loaded(m.value.active_paying_clients_now), note: "Paid time not yet run out", href: "/admin/purchases" },
                { label: "Renewals past due now", value: loaded(m.value.past_due_now), href: "/admin/purchases?state=past_due" },
                { label: "Cancellation requests", value: loaded(m.value.cancellation_requests), note: "Asked to stop renewing; access runs to the end of paid time" },
                { label: "Coaching that ended", value: loaded(m.value.coaching_ended), note: "Relationships that actually ended" },
                { label: "Failed renewal attempts", value: loaded(m.value.failed_renewals), note: "From Stripe's payment-failed notices" },
                { label: "Test purchases left out", value: loaded(includeTest ? 0 : m.value.excluded_test_purchases), note: includeTest ? "Test activity is included above" : "Test-mode payments and test accounts" },
              ]}
            />
          </Section>

          <Section
            id="money"
            title="Money"
            description={
              <>
                From the payment and ledger records only. Each currency stands alone — nothing is converted or added across currencies.{" "}
                <strong className="text-ink">Money collected is not platform revenue or profit.</strong>
              </>
            }
          >
            {currencies.length === 0 ? (
              <p className="text-ink-muted">
                No {includeTest ? "" : "real "}payments, refunds, earnings or payouts in this period
                {!includeTest && m.value.excluded_test_purchases ? ` (${m.value.excluded_test_purchases} test purchases are left out)` : ""}.
              </p>
            ) : (
              <Table
                caption="Money by currency"
                head={["Currency", "Collected from customers", "Refunded", "Platform commission", "Coach earnings", "Payment fees", "Payouts recorded"]}
                empty=""
                rows={currencies.map((c) => {
                  const pick = (rows: CurrencyAmount[]) => rows.filter((r) => r.currency === c);
                  return [
                    <span key="c" className="font-semibold">{c}</span>,
                    <PerCurrency key="a" amounts={pick(m.value.collected)} empty="—" />,
                    <PerCurrency key="b" amounts={pick(m.value.refunds)} empty="—" />,
                    <PerCurrency key="d" amounts={pick(m.value.commission)} empty="—" />,
                    <PerCurrency key="e" amounts={pick(m.value.coach_earnings)} empty="—" />,
                    m.value.fees_ever_recorded ? <PerCurrency key="f" amounts={pick(m.value.fees)} empty="—" /> : <span key="f" className="text-ink-muted">Not recorded yet</span>,
                    <PerCurrency key="g" amounts={pick(m.value.payouts_recorded)} empty="—" />,
                  ];
                })}
              />
            )}
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="font-semibold text-ink-deep">Owed to coaches now</h3>
                <OwedTable rows={m.value.coach_owed_now} />
              </div>
              <div className="text-[0.9375rem] text-ink-muted">
                <h3 className="font-semibold text-ink-deep">How to read this</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  <li><strong className="text-ink">Collected</strong>: what customers paid (gross), by the day it was paid.</li>
                  <li><strong className="text-ink">Platform commission</strong> and <strong className="text-ink">coach earnings</strong>: the ledger&rsquo;s split of that money, after any refunds.</li>
                  <li><strong className="text-ink">Payment fees</strong>: {m.value.fees_ever_recorded ? "recorded fee entries." : "Stripe fees aren't imported into the ledger yet, so they're not shown — see Stripe."}</li>
                  <li><strong className="text-ink">Payouts recorded</strong>: transfers marked paid in the payout tool. Recording is not sending money.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section id="trends" title="Day by day" description={`${range.label}, by day in ${range.timeZone.replaceAll("_", " ")}.`}>
            <div className="grid gap-8 lg:grid-cols-2">
              <DailyColumns title="New accounts" points={m.value.series.map((d) => ({ day: d.day, value: d.accounts }))} />
              <DailyColumns title="People who signed in" points={m.value.series.map((d) => ({ day: d.day, value: d.sign_ins }))} />
              {[...new Set(m.value.series.flatMap((d) => Object.keys(d.collected)))].sort().map((c) => (
                <DailyColumns
                  key={c}
                  title={`Collected (${c})`}
                  points={m.value.series.map((d) => ({ day: d.day, value: d.collected[c] ?? 0 }))}
                  format={(n) => formatMinor(Math.round(n), c)}
                  unitNote="gross, before refunds"
                />
              ))}
            </div>
          </Section>
        </>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <Section title="Can TalentYak take real money?" id="live" className="!mt-0" actions={<Link href="/admin/policies" className="text-brand underline underline-offset-4">Policies &amp; launch</Link>}>
          <p className="font-semibold">{live.ready && CURRENT_LEGAL.approved ? "The policy gate is open." : "No — live payments stay off."}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.9375rem] text-ink-muted">
            {live.blockers.slice(0, 5).map((b) => <li key={b}>{b}</li>)}
            {!CURRENT_LEGAL.approved ? <li>Terms of service and privacy notice are drafts.</li> : null}
          </ul>
          <p className="mt-2 text-[0.875rem] text-ink-muted">A feature switch can never open this.</p>
        </Section>
        <Section title="Features not fully on" id="features" className="!mt-0" actions={<Link href="/admin/features" className="text-brand underline underline-offset-4">Feature controls</Link>}>
          {!features.ok ? (
            <ErrorNote>The feature settings couldn&rsquo;t be read, so everything new is being refused until they can.</ErrorNote>
          ) : notOn.length === 0 ? (
            <p>Everything is on and set up.</p>
          ) : (
            <ul className="grid gap-2">
              {notOn.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{f.label}</span>
                  <span className="flex gap-2">
                    {features.modes[f.key] !== "on" ? <Badge tone={features.modes[f.key] === "off" ? "bad" : "warn"}>{MODE_LABEL[features.modes[f.key]]}</Badge> : null}
                    {readinessByKey[f.key].state === "needs_setup" ? <Badge tone="warn">Needs setup</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

const OWED_LABEL: Record<string, string> = {
  pending: "Not yet earned (service still to deliver)",
  held: "On hold",
  eligible: "Earned, ready for a payout",
  batched: "In a payout being prepared",
};

function OwedTable({ rows }: { rows: (CurrencyAmount & { state: string })[] }) {
  if (!rows.length) return <p className="mt-1 text-ink-muted">Nothing is owed.</p>;
  return (
    <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
      {rows.map((r) => (
        <li key={`${r.currency}-${r.state}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.9375rem]">
          <span>{OWED_LABEL[r.state] ?? r.state}</span>
          <span className="font-semibold tabular-nums">{formatMinor(r.amount_minor, r.currency)}</span>
        </li>
      ))}
    </ul>
  );
}
