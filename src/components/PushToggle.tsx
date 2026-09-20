import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Button, Card } from './ui'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

type State =
  | 'checking'
  | 'unsupported'
  | 'off' // permission not asked yet, or granted without a subscription
  | 'denied'
  | 'on'
  | 'busy'
  | 'error'

const isSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

// applicationServerKey must be raw bytes; the VAPID key is base64url text.
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? error.message)
    }
    throw error
  }
  return data as T
}

/** `serviceWorker.ready` never resolves if no worker registers (e.g. dev), so don't wait forever. */
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
}

/** Admin-only. Permission is requested only from the button click, never on load. */
export function PushToggle() {
  const [state, setState] = useState<State>('checking')
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'default' : Notification.permission,
  )

  const refresh = useCallback(async () => {
    if (!isSupported() || !VAPID_PUBLIC_KEY) return setState('unsupported')
    setPermission(Notification.permission)
    if (Notification.permission === 'denied') return setState('denied')
    const reg = await getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    setState(sub ? 'on' : 'off')
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial read of browser push state
    void refresh()
  }, [refresh])

  async function activate() {
    setMessage(null)
    setState('busy')
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        setState(result === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await getRegistration()
      if (!reg) throw new Error('El service worker todavía no está listo. Recargá e intentá de nuevo.')

      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY!),
        }))

      try {
        await callFunction('register-push', { action: 'subscribe', subscription: sub.toJSON() })
      } catch (err) {
        // Keep browser and server in step: no local subscription the server doesn't know.
        await sub.unsubscribe().catch(() => {})
        throw err
      }
      setState('on')
      setOpen(true)
      setMessage('Listo. Este dispositivo recibirá notificaciones.')
    } catch (err) {
      setState('error')
      setOpen(true)
      setMessage(err instanceof Error ? err.message : 'No se pudieron activar las notificaciones.')
    }
  }

  async function deactivate() {
    setMessage(null)
    setState('busy')
    try {
      const reg = await getRegistration()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        await callFunction('register-push', { action: 'unsubscribe', endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setState('off')
      setMessage('Notificaciones desactivadas en este dispositivo.')
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'No se pudieron desactivar.')
    }
  }

  async function sendTest(delaySeconds = 0) {
    setMessage('Enviando…')
    try {
      const r = await callFunction<{ sent?: number; failed?: number; scheduled?: boolean }>('send-test-push', {
        delay_seconds: delaySeconds,
      })
      if (r.scheduled) {
        setMessage(`Programada. Cerrá la pestaña: llegará en ${delaySeconds} segundos.`)
      } else {
        setMessage(
          (r.failed ?? 0) > 0
            ? `Enviada a ${r.sent} dispositivo(s); ${r.failed} fallaron.`
            : `Enviada a ${r.sent} dispositivo(s).`,
        )
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'No se pudo enviar la prueba.')
    }
  }

  if (state === 'checking') return null

  if (state === 'unsupported') {
    // Say why instead of hiding the button — otherwise it looks like a bug on phones.
    const ua = navigator.userAgent
    const isApple = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
    return (
      <div className="relative">
        <Button variant="secondary" onClick={() => setOpen((v) => !v)} className="!px-2.5 text-xs">
          🔕 Notificaciones no disponibles
        </Button>
        {open && (
          <Card className="absolute right-0 top-full z-10 mt-2 w-72 !bg-white dark:!bg-[#14141c] p-3 text-sm text-gray-700 shadow-lg dark:text-gray-300">
            {!VAPID_PUBLIC_KEY
              ? 'Falta la clave de notificaciones en esta versión de la app.'
              : isApple
                ? 'En iPhone/iPad las notificaciones solo funcionan con la app instalada: en Safari tocá Compartir → "Agregar a inicio", abrí MarketPulse desde el ícono y volvé a entrar como admin. Requiere iOS 16.4 o superior.'
                : 'Este navegador no permite notificaciones push. Probá con Chrome o Edge actualizado.'}
          </Card>
        )}
      </div>
    )
  }

  const label =
    state === 'on'
      ? '🔔 Notificaciones activadas'
      : state === 'denied'
        ? '🔕 Notificaciones bloqueadas'
        : state === 'error'
          ? '⚠️ Notificaciones: error'
          : permission === 'granted'
            ? '🔔 Permiso concedido · Activar'
            : '🔔 Activar notificaciones'

  function handleClick() {
    if (state === 'off') void activate()
    else setOpen((v) => !v)
  }

  return (
    <div className="relative">
      <Button variant="secondary" onClick={handleClick} disabled={state === 'busy'} className="!px-2.5 text-xs">
        {state === 'busy' ? 'Un momento…' : label}
      </Button>

      {open && state !== 'busy' && (
        <Card className="absolute right-0 top-full z-10 mt-2 w-72 !bg-white dark:!bg-[#14141c] p-3 text-sm shadow-lg">
          {state === 'denied' && (
            <p className="text-gray-700 dark:text-gray-300">
              El navegador bloqueó las notificaciones. Habilitalas en la configuración del sitio y recargá.
            </p>
          )}
          {state === 'error' && (
            <div className="space-y-2">
              <p className="text-red-600 dark:text-red-400">{message}</p>
              <Button onClick={() => void activate()} className="!px-3 !py-1.5 text-xs">
                Reintentar
              </Button>
            </div>
          )}
          {state === 'on' && (
            <div className="space-y-2">
              {message && <p className="text-gray-700 dark:text-gray-300">{message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void sendTest()} className="!px-3 !py-1.5 text-xs">
                  Enviar prueba
                </Button>
                <Button variant="secondary" onClick={() => void sendTest(20)} className="!px-3 !py-1.5 text-xs">
                  Prueba en 20 s
                </Button>
                <Button variant="ghost" onClick={() => void deactivate()} className="!px-3 !py-1.5 text-xs">
                  Desactivar
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
