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

export interface BranchRow {
  id: string
  code: string
  name: string
  brand: string
  town: string | null
  isActive: boolean
  latitude: number | null
  longitude: number | null
  geofenceRadiusM: number | null
  staffCount: number
}

export async function listBranches(): Promise<BranchRow[]> {
  const supabase = await createClient()
  const [{ data: branches }, { data: profiles }] = await Promise.all([
    supabase
      .from('branches')
      .select('id, code, name, brand, town, is_active, latitude, longitude, geofence_radius_m')
      .order('name'),
    supabase.from('profiles').select('branch_id').eq('is_active', true),
  ])

  const staffByBranch = new Map<string, number>()
  for (const row of profiles ?? []) {
    staffByBranch.set(row.branch_id, (staffByBranch.get(row.branch_id) ?? 0) + 1)
  }

  return (branches ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    brand: row.brand,
    town: row.town,
    isActive: row.is_active,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    geofenceRadiusM: row.geofence_radius_m,
    staffCount: staffByBranch.get(row.id) ?? 0,
  }))
}

export interface ShiftTemplateRow {
  id: string
  name: string
  branchId: string | null
  branchName: string | null
  role: Role | null
  clockInWindowStart: string
  clockInWindowEnd: string
  clockOutWindowStart: string
  clockOutWindowEnd: string
  graceMinutes: number
  isActive: boolean
}

export async function listShiftTemplates(): Promise<ShiftTemplateRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('shift_templates')
    .select(
      'id, name, branch_id, role, clock_in_window_start, clock_in_window_end, clock_out_window_start, clock_out_window_end, grace_minutes, is_active, branch:branches(name)'
    )
    .order('name')

  type BranchEmbed = { name: string } | { name: string }[] | null
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    branchId: row.branch_id,
    branchName: one(row.branch as BranchEmbed)?.name ?? null,
    role: row.role as Role | null,
    clockInWindowStart: row.clock_in_window_start,
    clockInWindowEnd: row.clock_in_window_end,
    clockOutWindowStart: row.clock_out_window_start,
    clockOutWindowEnd: row.clock_out_window_end,
    graceMinutes: row.grace_minutes,
    isActive: row.is_active,
  }))
}

export interface ShiftAssignmentRow {
  id: string
  shiftTemplateId: string
  shiftTemplateName: string
  effectiveFrom: string
  effectiveTo: string | null
}

/** A person's shift history, current assignment first. */
export async function listShiftAssignments(profileId: string): Promise<ShiftAssignmentRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('shift_assignments')
    .select('id, shift_template_id, effective_from, effective_to, template:shift_templates(name)')
    .eq('profile_id', profileId)
    .order('effective_from', { ascending: false })

  type TemplateEmbed = { name: string } | { name: string }[] | null
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  return (data ?? []).map((row) => ({
    id: row.id,
    shiftTemplateId: row.shift_template_id,
    shiftTemplateName: one(row.template as TemplateEmbed)?.name ?? 'Unknown',
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  }))
}

export interface AdminUserDetail extends AdminUserRow {
  jobTitle: string | null
  createdAt: string
}

export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active, job_title, created_at, branch:branches(id, name)')
    .eq('id', userId)
    .maybeSingle()

  if (!data) return null
  const branch: BranchEmbed = data.branch
  const b = Array.isArray(branch) ? branch[0] : branch

  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    role: data.role as Role,
    branchId: b?.id ?? '',
    branchName: b?.name ?? '—',
    isActive: data.is_active,
    jobTitle: data.job_title,
    createdAt: data.created_at,
  }
}
