-- Face recognition enrolment.
--
-- The model, per Citywalk: staff upload their own photo with consent, it is
-- enrolled to the internally-owned cameras, and the cameras return a matched
-- person ID. That ID flows into the existing biometric_enrollments mapping and
-- the existing ingest pipeline unchanged.
--
-- What this system deliberately does NOT hold: face templates. The camera
-- computes and stores those. We keep the source photo and a consent record, and
-- nothing else. A face photo is still biometric personal data under Kenya's
-- Data Protection Act 2019, so the obligations are modelled here rather than
-- left to process:
--
--   * consent is a stored row with a timestamp and a version, and enrolment is
--     impossible without one — enforced by a NOT NULL, not by a checkbox;
--   * revocation is a real state with a real deletion path, not a flag;
--   * every enrolment and revocation writes an audit entry.

create type face_enrollment_status as enum ('pending', 'enrolled', 'failed', 'revoked');

create table face_enrollments (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,

  -- Object key in the private storage bucket. Null once purged, which is how a
  -- revoked row proves the photo is actually gone rather than merely hidden.
  storage_path   text,

  -- Consent. NOT NULL: there is no path to a row here without it.
  consented_at   timestamptz not null default now(),
  consent_version text not null,

  status         face_enrollment_status not null default 'pending',
  -- The camera's own identifier for this person, returned on enrolment. This is
  -- what arrives on a scan and what joins back to biometric_enrollments.
  camera_ref     text,
  enrolled_at    timestamptz,
  failure_reason text,

  revoked_at     timestamptz,
  revoked_by_id  uuid references profiles(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table face_enrollments is
  'Face enrolment source photos and consent records. Templates are never stored here — the camera holds them and returns only a matched person id.';

-- One live enrolment per person; revoked rows are kept as the consent and
-- deletion record, which is the evidence a data subject request needs.
create unique index face_enrollments_one_live
  on face_enrollments (profile_id) where revoked_at is null;
create index face_enrollments_status_idx on face_enrollments (status);

create trigger face_enrollments_touch_updated_at before update on face_enrollments
  for each row execute function touch_updated_at();

-- ============================================================
-- SETTINGS
-- ============================================================
alter table app_settings
  add column if not exists face_enabled boolean not null default false,
  -- A match below this is not an identification. Clocking the wrong person in
  -- is worse than not clocking anyone in.
  add column if not exists face_min_confidence numeric(4,3) not null default 0.900,
  -- Retention is a commitment, not a preference: photos are purged after this.
  add column if not exists face_retention_days integer not null default 365,
  add column if not exists face_reenroll_days integer not null default 730,
  add column if not exists face_consent_version text not null default 'v1';

-- Separate statement: ADD COLUMN and a table constraint cannot share an ALTER
-- clause list, and ADD CONSTRAINT has no IF NOT EXISTS, so it is guarded.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_settings_face_sane'
  ) then
    alter table app_settings add constraint app_settings_face_sane check (
      face_min_confidence > 0 and face_min_confidence <= 1
      and face_retention_days > 0
      and face_reenroll_days > 0
    );
  end if;
end $$;

-- ============================================================
-- RPCS
-- ============================================================

-- Records consent and the uploaded photo. Called by the owner for themselves.
create or replace function request_face_enrollment(
  p_storage_path text,
  p_consent_version text
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_enabled boolean;
begin
  if not is_active_user() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'a photo is required';
  end if;
  if coalesce(trim(p_consent_version), '') = '' then
    raise exception 'consent is required';
  end if;

  select face_enabled into v_enabled from app_settings where id = true;
  if not coalesce(v_enabled, false) then
    raise exception 'Face recognition is not switched on for this organisation.'
      using errcode = 'P0001';
  end if;

  -- Replacing a photo revokes the previous enrolment rather than overwriting
  -- it: the old consent record is the evidence for what was held and when.
  update face_enrollments
     set revoked_at = now(), revoked_by_id = auth.uid(), status = 'revoked', updated_at = now()
   where profile_id = auth.uid() and revoked_at is null;

  insert into face_enrollments (profile_id, storage_path, consent_version, consented_at, status)
  values (auth.uid(), p_storage_path, trim(p_consent_version), now(), 'pending')
  returning id into v_id;

  perform log_audit('face.enrolment_requested', 'face_enrollment', v_id::text,
    'Uploaded a face photo and recorded consent',
    null, jsonb_build_object('consent_version', p_consent_version, 'status', 'pending'));

  return v_id;
end;
$$;

-- Revocation. The caller may revoke their own; a device admin may revoke
-- anyone's. Clearing storage_path is the app's record that the object itself
-- has been deleted, not merely dereferenced.
create or replace function revoke_face_enrollment(p_profile_id uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_target uuid := coalesce(p_profile_id, auth.uid());
  v_path text;
  v_id uuid;
  v_name text;
begin
  if v_target <> auth.uid() and not has_min_access('admin.devices', 'full') then
    raise exception 'not authorized';
  end if;

  select id, storage_path into v_id, v_path
    from face_enrollments
   where profile_id = v_target and revoked_at is null;

  if v_id is null then
    return null;
  end if;

  update face_enrollments
     set revoked_at = now(), revoked_by_id = auth.uid(),
         status = 'revoked', storage_path = null, updated_at = now()
   where id = v_id;

  select full_name into v_name from profiles where id = v_target;

  perform log_audit('face.revoked', 'face_enrollment', v_id::text,
    format('Revoked the face enrolment for %s', coalesce(v_name, 'a user')),
    jsonb_build_object('status', 'enrolled'), jsonb_build_object('status', 'revoked'));

  -- Returned so the caller can delete the actual object from storage. The row
  -- is already updated, so a failure there is visible as an orphan rather than
  -- silently leaving the record pointing at a live photo.
  return v_path;
end;
$$;

-- Called once a camera confirms it has taken the face and issued an id.
-- Service-role only: the camera integration runs without a user session.
create or replace function confirm_face_enrollment(
  p_enrollment_id uuid,
  p_camera_ref text,
  p_failure_reason text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  select profile_id into v_profile from face_enrollments where id = p_enrollment_id;
  if v_profile is null then
    raise exception 'enrolment not found';
  end if;

  if p_failure_reason is not null then
    update face_enrollments
       set status = 'failed', failure_reason = p_failure_reason, updated_at = now()
     where id = p_enrollment_id;
    perform log_audit('face.enrolment_failed', 'face_enrollment', p_enrollment_id::text,
      format('Camera rejected the photo: %s', p_failure_reason), null, null, 'device');
    return;
  end if;

  update face_enrollments
     set status = 'enrolled', camera_ref = p_camera_ref, enrolled_at = now(), updated_at = now()
   where id = p_enrollment_id;

  -- The camera's id becomes an ordinary enrollment mapping, so a face scan
  -- reaches the punch pipeline by exactly the same route a fingerprint does.
  insert into biometric_enrollments (vendor, device_user_id, profile_id, note)
  values ('face', p_camera_ref, v_profile, 'Auto-created from face enrolment')
  on conflict (vendor, device_user_id) do update
    set profile_id = excluded.profile_id, updated_at = now();

  perform log_audit('face.enrolled', 'face_enrollment', p_enrollment_id::text,
    'Camera accepted the photo and issued an id',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'enrolled', 'camera_ref', p_camera_ref), 'device');
end;
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table face_enrollments enable row level security;

-- Your own record, or a device admin's view of the roster. Deliberately not
-- readable by branch managers: who has a face on file is not operational data.
create policy face_enrollments_read on face_enrollments for select
  using (
    profile_id = auth.uid()
    or my_role() = 'admin'
    or has_min_access('admin.devices', 'full')
  );

-- No write policies: every mutation goes through the RPCs above.
