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
  /** Set on admin-created accounts. requireUser() forces /set-password until this clears. */
  mustChangePassword: boolean
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
interface UserContextRow {
  id: string
  email: string
  full_name: string
  role: string
  job_title: string | null
  is_active: boolean
  must_change_password: boolean
  branch_id: string | null
  branch_name: string | null
  branch_code: string | null
  permissions: Record<string, string>
}

// Hiding UI is not a security control — RLS (see the migration's section 6)
// is the real enforcement layer. getCurrentUser()/requirePermission() only
// avoid rendering a door the user can't actually open.
//
// Exactly one network round trip. Two things used to happen here in sequence:
// supabase.auth.getUser(), which is an HTTP call to the auth server, and then
// the my_context RPC. At ~340ms each from Nairobi to eu-west-1 that was ~680ms
// on the critical path of every page render, before the page issued a query of
// its own.
//
// Dropping getUser() does not drop verification. my_context() resolves the
// caller through auth.uid(), and PostgREST only populates auth.uid() after
// validating the JWT's signature against the project secret. An expired or
// forged token yields a null uid, my_context returns null, and this returns
// null — the same outcome getUser() produced, one hop earlier. The proxy still
// calls getUser() on every request, which is what refreshes the session cookie;
// that is its actual job and it stays.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()

  const { data } = await supabase.rpc('my_context')
  const context = data as UserContextRow | null
  if (!context) return null

  // Defensive fallback: if the DB enum and this app's Role union ever
  // drift, default to the lowest-privilege role rather than crashing or
  // silently granting more access than intended.
  const role: Role = isRole(context.role) ? context.role : 'staff'

  const permissions: Partial<Record<Permission, AccessLevel>> = {}
  for (const [permission, level] of Object.entries(context.permissions ?? {})) {
    permissions[permission as Permission] = level as AccessLevel
  }

  return {
    id: context.id,
    email: context.email,
    fullName: context.full_name,
    role,
    jobTitle: context.job_title,
    isActive: context.is_active,
    mustChangePassword: Boolean(context.must_change_password),
    branchId: context.branch_id ?? '',
    branchName: context.branch_name ?? '',
    branchCode: context.branch_code ?? '',
    permissions,
  }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!user.isActive) redirect('/login?error=deactivated')
  // Admin-created accounts start with a generated temp password and must
  // change it before reaching anything else. /set-password itself calls
  // getCurrentUser() directly, never requireUser(), so this cannot loop.
  if (user.mustChangePassword) redirect('/set-password')
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
