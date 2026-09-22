import { requireCoach } from "@/lib/auth";
import { listConversations } from "@/lib/messaging/server";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/panel";
import { ConversationList } from "@/components/messaging/conversation-list";

export const metadata = { title: "Messages" };

export default async function CoachInboxPage() {
  const session = await requireCoach("/coach/messages");
  // Only clients currently assigned to this coach: the database returns no
  // other conversation, including ones this coach had before a reassignment.
  const conversations = await listConversations("coach");
  const unread = (conversations ?? []).reduce((n, c) => n + c.unread_count, 0);

  return (
    <div>
      <PageHeader
        title="Messages"
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/coach/messages/availability" variant="secondary" size="sm">Messaging hours</ButtonLink>
            <ButtonLink href="/coach/support" variant="secondary" size="sm">Report a problem</ButtonLink>
          </div>
        }
      >
        {unread ? `${unread} unread. ` : ""}Private conversations with your current clients, most recent first.
      </PageHeader>

      {conversations === null ? (
        <p role="alert">Your messages couldn&rsquo;t be loaded. Refresh to try again.</p>
      ) : conversations.length === 0 ? (
        <EmptyState headingLevel="h2" icon="messages" title="No conversations yet">
          When a client signs up with you, a private conversation with them appears here.
        </EmptyState>
      ) : (
        <ConversationList conversations={conversations} hrefBase="/coach/messages" timeZone={session.provider.timezone ?? "UTC"} />
      )}
    </div>
  );
}
