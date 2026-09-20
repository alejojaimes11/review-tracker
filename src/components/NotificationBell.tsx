import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMarkRead, useNotifications } from '../api/notifications'
import { Button, Card } from './ui'

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

/** Admin-only notification center: unread count, latest notifications, tap to read and open. */
export function NotificationBell() {
  const { data: notifications } = useNotifications(true)
  const markRead = useMarkRead()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const list = notifications ?? []
  const unread = list.filter((n) => n.read_at === null)

  function openNotification(n: (typeof list)[number]) {
    if (n.read_at === null) markRead.mutate([n.id])
    setOpen(false)
    navigate(n.data.url ?? '/')
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread.length > 0 ? `Notificaciones, ${unread.length} sin leer` : 'Notificaciones'}
        className="!px-2.5 text-xs"
      >
        🔔
        {unread.length > 0 && (
          <span className="ml-1 rounded-full bg-violet-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </Button>

      {open && (
        <Card className="absolute right-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] !bg-white p-2 shadow-lg dark:!bg-[#14141c]">
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Notificaciones</span>
            {unread.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => markRead.mutate(unread.map((n) => n.id))}
                className="!px-2 !py-1 text-xs"
              >
                Marcar todas como leídas
              </Button>
            )}
          </div>

          {list.length === 0 ? (
            <p className="px-2 pb-3 text-sm text-gray-500 dark:text-gray-400">
              Todavía no hay notificaciones. Aparecerán cuando un negocio reciba reseñas.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-black/5 overflow-y-auto dark:divide-white/10">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at === null ? 'bg-violet-500' : 'bg-transparent'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read_at === null ? 'font-semibold' : 'font-medium'} text-gray-900 dark:text-gray-100`}>
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 block whitespace-pre-line text-xs text-gray-600 dark:text-gray-400">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] text-gray-400 dark:text-gray-500">
                        {timeAgo(n.created_at)} · {n.read_at === null ? 'Sin leer' : 'Leída'}
                      </span>
                    </span>
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
