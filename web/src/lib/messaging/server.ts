import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadMessagesAction } from "@/lib/messaging/actions";
import type { ConversationRole, ConversationStatus, ConversationSummary, Message } from "@/lib/messaging/types";
import { UUID_RE } from "@/lib/messaging/types";

/** The conversations the signed-in person can read, in one role. */
export async function listConversations(role: ConversationRole): Promise<ConversationSummary[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_conversations");
  if (error) return null;
  return ((data ?? []) as ConversationSummary[])
    .filter((c) => c.role === role)
    .map((c) => ({ ...c, unread_count: Number(c.unread_count) }));
}

export interface LoadedConversation {
  status: ConversationStatus;
  enrollmentId: string;
  messages: Message[];
  hasOlder: boolean;
}

/**
 * Everything the conversation screen opens with. Loads back far enough to
 * include the first unread message (up to a few pages), so the screen can open
 * there instead of at the bottom.
 */
export async function loadConversation(conversationId: string, role: ConversationRole): Promise<LoadedConversation | null> {
  if (!UUID_RE.test(conversationId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: status } = await supabase.rpc("conversation_status", { p_conversation: conversationId });
  if (!status || (status as ConversationStatus).role !== role) return null;
  const { data: conv } = await supabase.from("conversations").select("enrollment_id").eq("id", conversationId).maybeSingle();
  if (!conv) return null;

  const first = await loadMessagesAction(conversationId);
  if (!first.ok) return null;
  let { messages, hasOlder } = first.data;
  const readTo = (status as ConversationStatus).my_last_read_seq;
  for (let i = 0; i < 4 && hasOlder && messages.length && messages[0].seq > readTo + 1; i++) {
    const older = await loadMessagesAction(conversationId, { beforeSeq: messages[0].seq });
    if (!older.ok) break;
    messages = [...older.data.messages, ...messages];
    hasOlder = older.data.hasOlder;
  }

  return { status: status as ConversationStatus, enrollmentId: conv.enrollment_id as string, messages, hasOlder };
}
