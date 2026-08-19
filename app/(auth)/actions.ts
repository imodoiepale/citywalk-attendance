'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

  redirect('/?notice=password-set')
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect('/forgot-password?error=missing')
  }

  const supabase = await createClient()
  const origin = String(formData.get('origin') ?? '')
  // Supabase appends token_hash/type to this URL; /callback verifies it
  // server-side via verifyOtp.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/callback`,
  })

  // Always report the same thing, sent or not: telling an anonymous visitor
  // whether an address has an account here is an account-enumeration leak.
  redirect('/login?notice=reset-sent')
}
