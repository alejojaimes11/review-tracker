import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { getAdminUserId } from '../_shared/admin.ts'

// Deployed with verify_jwt = false: the admin check below is the gate.
// The subscription is always attached to the caller resolved from their
// token — the body can never name another user.

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const userId = await getAdminUserId(req, supabase)
    if (!userId) return json({ error: 'Solo el administrador puede activar notificaciones.' }, 403)

    const body = await req.json()

    if (body.action === 'unsubscribe') {
      const endpoint = body.endpoint
      if (typeof endpoint !== 'string') return json({ error: 'Falta el endpoint.' }, 400)
      // Scoped to the caller's own rows.
      const { error } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint)
        .eq('user_id', userId)
      if (error) throw new Error(error.message)
      return json({ ok: true })
    }

    if (body.action === 'subscribe') {
      const sub = body.subscription
      const endpoint = sub?.endpoint
      const p256dh = sub?.keys?.p256dh
      const auth = sub?.keys?.auth
      if (
        typeof endpoint !== 'string' ||
        !endpoint.startsWith('https://') ||
        endpoint.length > 2048 ||
        typeof p256dh !== 'string' ||
        typeof auth !== 'string' ||
        p256dh.length > 256 ||
        auth.length > 256
      ) {
        return json({ error: 'Suscripción inválida.' }, 400)
      }

      // The same endpoint can only ever belong to an admin device — never let
      // this function re-point a business subscription.
      const { data: existing } = await supabase
        .from('push_subscriptions')
        .select('audience')
        .eq('endpoint', endpoint)
        .maybeSingle()
      if (existing && existing.audience !== 'admin') {
        return json({ error: 'Este dispositivo ya está registrado.' }, 409)
      }

      // Upsert on the unique endpoint: re-activating never creates a second row.
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          audience: 'admin',
          business_id: null,
          endpoint,
          p256dh,
          auth,
          enabled: true,
          failure_count: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      )
      if (error) throw new Error(error.message)
      return json({ ok: true }, 201)
    }

    return json({ error: 'Acción desconocida.' }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 400)
  }
})
