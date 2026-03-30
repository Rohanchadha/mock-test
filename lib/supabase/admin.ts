import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client using the service_role key.
 * Bypasses all Row Level Security.
 * ONLY use in server-side code (Server Components, API Routes, Server Actions).
 * NEVER import this in Client Components or expose to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set'
    )
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
