import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { PERMISSIONS, ROLES, type AccessLevel, type Permission, type Role } from '@/lib/rbac-catalog'

export interface AdminUserRow {
  id: string
  fullName: string
  email: string
  role: Role
  branchId: string
  branchName: string
  isActive: boolean
}

type BranchEmbed = { id: string; name: string } | { id: string; name: string }[] | null

export async function listAllUsers(): Promise<AdminUserRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, branch:branches(id, name)')
    .order('full_name')

  return (data ?? []).map((row) => {
    const branch: BranchEmbed = row.branch
    const b = Array.isArray(branch) ? branch[0] : branch
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role as Role,
      branchId: b?.id ?? '',
      branchName: b?.name ?? '—',
      isActive: row.is_active,
    }
  })
}

/** role -> permission -> access level, defaulting missing cells to 'none'. */
export async function getPermissionMatrix(): Promise<Record<Role, Record<Permission, AccessLevel>>> {
  const supabase = await createClient()
  const { data } = await supabase.from('role_permissions').select('role, permission, access_level')

  const matrix = Object.fromEntries(
    ROLES.map((role) => [role, Object.fromEntries(PERMISSIONS.map((p) => [p, 'none' as AccessLevel]))])
  ) as Record<Role, Record<Permission, AccessLevel>>

  for (const row of data ?? []) {
    matrix[row.role as Role][row.permission as Permission] = row.access_level as AccessLevel
  }

  return matrix
}
