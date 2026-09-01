-- Shift windows, per branch and/or role, and never-blocking enforcement.
--
-- Nothing like this existed before: apply_biometric_punch is a pure
-- open/closed toggle with zero time-of-day awareness, and the PRD lists
-- shift scheduling as unbuilt roadmap. This adds it without touching
-- apply_biometric_punch, request_punch_correction, or decide_punch_correction
-- at all: a single BEFORE INSERT OR UPDATE trigger on `punches` recomputes
-- the labels no matter which of those three wrote the row, so none of their
-- signatures change.
--
-- Punches are NEVER blocked by this. A punch outside its window is recorded
-- exactly as it would have been before this migration — only labelled.

-- ============================================================
-- 1. SCHEMA
-- ============================================================
create type shift_punch_flag as enum ('on_time', 'early', 'late', 'out_of_window');

-- Scoped by branch and/or role — never a single global policy, per the
-- decision this was built to. At least one of branch_id/role is required;
-- both null is still possible (an explicit org-wide fallback), just never
-- the silent default.
create table shift_templates (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  branch_id              uuid references branches(id) on delete cascade,
  role                   app_role,
  clock_in_window_start  time not null,
  clock_in_window_end    time not null,
  clock_out_window_start time not null,
  clock_out_window_end   time not null,
  grace_minutes          integer not null default 0 check (grace_minutes >= 0),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint shift_templates_window_order check (clock_out_window_end > clock_in_window_start)
);
comment on table shift_templates is
  'Expected clock-in/out windows. Never blocks a punch — only labels it via compute_shift_flags().';
create index shift_templates_scope_idx on shift_templates (branch_id, role) where is_active;

-- Explicit per-person assignment, overriding whatever branch/role default
-- would otherwise apply.
create table shift_assignments (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles(id) on delete cascade,
  shift_template_id uuid not null references shift_templates(id) on delete restrict,
  effective_from    date not null default current_date,
  effective_to      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint shift_assignments_date_order check (effective_to is null or effective_to >= effective_from)
);
comment on table shift_assignments is
  'Per-person shift override. resolve_shift_window() prefers the row covering the punch date, if any.';
create unique index shift_assignments_one_open_per_person
  on shift_assignments (profile_id) where effective_to is null;
create index shift_assignments_profile_idx on shift_assignments (profile_id, effective_from desc);

create trigger shift_templates_touch_updated_at before update on shift_templates
  for each row execute function touch_updated_at();
create trigger shift_assignments_touch_updated_at before update on shift_assignments
  for each row execute function touch_updated_at();

alter table punches
  add column if not exists shift_template_id   uuid references shift_templates(id) on delete set null,
  add column if not exists shift_assignment_id uuid references shift_assignments(id) on delete set null,
  add column if not exists clock_in_flag       shift_punch_flag,
  add column if not exists clock_out_flag      shift_punch_flag,
  add column if not exists overtime_minutes    integer not null default 0 check (overtime_minutes >= 0);
comment on column punches.overtime_minutes is
  'Minutes past (shift clock-out window end + grace), rounded up. 0 when no shift applies or the punch is still open.';

-- ============================================================
-- 2. RESOLUTION + LABELLING
-- ============================================================

create or replace function resolve_shift_window(p_profile_id uuid, p_date date)
returns shift_templates
language plpgsql security definer set search_path = public stable as $$
declare
  v_branch_id uuid;
  v_role      app_role;
  v_template  shift_templates%rowtype;
begin
  select branch_id, role into v_branch_id, v_role from profiles where id = p_profile_id;

  -- 1. An explicit assignment covering this date always wins.
  select st.* into v_template
    from shift_assignments sa
    join shift_templates st on st.id = sa.shift_template_id
   where sa.profile_id = p_profile_id and st.is_active
     and sa.effective_from <= p_date and (sa.effective_to is null or sa.effective_to >= p_date)
   order by sa.effective_from desc
   limit 1;
  if v_template.id is not null then
    return v_template;
  end if;

  -- 2. Otherwise the most specific branch/role default: branch+role beats
  -- branch-only or role-only, which beat the org-wide (both null) fallback.
  select st.* into v_template
    from shift_templates st
   where st.is_active
     and (st.branch_id is null or st.branch_id = v_branch_id)
     and (st.role is null or st.role = v_role)
   order by
     (st.branch_id is not null and st.role is not null) desc,
     (st.branch_id is not null) desc,
     (st.role is not null) desc,
     st.updated_at desc
   limit 1;

  return v_template; -- .id is null when nobody has configured anything at all
end;
$$;
comment on function resolve_shift_window(uuid, date) is
  'The shift window that applies to a person on a given date: explicit assignment first, then the most specific matching branch/role template.';

create or replace function compute_shift_flags()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_template  shift_templates%rowtype;
  v_date      date := (NEW.clock_in_at at time zone 'Africa/Nairobi')::date;
  v_in_start  timestamptz;
  v_in_end    timestamptz;
  v_out_start timestamptz;
  v_out_end   timestamptz;
  -- Beyond grace_minutes but within this, a punch is late/early; beyond this
  -- it's out_of_window. Deliberately generous — a punch a few hours off is a
  -- shift swap or an odd day, not evidence of anything.
  v_out_of_window_minutes constant integer := 180;
begin
  select * into v_template from resolve_shift_window(NEW.user_id, v_date);

  if v_template.id is null then
    NEW.shift_template_id := null;
    NEW.shift_assignment_id := null;
    NEW.clock_in_flag := null;
    NEW.clock_out_flag := null;
    NEW.overtime_minutes := 0;
    return NEW;
  end if;

  NEW.shift_template_id := v_template.id;
  select sa.id into NEW.shift_assignment_id
    from shift_assignments sa
   where sa.profile_id = NEW.user_id and sa.shift_template_id = v_template.id
     and sa.effective_from <= v_date and (sa.effective_to is null or sa.effective_to >= v_date)
   order by sa.effective_from desc
   limit 1;

  v_in_start  := (v_date + v_template.clock_in_window_start)  at time zone 'Africa/Nairobi';
  v_in_end    := (v_date + v_template.clock_in_window_end)    at time zone 'Africa/Nairobi';
  v_out_start := (v_date + v_template.clock_out_window_start) at time zone 'Africa/Nairobi';
  v_out_end   := (v_date + v_template.clock_out_window_end)   at time zone 'Africa/Nairobi';

  NEW.clock_in_flag :=
    case
      when NEW.clock_in_at < v_in_start - make_interval(mins => v_template.grace_minutes + v_out_of_window_minutes) then 'out_of_window'
      when NEW.clock_in_at < v_in_start - make_interval(mins => v_template.grace_minutes) then 'early'
      when NEW.clock_in_at > v_in_end   + make_interval(mins => v_template.grace_minutes + v_out_of_window_minutes) then 'out_of_window'
      when NEW.clock_in_at > v_in_end   + make_interval(mins => v_template.grace_minutes) then 'late'
      else 'on_time'
    end;

  if NEW.clock_out_at is null then
    NEW.clock_out_flag := null;
    NEW.overtime_minutes := 0;
  else
    NEW.clock_out_flag :=
      case
        when NEW.clock_out_at > v_out_end   + make_interval(mins => v_template.grace_minutes + v_out_of_window_minutes) then 'out_of_window'
        when NEW.clock_out_at > v_out_end   + make_interval(mins => v_template.grace_minutes) then 'late'
        when NEW.clock_out_at < v_out_start - make_interval(mins => v_template.grace_minutes) then 'early'
        else 'on_time'
      end;
    -- Overtime rounds UP to the next whole minute, floored at zero.
    NEW.overtime_minutes := greatest(0, ceil(extract(epoch from
      (NEW.clock_out_at - (v_out_end + make_interval(mins => v_template.grace_minutes)))) / 60))::integer;
  end if;

  return NEW;
end;
$$;
comment on function compute_shift_flags() is
  'Labels a punch against its resolved shift window. Never blocks — always returns NEW so the punch is written regardless of the flag.';

create trigger punches_compute_shift_flags
  before insert or update of clock_in_at, clock_out_at, user_id on punches
  for each row execute function compute_shift_flags();

-- ============================================================
-- 3. ADMIN RPCS (admin.shifts, full — admin-only for now)
-- ============================================================

create or replace function admin_upsert_shift_template(
  p_id uuid,
  p_name text,
  p_branch_id uuid,
  p_role app_role,
  p_clock_in_window_start time,
  p_clock_in_window_end time,
  p_clock_out_window_start time,
  p_clock_out_window_end time,
  p_grace_minutes integer,
  p_is_active boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not has_min_access('admin.shifts', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required';
  end if;
  if p_branch_id is null and p_role is null then
    raise exception 'a shift template needs a branch, a role, or both';
  end if;
  if p_clock_out_window_end <= p_clock_in_window_start then
    raise exception 'clock-out window must end after clock-in window starts';
  end if;

  insert into shift_templates as t (
    id, name, branch_id, role, clock_in_window_start, clock_in_window_end,
    clock_out_window_start, clock_out_window_end, grace_minutes, is_active
  ) values (
    coalesce(p_id, gen_random_uuid()), trim(p_name), p_branch_id, p_role,
    p_clock_in_window_start, p_clock_in_window_end,
    p_clock_out_window_start, p_clock_out_window_end,
    coalesce(p_grace_minutes, 0), coalesce(p_is_active, true)
  )
  on conflict (id) do update set
    name = excluded.name,
    branch_id = excluded.branch_id,
    role = excluded.role,
    clock_in_window_start = excluded.clock_in_window_start,
    clock_in_window_end = excluded.clock_in_window_end,
    clock_out_window_start = excluded.clock_out_window_start,
    clock_out_window_end = excluded.clock_out_window_end,
    grace_minutes = excluded.grace_minutes,
    is_active = excluded.is_active,
    updated_at = now()
  returning t.id into v_id;

  perform log_audit('shift_template.saved', 'shift_template', v_id::text,
    format('Saved shift "%s"', trim(p_name)), null,
    jsonb_build_object('branch_id', p_branch_id, 'role', p_role));

  return v_id;
end;
$$;

create or replace function admin_assign_shift(
  p_profile_id uuid,
  p_shift_template_id uuid,
  p_effective_from date default current_date
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_name text;
begin
  if not has_min_access('admin.shifts', 'full') then
    raise exception 'not authorized';
  end if;

  -- Close any currently-open assignment the day before the new one starts,
  -- so there is never more than one open-ended row per person.
  update shift_assignments
     set effective_to = p_effective_from - 1, updated_at = now()
   where profile_id = p_profile_id and effective_to is null
     and effective_from < p_effective_from;

  insert into shift_assignments (profile_id, shift_template_id, effective_from)
  values (p_profile_id, p_shift_template_id, coalesce(p_effective_from, current_date))
  returning id into v_id;

  select full_name into v_name from profiles where id = p_profile_id;
  perform log_audit('shift_assignment.created', 'shift_assignment', v_id::text,
    format('Assigned a shift to %s', coalesce(v_name, 'a user')), null,
    jsonb_build_object('profile_id', p_profile_id, 'shift_template_id', p_shift_template_id));

  return v_id;
end;
$$;

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
alter table shift_templates enable row level security;
alter table shift_assignments enable row level security;

create policy shift_templates_read on shift_templates for select
  using (
    my_role() = 'admin'
    or has_min_access('admin.shifts', 'full')
    or has_min_access('report.view.org', 'org')
    or (branch_id = my_branch_id() and has_min_access('report.view.branch', 'branch'))
  );

create policy shift_assignments_read on shift_assignments for select
  using (
    profile_id = auth.uid()
    or my_role() = 'admin'
    or has_min_access('admin.shifts', 'full')
    or has_min_access('report.view.org', 'org')
  );
-- No insert/update/delete policy on either — writes only via the two RPCs
-- above, matching every other admin table in this schema.

-- ============================================================
-- 5. DEFAULT PERMISSIONS
-- ============================================================
insert into role_permissions (role, permission, access_level) values
  ('hr_accounts', 'admin.shifts', 'none'),
  ('branch_manager', 'admin.shifts', 'none')
on conflict (role, permission) do update set access_level = excluded.access_level;

insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
