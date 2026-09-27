import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { loadConversation } from "@/lib/messaging/server";
import { ConversationView } from "@/components/messaging/conversation-view";
import { conversationSchedule } from "@/lib/scheduling/server";

export const metadata = { title: "Conversation" };

export default async function CoachConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCoach(`/coach/messages/${id}`);
  const loaded = await loadConversation(id, "coach");
  if (!loaded) notFound();
  const schedule = await conversationSchedule(id, "coach");

  return (
    <ConversationView
      conversationId={id}
      viewerId={session.userId}
      timeZone={session.provider.timezone ?? session.profile.timezone ?? "UTC"}
      enrollmentId={loaded.enrollmentId}
      initialStatus={loaded.status}
      initialMessages={loaded.messages}
      initialHasOlder={loaded.hasOlder}
      backHref="/coach/messages"
      supportHref="/coach/support"
      schedule={schedule}
    />
  );
}
