-- Fleet-wide credential fan-out: once a template is captured on one cloud
-- reader, every other compatible attendance reader gets a pending sync row.

create or replace function public.gateway_store_captured_credential(
  p_serial text, p_external_user_id text, p_backup_num integer,
  p_credential_type credential_type, p_template_sealed text, p_template_key_id text,
  p_fp_algo text, p_captured_via credential_capture
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_device_id  uuid;
  v_profile_id uuid;
  v_id         uuid;
  v_consent_id uuid;
begin
  select id into v_device_id from public.biometric_devices where serial_no = p_serial;

  select profile_id into v_profile_id
    from public.biometric_enrollments
   where device_user_id = p_external_user_id
   order by updated_at desc
   limit 1;
  if v_profile_id is null then
    return null;
  end if;

  select id into v_consent_id
    from public.biometric_consents
   where profile_id = v_profile_id and withdrawn_at is null
   limit 1;
  if v_consent_id is null then
    raise exception 'no live consent for profile % — refusing to store a template', v_profile_id
      using errcode = 'check_violation';
  end if;

  update public.biometric_credentials
     set revoked_at = now()
   where profile_id = v_profile_id
     and credential_type = p_credential_type
     and backup_num = p_backup_num
     and revoked_at is null;

  insert into public.biometric_credentials (
    profile_id, consent_id, credential_type, backup_num, fp_algo,
    template_sealed, template_key_id, captured_via, captured_on_device_id
  ) values (
    v_profile_id, v_consent_id, p_credential_type, p_backup_num, p_fp_algo,
    p_template_sealed, p_template_key_id, p_captured_via, v_device_id
  ) returning id into v_id;

  if v_device_id is not null then
    insert into public.device_credential_state (device_id, credential_id, state, synced_at)
    values (v_device_id, v_id, 'synced', now())
    on conflict (device_id, credential_id)
      do update set state = 'synced', synced_at = now(), last_error = null;
  end if;

  insert into public.device_credential_state (device_id, credential_id, state, last_error)
  select d.id, v_id,
         case
           when p_fp_algo is not null and d.fp_algo is not null and d.fp_algo <> p_fp_algo then 'unsupported'::credential_sync_state
           else 'pending'::credential_sync_state
         end,
         case
           when p_fp_algo is not null and d.fp_algo is not null and d.fp_algo <> p_fp_algo
             then format('fp_algo mismatch: source %s, device %s', p_fp_algo, d.fp_algo)
           else null
         end
    from public.biometric_devices d
   where d.is_active
     and d.purpose = 'attendance'
     and d.protocol = 'cloud'
     and d.id is distinct from v_device_id
  on conflict (device_id, credential_id) do nothing;

  return v_id;
end $$;

create or replace function public.gateway_claim_pending_credentials(
  p_serial text,
  p_limit integer default 25
) returns table (
  credential_id uuid,
  external_user_id text,
  full_name text,
  backup_num integer,
  template_sealed text,
  template_key_id text
)
language plpgsql security definer set search_path = public as $$
declare
  v_device_id uuid;
begin
  select id into v_device_id from public.biometric_devices where serial_no = p_serial;
  if v_device_id is null then
    return;
  end if;

  return query
  with claimable as (
    select dcs.credential_id
      from public.device_credential_state dcs
     where dcs.device_id = v_device_id
       and dcs.state in ('pending', 'failed')
     order by dcs.updated_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  select bc.id, be.device_user_id, p.full_name, bc.backup_num, bc.template_sealed, bc.template_key_id
    from claimable c
    join public.biometric_credentials bc on bc.id = c.credential_id and bc.revoked_at is null
    join public.profiles p on p.id = bc.profile_id
    join lateral (
      select be.device_user_id
        from public.biometric_enrollments be
       where be.profile_id = p.id
       order by be.updated_at desc
       limit 1
    ) be on true;
end $$;

create or replace function public.gateway_update_credential_state(
  p_serial text,
  p_credential_id uuid,
  p_ok boolean,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_device_id uuid;
begin
  select id into v_device_id from public.biometric_devices where serial_no = p_serial;
  if v_device_id is null then
    return;
  end if;

  update public.device_credential_state
     set state = case when p_ok then 'synced'::credential_sync_state else 'failed'::credential_sync_state end,
         synced_at = case when p_ok then now() else synced_at end,
         last_error = case when p_ok then null else p_error end,
         updated_at = now()
   where device_id = v_device_id and credential_id = p_credential_id;
end $$;

revoke all on function public.gateway_claim_pending_credentials(text, integer) from public, anon, authenticated;
grant execute on function public.gateway_claim_pending_credentials(text, integer) to service_role;
revoke all on function public.gateway_update_credential_state(text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.gateway_update_credential_state(text, uuid, boolean, text) to service_role;
