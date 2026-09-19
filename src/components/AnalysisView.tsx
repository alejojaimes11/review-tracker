import { useState, type ReactNode } from 'react'
import { Badge, Button, CRITICAL_COLOR, GOOD_COLOR, Icon, StarRating, WARNING_COLOR } from './ui'
import type { Analysis, AnalysisAction, AnalysisStats, Priority } from '../types'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PRIORITY_STYLE: Record<Priority, { color: string; label: string; icon: 'warning' | 'tag' }> = {
  alta: { color: CRITICAL_COLOR, label: 'Prioridad alta', icon: 'warning' },
  media: { color: WARNING_COLOR, label: 'Prioridad media', icon: 'tag' },
  baja: { color: '#94a3b8', label: 'Prioridad baja', icon: 'tag' },
}

function Section({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <section>
      <h4 className={`mb-2 text-sm font-medium ${tone}`}>{title}</h4>
      {children}
    </section>
  )
}

function Quote({ text }: { text: string }) {
  if (!text) return null
  return (
    <p className="mt-1.5 border-l-2 border-violet-400/50 pl-2 text-xs italic text-gray-500 dark:text-gray-400">
      “{text}”
    </p>
  )
}

function Mentions({ n, total }: { n: number; total: number }) {
  return (
    <span className="text-xs text-gray-500 dark:text-gray-400">
      En {n} de {total} reseñas
    </span>
  )
}

const ITEM_BOX = 'rounded-xl border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]'

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={ITEM_BOX}>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900 dark:text-gray-100" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400">{sub}</p>}
    </div>
  )
}

function Stats({ stats }: { stats: AnalysisStats }) {
  const trend =
    stats.tendencia === 'sube'
      ? { value: '↑ Mejorando', color: GOOD_COLOR }
      : stats.tendencia === 'baja'
        ? { value: '↓ Empeorando', color: CRITICAL_COLOR }
        : stats.tendencia === 'estable'
          ? { value: '→ Estable', color: undefined }
          : { value: '—', color: undefined }

  const trendSub =
    stats.promedio_recientes !== null && stats.promedio_anteriores !== null
      ? `${stats.promedio_recientes} recientes vs ${stats.promedio_anteriores} antes`
      : 'Pocas reseñas para comparar'

  const max = Math.max(1, ...Object.values(stats.distribucion))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Promedio" value={stats.promedio !== null ? `${stats.promedio} ★` : '—'} sub={`${stats.total} reseñas`} />
        <StatTile label="Positivas (4-5★)" value={`${stats.positivas_pct}%`} color={GOOD_COLOR} />
        <StatTile label="Negativas (1-2★)" value={`${stats.negativas_pct}%`} color={stats.negativas_pct > 0 ? CRITICAL_COLOR : undefined} />
        <StatTile label="Tendencia" value={trend.value} sub={trendSub} color={trend.color} />
      </div>

      <div className="space-y-1">
        {[5, 4, 3, 2, 1].map((star) => {
          const n = stats.distribucion[String(star)] ?? 0
          return (
            <div key={star} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="w-6 tabular-nums">{star}★</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </div>
              <span className="w-5 text-right tabular-nums">{n}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActionCard({ action, total }: { action: AnalysisAction; total: number }) {
  const style = PRIORITY_STYLE[action.prioridad]
  return (
    <li className={ITEM_BOX}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Badge color={style.color} icon={style.icon}>
          {style.label}
        </Badge>
        {action.plazo && (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
            {action.plazo}
          </span>
        )}
        <Mentions n={action.respaldo} total={total} />
      </div>
      <p className="font-medium text-gray-900 dark:text-gray-100">{action.accion}</p>
      {action.motivo && <p className="mt-0.5 text-gray-600 dark:text-gray-400">{action.motivo}</p>}
      {action.pasos && action.pasos.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-gray-700 dark:text-gray-300">
          {action.pasos.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      )}
      {action.impacto && (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
          <span className="font-medium">Qué se espera: </span>
          {action.impacto}
        </p>
      )}
      <Quote text={action.cita} />
    </li>
  )
}

function ReplyCard({ rating, resena, respuesta }: { rating: number | null; resena: string; respuesta: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(respuesta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions / insecure context) — the text stays selectable.
    }
  }

  return (
    <li className={ITEM_BOX}>
      <div className="mb-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <StarRating value={rating} />
        <span>Reseña original</span>
      </div>
      <p className="mb-2 text-xs italic text-gray-500 dark:text-gray-400">“{resena}”</p>
      <p className="whitespace-pre-line text-gray-800 dark:text-gray-200">{respuesta}</p>
      <div className="mt-2">
        <Button variant="secondary" onClick={copy} className="!px-3 !py-1 !text-xs">
          <Icon path="check" className="h-3 w-3" filled={false} />
          {copied ? 'Copiada' : 'Copiar respuesta'}
        </Button>
      </div>
    </li>
  )
}

/** One saved analysis. The complete version has many sections; analyses saved before it fall back to the original three. */
export function AnalysisView({ analysis }: { analysis: Analysis }) {
  const d = analysis.detalle ?? {}
  const isComplete = !!d.resumen
  const total = analysis.review_count

  return (
    <div className="space-y-5 text-sm">
      {isComplete ? (
        <>
          <Section title="Resumen" tone="text-violet-600 dark:text-violet-400">
            <p className="text-gray-700 dark:text-gray-300">{d.resumen}</p>
          </Section>

          {d.estadisticas && (
            <Section title="Los números" tone="text-gray-700 dark:text-gray-200">
              <Stats stats={d.estadisticas} />
            </Section>
          )}

          {d.fortalezas && d.fortalezas.length > 0 && (
            <Section title="Qué están haciendo bien" tone="text-emerald-600 dark:text-emerald-400">
              <ul className="space-y-2">
                {d.fortalezas.map((f, i) => (
                  <li key={i} className={ITEM_BOX}>
                    <div className="mb-0.5 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{f.tema}</span>
                      <Mentions n={f.respaldo} total={total} />
                    </div>
                    <p className="text-gray-700 dark:text-gray-300">{f.detalle}</p>
                    <Quote text={f.cita} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Qué deberían mejorar" tone="text-amber-600 dark:text-amber-400">
            {!d.oportunidades || d.oportunidades.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">Las reseñas recientes no señalan ningún problema concreto.</p>
            ) : (
              <ul className="space-y-2">
                {d.oportunidades.map((o, i) => {
                  const style = PRIORITY_STYLE[o.gravedad]
                  return (
                    <li key={i} className={ITEM_BOX}>
                      <div className="mb-0.5 flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">{o.tema}</span>
                        <Badge color={style.color} icon={style.icon}>
                          {style.label.replace('Prioridad', 'Gravedad')}
                        </Badge>
                        <Mentions n={o.respaldo} total={total} />
                      </div>
                      <p className="text-gray-700 dark:text-gray-300">{o.detalle}</p>
                      <Quote text={o.cita} />
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          {d.temas && d.temas.length > 0 && (
            <Section title="De qué hablan los clientes" tone="text-gray-700 dark:text-gray-200">
              <ul className="space-y-1.5">
                {(() => {
                  const maxTotal = Math.max(1, ...d.temas.map((t) => t.positivas + t.negativas))
                  return d.temas.map((t, i) => {
                    const sum = t.positivas + t.negativas
                    return (
                      <li key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <span className="w-28 shrink-0 truncate sm:w-36">{t.nombre}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                          <div className="flex h-full" style={{ width: `${(sum / maxTotal) * 100}%` }}>
                            <div style={{ width: `${(t.positivas / sum) * 100}%`, backgroundColor: GOOD_COLOR }} />
                            <div style={{ width: `${(t.negativas / sum) * 100}%`, backgroundColor: CRITICAL_COLOR }} />
                          </div>
                        </div>
                        <span className="w-16 shrink-0 text-right tabular-nums">
                          +{t.positivas} / −{t.negativas}
                        </span>
                      </li>
                    )
                  })
                })()}
              </ul>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="Qué está haciendo bien" tone="text-emerald-600 dark:text-emerald-400">
            <p className="text-gray-700 dark:text-gray-300">{analysis.bien || '—'}</p>
          </Section>
          <Section title="Qué debería mejorar" tone="text-amber-600 dark:text-amber-400">
            <p className="text-gray-700 dark:text-gray-300">{analysis.mejorar || '—'}</p>
          </Section>
        </>
      )}

      <Section title={isComplete ? 'Plan de acción' : 'Qué hacer primero'} tone="text-violet-600 dark:text-violet-400">
        {analysis.acciones.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">
            Sin acciones urgentes: las reseñas recientes no señalan ningún problema concreto.
          </p>
        ) : (
          <ol className="space-y-2">
            {analysis.acciones.map((a, i) => (
              <ActionCard key={i} action={a} total={total} />
            ))}
          </ol>
        )}
      </Section>

      {d.respuestas && d.respuestas.length > 0 && (
        <Section title="Cómo responder a las reseñas negativas" tone="text-sky-600 dark:text-sky-400">
          <ul className="space-y-2">
            {d.respuestas.map((r, i) => (
              <ReplyCard key={i} rating={r.rating} resena={r.resena} respuesta={r.respuesta} />
            ))}
          </ul>
        </Section>
      )}

      <p className="text-xs text-gray-400">
        {formatDateTime(analysis.created_at)} · basado en {analysis.review_count} reseña
        {analysis.review_count === 1 ? '' : 's'} reciente{analysis.review_count === 1 ? '' : 's'} con texto ·{' '}
        {analysis.provider}
      </p>
    </div>
  )
}
