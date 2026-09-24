import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  callClientApi,
  ClientApiError,
  clearStoredToken,
  extractToken,
  readStoredToken,
  storeToken,
  type ClientViewResult,
} from '../api/client'
import { ClientPushToggle } from '../components/ClientPushToggle'
import { Button, Card, Delta, Skeleton, Sparkline, StarRating } from '../components/ui'

/** Keeps this page out of search engines and stops the URL (which holds the token) leaking through Referer. */
function usePrivatePage() {
  useEffect(() => {
    const tags = [
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'referrer', content: 'no-referrer' },
    ].map(({ name, content }) => {
      const el = document.createElement('meta')
      el.name = name
      el.content = content
      document.head.appendChild(el)
      return el
    })
    return () => tags.forEach((el) => el.remove())
  }, [])
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <p className="text-sm font-semibold tracking-wide text-zinc-800 dark:text-zinc-100">
        Market<span className="text-violet-500">Pulse</span>
      </p>
      {children}
    </div>
  )
}

/** /c without a token: reopen the stored link, or ask for it (the installed iOS app starts with empty storage). */
function LinkPrompt({ notice }: { notice?: string }) {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const token = extractToken(value)
    if (!token) return setError('Ese enlace no parece válido. Copiá el enlace completo que te enviaron.')
    navigate(`/c/${token}`, { replace: true })
  }

  return (
    <Shell>
      <Card className="p-4">
        <h1 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">Abrí tu enlace</h1>
        {notice && <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">{notice}</p>}
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Pegá acá el enlace privado que te enviaron para ver tu negocio y activar los avisos.
        </p>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder="https://…/c/…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="block w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" disabled={!value.trim()}>
            Abrir
          </Button>
        </form>
      </Card>
    </Shell>
  )
}

function BusinessView({ token }: { token: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['client-view', token],
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: () => callClientApi<ClientViewResult>('view', token),
  })

  useEffect(() => {
    if (data?.available) storeToken(token)
  }, [data, token])

  useEffect(() => {
    if (error instanceof ClientApiError && error.status === 403) clearStoredToken()
  }, [error])

  if (isLoading) {
    return (
      <Shell>
        <Skeleton className="h-40 w-full" />
      </Shell>
    )
  }

  if (error instanceof ClientApiError && error.status === 403) return <LinkPrompt notice={error.message} />

  if (error || !data) {
    return (
      <Shell>
        <Card className="p-4 text-sm text-gray-600 dark:text-gray-300">
          No se pudo cargar tu negocio. Revisá tu conexión e intentá de nuevo.
        </Card>
      </Shell>
    )
  }

  if (!data.available) {
    return (
      <Shell>
        <Card className="p-4 text-sm text-gray-600 dark:text-gray-300">Este negocio no está disponible en este momento.</Card>
      </Shell>
    )
  }

  const b = data.business
  return (
    <Shell>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          {b.photo_url ? (
            <img src={b.photo_url} alt="" className="h-14 w-14 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="h-14 w-14 rounded-full bg-black/5 dark:bg-white/5" />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">{b.name}</h1>
            {b.category && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{b.category}</p>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              <Delta value={b.gained} />
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">reseñas ganadas</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              <Delta value={b.gained_this_month} />
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">este mes</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
              <StarRating value={b.current_rating} />
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{b.current_reviews} reseñas en total</p>
          </div>
        </div>

        <div className="mt-4">
          <Sparkline values={b.series} />
        </div>
      </Card>

      <ClientPushToggle token={token} />
    </Shell>
  )
}

export default function ClientView() {
  usePrivatePage()
  const { token } = useParams()
  const navigate = useNavigate()
  const stored = token ? null : readStoredToken()

  useEffect(() => {
    if (!token && stored) navigate(`/c/${stored}`, { replace: true })
  }, [token, stored, navigate])

  if (token) return <BusinessView token={token} />
  if (stored) return null
  return <LinkPrompt />
}
