import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { PlanForm } from "@/components/programmes/plan-form";
import { PlanWeek } from "@/components/programmes/workout-view";
import { NutritionView } from "@/components/programmes/nutrition-view";
import { archiveTemplateAction, saveTemplateAction } from "@/lib/programmes/actions";
import { myTemplate } from "@/lib/programmes/server";
import type { NutritionContent, WorkoutContent } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";

export const metadata = { title: "Template" };
export const dynamic = "force-dynamic";

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  await requireCoach(`/coach/programmes/templates/${id}`);
  // Row-level security returns only this coach's own templates.
  const t = await myTemplate(id);
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/programmes#templates" className="text-brand underline underline-offset-4">← Programmes</Link></p>
      <PageHeader title={t.title}>
        {KIND_LABEL[t.kind]} template. Editing it never changes plans already copied from it.
      </PageHeader>
      {saved ? <Notice>Template created.</Notice> : null}
      {t.archived_at ? <Notice>This template is archived: it isn&rsquo;t offered when you start a client&rsquo;s plan.</Notice> : null}

      <div className="mt-6">
        <PlanForm action={saveTemplateAction} kind={t.kind} title={t.title} content={t.content} hidden={{ template_id: t.id }} saveLabel="Save template" />
      </div>

      <Panel title="Preview" id="preview" description="How this reads once copied into a client's plan.">
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand underline underline-offset-4">Show the last saved version</summary>
          <div className="mt-4">
            {t.kind === "workout" ? <PlanWeek content={t.content as WorkoutContent} /> : <NutritionView content={t.content as NutritionContent} />}
          </div>
        </details>
      </Panel>

      <Panel title={t.archived_at ? "Restore" : "Archive"} id="archive">
        <ActionForm action={archiveTemplateAction}>
          <input type="hidden" name="template_id" value={t.id} />
          <input type="hidden" name="archive" value={t.archived_at ? "0" : "1"} />
          <SubmitButton pendingLabel="Saving…" variant="secondary">{t.archived_at ? "Restore this template" : "Archive this template"}</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
