// Notification rules for the admin audience. Pure functions, no I/O.
//
// A rule turns pending events of some types into the content of ONE
// notification. Rules are listed in RULES; the engine treats them
// generically, so a new kind of notification is a new entry here — not a new
// code path in the engine.
//
//   events ──filter──► items ──merge with items already in a pending notification──► render

export interface EngineEvent {
  id: string
  event_type: string
  business_id: string | null
  payload: Record<string, unknown>
  occurred_at: string
}

export interface RuleContext {
  /** business_id -> current name */
  names: Map<string, string>
  /** business ids ('global' for the business-less ones) that already got a sync_failed alert recently */
  recentlyAlerted: Set<string>
}

export interface Rendered {
  title: string
  body: string
  /** Stored in notifications.data. `items` is what merge() reads back; `url` is the click target. */
  data: Record<string, unknown> & { items: unknown[]; url: string }
}

export interface Rule<Item> {
  /** notifications.type */
  type: string
  eventTypes: string[]
  /** Events a rule decides not to notify about; they are marked processed with the reason. */
  filter?: (events: EngineEvent[], ctx: RuleContext) => { keep: EngineEvent[]; skipped: { event: EngineEvent; reason: string }[] }
  toItems: (events: EngineEvent[], ctx: RuleContext) => Item[]
  merge: (existing: Item[], incoming: Item[]) => Item[]
  render: (items: Item[]) => Rendered
}

/** Above this many businesses a single notification switches from one line each to a summary. */
export const MAX_LISTED_BUSINESSES = 5

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ---------------------------------------------------------------------------
// reviews_gained  ->  "Nueva actividad"
// ---------------------------------------------------------------------------

export interface ActivityItem {
  business_id: string
  name: string
  gained: number
}

export function mergeActivity(existing: ActivityItem[], incoming: ActivityItem[]): ActivityItem[] {
  const byBusiness = new Map<string, ActivityItem>()
  for (const item of [...existing, ...incoming]) {
    const current = byBusiness.get(item.business_id)
    byBusiness.set(
      item.business_id,
      current ? { ...current, name: item.name, gained: current.gained + item.gained } : { ...item },
    )
  }
  return [...byBusiness.values()]
}

export function renderActivity(items: ActivityItem[]): Rendered {
  const sorted = [...items].sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name))
  const total = sorted.reduce((sum, i) => sum + i.gained, 0)
  const line = (i: ActivityItem) =>
    `${i.name} recibió ${i.gained} ${plural(i.gained, 'nueva reseña', 'nuevas reseñas')} ⭐`

  const data = {
    items: sorted,
    business_ids: sorted.map((i) => i.business_id),
    total,
    // One business opens its detail page; several open the dashboard.
    url: sorted.length === 1 ? `/business/${sorted[0].business_id}` : '/',
  }

  if (sorted.length === 1) {
    return { title: `🔔 ${line(sorted[0])}`, body: 'Abrí Review Tracker para ver el detalle.', data }
  }

  const title = '🔔 Nueva actividad en Review Tracker'
  if (sorted.length <= MAX_LISTED_BUSINESSES) {
    return { title, body: sorted.map(line).join('\n'), data }
  }
  return {
    title,
    body: `${sorted.length} negocios recibieron nuevas reseñas.\nTotal: ${total} nuevas reseñas ⭐`,
    data,
  }
}

export const reviewsGainedRule: Rule<ActivityItem> = {
  type: 'reviews_activity',
  eventTypes: ['reviews_gained'],
  filter(events) {
    // Only real increases; a malformed or zero payload never notifies.
    const keep: EngineEvent[] = []
    const skipped: { event: EngineEvent; reason: string }[] = []
    for (const event of events) {
      const gained = Number(event.payload.gained)
      if (event.business_id && Number.isFinite(gained) && gained > 0) keep.push(event)
      else skipped.push({ event, reason: 'no_positive_gain' })
    }
    return { keep, skipped }
  },
  toItems(events, ctx) {
    return mergeActivity(
      [],
      events.map((e) => ({
        business_id: e.business_id!,
        name: ctx.names.get(e.business_id!) ?? 'Un negocio',
        gained: Number(e.payload.gained),
      })),
    )
  },
  merge: mergeActivity,
  render: renderActivity,
}

// ---------------------------------------------------------------------------
// sync_failed  ->  "Error de sincronización"
// ---------------------------------------------------------------------------

export interface SyncFailedItem {
  /** null = the whole sync failed, not one business */
  business_id: string | null
  name: string | null
  error: string
}

const failedKey = (i: SyncFailedItem) => i.business_id ?? 'global'

export function mergeSyncFailed(existing: SyncFailedItem[], incoming: SyncFailedItem[]): SyncFailedItem[] {
  const byKey = new Map<string, SyncFailedItem>()
  for (const item of [...existing, ...incoming]) byKey.set(failedKey(item), item)
  return [...byKey.values()]
}

export function renderSyncFailed(items: SyncFailedItem[]): Rendered {
  const businesses = items.filter((i) => i.business_id !== null)
  const hasGlobal = items.some((i) => i.business_id === null)
  const names = businesses.map((i) => i.name ?? 'Un negocio')

  const parts: string[] = []
  if (names.length === 1) parts.push(`No se pudo actualizar ${names[0]}.`)
  else if (names.length > 1) {
    const shown = names.slice(0, MAX_LISTED_BUSINESSES).join(', ')
    const rest = names.length - MAX_LISTED_BUSINESSES
    parts.push(`No se pudo actualizar ${names.length} negocios: ${shown}${rest > 0 ? ` y ${rest} más` : ''}.`)
  }
  if (hasGlobal) {
    const error = items.find((i) => i.business_id === null)!.error
    parts.push(`La sincronización falló: ${error.slice(0, 120)}`)
  }

  return {
    title: '⚠️ Error de sincronización',
    body: parts.join('\n'),
    data: {
      items,
      business_ids: businesses.map((i) => i.business_id),
      url: businesses.length === 1 && !hasGlobal ? `/business/${businesses[0].business_id}` : '/',
    },
  }
}

/** A failing business would otherwise alert every sync cycle; once per this window is enough. */
export const SYNC_FAILED_COOLDOWN_HOURS = 24

export const syncFailedRule: Rule<SyncFailedItem> = {
  type: 'sync_failed',
  eventTypes: ['sync_failed'],
  filter(events, ctx) {
    const keep: EngineEvent[] = []
    const skipped: { event: EngineEvent; reason: string }[] = []
    for (const event of events) {
      if (ctx.recentlyAlerted.has(event.business_id ?? 'global')) skipped.push({ event, reason: 'recently_alerted' })
      else keep.push(event)
    }
    return { keep, skipped }
  },
  toItems(events, ctx) {
    return mergeSyncFailed(
      [],
      events.map((e) => ({
        business_id: e.business_id,
        name: e.business_id ? (ctx.names.get(e.business_id) ?? null) : null,
        error: String(e.payload.error ?? 'Error desconocido'),
      })),
    )
  },
  merge: mergeSyncFailed,
  render: renderSyncFailed,
}

// deno-lint-ignore no-explicit-any
export const RULES: Rule<any>[] = [reviewsGainedRule, syncFailedRule]
