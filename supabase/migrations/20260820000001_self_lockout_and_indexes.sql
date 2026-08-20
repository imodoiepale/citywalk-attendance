-- 1. An admin must not be able to deactivate themselves.
-- 2. Indexes for the filters the app actually issues.

-- ============================================================
-- 1. SELF-LOCKOUT GUARD
-- ============================================================
--
-- /admin/users renders each account's status as a toggle button. Clicking your
-- own row deactivates you, and requireUser() then bounces every request to
-- /login?error=deactivated — including /admin/users itself. There is no way
-- back through the UI: the only account that could undo it is the one that just
-- locked itself out. This happened to the first real admin on this project.
--
-- The same reasoning already protects the permission matrix (has_min_access()
-- hardcodes admin to true so the matrix editor cannot lock every admin out).
-- This closes the equivalent hole on activation.
--
-- Enforced here rather than only in the UI because it is a data-integrity rule:
-- a stray API call should not be able to strand the organisation either.
create or replace function admin_set_active(p_user_id uuid, p_is_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;

  if p_user_id = auth.uid() and p_is_active = false then
    raise exception 'You cannot deactivate your own account. Ask another admin.'
      using errcode = 'P0001';
  end if;

  -- Refuse to remove the last active admin, however it is attempted: an org
  -- with no active admin cannot grant anyone the rights to fix it.
  if p_is_active = false
     and exists (select 1 from profiles where id = p_user_id and role = 'admin' and is_active)
     and (select count(*) from profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'That is the only active admin. Promote another admin first.'
      using errcode = 'P0001';
  end if;

  update profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;
end;
$$;

-- Demoting the last admin strands the org just as effectively as deactivating
-- them, so guard the role change the same way.
create or replace function admin_set_role(p_user_id uuid, p_new_role app_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;

  if p_new_role <> 'admin'
     and exists (select 1 from profiles where id = p_user_id and role = 'admin' and is_active)
     and (select count(*) from profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'That is the only active admin. Promote another admin first.'
      using errcode = 'P0001';
  end if;

  update profiles set role = p_new_role, updated_at = now() where id = p_user_id;
end;
$$;

-- ============================================================
-- 2. INDEXES
-- ============================================================
-- Matching the filters the app issues, not speculative ones.

-- listAllUsers()/getBranchStaff() sort by name and filter on is_active;
-- loadTimesheet() filters profiles by branch.
create index if not exists profiles_active_name_idx on profiles (is_active, full_name);
create index if not exists profiles_branch_active_idx on profiles (branch_id, is_active);

-- The signup dropdown and every branch picker read active branches by name.
create index if not exists branches_active_name_idx on branches (is_active, name);

-- getMyLeaveRequests() ORs requester_id/filed_by_id; only requester_id was
-- indexed, so the filed_by half was a sequential scan.
create index if not exists leave_requests_filed_by_idx on leave_requests (filed_by_id);
-- countMyPendingLeave() and the approvals queue both filter on status first.
create index if not exists leave_requests_status_created_idx on leave_requests (status, created_at);
-- getApprovedLeaveDayKeys() overlaps a date range per requester.
create index if not exists leave_requests_requester_dates_idx
  on leave_requests (requester_id, start_date, end_date) where status = 'approved';

-- loadTimesheet()/analytics scan a period across a branch; the existing
-- (branch_id, clock_in_at) index covers the branch-scoped case, this covers the
-- org-wide one where there is no branch predicate at all.
create index if not exists punches_clock_in_idx on punches (clock_in_at);

-- The corrections queue lists pending work oldest-first.
create index if not exists punch_corrections_pending_idx
  on punch_corrections (branch_id, created_at) where status = 'pending';
