'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// Every write here goes through a security-definer RPC — same convention as
// lib/corrections/actions.ts. Deletion is deliberately narrower than
// correction: a punch may be deleted for any documented reason, but a raw
// scan may only be deleted once it's flagged 'duplicate' — see
// admin_delete_punch / admin_delete_duplicate_event for why.

export async function deletePunchAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) throw new Error('Say why this punch is being deleted.')

  const { error } = await supabase.rpc('admin_delete_punch', { p_id: id, p_reason: reason })
  if (error) throw new Error(error.message)

  revalidatePath('/attendance/punches')
  revalidatePath('/calendar')
  revalidatePath('/reports/timesheets')
  revalidatePath('/admin/audit')
}

export async function deleteDuplicateEventAction(formData: FormData) {
  await requireUser()
  const supabase = await createClient()

  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!reason) throw new Error('Say why this scan is being deleted.')

  const { error } = await supabase.rpc('admin_delete_duplicate_event', { p_id: id, p_reason: reason })
  if (error) throw new Error(error.message)

  revalidatePath('/admin/devices/duplicates')
  revalidatePath('/admin/audit')
}
