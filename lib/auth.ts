import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAtLeast, type AccessLevel, type Permission, type Role } from '@/lib/rbac-catalog'

export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: Role
  jobTitle: string | null
  isActive: boolean
  branchId: string
  branchName: string
  branchCode: string
  permissions: Partial<Record<Permission, AccessLevel>>
}

function isRole(value: string): value is Role {
  return value === 'staff' || value === 'branch_manager' || value === 'hr_accounts' || value === 'admin'
}

// Hiding UI is not a security control — RLS (see the migration's section 6)
// is the real enforcement layer. getCurrentUser()/requirePermission() only
// avoid rendering a door the user can't actually open.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, job_title, is_active, branch:branches(id, name, code)')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  const branch = Array.isArray(profile.branch) ? profile.branch[0] : profile.branch
  // Defensive fallback: if the DB enum and this app's Role union ever
  // drift, default to the lowest-privilege role rather than crashing or
  // silently granting more access than intended.
  const role: Role = isRole(profile.role) ? profile.role : 'staff'

  const { data: rolePerms } = await supabase.rpc('my_permissions')
  const permissions: Partial<Record<Permission, AccessLevel>> = {}
  for (const row of rolePerms ?? []) {
    permissions[row.permission as Permission] = row.access_level as AccessLevel
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role,
    jobTitle: profile.job_title,
    isActive: profile.is_active,
    branchId: branch?.id ?? '',
    branchName: branch?.name ?? '',
    branchCode: branch?.code ?? '',
    permissions,
  }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.isActive) redirect('/login?error=deactivated')
  return user
}

export async function requirePermission(
  permission: Permission,
  minLevel: AccessLevel = 'own'
): Promise<CurrentUser> {
  const user = await requireUser()
  if (!canAtLeast(user.permissions, user.role, permission, minLevel)) {
    redirect(`/?error=forbidden`)
  }
  return user
}
