-- Who did what, and what changed.
--
-- Several privileged actions currently record no actor at all — admin_set_permission
-- writes only updated_at, so there is no way to tell who granted a permission.
-- Branch, device and enrollment changes are equally anonymous.
--
-- Two shape decisions come from facts about this system rather than from a
-- generic audit template:
--
--  1. `actor_id` is NULLABLE and paired with `source`. apply_biometric_punch
--     runs from device ingest with no auth.uid(), so a uniform actor-based
--     trigger would record NULL for every biometric punch and read as a broken
--     log rather than as a machine action.
--  2. The actor's name, email and role are DENORMALISED. Migration
--     ...0004_audit_fk_on_delete deliberately nulls decided_by_id when a profile
--     is deleted, so a pointer alone loses the actor at exactly the moment
--     history matters most.

create type audit_source as enum ('user', 'device', 'system');

create table audit_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  source       audit_source not null default 'user',
  -- set null, not cascade: deleting someone must not erase the record that they
  -- once granted an admin role.
  actor_id     uuid references profiles(id) on delete set null,
  actor_name   text,
  actor_email  text,
  actor_role   text,
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  summary      text not null,
  before       jsonb,
  after        jsonb
);
comment on table audit_log is
  'Append-only record of privileged actions. Actor identity is denormalised so history survives the actor being deleted.';

-- The screen reads newest-first, filtered by entity type or actor.
create index audit_log_occurred_idx on audit_log (occurred_at desc);
create index audit_log_entity_idx on audit_log (entity_type, occurred_at desc);
create index audit_log_actor_idx on audit_log (actor_id, occurred_at desc);

-- ============================================================
-- WRITER
-- ============================================================
-- Resolves the caller once and snapshots their identity. security definer so it
-- can read profiles and write audit_log regardless of the caller's own rights —
-- an action someone is allowed to take must always be recordable.
create or replace function log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text,
  p_summary     text,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_source      audit_source default 'user'
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := auth.uid();
  v_name  text;
  v_email text;
  v_role  text;
begin
  if v_id is not null then
    select full_name, email, role::text into v_name, v_email, v_role
      from profiles where id = v_id;
  end if;

  insert into audit_log (source, actor_id, actor_name, actor_email, actor_role,
                         action, entity_type, entity_id, summary, before, after)
  values (
    -- A write with no session is a machine, not an anonymous person.
    case when v_id is null and p_source = 'user' then 'system' else p_source end,
    v_id, v_name, v_email, v_role,
    p_action, p_entity_type, p_entity_id, p_summary, p_before, p_after
  );
end;
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table audit_log enable row level security;

-- Readable by admins and anyone explicitly granted admin.users; deliberately
-- not by branch managers. An audit trail names who did what to whom and is a
-- governance surface, not an operational one.
create policy audit_log_read on audit_log for select
  using (my_role() = 'admin' or has_min_access('admin.users', 'full'));

-- No insert/update/delete policy at all. Writes happen only through
-- log_audit(), which is security definer. Append-only is the point: an audit
-- log that its subjects can edit is not evidence of anything.

-- ============================================================
-- INSTRUMENT THE PRIVILEGED RPCS
-- ============================================================
-- These are already the single choke point for privileged writes, so adding a
-- log_audit() call to each closes the gap without a trigger on every table.

create or replace function admin_set_role(p_user_id uuid, p_new_role app_role)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before app_role; v_name text;
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;

  select role, full_name into v_before, v_name from profiles where id = p_user_id;

  if p_new_role <> 'admin'
     and exists (select 1 from profiles where id = p_user_id and role = 'admin' and is_active)
     and (select count(*) from profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'That is the only active admin. Promote another admin first.'
      using errcode = 'P0001';
  end if;

  update profiles set role = p_new_role, updated_at = now() where id = p_user_id;

  perform log_audit('role.changed', 'profile', p_user_id::text,
    format('Changed %s from %s to %s', coalesce(v_name, 'a user'), v_before, p_new_role),
    jsonb_build_object('role', v_before), jsonb_build_object('role', p_new_role));
end;
$$;

create or replace function admin_set_active(p_user_id uuid, p_is_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before boolean; v_name text;
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;

  if p_user_id = auth.uid() and p_is_active = false then
    raise exception 'You cannot deactivate your own account. Ask another admin.'
      using errcode = 'P0001';
  end if;

  if p_is_active = false
     and exists (select 1 from profiles where id = p_user_id and role = 'admin' and is_active)
     and (select count(*) from profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'That is the only active admin. Promote another admin first.'
      using errcode = 'P0001';
  end if;

  select is_active, full_name into v_before, v_name from profiles where id = p_user_id;
  update profiles set is_active = p_is_active, updated_at = now() where id = p_user_id;

  perform log_audit(
    case when p_is_active then 'user.activated' else 'user.deactivated' end,
    'profile', p_user_id::text,
    format('%s %s', case when p_is_active then 'Reactivated' else 'Deactivated' end,
           coalesce(v_name, 'a user')),
    jsonb_build_object('is_active', v_before), jsonb_build_object('is_active', p_is_active));
end;
$$;

create or replace function admin_set_permission(
  p_role app_role, p_permission app_permission, p_access_level access_level
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before access_level;
begin
  if not has_min_access('admin.permissions', 'full') then
    raise exception 'not authorized';
  end if;

  select access_level into v_before from role_permissions
   where role = p_role and permission = p_permission;

  insert into role_permissions (role, permission, access_level, updated_at)
  values (p_role, p_permission, p_access_level, now())
  on conflict (role, permission) do update
    set access_level = excluded.access_level, updated_at = now();

  -- The gap this migration exists to close: role_permissions carries only
  -- updated_at, so before now a permission grant had no author.
  perform log_audit('permission.changed', 'role_permission',
    format('%s/%s', p_role, p_permission),
    format('Set %s on %s to %s (was %s)', p_permission, p_role, p_access_level,
           coalesce(v_before::text, 'none')),
    jsonb_build_object('access_level', v_before),
    jsonb_build_object('access_level', p_access_level));
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
declare v_before jsonb;
begin
  if not has_min_access('admin.settings', 'full') then
    raise exception 'not authorized';
  end if;

  select to_jsonb(s) - 'updated_at' - 'updated_by_id' into v_before
    from app_settings s where id = true;

  update app_settings
    set daily_target_hours = p_daily_target_hours,
        weekly_target_hours = p_weekly_target_hours,
        approaching_threshold_hours = p_approaching_threshold_hours,
        grace_period_minutes = p_grace_period_minutes,
        max_shift_hours = p_max_shift_hours,
        updated_by_id = auth.uid(),
        updated_at = now()
    where id = true;

  perform log_audit('settings.updated', 'app_settings', 'singleton',
    format('Daily target %sh, weekly %sh', p_daily_target_hours, p_weekly_target_hours),
    v_before,
    jsonb_build_object('daily_target_hours', p_daily_target_hours,
                       'weekly_target_hours', p_weekly_target_hours,
                       'approaching_threshold_hours', p_approaching_threshold_hours,
                       'grace_period_minutes', p_grace_period_minutes,
                       'max_shift_hours', p_max_shift_hours));
end;
$$;

create or replace function admin_update_profile(
  p_user_id uuid, p_full_name text, p_job_title text, p_branch_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not has_min_access('admin.users', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'name is required';
  end if;

  select jsonb_build_object('full_name', full_name, 'job_title', job_title, 'branch_id', branch_id)
    into v_before from profiles where id = p_user_id;

  update profiles
    set full_name = trim(p_full_name),
        job_title = nullif(trim(coalesce(p_job_title, '')), ''),
        branch_id = coalesce(p_branch_id, branch_id),
        updated_at = now()
    where id = p_user_id;

  perform log_audit('profile.updated', 'profile', p_user_id::text,
    format('Updated %s', trim(p_full_name)), v_before,
    jsonb_build_object('full_name', trim(p_full_name), 'job_title', p_job_title,
                       'branch_id', p_branch_id));
end;
$$;

create or replace function admin_map_enrollment(
  p_device_user_id text, p_profile_id uuid,
  p_vendor text default 'zkteco', p_note text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_pending integer; v_name text;
begin
  if not has_min_access('admin.devices', 'full') then
    raise exception 'not authorized';
  end if;

  insert into biometric_enrollments (vendor, device_user_id, profile_id, note)
  values (coalesce(p_vendor, 'zkteco'), p_device_user_id, p_profile_id, p_note)
  on conflict (vendor, device_user_id)
    do update set profile_id = excluded.profile_id, note = excluded.note, updated_at = now();

  select count(*) into v_pending
    from biometric_events
   where external_user_id = p_device_user_id and status = 'unmatched';

  select full_name into v_name from profiles where id = p_profile_id;

  -- Worth auditing loudly: this decides whose attendance a scan becomes.
  perform log_audit('enrollment.mapped', 'biometric_enrollment', p_device_user_id,
    format('Mapped enrollment %s to %s (%s pending scans)', p_device_user_id,
           coalesce(v_name, 'a user'), v_pending),
    null, jsonb_build_object('device_user_id', p_device_user_id, 'profile_id', p_profile_id));

  return v_pending;
end;
$$;
