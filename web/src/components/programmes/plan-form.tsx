"use client";

import { useState } from "react";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { WorkoutEditor } from "@/components/programmes/workout-editor";
import { NutritionEditor } from "@/components/programmes/nutrition-editor";
import type { ActionState } from "@/lib/actions";
import { LIMITS, type NutritionContent, type PlanContent, type PlanKind, type WorkoutContent } from "@/lib/programmes/content";

/*
 * One form for a template or a client plan: a title, the editor for its kind,
 * and — for a client plan — when a published version takes effect and what the
 * client is told about it.
 */

export function PlanForm({
  action,
  kind,
  title,
  content,
  hidden,
  publish,
  saveLabel,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  kind: PlanKind;
  title: string;
  content: PlanContent;
  hidden: Record<string, string>;
  /** Client plans only. `first` is true when nothing has been published yet. */
  publish?: { first: boolean; minDate: string; tzLabel: string };
  saveLabel: string;
}) {
  const [when, setWhen] = useState<"now" | "date">("now");
  const [quiet, setQuiet] = useState(false);

  // The save bar sits just above the coach area's phone tab bar.
  return (
    <ActionForm action={action} className="space-y-6" noticeFirst>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="kind" value={kind} />
      <TextField name="title" label={publish ? "Plan name (your client sees this)" : "Template name"} defaultValue={title} required maxLength={LIMITS.title} />

      {kind === "workout" ? <WorkoutEditor initial={content as WorkoutContent} /> : <NutritionEditor initial={content as NutritionContent} />}

      <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 -mx-4 lg:bottom-0 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        <SubmitButton pendingLabel="Saving…" variant={publish ? "secondary" : "primary"} name="intent" value="save">
          {saveLabel}
        </SubmitButton>
      </div>

      {publish ? (
        <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand underline underline-offset-4">
              {publish.first ? "Publish to your client" : "Publish as a new version"}
            </summary>
            <div className="mt-3 space-y-4">
              <fieldset>
                <legend className="font-semibold">When does it start?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line-strong bg-surface px-3">
                    <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} className="size-5 accent-brand" />
                    Now
                  </label>
                  <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line-strong bg-surface px-3">
                    <input type="radio" name="when" value="date" checked={when === "date"} onChange={() => setWhen("date")} className="size-5 accent-brand" />
                    On a later date
                  </label>
                </div>
                {when === "date" ? (
                  <TextField
                    name="effective_date"
                    label="Start date"
                    type="date"
                    min={publish.minDate}
                    required
                    className="mt-3 max-w-xs"
                    help={`Starts at the beginning of that day in your client's time (${publish.tzLabel}). Until then they keep their current plan.`}
                  />
                ) : null}
              </fieldset>

              {publish.first ? (
                <p className="text-ink-muted">Your client will be told their plan is ready.</p>
              ) : (
                <>
                  <label className="flex gap-3">
                    <input type="checkbox" name="quiet" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} className="mt-1 size-5 shrink-0 accent-brand" />
                    <span>
                      <span className="block font-semibold">Minor correction — don&rsquo;t send a notice</span>
                      <span className="block text-sm text-ink-muted">For a typo or a small fix. The new version is still kept in the history.</span>
                    </span>
                  </label>
                  {!quiet ? (
                    <TextField
                      name="change_summary"
                      label="What changed, for your client"
                      required
                      maxLength={LIMITS.summary}
                      help="One or two sentences. Your client sees this in their notice and in the plan's history."
                    />
                  ) : null}
                </>
              )}
              <p className="text-sm text-ink-muted">
                Publishing never changes earlier versions or anything your client has already done. Workouts they have already started keep their original instructions.
              </p>
              <SubmitButton pendingLabel="Publishing…" name="intent" value="publish">
                {when === "date" ? "Publish and schedule" : "Publish now"}
              </SubmitButton>
            </div>
          </details>
        </div>
      ) : null}
    </ActionForm>
  );
}
