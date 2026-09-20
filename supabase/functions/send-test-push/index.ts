import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { getAdminUserId } from '../_shared/admin.ts'
import { sendPush } from '../_shared/push.ts'

// Testing only (phase 1). Deployed with verify_jwt = false: the admin check
// below is the gate. Sends a test push to the caller's own active devices.
//
// Optional body { delay_seconds } (0-30): answer immediately and send in the
// background after the delay, so the admin can close the tab and see the
// notification arrive with the app closed.

// After this many consecutive failures (other than "gone") a device is switched off.
const MAX_FAILURES = 5
const MAX_DELAY_SECONDS = 30

// Provided by the Supabase Edge Runtime: keeps the isolate alive for background work.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

interface Sub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number
}

async function sendToAll(supabase: SupabaseClient, subs: Sub[]) {
  let sent = 0
  let failed = 0
  let disabled = 0
  const details: { status: number | null; message?: string }[] = []

  for (const sub of subs) {
    const result = await sendPush(sub, {
      title: 'Review Tracker',
      body: '🔔 Esta es una notificación de prueba.',
      url: '/',
    })

    if (result.ok) {
      sent++
      details.push({ status: 201 })
      await supabase
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', sub.id)
    } else {
      failed++
      details.push({ status: result.status, message: result.message.slice(0, 160) })
      const failures = sub.failure_count + 1
      // 404/410 = the browser dropped the subscription: switch it off right away.
      const switchOff = result.gone || failures >= MAX_FAILURES
      if (switchOff) disabled++
      await supabase
        .from('push_subscriptions')
        .update({ failure_count: failures, ...(switchOff ? { enabled: false } : {}) })
        .eq('id', sub.id)
    }
  }

  return { sent, failed, disabled, details }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const userId = await getAdminUserId(req, supabase)
    if (!userId) return json({ error: 'Solo el administrador puede enviar notificaciones de prueba.' }, 403)

    const body = await req.json().catch(() => ({}))
    const delay = Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.floor(Number(body?.delay_seconds) || 0)))

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, failure_count')
      .eq('user_id', userId)
      .eq('audience', 'admin')
      .eq('enabled', true)
    if (error) throw new Error(error.message)

    if (!subs || subs.length === 0) {
      return json({ error: 'No hay dispositivos con notificaciones activas.' }, 404)
    }

    if (delay > 0) {
      EdgeRuntime.waitUntil(
        new Promise((resolve) => setTimeout(resolve, delay * 1000)).then(() => sendToAll(supabase, subs)),
      )
      return json({ scheduled: true, delay_seconds: delay, devices: subs.length }, 202)
    }

    return json(await sendToAll(supabase, subs))
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 400)
  }
})
