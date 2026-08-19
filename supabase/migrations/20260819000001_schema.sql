-- Citywalk Attendance — core schema
-- Roles, branches, punches, leave requests, and a database-backed
-- role/permission matrix (the actual authorization source of truth —
-- see the RBAC note in section 10).

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
-- 1. ENUMS
-- ============================================================
create type app_role as enum ('staff', 'branch_manager', 'hr_accounts', 'admin');

create type punch_method as enum ('manual', 'geofence', 'biometric');

create type leave_type as enum ('annual', 'sick', 'compassionate', 'unpaid', 'other');

create type leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create type access_level as enum ('none', 'own', 'branch', 'org', 'full');

-- Dot-namespaced permission catalogue. Extending this list is a migration;
-- who holds how much of each permission is data (role_permissions), not code.
create type app_permission as enum (
  'punch.view.own',
  'leave.request.own',
  'leave.request.on_behalf',
  'leave.approve.branch',
  'leave.approve.org',
  'leave.cancel.own',
  'report.view.branch',
  'report.view.org',
  'admin.users',
  'admin.permissions'
);

-- ============================================================
-- 2. TABLES
-- ============================================================

create table branches (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null unique,
  brand      text not null,        -- 'Citywalk' | 'City Brandz' | 'City Safari' | 'City Fragrance' | 'HQ' ...
  town       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table branches is 'Citywalk retail branches (plus an HQ entry for org-wide staff).';

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text not null unique,
  role          app_role not null default 'staff',
  branch_id     uuid not null references branches(id),
  job_title     text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table profiles is 'One row per auth.users row, auto-created by handle_new_auth_user() at signup.';
create index profiles_branch_idx on profiles (branch_id);

create table punches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  branch_id     uuid not null references branches(id),
  clock_in_at   timestamptz not null default now(),
  clock_out_at  timestamptz,
  method        punch_method not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint punches_out_after_in check (clock_out_at is null or clock_out_at > clock_in_at)
);
comment on table punches is 'One row per shift. branch_id is captured at punch time so history survives a later branch transfer.';
-- DB-enforced "only one open punch per user" — not just a client-side check.
create unique index punches_one_open_per_user on punches (user_id) where clock_out_at is null;
create index punches_branch_time_idx on punches (branch_id, clock_in_at);
create index punches_user_time_idx on punches (user_id, clock_in_at);

create table leave_requests (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references profiles(id) on delete cascade,
  filed_by_id    uuid not null references profiles(id) on delete cascade,
  branch_id      uuid not null references branches(id),
  type           leave_type not null,
  start_date     date not null,
  end_date       date not null,
  reason         text,
  status         leave_status not null default 'pending',
  decided_by_id  uuid references profiles(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leave_requests_date_order check (end_date >= start_date)
);
comment on table leave_requests is 'requester_id is who the leave is for; filed_by_id is who submitted it (self, or a manager/HR filing on their behalf).';
create index leave_requests_branch_status_idx on leave_requests (branch_id, status);
create index leave_requests_requester_idx on leave_requests (requester_id);

create table role_permissions (
  role          app_role not null,
  permission    app_permission not null,
  access_level  access_level not null default 'none',
  updated_at    timestamptz not null default now(),
  primary key (role, permission)
);
comment on table role_permissions is
  'The real authorization source of truth. An admin can regrant/restrict what a role can do by editing this table (via /admin/permissions) with no code deploy. The app-side rbac catalog only holds labels for rendering.';

-- ============================================================
-- 3. HELPER FUNCTIONS (security definer — can read tables that
--    themselves have RLS enabled, without recursing through it)
-- ============================================================

create or replace function my_role()
returns app_role
language sql security definer set search_path = public stable as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function my_branch_id()
returns uuid
language sql security definer set search_path = public stable as $$
  select branch_id from profiles where id = auth.uid();
$$;

create or replace function is_active_user()
returns boolean
language sql security definer set search_path = public stable as $$
  select coalesce((select is_active from profiles where id = auth.uid()), false);
$$;

create or replace function access_level_rank(lvl access_level)
returns int
language sql immutable as $$
  select case lvl
    when 'none' then 0
    when 'own' then 1
    when 'branch' then 2
    when 'org' then 3
    when 'full' then 4
  end;
$$;

-- The single authorization check used by both RLS policies and RPCs.
-- A deactivated account gets nothing, full stop — checked here once so
-- every RLS policy and RPC that calls has_min_access() inherits it,
-- rather than each one re-checking is_active_user() separately. admin is
-- hardcoded to full access on everything else — the self-lockout guard
-- for the /admin/permissions matrix editor: no amount of misconfiguring
-- role_permissions can ever lock every active admin out of fixing it.
create or replace function has_min_access(p_permission app_permission, p_min access_level default 'own')
returns boolean
language sql security definer set search_path = public stable as $$
  select case
    when not is_active_user() then false
    when my_role() = 'admin' then true
    else exists (
      select 1
      from role_permissions rp
      where rp.role = my_role()
        and rp.permission = p_permission
        and access_level_rank(rp.access_level) >= access_level_rank(p_min)
    )
  end;
$$;

-- Lets any signed-in user read their OWN role's permission set (used by
-- lib/auth.ts to build the nav/gating map) without loosening RLS on
-- role_permissions itself, which stays strictly admin-only for direct
-- table access (see section 6).
create or replace function my_permissions()
returns table (permission app_permission, access_level access_level)
language sql security definer set search_path = public stable as $$
  select rp.permission, rp.access_level
  from role_permissions rp
  where rp.role = my_role();
$$;

-- ============================================================
-- 4. PRIVILEGED RPCS (all role/activation/leave-decision writes go
--    through these — never a raw client UPDATE — so RLS policies on
--    the underlying tables can stay simple "self row only" rules)
-- ============================================================

create or replace function admin_set_role(p_user_id uuid, p_new_role app_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;
  update profiles set role = p_new_role, updated_at = now() where id = p_user_id;
end;
$$;

create or replace function admin_set_active(p_user_id uuid, p_is_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;
  update profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;
end;
$$;

-- Edits the permission matrix itself (the /admin/permissions screen).
-- Goes through has_min_access() like every other privileged write, rather
-- than relying on the role_permissions RLS policy alone, so that if an
-- admin ever delegates 'admin.permissions' access to another role, that
-- role's grant actually works end-to-end (RPC + RLS agree).
create or replace function admin_set_permission(p_role app_role, p_permission app_permission, p_access_level access_level)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('admin.permissions', 'full') then
    raise exception 'not authorized';
  end if;
  insert into role_permissions (role, permission, access_level, updated_at)
  values (p_role, p_permission, p_access_level, now())
  on conflict (role, permission) do update set access_level = excluded.access_level, updated_at = now();
end;
$$;

create or replace function decide_leave_request(p_id uuid, p_decision leave_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select branch_id into v_branch from leave_requests where id = p_id and status = 'pending';
  if v_branch is null then
    raise exception 'leave request not found or already decided';
  end if;

  if not (
    has_min_access('leave.approve.org', 'org')
    or (v_branch = my_branch_id() and has_min_access('leave.approve.branch', 'branch'))
  ) then
    raise exception 'not authorized';
  end if;

  update leave_requests
    set status = p_decision, decided_by_id = auth.uid(), decided_at = now(), decision_note = p_note, updated_at = now()
    where id = p_id;
end;
$$;

create or replace function cancel_leave_request(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_min_access('leave.cancel.own', 'own') then
    raise exception 'not authorized';
  end if;
  update leave_requests
    set status = 'cancelled', updated_at = now()
    where id = p_id
      and status = 'pending'
      and (requester_id = auth.uid() or filed_by_id = auth.uid());
  if not found then
    raise exception 'not permitted, or already decided';
  end if;
end;
$$;

-- ============================================================
-- 5. TRIGGERS
-- ============================================================

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger branches_touch_updated_at before update on branches
  for each row execute function touch_updated_at();
create trigger profiles_touch_updated_at before update on profiles
  for each row execute function touch_updated_at();
create trigger punches_touch_updated_at before update on punches
  for each row execute function touch_updated_at();
create trigger leave_requests_touch_updated_at before update on leave_requests
  for each row execute function touch_updated_at();

-- Auto-provision a profile row when someone signs up. full_name/branch_id
-- are read out of the signup metadata (see app/(auth)/actions.ts).
create or replace function handle_new_auth_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, branch_id, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    (new.raw_user_meta_data ->> 'branch_id')::uuid,
    'staff',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

alter table branches enable row level security;
alter table profiles enable row level security;
alter table punches enable row level security;
alter table leave_requests enable row level security;
alter table role_permissions enable row level security;

-- branches: readable by anyone, including anonymous requests — the
-- signup page needs this for its branch dropdown before a session exists.
create policy branches_read on branches for select using (true);
create policy branches_write on branches for all
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- profiles: self row always visible; branch/org report-viewers and admins
-- see more. Self-update is limited in practice to full_name/job_title —
-- role = my_role() and branch_id = my_branch_id() in the check clause
-- means a client can't smuggle a role or branch change through a plain
-- UPDATE (role/branch changes go through admin_set_role() instead).
create policy profiles_self_read on profiles for select
  using (
    id = auth.uid()
    or my_role() = 'admin'
    or (branch_id = my_branch_id() and has_min_access('report.view.branch', 'branch'))
    or has_min_access('report.view.org', 'org')
  );
create policy profiles_self_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = my_role() and branch_id = my_branch_id());
create policy profiles_admin_all on profiles for all
  using (my_role() = 'admin') with check (my_role() = 'admin');

-- punches: visible to self (as long as the role still grants
-- punch.view.own — revocable, e.g. to lock someone out without fully
-- deactivating them), or to branch/org roles with report access. No
-- filing punches on behalf of others — that stays out of scope (punch
-- correction/approval is still a Work-in-Progress capability).
create policy punches_select on punches for select
  using (
    (user_id = auth.uid() and has_min_access('punch.view.own', 'own'))
    or my_role() = 'admin'
    or (branch_id = my_branch_id() and has_min_access('report.view.branch', 'branch'))
    or has_min_access('report.view.org', 'org')
  );
create policy punches_insert on punches for insert
  with check (user_id = auth.uid() and is_active_user());
create policy punches_update on punches for update
  using (user_id = auth.uid() and is_active_user())
  with check (user_id = auth.uid() and is_active_user());

-- leave_requests: visible to the requester, whoever filed it, and
-- branch/org approvers. Status changes only via decide_leave_request()/
-- cancel_leave_request() (both security definer) — no update policy here.
create policy leave_requests_select on leave_requests for select
  using (
    requester_id = auth.uid()
    or filed_by_id = auth.uid()
    or my_role() = 'admin'
    or (branch_id = my_branch_id() and has_min_access('leave.approve.branch', 'branch'))
    or has_min_access('leave.approve.org', 'org')
  );
create policy leave_requests_insert on leave_requests for insert
  with check (
    filed_by_id = auth.uid()
    and (
      (requester_id = auth.uid() and has_min_access('leave.request.own', 'own'))
      or has_min_access('leave.request.on_behalf', 'branch')
    )
  );

-- role_permissions: admin-only, both read and write (the /admin/permissions
-- matrix screen). has_min_access() itself is security definer so ordinary
-- authorization checks elsewhere don't need direct table access.
create policy role_permissions_admin_all on role_permissions for all
  using (my_role() = 'admin') with check (my_role() = 'admin');
