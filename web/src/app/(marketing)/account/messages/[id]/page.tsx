import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { loadConversation } from "@/lib/messaging/server";
import { ConversationView } from "@/components/messaging/conversation-view";
import { conversationSchedule } from "@/lib/scheduling/server";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function CustomerConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOnboarded(`/account/messages/${id}`);
  const loaded = await loadConversation(id, "customer");
  if (!loaded) notFound();
  const schedule = await conversationSchedule(id, "customer");

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
      <ConversationView
        conversationId={id}
        viewerId={session.userId}
        timeZone={session.profile.timezone ?? "UTC"}
        enrollmentId={loaded.enrollmentId}
        initialStatus={loaded.status}
        initialMessages={loaded.messages}
        initialHasOlder={loaded.hasOlder}
        backHref="/account/messages"
        supportHref="/account/support"
        schedule={schedule}
      />
    </div>
  );
}
