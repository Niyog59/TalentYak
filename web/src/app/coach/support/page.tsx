import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui/panel";
import { SupportContent } from "@/components/support/support-page";

export const metadata = { title: "Support" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CoachSupportPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const session = await requireCoach("/coach/support");
  const { conversation } = await searchParams;
  return (
    <div>
      <PageHeader title="Support">Tell TalentYak about a problem with a client, a conversation, payouts, or the site.</PageHeader>
      <SupportContent
        conversationId={conversation && UUID.test(conversation) ? conversation : null}
        timeZone={session.provider.timezone ?? "UTC"}
      />
    </div>
  );
}
