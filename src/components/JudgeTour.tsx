import { Link } from 'react-router-dom'
import type { Business } from '../types'
import { Button, Card, Delta, FOCUS_RING, Icon, StarRating } from './ui'

/** Eye-catching on purpose: it's the first thing a judge should press. Toggles the whole tour. */
export function TourButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_22px_-2px_rgba(217,70,239,0.75)] transition-all duration-150 hover:shadow-[0_0_30px_0px_rgba(217,70,239,0.9)] hover:brightness-110 ${FOCUS_RING}`}
    >
      <Icon path="sparkle" className="h-4 w-4" />
      {active ? 'Salir de la guía' : 'Guía para jueces'}
    </button>
  )
}

/** Step 0: a welcome modal that appears on its own for a first-time visitor. */
export function TourWelcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onSkip}>
      <div onClick={(e) => e.stopPropagation()}>
        <Card className="max-w-sm border-fuchsia-500/40 p-6 text-center shadow-[0_0_40px_-8px_rgba(217,70,239,0.6)]">
          <p className="text-4xl">👋</p>
          <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">¡Bienvenido a MarketPulse!</h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Este sistema real sigue las reseñas de Google de negocios reales y las convierte en decisiones con ayuda de IA. Te
            mostramos cómo en dos pasos rápidos.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={onStart}>Empezar recorrido →</Button>
            <Button variant="ghost" onClick={onSkip}>
              Prefiero explorar solo
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** Step 1: points at one real, already-analyzed business and invites a tap. */
export function TourPickCard({ business, onPick, onSkip }: { business: Business; onPick: () => void; onSkip: () => void }) {
  const gained = business.current_reviews - business.initial_reviews
  return (
    <Card className="mb-6 border-fuchsia-500/40 p-4 shadow-[0_0_28px_-8px_rgba(217,70,239,0.6)]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400">Paso 1 de 2</span>
        <Button variant="ghost" onClick={onSkip} className="!px-2 !py-1 text-xs">
          Saltar guía
        </Button>
      </div>
      <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">👉 Tocá acá para entrar a un negocio real</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Elegimos uno con historial de reseñas y un análisis de IA ya generado, para que veas todo de una vez.
      </p>

      <Link
        to={`/business/${business.id}`}
        onClick={onPick}
        className={`mt-3 flex items-center gap-3 rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/5 p-3 transition-colors hover:bg-fuchsia-500/10 ${FOCUS_RING}`}
      >
        {business.photo_url ? (
          <img src={business.photo_url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded-full bg-black/5 dark:bg-white/5" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-gray-900 dark:text-gray-100">{business.name}</p>
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <StarRating value={business.current_rating} />
            <Delta value={gained} />
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white">
          Ver negocio →
        </span>
      </Link>
    </Card>
  )
}

/** Step 2: shown on the business page, right above where the AI analysis lives. */
export function TourAnalysisCallout({ onDone }: { onDone: () => void }) {
  return (
    <Card className="mb-4 border-fuchsia-500/40 p-4 shadow-[0_0_28px_-8px_rgba(217,70,239,0.6)]">
      <span className="text-xs font-semibold uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400">Paso 2 de 2</span>
      <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">👉 Ahora acá: el análisis con IA</h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
        Tocá el botón de abajo (⬇) para ver fortalezas, oportunidades y un plan de acción basado en las reseñas reales de este negocio.
      </p>
      <Button onClick={onDone} className="mt-3">
        Entendido, ¡a explorar! ✓
      </Button>
    </Card>
  )
}
