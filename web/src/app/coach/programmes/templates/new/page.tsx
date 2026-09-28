import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui/panel";
import { PlanForm } from "@/components/programmes/plan-form";
import { saveTemplateAction } from "@/lib/programmes/actions";
import { emptyContent } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";

export const metadata = { title: "New template" };

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await requireCoach("/coach/programmes");
  const { kind: k } = await searchParams;
  const kind = k === "nutrition" ? "nutrition" : "workout";
  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/programmes#templates" className="text-brand underline underline-offset-4">← Programmes</Link></p>
      <PageHeader title={`New ${KIND_LABEL[kind].toLowerCase()} template`}>
        A starting point you can copy into any client&rsquo;s plan. No client sees a template.
      </PageHeader>
      <div className="mt-6">
        <PlanForm action={saveTemplateAction} kind={kind} title="" content={emptyContent(kind)} hidden={{}} saveLabel="Save template" />
      </div>
    </div>
  );
}
