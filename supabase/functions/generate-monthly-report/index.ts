import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

function aggregateByDay(
  snapshots: { created_at: string; review_count: number; rating: number }[],
  baseline: number,
) {
  const byDay = new Map<string, { reviewCount: number; rating: number }>()
  for (const s of snapshots) {
    byDay.set(s.created_at.slice(0, 10), { reviewCount: s.review_count, rating: s.rating })
  }
  let prevTotal = baseline
  const rows: { day: string; gained: number; total: number; rating: number }[] = []
  for (const [day, { reviewCount, rating }] of byDay) {
    rows.push({ day, gained: reviewCount - prevTotal, total: reviewCount, rating })
    prevTotal = reviewCount
  }
  return rows
}

function formatDayEs(day: string) {
  const [y, m, d] = day.split('-')
  return `${d}/${m}/${y}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Runs on the 1st of the month — reports on the month that just ended.
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const label = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`

    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, name, initial_reviews')
      .is('deleted_at', null)
    if (error) throw new Error(error.message)

    let generated = 0
    const errors: string[] = []

    for (const business of businesses ?? []) {
      try {
        const { data: baselineSnap } = await supabase
          .from('review_snapshots')
          .select('review_count')
          .eq('business_id', business.id)
          .lt('created_at', monthStart.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        const baseline = baselineSnap?.review_count ?? business.initial_reviews

        const { data: snapshots, error: snapError } = await supabase
          .from('review_snapshots')
          .select('created_at, review_count, rating')
          .eq('business_id', business.id)
          .gte('created_at', monthStart.toISOString())
          .lt('created_at', monthEnd.toISOString())
          .order('created_at', { ascending: true })
        if (snapError) throw new Error(snapError.message)
        if (!snapshots || snapshots.length === 0) continue

        const header = 'Fecha,Reseñas del día,Total de reseñas,Rating\n'
        const rows = aggregateByDay(snapshots, baseline)
          .map((r) => `${formatDayEs(r.day)},${r.gained >= 0 ? '+' : ''}${r.gained},${r.total},${r.rating}`)
          .join('\n')

        const { error: uploadError } = await supabase.storage
          .from('monthly-reports')
          .upload(`${business.id}/${label}.csv`, new Blob([header + rows], { type: 'text/csv' }), {
            upsert: true,
          })
        if (uploadError) throw new Error(uploadError.message)

        generated++
      } catch (err) {
        errors.push(`${business.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return new Response(
      JSON.stringify({ month: label, checked: businesses?.length ?? 0, generated, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
