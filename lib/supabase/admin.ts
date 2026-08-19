import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client. Deliberately unused by any user-facing request path
// today — every privileged write goes through a security-definer RPC
// (admin_set_role, admin_set_active, decide_leave_request, ...) so RLS
// stays the enforcement layer. Keep this only for future out-of-band
// scripts (bulk imports, migrations) run outside the request lifecycle.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
