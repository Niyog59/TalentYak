import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { loadConversation } from "@/lib/messaging/server";
import { ConversationView } from "@/components/messaging/conversation-view";
import { conversationSchedule } from "@/lib/scheduling/server";
import { FeaturePausedNotice } from "@/components/ui/feature-notice";
import { featureAllowsMe, featureMode } from "@/lib/features/server";

export const metadata = { title: "Conversation" };

export default async function CoachConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCoach(`/coach/messages/${id}`);
  if ((await featureMode("messaging")) === "off") {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <FeaturePausedNotice title="Messaging is temporarily unavailable" supportHref="/coach/support">
          TalentYak has paused conversations for a short while. Nothing has been deleted, and this conversation will be back as it was.
        </FeaturePausedNotice>
      </div>
    );
  }
  const loaded = await loadConversation(id, "coach");
  if (!loaded) notFound();
  const schedule = await conversationSchedule(id, "coach");
  const attachmentsAllowed = await featureAllowsMe("attachments");

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
      attachmentsAllowed={attachmentsAllowed}
    />
  );
}
