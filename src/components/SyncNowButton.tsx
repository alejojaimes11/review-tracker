import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Button, Card } from './ui'

const POLL_EVERY_MS = 10_000
const GIVE_UP_AFTER_MS = 180_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How each active business stands since the sync started. */
async function progressSince(sinceMs: number) {
  const { data, error } = await supabase
    .from('businesses')
    .select('updated_at, last_sync_error')
    .eq('status', 'active')
    .is('deleted_at', null)
  if (error) throw error

  const rows = data ?? []
  // The sync stamps updated_at on every business it touches, whether it worked or failed.
  const touched = rows.filter((b) => new Date(b.updated_at).getTime() >= sinceMs)
  const failed = touched.filter((b) => b.last_sync_error !== null).length
  return { total: rows.length, done: touched.length, failed, ok: touched.length - failed }
}

/** Admin-only: refresh every business now, without waiting for the 6-hour schedule. */
export function SyncNowButton() {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function start() {
    setMessage(null)
    setRunning(true)
    try {
      const { data, error } = await supabase.functions.invoke('sync-now', { body: {} })
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const payload = await error.context.json().catch(() => null)
          throw new Error(payload?.error ?? error.message)
        }
        throw error
      }

      // The sync runs in the background (a minute or two): watch the businesses fill in.
      const since = new Date(data.started_at).getTime() - 2000
      const deadline = Date.now() + GIVE_UP_AFTER_MS
      let progress = await progressSince(since)
      while (progress.done < progress.total && Date.now() < deadline) {
        await sleep(POLL_EVERY_MS)
        progress = await progressSince(since)
      }

      await queryClient.invalidateQueries({ queryKey: ['businesses'] })
      await queryClient.invalidateQueries({ queryKey: ['snapshots'] })

      if (progress.done < progress.total) {
        setMessage(
          `Sigue en curso: ${progress.done} de ${progress.total} negocios ya revisados. Los demás pueden tardar unos minutos más.`,
        )
      } else if (progress.failed === 0) {
        setMessage(
          `Listo: ${progress.ok} negocios actualizados. Si sumaron reseñas te llegará una notificación (puede tardar hasta 15 minutos).`,
        )
      } else if (progress.ok === 0) {
        setMessage(
          'No se pudo actualizar ningún negocio. Lo más probable es que Apify se haya quedado sin crédito: revisalo en console.apify.com/billing.',
        )
      } else {
        setMessage(
          `Se actualizaron ${progress.ok} de ${progress.total} negocios; ${progress.failed} fallaron. Te avisaremos por notificación.`,
        )
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo iniciar la actualización.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="sm:relative">
      <Button
        variant="secondary"
        onClick={() => void start()}
        disabled={running}
        className="!px-2.5 text-xs whitespace-nowrap"
      >
        {running ? (
          'Actualizando…'
        ) : (
          <>
            <span className="sm:hidden">↻ Actualizar</span>
            <span className="hidden sm:inline">↻ Actualizar reseñas</span>
          </>
        )}
      </Button>

      {(running || message) && (
        <Card className="absolute inset-x-0 top-full z-10 mt-2 !bg-white p-3 text-sm shadow-lg dark:!bg-[#14141c] sm:inset-x-auto sm:right-0 sm:w-80">
          {running ? (
            <p className="text-gray-700 dark:text-gray-300">
              Actualizando todos los negocios… puede tardar 1 o 2 minutos. No hace falta que esperes aquí.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-gray-700 dark:text-gray-300">{message}</p>
              <Button variant="ghost" onClick={() => setMessage(null)} className="!px-2 !py-1 text-xs">
                Cerrar
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
