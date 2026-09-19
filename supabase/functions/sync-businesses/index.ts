import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { getReviewStats } from '../_shared/apify.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiToken = Deno.env.get('APIFY_API_TOKEN')
    if (!apiToken) throw new Error('APIFY_API_TOKEN no está configurada.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, maps_url, update_frequency_hours, last_synced_at, current_reviews')
      .eq('status', 'active')
      .is('deleted_at', null)

    if (error) throw new Error(error.message)

    const now = Date.now()
    const due = (businesses ?? []).filter((b) => {
      if (!b.last_synced_at) return true
      const elapsedHours = (now - new Date(b.last_synced_at).getTime()) / 3_600_000
      return elapsedHours >= b.update_frequency_hours
    })

    // Limited concurrency: Apify's free plan caps total concurrent Actor
    // memory at 16GB and each run defaults to ~4GB, so 3 at a time stays
    // safely under that ceiling while being much faster than fully
    // sequential (which was taking ~13s/business and risked hitting the
    // Edge Function's own execution timeout as the business count grew).
    const BATCH_SIZE = 3
    let synced = 0
    const errors: string[] = []

    for (let i = 0; i < due.length; i += BATCH_SIZE) {
      const batch = due.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (business) => {
          try {
            const stats = await getReviewStats(business.maps_url, apiToken)
            const grew = stats.reviewCount > business.current_reviews

            const { error: updateError } = await supabase
              .from('businesses')
              .update({
                current_reviews: stats.reviewCount,
                current_rating: stats.rating,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                last_sync_error: null,
                ...(grew ? { last_growth_at: new Date().toISOString() } : {}),
              })
              .eq('id', business.id)
            if (updateError) throw new Error(updateError.message)

            const { error: snapshotError } = await supabase.from('review_snapshots').insert({
              business_id: business.id,
              review_count: stats.reviewCount,
              rating: stats.rating,
            })
            if (snapshotError) throw new Error(snapshotError.message)

            // MarketPulse block 1: best-effort save of individual review
            // text. Deliberately isolated from the block above — the
            // rating/count sync has worked reliably for weeks and must
            // keep working even if this new, unproven part fails. A
            // problem here never surfaces as last_sync_error on the
            // business (that badge means "we can't read this business at
            // all", which isn't true just because review-saving hiccuped).
            if (stats.reviews.length > 0) {
              try {
                const rows = stats.reviews.map((r) => ({
                  business_id: business.id,
                  review_id: r.reviewId,
                  rating: r.stars,
                  text: r.text,
                  published_at: r.publishedAtDate,
                }))
                // With ignoreDuplicates, .select() returns only the rows that
                // were actually inserted — i.e. reviews we hadn't seen before.
                const { data: inserted } = await supabase
                  .from('reviews')
                  .upsert(rows, { onConflict: 'review_id', ignoreDuplicates: true })
                  .select('rating, published_at')

                // Negative-review alert: a brand-new 1-2 star review that was
                // also published recently (so an old review that merely
                // slid into the latest-20 window doesn't trigger it).
                const recentCutoff = Date.now() - 14 * 86_400_000
                const hasNewNegative = (inserted ?? []).some(
                  (r) =>
                    r.rating !== null &&
                    r.rating <= 2 &&
                    (!r.published_at || new Date(r.published_at).getTime() >= recentCutoff),
                )
                if (hasNewNegative) {
                  await supabase
                    .from('businesses')
                    .update({ last_negative_review_at: new Date().toISOString() })
                    .eq('id', business.id)
                }
              } catch {
                // swallow — see comment above
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // Record the failure on the business itself (dashboard surfaces
            // this as a badge) — a business we can't scrape stays silently
            // stale otherwise, which is what sent the user looking for bugs.
            await supabase
              .from('businesses')
              .update({ last_sync_error: message, updated_at: new Date().toISOString() })
              .eq('id', business.id)
            throw err
          }
        }),
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          synced++
        } else {
          errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }
    }

    return new Response(JSON.stringify({ checked: businesses?.length ?? 0, synced, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
