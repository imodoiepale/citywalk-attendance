-- Turn one resolved scan into a punch, atomically.
--
-- The manual path uses clock_out(), which is security invoker and resolves the
-- caller through auth.uid(). Ingest has no session — it is authenticated by a
-- device signature, not a user — so it needs its own entry point.
--
-- Doing this in one RPC rather than in TypeScript also means the read of "is
-- there an open punch" and the write that closes it happen in a single
-- statement each, inside one transaction. Two devices scanned in quick
-- succession, or a device replaying a buffer, cannot interleave into a double
-- punch.

create or replace function apply_biometric_punch(
  p_profile_id uuid,
  p_direction  device_direction,
  p_scanned_at timestamptz
)
returns table (punch_id uuid, action text)
language plpgsql security definer set search_path = public as $$
declare
  v_open   punches%rowtype;
  v_branch uuid;
  v_id     uuid;
begin
  select * into v_open
    from punches
   where user_id = p_profile_id and clock_out_at is null
   for update;

  -- The punch is recorded against the person's branch, not the device's: a
  -- staff member covering another branch for a day is still that branch's
  -- headcount, and this matches how the manual path already behaves.
  select branch_id into v_branch from profiles where id = p_profile_id;
  if v_branch is null then
    raise exception 'profile has no branch';
  end if;

  -- 'both' devices toggle: whatever the person is not currently doing.
  if p_direction = 'in' or (p_direction = 'both' and v_open.id is null) then
    if v_open.id is not null then
      -- Already clocked in. Not an error — someone scanning the entry reader
      -- twice is normal — but there is nothing to record.
      return query select v_open.id, 'already_open'::text;
      return;
    end if;

    insert into punches (user_id, branch_id, clock_in_at, method)
    values (p_profile_id, v_branch, p_scanned_at, 'biometric')
    returning id into v_id;
    return query select v_id, 'opened'::text;
    return;
  end if;

  if v_open.id is null then
    return query select null::uuid, 'nothing_to_close'::text;
    return;
  end if;

  update punches
     set clock_out_at = greatest(p_scanned_at, v_open.clock_in_at + interval '1 second'),
         updated_at = now()
   where id = v_open.id;

  return query select v_open.id, 'closed'::text;
end;
$$;

comment on function apply_biometric_punch is
  'Applies a resolved biometric scan. Row-locks the open punch so concurrent scans cannot double-punch. greatest(...) keeps clock_out_at after clock_in_at when a device clock runs slow, which the punches_out_after_in constraint would otherwise reject.';
