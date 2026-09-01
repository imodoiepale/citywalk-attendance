import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface LiveOvertimeRow {
  punchId: string
  userId: string
  fullName: string
  branchName: string
  minutesOver: number
}

/**
 * Staff currently clocked in and already past their shift's clock-out window
 * (+ grace) — computed live against now(), since a still-open punch has no
 * stored overtime_minutes yet (that's only set at clock-out).
 */
export async function getLiveOvertime(branchId: string, orgWide: boolean): Promise<LiveOvertimeRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('punches_live_overtime')
    .select('punch_id, user_id, full_name, branch_name, minutes_over')
    .order('minutes_over', { ascending: false })
  if (!orgWide) query = query.eq('branch_id', branchId)

  const { data } = await query

  return (data ?? []).map((row) => ({
    punchId: row.punch_id,
    userId: row.user_id,
    fullName: row.full_name,
    branchName: row.branch_name,
    minutesOver: row.minutes_over,
  }))
}
