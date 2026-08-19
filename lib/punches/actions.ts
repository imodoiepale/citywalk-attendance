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
  await requireUser()
  const supabase = await createClient()

  // Via RPC rather than a direct update so the close timestamp comes from the
  // database clock, the same source as clock_in_at's default. Sending a time
  // from this Node process compared the two against each other across the
  // punches_out_after_in constraint, and any skew rejected the clock-out.
  const { data, error } = await supabase.rpc('clock_out')

  if (error) throw new Error(error.message)
  // A null row means nothing was open — an ordinary mis-tap, not a failure,
  // so the RPC returns rather than raising and we phrase it here.
  if (!data?.id) throw new Error('You have no open shift.')

  revalidatePath('/')
  revalidatePath('/calendar')
}
