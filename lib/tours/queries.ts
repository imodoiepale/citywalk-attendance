import 'server-only'
import { createClient } from '@/lib/supabase/server'

/** Tour ids this person has already completed. RLS restricts it to self. */
export async function getCompletedTourIds(): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('user_tour_progress').select('tour_id')
  return (data ?? []).map((row) => row.tour_id)
}
