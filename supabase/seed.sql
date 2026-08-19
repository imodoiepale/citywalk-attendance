-- Citywalk Attendance — seed data. Idempotent (on conflict do nothing),
-- safe to re-run.

-- ============================================================
-- 1. BRANCHES
-- ============================================================
-- The canonical 40 points, mirrored from
-- citywalk-delivery-management-system/supabase/seed.sql. The two apps share
-- the branch/sub-brand model, so the DMS is the source of truth for this list
-- and codes must match between them: a code is how a person's branch is
-- recognised across both systems.
--
-- The DMS's delivery-only columns (default_lane, branch_email, is_warehouse)
-- are deliberately not carried over — they mean nothing to attendance.
--
-- Upsert by code rather than "do nothing", so a rename in the DMS propagates
-- on the next run instead of silently drifting.
insert into branches (code, name, brand, town) values
  ('CAP', 'Capital Centre', 'Citywalk', 'Nairobi'),
  ('CHN', 'Chania Mall', 'Citywalk', 'Thika'),
  ('CBR', 'City Brands', 'City Brandz', 'Nairobi'),
  ('CSF', 'City Safari', 'City Safari', 'Nairobi'),
  ('ELD', 'Eldoret', 'Citywalk', 'Eldoret'),
  ('EXP', 'Expression', 'Citywalk', 'Nairobi'),
  ('HOF', 'Fortis - Headquarters', 'Citywalk', 'Nairobi'),
  ('GAL', 'Galleria Mall', 'Citywalk', 'Nairobi'),
  ('GCT', 'Garden City', 'Citywalk', 'Nairobi'),
  ('MER', 'Greenwood Meru', 'Citywalk', 'Meru'),
  ('HAZ', 'Hazina', 'Citywalk', 'Nairobi'),
  ('HIL', 'Hilton', 'Citywalk', 'Nairobi'),
  ('HUB', 'Hub Karen', 'Citywalk', 'Nairobi'),
  ('JCT', 'Junction Mall', 'Citywalk', 'Nairobi'),
  ('KAV', 'Kenyatta Avenue', 'Citywalk', 'Nairobi'),
  ('KMG', 'Kisumu Mega', 'Citywalk', 'Kisumu'),
  ('KUM', 'Kisumu United Mall', 'Citywalk', 'Kisumu'),
  ('LAV', 'Lavington', 'Citywalk', 'Nairobi'),
  ('LIK', 'Likoni', 'Citywalk', 'Mombasa'),
  ('MNG', 'Mama Ngina', 'Citywalk', 'Mombasa'),
  ('MOM', 'Moi Avenue - Mombasa', 'Citywalk', 'Mombasa'),
  ('MFR', 'Mombasa Fragranz', 'City Fragrance', 'Mombasa'),
  ('NMG', 'Nairobi Mega', 'Citywalk', 'Nairobi'),
  ('NVS', 'Naivasha', 'Citywalk', 'Naivasha'),
  ('NKR', 'Nakuru', 'Citywalk', 'Nakuru'),
  ('NYK', 'Nanyuki', 'Citywalk', 'Nanyuki'),
  ('NYA', 'Nyali A', 'Citywalk', 'Mombasa'),
  ('NYB', 'Nyali B', 'Citywalk', 'Mombasa'),
  ('NBZ', 'Nyali Bazaar', 'Citywalk', 'Mombasa'),
  ('ONL', 'Online', 'All', 'Nairobi'),
  ('RUN', 'Runda Mall', 'Citywalk', 'Nairobi'),
  ('RFR', 'Runda Fragranz', 'City Fragrance', 'Nairobi'),
  ('SRT', 'Sarit Centre', 'Citywalk', 'Nairobi'),
  ('TML', 'The Mall', 'Citywalk', 'Nairobi'),
  ('TMF', 'The Mall Fragranz', 'City Fragrance', 'Nairobi'),
  ('TPF', 'T-Mall Fragranz', 'City Fragrance', 'Nairobi'),
  ('VMK', 'Village Market', 'Citywalk', 'Nairobi'),
  ('WHS', 'Warehouse', 'All', 'Nairobi'),
  ('WES', 'Westend', 'Citywalk', 'Kisumu'),
  ('WEP', 'Westend Perfume', 'City Fragrance', 'Kisumu')
on conflict (code) do update set
  name  = excluded.name,
  brand = excluded.brand,
  town  = excluded.town,
  updated_at = now();

-- Anything not in the canonical list is retired rather than deleted: a branch
-- may already be referenced by punches or leave history, and those records must
-- keep resolving. Deactivating hides it from the signup dropdown and reports.
update branches
   set is_active = false, updated_at = now()
 where code <> all (array['CAP','CHN','CBR','CSF','ELD','EXP','HOF','GAL','GCT','MER','HAZ','HIL','HUB','JCT','KAV','KMG','KUM','LAV','LIK','MNG','MOM','MFR','NMG','NVS','NKR','NYK','NYA','NYB','NBZ','ONL','RUN','RFR','SRT','TML','TMF','TPF','VMK','WHS','WES','WEP']);

-- ============================================================
-- 2. ROLE PERMISSIONS MATRIX
-- ============================================================
-- Note: admin.branches and admin.settings are deliberately left ungranted for
-- every role except admin. Branch and target changes rewrite what every report
-- means, so they stay with admin until someone explicitly delegates them via
-- /admin/permissions.

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
  ('branch_manager', 'report.view.branch',    'branch'),
  ('branch_manager', 'attendance.correct.branch', 'branch')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- hr_accounts: the same rights as a branch manager, but organisation-wide.
insert into role_permissions (role, permission, access_level) values
  ('hr_accounts', 'punch.view.own',         'own'),
  ('hr_accounts', 'leave.request.own',      'own'),
  ('hr_accounts', 'leave.cancel.own',       'own'),
  ('hr_accounts', 'leave.request.on_behalf','org'),
  ('hr_accounts', 'leave.approve.org',      'org'),
  ('hr_accounts', 'report.view.org',        'org'),
  ('hr_accounts', 'attendance.correct.org', 'org')
on conflict (role, permission) do update set access_level = excluded.access_level;

-- admin: full on everything. has_min_access() already hardcodes this
-- bypass, but seeding explicit 'full' rows keeps the /admin/permissions
-- matrix screen from showing a confusing, misleadingly-empty admin row.
insert into role_permissions (role, permission, access_level)
select 'admin', p, 'full'
from unnest(enum_range(null::app_permission)) as p
on conflict (role, permission) do update set access_level = excluded.access_level;
