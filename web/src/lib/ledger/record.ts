import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerEntryDraft } from "@/lib/ledger/effects";

/**
 * Writes ledger drafts, exactly once each.
 *
 * Idempotency is a unique index on `effect_key`, not a check-then-insert. A
 * check-then-insert has a window between the two statements, and two concurrent
 * deliveries of the same retried webhook will both find nothing and both write.
 * Letting the database refuse the duplicate closes that window entirely.
 *
 * A duplicate is therefore not an error here — it is the system working. What
 * IS an error is any other failure, which is raised so the caller can fail the
 * webhook and let Stripe retry.
 */

/** Postgres unique-violation. A duplicate effect key lands here. */
const UNIQUE_VIOLATION = "23505";

export interface RecordResult {
  readonly written: number;
  readonly alreadyPresent: number;
}

export async function recordLedgerEffects(
  admin: SupabaseClient,
  drafts: readonly LedgerEntryDraft[],
  sourceEventId?: string,
): Promise<RecordResult> {
  let written = 0;
  let alreadyPresent = 0;

  for (const draft of drafts) {
    // Resolve what this entry reverses, if anything, so a correction points at
    // the thing it corrects rather than floating free.
    let reversesEntryId: string | null = null;
    if (draft.reversesEffectKey) {
      const { data } = await admin
        .from("ledger_entries")
        .select("id")
        .eq("effect_key", draft.reversesEffectKey)
        .maybeSingle();
      reversesEntryId = data?.id ?? null;
    }

    const { data, error } = await admin
      .from("ledger_entries")
      .insert({
        account: draft.account,
        effect: draft.effect,
        currency: draft.currency,
        amount_minor: draft.amountMinor,
        effect_key: draft.effectKey,
        provider_id: draft.providerId ?? null,
        customer_id: draft.customerId ?? null,
        purchase_id: draft.purchaseId ?? null,
        billing_cycle_id: draft.billingCycleId ?? null,
        commission_policy_id: draft.commissionPolicyId ?? null,
        reverses_entry_id: reversesEntryId,
        source_event_id: sourceEventId ?? null,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        // This effect is already recorded. Precisely the outcome we want from a
        // replayed event.
        alreadyPresent++;
        continue;
      }
      throw new Error(`Could not record ledger entry ${draft.effectKey}: ${error.message}`);
    }

    written++;

    // The workflow state lives in its own table so the amount above stays
    // immutable. A coach-payable entry starts pending, held, or eligible
    // according to whether the service has actually been delivered.
    if (draft.account === "coach_payable" && draft.providerId) {
      const { error: stateError } = await admin.from("earning_states").insert({
        ledger_entry_id: data.id,
        provider_id: draft.providerId,
        currency: draft.currency,
        state: draft.initialState,
        eligible_at: draft.initialState === "eligible" ? new Date().toISOString() : null,
      });
      if (stateError) {
        throw new Error(
          `Recorded ledger entry ${draft.effectKey} but could not record its workflow state: ${stateError.message}`,
        );
      }
    }
  }

  return { written, alreadyPresent };
}

/**
 * Marks a delivered service period's earnings eligible for payout.
 *
 * Separate from recording the money on purpose. Being paid and having delivered
 * are different events, and only the second one releases a coach's balance.
 */
export async function markCycleDelivered(
  admin: SupabaseClient,
  billingCycleId: string,
): Promise<number> {
  const { data: entries } = await admin
    .from("ledger_entries")
    .select("id")
    .eq("billing_cycle_id", billingCycleId)
    .eq("account", "coach_payable");

  if (!entries?.length) return 0;

  const { error } = await admin
    .from("earning_states")
    .update({ state: "eligible", eligible_at: new Date().toISOString() })
    .in(
      "ledger_entry_id",
      entries.map((e) => e.id),
    )
    // Only pending entries graduate. A held entry stays held — a dispute is not
    // resolved by a service period completing.
    .eq("state", "pending");

  if (error) throw new Error(`Could not mark cycle delivered: ${error.message}`);

  await admin
    .from("billing_cycles")
    .update({ state: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", billingCycleId);

  return entries.length;
}
