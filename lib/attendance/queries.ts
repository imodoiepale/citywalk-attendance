import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface RecentPunchRow {
  id: string
  userId: string
  fullName: string
  branchName: string
  clockInAt: string
  clockOutAt: string | null
  method: string
  clockInFlag: 'on_time' | 'early' | 'late' | 'out_of_window' | null
  clockOutFlag: 'on_time' | 'early' | 'late' | 'out_of_window' | null
  overtimeMinutes: number
}

/**
 * Recent punches for the admin delete screen — org-wide or scoped to one
 * branch, matching the same orgWide/branchId shape used across
 * lib/corrections/queries.ts and lib/reports/timesheets.ts.
 */
export async function listRecentPunches(
  branchId: string,
  orgWide: boolean,
  limit = 200
): Promise<RecentPunchRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('punches')
    .select(
      'id, user_id, clock_in_at, clock_out_at, method, clock_in_flag, clock_out_flag, overtime_minutes, profile:profiles!punches_user_id_fkey(full_name), branch:branches!punches_branch_id_fkey(name)'
    )
    .order('clock_in_at', { ascending: false })
    .limit(limit)
  if (!orgWide) query = query.eq('branch_id', branchId)

  const { data } = await query

  type ProfileEmbed = { full_name: string } | { full_name: string }[] | null
  type BranchEmbed = { name: string } | { name: string }[] | null
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    fullName: one(row.profile as ProfileEmbed)?.full_name ?? 'Unknown',
    branchName: one(row.branch as BranchEmbed)?.name ?? 'Unknown',
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    method: row.method,
    clockInFlag: row.clock_in_flag,
    clockOutFlag: row.clock_out_flag,
    overtimeMinutes: row.overtime_minutes ?? 0,
  }))
}
