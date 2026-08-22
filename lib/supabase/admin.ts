import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client. Used only after a biometric request has passed its HMAC
// check, plus future out-of-band scripts. Never import this into client code:
// the key bypasses RLS.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
