import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface CorrectionRecord {
  id: string
  punchId: string | null
  userId: string
  userName: string
  branchId: string
  branchName: string
  requestedByName: string
  proposedClockInAt: string
  proposedClockOutAt: string | null
  originalClockInAt: string | null
  originalClockOutAt: string | null
  reason: string
  status: string
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

const SELECT = `
  id, punch_id, user_id, branch_id, proposed_clock_in_at, proposed_clock_out_at,
  original_clock_in_at, original_clock_out_at, reason, status, decided_at,
  decision_note, created_at,
  subject:profiles!punch_corrections_user_id_fkey(full_name),
  requested_by:profiles!punch_corrections_requested_by_id_fkey(full_name),
  decided_by:profiles!punch_corrections_decided_by_id_fkey(full_name),
  branch:branches!punch_corrections_branch_id_fkey(name)
`

type Embed<T> = T | T[] | null

function one<T>(embed: Embed<T>): T | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

interface CorrectionRow {
  id: string
  punch_id: string | null
  user_id: string
  branch_id: string
  proposed_clock_in_at: string
  proposed_clock_out_at: string | null
  original_clock_in_at: string | null
  original_clock_out_at: string | null
  reason: string
  status: string
  decided_at: string | null
  decision_note: string | null
  created_at: string
  subject: Embed<{ full_name: string }>
  requested_by: Embed<{ full_name: string }>
  decided_by: Embed<{ full_name: string }>
  branch: Embed<{ name: string }>
}

function mapRow(row: CorrectionRow): CorrectionRecord {
  return {
    id: row.id,
    punchId: row.punch_id,
    userId: row.user_id,
    userName: one(row.subject)?.full_name ?? 'Unknown',
    branchId: row.branch_id,
    branchName: one(row.branch)?.name ?? 'Unknown',
    requestedByName: one(row.requested_by)?.full_name ?? 'Unknown',
    proposedClockInAt: row.proposed_clock_in_at,
    proposedClockOutAt: row.proposed_clock_out_at,
    originalClockInAt: row.original_clock_in_at,
    originalClockOutAt: row.original_clock_out_at,
    reason: row.reason,
    status: row.status,
    decidedByName: one(row.decided_by)?.full_name ?? null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  }
}

/**
 * Pending corrections awaiting this approver. RLS already restricts what's
 * visible, so the branch filter here is about scoping the queue, not security.
 */
export async function getCorrectionQueue(
  branchId: string,
  orgWide: boolean
): Promise<CorrectionRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('punch_corrections').select(SELECT).eq('status', 'pending')
  if (!orgWide) query = query.eq('branch_id', branchId)
  const { data } = await query.order('created_at', { ascending: true })
  return ((data ?? []) as unknown as CorrectionRow[]).map(mapRow)
}

/** Recently decided corrections — the audit trail, shown under the queue. */
export async function getRecentCorrectionDecisions(
  branchId: string,
  orgWide: boolean,
  limit = 20
): Promise<CorrectionRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('punch_corrections').select(SELECT).neq('status', 'pending')
  if (!orgWide) query = query.eq('branch_id', branchId)
  const { data } = await query.order('decided_at', { ascending: false }).limit(limit)
  return ((data ?? []) as unknown as CorrectionRow[]).map(mapRow)
}

export async function getMyCorrections(userId: string): Promise<CorrectionRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('punch_corrections')
    .select(SELECT)
    .or(`user_id.eq.${userId},requested_by_id.eq.${userId}`)
    .order('created_at', { ascending: false })
  return ((data ?? []) as unknown as CorrectionRow[]).map(mapRow)
}
