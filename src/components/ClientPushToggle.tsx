import { useEffect, useState } from 'react'
import { callClientApi, ClientApiError } from '../api/client'
import { getRegistration, isIos, isPushSupported, isStandalone, urlBase64ToBytes, VAPID_PUBLIC_KEY } from '../lib/push'
import { Button, Card } from './ui'

type State = 'checking' | 'unsupported' | 'denied' | 'off' | 'on'

/** Push notifications for a business owner, authorised by their private link token. */
export function ClientPushToggle({ token }: { token: string }) {
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!isPushSupported() || !VAPID_PUBLIC_KEY) return setState('unsupported')
      if (Notification.permission === 'denied') return setState('denied')
      const registration = await getRegistration()
      const existing = registration ? await registration.pushManager.getSubscription() : null
      if (!cancelled) setState(existing && Notification.permission === 'granted' ? 'on' : 'off')
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  const errorText = (err: unknown) => (err instanceof ClientApiError ? err.message : 'No se pudo completar la acción.')

  async function activate() {
    setBusy(true)
    setMessage(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const registration = await getRegistration()
      if (!registration) throw new Error('El navegador no tiene el servicio de la app activo todavía. Recargá la página.')

      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY!),
        }))

      try {
        await callClientApi('subscribe', token, { subscription: subscription.toJSON() })
      } catch (err) {
        // Don't leave a local subscription the server doesn't know about.
        if (!existing) await subscription.unsubscribe().catch(() => {})
        throw err
      }
      setState('on')
      setMessage('Listo: este dispositivo recibirá los avisos.')
    } catch (err) {
      setMessage(err instanceof Error && !(err instanceof ClientApiError) ? err.message : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function deactivate() {
    setBusy(true)
    setMessage(null)
    try {
      const registration = await getRegistration()
      const subscription = registration ? await registration.pushManager.getSubscription() : null
      if (subscription) {
        await callClientApi('unsubscribe', token, { endpoint: subscription.endpoint })
        await subscription.unsubscribe()
      }
      setState('off')
      setMessage('Notificaciones desactivadas en este dispositivo.')
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function sendTest(delaySeconds: number) {
    setBusy(true)
    setMessage(null)
    try {
      const result = await callClientApi<{ sent?: number; failed?: number; scheduled?: boolean }>('send_test', token, {
        delay_seconds: delaySeconds,
      })
      if (result.scheduled) setMessage(`Enviaremos la prueba en ${delaySeconds} segundos. Ya podés cerrar la app.`)
      else if ((result.sent ?? 0) > 0) setMessage('Prueba enviada. Debería aparecer en unos segundos.')
      else setMessage('El servicio de notificaciones no aceptó la prueba. Probá activar de nuevo.')
    } catch (err) {
      setMessage(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (state === 'checking') return null

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Avisos en este dispositivo</h2>

      {state === 'unsupported' && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {isIos() && !isStandalone()
            ? 'En iPhone los avisos solo funcionan con la app instalada: en Safari tocá Compartir → "Añadir a pantalla de inicio" y abrí la app desde su ícono.'
            : 'Este navegador no permite recibir notificaciones.'}
        </p>
      )}

      {state === 'denied' && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Las notificaciones están bloqueadas para este sitio. Habilitalas en la configuración del navegador o de la app y volvé a
          entrar.
        </p>
      )}

      {state === 'off' && (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">Activá los avisos para recibirlos en este dispositivo.</p>
          <Button onClick={() => void activate()} disabled={busy}>
            {busy ? 'Activando…' : '🔔 Activar avisos'}
          </Button>
        </div>
      )}

      {state === 'on' && (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">✅ Los avisos están activados en este dispositivo.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void sendTest(0)} disabled={busy}>
              Enviar prueba
            </Button>
            <Button variant="secondary" onClick={() => void sendTest(20)} disabled={busy}>
              Prueba en 20 s
            </Button>
            <Button variant="ghost" onClick={() => void deactivate()} disabled={busy}>
              Desactivar
            </Button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">{message}</p>}
    </Card>
  )
}
