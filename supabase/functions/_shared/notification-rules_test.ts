// Run: deno test supabase/functions/_shared/ (from a directory without a package.json, or with --no-check)
import { isQuietHour, nextSendTime } from './quiet-hours.ts'
import {
  type ActivityItem,
  type EngineEvent,
  mergeActivity,
  RULES,
  renderActivity,
  renderSyncFailed,
  reviewsGainedRule,
  syncFailedRule,
} from './notification-rules.ts'

function assertEquals<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${e}`)
}

// Bogotá is UTC-5 with no DST: 23:00 local = 04:00Z next day, 07:00 local = 12:00Z.
const utc = (s: string) => new Date(s)

Deno.test('silent hours: 22:00-07:00 America/Bogota', () => {
  assertEquals(isQuietHour(utc('2026-09-20T12:00:00Z')), false, '07:00 local is allowed')
  assertEquals(isQuietHour(utc('2026-09-20T11:59:00Z')), true, '06:59 local is quiet')
  assertEquals(isQuietHour(utc('2026-09-21T02:59:00Z')), false, '21:59 local is allowed')
  assertEquals(isQuietHour(utc('2026-09-21T03:00:00Z')), true, '22:00 local is quiet')
  assertEquals(isQuietHour(utc('2026-09-21T05:00:00Z')), true, '00:00 local is quiet')
})

Deno.test('silent hours: evening waits until tomorrow 07:00, early morning until today 07:00', () => {
  // 23:00 local on Sep 20 -> 07:00 local on Sep 21 (= 12:00Z)
  assertEquals(nextSendTime(utc('2026-09-21T04:00:00Z')).toISOString(), '2026-09-21T12:00:00.000Z')
  // 22:00 exactly
  assertEquals(nextSendTime(utc('2026-09-21T03:00:00Z')).toISOString(), '2026-09-21T12:00:00.000Z')
  // 00:00 local on Sep 21 -> 07:00 local the same day
  assertEquals(nextSendTime(utc('2026-09-21T05:00:00Z')).toISOString(), '2026-09-21T12:00:00.000Z')
  // 06:15 local
  assertEquals(nextSendTime(utc('2026-09-21T11:15:00Z')).toISOString(), '2026-09-21T12:00:00.000Z')
  // Daytime: unchanged
  assertEquals(nextSendTime(utc('2026-09-21T18:00:00Z')).toISOString(), '2026-09-21T18:00:00.000Z')
  // Month rollover: 23:00 local on Sep 30
  assertEquals(nextSendTime(utc('2026-10-01T04:00:00Z')).toISOString(), '2026-10-01T12:00:00.000Z')
})

const item = (id: string, name: string, gained: number): ActivityItem => ({ business_id: id, name, gained })

Deno.test('activity: single business -> one line, click opens that business', () => {
  const r = renderActivity([item('b1', 'Valejo Kids', 2)])
  assertEquals(r.title, '🔔 Valejo Kids recibió 2 nuevas reseñas ⭐')
  assertEquals(r.data.url, '/business/b1')
})

Deno.test('activity: singular "nueva reseña"', () => {
  assertEquals(renderActivity([item('b1', 'Go Market', 1)]).title, '🔔 Go Market recibió 1 nueva reseña ⭐')
})

Deno.test('activity: three businesses -> ONE grouped notification, sorted, no zeros', () => {
  const r = renderActivity([item('a', 'Valejo Kids', 2), item('b', 'La Granja', 7), item('c', 'Go Market', 1)])
  assertEquals(r.title, '🔔 Nueva actividad en Review Tracker')
  assertEquals(
    r.body,
    [
      'La Granja recibió 7 nuevas reseñas ⭐',
      'Valejo Kids recibió 2 nuevas reseñas ⭐',
      'Go Market recibió 1 nueva reseña ⭐',
    ].join('\n'),
  )
  assertEquals(r.data.url, '/')
  assertEquals(r.data.business_ids, ['b', 'a', 'c'])
  assertEquals(r.data.total, 10)
})

Deno.test('activity: many businesses -> summary', () => {
  const items = Array.from({ length: 6 }, (_, i) => item(`b${i}`, `Negocio ${i}`, i + 1))
  const r = renderActivity(items)
  assertEquals(r.body, '6 negocios recibieron nuevas reseñas.\nTotal: 21 nuevas reseñas ⭐')
})

Deno.test('activity: merging into a pending notification sums per business', () => {
  const merged = mergeActivity([item('a', 'Valejo Kids', 2), item('b', 'La Granja', 1)], [item('a', 'Valejo Kids', 3)])
  assertEquals(merged.map((i) => [i.business_id, i.gained]), [['a', 5], ['b', 1]])
})

const event = (over: Partial<EngineEvent>): EngineEvent => ({
  id: crypto.randomUUID(),
  event_type: 'reviews_gained',
  business_id: 'b1',
  payload: { gained: 2 },
  occurred_at: '2026-09-21T00:00:00Z',
  ...over,
})
const ctx = (recentlyAlerted: string[] = []) => ({ names: new Map([['b1', 'Valejo Kids']]), recentlyAlerted: new Set(recentlyAlerted) })

Deno.test('reviews rule ignores zero / missing gains', () => {
  const { keep, skipped } = reviewsGainedRule.filter!(
    [event({}), event({ payload: { gained: 0 } }), event({ payload: {} }), event({ business_id: null })],
    ctx(),
  )
  assertEquals(keep.length, 1)
  assertEquals(skipped.length, 3)
})

Deno.test('sync_failed: one business, several, global, and cooldown', () => {
  assertEquals(
    renderSyncFailed([{ business_id: 'b1', name: 'Valejo Kids', error: 'x' }]).body,
    'No se pudo actualizar Valejo Kids.',
  )
  assertEquals(
    renderSyncFailed([
      { business_id: 'b1', name: 'A', error: 'x' },
      { business_id: 'b2', name: 'B', error: 'y' },
    ]).body,
    'No se pudo actualizar 2 negocios: A, B.',
  )
  assertEquals(renderSyncFailed([{ business_id: null, name: null, error: 'APIFY_API_TOKEN no está configurada.' }]).body,
    'La sincronización falló: APIFY_API_TOKEN no está configurada.')

  const failed = event({ event_type: 'sync_failed', payload: { error: 'boom' } })
  assertEquals(syncFailedRule.filter!([failed], ctx(['b1'])).skipped[0].reason, 'recently_alerted')
  assertEquals(syncFailedRule.filter!([failed], ctx()).keep.length, 1)
})

Deno.test('every rule owns distinct event types and notification types', () => {
  const types = RULES.map((r) => r.type)
  assertEquals(new Set(types).size, types.length)
  const events = RULES.flatMap((r) => r.eventTypes)
  assertEquals(new Set(events).size, events.length)
})
