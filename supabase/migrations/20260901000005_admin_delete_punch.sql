-- Admin deletion, audited — the gap docs/RUNBOOK.md names explicitly: today
-- the only way to delete a punch is hand-editing via the Supabase Table
-- Editor, which loses the audit trail entirely.
--
-- Two different things, deliberately not one RPC:
--   - admin_delete_punch: any punch, any reason. Covers "this shouldn't have
--     counted" (a rogue double-clock-in, a mistake).
--   - admin_delete_duplicate_event: ONLY biometric_events rows already
--     flagged 'duplicate'. A real scan that produced a punch stays permanent
--     evidence forever, per the invariant in 20260820000003 ("every scan,
--     forever, never derived from anything and never deleted") — this does
--     not touch that. It only lets an admin clear out rows that never became
--     a punch in the first place.

create or replace function admin_delete_punch(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row  punches%rowtype;
  v_name text;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select * into v_row from punches where id = p_id;
  if v_row.id is null then
    raise exception 'punch not found';
  end if;

  if not (
    has_min_access('attendance.delete.org', 'org')
    or (v_row.branch_id = my_branch_id() and has_min_access('attendance.delete.branch', 'branch'))
  ) then
    raise exception 'not authorized';
  end if;

  select full_name into v_name from profiles where id = v_row.user_id;

  -- Detach dependents rather than cascading: the fact that a scan or a
  -- correction once existed for this punch is itself worth keeping even
  -- after the punch is gone.
  update biometric_events set punch_id = null where punch_id = p_id;
  update punch_corrections set punch_id = null where punch_id = p_id;

  delete from punches where id = p_id;

  perform log_audit('punch.deleted', 'punch', p_id::text,
    format('Deleted a punch for %s (%s -> %s). Reason: %s',
      coalesce(v_name, 'a user'), v_row.clock_in_at,
      coalesce(v_row.clock_out_at::text, 'open'), p_reason),
    to_jsonb(v_row), jsonb_build_object('reason', p_reason));
end;
$$;
comment on function admin_delete_punch(uuid, text) is
  'Deletes a punch outright. Requires attendance.delete.org or .branch (matching the punch''s branch) and a reason, both recorded in audit_log with the full before-image.';

create or replace function admin_delete_duplicate_event(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row biometric_events%rowtype;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select * into v_row from biometric_events where id = p_id;
  if v_row.id is null then
    raise exception 'event not found';
  end if;
  if v_row.status <> 'duplicate' then
    raise exception 'only duplicate-flagged scans can be deleted here — a scan that produced a punch is permanent evidence';
  end if;

  if not (has_min_access('attendance.delete.org', 'org') or has_min_access('admin.devices', 'full')) then
    raise exception 'not authorized';
  end if;

  delete from biometric_event_duplicates where duplicate_event_id = p_id;
  delete from biometric_events where id = p_id;

  perform log_audit('biometric_event.deleted', 'biometric_event', p_id::text,
    format('Deleted a duplicate scan from %s. Reason: %s', v_row.device_serial, p_reason),
    to_jsonb(v_row), jsonb_build_object('reason', p_reason));
end;
$$;
comment on function admin_delete_duplicate_event(uuid, text) is
  'Deletes a raw scan ONLY when status=duplicate — a scan that produced a punch can never be deleted this way, preserving the "every real scan is permanent" invariant.';

revoke all on function admin_delete_punch(uuid, text) from public, anon;
grant execute on function admin_delete_punch(uuid, text) to authenticated;
revoke all on function admin_delete_duplicate_event(uuid, text) from public, anon;
grant execute on function admin_delete_duplicate_event(uuid, text) to authenticated;
