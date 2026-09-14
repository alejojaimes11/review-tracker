import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useAnalyzeBusiness,
  useBusiness,
  useDeleteBusiness,
  useMonthlyReports,
  useResetBaseline,
  useSnapshots,
  useUpdateBusinessSettings,
  useUploadPhoto,
} from '../api/businesses'
import { useTheme } from '../hooks/useTheme'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { Button, Card, Delta, FOCUS_RING, Icon, ProgressBar, Skeleton, StarRating } from '../components/ui'
import { getCategoryVisual, monthlyGained } from '../lib/business'
import type { Business, ReviewSnapshot } from '../types'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-white/5 dark:text-gray-300">
      {children}
    </span>
  )
}

const FREQUENCY_OPTIONS = [6, 12, 24, 48]

function SettingsPanel({ business }: { business: Business }) {
  const [open, setOpen] = useState(false)
  const [frequency, setFrequency] = useState(business.update_frequency_hours)
  const [billingDay, setBillingDay] = useState(business.billing_day?.toString() ?? '')
  const [category, setCategory] = useState(business.category ?? '')
  const [lowUsageDays, setLowUsageDays] = useState(business.low_usage_days.toString())
  const [monthlyGoal, setMonthlyGoal] = useState(business.monthly_goal?.toString() ?? '')
  const [phone, setPhone] = useState(business.phone ?? '')
  const [notes, setNotes] = useState(business.notes ?? '')
  const updateSettings = useUpdateBusinessSettings(business.id)
  const uploadPhoto = useUploadPhoto(business.id)
  const resetBaseline = useResetBaseline(business.id)
  const deleteBusiness = useDeleteBusiness()
  const navigate = useNavigate()

  function handleReset() {
    if (
      confirm(
        `¿Reiniciar el conteo de "${business.name}"? Las reseñas ganadas volverán a 0 desde hoy. El historial no se borra.`,
      )
    ) {
      resetBaseline.mutate()
    }
  }

  function handleDelete() {
    if (confirm(`¿Mover "${business.name}" a la papelera? Se deja de sincronizar, pero podés restaurarlo cuando quieras desde el dashboard.`)) {
      deleteBusiness.mutate(business.id, { onSuccess: () => navigate('/') })
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateSettings.mutate({
      update_frequency_hours: frequency,
      billing_day: billingDay ? Number(billingDay) : null,
      category: category.trim() ? category.trim() : null,
      low_usage_days: Math.max(1, Number(lowUsageDays) || 1),
      monthly_goal: monthlyGoal.trim() ? Math.max(1, Number(monthlyGoal)) : null,
      phone: phone.trim() ? phone.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        <Icon path="gear" className="h-4 w-4" />
        Configuración
        <Icon path="chevronDown" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} filled={false} />
      </Button>

      {open && (
        <Card className="mt-2 p-4">
          <div className="mb-4 flex items-center gap-4">
            {business.photo_url ? (
              <img src={business.photo_url} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-black/5 dark:ring-white/10" />
            ) : (
              <div className="h-14 w-14 rounded-full bg-black/5 dark:bg-white/5" />
            )}
            <label className="text-sm text-gray-600 dark:text-gray-300">
              Cambiar foto
              <input
                type="file"
                accept="image/*"
                className="mt-1 block text-xs"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadPhoto.mutate(file)
                }}
              />
              {uploadPhoto.isPending && <span className="text-xs text-gray-400">Subiendo…</span>}
            </label>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
            <label className="text-sm text-gray-600 dark:text-gray-300">
              Frecuencia de actualización
              <select
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
                className="mt-1 block rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              >
                {FREQUENCY_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    cada {h}h
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-300">
              Día de cobro (del mes)
              <input
                type="number"
                min={1}
                max={31}
                value={billingDay}
                onChange={(e) => setBillingDay(e.target.value)}
                placeholder="ej. 5"
                className="mt-1 block w-20 rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-300">
              Categoría
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="ej. Restaurante"
                className="mt-1 block w-36 rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-300">
              Sensibilidad "Poco uso" (días)
              <input
                type="number"
                min={1}
                value={lowUsageDays}
                onChange={(e) => setLowUsageDays(e.target.value)}
                className="mt-1 block w-20 rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-300">
              Meta mensual (reseñas)
              <input
                type="number"
                min={1}
                value={monthlyGoal}
                onChange={(e) => setMonthlyGoal(e.target.value)}
                placeholder="ej. 10"
                className="mt-1 block w-20 rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <label className="text-sm text-gray-600 dark:text-gray-300">
              Teléfono (WhatsApp)
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="ej. 3001234567"
                className="mt-1 block w-36 rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <label className="block w-full text-sm text-gray-600 dark:text-gray-300">
              Notas internas
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ej. hablé con el dueño el 14 ago, dijo que la placa se cayó"
                rows={2}
                className="mt-1 block w-full resize-none rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>

            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-black/5 pt-4 dark:border-white/10">
            <Button
              type="button"
              variant="secondary"
              onClick={handleReset}
              disabled={resetBaseline.isPending}
              className="!text-amber-600 dark:!text-amber-400"
            >
              {resetBaseline.isPending ? 'Reiniciando…' : 'Reiniciar recuento'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleDelete}
              disabled={deleteBusiness.isPending}
              className="!text-red-600 dark:!text-red-400"
            >
              {deleteBusiness.isPending ? 'Moviendo…' : 'Mover a la papelera'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 220
const CHART_PADDING = 28

function GrowthChart({ snapshots }: { snapshots: ReviewSnapshot[] }) {
  const [theme] = useTheme()
  const [hover, setHover] = useState<number | null>(null)

  if (snapshots.length < 2) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Necesitas al menos 2 actualizaciones para ver el gráfico.
      </p>
    )
  }

  const ascending = [...snapshots].reverse()
  const counts = ascending.map((s) => s.review_count)
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const range = max - min || 1

  const points = ascending.map((s, i) => ({
    x: CHART_PADDING + (i / (ascending.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2),
    y: CHART_HEIGHT - CHART_PADDING - ((s.review_count - min) / range) * (CHART_HEIGHT - CHART_PADDING * 2),
    snapshot: s,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${CHART_HEIGHT - CHART_PADDING} L ${points[0].x.toFixed(1)} ${CHART_HEIGHT - CHART_PADDING} Z`

  const lineColor = theme === 'dark' ? '#a78bfa' : '#7c3aed'
  const mutedColor = theme === 'dark' ? '#8b8a94' : '#8a8894'
  const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * CHART_WIDTH
    let closest = 0
    let closestDist = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(p.x - relX)
      if (d < closestDist) {
        closestDist = d
        closest = i
      }
    })
    setHover(closest)
  }

  const hoveredPoint = hover !== null ? points[hover] : null
  const tooltipLeft = hoveredPoint ? hoveredPoint.x > CHART_WIDTH - 140 : false

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full touch-none tabular-nums"
      role="img"
      aria-label="Gráfico de crecimiento de reseñas"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="1" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={CHART_PADDING}
          y1={CHART_PADDING + f * (CHART_HEIGHT - CHART_PADDING * 2)}
          x2={CHART_WIDTH - CHART_PADDING}
          y2={CHART_PADDING + f * (CHART_HEIGHT - CHART_PADDING * 2)}
          stroke={gridColor}
          strokeWidth={1}
        />
      ))}
      <line
        x1={CHART_PADDING}
        y1={CHART_HEIGHT - CHART_PADDING}
        x2={CHART_WIDTH - CHART_PADDING}
        y2={CHART_HEIGHT - CHART_PADDING}
        stroke={gridColor}
        strokeWidth={1}
      />

      <path d={areaPath} fill="url(#area-fill)" stroke="none" />
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 4.5 : 3} fill={lineColor} className="transition-all" />
      ))}

      {hoveredPoint && (
        <>
          <line
            x1={hoveredPoint.x}
            y1={CHART_PADDING}
            x2={hoveredPoint.x}
            y2={CHART_HEIGHT - CHART_PADDING}
            stroke={lineColor}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
          <g transform={`translate(${tooltipLeft ? hoveredPoint.x - 132 : hoveredPoint.x + 10}, ${Math.max(hoveredPoint.y - 34, 4)})`}>
            <rect width="122" height="34" rx="6" fill={theme === 'dark' ? '#15151d' : '#ffffff'} stroke={gridColor} />
            <text x="8" y="14" fontSize="10" fill={mutedColor}>
              {new Date(hoveredPoint.snapshot.created_at).toLocaleDateString('es-ES')}
            </text>
            <text x="8" y="27" fontSize="12" fontWeight="600" fill={theme === 'dark' ? '#fff' : '#0b0b0b'}>
              {hoveredPoint.snapshot.review_count} reseñas · ★ {hoveredPoint.snapshot.rating ?? '—'}
            </text>
          </g>
        </>
      )}

      <text x={CHART_PADDING} y={14} fontSize={11} fill={mutedColor}>
        {max}
      </text>
      <text x={CHART_PADDING} y={CHART_HEIGHT - CHART_PADDING - 4} fontSize={11} fill={mutedColor}>
        {min}
      </text>
    </svg>
  )
}

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function formatMonth(month: string) {
  const [year, m] = month.split('-')
  return `${MONTH_NAMES[Number(m) - 1]} ${year}`
}

function slugName(name: string) {
  return name.trim().replace(/\s+/g, '-')
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function downloadFromUrl(url: string, filename: string) {
  const res = await fetch(url, { cache: 'no-store' })
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(objectUrl)
}

function MonthlyReports({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [open, setOpen] = useState(false)
  const { data: reports, isLoading } = useMonthlyReports(businessId)

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        <Icon path="folder" className="h-4 w-4" />
        Informes
        <Icon path="chevronDown" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} filled={false} />
      </Button>

      {open && (
        <Card className="mt-2 p-3">
          {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Cargando…</p>}
          {!isLoading && (!reports || reports.length === 0) && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Todavía no hay reportes — se generan automáticamente el 1° de cada mes.
            </p>
          )}
          {reports && reports.length > 0 && (
            <ul className="space-y-1 text-sm">
              {reports.map((r) => (
                <li key={r.month}>
                  <button
                    onClick={() =>
                      downloadFromUrl(
                        r.url,
                        `${slugName(businessName)}.${slugName(capitalize(formatMonth(r.month)))}.csv`,
                      )
                    }
                    className={`cursor-pointer rounded capitalize text-violet-600 underline-offset-2 hover:underline dark:text-violet-400 ${FOCUS_RING}`}
                  >
                    {formatMonth(r.month)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

/** MarketPulse block 1 — on-demand only, nothing runs until the button is clicked, nothing persisted. */
function AiInsights({ businessId }: { businessId: string }) {
  const [open, setOpen] = useState(false)
  const analyze = useAnalyzeBusiness()

  function handleClick() {
    setOpen(true)
    analyze.mutate(businessId)
  }

  return (
    <div>
      <Button variant="secondary" onClick={handleClick} disabled={analyze.isPending}>
        <Icon path="sparkle" className="h-4 w-4" />
        {analyze.isPending ? 'Analizando…' : 'Analizar con IA'}
      </Button>

      {open && (
        <Card className="mt-2 p-4">
          {analyze.isPending && (
            <p className="text-sm text-gray-500 dark:text-gray-400">Leyendo las reseñas recientes…</p>
          )}
          {analyze.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">{(analyze.error as Error).message}</p>
          )}
          {analyze.data && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 font-medium text-emerald-600 dark:text-emerald-400">Qué está haciendo bien</p>
                <p className="text-gray-700 dark:text-gray-300">{analyze.data.bien || '—'}</p>
              </div>
              <div>
                <p className="mb-1 font-medium text-amber-600 dark:text-amber-400">Qué debería mejorar</p>
                <p className="text-gray-700 dark:text-gray-300">{analyze.data.mejorar || '—'}</p>
              </div>
              <div>
                <p className="mb-1 font-medium text-violet-600 dark:text-violet-400">Recomendación</p>
                <p className="text-gray-700 dark:text-gray-300">{analyze.data.recomendacion || '—'}</p>
              </div>
              <p className="pt-1 text-xs text-gray-400">
                Basado en {analyze.data.reviewCount} reseña{analyze.data.reviewCount === 1 ? '' : 's'} reciente
                {analyze.data.reviewCount === 1 ? '' : 's'} con texto.
              </p>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function aggregateByDay(snapshots: ReviewSnapshot[], baseline: number) {
  const ascending = [...snapshots].reverse()
  const byDay = new Map<string, { reviewCount: number; rating: number | null }>()
  for (const s of ascending) {
    byDay.set(s.created_at.slice(0, 10), { reviewCount: s.review_count, rating: s.rating })
  }
  let prevTotal = baseline
  const rows: { day: string; gained: number; total: number; rating: number | null }[] = []
  for (const [day, { reviewCount, rating }] of byDay) {
    rows.push({ day, gained: reviewCount - prevTotal, total: reviewCount, rating })
    prevTotal = reviewCount
  }
  return rows
}

function formatDayEs(day: string) {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

function downloadCsv(business: Business, snapshots: ReviewSnapshot[]) {
  const header = 'Fecha,Reseñas del día,Total de reseñas,Rating\n'
  const rows = aggregateByDay(snapshots, business.initial_reviews)
    .map((r) => `${formatDayEs(r.day)},${r.gained >= 0 ? '+' : ''}${r.gained},${r.total},${r.rating ?? ''}`)
    .join('\n')
  const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugName(business.name)}.Historial.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function HistoryPanel({
  business,
  snapshots,
  loading,
}: {
  business: Business
  snapshots: ReviewSnapshot[] | undefined
  loading: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        <Icon path="history" className="h-4 w-4" filled={false} />
        Historial
        <Icon path="chevronDown" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} filled={false} />
      </Button>

      {open && (
        <Card className="mt-2 overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-2 dark:border-white/10">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Actualizaciones</p>
            {snapshots && snapshots.length > 0 && (
              <Button variant="ghost" onClick={() => downloadCsv(business, snapshots)} className="!px-2 !py-1 text-xs">
                Exportar CSV
              </Button>
            )}
          </div>

          {loading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          )}

          {snapshots && (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white/90 backdrop-blur dark:bg-zinc-950/90">
                  <tr className="border-b border-black/5 text-gray-500 dark:border-white/10 dark:text-gray-400">
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-4 py-2 text-right font-medium">Reseñas</th>
                    <th className="px-4 py-2 text-right font-medium">Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/5">
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{formatDateTime(s.created_at)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{s.review_count}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                        <StarRating value={s.rating} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-4 w-16" />
      <div className="mt-4 flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="my-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

export default function BusinessDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: business, isLoading: loadingBusiness } = useBusiness(id!)
  const { data: snapshots, isLoading: loadingSnapshots } = useSnapshots(id!)
  const online = useOnlineStatus()

  if (loadingBusiness) return <DetailSkeleton />

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="mb-4 text-gray-500 dark:text-gray-400">Negocio no encontrado.</p>
        <Link to="/">
          <Button variant="secondary">Volver al dashboard</Button>
        </Link>
      </div>
    )
  }

  const gained = business.current_reviews - business.initial_reviews
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthGoalProgress = business.monthly_goal
    ? monthlyGained(snapshots ?? [], business.current_reviews, monthStart)
    : 0

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        to="/"
        className={`inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 ${FOCUS_RING}`}
      >
        <Icon path="arrowLeft" className="h-3.5 w-3.5" filled={false} />
        Volver
      </Link>

      {!online && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Sin conexión — mostrando los últimos datos guardados.
        </div>
      )}

      <div className="mt-4 flex items-center gap-4">
        {business.photo_url ? (
          <img src={business.photo_url} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-black/5 dark:ring-white/10" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-black/5 ring-2 ring-black/5 dark:bg-white/5 dark:ring-white/10" />
        )}
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{business.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <MetaPill>
              <StarRating value={business.current_rating} />
            </MetaPill>
            <MetaPill>
              <span className={`h-1.5 w-1.5 rounded-full ${business.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
              {business.status === 'active' ? 'Activo' : 'Detenido'}
            </MetaPill>
            {business.billing_day && <MetaPill>Cobro el {business.billing_day}</MetaPill>}
            {business.category &&
              (() => {
                const visual = getCategoryVisual(business.category)
                return (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{ color: visual.color, backgroundColor: `${visual.color}22` }}
                  >
                    <Icon path={visual.icon} className="h-3.5 w-3.5" filled={false} />
                    {business.category}
                  </span>
                )
              })()}
          </div>
        </div>
      </div>

      {business.last_sync_error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="font-medium">Error de sincronización: </span>
          {business.last_sync_error}
        </div>
      )}

      <div className="my-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="col-span-2 flex flex-col items-center justify-center p-6 sm:order-first">
          <p className="text-4xl font-bold tabular-nums">
            <Delta value={gained} />
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">reseñas ganadas</p>
        </Card>
        <Stat label="Iniciales" value={business.initial_reviews} />
        <Stat label="Actuales" value={business.current_reviews} />
      </div>

      {business.monthly_goal && (
        <Card className="mb-6 p-4">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-300">Meta del mes</span>
            <span className="tabular-nums font-medium text-gray-900 dark:text-gray-100">
              {monthGoalProgress}/{business.monthly_goal}
            </span>
          </div>
          <ProgressBar value={monthGoalProgress} max={business.monthly_goal} />
        </Card>
      )}

      <p className="mb-2 text-xs text-gray-400">
        Seguimiento iniciado el {new Date(business.started_at).toLocaleDateString('es-ES')}
        {business.last_synced_at && ` · última actualización ${formatDateTime(business.last_synced_at)}`}
      </p>

      <div className="my-6 flex flex-wrap gap-2">
        <SettingsPanel business={business} />
        <MonthlyReports businessId={business.id} businessName={business.name} />
        <HistoryPanel business={business} snapshots={snapshots} loading={loadingSnapshots} />
        <AiInsights businessId={business.id} />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-medium text-gray-900 dark:text-gray-100">Crecimiento de reseñas</h2>
      <Card className="p-4">{snapshots && <GrowthChart snapshots={snapshots} />}</Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="flex flex-col items-center justify-center p-4 text-center">
      <p className="text-2xl font-bold tabular-nums text-gray-700 dark:text-gray-300">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </Card>
  )
}
