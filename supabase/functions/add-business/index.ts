import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { scrapePlace } from '../_shared/apify.ts'
import { rehostPhoto } from '../_shared/rehost-photo.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { input } = await req.json()
    if (!input || typeof input !== 'string') {
      throw new Error('Falta el campo "input" (URL de Google Maps o nombre del negocio).')
    }

    const apiToken = Deno.env.get('APIFY_API_TOKEN')
    if (!apiToken) throw new Error('APIFY_API_TOKEN no está configurada.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const place = await scrapePlace(input, apiToken)

    const { data: business, error: insertError } = await supabase
      .from('businesses')
      .insert({
        maps_url: place.mapsUrl,
        name: place.name,
        photo_url: place.photoUrl,
        initial_reviews: place.reviewCount,
        current_reviews: place.reviewCount,
        initial_rating: place.rating,
        current_rating: place.rating,
        last_synced_at: new Date().toISOString(),
        last_growth_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        throw new Error('Este negocio ya está siendo trackeado.')
      }
      throw new Error(insertError.message)
    }

    await supabase.from('review_snapshots').insert({
      business_id: business.id,
      review_count: place.reviewCount,
      rating: place.rating,
    })

    // Best-effort: swap the hotlinked Google photo for one hosted on our own
    // Storage — Google's CDN latency is inconsistent enough (seen 15s+
    // loads) that it made the whole app feel like it hung on open. Business
    // creation already succeeded above regardless of how this goes.
    if (place.photoUrl) {
      const hostedUrl = await rehostPhoto(supabase, business.id, place.photoUrl)
      if (hostedUrl) {
        await supabase.from('businesses').update({ photo_url: hostedUrl }).eq('id', business.id)
        business.photo_url = hostedUrl
      }
    }

    return new Response(JSON.stringify(business), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 201,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
