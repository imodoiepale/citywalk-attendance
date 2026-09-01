-- Attendance intelligence — new permission enum values only.
--
-- Deliberately a separate migration from anything that references these
-- values: `alter type ... add value` cannot be referenced until the adding
-- transaction commits (see 20260819000002 for the same reasoning).

alter type app_permission add value if not exists 'admin.shifts';
alter type app_permission add value if not exists 'attendance.delete.branch';
alter type app_permission add value if not exists 'attendance.delete.org';
alter type app_permission add value if not exists 'admin.employees';
