import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea } from "@/components/form/fields";
import { AdminHeader, Badge, Details, EmptyNote, ErrorNote, Section, Table, type Tone } from "@/components/admin/ui";
import { formatDate } from "@/lib/format";
import {
  FEATURES,
  MODE_LABEL,
  NOT_BUILT,
  checkChange,
  effectiveAvailability,
  featureSpec,
  isFeatureKey,
  type FeatureKey,
  type FeatureMode,
} from "@/lib/features/registry";
import { getFeatureStates, readinessContext, readinessOf } from "@/lib/features/server";
import { featureImpact } from "@/lib/admin/impact";
import { setFeatureModeAction, setTestAccountAction } from "../panel-actions";

export const metadata = { title: "Feature controls" };

type Person = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
const who = (p: Person) => {
  const one = Array.isArray(p) ? p[0] : p;
  return one ? one.full_name || one.email : "—";
};

const READINESS: Record<string, { label: string; tone: Tone }> = {
  built: { label: "Built", tone: "good" },
  needs_setup: { label: "Needs setup", tone: "warn" },
  not_built: { label: "Not built", tone: "neutral" },
};

const KIND: Record<string, string> = { normal: "Stops new activity", emergency: "Emergency", testing: "Testing" };

export default async function FeatureControlsPage({ searchParams }: { searchParams: Promise<{ change?: string }> }) {
  const session = await requireAdmin("/admin/features");
  const { change } = await searchParams;
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;

  const [states, ctx, settings, history, testers] = await Promise.all([
    getFeatureStates(),
    readinessContext(),
    supabase.from("feature_settings").select("key, mode, version, changed_at, reason, changer:profiles!feature_settings_changed_by_fkey(full_name, email)"),
    supabase
      .from("feature_setting_changes")
      .select("id, key, from_mode, to_mode, reason, created_at, restores_change_id, actor:profiles!feature_setting_changes_actor_id_fkey(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("feature_test_accounts").select("profile_id, reason, added_at, person:profiles!feature_test_accounts_profile_id_fkey(full_name, email)").order("added_at", { ascending: false }),
  ]);
  const readiness = readinessOf(ctx);
  const rows = new Map(((settings.data ?? []) as { key: string; mode: FeatureMode; version: number; changed_at: string; reason: string | null; changer: Person }[]).map((r) => [r.key, r]));
  const selected: FeatureKey | null = change && isFeatureKey(change) ? change : null;
  const impact = selected ? await featureImpact(selected) : [];

  return (
    <div>
      <AdminHeader eyebrow="System" title="Feature controls">
        <p>
          Switch product features without a deployment. <strong className="text-ink">Readiness</strong> (is it built and set up?) and{" "}
          <strong className="text-ink">availability</strong> (your setting) are separate: a switch never turns on something unbuilt, never
          completes missing setup, and never approves a policy. Security, sign-in, permissions, live payments and this history are not on
          this list and can&rsquo;t be switched off.
        </p>
      </AdminHeader>

      {!states.ok || settings.error ? (
        <div className="mt-6"><ErrorNote>The settings couldn&rsquo;t be read. Until they can, the product refuses new activity in every switchable feature.</ErrorNote></div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {FEATURES.map((f) => {
          const row = rows.get(f.key);
          const mode = states.modes[f.key];
          const r = readiness[f.key];
          const eff = effectiveAvailability(mode, r);
          const open = selected === f.key;
          return (
            <article key={f.key} id={f.key} aria-labelledby={`${f.key}-title`} className={`scroll-mt-24 rounded-xl border bg-surface ${open ? "border-brand ring-1 ring-brand" : "border-line"}`}>
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 max-w-2xl">
                  <h2 id={`${f.key}-title`} className="text-lg font-semibold text-ink-deep">{f.label}</h2>
                  <p className="text-[0.9375rem] text-ink-muted">{f.summary}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={READINESS[r.state].tone}>{READINESS[r.state].label}</Badge>
                  <Badge tone={mode === "on" ? "good" : mode === "off" ? "bad" : "warn"}>{MODE_LABEL[mode]}</Badge>
                  {open ? (
                    <Link href="/admin/features" className="flex min-h-10 items-center rounded-lg border border-line-strong px-3 font-semibold hover:bg-paper-raised">Close</Link>
                  ) : (
                    <Link href={`/admin/features?change=${f.key}#${f.key}`} className="flex min-h-10 items-center rounded-lg bg-brand px-3 font-semibold text-white hover:bg-brand-strong">Change</Link>
                  )}
                </div>
              </div>
              <div className="grid gap-4 border-t border-line px-5 py-4 text-[0.9375rem] lg:grid-cols-2">
                <Details
                  items={[
                    ["What people get", <span key="e" className="font-medium text-ink">{eff.label}</span>],
                    ["This mode means", f.modes.find((m) => m.mode === mode)?.explanation ?? "—"],
                    ["Last change", row ? `${formatDate(row.changed_at, tz, true)} by ${row.changer ? who(row.changer) : row.version === 1 ? "the launch defaults" : "an account that no longer exists"} — “${row.reason ?? ""}”` : "—"],
                  ]}
                />
                <Details
                  items={[
                    ["Who it affects", f.audiences],
                    ["Existing records and work", f.existingWork],
                    ["Relies on", f.dependencies.length ? f.dependencies.map((d) => featureSpec(d.feature).label).join(", ") : "Nothing else on this list"],
                    ["Enforced by", f.enforcement],
                    ...(r.blockers.length ? [["Setup blockers", <ul key="b" className="list-disc pl-5">{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>] as [string, React.ReactNode]] : []),
                  ]}
                />
              </div>

              {open && row ? (
                <div className="border-t border-brand/30 bg-brand-tint/40 px-5 py-5">
                  <h3 className="font-semibold text-ink-deep">Change {f.label.toLowerCase()}</h3>
                  <div className="mt-3 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                    <ActionForm action={setFeatureModeAction} className="grid gap-4">
                      <input type="hidden" name="key" value={f.key} />
                      <input type="hidden" name="version" value={row.version} />
                      <fieldset className="grid gap-2">
                        <legend className="font-semibold">New setting</legend>
                        {f.modes.map((m) => {
                          const check = checkChange(states.modes, f.key, m.mode, r, ctx);
                          const blocked = m.mode === mode ? "Current setting." : check.errors[0];
                          return (
                            <label key={m.mode} className={`flex items-start gap-3 rounded-lg border bg-surface p-3 ${blocked ? "border-line opacity-70" : "border-line-strong"}`}>
                              <input type="radio" name="mode" value={m.mode} disabled={Boolean(blocked)} required className="mt-1 size-5" />
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2 font-semibold">
                                  {MODE_LABEL[m.mode]}
                                  {m.mode === "on" ? null : <Badge tone={m.kind === "emergency" ? "bad" : m.kind === "testing" ? "info" : "neutral"}>{KIND[m.kind]}</Badge>}
                                </span>
                                <span className="block text-[0.9375rem] text-ink-muted">{m.explanation}</span>
                                {blocked && m.mode !== mode ? <span className="mt-1 block text-[0.875rem] font-medium text-danger">Not available: {blocked}</span> : null}
                                {!blocked && check.warnings.length ? <span className="mt-1 block text-[0.875rem] font-medium text-amber-900">{check.warnings.join(" ")}</span> : null}
                              </span>
                            </label>
                          );
                        })}
                      </fieldset>
                      <TextArea name="reason" label="Why" required rows={2} maxLength={1000} help="Kept in the history with your name and the time." />
                      <CheckboxField
                        name="confirm"
                        label="I've read the impact. Changes that reduce what people can do, or open something to real users, apply immediately."
                      />
                      <div><SubmitButton pendingLabel="Applying…">Apply change</SubmitButton></div>
                    </ActionForm>
                    <div>
                      <h4 className="font-semibold">Impact right now</h4>
                      <p className="text-[0.875rem] text-ink-muted">Measured from the records as this page loaded.</p>
                      <ul className="mt-2 grid gap-2">
                        {impact.map((i) => (
                          <li key={i.label} className="rounded-lg border border-line bg-surface p-3">
                            <p className="flex items-baseline justify-between gap-3">
                              <span className="font-medium">{i.label}</span>
                              {i.count.ok ? <span className="font-display text-2xl tabular-nums">{i.count.value}</span> : <span className="font-semibold text-danger">Couldn&rsquo;t measure</span>}
                            </p>
                            <p className="text-[0.875rem] text-ink-muted">{i.note}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <Section id="history" title="Change history" description="Every change, with who made it and why. Restoring puts the earlier setting back; it never undoes anything that already happened — refunds, cancellations, messages sent or coach changes stay as they are.">
        {history.error ? (
          <ErrorNote />
        ) : (
          <Table
            caption="Feature setting changes"
            head={["When", "Feature", "Change", "By", "Why", ""]}
            empty="No changes yet. Every feature is at its launch default."
            rows={(history.data ?? []).map((h) => {
              const key = h.key as FeatureKey;
              const current = states.modes[key];
              const row = rows.get(key);
              const restorable = current === h.to_mode && h.from_mode !== h.to_mode;
              return [
                formatDate(h.created_at, tz, true),
                featureSpec(key)?.label ?? h.key,
                <span key="c">{MODE_LABEL[h.from_mode as FeatureMode]} → <strong>{MODE_LABEL[h.to_mode as FeatureMode]}</strong>{h.restores_change_id ? <> <Badge tone="info">restore</Badge></> : null}</span>,
                who(h.actor as Person),
                <span key="r" className="break-words">{h.reason}</span>,
                restorable && row ? (
                  <details key="x">
                    <summary className="inline-flex min-h-10 cursor-pointer items-center text-brand underline">Restore</summary>
                    <ActionForm action={setFeatureModeAction} className="mt-2 grid min-w-60 gap-2">
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="mode" value={h.from_mode} />
                      <input type="hidden" name="version" value={row.version} />
                      <input type="hidden" name="restores" value={h.id} />
                      <TextArea name="reason" label={`Why put it back to ${MODE_LABEL[h.from_mode as FeatureMode].toLowerCase()}`} required rows={2} maxLength={1000} />
                      <CheckboxField name="confirm" label="I understand this doesn't undo anything already done." />
                      <div><SubmitButton variant="secondary" pendingLabel="Restoring…">Restore</SubmitButton></div>
                    </ActionForm>
                  </details>
                ) : (
                  <span key="x" className="text-[0.875rem] text-ink-muted">{current !== h.to_mode ? "Changed again since" : ""}</span>
                ),
              ];
            })}
          />
        )}
      </Section>

      <Section
        id="test-accounts"
        title="Test accounts"
        description={<>&ldquo;Test accounts only&rdquo; means these accounts. Add both sides of a test relationship (the client and the coach). Add or remove an account from its page under <Link href="/admin/accounts" className="text-brand underline">Accounts</Link>.</>}
      >
        {testers.error ? (
          <ErrorNote />
        ) : (testers.data ?? []).length === 0 ? (
          <EmptyNote>No test accounts yet.</EmptyNote>
        ) : (
          <Table
            caption="Test accounts"
            head={["Account", "Why", "Added", ""]}
            empty=""
            rows={(testers.data ?? []).map((t) => [
              <Link key="a" href={`/admin/accounts/${t.profile_id}`} className="text-brand underline underline-offset-4">{who(t.person as Person)}</Link>,
              t.reason,
              formatDate(t.added_at, tz),
              <ActionForm key="f" action={setTestAccountAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="profile_id" value={t.profile_id} />
                <input type="hidden" name="member" value="0" />
                <input type="hidden" name="reason" value="Removed from the test list" />
                <SubmitButton variant="quiet" pendingLabel="Removing…">Remove</SubmitButton>
              </ActionForm>,
            ])}
          />
        )}
      </Section>

      <Section id="not-built" title="Not built" description="Listed so nothing looks available when it isn't. There is no switch for these.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {NOT_BUILT.map((n) => (
            <li key={n.label} className="rounded-lg border border-line p-3">
              <p className="flex items-center gap-2 font-semibold">{n.label} <Badge>Not built</Badge></p>
              <p className="text-[0.9375rem] text-ink-muted">{n.note}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
