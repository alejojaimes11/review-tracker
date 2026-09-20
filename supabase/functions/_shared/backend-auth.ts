import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Backend-only guard for functions that must run from the cron / server side
 * and never from a browser (notification-engine, sync-businesses).
 *
 * verify_jwt alone is not enough: the gateway also lets the public
 * publishable key through. So the caller has to prove it holds a key that can
 * read a table only service_role can read. This works for any key format
 * (legacy JWT or sb_secret_...), and it rejects the public key, a logged-in
 * user's token and forged tokens.
 */
export async function callerIsBackend(req: Request): Promise<boolean> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return false
  const probe = createClient(Deno.env.get('SUPABASE_URL')!, token, { auth: { persistSession: false } })
  const { error } = await probe.from('admin_users').select('user_id').limit(1)
  return !error
}
