import type { Business } from '../types'

export function daysSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000
}

export type CategoryIcon = 'utensils' | 'cupcake' | 'leaf' | 'bag' | 'cap' | 'tag'

const CATEGORY_VISUALS: { match: RegExp; icon: CategoryIcon; color: string }[] = [
  { match: /rest|parrilla|caf[eé]|comida/i, icon: 'utensils', color: '#fb923c' },
  { match: /postre|pasteler|dulce/i, icon: 'cupcake', color: '#f472b6' },
  { match: /spa|belleza|est[eé]tica/i, icon: 'leaf', color: '#2dd4bf' },
  { match: /tienda|moda|ropa/i, icon: 'bag', color: '#60a5fa' },
  { match: /colegio|escuela|kids/i, icon: 'cap', color: '#818cf8' },
]

/** Icon + color for a business's free-text category — keyword match with a neutral fallback. */
export function getCategoryVisual(category: string): { icon: CategoryIcon; color: string } {
  return CATEGORY_VISUALS.find((c) => c.match.test(category)) ?? { icon: 'tag', color: '#a78bfa' }
}

export function getBusinessRisk(business: Business) {
  const lowUsage =
    business.status === 'active' &&
    business.last_growth_at !== null &&
    daysSince(business.last_growth_at) >= business.low_usage_days
  const syncError = business.status === 'active' && business.last_sync_error !== null
  const ratingDropped =
    business.initial_rating !== null &&
    business.current_rating !== null &&
    business.current_rating < business.initial_rating

  return { lowUsage, syncError, ratingDropped, any: lowUsage || syncError || ratingDropped }
}

interface SnapshotLike {
  review_count: number
  created_at: string
}

/** Reviews gained since the start of `monthStart`, using the earliest snapshot in that range as baseline. */
export function monthlyGained(snapshots: SnapshotLike[], currentReviews: number, monthStart: Date) {
  const inMonth = [...snapshots]
    .filter((s) => new Date(s.created_at) >= monthStart)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (inMonth.length === 0) return 0
  return currentReviews - inMonth[0].review_count
}

/** Last known review_count per day, ascending, for the trailing `days` window — used for mini sparklines. */
export function dailySeries(snapshots: SnapshotLike[], days: number) {
  const cutoff = Date.now() - days * 86_400_000
  const byDay = new Map<string, number>()
  const sorted = [...snapshots].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const s of sorted) {
    if (new Date(s.created_at).getTime() < cutoff) continue
    byDay.set(s.created_at.slice(0, 10), s.review_count)
  }
  return [...byDay.values()]
}

/** Bare 10-digit numbers are assumed Colombian mobiles (this tool's whole client base) — anything else is left as-is. */
export function normalizePhoneForWhatsApp(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.length === 10 ? `57${digits}` : digits
}

/** Short, personalized nudge for a stalled business, built from the same risk flags the badges use. */
export function buildWhatsAppReminder(business: Business, risk: ReturnType<typeof getBusinessRisk>) {
  const parts = [`Hola! 👋 Te escribo del equipo que lleva el seguimiento de reseñas de Google de ${business.name}.`]

  if (risk.syncError) {
    parts.push('Estamos teniendo un problema técnico sincronizando su negocio, ya lo estamos revisando.')
  } else if (risk.lowUsage && business.last_growth_at) {
    const days = Math.floor(daysSince(business.last_growth_at))
    parts.push(
      `Vimos que no ha entrado ninguna reseña nueva en los últimos ${days} días. ¿La placa sigue visible donde el cliente paga?`,
    )
  }
  if (risk.ratingDropped) {
    parts.push('También notamos que el rating bajó un poco — si hay algo en lo que podamos ayudar a mejorar, contanos.')
  }

  parts.push('Cualquier cosa contame y lo vemos juntos 🙌')
  return parts.join(' ')
}

export function buildWhatsAppLink(business: Business, risk: ReturnType<typeof getBusinessRisk>) {
  if (!business.phone) return null
  const number = normalizePhoneForWhatsApp(business.phone)
  const text = encodeURIComponent(buildWhatsAppReminder(business, risk))
  return `https://wa.me/${number}?text=${text}`
}
