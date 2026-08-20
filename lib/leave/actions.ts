'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { createClient } from '@/lib/supabase/server'

/**
 * Result shape for useActionState. Deliberately returns instead of redirecting:
 * redirect() throws, so from inside the request-leave dialog it would navigate
 * the whole page out from under the open modal rather than surface the problem
 * next to the field that caused it.
 */
export interface LeaveFormState {
  ok?: boolean
  error?: string
}

export async function fileLeaveRequestAction(
  _prevState: LeaveFormState,
  formData: FormData
): Promise<LeaveFormState> {
  const user = await requireUser()
  const supabase = await createClient()

  const requesterId = String(formData.get('requester_id') ?? user.id) || user.id
  const type = String(formData.get('type') ?? '')
  const startDate = String(formData.get('start_date') ?? '')
  const endDate = String(formData.get('end_date') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || null

  if (!type || !startDate || !endDate) {
    return { error: 'missing' }
  }
  if (endDate < startDate) {
    return { error: 'The end date cannot be before the start date.' }
  }

  const onBehalf = requesterId !== user.id
  if (onBehalf && !canAtLeast(user.permissions, user.role, 'leave.request.on_behalf', 'branch')) {
    return { error: 'forbidden' }
  }

  let branchId = user.branchId
  if (onBehalf) {
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('branch_id')
      .eq('id', requesterId)
      .single()
    if (!requesterProfile) {
      return { error: 'missing' }
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
    return { error: error.message }
  }

  // These two alone refresh the list behind the dialog — the old
  // redirect('/leave') is what used to do it, and is not needed now.
  revalidatePath('/leave')
  revalidatePath('/leave/approvals')
  return { ok: true }
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

/**
 * Marks the caller's decided leave as seen. Called once the dashboard has
 * actually shown the toast, so a decision cannot be announced twice — or
 * silently swallowed if the page never rendered.
 */
export async function acknowledgeLeaveDecisionsAction(): Promise<void> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('acknowledge_leave_decisions')
  if (error) throw new Error(error.message)
  revalidatePath('/')
}
