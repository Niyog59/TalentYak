import "server-only";
import { featureAllowsMe } from "@/lib/features/server";
import type { ConversationStatus } from "@/lib/messaging/types";

/**
 * The conversation's own state, narrowed by the messaging switch. A paused
 * switch closes the composer with a plain reason; history stays readable.
 */
export async function gateConversationStatus(status: ConversationStatus): Promise<ConversationStatus> {
  if (!status.can_send || (await featureAllowsMe("messaging"))) return status;
  return {
    ...status,
    can_send: false,
    reason: "Sending messages is paused by TalentYak for now. Your earlier messages are all still here, and support is still reachable.",
  };
}
