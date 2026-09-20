import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Server-side admin check for functions deployed with verify_jwt = false.
 * Resolves the caller from their access token (never from the request body)
 * and confirms they are listed in admin_users. `supabase` must be a
 * service_role client. Returns the user id, or null if not an admin.
 */
export async function getAdminUserId(req: Request, supabase: SupabaseClient): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null

  const { data: admin } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()

  return admin ? data.user.id : null
}
