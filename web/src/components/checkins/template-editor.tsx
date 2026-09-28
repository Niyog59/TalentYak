"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { saveCheckinTemplateAction } from "@/lib/checkins/actions";
import { KIND_LABEL, LIMITS, mayBeRequired, type Question, type QuestionKind } from "@/lib/checkins/questions";

/*
 * A coach's question set. Saving adds a version; check-ins already sent keep
 * the questions they were asked with. Photos, clips and anything marked
 * sensitive can never be required — the client can always skip them.
 */

const input = "mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-paper px-3 text-base";

export function TemplateEditor({ templateId, title, initial }: { templateId: string | null; title: string; initial: Question[] }) {
  const [questions, setQuestions] = useState<Question[]>(initial);

  function update(i: number, patch: Partial<Question>) {
    setQuestions((qs) =>
      qs.map((q, j) => {
        if (j !== i) return q;
        const next = { ...q, ...patch };
        if (!mayBeRequired(next)) next.required = false;
        return next;
      }),
    );
  }
  function move(i: number, by: number) {
    setQuestions((qs) => {
      const j = i + by;
      if (j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function add(kind: QuestionKind) {
    setQuestions((qs) => [...qs, { key: crypto.randomUUID(), kind, label: "", ...(kind === "photo" || kind === "video" ? { sensitive: kind === "photo" } : {}) }]);
  }

  return (
    <ActionForm action={saveCheckinTemplateAction} noticeFirst className="space-y-6">
      {templateId ? <input type="hidden" name="template_id" value={templateId} /> : null}
      <input type="hidden" name="questions" value={JSON.stringify(questions)} />
      <TextField name="title" label="Template name" required defaultValue={title} maxLength={80} />

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.key} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">Question {i + 1} · {KIND_LABEL[q.kind]}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`}>Up</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => move(i, 1)} disabled={i === questions.length - 1} aria-label={`Move question ${i + 1} down`}>Down</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}>Remove</Button>
              </div>
            </div>
            <label className="mt-3 block font-medium">
              Question
              <input className={input} value={q.label} maxLength={LIMITS.label} required onChange={(e) => update(i, { label: e.target.value })} />
            </label>
            <label className="mt-3 block font-medium">
              Help text <span className="font-normal text-ink-muted">(optional)</span>
              <input className={input} value={q.help ?? ""} maxLength={LIMITS.help} onChange={(e) => update(i, { help: e.target.value || undefined })} />
            </label>
            {q.kind === "rating" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block font-medium">What 1 means<input className={input} value={q.low ?? ""} maxLength={LIMITS.end} onChange={(e) => update(i, { low: e.target.value || undefined })} /></label>
                <label className="block font-medium">What 5 means<input className={input} value={q.high ?? ""} maxLength={LIMITS.end} onChange={(e) => update(i, { high: e.target.value || undefined })} /></label>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" className="size-5" checked={Boolean(q.sensitive)} onChange={(e) => update(i, { sensitive: e.target.checked || undefined })} />
                Sensitive — always optional
              </label>
              <label className={`flex min-h-11 items-center gap-2 ${mayBeRequired(q) ? "" : "text-ink-muted"}`}>
                <input type="checkbox" className="size-5" checked={Boolean(q.required)} disabled={!mayBeRequired(q)} onChange={(e) => update(i, { required: e.target.checked || undefined })} />
                Needed before sending{!mayBeRequired(q) ? " (not available for photos, clips or sensitive questions)" : ""}
              </label>
            </div>
          </li>
        ))}
      </ol>

      {questions.length < LIMITS.questions ? (
        <fieldset>
          <legend className="font-semibold">Add a question</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => (
              <Button key={k} type="button" size="sm" variant="secondary" onClick={() => add(k)}>{KIND_LABEL[k]}</Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <p className="text-sm text-ink-muted">Keep it short: around six questions takes a client about two minutes. Progress from their workouts, weight and food diary is added automatically — don&rsquo;t ask them to type it again.</p>
      <SubmitButton pendingLabel="Saving…">{templateId ? "Save as a new version" : "Create template"}</SubmitButton>
    </ActionForm>
  );
}
