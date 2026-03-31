'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSession, deleteSession } from '@/lib/session'
import { z } from 'zod'

const loginSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().regex(
    /^\+?[1-9]\d{9,14}$/,
    'Enter a valid phone number (10–15 digits, optional + prefix)'
  ),
})

export async function loginDirect(_prevState: unknown, formData: FormData) {
  const raw = {
    name: (formData.get('name') as string)?.trim() ?? '',
    phone: (formData.get('phone') as string)?.trim() ?? '',
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { name, phone } = parsed.data
  const adminClient = createAdminClient()

  // Look up existing user by phone
  const { data: existingUser } = await adminClient
    .from('users')
    .select('id, phone, name')
    .eq('phone', phone)
    .maybeSingle()

  let userId: string

  if (existingUser) {
    // Update name in case it changed
    const { error: updateError } = await adminClient
      .from('users')
      .update({ name })
      .eq('id', existingUser.id)
    if (updateError) {
      return { error: 'Something went wrong. Please try again.' }
    }
    userId = existingUser.id
  } else {
    // New user — create record
    const { data: newUser, error: insertError } = await adminClient
      .from('users')
      .insert({ phone, name })
      .select('id')
      .single()
    if (insertError || !newUser) {
      return { error: 'Something went wrong. Please try again.' }
    }
    userId = newUser.id
  }

  await createSession({ userId, phone, name })
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
