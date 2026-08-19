-- Phase 2 permissions — enum values only.
--
-- This is deliberately a separate migration from 20260819000003. Postgres
-- allows `alter type ... add value` inside a transaction, but the new value
-- cannot be *referenced* until that transaction commits. Seeding
-- role_permissions rows for these permissions in the same file would fail with
-- "unsafe use of new value of enum type". Splitting the files is the fix.

alter type app_permission add value if not exists 'attendance.correct.branch';
alter type app_permission add value if not exists 'attendance.correct.org';
alter type app_permission add value if not exists 'admin.branches';
alter type app_permission add value if not exists 'admin.settings';
