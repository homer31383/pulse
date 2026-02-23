import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

// Server-side only client using the service role key.
// This bypasses RLS — only import in Server Components and API Routes.
// Never import in 'use client' files.
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})
