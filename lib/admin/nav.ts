import type { AccessLevel, Permission, Role } from '@/lib/rbac-catalog'
import { canAtLeast } from '@/lib/rbac-catalog'

// The admin area's own navigation. Kept out of the main NAV, which shows a
// single "Admin" entry — putting eight admin screens in the primary sidebar
// would bury the six everyone uses daily.

export interface AdminNavItem {
  href: string
  label: string
  description: string
  permission: Permission
  minLevel: AccessLevel
}

export const ADMIN_NAV: AdminNavItem[] = [
  {
    href: '/admin/users',
    label: 'Users',
    description: 'Roles, access and profiles',
    permission: 'admin.users',
    minLevel: 'full',
  },
  {
    href: '/admin/permissions',
    label: 'Role rights',
    description: 'What each role may do',
    permission: 'admin.permissions',
    minLevel: 'full',
  },
  {
    href: '/admin/branches',
    label: 'Branches',
    description: 'Sites and geofencing',
    permission: 'admin.branches',
    minLevel: 'full',
  },
  {
    href: '/admin/devices',
    label: 'Devices',
    description: 'Readers, cameras and health',
    permission: 'admin.devices',
    minLevel: 'full',
  },
  {
    href: '/admin/settings',
    label: 'Org settings',
    description: 'Hour targets and face recognition',
    permission: 'admin.settings',
    minLevel: 'full',
  },
  {
    href: '/admin/audit',
    label: 'Audit log',
    description: 'Who changed what',
    permission: 'admin.users',
    minLevel: 'full',
  },
]

export function adminNavFor(
  permissions: Partial<Record<Permission, AccessLevel>>,
  role: Role
): AdminNavItem[] {
  return ADMIN_NAV.filter((item) => canAtLeast(permissions, role, item.permission, item.minLevel))
}
