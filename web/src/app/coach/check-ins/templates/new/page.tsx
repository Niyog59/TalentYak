import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui/panel";
import { TemplateEditor } from "@/components/checkins/template-editor";

export const metadata = { title: "New check-in template" };

export default async function NewCheckinTemplatePage() {
  await requireCoach("/coach/check-ins/templates/new");
  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/check-ins" className="text-brand underline underline-offset-4">← Check-ins</Link></p>
      <PageHeader title="New check-in template">Your own questions. Photos, clips and anything sensitive are always optional for your client.</PageHeader>
      <div className="mt-6">
        <TemplateEditor templateId={null} title="" initial={[]} />
      </div>
    </div>
  );
}
