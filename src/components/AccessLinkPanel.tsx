import { useState } from 'react'
import {
  useAccessLinks,
  useCreateAccessLink,
  useRegenerateAccessLink,
  useRevokeAccessLink,
  type AccessLink,
} from '../api/clientLinks'
import { Button, Card } from './ui'

const STATUS_LABEL: Record<AccessLink['status'], string> = { active: 'Activo', revoked: 'Revocado', expired: 'Vencido' }

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })

/** Admin: private links for a business owner. The full link is shown once, right after it is created. */
export function AccessLinkPanel({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  // The only place a token ever exists in the UI; gone as soon as it is dismissed.
  const [fresh, setFresh] = useState<{ url: string; label: string | null } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const links = useAccessLinks(businessId, open)
  const create = useCreateAccessLink(businessId)
  const regenerate = useRegenerateAccessLink(businessId)
  const revoke = useRevokeAccessLink(businessId)

  const busy = create.isPending || regenerate.isPending || revoke.isPending

  function show(result: { link: AccessLink; token: string }) {
    setFresh({ url: `${window.location.origin}/c/${result.token}`, label: result.link.label })
    setCopied(false)
    setError(null)
  }

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo completar la acción.')

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    create.mutate(label, {
      onSuccess: (result) => {
        show(result)
        setLabel('')
      },
      onError: fail,
    })
  }

  function handleRegenerate(link: AccessLink) {
    if (!window.confirm('Se creará un enlace nuevo y el actual dejará de funcionar (sus dispositivos dejarán de recibir avisos). ¿Continuar?')) return
    regenerate.mutate(link.id, { onSuccess: show, onError: fail })
  }

  function handleRevoke(link: AccessLink) {
    if (!window.confirm('El enlace dejará de funcionar y sus dispositivos dejarán de recibir avisos. ¿Revocar?')) return
    revoke.mutate(link.id, { onError: fail })
  }

  async function copy() {
    if (!fresh) return
    try {
      await navigator.clipboard.writeText(fresh.url)
      setCopied(true)
    } catch {
      setError('No se pudo copiar automáticamente: seleccioná el enlace y copialo a mano.')
    }
  }

  return (
    <div className="mt-4">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        Enlace del cliente
      </Button>

      {open && (
        <Card className="mt-3 space-y-4 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Enlace privado para que {businessName} vea su negocio y active avisos, sin crear cuenta. Vale hasta que lo revoques.
          </p>

          {fresh && (
            <div className="space-y-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                Enlace nuevo{fresh.label ? ` (${fresh.label})` : ''} — copialo ahora, no se vuelve a mostrar.
              </p>
              <input
                readOnly
                value={fresh.url}
                onFocus={(e) => e.currentTarget.select()}
                className="block w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-white/10 dark:bg-[#14141c] dark:text-zinc-100"
              />
              <div className="flex gap-2">
                <Button onClick={() => void copy()}>{copied ? 'Copiado ✓' : 'Copiar enlace'}</Button>
                <Button variant="ghost" onClick={() => setFresh(null)}>
                  Ya lo copié
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-300">
              Etiqueta (opcional)
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="ej. dueño, gerente"
                className="mt-1 block rounded-lg border border-black/10 bg-white/80 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100"
              />
            </label>
            <Button type="submit" disabled={busy}>
              {create.isPending ? 'Creando…' : 'Crear enlace'}
            </Button>
          </form>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {links.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}
          {links.error && <p className="text-sm text-red-500">No se pudieron cargar los enlaces.</p>}

          {links.data && links.data.length === 0 && <p className="text-sm text-gray-500">Todavía no hay enlaces para este negocio.</p>}

          {links.data && links.data.length > 0 && (
            <ul className="space-y-2">
              {links.data.map((link) => (
                <li key={link.id} className="rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-zinc-800 dark:text-zinc-100">
                      {link.label ?? 'Sin etiqueta'} <span className="text-xs text-gray-500">· {link.token_prefix}…</span>
                    </span>
                    <span className={link.status === 'active' ? 'text-emerald-500' : 'text-gray-500'}>{STATUS_LABEL[link.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Creado {formatDate(link.created_at)}
                    {link.last_used_at ? ` · último uso ${formatDate(link.last_used_at)}` : ' · sin usar'}
                    {link.status === 'active' ? ` · ${link.devices} ${link.devices === 1 ? 'dispositivo' : 'dispositivos'}` : ''}
                  </p>
                  {link.status === 'active' && (
                    <div className="mt-2 flex gap-2">
                      <Button variant="secondary" onClick={() => handleRegenerate(link)} disabled={busy} className="!px-2.5 !py-1 text-xs">
                        Regenerar
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleRevoke(link)}
                        disabled={busy}
                        className="!px-2.5 !py-1 text-xs !text-red-600 dark:!text-red-400"
                      >
                        Revocar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
