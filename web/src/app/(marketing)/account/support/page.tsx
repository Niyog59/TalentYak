import type { Metadata } from "next";
import { requireOnboarded } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { PageHeader } from "@/components/ui/panel";
import { SupportContent } from "@/components/support/support-page";

export const metadata: Metadata = { title: "Report a problem" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerSupportPage({ searchParams }: { searchParams: Promise<{ conversation?: string; category?: string; about?: string }> }) {
  const session = await requireOnboarded("/account/support");
  const { conversation, category, about } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <PageHeader title="Support">
        <p>Tell TalentYak about a problem with your coaching, a conversation, billing, or the site.</p>
      </PageHeader>
      <nav aria-label="Account" className="mt-6 mb-8 flex flex-wrap gap-3">
        <ButtonLink href="/account" variant="secondary" size="sm">Your account</ButtonLink>
        <ButtonLink href="/account/messages" variant="secondary" size="sm">Messages</ButtonLink>
      </nav>
      <SupportContent
        conversationId={conversation && UUID.test(conversation) ? conversation : null}
        timeZone={session.profile.timezone ?? "UTC"}
        category={category ?? ""}
        about={about ?? null}
      />
    </div>
  );
}
