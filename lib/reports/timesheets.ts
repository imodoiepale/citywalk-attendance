import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { toNairobiDateKey } from '@/lib/timezone'

// One shared timesheet shape, rendered identically by the on-screen table and
// by all three export formats. Anything that changes the numbers changes them
// everywhere — the XLSX/PDF/CSV writers never re-derive hours themselves.

export type GroupBy = 'branch' | 'name'

export interface TimesheetDay {
  dateKey: string
  hours: number
}

export interface TimesheetRow {
  userId: string
  fullName: string
  branchId: string
  branchName: string
  branchCode: string
  jobTitle: string | null
  days: Record<string, number>
  totalHours: number
  /** Hours beyond the daily target, summed per day (not total-vs-period). */
  overtimeHours: number
  daysWorked: number
}

export interface Timesheet {
  rows: TimesheetRow[]
  /** Every Nairobi day in the period, ascending — the table's column set. */
  dateKeys: string[]
  from: string
  to: string
  groupBy: GroupBy
  branchLabel: string
  grandTotalHours: number
  grandOvertimeHours: number
}

type BranchEmbed =
  | { id: string; name: string; code: string }
  | { id: string; name: string; code: string }[]
  | null

function oneBranch(embed: BranchEmbed) {
  return Array.isArray(embed) ? embed[0] : embed
}

interface ProfileRow {
  id: string
  full_name: string
  job_title: string | null
  branch_id: string
  branch: BranchEmbed
}

/** Every Nairobi calendar day between two ISO instants, inclusive. */
export function dateKeysBetween(fromIso: string, toIso: string): string[] {
  const keys: string[] = []
  const cursor = new Date(fromIso)
  const end = new Date(toIso)
  // Step a day at a time and let toNairobiDateKey do the offset maths, rather
  // than incrementing a formatted string.
  while (cursor <= end) {
    const key = toNairobiDateKey(cursor.toISOString())
    if (keys[keys.length - 1] !== key) keys.push(key)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  const endKey = toNairobiDateKey(end.toISOString())
  if (keys[keys.length - 1] !== endKey) keys.push(endKey)
  return keys
}

export async function loadTimesheet(options: {
  branchId: string | null
  from: string
  to: string
  groupBy: GroupBy
  branchLabel: string
}): Promise<Timesheet> {
  const supabase = await createClient()

  // Profiles first, so someone who worked zero hours in the period still
  // appears as a row of blanks rather than silently vanishing from payroll.
  let profileQuery = supabase
    .from('profiles')
    .select('id, full_name, job_title, branch_id, branch:branches!profiles_branch_id_fkey(id, name, code)')
    .eq('is_active', true)
  if (options.branchId) profileQuery = profileQuery.eq('branch_id', options.branchId)

  let punchQuery = supabase
    .from('punches')
    .select('user_id, clock_in_at, clock_out_at, overtime_minutes')
    .gte('clock_in_at', options.from)
    .lt('clock_in_at', options.to)
    .limit(10000)
  if (options.branchId) punchQuery = punchQuery.eq('branch_id', options.branchId)

  const [{ data: profileData }, { data: punchData }] = await Promise.all([
    profileQuery,
    punchQuery,
  ])

  const profiles = (profileData ?? []) as unknown as ProfileRow[]

  const hoursByUserDay = new Map<string, Map<string, number>>()
  // Overtime is now sourced from the shift-aware trigger (punches.overtime_minutes,
  // see 20260901000003_shift_windows.sql) rather than a daily-target comparison —
  // a shift's own clock-out window decides overtime, not one global target hour
  // count, and a still-open punch correctly contributes none yet.
  const overtimeMinutesByUserDay = new Map<string, Map<string, number>>()
  for (const punch of punchData ?? []) {
    const dayKey = toNairobiDateKey(punch.clock_in_at)
    const endMs = punch.clock_out_at ? new Date(punch.clock_out_at).getTime() : Date.now()
    const hours = Math.max(0, (endMs - new Date(punch.clock_in_at).getTime()) / 3_600_000)

    let userDays = hoursByUserDay.get(punch.user_id)
    if (!userDays) {
      userDays = new Map()
      hoursByUserDay.set(punch.user_id, userDays)
    }
    userDays.set(dayKey, (userDays.get(dayKey) ?? 0) + hours)

    if (punch.overtime_minutes) {
      let overtimeDays = overtimeMinutesByUserDay.get(punch.user_id)
      if (!overtimeDays) {
        overtimeDays = new Map()
        overtimeMinutesByUserDay.set(punch.user_id, overtimeDays)
      }
      overtimeDays.set(dayKey, (overtimeDays.get(dayKey) ?? 0) + punch.overtime_minutes)
    }
  }

  const dateKeys = dateKeysBetween(options.from, options.to)

  const rows: TimesheetRow[] = profiles.map((profile) => {
    const branch = oneBranch(profile.branch)
    const userDays = hoursByUserDay.get(profile.id) ?? new Map<string, number>()
    const overtimeDays = overtimeMinutesByUserDay.get(profile.id) ?? new Map<string, number>()

    const days: Record<string, number> = {}
    let totalHours = 0
    let overtimeMinutes = 0
    let daysWorked = 0

    for (const key of dateKeys) {
      const hours = userDays.get(key) ?? 0
      days[key] = hours
      totalHours += hours
      if (hours > 0) daysWorked += 1
      overtimeMinutes += overtimeDays.get(key) ?? 0
    }

    return {
      userId: profile.id,
      fullName: profile.full_name,
      branchId: profile.branch_id,
      branchName: branch?.name ?? 'Unknown',
      branchCode: branch?.code ?? '—',
      jobTitle: profile.job_title,
      days,
      totalHours,
      overtimeHours: overtimeMinutes / 60,
      daysWorked,
    }
  })

  sortTimesheetRows(rows, options.groupBy)

  return {
    rows,
    dateKeys,
    from: options.from,
    to: options.to,
    groupBy: options.groupBy,
    branchLabel: options.branchLabel,
    grandTotalHours: rows.reduce((sum, row) => sum + row.totalHours, 0),
    grandOvertimeHours: rows.reduce((sum, row) => sum + row.overtimeHours, 0),
  }
}

/** Branch-wise (then name within branch) or straight name-wise. */
export function sortTimesheetRows(rows: TimesheetRow[], groupBy: GroupBy): TimesheetRow[] {
  return rows.sort((a, b) => {
    if (groupBy === 'branch') {
      const byBranch = a.branchName.localeCompare(b.branchName)
      if (byBranch !== 0) return byBranch
    }
    return a.fullName.localeCompare(b.fullName)
  })
}
