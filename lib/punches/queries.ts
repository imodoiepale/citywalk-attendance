import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  nairobiDayRangeUtc,
  nairobiMonthRangeUtc,
  startOfNairobiDayUtc,
  toNairobiDateKey,
} from '@/lib/timezone'

export interface PunchRecord {
  id: string
  clockInAt: string
  clockOutAt: string | null
  clockInFlag?: 'on_time' | 'early' | 'late' | 'out_of_window' | null
  clockOutFlag?: 'on_time' | 'early' | 'late' | 'out_of_window' | null
  overtimeMinutes?: number
}

function toPunchRecord(row: {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_flag?: string | null
  clock_out_flag?: string | null
  overtime_minutes?: number | null
}): PunchRecord {
  return {
    id: row.id,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    clockInFlag: (row.clock_in_flag as PunchRecord['clockInFlag']) ?? null,
    clockOutFlag: (row.clock_out_flag as PunchRecord['clockOutFlag']) ?? null,
    overtimeMinutes: row.overtime_minutes ?? 0,
  }
}

/**
 * The user's currently open punch, if any — deliberately unfiltered by date.
 * A night shift started at 22:00 is still open at 01:00 the next Nairobi day,
 * and a today-only query would report that person as clocked out.
 */
export async function getOpenPunch(userId: string): Promise<PunchRecord | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('punches')
    .select('id, clock_in_at, clock_out_at')
    .eq('user_id', userId)
    .is('clock_out_at', null)
    .maybeSingle()

  return data ? toPunchRecord(data) : null
}

/**
 * Today's punches, plus any still-open punch that began on an earlier day.
 * The DB's `punches_one_open_per_user` index guarantees at most one of those.
 */
export async function getTodaysPunches(userId: string): Promise<PunchRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('punches')
    .select('id, clock_in_at, clock_out_at')
    .eq('user_id', userId)
    .gte('clock_in_at', startOfNairobiDayUtc().toISOString())
    .order('clock_in_at', { ascending: false })

  const punches = (data ?? []).map(toPunchRecord)

  const openPunch = await getOpenPunch(userId)
  if (openPunch && !punches.some((p) => p.id === openPunch.id)) {
    punches.push(openPunch)
  }

  return punches.sort((a, b) => b.clockInAt.localeCompare(a.clockInAt))
}

/** Worked seconds across a set of punches; an open punch counts up to now. */
export function totalWorkedSeconds(punches: PunchRecord[]): number {
  return punches.reduce((total, punch) => {
    const endMs = punch.clockOutAt ? new Date(punch.clockOutAt).getTime() : Date.now()
    return total + Math.max(0, (endMs - new Date(punch.clockInAt).getTime()) / 1000)
  }, 0)
}

/** Worked hours per Nairobi calendar day, for a given month (1-12). */
export async function getDailyHoursForMonth(
  userId: string,
  year: number,
  month: number
): Promise<Map<string, number>> {
  const supabase = await createClient()
  const { start, end } = nairobiMonthRangeUtc(year, month)

  const { data } = await supabase
    .from('punches')
    .select('clock_in_at, clock_out_at')
    .eq('user_id', userId)
    .gte('clock_in_at', start.toISOString())
    .lt('clock_in_at', end.toISOString())

  const hoursByDay = new Map<string, number>()
  for (const row of data ?? []) {
    const dayKey = toNairobiDateKey(row.clock_in_at)
    const endMs = row.clock_out_at ? new Date(row.clock_out_at).getTime() : Date.now()
    const hours = Math.max(0, (endMs - new Date(row.clock_in_at).getTime()) / 3_600_000)
    hoursByDay.set(dayKey, (hoursByDay.get(dayKey) ?? 0) + hours)
  }
  return hoursByDay
}

/** Rolling 7-day worked-hours total, for the weekly progress ring. */
export async function getWeeklyHours(userId: string): Promise<number> {
  const supabase = await createClient()
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const { data } = await supabase
    .from('punches')
    .select('clock_in_at, clock_out_at')
    .eq('user_id', userId)
    .gte('clock_in_at', from.toISOString())

  let totalHours = 0
  for (const row of data ?? []) {
    const endMs = row.clock_out_at ? new Date(row.clock_out_at).getTime() : Date.now()
    totalHours += Math.max(0, (endMs - new Date(row.clock_in_at).getTime()) / 3_600_000)
  }
  return totalHours
}

/** Every punch that began on one Nairobi calendar day, for the day-detail view. */
export async function getPunchesForDay(userId: string, dateKey: string): Promise<PunchRecord[]> {
  const supabase = await createClient()
  const { start, end } = nairobiDayRangeUtc(dateKey)

  const { data } = await supabase
    .from('punches')
    .select('id, clock_in_at, clock_out_at, clock_in_flag, clock_out_flag, overtime_minutes')
    .eq('user_id', userId)
    .gte('clock_in_at', start.toISOString())
    .lt('clock_in_at', end.toISOString())
    .order('clock_in_at', { ascending: true })

  return (data ?? []).map(toPunchRecord)
}

/** Overtime minutes for a Nairobi month, summed per day, for the calendar's month view. */
export async function getOvertimeMinutesForMonth(
  userId: string,
  year: number,
  month: number
): Promise<Map<string, number>> {
  const supabase = await createClient()
  const { start, end } = nairobiMonthRangeUtc(year, month)

  const { data } = await supabase
    .from('punches')
    .select('clock_in_at, overtime_minutes')
    .eq('user_id', userId)
    .gte('clock_in_at', start.toISOString())
    .lt('clock_in_at', end.toISOString())
    .gt('overtime_minutes', 0)

  const minutesByDay = new Map<string, number>()
  for (const row of data ?? []) {
    const dayKey = toNairobiDateKey(row.clock_in_at)
    minutesByDay.set(dayKey, (minutesByDay.get(dayKey) ?? 0) + (row.overtime_minutes ?? 0))
  }
  return minutesByDay
}
