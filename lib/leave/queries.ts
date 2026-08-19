import 'server-only'
import { createClient } from '@/lib/supabase/server'

export interface LeaveRequestRecord {
  id: string
  requesterId: string
  requesterName: string
  filedById: string
  filedByName: string
  branchId: string
  type: string
  startDate: string
  endDate: string
  reason: string | null
  status: string
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}

const SELECT = `
  id, requester_id, filed_by_id, branch_id, type, start_date, end_date,
  reason, status, decided_at, decision_note, created_at,
  requester:profiles!leave_requests_requester_id_fkey(full_name),
  filed_by:profiles!leave_requests_filed_by_id_fkey(full_name),
  decided_by:profiles!leave_requests_decided_by_id_fkey(full_name)
`

type NameEmbed = { full_name: string } | { full_name: string }[] | null

function oneName(embed: NameEmbed): string | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0]?.full_name ?? null) : embed.full_name
}

interface LeaveRequestRow {
  id: string
  requester_id: string
  filed_by_id: string
  branch_id: string
  type: string
  start_date: string
  end_date: string
  reason: string | null
  status: string
  decided_at: string | null
  decision_note: string | null
  created_at: string
  requester: NameEmbed
  filed_by: NameEmbed
  decided_by: NameEmbed
}

function mapRow(row: LeaveRequestRow): LeaveRequestRecord {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: oneName(row.requester) ?? 'Unknown',
    filedById: row.filed_by_id,
    filedByName: oneName(row.filed_by) ?? 'Unknown',
    branchId: row.branch_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    decidedByName: oneName(row.decided_by),
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  }
}

export async function getMyLeaveRequests(userId: string): Promise<LeaveRequestRecord[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('leave_requests')
    .select(SELECT)
    .or(`requester_id.eq.${userId},filed_by_id.eq.${userId}`)
    .order('created_at', { ascending: false })

  return ((data ?? []) as unknown as LeaveRequestRow[]).map(mapRow)
}

export async function getApprovalQueue(branchId: string, orgWide: boolean): Promise<LeaveRequestRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('leave_requests').select(SELECT).eq('status', 'pending')
  if (!orgWide) {
    query = query.eq('branch_id', branchId)
  }
  const { data } = await query.order('created_at', { ascending: true })

  return ((data ?? []) as unknown as LeaveRequestRow[]).map(mapRow)
}

export interface BranchStaffOption {
  id: string
  fullName: string
}

export async function getBranchStaff(branchId: string, orgWide: boolean): Promise<BranchStaffOption[]> {
  const supabase = await createClient()
  let query = supabase.from('profiles').select('id, full_name').eq('is_active', true)
  if (!orgWide) {
    query = query.eq('branch_id', branchId)
  }
  const { data } = await query.order('full_name')
  return (data ?? []).map((row) => ({ id: row.id, fullName: row.full_name }))
}
