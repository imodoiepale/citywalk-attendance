'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// Every write here goes through a security-definer RPC. The app never updates
// punches or punch_corrections directly — that's what keeps the audit trail
// honest and the authorization checks in one place (see migration ...0003).

function combineNairobi(dateKey: string, time: string): string {
  // "HH:MM" on a Nairobi day -> a UTC instant. +03:00 is fixed year-round.
  return new Date(`${dateKey}T${time}:00+03:00`).toISOString()
}

export async function requestCorrectionAction(formData: FormData) {
  const user = await requireUser()
  const supabase = await createClient()

  const dateKey = String(formData.get('dateKey') ?? '')
  const clockIn = String(formData.get('clockIn') ?? '')
  const clockOut = String(formData.get('clockOut') ?? '')
  const reason = String(formData.get('reason') ?? '')
  const punchId = String(formData.get('punchId') ?? '') || null
  const userId = String(formData.get('userId') ?? '') || user.id

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Pick a valid date.')
  if (!/^\d{2}:\d{2}$/.test(clockIn)) throw new Error('Enter a clock-in time.')
  if (clockOut && !/^\d{2}:\d{2}$/.test(clockOut)) throw new Error('Enter a valid clock-out time.')
  if (!reason.trim()) throw new Error('Say why this punch needs correcting.')

  const proposedIn = combineNairobi(dateKey, clockIn)
  let proposedOut = clockOut ? combineNairobi(dateKey, clockOut) : null

  // A shift that ends "before" it starts crossed midnight — roll the end into
  // the next day rather than rejecting it. Night shifts are real here.
  if (proposedOut && new Date(proposedOut) <= new Date(proposedIn)) {
    proposedOut = new Date(new Date(proposedOut).getTime() + 24 * 60 * 60 * 1000).toISOString()
  }

  const { error } = await supabase.rpc('request_punch_correction', {
    p_user_id: userId,
    p_punch_id: punchId,
    p_clock_in_at: proposedIn,
    p_clock_out_at: proposedOut,
    p_reason: reason.trim(),
  })
  if (error) throw new Error(error.message)

  revalidatePath('/attendance/corrections')
  revalidatePath(`/calendar/${dateKey}`)
  revalidatePath('/calendar')
}

export async function decideCorrectionAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('Invalid decision.')
  }

  const { error } = await supabase.rpc('decide_punch_correction', {
    p_id: id,
    p_decision: decision,
    p_note: note || null,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/attendance/corrections')
  revalidatePath('/calendar')
  revalidatePath('/reports/timesheets')
}

export async function cancelCorrectionAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const { error } = await supabase.rpc('cancel_punch_correction', {
    p_id: String(formData.get('id') ?? ''),
  })
  if (error) throw new Error(error.message)

  revalidatePath('/attendance/corrections')
  revalidatePath('/calendar')
}
