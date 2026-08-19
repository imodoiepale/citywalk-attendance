import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// For use in Server Components and Server Actions. `setAll` can throw when
// called from a Server Component (cookies are read-only there) — that's
// expected and safe to ignore, since the proxy (app/proxy.ts) refreshes
// the session on every request regardless.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — ignore, see comment above.
          }
        },
      },
    }
  )
}
