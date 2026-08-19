import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { startOfNairobiDayUtc, toNairobiDateKey } from '@/lib/timezone'

export interface PunchRecord {
  id: string
  clockInAt: string
  clockOutAt: string | null
}

export async function getTodaysPunches(userId: string): Promise<PunchRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('punches')
    .select('id, clock_in_at, clock_out_at')
    .eq('user_id', userId)
    .gte('clock_in_at', startOfNairobiDayUtc().toISOString())
    .order('clock_in_at', { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
  }))
}

/** Worked hours per Nairobi calendar day, for a given month (1-12). */
export async function getDailyHoursForMonth(
  userId: string,
  year: number,
  month: number
): Promise<Map<string, number>> {
  const supabase = await createClient()
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

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
