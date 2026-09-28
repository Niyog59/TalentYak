import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { PageHeader, Panel } from "@/components/ui/panel";
import { TemplateEditor } from "@/components/checkins/template-editor";
import { archiveCheckinTemplateAction } from "@/lib/checkins/actions";
import { templateWithQuestions } from "@/lib/checkins/server";

export const metadata = { title: "Check-in template" };
export const dynamic = "force-dynamic";

export default async function CheckinTemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await requireCoach(`/coach/check-ins/templates/${id}`);
  const found = await templateWithQuestions(id);
  if (!found) notFound();
  const { template, questions } = found;
  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/check-ins" className="text-brand underline underline-offset-4">← Check-ins</Link></p>
      <PageHeader title={template.title}>
        Version {template.latest_version}{template.archived_at ? " · archived" : ""}. Saving a change adds a version; check-ins already sent keep their questions.
      </PageHeader>
      {sp.saved === "1" ? <p role="status" className="mt-4 rounded-lg border border-brand bg-brand-tint p-3">Saved.</p> : null}
      <div className="mt-6">
        <TemplateEditor templateId={template.id} title={template.title} initial={questions} />
      </div>
      <Panel title={template.archived_at ? "Restore" : "Archive"} id="archive">
        <ActionForm action={archiveCheckinTemplateAction}>
          <input type="hidden" name="template_id" value={template.id} />
          <input type="hidden" name="archive" value={template.archived_at ? "0" : "1"} />
          <SubmitButton variant="secondary" pendingLabel="Working…">{template.archived_at ? "Restore this template" : "Archive this template"}</SubmitButton>
          <p className="mt-2 text-sm text-ink-muted">Schedules already using it carry on unchanged.</p>
        </ActionForm>
      </Panel>
    </div>
  );
}
