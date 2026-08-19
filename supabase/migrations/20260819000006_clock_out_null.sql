-- Clocking out with nothing open is an ordinary user situation, not a server
-- fault. Raising made PostgREST answer 500, which would page someone over a
-- double-tapped button. Returning null instead keeps the transport honest
-- (nothing to close, here is nothing) and leaves the wording to the app.

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

  -- v_row.id is null when no open punch matched; the caller distinguishes.
  return v_row;
end;
$$;

comment on function clock_out is
  'Closes the caller''s open punch using the database clock, returning the closed row, or a null row when there was nothing open. greatest(...) guards the degenerate case where a shift is closed within the same instant it opened, which the punches_out_after_in constraint would otherwise reject.';

grant execute on function clock_out() to authenticated;
