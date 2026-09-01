-- Real-time overtime: a person still clocked in has no stored overtime_minutes
-- yet (that's computed at clock-out by compute_shift_flags), so the dashboard
-- widget needs it computed live against now().

create or replace view punches_live_overtime
with (security_invoker = true) as
select
  p.id as punch_id,
  p.user_id,
  p.branch_id,
  pr.full_name,
  b.name as branch_name,
  st.id as shift_template_id,
  greatest(0, ceil(extract(epoch from (
    now() - (
      ((p.clock_in_at at time zone 'Africa/Nairobi')::date + st.clock_out_window_end)
        at time zone 'Africa/Nairobi'
      + make_interval(mins => st.grace_minutes)
    )
  )) / 60))::integer as minutes_over
from punches p
join profiles pr on pr.id = p.user_id
join branches b on b.id = p.branch_id
cross join lateral resolve_shift_window(p.user_id, (p.clock_in_at at time zone 'Africa/Nairobi')::date) st
where p.clock_out_at is null
  and st.id is not null
  and now() > (
    ((p.clock_in_at at time zone 'Africa/Nairobi')::date + st.clock_out_window_end)
      at time zone 'Africa/Nairobi'
    + make_interval(mins => st.grace_minutes)
  );

comment on view punches_live_overtime is
  'Currently-open punches already past their shift''s clock-out window + grace. security_invoker means it inherits the caller''s own punches/profiles/branches RLS — no new grants needed.';
