"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextArea } from "@/components/form/fields";
import { saveFeedbackAction } from "@/lib/checkins/actions";

/*
 * The coach's feedback. Saved as a draft the client can't see; published
 * when ready (the client is told); the review is completed separately.
 * A "plan change" step is a promise — it shows as delivered only once the
 * coach links a plan version that was actually published through the normal
 * plan screens.
 */

interface Step {
  key: string;
  text: string;
  kind: "action" | "plan_change";
}

export function FeedbackEditor({
  checkinId,
  initial,
  plans,
  hasConversation,
  republish,
}: {
  checkinId: string;
  initial: { body: string; next_steps: Step[]; plan_id: string | null; conversation_id: string | null } | null;
  plans: { id: string; label: string }[];
  hasConversation: boolean;
  /** Feedback was already published: this becomes a new dated version. */
  republish: boolean;
}) {
  const [steps, setSteps] = useState<Step[]>(initial?.next_steps ?? []);

  return (
    <ActionForm action={saveFeedbackAction} className="space-y-5" noticeFirst>
      <input type="hidden" name="checkin_id" value={checkinId} />
      <TextArea name="body" label="Feedback" rows={7} maxLength={5000} defaultValue={initial?.body ?? ""}
        help="Written by you, for your client. No automatic assessment is added." />

      <fieldset>
        <legend className="font-semibold">Next steps <span className="font-normal text-ink-muted">(up to 8)</span></legend>
        <ul className="mt-2 space-y-3">
          {steps.map((s, i) => (
            <li key={s.key} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <input type="hidden" name="step_key" value={s.key} />
              <label className="block font-medium">
                Step {i + 1}
                <input name="step_text" className="mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-paper px-3" maxLength={200} value={s.text}
                  onChange={(e) => setSteps((all) => all.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              </label>
              <label className="block font-medium">
                Kind
                <select name="step_kind" className="mt-1 block min-h-12 rounded-lg border border-line-strong bg-paper px-3" value={s.kind}
                  onChange={(e) => setSteps((all) => all.map((x, j) => (j === i ? { ...x, kind: e.target.value === "plan_change" ? "plan_change" : "action" } : x)))}>
                  <option value="action">Something to do</option>
                  <option value="plan_change">A plan change I&rsquo;ll make</option>
                </select>
              </label>
              <Button type="button" size="sm" variant="secondary" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>Remove</Button>
            </li>
          ))}
        </ul>
        {steps.length < 8 ? (
          <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setSteps((all) => [...all, { key: crypto.randomUUID(), text: "", kind: "action" }])}>Add a next step</Button>
        ) : null}
        <p className="mt-2 text-sm text-ink-muted">A plan change is shown to your client as promised until you publish it through the plan screens and link it here.</p>
      </fieldset>

      {plans.length ? (
        <label className="block font-semibold">
          Link a plan <span className="font-normal text-ink-muted">(optional)</span>
          <select name="plan_id" defaultValue={initial?.plan_id ?? ""} className="mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-paper px-3 font-normal">
            <option value="">No plan link</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      ) : null}
      {hasConversation ? (
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" name="link_conversation" className="size-5" defaultChecked={Boolean(initial?.conversation_id)} />
          Add a link to your messages with this client for follow-up
        </label>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubmitButton name="intent" value="draft" variant="secondary" pendingLabel="Saving…">Save draft</SubmitButton>
        <SubmitButton name="intent" value="publish" pendingLabel="Publishing…">{republish ? "Publish as updated feedback" : "Publish to client"}</SubmitButton>
      </div>
      {republish ? <p className="text-sm text-ink-muted">Your earlier feedback stays, dated, alongside the new version.</p> : null}
    </ActionForm>
  );
}
