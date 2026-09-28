-- M12 · Fixes found while building the tracking screens on top of 0048.
--
-- 1. save_body_entry() compared the device's "what I last saw" token with
--    Postgres's own text form of a timestamp, which the API never returns
--    (it sends ISO 8601). The token is now whole microseconds since 1970,
--    which both sides can build exactly from the same instant.

create or replace function body_entry_token (p_weight timestamptz, p_measure timestamptz)
returns text
language sql
immutable
as $$
  select coalesce((extract(epoch from p_weight) * 1000000)::bigint::text, '-')
         || '|' || coalesce((extract(epoch from p_measure) * 1000000)::bigint::text, '-');
$$;

create or replace function save_body_entry (
  p_enrollment uuid,
  p_date date,
  p_weight numeric,
  p_weight_unit text,
  p_waist numeric,
  p_hips numeric,
  p_chest numeric,
  p_arm numeric,
  p_length_unit text,
  p_base text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bw bodyweight_logs;
  v_m measurements;
  v_token text;
  v_kg numeric;
  v_factor numeric;
  v_lengths numeric[];
begin
  perform assert_tracking_write (p_enrollment, p_date);

  select * into v_bw from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date for update;
  select * into v_m from measurements where enrollment_id = p_enrollment and logged_on = p_date for update;
  v_token := body_entry_token (v_bw.updated_at, v_m.updated_at);

  if p_base is not null and p_base <> v_token and not (p_base = '' and v_token = '-|-') then
    return jsonb_build_object('ok', false, 'conflict', true, 'token', v_token);
  end if;

  if p_weight is null and p_waist is null and p_hips is null and p_chest is null and p_arm is null
     and v_bw.id is null and v_m.id is null then
    raise exception 'body_entry_empty' using errcode = 'check_violation';
  end if;

  if p_weight is null then
    delete from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date;
  else
    if p_weight_unit not in ('kg', 'lb') then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    v_kg := round(case when p_weight_unit = 'lb' then p_weight * 0.45359237 else p_weight end, 2);
    if v_kg < 20 or v_kg > 400 then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    insert into bodyweight_logs (enrollment_id, logged_on, weight_kg, entered_value, entered_unit)
      values (p_enrollment, p_date, v_kg, round(p_weight, 2), p_weight_unit)
    on conflict (enrollment_id, logged_on) where enrollment_id is not null do update set
      weight_kg = excluded.weight_kg, entered_value = excluded.entered_value,
      entered_unit = excluded.entered_unit, updated_at = now();
  end if;

  if p_waist is null and p_hips is null and p_chest is null and p_arm is null then
    delete from measurements where enrollment_id = p_enrollment and logged_on = p_date;
  else
    if p_length_unit not in ('cm', 'in') then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    v_factor := case when p_length_unit = 'in' then 2.54 else 1 end;
    v_lengths := array[p_waist * v_factor, p_hips * v_factor, p_chest * v_factor, p_arm * v_factor];
    if exists (select 1 from unnest(v_lengths) l where l is not null and (l < 10 or l > 300)) then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    insert into measurements (enrollment_id, logged_on, waist_cm, hip_cm, chest_cm, arm_cm, entered_unit)
      values (p_enrollment, p_date, round(v_lengths[1], 2), round(v_lengths[2], 2), round(v_lengths[3], 2),
              round(v_lengths[4], 2), p_length_unit)
    on conflict (enrollment_id, logged_on) where enrollment_id is not null do update set
      waist_cm = excluded.waist_cm, hip_cm = excluded.hip_cm, chest_cm = excluded.chest_cm,
      arm_cm = excluded.arm_cm, entered_unit = excluded.entered_unit, updated_at = now();
  end if;

  select * into v_bw from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date;
  select * into v_m from measurements where enrollment_id = p_enrollment and logged_on = p_date;
  return jsonb_build_object('ok', true, 'token', body_entry_token (v_bw.updated_at, v_m.updated_at));
end;
$$;

notify pgrst, 'reload schema';
