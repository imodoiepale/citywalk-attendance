import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Where Supabase sends people back to after a recovery or confirmation link.
// Without this route a recovery link lands on a page that has no idea what to
// do with the token, which is what used to happen.
//
// Two shapes arrive here, and both have to work:
//
//  ?token_hash=...&type=recovery  — the server-side verifyOtp flow. This is
//    what email templates and admin-generated links produce, and the only one
//    that works without the browser having started the flow.
//  ?code=...                      — the PKCE exchange, for links this app
//    itself initiated (resetPasswordForEmail), where the code_verifier cookie
//    exists.
//
// The implicit flow's #access_token fragment is deliberately not handled: a
// fragment never reaches the server, so it cannot be read here at all.

const VALID_TYPES: EmailOtpType[] = ['recovery', 'signup', 'invite', 'magiclink', 'email_change']

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (VALID_TYPES as string[]).includes(value)
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // Only ever redirect to a path on this origin — an attacker-supplied
  // absolute URL here would turn the callback into an open redirect.
  const rawNext = searchParams.get('next') ?? ''
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null

  const supabase = await createClient()

  let failed = true
  if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    failed = Boolean(error)
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    failed = Boolean(error)
  } else {
    return NextResponse.redirect(`${origin}/login?error=link-invalid`)
  }

  if (failed) {
    // These links are single-use and time-limited; a second click lands here.
    return NextResponse.redirect(`${origin}/login?error=link-expired`)
  }

  // A recovery link means the whole point is to choose a new password.
  if (type === 'recovery') {
    return NextResponse.redirect(`${origin}/set-password`)
  }

  return NextResponse.redirect(`${origin}${next ?? '/'}`)
}
