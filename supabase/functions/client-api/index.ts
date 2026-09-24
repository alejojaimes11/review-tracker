import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { type AccessLink, resolveAccessLink } from '../_shared/client-auth.ts'
import { sendPush } from '../_shared/push.ts'

// Public API for a business owner who opens their private link (/c/<token>).
// Deployed with verify_jwt = false: clients have no login, the token IS the credential.
//
// Rules that hold for every action:
//  * the business is ALWAYS the one the token resolves to. The body can never name a
//    business, a link or a user;
//  * the token is only ever read from the request body and is never logged, echoed
//    back or included in an error message;
//  * invalid, revoked and expired links answer 403 and reveal nothing about the business.
//
// Actions: view | subscribe | unsubscribe | send_test

const MAX_DEVICES_PER_BUSINESS = 10
const TEST_COOLDOWN_SECONDS = 10
const MAX_TEST_DELAY_SECONDS = 30
const MAX_FAILURES = 5
const SERIES_DAYS = 30
const BOGOTA_OFFSET_HOURS = 5 // America/Bogota is UTC-5 all year (no DST)

// Provided by the Supabase Edge Runtime: keeps the isolate alive for background work.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

const LINK_MESSAGES = {
  invalid: 'Este enlace no es válido.',
  revoked: 'Este enlace fue desactivado. Pedile uno nuevo a quien te lo dio.',
  expired: 'Este enlace venció. Pedile uno nuevo a quien te lo dio.',
} as const

// ---------------------------------------------------------------------------
// view — a deliberately minimal projection of the business. It reads only the
// columns listed here, so internal fields (sync errors, phone, notes, billing,
// update frequency, low-usage days, negative-review flag) can never leak.
// ---------------------------------------------------------------------------

function monthStartUtc(now: Date): Date {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_HOURS * 3_600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, BOGOTA_OFFSET_HOURS, 0, 0))
}

interface Snap {
  review_count: number
  created_at: string
}

function dailySeries(snapshots: Snap[], days: number, now: Date): number[] {
  const cutoff = now.getTime() - days * 86_400_000
  const byDay = new Map<string, number>()
  for (const s of snapshots) {
    if (new Date(s.created_at).getTime() < cutoff) continue
    byDay.set(s.created_at.slice(0, 10), s.review_count)
  }
  return [...byDay.values()]
}

async function view(supabase: SupabaseClient, link: AccessLink) {
  const { data: business } = await supabase
    .from('businesses')
    .select('name, photo_url, category, status, deleted_at, initial_reviews, current_reviews, current_rating')
    .eq('id', link.business_id)
    .maybeSingle()

  if (!business || business.deleted_at !== null || business.status !== 'active') {
    return json({ available: false })
  }

  const now = new Date()
  const monthStart = monthStartUtc(now)
  const since = new Date(Math.min(monthStart.getTime(), now.getTime() - SERIES_DAYS * 86_400_000)).toISOString()
  const { data: rows } = await supabase
    .from('review_snapshots')
    .select('review_count, created_at')
    .eq('business_id', link.business_id)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  const snapshots = (rows ?? []) as Snap[]

  const inMonth = snapshots.filter((s) => new Date(s.created_at) >= monthStart)
  const gainedThisMonth = inMonth.length > 0 ? business.current_reviews - inMonth[0].review_count : 0

  await supabase
    .from('business_access_links')
    .update({ last_used_at: now.toISOString() })
    .eq('id', link.id)

  return json({
    available: true,
    business: {
      name: business.name,
      photo_url: business.photo_url,
      category: business.category,
      current_rating: business.current_rating,
      current_reviews: business.current_reviews,
      gained: business.current_reviews - business.initial_reviews,
      gained_this_month: gainedThisMonth,
      series: dailySeries(snapshots, SERIES_DAYS, now),
    },
  })
}

// ---------------------------------------------------------------------------
// subscribe / unsubscribe
// ---------------------------------------------------------------------------

async function subscribe(supabase: SupabaseClient, link: AccessLink, subscription: unknown) {
  // deno-lint-ignore no-explicit-any
  const sub = subscription as any
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

  const { data: business } = await supabase
    .from('businesses')
    .select('status, deleted_at')
    .eq('id', link.business_id)
    .maybeSingle()
  if (!business || business.deleted_at !== null || business.status !== 'active') {
    return json({ error: 'Este negocio no está disponible.' }, 409)
  }

  // An admin device can never be claimed (or re-pointed) through a client link.
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('audience')
    .eq('endpoint', endpoint)
    .maybeSingle()
  if (existing && existing.audience !== 'business') {
    return json({ error: 'Este dispositivo ya está registrado.' }, 409)
  }

  const { count } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('audience', 'business')
    .eq('business_id', link.business_id)
    .eq('enabled', true)
    .neq('endpoint', endpoint)
  if ((count ?? 0) >= MAX_DEVICES_PER_BUSINESS) {
    return json({ error: 'Se alcanzó el máximo de dispositivos para este negocio.' }, 409)
  }

  // Upsert on the unique endpoint: activating again never creates a second row.
  // The business and the link come from the token, never from the request.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: null,
      audience: 'business',
      business_id: link.business_id,
      link_id: link.id,
      endpoint,
      p256dh,
      auth,
      enabled: true,
      failure_count: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw new Error('No se pudo guardar la suscripción.')
  return json({ ok: true }, 201)
}

async function unsubscribe(supabase: SupabaseClient, link: AccessLink, endpoint: unknown) {
  if (typeof endpoint !== 'string') return json({ error: 'Falta el endpoint.' }, 400)
  // Scoped to this business's own business-audience devices.
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('audience', 'business')
    .eq('business_id', link.business_id)
  if (error) throw new Error('No se pudo quitar la suscripción.')
  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// send_test — direct push to the devices this link authorised (no Notification Engine)
// ---------------------------------------------------------------------------

interface Device {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number
}

async function sendToDevices(supabase: SupabaseClient, devices: Device[], tag: string) {
  let sent = 0
  let failed = 0
  for (const device of devices) {
    const result = await sendPush(device, {
      title: 'MarketPulse',
      body: '🔔 Esta es una notificación de prueba.',
      url: '/c',
      tag,
    })
    if (result.ok) {
      sent++
      await supabase
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', device.id)
    } else {
      failed++
      const failures = device.failure_count + 1
      const switchOff = result.gone || failures >= MAX_FAILURES
      await supabase
        .from('push_subscriptions')
        .update({ failure_count: failures, ...(switchOff ? { enabled: false } : {}) })
        .eq('id', device.id)
    }
  }
  return { sent, failed }
}

async function sendTest(supabase: SupabaseClient, link: AccessLink, delaySeconds: unknown) {
  const delay = Math.min(MAX_TEST_DELAY_SECONDS, Math.max(0, Math.floor(Number(delaySeconds) || 0)))

  // Atomic cooldown: only one caller wins the update within the window.
  const threshold = new Date(Date.now() - TEST_COOLDOWN_SECONDS * 1000).toISOString()
  const { data: won } = await supabase
    .from('business_access_links')
    .update({ last_test_at: new Date().toISOString() })
    .eq('id', link.id)
    .or(`last_test_at.is.null,last_test_at.lt.${threshold}`)
    .select('id')
  if (!won || won.length === 0) return json({ error: 'Esperá unos segundos antes de otra prueba.' }, 429)

  const { data: devices } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count')
    .eq('audience', 'business')
    .eq('business_id', link.business_id)
    .eq('link_id', link.id)
    .eq('enabled', true)
  if (!devices || devices.length === 0) {
    return json({ error: 'No hay dispositivos con notificaciones activas en este enlace.' }, 404)
  }

  const tag = `client-test-${link.id}`
  if (delay > 0) {
    EdgeRuntime.waitUntil(
      new Promise((resolve) => setTimeout(resolve, delay * 1000)).then(() => sendToDevices(supabase, devices, tag)),
    )
    return json({ scheduled: true, delay_seconds: delay, devices: devices.length }, 202)
  }
  return json({ ...(await sendToDevices(supabase, devices, tag)), devices: devices.length })
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Solicitud inválida.' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const resolved = await resolveAccessLink(supabase, body.token)
    if (!resolved.ok) return json({ error: LINK_MESSAGES[resolved.reason], code: resolved.reason }, 403)
    const { link } = resolved

    switch (body.action) {
      case 'view':
        return await view(supabase, link)
      case 'subscribe':
        return await subscribe(supabase, link, body.subscription)
      case 'unsubscribe':
        return await unsubscribe(supabase, link, body.endpoint)
      case 'send_test':
        return await sendTest(supabase, link, body.delay_seconds)
      default:
        return json({ error: 'Acción desconocida.' }, 400)
    }
  } catch (err) {
    // Only the error message is logged — never the request body (it carries the token).
    console.error('client-api error:', err instanceof Error ? err.message : 'unknown')
    return json({ error: 'No se pudo completar la solicitud.' }, 500)
  }
})
