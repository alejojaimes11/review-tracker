import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button, Card } from './ui'

/**
 * Surfaces a "new version available" banner instead of relying on the
 * default silent auto-reload — a tab left open could sit on stale content
 * for a while before that kicked in, with no visible sign anything had
 * changed. Tapping "Actualizar" activates the waiting service worker and
 * reloads immediately.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // The browser only checks for a new service worker on navigation by
      // default — for a tab left open for hours (this is a dashboard people
      // keep pinned) that's not often enough, so poll for updates too.
      setInterval(() => registration.update(), 60 * 60 * 1000)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <Card className="flex items-center gap-3 p-3 shadow-lg">
        <span className="text-sm text-gray-700 dark:text-gray-300">Hay una versión nueva disponible</span>
        <Button onClick={() => updateServiceWorker(true)} className="!px-3 !py-1.5 text-xs">
          Actualizar
        </Button>
        <Button variant="ghost" onClick={() => setNeedRefresh(false)} className="!px-2 !py-1 text-xs">
          Ahora no
        </Button>
      </Card>
    </div>
  )
}
