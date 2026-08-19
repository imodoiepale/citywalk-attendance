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

export async function updateProfileAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const userId = String(formData.get('userId') ?? '')
  const { error } = await supabase.rpc('admin_update_profile', {
    p_user_id: userId,
    p_full_name: String(formData.get('fullName') ?? ''),
    p_job_title: String(formData.get('jobTitle') ?? ''),
    p_branch_id: String(formData.get('branchId') ?? '') || null,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
}

export async function upsertBranchAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  // Empty strings must become null, not 0 — a branch with no coordinates is
  // different from one pinned at the equator.
  const numberOrNull = (key: string) => {
    const raw = String(formData.get(key) ?? '').trim()
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }

  const { error } = await supabase.rpc('admin_upsert_branch', {
    p_id: String(formData.get('id') ?? '') || null,
    p_code: String(formData.get('code') ?? ''),
    p_name: String(formData.get('name') ?? ''),
    p_brand: String(formData.get('brand') ?? ''),
    p_town: String(formData.get('town') ?? ''),
    p_is_active: formData.get('isActive') === 'on',
    p_latitude: numberOrNull('latitude'),
    p_longitude: numberOrNull('longitude'),
    p_geofence_radius_m: numberOrNull('geofenceRadiusM'),
  })
  if (error) throw new Error(error.message)

  revalidatePath('/admin/branches')
}

export async function updateSettingsAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const num = (key: string) => Number(String(formData.get(key) ?? ''))

  const { error } = await supabase.rpc('admin_update_settings', {
    p_daily_target_hours: num('dailyTargetHours'),
    p_weekly_target_hours: num('weeklyTargetHours'),
    p_approaching_threshold_hours: num('approachingThresholdHours'),
    p_grace_period_minutes: num('gracePeriodMinutes'),
    p_max_shift_hours: num('maxShiftHours'),
  })
  if (error) throw new Error(error.message)

  // Targets feed the dial, the calendar and every report.
  revalidatePath('/', 'layout')
}
