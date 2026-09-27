import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { getMyCoachVersions } from "@/lib/expectations/server";
import { COACH_STARTER } from "@/lib/expectations/template";
import { ARRANGEMENT_FIELDS, DOCUMENT_TITLE, LIST_FIELDS, missingCoachFields } from "@/lib/expectations/types";
import { discardExpectationsDraftAction, saveExpectationsAction } from "./actions";

export const metadata = { title: "Welcome & expectations" };
export const dynamic = "force-dynamic";

export default async function CoachExpectationsPage() {
  const session = await requireCoach("/coach/expectations");
  const { provider } = session;
  const { draft, live, history } = await getMyCoachVersions(provider.id);

  // What the editor opens with: the draft, else the live version to revise,
  // else the starter template.
  const source = draft ?? live ?? null;
  const content = source ?? COACH_STARTER;
  const missing = missingCoachFields(content);
  const usingStarter = !source;

  return (
    <div>
      <PageHeader title={DOCUMENT_TITLE}>
        What clients can expect from you, and what you ask of them — shown on your plans before anyone pays, and
        given to each client when they join. TalentYak&rsquo;s own section is added automatically and you can&rsquo;t change it.
      </PageHeader>

      {!live ? (
        <Notice tone="bad">
          You haven&rsquo;t published this yet. Until you do, <strong>your plans can&rsquo;t be bought</strong>: clients need to see it before they pay.
        </Notice>
      ) : null}

      <Panel title="Status" id="status">
        <ul className="space-y-2">
          <li className="flex flex-wrap items-center gap-2">
            <StatusPill tone={live ? "good" : "neutral"}>{live ? `Version ${live.version} is live` : "Nothing published"}</StatusPill>
            {live ? <span className="text-sm text-ink-muted">Published {formatDate(live.published_at, provider.timezone, true)}</span> : null}
          </li>
          {draft ? (
            <li className="flex flex-wrap items-center gap-2">
              <StatusPill>Draft version {draft.version}</StatusPill>
              <span className="text-sm text-ink-muted">Last saved {formatDate(draft.updated_at, provider.timezone, true)} — clients can&rsquo;t see it</span>
            </li>
          ) : null}
        </ul>
        <p className="mt-4">
          <Link href="/coach/expectations/preview" className="font-semibold text-brand underline underline-offset-4">
            Preview what a client sees
          </Link>
          <span className="text-sm text-ink-muted"> — {draft ? "your draft" : live ? "your live version" : "the starter template"}, with a sample client name.</span>
        </p>
      </Panel>

      <Panel
        title={draft ? `Edit draft version ${draft.version}` : live ? "Start a revision" : "Write your first version"}
        id="editor"
        description={
          usingStarter
            ? "We've filled in a starting point. Change anything so it describes how you actually work."
            : "Saving never changes what your existing clients were shown. Only publishing makes a new version."
        }
      >
        {missing.length ? (
          <div role="note" className="mb-5 rounded-lg border border-line-strong bg-paper-raised p-4">
            <p className="font-semibold">Still to fill in before you can publish:</p>
            <ul className="mt-2 list-disc pl-6">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        ) : null}

        <ActionForm action={saveExpectationsAction} className="grid gap-5" noticeFirst>
          <h3 className="text-lg font-semibold">Your coaching arrangement</h3>
          <p className="-mt-3 text-sm text-ink-muted">
            Your plan details — calls, check-ins, messaging — are added underneath automatically for each plan, so a client
            always sees exactly what they&rsquo;re buying. Don&rsquo;t promise results, and don&rsquo;t ask for health details here.
          </p>
          {ARRANGEMENT_FIELDS.map((f) => (
            <TextArea key={f.key} name={f.key} label={f.label} required={f.required} rows={f.rows} maxLength={f.max} defaultValue={content[f.key]} />
          ))}

          {LIST_FIELDS.map((f) => (
            <TextArea
              key={f.key}
              name={f.key}
              label={f.label}
              required
              rows={6}
              maxLength={f.max * (f.itemMax + 1)}
              help={`One point per line, up to ${f.max}.${f.key === "client_part" ? " Keep these reasonable and adaptable — no penalties." : ""}`}
              defaultValue={content[f.key].join("\n")}
            />
          ))}

          <fieldset className="grid gap-4 rounded-lg border border-line p-4">
            <legend className="px-1 font-semibold">When you publish</legend>
            <CheckboxField
              name="material"
              defaultChecked
              label="This is a meaningful change — ask my current clients to read it again"
              help="Leave ticked for anything that changes how you work with clients. Untick only for small corrections like spelling."
            />
            <TextArea name="change_summary" label="What changed, in a sentence" rows={2} maxLength={500} help="Shown to clients with the update." />
          </fieldset>

          <div className="flex flex-wrap gap-3">
            <SubmitButton name="intent" value="save" variant="secondary" pendingLabel="Saving…">Save draft</SubmitButton>
            <SubmitButton name="intent" value="publish" pendingLabel="Publishing…">Save and publish</SubmitButton>
          </div>
        </ActionForm>

        {draft ? (
          <ActionForm action={discardExpectationsDraftAction} className="mt-6">
            <SubmitButton variant="quiet" pendingLabel="Discarding…">Discard this draft</SubmitButton>
          </ActionForm>
        ) : null}
      </Panel>

      <Panel title="Published versions" id="history" description="Published versions never change. Each client keeps the version they were shown.">
        {history.length === 0 ? (
          <p className="text-ink-muted">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((v) => (
              <li key={v.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-semibold">Version {v.version}</span>
                <span className="text-sm text-ink-muted">
                  {formatDate(v.published_at, provider.timezone, true)}
                  {v.superseded_at ? " · replaced" : " · live"}
                  {v.material ? "" : " · minor correction"}
                </span>
                {v.change_summary ? <span className="w-full text-sm">{v.change_summary}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
