import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

// Client (business owner) API. The private link token is the only credential; it goes
// in the request body (never in a URL of an API call) and is never logged.

const TOKEN_KEY = 'mp_client_token'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Always the anon key: a client has no session, and an admin session must not change how this behaves. */
const FUNCTION_HEADERS = { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }

export interface ClientBusiness {
  name: string
  photo_url: string | null
  category: string | null
  current_rating: number | null
  current_reviews: number
  gained: number
  gained_this_month: number
  series: number[]
}

export type ClientViewResult = { available: true; business: ClientBusiness } | { available: false }

export class ClientApiError extends Error {
  status: number | null
  code: string | null

  constructor(message: string, status: number | null, code: string | null) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function callClientApi<T>(action: string, token: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('client-api', {
    body: { action, token, ...extra },
    headers: FUNCTION_HEADERS,
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new ClientApiError(payload?.error ?? 'No se pudo completar la solicitud.', error.context.status, payload?.code ?? null)
    }
    throw new ClientApiError('No hay conexión con el servidor.', null, null)
  }
  return data as T
}

/** Accepts a raw token or a pasted link (…/c/<token>) and returns the token, or null. */
export function extractToken(input: string): string | null {
  const trimmed = input.trim()
  if (TOKEN_PATTERN.test(trimmed)) return trimmed
  const match = trimmed.match(/\/c\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/)
  return match ? match[1] : null
}

// localStorage is a convenience only (so /c can reopen the last link). It can throw or be empty
// (private mode, cleared data, and the installed iOS app has its own separate storage).
export function readStoredToken(): string | null {
  try {
    const value = localStorage.getItem(TOKEN_KEY)
    return value && TOKEN_PATTERN.test(value) ? value : null
  } catch {
    return null
  }
}

export function storeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* convenience only */
  }
}

export function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* convenience only */
  }
}
