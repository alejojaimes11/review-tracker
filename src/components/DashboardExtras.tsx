import { useMemo } from 'react'
import { monthlyGained } from '../lib/business'
import type { SnapshotPoint } from '../api/businesses'
import type { Business } from '../types'
import { Card, Delta, Icon } from './ui'

// ---------------------------------------------------------------------------
// Portfolio summary — the 10-second answer: how is the whole portfolio doing?
// ---------------------------------------------------------------------------

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{children}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </Card>
  )
}

export function PortfolioSummary({
  businesses,
  snapshotsByBusiness,
  monthStart,
}: {
  businesses: Business[]
  snapshotsByBusiness: Map<string, SnapshotPoint[]>
  monthStart: Date
}) {
  const summary = useMemo(() => {
    const active = businesses.filter((b) => b.status === 'active')
    const gains = active.map((b) => monthlyGained(snapshotsByBusiness.get(b.id) ?? [], b.current_reviews, monthStart))
    const rated = active.filter((b) => b.current_rating !== null)
    const avgRating = rated.length > 0 ? rated.reduce((sum, b) => sum + (b.current_rating ?? 0), 0) / rated.length : null
    return {
      active: active.length,
      gainedThisMonth: gains.reduce((sum, g) => sum + g, 0),
      growing: gains.filter((g) => g > 0).length,
      avgRating,
    }
  }, [businesses, snapshotsByBusiness, monthStart])

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="reseñas ganadas este mes">
        <Delta value={summary.gainedThisMonth} />
      </Tile>
      <Tile label="negocios activos">{summary.active}</Tile>
      <Tile label="crecieron este mes">
        {summary.growing}
        <span className="text-sm font-medium text-gray-400"> de {summary.active}</span>
      </Tile>
      <Tile label="rating promedio">
        {summary.avgRating !== null ? (
          <span className="inline-flex items-center gap-1">
            <Icon path="star" className="h-4 w-4 text-amber-400 dark:text-amber-300" />
            {summary.avgRating.toFixed(1)}
          </span>
        ) : (
          '—'
        )}
      </Tile>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search by name
// ---------------------------------------------------------------------------

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-4">
      <Icon path="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" filled={false} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar negocio por nombre…"
        aria-label="Buscar negocio por nombre"
        className="block w-full rounded-lg border border-black/10 bg-white/80 py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-gray-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
      />
    </div>
  )
}
