import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { PLATFORM_STARTER } from "@/lib/expectations/template";
import {
  PLATFORM_FIELDS,
  PLATFORM_VERSION_COLUMNS,
  POLICY_LINK_OPTIONS,
  missingPlatformFields,
  type PlatformExpectationsVersion,
} from "@/lib/expectations/types";
import { savePlatformExpectationsAction } from "./actions";

export const metadata = { title: "Welcome & expectations" };
export const dynamic = "force-dynamic";

export default async function AdminExpectationsPage() {
  const session = await requireAdmin("/admin/expectations");
  const supabase = (await createClient())!;
  const { data } = await supabase.from("platform_expectation_versions").select(PLATFORM_VERSION_COLUMNS).order("version", { ascending: false }).limit(50);
  const rows = (data ?? []) as PlatformExpectationsVersion[];
  const draft = rows.find((r) => !r.published_at) ?? null;
  const live = rows.find((r) => r.published_at && !r.superseded_at) ?? null;
  const content = draft ?? live ?? PLATFORM_STARTER;
  const missing = missingPlatformFields(content);
  const tz = session.profile.timezone;

  return (
    <div>
      <PageHeader title="Welcome & expectations — TalentYak section">
        The part of every coach&rsquo;s welcome document that TalentYak controls: conduct, privacy, how to get help,
        and links to the platform policies. Coaches can&rsquo;t edit it.
      </PageHeader>

      {!live ? (
        <Notice tone="bad">
          Nothing is published yet, so <strong>no plan can be bought</strong>: every purchase needs this section shown first.
          The wording below is a suggested starting point, not approved policy — edit it, then publish.
        </Notice>
      ) : null}

      <Panel title="Status" id="status">
        <p className="flex flex-wrap items-center gap-2">
          <StatusPill tone={live ? "good" : "neutral"}>{live ? `Version ${live.version} is live` : "Nothing published"}</StatusPill>
          {draft ? <StatusPill>Draft version {draft.version}</StatusPill> : null}
        </p>
        <p className="mt-3 text-sm text-ink-muted">
          The support route is described in words and points to the Support page. The support email address is set in the
          site configuration and is never typed here.
        </p>
      </Panel>

      <Panel title={draft ? `Edit draft version ${draft.version}` : "Start a new version"} id="editor">
        {missing.length ? (
          <div role="note" className="mb-5 rounded-lg border border-line-strong bg-paper-raised p-4">
            <p className="font-semibold">Missing:</p>
            <ul className="mt-2 list-disc pl-6">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        ) : null}
        <ActionForm action={savePlatformExpectationsAction} className="grid gap-5" noticeFirst>
          {PLATFORM_FIELDS.map((f) => (
            <TextArea key={f.key} name={f.key} label={f.label} required rows={f.rows} maxLength={f.max} defaultValue={content[f.key]} />
          ))}
          <fieldset className="grid gap-2">
            <legend className="font-semibold">Policy links</legend>
            <p className="text-sm text-ink-muted">Only pages on this site can be linked.</p>
            {POLICY_LINK_OPTIONS.map((o) => (
              <label key={o.href} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" name="policy_links" value={o.href} defaultChecked={content.policy_links.includes(o.href)} className="size-5" />
                <span>{o.label} <span className="text-sm text-ink-muted">({o.href})</span></span>
              </label>
            ))}
          </fieldset>
          <fieldset className="grid gap-4 rounded-lg border border-line p-4">
            <legend className="px-1 font-semibold">When you publish</legend>
            <CheckboxField name="material" defaultChecked label="Meaningful change — ask current clients to read it again" />
            <TextArea name="change_summary" label="What changed, in a sentence" rows={2} maxLength={500} />
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <SubmitButton name="intent" value="save" variant="secondary" pendingLabel="Saving…">Save draft</SubmitButton>
            <SubmitButton name="intent" value="publish" pendingLabel="Publishing…">Save and publish</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Published versions" id="history">
        {rows.filter((r) => r.published_at).length === 0 ? (
          <p className="text-ink-muted">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {rows.filter((r) => r.published_at).map((r) => (
              <li key={r.id}>
                <span className="font-semibold">Version {r.version}</span>{" "}
                <span className="text-sm text-ink-muted">{formatDate(r.published_at, tz, true)}{r.superseded_at ? " · replaced" : " · live"}</span>
                {r.change_summary ? <span className="block text-sm">{r.change_summary}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
