'use server'

import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Marks a tour finished for the signed-in person.
 *
 * Deliberately not revalidating any path: the completion only affects whether
 * the tour auto-starts on a *future* visit, and re-rendering the page the
 * moment someone finishes a walkthrough would be jarring.
 */
export async function completeTourAction(tourId: string): Promise<void> {
  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc('complete_tour', { p_tour_id: tourId })
  if (error) throw new Error(error.message)
}
