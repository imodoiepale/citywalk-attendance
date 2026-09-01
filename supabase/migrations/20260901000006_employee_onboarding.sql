-- Admin-created employee accounts with a generated temporary password.
--
-- Today there is no admin "create user" form at all — accounts only exist via
-- self-signup. This adds one, using auth.admin.createUser() from the app's
-- service-role client (same client biometric ingest already uses) rather than
-- an email invite: the user decided branch retail staff may not have
-- reliable email access, so the temp password is generated server-side,
-- shown to the admin exactly once, and handed over in person.

-- ============================================================
-- 1. SCHEMA
-- ============================================================
alter table profiles
  add column if not exists must_change_password boolean not null default false;
comment on column profiles.must_change_password is
  'Set on admin-created accounts. Forces a redirect to /set-password on next request until cleared.';

-- ============================================================
-- 2. CONTEXT RPC — expose the flag to the app
-- ============================================================
create or replace function my_context()
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id',                    p.id,
    'email',                 p.email,
    'full_name',             p.full_name,
    'role',                  p.role,
    'job_title',             p.job_title,
    'is_active',             p.is_active,
    'must_change_password',  p.must_change_password,
    'branch_id',             b.id,
    'branch_name',           b.name,
    'branch_code',           b.code,
    'permissions', coalesce(
      (select jsonb_object_agg(rp.permission, rp.access_level)
         from role_permissions rp
        where rp.role = p.role),
      '{}'::jsonb
    )
  )
  from profiles p
  join branches b on b.id = p.branch_id
  where p.id = auth.uid();
$$;

grant execute on function my_context() to authenticated;

-- ============================================================
-- 3. FINISH SETUP RPC
-- ============================================================
-- auth.admin.createUser() runs the same handle_new_auth_user() trigger
-- self-signup uses, which creates the profiles row with role='staff' and no
-- job_title. This is the audited step that sets the rest.
create or replace function admin_finish_employee_setup(
  p_user_id uuid,
  p_role app_role,
  p_job_title text,
  p_must_change_password boolean default true
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not has_min_access('admin.employees', 'full') then
    raise exception 'not authorized';
  end if;

  update profiles
     set role = coalesce(p_role, role),
         job_title = nullif(trim(coalesce(p_job_title, '')), ''),
         must_change_password = coalesce(p_must_change_password, true),
         updated_at = now()
   where id = p_user_id
  returning full_name into v_name;

  if v_name is null then
    raise exception 'profile not found';
  end if;

  perform log_audit('employee.created', 'profile', p_user_id::text,
    format('Onboarded %s as %s', coalesce(v_name, 'a new employee'), p_role),
    null, jsonb_build_object('role', p_role, 'job_title', p_job_title));
end;
$$;

revoke all on function admin_finish_employee_setup(uuid, app_role, text, boolean) from public, anon;
grant execute on function admin_finish_employee_setup(uuid, app_role, text, boolean) to authenticated;

-- ============================================================
-- 4. CLEAR THE FLAG ON PASSWORD CHANGE
-- ============================================================
-- setPasswordAction (app/(auth)/actions.ts) calls auth.updateUser({ password })
-- on the current session, whether that session came from a recovery link or
-- a normal sign-in with the temp password — both are "the current user is
-- proving they control the account" the same way. This RPC is the one extra
-- write that action makes once the password itself is set.
create or replace function clear_must_change_password()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = false, updated_at = now() where id = auth.uid();
end;
$$;

grant execute on function clear_must_change_password() to authenticated;

-- ============================================================
-- 5. DEFAULT PERMISSIONS
-- ============================================================
insert into role_permissions (role, permission, access_level) values
  ('hr_accounts', 'admin.employees', 'none'),
  ('branch_manager', 'admin.employees', 'none')
on conflict (role, permission) do update set access_level = excluded.access_level;

insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
