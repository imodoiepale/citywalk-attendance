-- Clock-out must use the database clock, not the app server's.
--
-- `punches.clock_in_at` defaults to now() (Postgres time), but clockOutAction
-- sent `new Date().toISOString()` from the Node process. The
-- punches_out_after_in constraint then compares two different clocks, so any
-- skew between the app server and the database — or a clock-in and clock-out
-- close together — fails with a bare 23514 check violation and the shift never
-- closes. Reproduced against this project: a clock-out issued immediately after
-- a clock-in was rejected.
--
-- Both timestamps now come from the same source. The RPC also reports whether
-- it actually closed anything, so "you have no open shift" stays distinguishable
-- from a successful close without a second round trip.

create or replace function clock_out()
returns punches
language plpgsql security invoker set search_path = public as $$
declare
  v_row punches;
begin
  update punches
    set clock_out_at = greatest(now(), clock_in_at + interval '1 second'),
        updated_at = now()
    where user_id = auth.uid()
      and clock_out_at is null
    returning * into v_row;

  if v_row.id is null then
    raise exception 'You have no open shift.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function clock_out is
  'Closes the caller''s open punch using the database clock. greatest(...) guards the degenerate case where a shift is closed within the same instant it opened, which the punches_out_after_in constraint would otherwise reject.';

-- security invoker, so RLS still applies: a user can only ever close their own
-- punch, and a deactivated account is blocked by the punches_update policy.
grant execute on function clock_out() to authenticated;
