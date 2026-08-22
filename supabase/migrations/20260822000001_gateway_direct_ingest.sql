-- Durable biometric gateway ingest.
--
-- The VPS writes normalized scans through one RPC and diagnostic payloads to a
-- separate archive. The Next.js fallback webhook calls the same RPC, so device
-- matching and punch rules have one implementation.

-- ============================================================
-- 1. SANITIZED RAW PAYLOAD ARCHIVE
-- ============================================================
create table public.device_raw_payloads (
  id                 bigint generated always as identity primary key,
  device_serial      text,
  device_id          uuid references public.biometric_devices(id) on delete set null,
  transport          text not null,
  method             text,
  path               text,
  query              jsonb,
  headers            jsonb,
  -- The gateway redacts known tokens, passwords, photos, and template data
  -- before either representation is sent here.
  body_text          text,
  body_base64        text,
  bytes              integer not null default 0 check (bytes >= 0),
  parsed_event_count integer not null default 0 check (parsed_event_count >= 0),
  vendor             text,
  source_ip          text,
  received_at        timestamptz not null,
  payload_key        text not null unique,
  stored_at          timestamptz not null default now()
);

create index device_raw_payloads_serial_idx
  on public.device_raw_payloads (device_serial, received_at desc);
create index device_raw_payloads_recent_idx
  on public.device_raw_payloads (received_at desc);
create index device_raw_payloads_unparsed_idx
  on public.device_raw_payloads (received_at desc)
  where parsed_event_count = 0;

comment on table public.device_raw_payloads is
  'Sanitized diagnostic archive of terminal payloads. Known credentials and biometric template data are redacted by the gateway before insert.';

alter table public.device_raw_payloads enable row level security;
revoke all on table public.device_raw_payloads from anon, authenticated;
grant select on table public.device_raw_payloads to authenticated;
grant insert on table public.device_raw_payloads to service_role;
grant usage, select on sequence public.device_raw_payloads_id_seq to service_role;

create policy device_raw_payloads_read
  on public.device_raw_payloads for select
  to authenticated
  using (
    public.my_role() = 'admin'
    or public.has_min_access('admin.devices', 'full')
  );

-- ============================================================
-- 2. ATOMIC BATCH INGEST
-- ============================================================
create or replace function public.ingest_biometric_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event      jsonb;
  v_device     public.biometric_devices%rowtype;
  v_profile_id uuid;
  v_direction  public.device_direction;
  v_status     public.biometric_event_status;
  v_error      text;
  v_event_id   uuid;
  v_scanned_at timestamptz;
  v_punch      record;
  v_result     jsonb := jsonb_build_object(
    'received', 0,
    'processed', 0,
    'duplicates', 0,
    'unmatched', 0,
    'ignored', 0,
    'errors', 0
  );
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_result := jsonb_set(
      v_result,
      '{received}',
      to_jsonb((v_result->>'received')::integer + 1)
    );

    v_profile_id := null;
    v_event_id := null;
    v_error := null;

    -- A malformed row is counted as an error without rolling back good scans
    -- beside it in the same offline-recovery batch.
    begin
      if coalesce(v_event->>'deviceSerial', '') = ''
         or coalesce(v_event->>'externalUserId', '') = ''
         or coalesce(v_event->>'scannedAt', '') = ''
         or coalesce(v_event->>'dedupeKey', '') = '' then
        raise exception 'event is missing a required field';
      end if;

      v_scanned_at := (v_event->>'scannedAt')::timestamptz;

      select * into v_device
        from public.biometric_devices
       where serial_no = v_event->>'deviceSerial';

      -- Enrollment numbers are fleet-wide only within a vendor. Without this
      -- predicate user 7 on an EBKN reader could resolve to user 7 on ZKTeco.
      if v_device.id is not null then
        select profile_id into v_profile_id
          from public.biometric_enrollments
         where vendor = v_device.vendor
           and device_user_id = v_event->>'externalUserId';
      end if;

      v_direction := coalesce(
        nullif(v_event->>'direction', '')::public.device_direction,
        v_device.direction,
        'both'::public.device_direction
      );

      if v_device.id is null then
        v_status := 'unmatched';
        v_error := 'unknown device serial';
      elsif not v_device.is_active then
        v_status := 'ignored';
        v_error := 'device is disabled';
      elsif v_device.purpose = 'access' then
        v_status := 'ignored';
        v_error := 'access-control device; not an attendance clock';
      elsif v_profile_id is null then
        v_status := 'unmatched';
        v_error := 'no enrollment for this vendor and device user id';
      else
        v_status := 'processed';
      end if;

      insert into public.biometric_events (
        device_id,
        device_serial,
        external_user_id,
        scanned_at,
        direction,
        raw,
        dedupe_key,
        status,
        profile_id,
        error
      ) values (
        v_device.id,
        v_event->>'deviceSerial',
        v_event->>'externalUserId',
        v_scanned_at,
        nullif(v_event->>'direction', '')::public.device_direction,
        v_event->'raw',
        v_event->>'dedupeKey',
        case
          when v_status = 'processed' then 'unmatched'::public.biometric_event_status
          else v_status
        end,
        v_profile_id,
        v_error
      )
      on conflict (dedupe_key) do nothing
      returning id into v_event_id;

      if v_event_id is null then
        v_result := jsonb_set(
          v_result,
          '{duplicates}',
          to_jsonb((v_result->>'duplicates')::integer + 1)
        );
        continue;
      end if;

      if v_status = 'ignored' then
        v_result := jsonb_set(v_result, '{ignored}', to_jsonb((v_result->>'ignored')::integer + 1));
        continue;
      end if;

      if v_status = 'unmatched' then
        v_result := jsonb_set(v_result, '{unmatched}', to_jsonb((v_result->>'unmatched')::integer + 1));
        continue;
      end if;

      select * into v_punch
        from public.apply_biometric_punch(v_profile_id, v_direction, v_scanned_at);

      update public.biometric_events
         set status = 'processed',
             profile_id = v_profile_id,
             punch_id = v_punch.punch_id,
             processed_at = now(),
             error = case
               when v_punch.action in ('opened', 'closed') then null
               else v_punch.action
             end
       where id = v_event_id;

      v_result := jsonb_set(v_result, '{processed}', to_jsonb((v_result->>'processed')::integer + 1));
    exception when others then
      if v_event_id is not null then
        update public.biometric_events
           set status = 'error', error = sqlerrm, processed_at = now()
         where id = v_event_id;
      end if;
      v_result := jsonb_set(v_result, '{errors}', to_jsonb((v_result->>'errors')::integer + 1));
    end;
  end loop;

  update public.biometric_devices
     set last_seen_at = now(), last_event_at = now()
   where serial_no in (
     select distinct event->>'deviceSerial'
       from jsonb_array_elements(p_events) as rows(event)
      where coalesce(event->>'deviceSerial', '') <> ''
   );

  return v_result;
end;
$$;

comment on function public.ingest_biometric_events(jsonb) is
  'Atomic vendor-aware biometric ingest shared by the VPS gateway and the signed app webhook.';

revoke all on function public.ingest_biometric_events(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_biometric_events(jsonb) to service_role;

-- ============================================================
-- 3. DEVICE ADMINISTRATION WITH AN EXPLICIT VENDOR
-- ============================================================
create or replace function public.admin_upsert_device_v2(
  p_id uuid,
  p_serial_no text,
  p_name text,
  p_branch_id uuid,
  p_purpose public.device_purpose,
  p_direction public.device_direction,
  p_location_label text,
  p_model text,
  p_ip_address text,
  p_port integer,
  p_node_id integer,
  p_is_active boolean,
  p_vendor text default 'zkteco'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_min_access('admin.devices', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_serial_no), '') = ''
     or coalesce(trim(p_name), '') = ''
     or coalesce(trim(p_vendor), '') = '' then
    raise exception 'serial number, name, and vendor are required';
  end if;
  if p_purpose = 'attendance' and p_branch_id is null then
    raise exception 'an attendance device must be assigned to a branch';
  end if;

  insert into public.biometric_devices as d (
    id, serial_no, name, vendor, branch_id, purpose, direction,
    location_label, model, ip_address, port, node_id, is_active
  ) values (
    coalesce(p_id, gen_random_uuid()),
    upper(trim(p_serial_no)),
    trim(p_name),
    lower(trim(p_vendor)),
    p_branch_id,
    coalesce(p_purpose, 'attendance'),
    coalesce(p_direction, 'both'),
    nullif(trim(coalesce(p_location_label, '')), ''),
    nullif(trim(coalesce(p_model, '')), ''),
    nullif(trim(coalesce(p_ip_address, '')), '')::inet,
    coalesce(p_port, 4370),
    p_node_id,
    coalesce(p_is_active, true)
  )
  on conflict (serial_no) do update set
    name = excluded.name,
    vendor = excluded.vendor,
    branch_id = excluded.branch_id,
    purpose = excluded.purpose,
    direction = excluded.direction,
    location_label = excluded.location_label,
    model = excluded.model,
    ip_address = excluded.ip_address,
    port = excluded.port,
    node_id = excluded.node_id,
    is_active = excluded.is_active,
    updated_at = now()
  returning d.id into v_id;

  perform public.log_audit(
    'device.updated',
    'biometric_device',
    v_id::text,
    format('Saved biometric device %s (%s)', upper(trim(p_serial_no)), lower(trim(p_vendor))),
    null,
    jsonb_build_object('serial_no', upper(trim(p_serial_no)), 'vendor', lower(trim(p_vendor)))
  );

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_device_v2(
  uuid, text, text, uuid, public.device_purpose, public.device_direction,
  text, text, text, integer, integer, boolean, text
) from public, anon;
grant execute on function public.admin_upsert_device_v2(
  uuid, text, text, uuid, public.device_purpose, public.device_direction,
  text, text, text, integer, integer, boolean, text
) to authenticated;

-- Rebuild the health view as security-invoker and expose the protocol fields
-- the edit form needs. Dropping is required because PostgreSQL only permits new
-- CREATE OR REPLACE VIEW columns at the end.
drop view if exists public.biometric_device_health;
create view public.biometric_device_health
with (security_invoker = true)
as
select
  d.id,
  d.serial_no,
  d.name,
  d.model,
  d.purpose,
  d.direction,
  d.is_active,
  d.branch_id,
  b.name as branch_name,
  d.location_label,
  d.ip_address,
  d.last_seen_at,
  d.last_event_at,
  (select count(*)
     from public.biometric_events e
    where e.device_id = d.id
      and e.scanned_at > now() - interval '24 hours') as events_24h,
  case
    when not d.is_active then 'disabled'
    when d.last_seen_at is null then 'never_seen'
    when d.last_seen_at > now() - interval '15 minutes' then 'online'
    when d.last_seen_at > now() - interval '24 hours' then 'stale'
    else 'offline'
  end as health,
  d.vendor,
  d.node_id,
  d.port
from public.biometric_devices d
left join public.branches b on b.id = d.branch_id;

comment on view public.biometric_device_health is
  'RLS-respecting device health with protocol vendor, node id, and port for administration.';
revoke all on table public.biometric_device_health from anon;
grant select on table public.biometric_device_health to authenticated;
