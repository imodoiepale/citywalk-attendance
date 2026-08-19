'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { AccessLevel, Permission, Role } from '@/lib/rbac-catalog'

export async function updateUserRoleAction(userId: string, newRole: Role) {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_role', { p_user_id: userId, p_new_role: newRole })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/users')
}

export async function toggleUserActiveAction(userId: string, isActive: boolean) {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_active', { p_user_id: userId, p_is_active: isActive })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/users')
}

export async function updateRolePermissionAction(role: Role, permission: Permission, accessLevel: AccessLevel) {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('admin_set_permission', {
    p_role: role,
    p_permission: permission,
    p_access_level: accessLevel,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/permissions')
}
