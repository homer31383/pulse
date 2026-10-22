import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL')
if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

// Server-side only client using the service role key.
// This bypasses RLS — only import in Server Components and API Routes.
// Never import in 'use client' files.
//
// SUPABASE_SERVICE_ROLE_KEY may be a legacy JWT (eyJ...) or the new non-JWT
// secret key (sb_secret_...). supabase-js sends `Authorization: Bearer <key>`
// when there is no user session, and a non-JWT key must never go out as a
// Bearer token, so keyAwareFetch strips that header and sends the key only as
// `apikey` (the gateway maps a secret apikey to service_role). Covers
// PostgREST and Storage alike.
export function isJwtKey(key: string): boolean {
  return key.startsWith('eyJ') && key.split('.').length === 3
}

export function keyAwareFetch(key: string): typeof fetch {
  if (isJwtKey(key)) return fetch
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization')
    headers.set('apikey', key)
    return fetch(input, { ...init, headers })
  }
}

export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
  global: { fetch: keyAwareFetch(serviceRoleKey) },
})
