import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEnrollmentDocument } from "@/lib/expectations/server";
import { RelationshipExpectations } from "@/components/expectations/relationship-view";

export const metadata = { title: "Client's welcome & expectations" };
export const dynamic = "force-dynamic";

export default async function CoachClientExpectationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ enrollmentId }, { v }] = await Promise.all([params, searchParams]);
  const session = await requireCoach(`/coach/expectations/clients/${enrollmentId}`);
  const supabase = (await createClient())!;

  // Only a client currently assigned to this coach. my_clients() is the same
  // list the Clients page shows; a former or another coach's client is absent.
  const { data: clients } = await supabase.rpc("my_clients");
  const client = ((clients ?? []) as { enrollment_id: string; client_name: string }[]).find((c) => c.enrollment_id === enrollmentId);
  if (!client) notFound();

  const doc = await getEnrollmentDocument(enrollmentId);
  if (!doc) notFound();

  const { data: conversation } = await supabase.from("conversations").select("id")
    .eq("enrollment_id", enrollmentId).eq("provider_id", session.provider.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <RelationshipExpectations
        doc={doc}
        viewer="coach"
        clientName={client.client_name}
        selectedId={v}
        basePath={`/coach/expectations/clients/${enrollmentId}`}
        messagesHref={conversation ? `/coach/messages/${conversation.id}` : "/coach/clients"}
        timeZone={session.provider.timezone}
      />
    </div>
  );
}
