-- Biometric estate: devices, enrollments, raw scan log.
--
-- Modelled on the real fleet: 36 ZKTeco TFT500P readers on port 4370, one or
-- two per site, each with a serial number and an IN / OUT / IN-OUT designation.
--
-- Two facts from that fleet drive the shape here:
--
--  1. Not every reader is an attendance clock. Some guard restricted rooms
--     (server room, camera room, cargo office). A scan at one of those is an
--     access event and must NOT become a punch, or everyone who walks past the
--     server room gets clocked in. Hence `purpose`.
--  2. Device names do not correspond to branch names ("SHOEBIZ Hilton",
--     "Millionaires", "Brand Sarit"), and one branch can own two readers
--     ("HQ IN" / "HQ OUT"). So `branch_id` is nullable and assigned by a human,
--     never inferred at ingest time.

create type device_purpose as enum ('attendance', 'access');
create type device_direction as enum ('in', 'out', 'both');
create type biometric_event_status as enum ('processed', 'unmatched', 'ignored', 'error', 'duplicate');

-- ============================================================
-- 1. DEVICES
-- ============================================================
create table biometric_devices (
  id             uuid primary key default gen_random_uuid(),
  -- The only stable identity. Names get edited, IPs get reassigned by DHCP,
  -- node ids are per-installation. The serial is printed on the unit.
  serial_no      text not null unique,
  node_id        integer,
  name           text not null,
  model          text,
  vendor         text not null default 'zkteco',
  -- Nullable: an unrecognised device must still be able to report in and be
  -- triaged later, rather than being rejected at the door.
  branch_id      uuid references branches(id),
  purpose        device_purpose not null default 'attendance',
  direction      device_direction not null default 'both',
  -- Free text for readers that guard a place rather than a branch —
  -- "Server room", "Camera room". Shown instead of the branch when set.
  location_label text,
  ip_address     inet,
  port           integer not null default 4370,
  -- Per-device shared secret. Ingest is the one unauthenticated surface in the
  -- app, so every payload has to prove which device it came from.
  ingest_secret  text,
  is_active      boolean not null default true,
  -- Health. last_seen_at is any contact at all (including heartbeats);
  -- last_event_at is the last actual scan. A device that is reachable but has
  -- recorded nothing all day is a different problem from one that is offline.
  last_seen_at   timestamptz,
  last_event_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table biometric_devices is
  'Physical readers. purpose=access means scans are logged but never create punches.';
create index biometric_devices_branch_idx on biometric_devices (branch_id);
create index biometric_devices_active_idx on biometric_devices (is_active, name);

-- ============================================================
-- 2. ENROLLMENTS
-- ============================================================
-- A reader knows a person only as a number. This is the join to a real account.
create table biometric_enrollments (
  id             uuid primary key default gen_random_uuid(),
  vendor         text not null default 'zkteco',
  device_user_id text not null,
  profile_id     uuid not null references profiles(id) on delete cascade,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One enrollment number means one person, fleet-wide. Staff move between
  -- branches and keep their number, so this is deliberately not per-device.
  constraint biometric_enrollments_unique unique (vendor, device_user_id)
);
create index biometric_enrollments_profile_idx on biometric_enrollments (profile_id);

-- ============================================================
-- 3. RAW EVENTS
-- ============================================================
-- Every scan, forever, whether or not it resolved. Punches are derived from
-- these; these are never derived from anything and are never deleted. When an
-- enrollment is added later, the unmatched rows here are what gets replayed.
create table biometric_events (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid references biometric_devices(id) on delete set null,
  -- Kept as text alongside device_id so an event from an unknown serial is
  -- still recorded rather than rejected.
  device_serial    text not null,
  external_user_id text not null,
  scanned_at       timestamptz not null,
  direction        device_direction,
  raw              jsonb,
  -- Idempotency. A reader that buffers through a network outage replays its
  -- whole queue on reconnect; without this that becomes duplicate punches.
  dedupe_key       text not null unique,
  status           biometric_event_status not null default 'unmatched',
  profile_id       uuid references profiles(id) on delete set null,
  punch_id         uuid references punches(id) on delete set null,
  error            text,
  processed_at     timestamptz,
  received_at      timestamptz not null default now()
);
create index biometric_events_status_idx on biometric_events (status, received_at desc);
create index biometric_events_unmatched_idx
  on biometric_events (external_user_id) where status = 'unmatched';
create index biometric_events_device_idx on biometric_events (device_id, scanned_at desc);

create trigger biometric_devices_touch_updated_at before update on biometric_devices
  for each row execute function touch_updated_at();
create trigger biometric_enrollments_touch_updated_at before update on biometric_enrollments
  for each row execute function touch_updated_at();

-- ============================================================
-- 4. HEALTH VIEW
-- ============================================================
-- One row per device with a derived status, so the admin screen does not
-- reimplement the thresholds and they stay consistent everywhere.
create or replace view biometric_device_health as
select
  d.id,
  d.serial_no,
  d.name,
  d.model,
  d.purpose,
  d.direction,
  d.is_active,
  d.branch_id,
  b.name  as branch_name,
  d.location_label,
  d.ip_address,
  d.last_seen_at,
  d.last_event_at,
  (select count(*) from biometric_events e
    where e.device_id = d.id and e.scanned_at > now() - interval '24 hours') as events_24h,
  case
    when not d.is_active                                      then 'disabled'
    when d.last_seen_at is null                               then 'never_seen'
    when d.last_seen_at > now() - interval '15 minutes'       then 'online'
    when d.last_seen_at > now() - interval '24 hours'         then 'stale'
    else 'offline'
  end as health
from biometric_devices d
left join branches b on b.id = d.branch_id;

comment on view biometric_device_health is
  'Devices with a derived health bucket. online = seen in the last 15 minutes, stale = within a day, offline = longer, never_seen = has never reported in.';

-- ============================================================
-- 5. RPCS
-- ============================================================

-- Assign an enrollment number to a person. Returns how many previously
-- unmatched events became eligible for replay, so the UI can say so.
create or replace function admin_map_enrollment(
  p_device_user_id text,
  p_profile_id uuid,
  p_vendor text default 'zkteco',
  p_note text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_pending integer;
begin
  if not has_min_access('admin.devices', 'full') then
    raise exception 'not authorized';
  end if;

  insert into biometric_enrollments (vendor, device_user_id, profile_id, note)
  values (coalesce(p_vendor, 'zkteco'), p_device_user_id, p_profile_id, p_note)
  on conflict (vendor, device_user_id)
    do update set profile_id = excluded.profile_id,
                  note = excluded.note,
                  updated_at = now();

  select count(*) into v_pending
    from biometric_events
   where external_user_id = p_device_user_id and status = 'unmatched';

  return v_pending;
end;
$$;

create or replace function admin_upsert_device(
  p_id uuid,
  p_serial_no text,
  p_name text,
  p_branch_id uuid,
  p_purpose device_purpose,
  p_direction device_direction,
  p_location_label text,
  p_model text,
  p_ip_address text,
  p_port integer,
  p_node_id integer,
  p_is_active boolean
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not has_min_access('admin.devices', 'full') then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_serial_no), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'serial number and name are required';
  end if;
  -- An attendance clock must belong to a branch or its punches have no branch
  -- to report under. An access reader legitimately has none.
  if p_purpose = 'attendance' and p_branch_id is null then
    raise exception 'an attendance device must be assigned to a branch';
  end if;

  insert into biometric_devices as d
    (id, serial_no, name, branch_id, purpose, direction, location_label,
     model, ip_address, port, node_id, is_active)
  values
    (coalesce(p_id, gen_random_uuid()), upper(trim(p_serial_no)), trim(p_name), p_branch_id,
     coalesce(p_purpose, 'attendance'), coalesce(p_direction, 'both'),
     nullif(trim(coalesce(p_location_label, '')), ''), nullif(trim(coalesce(p_model, '')), ''),
     nullif(trim(coalesce(p_ip_address, '')), '')::inet, coalesce(p_port, 4370),
     p_node_id, coalesce(p_is_active, true))
  on conflict (serial_no) do update set
    name = excluded.name,
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

  return v_id;
end;
$$;

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================
alter table biometric_devices enable row level security;
alter table biometric_enrollments enable row level security;
alter table biometric_events enable row level security;

-- Devices and the health view are readable by anyone who can view reports —
-- a branch manager should be able to see their own reader is offline.
create policy biometric_devices_read on biometric_devices for select
  using (
    my_role() = 'admin'
    or has_min_access('admin.devices', 'full')
    or has_min_access('report.view.org', 'org')
    or (branch_id = my_branch_id() and has_min_access('report.view.branch', 'branch'))
  );

-- Enrollments and raw scans are person-level data: who was where, when.
-- Restricted to device admins and org-wide reporting, plus your own rows.
create policy biometric_enrollments_read on biometric_enrollments for select
  using (
    profile_id = auth.uid()
    or my_role() = 'admin'
    or has_min_access('admin.devices', 'full')
    or has_min_access('report.view.org', 'org')
  );

create policy biometric_events_read on biometric_events for select
  using (
    profile_id = auth.uid()
    or my_role() = 'admin'
    or has_min_access('admin.devices', 'full')
    or has_min_access('report.view.org', 'org')
  );

-- No insert/update/delete policies anywhere: writes happen only through the
-- ingest route (service role) and the RPCs above.

-- ============================================================
-- 7. DEFAULT PERMISSIONS
-- ============================================================
-- Device administration is admin-only by default. Mapping an enrollment number
-- to a person decides whose attendance a scan becomes, so it is not delegated
-- until someone deliberately grants it at /admin/permissions.
insert into role_permissions (role, permission, access_level) values
  ('hr_accounts', 'admin.devices', 'none'),
  ('branch_manager', 'admin.devices', 'none')
on conflict (role, permission) do update set access_level = excluded.access_level;

insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
