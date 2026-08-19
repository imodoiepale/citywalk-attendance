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
