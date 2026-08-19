'use client'

import { createBrowserClient } from '@supabase/ssr'

// Cookie-based session storage (the @supabase/ssr default), not
// localStorage — required, not optional: branch devices are often
// shared kiosks, and a browser-local session would leak between staff
// using the same device after one signs out.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
