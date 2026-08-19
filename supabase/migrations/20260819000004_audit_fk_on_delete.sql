-- Audit pointers must not block deleting a user.
--
-- `decided_by_id` / `updated_by_id` record *who* made a decision. They were
-- created with the default NO ACTION, so deleting a profile that had ever
-- approved leave, decided a punch correction, or saved org settings failed with
-- a foreign-key violation — from code paths (a GDPR erasure, removing a test
-- account) that have no obvious connection to those tables.
--
-- SET NULL rather than CASCADE: the decision itself is the record worth
-- keeping. Losing an approved leave request because the approver left the
-- company would be far worse than losing the approver's name from it. Every
-- reader of these columns already treats them as nullable.
--
-- Deactivating a user (is_active = false) remains the normal path and is
-- unaffected either way; this is about genuine deletion.

alter table leave_requests
  drop constraint if exists leave_requests_decided_by_id_fkey,
  add constraint leave_requests_decided_by_id_fkey
    foreign key (decided_by_id) references profiles(id) on delete set null;

alter table punch_corrections
  drop constraint if exists punch_corrections_decided_by_id_fkey,
  add constraint punch_corrections_decided_by_id_fkey
    foreign key (decided_by_id) references profiles(id) on delete set null;

alter table app_settings
  drop constraint if exists app_settings_updated_by_id_fkey,
  add constraint app_settings_updated_by_id_fkey
    foreign key (updated_by_id) references profiles(id) on delete set null;
