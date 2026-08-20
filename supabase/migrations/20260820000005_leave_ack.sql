-- Lets the app tell someone their leave was decided, exactly once.
--
-- Without a marker there is no way to distinguish "decided while you were
-- away, you have not seen it" from "decided last month, you already know" —
-- so a dashboard toast would either fire on every single load forever, or
-- never fire at all.
alter table leave_requests
  add column if not exists seen_by_requester_at timestamptz;

comment on column leave_requests.seen_by_requester_at is
  'When the requester was shown the decision. Null on a decided request means the announcement is still owed.';

-- The dashboard asks "anything decided and unseen for me?" on every load, so
-- it has to be cheap. Partial: the rows that matter are a tiny slice.
create index if not exists leave_requests_unseen_decision_idx
  on leave_requests (requester_id)
  where seen_by_requester_at is null and status in ('approved', 'rejected');

-- Only the requester may mark their own decision as seen, and only once —
-- `is null` in the predicate makes a re-run a no-op rather than moving the
-- timestamp forward.
create or replace function acknowledge_leave_decisions()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update leave_requests
     set seen_by_requester_at = now()
   where requester_id = auth.uid()
     and seen_by_requester_at is null
     and status in ('approved', 'rejected');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function acknowledge_leave_decisions() to authenticated;
