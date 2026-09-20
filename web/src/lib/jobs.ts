import "server-only";
import { enqueue, kickWorker } from "@/lib/worker/outbox";

/**
 * Compatibility entry point for the retained pandit and booking code.
 *
 * The old queue (`notification_jobs`) was processed by a loop that could send
 * the same message twice and marked jobs "sent" when the provider had merely
 * been called. Everything now goes through the outbox and its worker. The old
 * table is kept, unwritten, under the node protection rule.
 */

export async function enqueueShraddhaReminder(args: {
  email: string;
  customerName: string | null;
  rememberedName: string;
  tithi: string;
  dateText: string;
  scheduledFor: Date;
  shraddhaDateId: string;
}) {
  await enqueue({
    topic: "email.shraddha_reminder",
    payload: {
      email: args.email,
      customer_name: args.customerName,
      remembered_name: args.rememberedName,
      tithi: args.tithi,
      date_text: args.dateText,
    },
    // One reminder per confirmed date per year, however often the button is pressed.
    dedupeKey: `shraddha_reminder:${args.shraddhaDateId}:${args.dateText}`,
    scheduledFor: args.scheduledFor,
  });
  kickWorker();
}
