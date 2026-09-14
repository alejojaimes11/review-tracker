import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// MarketPulse block 1: on-demand AI read of a business's recent reviews.
// Deliberately the simplest possible shape — no persistence, no batching,
// no automatic runs. Called once per click of "Analizar con IA".
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { business_id } = await req.json()
    if (!business_id || typeof business_id !== 'string') {
      throw new Error('Falta el campo "business_id".')
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) throw new Error('GEMINI_API_KEY no está configurada.')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('name')
      .eq('id', business_id)
      .single()
    if (businessError || !business) throw new Error('Negocio no encontrado.')

    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('rating, text, published_at')
      .eq('business_id', business_id)
      .order('published_at', { ascending: false })
      .limit(20)
    if (reviewsError) throw new Error(reviewsError.message)

    const withText = (reviews ?? []).filter(
      (r): r is { rating: number | null; text: string; published_at: string | null } =>
        typeof r.text === 'string' && r.text.trim().length > 0,
    )

    if (withText.length === 0) {
      throw new Error(
        'Todavía no hay reseñas con texto guardadas para este negocio. El sync las trae de a poco cada 6h — probá de nuevo más tarde.',
      )
    }

    const reviewsBlock = withText.map((r) => `- (${r.rating ?? '?'}★) ${r.text}`).join('\n')

    const prompt = `Sos un asistente que ayuda a dueños de negocios locales a entender sus reseñas de Google Maps.

Negocio: ${business.name}

Reseñas recientes (más nuevas primero):
${reviewsBlock}

Basándote ÚNICAMENTE en estas reseñas — no inventes nada que no esté respaldado por ellas — respondé con un JSON de exactamente estas 3 claves, en español, corto y claro (una o dos frases por valor):

{"bien": "...", "mejorar": "...", "recomendacion": "..."}

Respondé SOLO el JSON, sin texto adicional antes ni después.`

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400 },
        }),
      },
    )

    if (!aiRes.ok) {
      throw new Error(`Error del modelo de IA: ${aiRes.status} ${await aiRes.text()}`)
    }

    const aiData = await aiRes.json()
    const responseText: string = aiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    let parsed: { bien?: string; mejorar?: string; recomendacion?: string }
    try {
      const cleaned = responseText.trim().replace(/^```(?:json)?\n?/, '').replace(/```$/, '')
      parsed = JSON.parse(cleaned)
    } catch {
      // The model didn't return clean JSON — surface the raw text rather
      // than failing outright, so the click still produces something useful.
      parsed = { bien: responseText.trim(), mejorar: '', recomendacion: '' }
    }

    return new Response(
      JSON.stringify({
        bien: parsed.bien ?? '',
        mejorar: parsed.mejorar ?? '',
        recomendacion: parsed.recomendacion ?? '',
        reviewCount: withText.length,
      }),
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
