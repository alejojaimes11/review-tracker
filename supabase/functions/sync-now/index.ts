import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { getAdminUserId } from '../_shared/admin.ts'

// Admin button "Actualizar reseñas": runs a full sync of every active business
// right now. sync-businesses only accepts backend callers, so the browser can't
// call it; this function is the gate — it verifies the caller is an admin
// (server-side, from their token) and then triggers the sync with the backend key.
//
// It answers right away and lets the sync run in the background (a full sync can
// take a minute or two); the sync itself records the results, and the Notification
// Engine turns any growth into a push on its next cycle (within ~15 min).
//
// Deployed with verify_jwt = false: the admin check below is the gate.

// A sync that ran this recently is assumed to still be running: avoid a double
// click burning Apify credit twice.
const RECENT_ACTIVITY_SECONDS = 90

// Provided by the Supabase Edge Runtime: keeps the isolate alive for background work.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(url, serviceKey)

    const userId = await getAdminUserId(req, supabase)
    if (!userId) return json({ error: 'Solo el administrador puede actualizar las reseñas.' }, 403)

    const { data: latest } = await supabase
      .from('businesses')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest && Date.now() - new Date(latest.updated_at).getTime() < RECENT_ACTIVITY_SECONDS * 1000) {
      return json({ error: 'Ya hay una actualización en curso. Esperá un minuto.' }, 409)
    }

    const startedAt = new Date().toISOString()
    EdgeRuntime.waitUntil(
      fetch(`${url}/functions/v1/sync-businesses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({ force: true }),
      })
        .then((r) => r.text())
        .catch(() => {}),
    )

    return json({ started: true, started_at: startedAt }, 202)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 400)
  }
})
