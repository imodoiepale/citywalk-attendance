'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
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
    p_duplicate_window_seconds: Math.round(num('duplicateWindowSeconds')),
  })
  if (error) throw new Error(error.message)

  // Targets feed the dial, the calendar and every report.
  revalidatePath('/', 'layout')
}

export interface ShiftTemplateFormState {
  ok?: boolean
  error?: string
}

export interface CreateEmployeeFormState {
  error?: string
  tempPassword?: string
  profileId?: string
}

export async function saveShiftTemplateAction(
  _prev: ShiftTemplateFormState,
  formData: FormData
): Promise<ShiftTemplateFormState> {
  await requireUser()
  const supabase = await createClient()

  const branchId = String(formData.get('branchId') ?? '') || null
  const role = String(formData.get('role') ?? '') || null
  if (!branchId && !role) {
    return { error: 'Pick a branch, a role, or both.' }
  }

  const { error } = await supabase.rpc('admin_upsert_shift_template', {
    p_id: String(formData.get('id') ?? '') || null,
    p_name: String(formData.get('name') ?? ''),
    p_branch_id: branchId,
    p_role: role,
    p_clock_in_window_start: String(formData.get('clockInStart') ?? ''),
    p_clock_in_window_end: String(formData.get('clockInEnd') ?? ''),
    p_clock_out_window_start: String(formData.get('clockOutStart') ?? ''),
    p_clock_out_window_end: String(formData.get('clockOutEnd') ?? ''),
    p_grace_minutes: Math.max(0, Math.round(Number(formData.get('graceMinutes') ?? 0))),
    p_is_active: formData.get('isActive') === 'on',
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/shifts')
  return { ok: true }
}

export async function assignShiftAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const profileId = String(formData.get('profileId') ?? '')
  const shiftTemplateId = String(formData.get('shiftTemplateId') ?? '')
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '') || undefined

  const { error } = await supabase.rpc('admin_assign_shift', {
    p_profile_id: profileId,
    p_shift_template_id: shiftTemplateId,
    p_effective_from: effectiveFrom,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/admin/shifts')
  revalidatePath(`/admin/users/${profileId}`)
}

export async function createEmployeeAction(
  _prev: CreateEmployeeFormState,
  formData: FormData
): Promise<CreateEmployeeFormState> {
  const viewer = await requireUser()
  const supabase = await createClient()

  if ((viewer.permissions['admin.employees'] ?? 'none') !== 'full' && viewer.role !== 'admin') {
    return { error: 'Not authorised to create employees.' }
  }

  const fullName = String(formData.get('fullName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const branchId = String(formData.get('branchId') ?? '').trim()
  const role = String(formData.get('role') ?? '').trim() as Role
  const jobTitle = String(formData.get('jobTitle') ?? '').trim()
  if (!fullName || !email || !branchId || !role) {
    return { error: 'Full name, email, branch, and role are required.' }
  }

  const tempPassword = randomBytes(9).toString('base64url')
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, branch_id: branchId },
  })
  if (error || !data.user) {
    return { error: error?.message ?? 'Could not create that employee account.' }
  }

  const { error: finishError } = await supabase.rpc('admin_finish_employee_setup', {
    p_user_id: data.user.id,
    p_role: role,
    p_job_title: jobTitle || null,
    p_must_change_password: true,
  })
  if (finishError) return { error: finishError.message }

  revalidatePath('/admin/users')
  return { tempPassword, profileId: data.user.id }
}

export async function updateFaceSettingsAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const num = (key: string, fallback: number) => {
    const raw = String(formData.get(key) ?? '').trim()
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  }

  // Written directly rather than through a dedicated RPC: admin_update_settings
  // owns the hour targets and adding five more parameters to it would make a
  // face change look like a targets change in the audit trail.
  const { error } = await supabase
    .from('app_settings')
    .update({
      face_enabled: formData.get('face_enabled') === 'on',
      face_min_confidence: num('face_min_confidence', 0.9),
      face_retention_days: Math.round(num('face_retention_days', 365)),
      face_reenroll_days: Math.round(num('face_reenroll_days', 730)),
      face_consent_version: String(formData.get('face_consent_version') ?? 'v1').trim() || 'v1',
      updated_by_id: (await supabase.auth.getUser()).data.user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)

  if (error) throw new Error(error.message)

  revalidatePath('/admin/settings')
  revalidatePath('/me')
}
