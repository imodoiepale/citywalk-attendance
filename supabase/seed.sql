-- Citywalk Attendance — seed data. Idempotent (on conflict do nothing),
-- safe to re-run.

-- ============================================================
-- 1. BRANCHES
-- ============================================================
insert into branches (code, name, brand, town) values
  ('HQ',  'Fortis Headquarters', 'HQ',             'Nairobi'),
  ('CBR', 'City Brandz',         'City Brandz',    'Nairobi'),
  ('CSF', 'City Safari',         'City Safari',    'Nairobi'),
  ('CFR', 'City Fragrance',      'City Fragrance', 'Nairobi'),
  ('CWK', 'Citywalk',            'Citywalk',       'Nairobi')
on conflict (code) do nothing;

-- ============================================================
-- 2. ROLE PERMISSIONS MATRIX
-- ============================================================

-- staff: manage their own punches and leave only.
insert into role_permissions (role, permission, access_level) values
  ('staff', 'punch.view.own',   'own'),
  ('staff', 'leave.request.own','own'),
  ('staff', 'leave.cancel.own', 'own')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- branch_manager: staff rights, plus filing/approving leave and viewing
-- reports for their own branch.
insert into role_permissions (role, permission, access_level) values
  ('branch_manager', 'punch.view.own',        'own'),
  ('branch_manager', 'leave.request.own',     'own'),
  ('branch_manager', 'leave.cancel.own',      'own'),
  ('branch_manager', 'leave.request.on_behalf','branch'),
  ('branch_manager', 'leave.approve.branch',  'branch'),
  ('branch_manager', 'report.view.branch',    'branch')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- hr_accounts: the same rights as a branch manager, but organisation-wide.
insert into role_permissions (role, permission, access_level) values
  ('hr_accounts', 'punch.view.own',         'own'),
  ('hr_accounts', 'leave.request.own',      'own'),
  ('hr_accounts', 'leave.cancel.own',       'own'),
  ('hr_accounts', 'leave.request.on_behalf','org'),
  ('hr_accounts', 'leave.approve.org',      'org'),
  ('hr_accounts', 'report.view.org',        'org')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- admin: full on everything. has_min_access() already hardcodes this
-- bypass, but seeding explicit 'full' rows keeps the /admin/permissions
-- matrix screen from showing a confusing, misleadingly-empty admin row.
insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
