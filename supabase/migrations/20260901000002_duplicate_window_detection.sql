-- Duplicate detection widens from exact-key collision to a time window, and
-- every occurrence — of either kind — becomes a real, queryable record.
--
-- Today `ingest_biometric_events` relies entirely on `biometric_events.dedupe_key`
-- (device|person|literal-second) having a unique constraint: `on conflict do
-- nothing` silently drops an exact repeat and only increments an in-memory
-- counter that is returned to the gateway and never persisted. A retry that
-- lands on a *different* literal second — which is the common case, not the
-- exception, since the terminal's own clock and network jitter both move the
-- scanned_at — sails straight through as a second real punch.
--
-- Two distinct situations, both worth recording, are NOT the same shape:
--   - exact_key: dedupe_key collided, so the unique constraint refused a
--     second biometric_events row. Nothing else on disk proves this retry
--     happened at all except this log.
--   - window: dedupe_key differs (distinct literal second), so a REAL second
--     biometric_events row is inserted, status='duplicate' — never punched,
--     but permanently visible like every other scan.

-- ============================================================
-- 1. SETTINGS + SCHEMA
-- ============================================================
alter table app_settings
  add column if not exists duplicate_window_seconds integer not null default 60
    check (duplicate_window_seconds >= 0);
comment on column app_settings.duplicate_window_seconds is
  'Same device+person scans within this many seconds of an earlier one are flagged duplicate rather than punched again.';

alter table biometric_events
  add column if not exists duplicate_of_id uuid references biometric_events(id) on delete set null;
comment on column biometric_events.duplicate_of_id is
  'Set when status=duplicate: the earlier event within the duplicate window that this one repeats.';

create table biometric_event_duplicates (
  id                 uuid primary key default gen_random_uuid(),
  match_kind         text not null check (match_kind in ('exact_key', 'window')),
  device_id          uuid references biometric_devices(id) on delete set null,
  device_serial      text not null,
  external_user_id   text not null,
  profile_id         uuid references profiles(id) on delete set null,
  scanned_at         timestamptz not null,
  dedupe_key         text not null,
  -- The event this one repeats. Always set for 'window' (a real second row
  -- exists); for 'exact_key' this is whatever row already held the dedupe_key.
  original_event_id  uuid references biometric_events(id) on delete set null,
  -- Only 'window' produces a second row — 'exact_key' has nothing to point at,
  -- since the unique constraint is exactly what stopped it existing.
  duplicate_event_id uuid references biometric_events(id) on delete set null,
  gap_seconds        numeric(10,3) not null default 0,
  raw                jsonb,
  received_at        timestamptz not null default now()
);
comment on table biometric_event_duplicates is
  'Every duplicate scan occurrence, of either kind, for admin triage. The only record an exact_key retry ever happened, since dedupe_key''s unique constraint means it never gets its own biometric_events row.';
create index biometric_event_duplicates_device_idx on biometric_event_duplicates (device_id, received_at desc);
create index biometric_event_duplicates_person_idx on biometric_event_duplicates (profile_id, received_at desc);
create index biometric_event_duplicates_recent_idx on biometric_event_duplicates (received_at desc);

alter table biometric_event_duplicates enable row level security;
revoke all on table biometric_event_duplicates from anon, authenticated;
grant select on table biometric_event_duplicates to authenticated;
grant insert, delete on table biometric_event_duplicates to service_role;

create policy biometric_event_duplicates_read on biometric_event_duplicates for select
  using (
    my_role() = 'admin'
    or has_min_access('admin.devices', 'full')
    or has_min_access('report.view.org', 'org')
  );
-- No insert/update/delete policy for `authenticated` — the ingest RPC
-- (service_role) is the only writer; deletes go through admin_delete_duplicate_event
-- in a later migration, which is itself security definer.

-- ============================================================
-- 2. INGEST — windowed duplicate detection
-- ============================================================
create or replace function public.ingest_biometric_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event        jsonb;
  v_device       public.biometric_devices%rowtype;
  v_profile_id   uuid;
  v_direction    public.device_direction;
  v_status       public.biometric_event_status;
  v_error        text;
  v_event_id     uuid;
  v_scanned_at   timestamptz;
  v_punch        record;
  v_dup_window_seconds integer;
  v_dup_original_id    uuid;
  v_dup_original_at    timestamptz;
  v_gap_seconds        numeric;
  v_result       jsonb := jsonb_build_object(
    'received', 0,
    'processed', 0,
    'duplicates', 0,
    'flagged_duplicates', 0,
    'unmatched', 0,
    'ignored', 0,
    'errors', 0
  );
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  select duplicate_window_seconds into v_dup_window_seconds
    from public.app_settings where id = true;
  v_dup_window_seconds := coalesce(v_dup_window_seconds, 60);

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_result := jsonb_set(
      v_result,
      '{received}',
      to_jsonb((v_result->>'received')::integer + 1)
    );

    v_profile_id := null;
    v_event_id := null;
    v_error := null;
    v_dup_original_id := null;
    v_dup_original_at := null;

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

      -- Widened duplicate check: only for a scan that would otherwise become
      -- a real punch. A device retry landing on a different literal second
      -- has a distinct dedupe_key, so it is NOT caught by the unique
      -- constraint below — this is what catches it instead.
      if v_status = 'processed' then
        select id, scanned_at into v_dup_original_id, v_dup_original_at
          from public.biometric_events
         where device_serial = v_event->>'deviceSerial'
           and external_user_id = v_event->>'externalUserId'
           and status <> 'duplicate'
           and scanned_at <> v_scanned_at
           and abs(extract(epoch from (scanned_at - v_scanned_at))) <= v_dup_window_seconds
         order by abs(extract(epoch from (scanned_at - v_scanned_at))) asc
         limit 1;

        if v_dup_original_id is not null then
          v_status := 'duplicate';
          v_gap_seconds := abs(extract(epoch from (v_scanned_at - v_dup_original_at)));
        end if;
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
        duplicate_of_id,
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
        v_dup_original_id,
        v_error
      )
      on conflict (dedupe_key) do nothing
      returning id into v_event_id;

      if v_event_id is null then
        -- Exact-key collision: the ONLY record this retry ever happened is
        -- the one we write here, since the row itself was refused.
        v_result := jsonb_set(
          v_result,
          '{duplicates}',
          to_jsonb((v_result->>'duplicates')::integer + 1)
        );

        insert into public.biometric_event_duplicates (
          match_kind, device_id, device_serial, external_user_id, profile_id,
          scanned_at, dedupe_key, original_event_id, duplicate_event_id, gap_seconds, raw
        )
        select 'exact_key', v_device.id, v_event->>'deviceSerial', v_event->>'externalUserId',
               v_profile_id, v_scanned_at, v_event->>'dedupeKey', be.id, null, 0, v_event->'raw'
          from public.biometric_events be
         where be.dedupe_key = v_event->>'dedupeKey';

        continue;
      end if;

      if v_status = 'duplicate' then
        v_result := jsonb_set(
          v_result,
          '{flagged_duplicates}',
          to_jsonb((v_result->>'flagged_duplicates')::integer + 1)
        );

        insert into public.biometric_event_duplicates (
          match_kind, device_id, device_serial, external_user_id, profile_id,
          scanned_at, dedupe_key, original_event_id, duplicate_event_id, gap_seconds, raw
        ) values (
          'window', v_device.id, v_event->>'deviceSerial', v_event->>'externalUserId',
          v_profile_id, v_scanned_at, v_event->>'dedupeKey', v_dup_original_id, v_event_id,
          coalesce(v_gap_seconds, 0), v_event->'raw'
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
  'Atomic vendor-aware biometric ingest shared by the VPS gateway and the signed app webhook. Duplicate scans (exact dedupe_key collision, or same device+person within duplicate_window_seconds) are recorded in biometric_event_duplicates and never punched twice.';

revoke all on function public.ingest_biometric_events(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_biometric_events(jsonb) to service_role;

-- ============================================================
-- 3. SETTINGS RPC — one new parameter
-- ============================================================
-- Signature changes (a new parameter), so the old 5-arg version must be
-- dropped explicitly — `create or replace` with a different argument list
-- creates a second, orphaned overload rather than replacing it.
drop function if exists admin_update_settings(numeric, numeric, numeric, integer, numeric);

create or replace function admin_update_settings(
  p_daily_target_hours numeric,
  p_weekly_target_hours numeric,
  p_approaching_threshold_hours numeric,
  p_grace_period_minutes integer,
  p_max_shift_hours numeric,
  p_duplicate_window_seconds integer default 60
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
        duplicate_window_seconds = coalesce(p_duplicate_window_seconds, duplicate_window_seconds),
        updated_by_id = auth.uid(),
        updated_at = now()
    where id = true;

  perform log_audit('settings.updated', 'app_settings', 'singleton',
    format('Daily target %sh, weekly %sh, duplicate window %ss', p_daily_target_hours,
           p_weekly_target_hours, p_duplicate_window_seconds),
    v_before,
    jsonb_build_object('daily_target_hours', p_daily_target_hours,
                       'weekly_target_hours', p_weekly_target_hours,
                       'approaching_threshold_hours', p_approaching_threshold_hours,
                       'grace_period_minutes', p_grace_period_minutes,
                       'max_shift_hours', p_max_shift_hours,
                       'duplicate_window_seconds', p_duplicate_window_seconds));
end;
$$;

-- ============================================================
-- 4. DEFAULT PERMISSIONS
-- ============================================================
insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
