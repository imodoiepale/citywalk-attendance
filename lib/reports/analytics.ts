import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface BranchHoursRow {
  branchId: string
  branchName: string
  branchCode: string
  totalHours: number
  activeStaff: number
}

export interface LeaveSummaryRow {
  branchId: string
  branchName: string
  type: string
  count: number
}

export interface AttendanceAnalytics {
  hoursByBranch: BranchHoursRow[]
  leaveByBranchType: LeaveSummaryRow[]
  totalStaffByBranch: Map<string, number>
}

type BranchEmbed = { id: string; name: string; code: string } | { id: string; name: string; code: string }[] | null

function oneBranch(embed: BranchEmbed) {
  return Array.isArray(embed) ? embed[0] : embed
}

interface PunchAnalyticsRow {
  user_id: string
  branch_id: string
  clock_in_at: string
  clock_out_at: string | null
  branch: BranchEmbed
}

interface LeaveAnalyticsRow {
  branch_id: string
  type: string
  branch: BranchEmbed
}

export async function loadAttendanceAnalytics(filters: {
  branchId: string | null
  from: string
  to: string
}): Promise<AttendanceAnalytics> {
  const supabase = await createClient()

  let punchQuery = supabase
    .from('punches')
    .select('user_id, branch_id, clock_in_at, clock_out_at, branch:branches!punches_branch_id_fkey(id, name, code)')
    .gte('clock_in_at', filters.from)
    .lt('clock_in_at', filters.to)
    .limit(10000)
  if (filters.branchId) punchQuery = punchQuery.eq('branch_id', filters.branchId)

  let leaveQuery = supabase
    .from('leave_requests')
    .select('branch_id, type, branch:branches!leave_requests_branch_id_fkey(id, name, code)')
    .gte('start_date', filters.from)
    .lt('start_date', filters.to)
    .eq('status', 'approved')
    .limit(10000)
  if (filters.branchId) leaveQuery = leaveQuery.eq('branch_id', filters.branchId)

  let staffQuery = supabase.from('profiles').select('id, branch_id').eq('is_active', true)
  if (filters.branchId) staffQuery = staffQuery.eq('branch_id', filters.branchId)

  const [{ data: punchRows }, { data: leaveRows }, { data: staffRows }] = await Promise.all([
    punchQuery,
    leaveQuery,
    staffQuery,
  ])

  const totalStaffByBranch = new Map<string, number>()
  for (const row of staffRows ?? []) {
    totalStaffByBranch.set(row.branch_id, (totalStaffByBranch.get(row.branch_id) ?? 0) + 1)
  }

  const branchAgg = new Map<
    string,
    { name: string; code: string; totalHours: number; staffSet: Set<string> }
  >()
  for (const row of (punchRows ?? []) as unknown as PunchAnalyticsRow[]) {
    const branch = oneBranch(row.branch)
    let entry = branchAgg.get(row.branch_id)
    if (!entry) {
      entry = { name: branch?.name ?? 'Unknown', code: branch?.code ?? '—', totalHours: 0, staffSet: new Set() }
      branchAgg.set(row.branch_id, entry)
    }
    const endMs = row.clock_out_at ? new Date(row.clock_out_at).getTime() : Date.now()
    entry.totalHours += Math.max(0, (endMs - new Date(row.clock_in_at).getTime()) / 3_600_000)
    entry.staffSet.add(row.user_id)
  }

  const hoursByBranch: BranchHoursRow[] = Array.from(branchAgg.entries())
    .map(([branchId, v]) => ({
      branchId,
      branchName: v.name,
      branchCode: v.code,
      totalHours: v.totalHours,
      activeStaff: v.staffSet.size,
    }))
    .sort((a, b) => b.totalHours - a.totalHours)

  const leaveAgg = new Map<string, { branchName: string; type: string; count: number }>()
  for (const row of (leaveRows ?? []) as unknown as LeaveAnalyticsRow[]) {
    const branch = oneBranch(row.branch)
    const key = `${row.branch_id}:${row.type}`
    let entry = leaveAgg.get(key)
    if (!entry) {
      entry = { branchName: branch?.name ?? 'Unknown', type: row.type, count: 0 }
      leaveAgg.set(key, entry)
    }
    entry.count += 1
  }

  const leaveByBranchType: LeaveSummaryRow[] = Array.from(leaveAgg.entries()).map(([key, v]) => ({
    branchId: key.split(':')[0],
    branchName: v.branchName,
    type: v.type,
    count: v.count,
  }))

  return { hoursByBranch, leaveByBranchType, totalStaffByBranch }
}
