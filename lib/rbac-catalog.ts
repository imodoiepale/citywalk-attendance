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
  | 'attendance.correct.branch'
  | 'attendance.correct.org'
  | 'admin.branches'
  | 'admin.settings'
  | 'admin.devices'

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
  'attendance.correct.branch',
  'attendance.correct.org',
  'admin.branches',
  'admin.settings',
  'admin.devices',
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
  'attendance.correct.branch': { label: 'Correct punches — own branch', group: 'Attendance' },
  'attendance.correct.org': { label: 'Correct punches — any branch', group: 'Attendance' },
  'admin.branches': { label: 'Manage branches', group: 'Admin' },
  'admin.settings': { label: 'Edit org settings', group: 'Admin' },
  'admin.devices': { label: 'Manage biometric devices', group: 'Admin' },
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
  /** Lower sorts earlier, and wins a slot in the cramped mobile tab bar. */
  priority: number
  match: (permissions: Partial<Record<Permission, AccessLevel>>, role: Role) => boolean
}

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', priority: 1, match: () => true },
  { href: '/calendar', label: 'Calendar', priority: 2, match: () => true },
  { href: '/leave', label: 'Leave', priority: 3, match: () => true },
  {
    href: '/leave/approvals',
    label: 'Approvals',
    priority: 4,
    match: (p, r) => canAtLeast(p, r, 'leave.approve.branch', 'branch') || canAtLeast(p, r, 'leave.approve.org', 'org'),
  },
  {
    href: '/reports',
    label: 'Reports',
    priority: 6,
    match: (p, r) => canAtLeast(p, r, 'report.view.branch', 'branch') || canAtLeast(p, r, 'report.view.org', 'org'),
  },
  {
    href: '/attendance/corrections',
    label: 'Corrections',
    priority: 5,
    match: (p, r) =>
      canAtLeast(p, r, 'attendance.correct.branch', 'branch') ||
      canAtLeast(p, r, 'attendance.correct.org', 'org'),
  },
  {
    href: '/reports/timesheets',
    label: 'Timesheets',
    priority: 7,
    match: (p, r) => canAtLeast(p, r, 'report.view.branch', 'branch') || canAtLeast(p, r, 'report.view.org', 'org'),
  },
  {
    href: '/admin/users',
    label: 'Admin',
    priority: 8,
    match: (p, r) => canAtLeast(p, r, 'admin.users', 'full'),
  },
]

export function navFor(
  permissions: Partial<Record<Permission, AccessLevel>>,
  role: Role
): NavItem[] {
  return NAV.filter((item) => item.match(permissions, role)).sort((a, b) => a.priority - b.priority)
}

/**
 * True when a nav link must match the path exactly rather than by prefix —
 * i.e. another nav item lives underneath it. Without this, `/reports` stays
 * highlighted while you're on `/reports/timesheets` and two tabs look active.
 */
export function isExactNav(nav: NavItem[], href: string): boolean {
  if (href === '/') return true
  return nav.some((item) => item.href !== href && item.href.startsWith(`${href}/`))
}

/**
 * The serializable half of a NavItem. `match` is a function and `NavItem`
 * therefore cannot cross the server/client boundary at all — passing one to a
 * Client Component throws "Functions cannot be passed directly to Client
 * Components" and takes down every authenticated page. Client-side nav takes
 * this instead, with `exact` already resolved on the server.
 */
export interface ClientNavItem {
  href: string
  label: string
  exact: boolean
}

export function toClientNav(nav: NavItem[]): ClientNavItem[] {
  return nav.map((item) => ({
    href: item.href,
    label: item.label,
    exact: isExactNav(nav, item.href),
  }))
}

/** How many nav items the mobile tab bar shows before overflowing into "More". */
export const MOBILE_TAB_SLOTS = 4

/**
 * Splits the nav for a phone. An admin qualifies for six destinations, which
 * squeezed edge-to-edge is unusable on a 375px screen — the top few keep a
 * tab, the rest move behind "More".
 */
export function splitNavForMobile(nav: NavItem[]): { tabs: NavItem[]; overflow: NavItem[] } {
  if (nav.length <= MOBILE_TAB_SLOTS + 1) return { tabs: nav, overflow: [] }
  return { tabs: nav.slice(0, MOBILE_TAB_SLOTS), overflow: nav.slice(MOBILE_TAB_SLOTS) }
}
