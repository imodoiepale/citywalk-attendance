'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function clockInAction() {
  const user = await requireUser()
  const supabase = await createClient()

  const { error } = await supabase.from('punches').insert({
    user_id: user.id,
    branch_id: user.branchId,
  })

  if (error) {
    // 23505 = unique_violation, from the "one open punch per user" index.
    throw new Error(error.code === '23505' ? 'You already have an open shift.' : error.message)
  }

  revalidatePath('/')
  revalidatePath('/calendar')
}

export async function clockOutAction() {
  const user = await requireUser()
  const supabase = await createClient()

  // .select() so we can tell "closed a shift" from "matched nothing" — without
  // it a clock-out with no open punch reports success and the UI silently lies.
  const { data, error } = await supabase
    .from('punches')
    .update({ clock_out_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('clock_out_at', null)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('You have no open shift.')

  revalidatePath('/')
  revalidatePath('/calendar')
}
