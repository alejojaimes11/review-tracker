import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { getAdminUserId } from '../_shared/admin.ts'
import { generateToken, hashToken } from '../_shared/client-auth.ts'

// Admin: manage the private client links of a business.
// Deployed with verify_jwt = false: getAdminUserId (server-side, from the caller's
// token + admin_users) is the gate.
//
// The token is returned ONLY by create / regenerate, in that one response. list never
// returns tokens (only the short prefix), and nothing here logs a token.
//
// Actions: list | create | regenerate | revoke

const PREFIX_LENGTH = 6
const MAX_LABEL_LENGTH = 60

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

interface LinkRow {
  id: string
  business_id: string
  token_prefix: string
  label: string | null
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
}

const COLUMNS = 'id, business_id, token_prefix, label, created_at, expires_at, revoked_at, last_used_at'

function statusOf(row: LinkRow): 'active' | 'revoked' | 'expired' {
  if (row.revoked_at) return 'revoked'
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

async function withDevices(supabase: SupabaseClient, rows: LinkRow[]) {
  const counts = new Map<string, number>()
  if (rows.length > 0) {
    const { data } = await supabase
      .from('push_subscriptions')
      .select('link_id')
      .in('link_id', rows.map((r) => r.id))
      .eq('enabled', true)
    for (const s of data ?? []) counts.set(s.link_id, (counts.get(s.link_id) ?? 0) + 1)
  }
  return rows.map((r) => ({ ...r, status: statusOf(r), devices: counts.get(r.id) ?? 0 }))
}

async function newCredentials() {
  const token = generateToken()
  return { token, hash: await hashToken(token), prefix: token.slice(0, PREFIX_LENGTH) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const adminId = await getAdminUserId(req, supabase)
    if (!adminId) return json({ error: 'Solo el administrador puede gestionar los enlaces.' }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Solicitud inválida.' }, 400)

    if (body.action === 'list') {
      if (!isUuid(body.business_id)) return json({ error: 'Falta el negocio.' }, 400)
      const { data, error } = await supabase
        .from('business_access_links')
        .select(COLUMNS)
        .eq('business_id', body.business_id)
        .order('created_at', { ascending: false })
      if (error) throw new Error('No se pudieron leer los enlaces.')
      return json({ links: await withDevices(supabase, (data ?? []) as LinkRow[]) })
    }

    if (body.action === 'create') {
      if (!isUuid(body.business_id)) return json({ error: 'Falta el negocio.' }, 400)
      const label =
        typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, MAX_LABEL_LENGTH) : null

      const { data: business } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', body.business_id)
        .is('deleted_at', null)
        .maybeSingle()
      if (!business) return json({ error: 'Negocio no encontrado.' }, 404)

      const { token, hash, prefix } = await newCredentials()
      const { data, error } = await supabase
        .from('business_access_links')
        .insert({ business_id: business.id, token_hash: hash, token_prefix: prefix, label, created_by: adminId })
        .select(COLUMNS)
        .single()
      if (error) throw new Error('No se pudo crear el enlace.')
      const [link] = await withDevices(supabase, [data as LinkRow])
      return json({ link, token }, 201)
    }

    if (body.action === 'regenerate') {
      if (!isUuid(body.link_id)) return json({ error: 'Falta el enlace.' }, 400)
      const { token, hash, prefix } = await newCredentials()
      const { data: newId, error } = await supabase.rpc('regenerate_access_link', {
        p_link_id: body.link_id,
        p_token_hash: hash,
        p_token_prefix: prefix,
        p_created_by: adminId,
      })
      if (error) throw new Error('No se pudo regenerar el enlace.')
      if (!newId) return json({ error: 'Enlace no encontrado.' }, 404)
      const { data } = await supabase.from('business_access_links').select(COLUMNS).eq('id', newId).single()
      const [link] = await withDevices(supabase, [data as LinkRow])
      return json({ link, token }, 201)
    }

    if (body.action === 'revoke') {
      if (!isUuid(body.link_id)) return json({ error: 'Falta el enlace.' }, 400)
      const { data: ok, error } = await supabase.rpc('revoke_access_link', { p_link_id: body.link_id })
      if (error) throw new Error('No se pudo revocar el enlace.')
      if (!ok) return json({ error: 'Enlace no encontrado.' }, 404)
      return json({ ok: true })
    }

    return json({ error: 'Acción desconocida.' }, 400)
  } catch (err) {
    console.error('admin-client-links error:', err instanceof Error ? err.message : 'unknown')
    return json({ error: 'No se pudo completar la solicitud.' }, 500)
  }
})
