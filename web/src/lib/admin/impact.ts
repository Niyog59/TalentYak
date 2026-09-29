import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attempt, attemptCount, failed, loaded, type Loaded } from "@/lib/admin/loaded";
import type { FeatureKey } from "@/lib/features/registry";

/*
 * What a switch change would touch, measured before it is made. Counts are
 * read now from the real records through the founder's session; anything that
 * can't be measured says so. Nothing is estimated.
 */

export interface ImpactLine {
  label: string;
  count: Loaded<number>;
  /** What happens to these under the change. */
  note: string;
}

export async function featureImpact(key: FeatureKey): Promise<ImpactLine[]> {
  const sb = await createClient();
  if (!sb) return [];
  const head = { count: "exact" as const, head: true };
  const now = new Date().toISOString();
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const activeRelationships = () => attemptCount(() => sb.from("enrollments").select("id", head).eq("state", "active"));
  const ops = await attempt(() => sb.rpc("admin_coaching_operations"));
  const op = (k: string): Loaded<number> => (ops.ok ? loaded(Number((ops.value as Record<string, number>)[k] ?? 0)) : failed());

  switch (key) {
    case "messaging":
      return [
        { label: "Clients in active coaching", count: await activeRelationships(), note: "Can't send new messages; their conversations stay readable (hidden in an emergency switch-off)." },
        { label: "Conversations with messages in the last 7 days", count: op("conversations_active_7d"), note: "Unsent text stays on the person's device." },
      ];
    case "attachments":
      return [
        { label: "Clients in active coaching", count: await activeRelationships(), note: "Can't add photos or clips to messages and check-ins." },
        { label: "Uploads still processing", count: op("media_processing"), note: "Finish processing; in an emergency switch-off they aren't shown." },
      ];
    case "bookings":
      return [
        { label: "Session requests waiting for an answer", count: op("requests_pending"), note: "Can still be accepted or declined." },
        { label: "Confirmed upcoming sessions", count: op("sessions_upcoming"), note: "Not affected — they go ahead." },
        { label: "Active weekly series", count: await attemptCount(() => sb.from("appointment_series").select("id", head).eq("state", "active")), note: "Keep adding their agreed sessions." },
      ];
    case "calls":
      return [
        { label: "Call rooms open right now", count: op("calls_open_now"), note: "Closed if calls are switched off." },
        {
          label: "Confirmed sessions in the next 7 days",
          count: await attemptCount(() => sb.from("appointments").select("id", head).eq("state", "booked").gte("starts_at", now).lte("starts_at", new Date(Date.now() + 7 * 86_400_000).toISOString())),
          note: "Stay booked but can't be joined while calls are off. Contact the people involved.",
        },
      ];
    case "programmes":
      return [
        { label: "Plan updates scheduled to start later", count: op("plan_updates_scheduled"), note: "Still take effect on their date." },
        { label: "Plans published in the last 7 days", count: op("plans_published_7d"), note: "Unaffected; coaches can't publish more while paused." },
      ];
    case "logging":
      return [
        { label: "Clients in active coaching", count: await activeRelationships(), note: "New entries wait on their device and save when logging is back." },
        { label: "Workouts logged in the last 7 days", count: op("workouts_logged_7d"), note: "Unaffected and readable." },
      ];
    case "check_ins":
      return [
        { label: "Check-ins requested and not yet sent", count: op("checkins_open"), note: "Can still be sent." },
        { label: "Check-ins waiting for coach feedback", count: op("checkins_awaiting_review"), note: "Coaches can still finish them." },
      ];
    case "new_sales":
      return [
        {
          label: "Checkouts in progress",
          count: await attemptCount(() => sb.from("checkout_attempts").select("id", head).in("state", ["created", "redirected"]).gt("expires_at", now)),
          note: "A checkout already on the payment page can still complete; that payment is real and is honoured.",
        },
        { label: "Paying clients", count: await attemptCount(() => sb.from("purchases").select("id", head).in("state", ["active", "cancelling", "past_due"])), note: "Not affected: coaching and renewals continue." },
      ];
    case "public_profiles":
      return [
        { label: "Coaches listed publicly", count: await attemptCount(() => sb.from("providers").select("id", head).eq("status", "approved").not("published_at", "is", null).is("suspended_at", null)), note: "Hidden from the website while off; their settings are unchanged." },
      ];
    case "waitlist":
      return [
        { label: "People on the waitlist", count: await attemptCount(() => sb.from("waitlist_entries").select("id", head)), note: "Kept. They can still confirm or leave." },
        { label: "Joined in the last 30 days", count: await attemptCount(() => sb.from("waitlist_entries").select("id", head).gte("created_at", since(30))), note: "For a sense of what closing it would stop." },
      ];
    case "coach_changing":
      return [
        { label: "Requests waiting for a decision", count: await attemptCount(() => sb.from("coach_change_requests").select("id", head).eq("state", "requested")), note: "Are still decided through the normal workflow." },
        { label: "Clients in active coaching", count: await activeRelationships(), note: "Who could ask, when it's on." },
      ];
  }
}
