// Labels/metadata only — NOT the authorization check. The database's
// role_permissions table (read via has_min_access() in SQL, or via
// CurrentUser.permissions on the app side) is the real source of truth.
// See supabase/migrations/20260819000001_schema.sql section 6/10.

export type Role = 'staff' | 'branch_manager' | 'hr_accounts' | 'admin'

export type Permission =
  | 'punch.view.own'
  | 'leave.request.own'
  | 'leave.request.on_behalf'
  | 'leave.approve.branch'
  | 'leave.approve.org'
  | 'leave.cancel.own'
  | 'report.view.branch'
  | 'report.view.org'
  | 'admin.users'
  | 'admin.permissions'

export type AccessLevel = 'none' | 'own' | 'branch' | 'org' | 'full'

export const ACCESS_LEVELS: AccessLevel[] = ['none', 'own', 'branch', 'org', 'full']

export const ROLES: Role[] = ['staff', 'branch_manager', 'hr_accounts', 'admin']

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  staff: {
    label: 'Staff',
    description: 'Clocks in/out and requests their own leave.',
  },
  branch_manager: {
    label: 'Branch Manager',
    description: 'Approves leave and views reports for their own branch.',
  },
  hr_accounts: {
    label: 'HR / Accounts',
    description: 'Approves leave and views reports across every branch.',
  },
  admin: {
    label: 'Admin',
    description: 'Full access, including managing user roles and rights.',
  },
}

export const PERMISSIONS: Permission[] = [
  'punch.view.own',
  'leave.request.own',
  'leave.request.on_behalf',
  'leave.approve.branch',
  'leave.approve.org',
  'leave.cancel.own',
  'report.view.branch',
  'report.view.org',
  'admin.users',
  'admin.permissions',
]

export const PERMISSION_META: Record<Permission, { label: string; group: string }> = {
  'punch.view.own': { label: 'View own punches', group: 'Attendance' },
  'leave.request.own': { label: 'Request own leave', group: 'Leave' },
  'leave.request.on_behalf': { label: 'File leave for someone else', group: 'Leave' },
  'leave.approve.branch': { label: 'Approve leave — own branch', group: 'Leave' },
  'leave.approve.org': { label: 'Approve leave — any branch', group: 'Leave' },
  'leave.cancel.own': { label: 'Cancel own leave request', group: 'Leave' },
  'report.view.branch': { label: 'View reports — own branch', group: 'Reports' },
  'report.view.org': { label: 'View reports — any branch', group: 'Reports' },
  'admin.users': { label: 'Manage user roles & activation', group: 'Admin' },
  'admin.permissions': { label: 'Edit the role/permission matrix', group: 'Admin' },
}

function rank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level)
}

export function canAtLeast(
  permissions: Partial<Record<Permission, AccessLevel>>,
  role: Role,
  permission: Permission,
  min: AccessLevel = 'own'
): boolean {
  if (role === 'admin') return true
  const level = permissions[permission] ?? 'none'
  return rank(level) >= rank(min)
}

export interface NavItem {
  href: string
  label: string
  match: (permissions: Partial<Record<Permission, AccessLevel>>, role: Role) => boolean
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', match: () => true },
  { href: '/calendar', label: 'Calendar', match: () => true },
  { href: '/leave', label: 'Leave', match: () => true },
  {
    href: '/leave/approvals',
    label: 'Approvals',
    match: (p, r) => canAtLeast(p, r, 'leave.approve.branch', 'branch') || canAtLeast(p, r, 'leave.approve.org', 'org'),
  },
  {
    href: '/reports',
    label: 'Reports',
    match: (p, r) => canAtLeast(p, r, 'report.view.branch', 'branch') || canAtLeast(p, r, 'report.view.org', 'org'),
  },
  {
    href: '/admin/users',
    label: 'Admin',
    match: (p, r) => canAtLeast(p, r, 'admin.users', 'full'),
  },
]

export function navFor(
  permissions: Partial<Record<Permission, AccessLevel>>,
  role: Role
): NavItem[] {
  return NAV.filter((item) => item.match(permissions, role))
}
