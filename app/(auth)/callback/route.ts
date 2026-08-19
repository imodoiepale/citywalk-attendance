import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Where Supabase sends people back to after a recovery or confirmation link.
// The link hits Supabase's /auth/v1/verify first, which redirects here with a
// one-time `code`; exchanging it is what actually establishes the cookie
// session. Without this route a recovery link lands on a page that has no idea
// what to do with the token, which is exactly what used to happen.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type')
  // Only ever redirect to a path on this origin — an attacker-supplied
  // absolute URL here would turn the callback into an open redirect.
  const rawNext = searchParams.get('next') ?? ''
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link-invalid`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Recovery links are single-use and time-limited; a second click lands here.
    return NextResponse.redirect(`${origin}/login?error=link-expired`)
  }

  // A recovery link means the whole point is to choose a new password.
  if (type === 'recovery' || next === '/set-password') {
    return NextResponse.redirect(`${origin}/set-password`)
  }

  return NextResponse.redirect(`${origin}${next ?? '/'}`)
}
