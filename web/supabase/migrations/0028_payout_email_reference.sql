-- 0028 — A coach's payout email names the transfer reference
--
-- The coach is told a payout was sent, but not which transfer it was. Without
-- the reference they cannot match it against what arrives in their account, or
-- ask their bank about it. The reference is already recorded as evidence; this
-- passes it to the notification as well.

create or replace function admin_record_payout_paid (
  p_item_id uuid,
  p_external_reference text,
  p_paid_at timestamptz,
  p_evidence_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i payout_batch_items%rowtype;
  v_entry uuid;
  v_states int;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if coalesce(length(trim(p_external_reference)), 0) < 3 then
    raise exception 'reference_required' using hint = 'Enter the transfer reference from your payment provider.';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'paid_at_invalid' using hint = 'Enter the date the transfer was made.';
  end if;
  if coalesce(length(trim(p_evidence_note)), 0) < 3 then
    raise exception 'evidence_required' using hint = 'Note where the confirmation can be found (e.g. the statement line).';
  end if;

  select * into i from payout_batch_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using hint = 'That payout line does not exist.';
  end if;
  if i.state = 'paid' then
    -- Recording the same transfer twice is a no-op, never a second payout.
    return jsonb_build_object('item_id', i.id, 'state', 'paid', 'already', true);
  end if;
  if i.state not in ('prepared', 'submitted') then
    raise exception 'invalid_transition' using hint = format('A %s line cannot be marked paid.', i.state);
  end if;

  update payout_batch_items set
    state = 'paid', external_reference = trim(p_external_reference), paid_at = p_paid_at,
    paid_by = auth.uid (), evidence_note = trim(p_evidence_note), settlement_method = 'manual'
  where id = i.id;

  insert into ledger_entries (account, effect, currency, amount_minor, provider_id, effect_key, occurred_at)
    values ('coach_payable', 'payout', i.currency, -i.amount_minor, i.provider_id,
            'payout:' || i.id || ':paid', p_paid_at)
    on conflict (effect_key) do nothing
    returning id into v_entry;

  update earning_states set state = 'paid', paid_at = p_paid_at
    where batch_id = i.batch_id and provider_id = i.provider_id and currency = i.currency and state = 'batched';
  get diagnostics v_states = row_count;

  insert into payout_batch_events (batch_id, item_id, action, note, actor)
    values (i.batch_id, i.id, 'paid', format('ref %s; %s', trim(p_external_reference), trim(p_evidence_note)), auth.uid ());

  perform refresh_batch_state (i.batch_id);

  perform enqueue_outbox ('email.payout_paid',
    jsonb_build_object('provider_id', i.provider_id, 'amount_minor', i.amount_minor, 'currency', i.currency,
                       'paid_at', p_paid_at, 'external_reference', trim(p_external_reference)),
    'payout_paid:' || i.id);

  return jsonb_build_object('item_id', i.id, 'state', 'paid', 'ledger_entry_id', v_entry, 'earnings_marked_paid', v_states);
end;
$$;

notify pgrst, 'reload schema';
