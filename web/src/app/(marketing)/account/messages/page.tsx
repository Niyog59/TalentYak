import type { Metadata } from "next";
import { requireOnboarded } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { listConversations } from "@/lib/messaging/server";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/panel";
import { ConversationList } from "@/components/messaging/conversation-list";
import { FeaturePausedNotice } from "@/components/ui/feature-notice";
import { featureMode } from "@/lib/features/server";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function CustomerMessagesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 md:py-20">
        <h1 className="font-display text-5xl">Messages</h1>
        <p className="mt-4 text-lg text-ink-muted">Accounts aren&rsquo;t available in this environment.</p>
      </div>
    );
  }

  const session = await requireOnboarded("/account/messages");
  const messagingOff = (await featureMode("messaging")) === "off";
  const conversations = messagingOff ? [] : await listConversations("customer");

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <PageHeader title="Messages">
        <p>Private conversations with your coach. Each coach you work with has their own conversation.</p>
      </PageHeader>
      <nav aria-label="Account" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href="/account" variant="secondary" size="sm">Your account</ButtonLink>
        <ButtonLink href="/account/support" variant="secondary" size="sm">Report a problem</ButtonLink>
        <ButtonLink href="/account/notifications/preferences" variant="secondary" size="sm">Email settings</ButtonLink>
      </nav>

      <div className="mt-8">
        {messagingOff ? (
          <FeaturePausedNotice title="Messaging is temporarily unavailable" supportHref="/account/support">
            TalentYak has paused conversations for a short while. Nothing has been deleted, and they&rsquo;ll be back here as they were.
          </FeaturePausedNotice>
        ) : conversations === null ? (
          <p role="alert">Your messages couldn&rsquo;t be loaded. Refresh to try again.</p>
        ) : conversations.length === 0 ? (
          <EmptyState headingLevel="h2" icon="messages" title="No conversations yet" actions={<ButtonLink href="/coaches">Find a coach</ButtonLink>}>
            When your coaching starts, a private conversation with your coach appears here.
          </EmptyState>
        ) : (
          <ConversationList conversations={conversations} hrefBase="/account/messages" timeZone={session.profile.timezone ?? "UTC"} />
        )}
      </div>
    </div>
  );
}
