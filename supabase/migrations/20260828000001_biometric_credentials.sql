-- Central credential storage, per-device sync state, and the device command
-- queue that makes remote management possible.
--
-- WHY THIS REVERSES AN EARLIER DECISION
--
-- 20260820000008_face_enrollment.sql states, deliberately, that this system does
-- not hold biometric templates — the camera holds them and returns only a
-- matched id. That was the right call for the camera-based model it described.
--
-- It does not survive contact with the requirement that followed: enrol a person
-- once and have their credential work on every reader in the estate. A terminal
-- cannot be handed "a matched id"; it needs the template itself. Replication is
-- therefore impossible without holding one.
--
-- The position is now: we hold templates, and we carry the obligations that
-- come with that, visibly and in the schema rather than in a process document.
--
--   * They are sealed with AES-256-GCM by the gateway BEFORE they reach
--     Postgres (gateway/src/cloud/crypto.ts). A database dump is ciphertext.
--   * The key lives only in the gateway environment. Nothing in this database,
--     and no database role, can decrypt a template.
--   * Consent is a row with a timestamp and a version, and is NOT NULL on the
--     credential — there is no path to a stored template without one.
--   * Revocation is a state with a real deletion path, not a flag.
--   * The plaintext is never exposed to the browser: `authenticated` cannot
--     select the ciphertext column at all, only the summary view.
--
-- The organisational obligations under Kenya's Data Protection Act 2019 —
-- explicit consent, a DPIA, ODPC registration — are not something a migration
-- can discharge. This schema supports them; it does not satisfy them.

-- ============================================================
-- 1. CONSENT
-- ============================================================
-- Generalised from face_enrollments so one record covers every credential type
-- a person gives us. That file's own consent columns stay where they are; this
-- is the forward path, and face enrolments created from here reference it.

create table public.biometric_consents (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,

  -- What was agreed to, and to which wording. Version matters: a consent given
  -- against a superseded notice is evidence of nothing.
  consent_version text not null,
  consented_at    timestamptz not null default now(),
  -- Who recorded it. Null for self-service.
  recorded_by_id  uuid references public.profiles(id) on delete set null,
  method          text not null default 'in_person'
                    check (method in ('in_person', 'self_service', 'imported')),

  withdrawn_at    timestamptz,
  withdrawn_by_id uuid references public.profiles(id) on delete set null,

  created_at      timestamptz not null default now()
);
comment on table public.biometric_consents is
  'Consent to hold and replicate biometric credentials. A credential cannot exist without one.';

-- One live consent per person. Withdrawn rows are retained: they are the
-- evidence a data-subject request needs.
create unique index biometric_consents_one_live
  on public.biometric_consents (profile_id) where withdrawn_at is null;
create index biometric_consents_profile_idx on public.biometric_consents (profile_id);

-- ============================================================
-- 2. CREDENTIALS
-- ============================================================

create type credential_type as enum ('fingerprint', 'face', 'card', 'password');
create type credential_capture as enum ('device', 'photo', 'imported');

create table public.biometric_credentials (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  consent_id      uuid not null references public.biometric_consents(id) on delete restrict,

  credential_type credential_type not null,
  -- The device's own slot number: finger index, or the model's card / password
  -- / face slot. Vendor terminology is "backupnum".
  backup_num      integer not null default 0 check (backup_num >= 0),

  -- Template algorithm as reported by the device at registration. Replication
  -- is ONLY valid between devices reporting the same value; a mismatch is
  -- surfaced to the operator, never silently skipped.
  fp_algo         text,

  -- AES-256-GCM, sealed by the gateway. base64( iv | tag | ciphertext ).
  -- Never readable by `authenticated` — see the grants below.
  template_sealed text not null,
  -- Which key sealed it, so a rotation can re-seal in the background while both
  -- generations stay readable. A key id, never key material.
  template_key_id text not null,

  captured_via    credential_capture not null,
  captured_on_device_id uuid references public.biometric_devices(id) on delete set null,
  captured_at     timestamptz not null default now(),

  revoked_at      timestamptz,
  revoked_by_id   uuid references public.profiles(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.biometric_credentials is
  'Biometric templates, sealed by the gateway before insert. The decryption key is not in this database.';
comment on column public.biometric_credentials.template_sealed is
  'AES-256-GCM ciphertext. Opening it requires BIOMETRIC_TEMPLATE_KEY from the gateway environment.';

-- One live credential per person per slot. Revoked rows are kept as the record
-- of what was held and when it was destroyed.
create unique index biometric_credentials_one_live
  on public.biometric_credentials (profile_id, credential_type, backup_num)
  where revoked_at is null;
create index biometric_credentials_profile_idx on public.biometric_credentials (profile_id);
create index biometric_credentials_live_idx
  on public.biometric_credentials (credential_type, fp_algo) where revoked_at is null;

create trigger biometric_credentials_touch_updated_at before update
  on public.biometric_credentials
  for each row execute function public.touch_updated_at();

-- What the UI is allowed to see: everything except the template itself.
create view public.biometric_credential_summary
with (security_invoker = true) as
  select id, profile_id, consent_id, credential_type, backup_num, fp_algo,
         captured_via, captured_on_device_id, captured_at,
         revoked_at, revoked_by_id, created_at, updated_at,
         length(template_sealed) as sealed_bytes
    from public.biometric_credentials;
comment on view public.biometric_credential_summary is
  'Credentials without the ciphertext. The only credential surface the app reads.';

-- ============================================================
-- 3. WHAT IS ACTUALLY ON EACH DEVICE
-- ============================================================
-- Holding a template is not the same as a reader knowing it. This table is the
-- difference, and it is what makes replication resumable after any failure:
-- the desired state is the credential, the observed state is here.

create type credential_sync_state as enum ('pending', 'synced', 'failed', 'removed', 'unsupported');

create table public.device_credential_state (
  device_id     uuid not null references public.biometric_devices(id) on delete cascade,
  credential_id uuid not null references public.biometric_credentials(id) on delete cascade,

  state         credential_sync_state not null default 'pending',
  -- 'unsupported' carries the reason here: almost always an fp_algo mismatch,
  -- which no amount of retrying will fix and which the operator must see.
  last_error    text,
  attempts      integer not null default 0,
  synced_at     timestamptz,
  updated_at    timestamptz not null default now(),

  primary key (device_id, credential_id)
);
comment on table public.device_credential_state is
  'Observed state of each credential on each reader. Desired state lives in biometric_credentials.';
create index device_credential_state_pending_idx
  on public.device_credential_state (device_id, state) where state in ('pending', 'failed');

create trigger device_credential_state_touch_updated_at before update
  on public.device_credential_state
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 4. THE COMMAND QUEUE
-- ============================================================
-- How the app talks to a terminal.
--
-- Deliberately a table rather than an HTTP control API on the gateway. The
-- gateway polls this; the app only writes rows. That means no new public
-- endpoint on the VPS, no second shared secret to distribute and rotate, and
-- commands still queue correctly when the app cannot reach the gateway at all.
-- The cost is a couple of seconds of latency on an enrolment click.

create type device_command_status as enum ('queued', 'sent', 'succeeded', 'failed', 'expired');

create table public.device_commands (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid references public.biometric_devices(id) on delete cascade,
  -- Denormalised on purpose: the gateway keys sessions by serial and must not
  -- need a join to dispatch, nor break if a device row is renamed.
  serial_no     text not null,

  command       text not null,
  payload       jsonb not null default '{}'::jsonb,

  status        device_command_status not null default 'queued',
  result        jsonb,
  error         text,
  attempts      integer not null default 0,

  -- Provenance. Every command that touches a door or a credential is an
  -- auditable act by a named person.
  requested_by_id uuid references public.profiles(id) on delete set null,
  reason          text,

  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  completed_at  timestamptz,
  -- A command nobody claimed is worse than no command: "open the door" landing
  -- an hour late is a security event. Everything expires.
  expires_at    timestamptz not null default now() + interval '15 minutes'
);
comment on table public.device_commands is
  'Outbound device commands. The gateway polls for queued rows and writes results back.';
create index device_commands_dispatch_idx
  on public.device_commands (serial_no, created_at) where status = 'queued';
create index device_commands_device_idx on public.device_commands (device_id, created_at desc);

-- ============================================================
-- 5. DEVICE INVENTORY FROM REGISTRATION
-- ============================================================
-- The cloud handshake hands us model, firmware, template algorithm and capacity
-- for free. Storing it turns "is that reader full?" from a site visit into a
-- query.

alter table public.biometric_devices
  add column if not exists firmware           text,
  add column if not exists fp_algo            text,
  add column if not exists capacity           jsonb,
  add column if not exists cloud_connected_at timestamptz,
  -- Which family this device speaks. Drives which actions the UI may offer:
  -- an "enrol face from photo" button on a device that cannot do it is worse
  -- than no button.
  add column if not exists protocol           text;

comment on column public.biometric_devices.fp_algo is
  'Template algorithm reported at registration. Credentials only replicate between matching values.';
comment on column public.biometric_devices.protocol is
  'Device family: fkweb | cloud | sbxpc | fcardio | zkteco | cams. Determines available capabilities.';

-- ============================================================
-- 6. GRANTS
-- ============================================================
-- The rule: the app can see that a credential exists and where it has reached.
-- It can never see the template, and no database role can decrypt one.

alter table public.biometric_consents        enable row level security;
alter table public.biometric_credentials     enable row level security;
alter table public.device_credential_state   enable row level security;
alter table public.device_commands           enable row level security;

revoke all on table public.biometric_consents      from anon, authenticated;
revoke all on table public.biometric_credentials   from anon, authenticated;
revoke all on table public.device_credential_state from anon, authenticated;
revoke all on table public.device_commands         from anon, authenticated;

grant select on table public.biometric_consents        to authenticated;
grant select on table public.device_credential_state   to authenticated;
grant select on table public.device_commands           to authenticated;
grant select on public.biometric_credential_summary    to authenticated;

-- Note what is absent: no grant of any kind on biometric_credentials to
-- authenticated. Not even SELECT. The summary view is the whole surface.
grant select, insert, update on table public.biometric_credentials   to service_role;
grant select, insert, update on table public.biometric_consents      to service_role;
grant select, insert, update, delete on table public.device_credential_state to service_role;
grant select, insert, update on table public.device_commands         to service_role;

create policy biometric_consents_read on public.biometric_consents for select to authenticated
  using (
    profile_id = auth.uid()
    or public.my_role() = 'admin'
    or public.has_min_access('admin.devices', 'full')
  );

create policy device_credential_state_read on public.device_credential_state for select to authenticated
  using (public.my_role() = 'admin' or public.has_min_access('admin.devices', 'full'));

create policy device_commands_read on public.device_commands for select to authenticated
  using (public.my_role() = 'admin' or public.has_min_access('admin.devices', 'full'));

-- ============================================================
-- 7. GATEWAY RPCs
-- ============================================================

-- Registration inventory. Called on every cloud handshake, so it is an upsert
-- of facts rather than a create.
create or replace function public.gateway_register_device(
  p_serial text, p_model text, p_firmware text, p_fp_algo text, p_capacity jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.biometric_devices
     set model              = coalesce(p_model, model),
         firmware           = coalesce(p_firmware, firmware),
         fp_algo            = coalesce(p_fp_algo, fp_algo),
         capacity           = coalesce(p_capacity, capacity),
         protocol           = 'cloud',
         cloud_connected_at = now(),
         last_seen_at       = now(),
         updated_at         = now()
   where serial_no = p_serial;
  -- Deliberately no insert. An unknown serial is rejected at the gateway's
  -- allowlist; auto-creating device rows here would reintroduce exactly the
  -- self-enrolment hole that check exists to close.
end $$;

revoke all on function public.gateway_register_device(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.gateway_register_device(text, text, text, text, jsonb)
  to service_role;

-- Claim queued commands for dispatch.
--
-- p_serials is the set of devices currently CONNECTED to the calling gateway.
-- Claiming only those is the whole point: a command for an offline reader stays
-- queued and goes out the moment it dials back in, which is exactly the
-- behaviour someone enrolling a new hire expects. Claiming it and failing it
-- would throw the work away for no reason.
--
-- FOR UPDATE SKIP LOCKED so two gateway instances — during a rolling restart,
-- say — cannot both send the same "open door".
create or replace function public.gateway_claim_commands(
  p_serials text[], p_limit integer default 20
) returns setof public.device_commands
language plpgsql security definer set search_path = public as $$
begin
  -- Expire stale work first, including for devices that never came back. A
  -- command nobody claimed is worse than no command: "open the door" landing an
  -- hour late is a security event.
  update public.device_commands
     set status = 'expired', completed_at = now(),
         error = 'expired before the device was reachable'
   where status = 'queued' and expires_at < now();

  if p_serials is null or array_length(p_serials, 1) is null then
    return;
  end if;

  return query
  with claimed as (
    select id from public.device_commands
     where status = 'queued'
       and expires_at >= now()
       and serial_no = any(p_serials)
     order by created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.device_commands c
     set status = 'sent', sent_at = now(), attempts = c.attempts + 1
    from claimed
   where c.id = claimed.id
  returning c.*;
end $$;

revoke all on function public.gateway_claim_commands(text[], integer)
  from public, anon, authenticated;
grant execute on function public.gateway_claim_commands(text[], integer) to service_role;

create or replace function public.gateway_complete_command(
  p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.device_commands
     set status = case when p_ok then 'succeeded'::device_command_status
                       else 'failed'::device_command_status end,
         result = p_result, error = p_error, completed_at = now()
   where id = p_id;
end $$;

revoke all on function public.gateway_complete_command(uuid, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.gateway_complete_command(uuid, boolean, jsonb, text)
  to service_role;

-- Store a credential captured on a device, and mark it present there.
--
-- One transaction: a credential row without its device state would look
-- unsynced everywhere including the reader that just captured it, and would be
-- pointlessly re-pushed to that reader on the next reconciliation.
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

  -- The enrolment number → person mapping already exists and is the join every
  -- punch uses; reuse it rather than inventing a second one.
  select profile_id into v_profile_id
    from public.biometric_enrollments
   where device_user_id = p_external_user_id
   order by updated_at desc
   limit 1;

  -- Unmapped enrolment id: the capture is real but we do not know whose it is.
  -- Returning null lets the gateway log it for triage instead of guessing, and
  -- guessing here would attach someone's fingerprint to the wrong person.
  if v_profile_id is null then
    return null;
  end if;

  select id into v_consent_id
    from public.biometric_consents
   where profile_id = v_profile_id and withdrawn_at is null
   limit 1;

  -- No consent, no stored template. Enforced here as well as by the NOT NULL,
  -- because this is the path a device can trigger on its own.
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

  return v_id;
end $$;

revoke all on function public.gateway_store_captured_credential(
  text, text, integer, credential_type, text, text, text, credential_capture
) from public, anon, authenticated;
grant execute on function public.gateway_store_captured_credential(
  text, text, integer, credential_type, text, text, text, credential_capture
) to service_role;

-- ============================================================
-- 8. APP RPC — queue a command
-- ============================================================
-- The app's only write path into the queue, so authorisation and provenance are
-- checked in one place rather than in every caller.

create or replace function public.queue_device_command(
  p_serial text, p_command text, p_payload jsonb default '{}'::jsonb,
  p_reason text default null, p_ttl_seconds integer default 900
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_device_id uuid;
  v_id        uuid;
begin
  if not (public.my_role() = 'admin' or public.has_min_access('admin.devices', 'full')) then
    raise exception 'not authorised to command devices' using errcode = 'insufficient_privilege';
  end if;

  select id into v_device_id from public.biometric_devices where serial_no = p_serial;
  if v_device_id is null then
    raise exception 'unknown device serial %', p_serial using errcode = 'no_data_found';
  end if;

  insert into public.device_commands (
    device_id, serial_no, command, payload, requested_by_id, reason, expires_at
  ) values (
    v_device_id, p_serial, p_command, coalesce(p_payload, '{}'::jsonb), auth.uid(), p_reason,
    now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 86400)))
  ) returning id into v_id;

  return v_id;
end $$;

revoke all on function public.queue_device_command(text, text, jsonb, text, integer)
  from public, anon;
grant execute on function public.queue_device_command(text, text, jsonb, text, integer)
  to authenticated;
