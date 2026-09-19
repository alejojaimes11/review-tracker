import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Card } from '../components/ui'

const INPUT =
  'mt-1 block w-full rounded-lg border border-black/10 bg-white/80 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError('Correo o contraseña incorrectos.')
    else navigate('/')
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <Card className="p-5">
        <h1 className="text-lg font-semibold">Acceso de administrador</h1>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block text-sm">
            Correo
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} autoComplete="username" />
          </label>
          <label className="block text-sm">
            Contraseña
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT} autoComplete="current-password" />
          </label>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <Link to="/" className="mt-4 block text-center text-sm text-gray-500 dark:text-gray-400">
          Volver
        </Link>
      </Card>
    </div>
  )
}
