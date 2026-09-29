import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { loadConversation } from "@/lib/messaging/server";
import { ConversationView } from "@/components/messaging/conversation-view";
import { conversationSchedule } from "@/lib/scheduling/server";
import { FeaturePausedNotice } from "@/components/ui/feature-notice";
import { featureAllowsMe, featureMode } from "@/lib/features/server";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

export default async function CustomerConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOnboarded(`/account/messages/${id}`);
  if ((await featureMode("messaging")) === "off") {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <FeaturePausedNotice title="Messaging is temporarily unavailable" supportHref="/account/support">
          TalentYak has paused conversations for a short while. Nothing has been deleted, and this conversation will be back as it was.
        </FeaturePausedNotice>
      </div>
    );
  }
  const loaded = await loadConversation(id, "customer");
  if (!loaded) notFound();
  const schedule = await conversationSchedule(id, "customer");
  const attachmentsAllowed = await featureAllowsMe("attachments");

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
        attachmentsAllowed={attachmentsAllowed}
      />
    </div>
  );
}
