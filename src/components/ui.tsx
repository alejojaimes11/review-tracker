import { useEffect, useId, type ReactNode } from 'react'

// Semantic status colors — shared across badges, deltas, and any future indicator.
// Bumped brighter than a flat light-mode palette so they still pop against
// the dark, near-black surfaces the app defaults to now.
export const GOOD_COLOR = '#34d399'
export const WARNING_COLOR = '#fbbf24'
export const CRITICAL_COLOR = '#f87171'
export const ACCENT_COLOR = '#8b5cf6'

// Shared focus-visible treatment for plain `<button>`/`<a>` elements that
// don't go through the Button component (pills, inline links) — keeps
// keyboard focus consistent instead of falling back to each browser's
// mismatched default outline against the dark theme.
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fafafa] dark:focus-visible:ring-offset-[#08080d]'

const ICONS = {
  star: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 0 0 .95.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 0 0-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 0 0-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 0 0-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 0 0 .951-.69z',
  warning: 'M12 2 1 21h22L12 2zm0 6 6.5 11h-13L12 8zm-.9 3v4h1.8v-4h-1.8zm0 5v1.6h1.8V16h-1.8z',
  trophy: 'M12 2l2.9 6.26L21 9.27l-4.5 4.39L17.8 21 12 17.77 6.2 21l1.3-7.34L3 9.27l6.1-1.01L12 2z',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V6zm0 3h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z',
  gear: 'M11.078 2.25c.542-1 1.998-1 2.54 0l.478.883c.32.593.99.91 1.657.79l.98-.176c1.117-.2 2.061.766 1.86 1.882l-.176.98a1.51 1.51 0 0 0 .79 1.658l.883.478c1 .542 1 1.998 0 2.54l-.883.478a1.51 1.51 0 0 0-.79 1.657l.176.98c.2 1.117-.744 2.081-1.86 1.882l-.98-.176a1.51 1.51 0 0 0-1.658.79l-.478.883c-.542 1-1.998 1-2.54 0l-.478-.883a1.51 1.51 0 0 0-1.657-.79l-.98.176c-1.117.2-2.061-.766-1.86-1.882l.176-.98a1.51 1.51 0 0 0-.79-1.658l-.883-.478c-1-.542-1-1.998 0-2.54l.883-.478a1.51 1.51 0 0 0 .79-1.657l-.176-.98c-.2-1.117.744-2.081 1.86-1.882l.98.176a1.51 1.51 0 0 0 1.657-.79l.478-.883zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  chevronDown: 'M6 9l6 6 6-6',
  arrowLeft: 'M15 18l-6-6 6-6',
  history: 'M12 6v6l4 2M21 12a9 9 0 1 1-3-6.7M21 3v5.5H15.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6',
  whatsapp:
    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  // Category glyphs — purely decorative/scannable, keep them simple line icons.
  utensils: 'M6 3v6a2 2 0 0 0 4 0V3M8 9v12M15 3c-1.7 0-3 1.5-3 3.3V11a2 2 0 0 0 2 2h1M15 3v18',
  cupcake: 'M6 9h12l-1.3 9.2A2 2 0 0 1 14.7 20H9.3a2 2 0 0 1-2-1.8L6 9zM8 9a4 4 0 0 1 8 0M12 3v3',
  leaf: 'M12 3c4 0 7 3 7 8 0 5-3 9-7 10-4-1-7-5-7-10 0-5 3-8 7-8zM12 5v14',
  bag: 'M6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM9 8V6a3 3 0 0 1 6 0v2',
  cap: 'M12 4 3 9l9 4 8-3.7V15h2V9zM7 12.5V17c0 1.4 2.5 3 5 3s5-1.6 5-3v-4.5',
  tag: 'M4 4h7l9 9-7 7-9-9zM8 8h.01',
  check: 'M5 13l4 4L19 7',
  sparkle: 'M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5L12 2zM19 14l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z',
} as const

export function Icon({
  path,
  className = 'h-4 w-4',
  filled = true,
}: {
  path: keyof typeof ICONS
  className?: string
  filled?: boolean
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={ICONS[path]} />
    </svg>
  )
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fafafa] dark:focus-visible:ring-offset-[#08080d]'
  const variants = {
    primary:
      'bg-violet-600 text-white shadow-[0_0_16px_-2px_rgba(139,92,246,0.55)] hover:bg-violet-500 hover:shadow-[0_0_20px_-2px_rgba(139,92,246,0.75)] dark:bg-violet-500 dark:hover:bg-violet-400',
    secondary:
      'border border-black/10 bg-white/80 text-zinc-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:bg-white/10',
    ghost:
      'text-zinc-500 hover:bg-black/5 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

// No backdrop-blur here on purpose — it looked the part, but a blur-xl
// recomputing behind 10-20 of these on the dashboard grid at once was the
// actual cause of the app feeling laggy (each one forces its own GPU
// compositing layer). Plain translucency reads close enough to "glass"
// without the per-frame cost.
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border border-black/5 bg-white/80 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:shadow-none ${className}`}
    >
      {children}
    </div>
  )
}

export function Badge({ color, icon = 'warning', children }: { color: string; icon?: keyof typeof ICONS; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `${color}22`, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <Icon path={icon} className="h-3 w-3" />
      {children}
    </span>
  )
}

export function Delta({ value }: { value: number }) {
  const color = value > 0 ? GOOD_COLOR : value < 0 ? CRITICAL_COLOR : undefined
  return (
    <span
      className="inline-flex items-center gap-1 tabular-nums"
      style={color ? { color } : undefined}
    >
      {value !== 0 && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`h-[0.7em] w-[0.7em] ${value < 0 ? 'rotate-180' : ''}`}
        >
          <path d="M12 4l8 12H4z" />
        </svg>
      )}
      {value > 0 ? '+' : ''}
      {value}
    </span>
  )
}

export function StarRating({ value }: { value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon path="star" className="h-3.5 w-3.5 text-amber-400 dark:text-amber-300" />
      {value ?? '—'}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/5 ${className}`} />
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: value >= max ? GOOD_COLOR : ACCENT_COLOR }}
      />
    </div>
  )
}

/** Tiny inline trend line — day-by-day activity at a glance, no axes or labels. */
export function Sparkline({ values }: { values: number[] }) {
  const gradientId = useId()
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 100
  const h = 24
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }))
  const points = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `M ${points.replaceAll(' ', ' L ')} L ${w} ${h} L 0 ${h} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-full text-violet-500 dark:text-violet-400" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Brief confirmation banner — self-dismisses after a few seconds. Parent owns the message's lifetime (render null to hide). */
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <Card className="flex items-center gap-2 border-emerald-500/30 px-4 py-2.5 shadow-lg dark:border-emerald-500/30">
        <Icon path="check" className="h-4 w-4 flex-shrink-0 text-emerald-500" filled={false} />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{message}</span>
      </Card>
    </div>
  )
}
