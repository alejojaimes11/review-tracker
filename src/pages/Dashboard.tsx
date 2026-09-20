import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useAddBusiness,
  useBusinesses,
  useRecentSnapshots,
  useResumeTracking,
  useRestoreBusiness,
  useStopTracking,
  useTrashedBusinesses,
  type SnapshotPoint,
} from '../api/businesses'
import { useTheme } from '../hooks/useTheme'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useIsAdmin } from '../hooks/useAdmin'
import { PushToggle } from '../components/PushToggle'
import { NotificationBell } from '../components/NotificationBell'
import { supabase } from '../lib/supabase'
import {
  Badge,
  Button,
  Card,
  Delta,
  FOCUS_RING,
  GOOD_COLOR,
  Icon,
  ProgressBar,
  Skeleton,
  Sparkline,
  StarRating,
  Toast,
  WARNING_COLOR,
  CRITICAL_COLOR,
} from '../components/ui'
import { buildWhatsAppLink, daysSince, dailySeries, getBusinessRisk, getCategoryVisual, monthlyGained } from '../lib/business'
import type { Business } from '../types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function daysAgoLabel(days: number) {
  const d = Math.floor(days)
  if (d <= 0) return 'Última reseña: hoy'
  if (d === 1) return 'Última reseña: ayer'
  return `Última reseña: hace ${d} días`
}

function nextBillingDate(day: number, from: Date) {
  const candidate = new Date(from.getFullYear(), from.getMonth(), day)
  const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  if (candidate < todayMidnight) candidate.setMonth(candidate.getMonth() + 1)
  return candidate
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" className="h-8 w-8 rounded-[9px]" />
      <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        Market<span className="text-violet-500 dark:text-violet-400">Pulse</span>
      </span>
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme()

  return (
    <Button variant="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema" className="!px-2.5">
      {theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </Button>
  )
}

function AddBusinessForm() {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [addedName, setAddedName] = useState<string | null>(null)
  const addBusiness = useAddBusiness()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    addBusiness.mutate(input, {
      onSuccess: (business) => {
        setInput('')
        setOpen(false)
        setAddedName(business.name)
      },
    })
  }

  return (
    <>
      {addedName && <Toast message={`"${addedName}" agregado correctamente`} onDismiss={() => setAddedName(null)} />}

      {!open ? (
        <Button onClick={() => setOpen(true)} className="whitespace-nowrap">
          <span className="text-base leading-none">+</span> Agregar negocio
        </Button>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full flex-wrap items-start gap-2 sm:w-auto sm:flex-nowrap">
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="URL de Google Maps o nombre del negocio + ciudad"
              className="w-full rounded-lg border border-black/10 sm:w-80 bg-white/80 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
            />
            {addBusiness.isError && (
              <span className="text-xs text-red-600 dark:text-red-400">{(addBusiness.error as Error).message}</span>
            )}
          </div>
          <Button type="submit" disabled={addBusiness.isPending || !input.trim()}>
            {addBusiness.isPending ? 'Agregando…' : 'Agregar'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </form>
      )}
    </>
  )
}

function BusinessCard({
  business,
  isTopPerformer,
  recentSnapshots,
  monthStart,
}: {
  business: Business
  isTopPerformer: boolean
  recentSnapshots: SnapshotPoint[]
  monthStart: Date
}) {
  const stopTracking = useStopTracking()
  const resumeTracking = useResumeTracking()
  const isAdmin = useIsAdmin()
  const gained = business.current_reviews - business.initial_reviews
  const { lowUsage, ratingDropped, negativeReview } = getBusinessRisk(business)
  const sparkline = useMemo(() => dailySeries(recentSnapshots, 14), [recentSnapshots])
  const goalProgress = business.monthly_goal
    ? monthlyGained(recentSnapshots, business.current_reviews, monthStart)
    : null
  const categoryVisual = business.category ? getCategoryVisual(business.category) : null

  return (
    <Card className="p-5 transition-all hover:border-violet-500/30 hover:shadow-[0_0_28px_-10px_rgba(139,92,246,0.4)]">
      <Link to={`/business/${business.id}`} className={`block rounded-xl ${FOCUS_RING}`}>
        <div className="flex items-center gap-3">
          {business.photo_url ? (
            <img
              src={business.photo_url}
              alt=""
              className={categoryVisual ? 'h-12 w-12 rounded-full object-cover' : 'h-12 w-12 rounded-full object-cover ring-2 ring-black/5 dark:ring-white/10'}
              style={categoryVisual ? { boxShadow: `0 0 0 2px ${categoryVisual.color}80` } : undefined}
            />
          ) : (
            <div
              className={
                categoryVisual
                  ? 'h-12 w-12 rounded-full bg-black/5 dark:bg-white/5'
                  : 'h-12 w-12 rounded-full bg-black/5 ring-2 ring-black/5 dark:bg-white/5 dark:ring-white/10'
              }
              style={categoryVisual ? { boxShadow: `0 0 0 2px ${categoryVisual.color}80` } : undefined}
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium text-gray-900 dark:text-gray-100">{business.name}</p>
            <p className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <StarRating value={business.current_rating} />
              {business.category && categoryVisual && (
                <span
                  className="inline-flex items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-xs font-medium"
                  style={{ color: categoryVisual.color, backgroundColor: `${categoryVisual.color}22` }}
                >
                  <Icon path={categoryVisual.icon} className="h-3 w-3" filled={false} />
                  {business.category}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="my-4 text-center">
          <p className="text-5xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
            <Delta value={gained} />
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">reseñas ganadas</p>
        </div>
      </Link>

      {(lowUsage || ratingDropped || isTopPerformer || negativeReview) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {isTopPerformer && (
            <Badge color={GOOD_COLOR} icon="trophy">
              Mejor desempeño
            </Badge>
          )}
          {negativeReview && <Badge color={CRITICAL_COLOR}>Reseña negativa nueva</Badge>}
          {lowUsage && <Badge color={WARNING_COLOR}>Poco uso</Badge>}
          {ratingDropped && <Badge color={CRITICAL_COLOR}>Rating bajó</Badge>}
        </div>
      )}

      {goalProgress !== null && business.monthly_goal && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Meta del mes</span>
            <span className="tabular-nums">
              {goalProgress}/{business.monthly_goal}
            </span>
          </div>
          <ProgressBar value={goalProgress} max={business.monthly_goal} />
        </div>
      )}

      {business.status === 'active' && business.last_growth_at && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
            {daysAgoLabel(daysSince(business.last_growth_at))}
          </span>
          {sparkline.length >= 2 && <div className="w-20"><Sparkline values={sparkline} /></div>}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              business.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
            }`}
          />
          {business.status === 'active' ? 'Activo' : 'Detenido'}
        </span>
        <span>desde {formatDate(business.started_at)}</span>
      </div>

      {isAdmin && (business.status === 'active' ? (
        <Button
          variant="secondary"
          onClick={() => stopTracking.mutate(business.id)}
          disabled={stopTracking.isPending}
          className="mt-3 w-full !py-1.5 text-xs"
        >
          Detener seguimiento
        </Button>
      ) : (
        <Button
          variant="secondary"
          onClick={() => resumeTracking.mutate(business.id)}
          disabled={resumeTracking.isPending}
          className="mt-3 w-full !py-1.5 text-xs"
        >
          Reanudar seguimiento
        </Button>
      ))}
    </Card>
  )
}

function CardSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="my-6 flex flex-col items-center gap-2">
        <Skeleton className="h-10 w-16" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-3 w-full" />
    </Card>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/10 py-20 text-center dark:border-white/10">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-500 shadow-[0_0_24px_-6px_rgba(139,92,246,0.5)] dark:text-violet-400">
        <Icon path="star" className="h-7 w-7" />
      </div>
      <p className="font-medium text-gray-900 dark:text-gray-100">Todavía no hay negocios</p>
      <p className="mb-4 mt-1 max-w-xs text-sm text-gray-500 dark:text-gray-400">
        Agrega el primero para empezar a ver cuántas reseñas gana desde hoy.
      </p>
    </div>
  )
}

function RiskSection({ businesses }: { businesses: Business[] }) {
  const [open, setOpen] = useState(false)
  const risky = businesses.filter((b) => getBusinessRisk(b).any)
  if (risky.length === 0) return null

  return (
    <div className="mb-6">
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        className="w-full !justify-between border-red-500/30 !py-2.5 text-red-600 dark:border-red-500/20 dark:text-red-400"
      >
        <span className="flex items-center gap-1.5">
          <Icon path="warning" className="h-4 w-4" />
          Negocios en riesgo ({risky.length})
        </span>
        <Icon path="chevronDown" className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} filled={false} />
      </Button>

      {open && (
        <Card className="mt-2 p-4">
          <ul className="space-y-1.5">
            {risky.map((b) => {
              const risk = getBusinessRisk(b)
              const whatsappLink = buildWhatsAppLink(b, risk)
              return (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-sm hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  <Link
                    to={`/business/${b.id}`}
                    className={`rounded text-gray-700 underline-offset-2 hover:underline dark:text-gray-300 ${FOCUS_RING}`}
                  >
                    {b.name}
                  </Link>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {risk.negativeReview && <Badge color={CRITICAL_COLOR}>Reseña negativa nueva</Badge>}
                    {risk.ratingDropped && <Badge color={CRITICAL_COLOR}>Rating bajó</Badge>}
                    {risk.lowUsage && <Badge color={WARNING_COLOR}>Poco uso</Badge>}
                    {whatsappLink && (
                      <a
                        href={whatsappLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Recordatorio por WhatsApp"
                        className={`rounded text-green-600 hover:text-green-700 dark:text-green-500 dark:hover:text-green-400 ${FOCUS_RING}`}
                      >
                        <Icon path="whatsapp" className="h-4 w-4" filled={false} />
                      </a>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}

function TrashSection() {
  const { data: trashed } = useTrashedBusinesses()
  const [open, setOpen] = useState(false)
  const restoreBusiness = useRestoreBusiness()

  if (!trashed || trashed.length === 0) return null

  return (
    <div className="sm:relative">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)} className="!px-2.5 whitespace-nowrap">
        <Icon path="trash" className="h-4 w-4" filled={false} />
        Papelera ({trashed.length})
      </Button>

      {open && (
        <Card className="absolute inset-x-0 top-full z-10 mt-2 !bg-white p-3 shadow-lg dark:!bg-[#14141c] sm:inset-x-auto sm:right-0 sm:w-72">
          <ul className="space-y-2">
            {trashed.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-gray-700 dark:text-gray-300">{b.name}</span>
                <Button
                  variant="ghost"
                  onClick={() => restoreBusiness.mutate(b.id)}
                  disabled={restoreBusiness.isPending}
                  className="!px-2 !py-1 text-xs"
                >
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function UpcomingBilling({ businesses }: { businesses: Business[] }) {
  const now = new Date()
  const upcoming = businesses
    .filter((b) => b.billing_day)
    .map((b) => ({ business: b, date: nextBillingDate(b.billing_day!, now) }))
    .filter(({ date }) => (date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000 <= 7)
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  if (upcoming.length === 0) return null

  return (
    <Card className="mb-6 p-4">
      <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">Cobros esta semana</p>
      <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
        {upcoming.map(({ business, date }) => (
          <li key={business.id} className="flex justify-between">
            <span>{business.name}</span>
            <span className="text-gray-400">{formatDate(date.toISOString())}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function CategoryFilter({
  categories,
  selected,
  onSelect,
}: {
  categories: string[]
  selected: string | null
  onSelect: (c: string | null) => void
}) {
  if (categories.length === 0) return null

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${FOCUS_RING} ${
          selected === null
            ? 'bg-violet-600 text-white shadow-[0_0_12px_-2px_rgba(139,92,246,0.6)] dark:bg-violet-500'
            : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10'
        }`}
      >
        Todos
      </button>
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${FOCUS_RING} ${
            selected === c
              ? 'bg-violet-600 text-white shadow-[0_0_12px_-2px_rgba(139,92,246,0.6)] dark:bg-violet-500'
              : 'bg-black/5 text-gray-600 hover:bg-black/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10'
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data: businesses, isLoading, isError, error } = useBusinesses()
  const { data: recentSnapshots } = useRecentSnapshots()
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const sorted = businesses
    ? [...businesses].sort(
        (a, b) => b.current_reviews - b.initial_reviews - (a.current_reviews - a.initial_reviews),
      )
    : undefined

  const categories = sorted
    ? [...new Set(sorted.map((b) => b.category).filter((c): c is string => !!c))].sort()
    : []

  const filtered = sorted?.filter((b) => selectedCategory === null || b.category === selectedCategory)
  const online = useOnlineStatus()
  const isAdmin = useIsAdmin()

  const snapshotsByBusiness = useMemo(() => {
    const map = new Map<string, SnapshotPoint[]>()
    for (const s of recentSnapshots ?? []) {
      const list = map.get(s.business_id)
      if (list) list.push(s)
      else map.set(s.business_id, [s])
    }
    return map
  }, [recentSnapshots])

  const monthStart = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <Logo />
        {/* On phones the actions take their own full-width row and wrap; the
            popovers inside anchor to this row (relative) instead of to one button. */}
        <div className="relative flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <AddBusinessForm />
          {isAdmin && <NotificationBell />}
          {isAdmin && <PushToggle />}
          {isAdmin && <TrashSection />}
          {isAdmin && (
            <Button variant="ghost" onClick={() => supabase.auth.signOut()} className="!px-2.5 text-xs whitespace-nowrap">
              Salir
            </Button>
          )}
          <ThemeToggle />
        </div>
      </div>

      {!online && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Sin conexión — mostrando los últimos datos guardados.
        </div>
      )}

      {isError && <p className="text-red-600 dark:text-red-400">{(error as Error).message}</p>}

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {sorted && sorted.length === 0 && <EmptyState />}

      {sorted && sorted.length > 0 && (
        <>
          <RiskSection businesses={sorted} />
          <UpcomingBilling businesses={sorted} />
          <CategoryFilter categories={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered?.map((b) => (
              <BusinessCard
                key={b.id}
                business={b}
                isTopPerformer={b.id === sorted[0]?.id && b.status === 'active' && b.current_reviews - b.initial_reviews > 0}
                recentSnapshots={snapshotsByBusiness.get(b.id) ?? []}
                monthStart={monthStart}
              />
            ))}
          </div>
        </>
      )}

      {/* An installed app has no address bar, so /admin can't be typed there. */}
      {!isAdmin && (
        <p className="mt-10 text-center text-xs">
          <Link to="/admin" className={`rounded text-gray-400 dark:text-gray-500 ${FOCUS_RING}`}>
            Acceso admin
          </Link>
        </p>
      )}
    </div>
  )
}
