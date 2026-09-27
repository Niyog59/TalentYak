import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEnrollmentDocument } from "@/lib/expectations/server";
import { RelationshipExpectations } from "@/components/expectations/relationship-view";
import { DOCUMENT_TITLE } from "@/lib/expectations/types";

export const metadata: Metadata = { title: DOCUMENT_TITLE, robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CustomerExpectationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ enrollmentId }, { v }] = await Promise.all([params, searchParams]);
  const session = await requireOnboarded(`/account/expectations/${enrollmentId}`);
  const doc = await getEnrollmentDocument(enrollmentId);
  // Someone else's relationship reads exactly like one that doesn't exist.
  if (!doc || doc.customerId !== session.userId) notFound();

  const supabase = (await createClient())!;
  const { data: conversation } = await supabase.from("conversations").select("id")
    .eq("enrollment_id", enrollmentId).order("created_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14 print:max-w-none print:p-0">
      <RelationshipExpectations
        doc={doc}
        viewer="customer"
        clientName={session.profile.preferred_name || session.profile.full_name || "You"}
        selectedId={v}
        basePath={`/account/expectations/${enrollmentId}`}
        messagesHref={conversation ? `/account/messages/${conversation.id}` : "/account"}
        timeZone={session.profile.timezone}
      />
    </div>
  );
}
