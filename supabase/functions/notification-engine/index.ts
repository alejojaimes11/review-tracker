import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { callerIsBackend } from '../_shared/backend-auth.ts'
import { sendPush } from '../_shared/push.ts'
import { nextSendTime } from '../_shared/quiet-hours.ts'
import { type EngineEvent, RULES, SYNC_FAILED_COOLDOWN_HOURS } from '../_shared/notification-rules.ts'

// Notification Engine (admin audience).
//
//   notification_events ─► rules ─► notifications ─► Web Push ─► notification_deliveries
//
// Runs on its own cron, never inside the sync, and never scrapes or touches
// current_reviews. Every step is safe to repeat:
//   * events -> notification is one transaction (engine_commit): an event is
//     consumed exactly once, and a crash after it just leaves a pending
//     notification for the delivery step to pick up;
//   * delivery first CLAIMS each notification (claim_due_notifications, a lease
//     with a fencing token), so only one run can send it at a time — two
//     overlapping runs, a manual call or a retry cannot both push it;
//   * delivery skips devices that already got the notification, and the push
//     carries a tag as a last line of defence for the one case a claim can't
//     cover (a run that dies after the push was accepted but before it was
//     recorded).

// Wait this long after an event appears so a sync still in flight finishes and
// one cycle's businesses land in the same grouped notification.
const SETTLE_MINUTES = 3
const MAX_EVENTS_PER_RUN = 500
const MAX_DUE_NOTIFICATIONS = 50
const MAX_DELIVERY_ATTEMPTS = 3
const MAX_DEVICE_FAILURES = 5
// A run "owns" a notification for this long (renewed before each send). If the
// run dies or times out, the claim expires and a later run takes over. It must
// stay longer than the slowest run and shorter than the 15 min cron interval.
const CLAIM_LEASE_SECONDS = 300
// Safety net: re-derive reviews_gained from snapshots for this long back, in
// case a sync saved snapshots and then died before emitting its events.
const SWEEP_WINDOW_HOURS = 24

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status })

// ---------------------------------------------------------------------------
// Step 1 — events -> notifications
// ---------------------------------------------------------------------------

async function markSkipped(supabase: SupabaseClient, events: { id: string }[], reason: string) {
  if (events.length === 0) return
  await supabase
    .from('notification_events')
    .update({ processed_at: new Date().toISOString(), skipped_reason: reason })
    .in('id', events.map((e) => e.id))
    .is('processed_at', null)
}

async function createNotifications(supabase: SupabaseClient, admins: string[]) {
  const summary = { events: 0, notifications: 0, merged: 0, skipped: 0 }

  const cutoff = new Date(Date.now() - SETTLE_MINUTES * 60_000).toISOString()
  const { data: pending, error } = await supabase
    .from('notification_events')
    .select('id, event_type, business_id, payload, occurred_at')
    .is('processed_at', null)
    .lte('created_at', cutoff)
    .order('occurred_at', { ascending: true })
    .limit(MAX_EVENTS_PER_RUN)
  if (error) throw new Error(error.message)

  const events = (pending ?? []) as EngineEvent[]
  summary.events = events.length
  if (events.length === 0) return summary

  // Events no rule handles must not sit in the queue forever.
  const known = new Set(RULES.flatMap((r) => r.eventTypes))
  const orphans = events.filter((e) => !known.has(e.event_type))
  await markSkipped(supabase, orphans, 'no_rule')
  summary.skipped += orphans.length

  const businessIds = [...new Set(events.map((e) => e.business_id).filter((id): id is string => !!id))]
  const names = new Map<string, string>()
  if (businessIds.length > 0) {
    const { data } = await supabase.from('businesses').select('id, name').in('id', businessIds)
    for (const b of data ?? []) names.set(b.id, b.name)
  }

  const recentlyAlerted = new Set<string>()
  if (events.some((e) => e.event_type === 'sync_failed')) {
    const since = new Date(Date.now() - SYNC_FAILED_COOLDOWN_HOURS * 3_600_000).toISOString()
    const { data } = await supabase
      .from('notification_events')
      .select('business_id')
      .eq('event_type', 'sync_failed')
      .not('notification_id', 'is', null)
      .gte('occurred_at', since)
    for (const row of data ?? []) recentlyAlerted.add(row.business_id ?? 'global')
  }
  const ctx = { names, recentlyAlerted }

  for (const rule of RULES) {
    const ofRule = events.filter((e) => rule.eventTypes.includes(e.event_type))
    if (ofRule.length === 0) continue

    const { keep, skipped } = rule.filter ? rule.filter(ofRule, ctx) : { keep: ofRule, skipped: [] }
    for (const reason of new Set(skipped.map((s) => s.reason))) {
      await markSkipped(supabase, skipped.filter((s) => s.reason === reason).map((s) => s.event), reason)
    }
    summary.skipped += skipped.length
    if (keep.length === 0) continue

    const incoming = rule.toItems(keep, ctx)
    const eventIds = keep.map((e) => e.id)

    for (const [index, recipient] of admins.entries()) {
      // A still-untouched pending notification of the same type (e.g. held for
      // silent hours) absorbs new activity, so the admin gets one message.
      const { data: open } = await supabase
        .from('notifications')
        .select('id, data, scheduled_for')
        .eq('recipient_user_id', recipient)
        .eq('type', rule.type)
        .eq('status', 'pending')
        .eq('attempt_count', 0)
        .is('claimed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const existingItems = Array.isArray(open?.data?.items) ? open.data.items : []
      const rendered = rule.render(rule.merge(existingItems, incoming))
      const scheduledFor = open?.scheduled_for ?? nextSendTime(new Date()).toISOString()

      const { data: id, error: commitError } = await supabase.rpc('engine_commit', {
        p_recipient: recipient,
        p_type: rule.type,
        p_title: rendered.title,
        p_body: rendered.body,
        p_data: rendered.data,
        // Events are consumed by the first recipient's commit (single admin today).
        p_event_ids: index === 0 ? eventIds : [],
        p_scheduled_for: scheduledFor,
        p_merge_into: open?.id ?? null,
      })
      if (commitError) throw new Error(commitError.message)
      if (id === null) break // another run already took these events
      if (open?.id) summary.merged++
      else summary.notifications++
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// Step 2 — pending notifications -> Web Push
// ---------------------------------------------------------------------------

interface Delivery {
  push_subscription_id: string | null
  status: string
  attempt_count: number
}

interface ClaimedNotification {
  id: string
  recipient_user_id: string
  title: string
  body: string
  // deno-lint-ignore no-explicit-any
  data: any
  attempt_count: number
  claim_token: string
}

/** Extends our lease, but only while we still hold the claim. False = another run owns it now. */
async function renewClaim(supabase: SupabaseClient, n: ClaimedNotification): Promise<boolean> {
  const { data } = await supabase
    .from('notifications')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', n.id)
    .eq('claim_token', n.claim_token)
    .eq('status', 'pending')
    .select('id')
  return (data?.length ?? 0) === 1
}

async function deliverDue(supabase: SupabaseClient) {
  const summary = {
    claimed: 0,
    sent: 0,
    failed: 0,
    still_pending: 0,
    lost_claim: 0,
    pushes_ok: 0,
    pushes_failed: 0,
    devices_disabled: 0,
  }

  // Atomic: rows another run already claimed are skipped, never returned twice.
  const { data: claimed, error } = await supabase.rpc('claim_due_notifications', {
    p_limit: MAX_DUE_NOTIFICATIONS,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  })
  if (error) throw new Error(error.message)
  const due = (claimed ?? []) as ClaimedNotification[]
  summary.claimed = due.length

  for (const n of due) {
    try {
      if (!(await renewClaim(supabase, n))) {
        summary.lost_claim++
        continue
      }

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth, failure_count')
        .eq('user_id', n.recipient_user_id)
        .eq('audience', 'admin')
        .eq('enabled', true)

      const { data: priorRows } = await supabase
        .from('notification_deliveries')
        .select('push_subscription_id, status, attempt_count')
        .eq('notification_id', n.id)
      const prior = (priorRows ?? []) as Delivery[]
      const alreadySent = new Set(prior.filter((d) => d.status === 'sent').map((d) => d.push_subscription_id))
      const priorAttempts = new Map(prior.map((d) => [d.push_subscription_id, d.attempt_count]))

      const attempts = n.attempt_count + 1
      const targets = (subs ?? []).filter((s) => !alreadySent.has(s.id))

      let okNow = 0
      let retryable = 0
      let lastError: string | null = null

      let lostClaim = false
      for (const sub of targets) {
        // Re-check right before each push: if the lease was lost (e.g. this run stalled),
        // stop — the run that owns it now will handle the remaining devices.
        if (!(await renewClaim(supabase, n))) {
          lostClaim = true
          break
        }
        const result = await sendPush(sub, {
          title: n.title,
          body: n.body,
          url: n.data?.url ?? '/',
          tag: `n-${n.id}`,
        })

        await supabase.from('notification_deliveries').upsert(
          {
            notification_id: n.id,
            push_subscription_id: sub.id,
            status: result.ok ? 'sent' : 'failed',
            attempt_count: (priorAttempts.get(sub.id) ?? 0) + 1,
            attempted_at: new Date().toISOString(),
            delivered_at: result.ok ? new Date().toISOString() : null,
            error_code: result.ok || result.status === null ? null : String(result.status),
            error_message: result.ok ? null : result.message.slice(0, 300),
          },
          { onConflict: 'notification_id,push_subscription_id' },
        )

        if (result.ok) {
          okNow++
          summary.pushes_ok++
          await supabase
            .from('push_subscriptions')
            .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
            .eq('id', sub.id)
          continue
        }

        summary.pushes_failed++
        lastError = result.message.slice(0, 300)
        const failures = sub.failure_count + 1
        // 404/410: the browser dropped this subscription. Disable only this device;
        // its delivery history stays.
        const disable = result.gone || failures >= MAX_DEVICE_FAILURES
        if (disable) summary.devices_disabled++
        await supabase
          .from('push_subscriptions')
          .update({ failure_count: failures, ...(disable ? { enabled: false } : {}) })
          .eq('id', sub.id)

        const transient = result.status === null || result.status === 429 || result.status >= 500
        if (transient && !disable) retryable++
      }

      if (lostClaim) {
        summary.lost_claim++
        continue
      }

      const anySent = alreadySent.size > 0 || okNow > 0

      if (retryable > 0 && attempts < MAX_DELIVERY_ATTEMPTS) {
        // Some devices hit a temporary error: try only those again next run.
        await supabase
          .from('notifications')
          .update({ attempt_count: attempts, last_error: lastError, updated_at: new Date().toISOString() })
          .eq('id', n.id)
          .eq('claim_token', n.claim_token)
        summary.still_pending++
        continue
      }

      const noDevices = (subs ?? []).length === 0 && !anySent
      await supabase
        .from('notifications')
        .update({
          status: anySent ? 'sent' : 'failed',
          sent_at: anySent ? new Date().toISOString() : null,
          attempt_count: attempts,
          last_error: anySent ? null : noDevices ? 'no_active_subscriptions' : lastError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', n.id)
        .eq('claim_token', n.claim_token)
      if (anySent) summary.sent++
      else summary.failed++
    } catch (err) {
      // One broken notification must not stop the rest; it stays pending and is retried.
      console.error('deliver failed', n.id, err instanceof Error ? err.message : err)
      summary.still_pending++
    }
  }

  return summary
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!(await callerIsBackend(req))) return json({ error: 'No autorizado.' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const swept = await supabase.rpc('emit_review_gained_events', {
      p_since: new Date(Date.now() - SWEEP_WINDOW_HOURS * 3_600_000).toISOString(),
    })

    const { data: adminRows, error: adminError } = await supabase.from('admin_users').select('user_id')
    if (adminError) throw new Error(adminError.message)
    const admins = (adminRows ?? []).map((a) => a.user_id as string)

    const created = admins.length > 0
      ? await createNotifications(supabase, admins)
      : { events: 0, notifications: 0, merged: 0, skipped: 0 }
    const delivered = await deliverDue(supabase)

    return json({ swept_new_events: swept.error ? null : swept.data, created, delivered })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500)
  }
})
