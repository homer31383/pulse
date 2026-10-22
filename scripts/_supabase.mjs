// Shared service-role client for the local diagnostic scripts.
//
// SUPABASE_SERVICE_ROLE_KEY may be a legacy JWT (eyJ...) or the new non-JWT
// secret key (sb_secret_...). supabase-js sends `Authorization: Bearer <key>`
// when there is no user session, and a non-JWT key must never go out as a
// Bearer token, so the fetch below strips that header and sends the key only
// as `apikey`. Same guard as lib/supabase.ts.
import { createClient } from '@supabase/supabase-js'

function keyAwareFetch(key) {
  if (key.startsWith('eyJ') && key.split('.').length === 3) return fetch
  return (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.get('Authorization') === `Bearer ${key}`) headers.delete('Authorization')
    headers.set('apikey', key)
    return fetch(input, { ...init, headers })
  }
}

export function serviceClient(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: keyAwareFetch(key) },
  })
}
