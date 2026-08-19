-- Citywalk Attendance — Phase 2
--
-- Adds: org settings (replacing hardcoded hour targets), branch geofence
-- columns (unused until Phase 5, added now so geofencing needs no migration),
-- punch corrections with an audit trail, and admin RPCs for editing profiles
-- and branches.
--
-- Depends on 20260819000002 having committed the new app_permission values.

-- ============================================================
-- 1. ENUMS
-- ============================================================
create type correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- ============================================================
-- 2. ORG SETTINGS
-- ============================================================

-- Single-row table. The `id` check constraint is the standard singleton trick:
-- it makes a second row impossible, so callers can rely on there being exactly
-- one settings record without coordinating.
create table app_settings (
  id                          boolean primary key default true,
  daily_target_hours          numeric(4,2) not null default 8,
  weekly_target_hours         numeric(5,2) not null default 40,
  approaching_threshold_hours numeric(4,2) not null default 7,
  grace_period_minutes        integer      not null default 10,
  max_shift_hours             numeric(4,2) not null default 16,
  updated_at                  timestamptz  not null default now(),
  updated_by_id               uuid references profiles(id),
  constraint app_settings_singleton check (id),
  constraint app_settings_sane_targets check (
    daily_target_hours > 0
    and weekly_target_hours > 0
    and approaching_threshold_hours > 0
    and approaching_threshold_hours <= daily_target_hours
    and grace_period_minutes >= 0
    and max_shift_hours >= daily_target_hours
  )
);
comment on table app_settings is
  'Org-wide hour targets and thresholds. Replaces the constants that used to live in TimeDial/WeeklyProgressRing/calendar-buckets, so HR can change them without a deploy.';

insert into app_settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- 3. BRANCH GEOFENCE COLUMNS
-- ============================================================
-- Nullable and unused today. Added now so that enabling geofenced punches
-- later is a code change, not a migration against a live punches table.
alter table branches add column if not exists latitude         numeric(9,6);
alter table branches add column if not exists longitude        numeric(9,6);
alter table branches add column if not exists geofence_radius_m integer;
comment on column branches.geofence_radius_m is
  'Metres from (latitude, longitude) within which a punch is considered on-site. Null = no geofence enforced for this branch.';

-- ============================================================
-- 4. PUNCH CORRECTIONS
-- ============================================================

-- Corrections are proposals, never direct edits: punches keep their original
-- values until an approver acts, and the correction row is the permanent
-- record of who changed what and why. A forgotten clock-out is otherwise
-- unfixable in-app, which quietly corrupts every downstream payroll number.
create table punch_corrections (
  id                   uuid primary key default gen_random_uuid(),
  -- Null punch_id = "I never clocked in at all", proposing a brand new punch.
  punch_id             uuid references punches(id) on delete cascade,
  user_id              uuid not null references profiles(id) on delete cascade,
  branch_id            uuid not null references branches(id),
  requested_by_id      uuid not null references profiles(id) on delete cascade,
  proposed_clock_in_at  timestamptz not null,
  proposed_clock_out_at timestamptz,
  reason               text not null,
  status               correction_status not null default 'pending',
  decided_by_id        uuid references profiles(id),
  decided_at           timestamptz,
  decision_note        text,
  -- Snapshot of the punch as it was when the correction was filed, so the
  -- audit trail survives even after the punch is rewritten.
  original_clock_in_at  timestamptz,
  original_clock_out_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint punch_corrections_time_order
    check (proposed_clock_out_at is null or proposed_clock_out_at > proposed_clock_in_at)
);
comment on table punch_corrections is
  'Proposed fixes to a missed or wrong punch. Applied to punches only via decide_punch_correction().';
create index punch_corrections_branch_status_idx on punch_corrections (branch_id, status);
create index punch_corrections_user_idx on punch_corrections (user_id);
-- At most one pending correction per punch, so two approvers cannot each
-- approve a different proposal for the same shift.
create unique index punch_corrections_one_pending_per_punch
  on punch_corrections (punch_id) where status = 'pending' and punch_id is not null;

create trigger app_settings_touch_updated_at before update on app_settings
  for each row execute function touch_updated_at();
create trigger punch_corrections_touch_updated_at before update on punch_corrections
  for each row execute function touch_updated_at();

-- ============================================================
-- 5. RPCS
-- ============================================================

-- File a correction. Staff may file for themselves; anyone with
-- attendance.correct at branch/org level may file on someone else's behalf.
create or replace function request_punch_correction(
  p_user_id uuid,
  p_punch_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
  v_target_branch uuid;
  v_original_in timestamptz;
  v_original_out timestamptz;
  v_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;
  if not is_active_user() then
    raise exception 'not authorized';
  end if;

  select branch_id into v_target_branch from profiles where id = p_user_id;
  if v_target_branch is null then
    raise exception 'user not found';
  end if;

  -- Filing for yourself needs no special permission; filing for someone else
  -- needs correction rights covering their branch.
  if p_user_id <> auth.uid() then
    if not (
      has_min_access('attendance.correct.org', 'org')
      or (v_target_branch = my_branch_id() and has_min_access('attendance.correct.branch', 'branch'))
    ) then
      raise exception 'not authorized to file a correction for someone else';
    end if;
  end if;

  if p_punch_id is not null then
    select branch_id, clock_in_at, clock_out_at
      into v_branch, v_original_in, v_original_out
      from punches where id = p_punch_id;
    if v_branch is null then
      raise exception 'punch not found';
    end if;
    -- Guard against pointing a correction at another person's punch.
    if not exists (select 1 from punches where id = p_punch_id and user_id = p_user_id) then
      raise exception 'punch does not belong to that user';
    end if;
  else
    v_branch := v_target_branch;
  end if;

  insert into punch_corrections (
    punch_id, user_id, branch_id, requested_by_id,
    proposed_clock_in_at, proposed_clock_out_at, reason,
    original_clock_in_at, original_clock_out_at
  ) values (
    p_punch_id, p_user_id, v_branch, auth.uid(),
    p_clock_in_at, p_clock_out_at, p_reason,
    v_original_in, v_original_out
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Approve or reject. Approving is what actually rewrites (or creates) the
-- punch — nothing else in the app may update punch times.
create or replace function decide_punch_correction(
  p_id uuid,
  p_decision correction_status,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row punch_corrections%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into v_row from punch_corrections where id = p_id and status = 'pending';
  if v_row.id is null then
    raise exception 'correction not found or already decided';
  end if;

  if not (
    has_min_access('attendance.correct.org', 'org')
    or (v_row.branch_id = my_branch_id() and has_min_access('attendance.correct.branch', 'branch'))
  ) then
    raise exception 'not authorized';
  end if;

  -- An approver must not rubber-stamp their own request.
  if v_row.requested_by_id = auth.uid() and my_role() <> 'admin' then
    raise exception 'you cannot decide a correction you filed yourself';
  end if;

  if p_decision = 'approved' then
    if v_row.punch_id is null then
      insert into punches (user_id, branch_id, clock_in_at, clock_out_at, method)
      values (v_row.user_id, v_row.branch_id, v_row.proposed_clock_in_at, v_row.proposed_clock_out_at, 'manual');
    else
      update punches
        set clock_in_at = v_row.proposed_clock_in_at,
            clock_out_at = v_row.proposed_clock_out_at,
            updated_at = now()
        where id = v_row.punch_id;
    end if;
  end if;

  update punch_corrections
    set status = p_decision, decided_by_id = auth.uid(), decided_at = now(),
        decision_note = p_note, updated_at = now()
    where id = p_id;
end;
$$;

create or replace function cancel_punch_correction(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update punch_corrections
    set status = 'cancelled', updated_at = now()
    where id = p_id and status = 'pending' and requested_by_id = auth.uid();
  if not found then
    raise exception 'not permitted, or already decided';
  end if;
end;
$$;

-- Admin edits to someone else's profile. Deliberately cannot touch `role` or
-- `is_active` — those keep their own RPCs so each privileged capability stays
-- separately grantable.
create or replace function admin_update_profile(
  p_user_id uuid,
  p_full_name text,
  p_job_title text,
  p_branch_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'name is required';
  end if;
  update profiles
    set full_name = trim(p_full_name),
        job_title = nullif(trim(coalesce(p_job_title, '')), ''),
        branch_id = coalesce(p_branch_id, branch_id),
        updated_at = now()
    where id = p_user_id;
end;
$$;

create or replace function admin_upsert_branch(
  p_id uuid,
  p_code text,
  p_name text,
  p_brand text,
  p_town text,
  p_is_active boolean,
  p_latitude numeric,
  p_longitude numeric,
  p_geofence_radius_m integer
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not has_min_access('admin.branches', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'code and name are required';
  end if;

  if p_id is null then
    insert into branches (code, name, brand, town, is_active, latitude, longitude, geofence_radius_m)
    values (upper(trim(p_code)), trim(p_name), coalesce(nullif(trim(p_brand), ''), trim(p_name)),
            nullif(trim(coalesce(p_town, '')), ''), coalesce(p_is_active, true),
            p_latitude, p_longitude, p_geofence_radius_m)
    returning id into v_id;
  else
    update branches
      set code = upper(trim(p_code)),
          name = trim(p_name),
          brand = coalesce(nullif(trim(p_brand), ''), brand),
          town = nullif(trim(coalesce(p_town, '')), ''),
          is_active = coalesce(p_is_active, is_active),
          latitude = p_latitude,
          longitude = p_longitude,
          geofence_radius_m = p_geofence_radius_m,
          updated_at = now()
      where id = p_id
      returning id into v_id;
    if v_id is null then
      raise exception 'branch not found';
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function admin_update_settings(
  p_daily_target_hours numeric,
  p_weekly_target_hours numeric,
  p_approaching_threshold_hours numeric,
  p_grace_period_minutes integer,
  p_max_shift_hours numeric
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.settings', 'full') then
    raise exception 'not authorized';
  end if;
  update app_settings
    set daily_target_hours = p_daily_target_hours,
        weekly_target_hours = p_weekly_target_hours,
        approaching_threshold_hours = p_approaching_threshold_hours,
        grace_period_minutes = p_grace_period_minutes,
        max_shift_hours = p_max_shift_hours,
        updated_by_id = auth.uid(),
        updated_at = now()
    where id = true;
end;
$$;

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
alter table app_settings enable row level security;
alter table punch_corrections enable row level security;

-- Settings are readable by every signed-in user (the dial needs the targets);
-- writes go through admin_update_settings() only.
create policy app_settings_read on app_settings for select
  using (auth.uid() is not null);
create policy app_settings_admin_write on app_settings for all
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- Corrections: visible to the person they're about, whoever filed them, and
-- branch/org approvers. Inserts and status changes go through the RPCs above,
-- so there is deliberately no update policy here.
create policy punch_corrections_select on punch_corrections for select
  using (
    user_id = auth.uid()
    or requested_by_id = auth.uid()
    or my_role() = 'admin'
    or (branch_id = my_branch_id() and has_min_access('attendance.correct.branch', 'branch'))
    or has_min_access('attendance.correct.org', 'org')
  );

-- ============================================================
-- 7. DEFAULT PERMISSIONS FOR THE NEW CAPABILITIES
-- ============================================================
insert into role_permissions (role, permission, access_level) values
  ('branch_manager', 'attendance.correct.branch', 'branch'),
  ('hr_accounts',    'attendance.correct.org',    'org'),
  ('hr_accounts',    'admin.branches',            'none'),
  ('hr_accounts',    'admin.settings',            'none')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- Keep the admin row complete so /admin/permissions doesn't render blanks.
insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
