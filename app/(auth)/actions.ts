'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/site-url'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  if (!email || !password) {
    redirect(`/login?error=missing&next=${encodeURIComponent(next)}`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`)
  }

  redirect(next || '/')
}

export async function signUpAction(formData: FormData) {
  const fullName = String(formData.get('full_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const branchId = String(formData.get('branch_id') ?? '')

  if (!fullName || !email || !password || !branchId) {
    redirect('/signup?error=missing')
  }
  if (password.length < 8) {
    redirect('/signup?error=weak-password')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, branch_id: branchId },
    },
  })

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`)
  }

  // If the Supabase project has "Confirm email" enabled, signUp() won't
  // return a live session yet — send them to log in once confirmed
  // instead of redirecting into a route that will just bounce them back.
  if (!data.session) {
    redirect('/login?notice=check-email')
  }

  redirect('/')
}

export async function signOutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function setPasswordAction(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) {
    redirect('/set-password?error=weak-password')
  }
  if (password !== confirm) {
    redirect('/set-password?error=mismatch')
  }

  const supabase = await createClient()
  // Relies on the session established by the recovery link in
  // app/(auth)/callback/route.ts — updateUser applies to the current user, so
  // there is no way to aim this at somebody else's account.
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    redirect(`/set-password?error=${encodeURIComponent(error.message)}`)
  }

  // Admin-created accounts start with must_change_password=true; this is the
  // one place that clears it, whether the session came from a recovery link
  // or a normal sign-in with the generated temp password.
  await supabase.rpc('clear_must_change_password')

  redirect('/?notice=password-set')
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect('/forgot-password?error=missing')
  }

  const supabase = await createClient()
  // Resolved server-side, never from the submitted form: see lib/site-url.ts.
  // Supabase appends token_hash/type to this URL; /callback verifies it
  // server-side via verifyOtp.
  const siteUrl = await getSiteUrl()
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/callback`,
  })

  // Always report the same thing, sent or not: telling an anonymous visitor
  // whether an address has an account here is an account-enumeration leak.
  redirect('/login?notice=reset-sent')
}

/**
 * Changes the password of the already-signed-in user.
 *
 * Distinct from setPasswordAction, which exists to complete a recovery link:
 * there the mailed token is the proof of identity. Here the person is simply
 * signed in, and a session left open on a shared branch terminal is exactly the
 * situation where an unverified change would let a passer-by take the account.
 * So the current password is checked first, against a throwaway client whose
 * session is never persisted — verifying with the request's own client would
 * rewrite the auth cookies as a side effect of a mere password check.
 */
export async function changePasswordAction(formData: FormData) {
  const current = String(formData.get('currentPassword') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) redirect('/me?error=weak-password')
  if (password !== confirm) redirect('/me?error=mismatch')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login?error=link-expired')

  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { error: wrongPassword } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current,
  })
  if (wrongPassword) redirect('/me?error=wrong-password')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect(`/me?error=${encodeURIComponent(error.message)}`)

  redirect('/me?notice=password-changed')
}
