-- 0027 — Admins can SEE that payout details are waiting, without seeing them
--
-- `provider_payout_destinations` is deny-all: no client, admin included, reads
-- the table. That is right for the account reference itself. But the founder
-- console must be able to list which coaches have details waiting to be
-- checked, and show enough to check them against a coach's own documents. This
-- function returns the masked form only. The full reference is revealed one
-- payout item at a time through `admin_reveal_payout_reference`, which is logged.

create or replace function admin_payout_destinations (p_provider_id uuid default null)
returns table (
  id uuid,
  provider_id uuid,
  channel text,
  masked_reference text,
  account_holder_name text,
  country text,
  currency text,
  review_state text,
  reviewed_at timestamptz,
  created_at timestamptz,
  superseded_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  return query
    select d.id, d.provider_id, d.channel, mask_reference (d.account_reference), d.account_holder_name,
           d.country, d.currency, d.review_state, d.reviewed_at, d.created_at, d.superseded_at
    from provider_payout_destinations d
    where p_provider_id is null or d.provider_id = p_provider_id
    order by d.created_at desc
    limit 500;
end;
$$;

revoke execute on function admin_payout_destinations (uuid) from public, anon;
grant execute on function admin_payout_destinations (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
