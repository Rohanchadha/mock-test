'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createSession, deleteSession } from '@/lib/session'

export async function login(_prevState: unknown, formData: FormData) {
  const name = (formData.get('name') as string)?.trim()
  const phone = (formData.get('phone') as string)?.trim()
  const email = (formData.get('email') as string)?.trim() || null

  if (!name || !phone) {
    return { error: 'Name and phone number are required.' }
  }

  const supabase = await createClient()

  // Upsert user by phone — creates on first login, returns existing on subsequent logins
  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      { phone, name, email },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error || !user) {
    return { error: 'Something went wrong. Please try again.' }
  }

  await createSession({ userId: user.id, phone: user.phone, name: user.name })
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
