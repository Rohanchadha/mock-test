'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createSession,
  deleteSession,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
} from '@/lib/session'
import { z } from 'zod'

const loginSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().regex(
    /^\+?[1-9]\d{9,14}$/,
    'Enter a valid phone number (10–15 digits, optional + prefix)'
  ),
  email: z.string().email('Enter a valid email address'),
})

const otpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
})

// Step 1: validate inputs, send OTP email, store pending data in cookie
export async function sendOtp(_prevState: unknown, formData: FormData) {
  const raw = {
    name: (formData.get('name') as string)?.trim() ?? '',
    phone: (formData.get('phone') as string)?.trim() ?? '',
    email: (formData.get('email') as string)?.trim() ?? '',
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { name, phone, email } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })

  if (error) {
    if (error.status === 429) {
      return { error: 'Too many attempts. Please wait a few minutes and try again.' }
    }
    return { error: 'Failed to send verification code. Please try again.' }
  }

  await createPendingLogin({ name, phone, email })
  redirect('/verify')
}

// Step 2: verify the OTP, upsert user, create custom session
export async function verifyOtp(_prevState: unknown, formData: FormData) {
  const pending = await getPendingLogin()
  if (!pending) redirect('/') // cookie expired — restart

  const raw = { otp: (formData.get('otp') as string)?.trim() ?? '' }
  const parsed = otpSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { email, name, phone } = pending
  const supabase = await createClient()

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: parsed.data.otp,
    type: 'email',
  })

  if (verifyError) {
    return { error: 'Invalid or expired code. Check your email and try again.' }
  }

  // OTP verified — upsert user in custom table via admin client
  const adminClient = createAdminClient()
  const { data: user, error: upsertError } = await adminClient
    .from('users')
    .upsert(
      { phone, name, email },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (upsertError || !user) {
    return { error: 'Something went wrong. Please try again.' }
  }

  await createSession({ userId: user.id, phone: user.phone, name: user.name })
  await deletePendingLogin()
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
