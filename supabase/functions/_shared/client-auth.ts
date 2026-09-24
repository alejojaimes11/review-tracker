import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

// Private client links (Phase 3.1).
//
// A token is 32 random bytes as base64url (43 chars = 256 bits). Only its SHA-256
// is stored; the token itself is shown once, when it is created, and never again.
// Never log a token, never echo it back, never put it in an error message.

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface AccessLink {
  id: string
  business_id: string
}

export type LinkResult =
  | { ok: true; link: AccessLink }
  | { ok: false; reason: 'invalid' | 'revoked' | 'expired' }

/**
 * Resolves a token to its link. The business always comes from the link — callers
 * must never take a business id from the request body. `supabase` is service_role.
 */
export async function resolveAccessLink(supabase: SupabaseClient, token: unknown): Promise<LinkResult> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return { ok: false, reason: 'invalid' }

  const { data } = await supabase
    .from('business_access_links')
    .select('id, business_id, revoked_at, expires_at')
    .eq('token_hash', await hashToken(token))
    .maybeSingle()

  if (!data) return { ok: false, reason: 'invalid' }
  if (data.revoked_at) return { ok: false, reason: 'revoked' }
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, link: { id: data.id, business_id: data.business_id } }
}
