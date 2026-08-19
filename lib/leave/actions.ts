'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { createClient } from '@/lib/supabase/server'

export async function fileLeaveRequestAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createClient()

  const requesterId = String(formData.get('requester_id') ?? user.id) || user.id
  const type = String(formData.get('type') ?? '')
  const startDate = String(formData.get('start_date') ?? '')
  const endDate = String(formData.get('end_date') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null

  if (!type || !startDate || !endDate) {
    redirect('/leave/new?error=missing')
  }

  const onBehalf = requesterId !== user.id
  if (onBehalf && !canAtLeast(user.permissions, user.role, 'leave.request.on_behalf', 'branch')) {
    redirect('/leave/new?error=forbidden')
  }

  let branchId = user.branchId
  if (onBehalf) {
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('branch_id')
      .eq('id', requesterId)
      .single()
    if (!requesterProfile) {
      redirect('/leave/new?error=missing')
    }
    branchId = requesterProfile.branch_id
  }

  const { error } = await supabase.from('leave_requests').insert({
    requester_id: requesterId,
    filed_by_id: user.id,
    branch_id: branchId,
    type,
    start_date: startDate,
    end_date: endDate,
    reason,
  })

  if (error) {
    redirect(`/leave/new?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/leave')
  revalidatePath('/leave/approvals')
  redirect('/leave')
}

export async function cancelLeaveRequestAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()
  const id = String(formData.get('id') ?? '')

  const { error } = await supabase.rpc('cancel_leave_request', { p_id: id })
  if (error) throw new Error(error.message)

  revalidatePath('/leave')
}

export async function decideLeaveRequestAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()
  const id = String(formData.get('id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '').trim() || null

  const { error } = await supabase.rpc('decide_leave_request', {
    p_id: id,
    p_decision: decision,
    p_note: note,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/leave/approvals')
  revalidatePath('/leave')
}
