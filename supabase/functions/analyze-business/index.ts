import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// MarketPulse block 2: on-demand AI read of a business's recent reviews,
// now returning prioritized concrete actions (not one generic sentence) and
// saving every analysis so the dashboard can show history.

type Priority = 'alta' | 'media' | 'baja'

interface Action {
  accion: string
  motivo: string
  prioridad: Priority
  respaldo: number
  cita: string
}

interface Parsed {
  bien: string
  mejorar: string
  acciones: Action[]
}

const PRIORITY_ORDER: Record<Priority, number> = { alta: 0, media: 1, baja: 2 }
const MAX_ACTIONS = 3

/** Lowercase, accent-less, punctuation-less form — used only to check a quote really came from a review. */
function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Turns the model's raw text into a validated analysis, or null when it isn't
 * usable (so the caller can retry / fall back to another provider instead of
 * showing a broken result). Quotes are only kept when they genuinely appear in
 * one of the reviews we sent — otherwise they're dropped rather than trusted.
 */
function parseAnalysis(raw: string, reviewTexts: string[]): Parsed | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }

  if (typeof data.bien !== 'string' || typeof data.mejorar !== 'string' || !Array.isArray(data.acciones)) {
    return null
  }

  const normalizedReviews = reviewTexts.map(normalize)
  const total = reviewTexts.length

  const acciones: Action[] = data.acciones
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .filter((a) => typeof a.accion === 'string' && a.accion.trim().length > 0)
    .map((a) => {
      const p = typeof a.prioridad === 'string' ? a.prioridad.toLowerCase().trim() : ''
      const prioridad: Priority = p === 'alta' || p === 'media' || p === 'baja' ? p : 'media'
      const respaldoRaw = typeof a.respaldo === 'number' ? Math.round(a.respaldo) : 1
      const cita = typeof a.cita === 'string' ? a.cita.trim().replace(/^["“”']+|["“”']+$/g, '') : ''
      const citaNorm = normalize(cita)
      const grounded = citaNorm.length >= 8 && normalizedReviews.some((r) => r.includes(citaNorm))
      return {
        accion: String(a.accion).trim(),
        motivo: typeof a.motivo === 'string' ? a.motivo.trim() : '',
        prioridad,
        respaldo: Math.min(Math.max(respaldoRaw, 1), total),
        cita: grounded ? cita.slice(0, 200) : '',
      }
    })
    .sort((a, b) => PRIORITY_ORDER[a.prioridad] - PRIORITY_ORDER[b.prioridad])
    .slice(0, MAX_ACTIONS)

  return { bien: data.bien.trim(), mejorar: data.mejorar.trim(), acciones }
}

async function callGemini(prompt: string, key: string): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // gemini-3.6-flash spends part of maxOutputTokens on internal
        // "thinking" before it writes the actual answer — thinkingLevel
        // "low" keeps that minimal and 2048 leaves room for the JSON itself
        // (confirmed against the live API: smaller limits cut it mid-JSON).
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } },
      }),
    },
  )
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

async function callOpenRouter(prompt: string, key: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      // Free-tier model — no cost, only used when Gemini is unavailable.
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

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
    const openRouterKey = Deno.env.get('OPENROUTER_API_KEY')
    if (!geminiKey && !openRouterKey) {
      throw new Error('No hay ninguna clave de IA configurada (GEMINI_API_KEY u OPENROUTER_API_KEY).')
    }

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

    const reviewTexts = withText.map((r) => r.text)
    const reviewsBlock = withText.map((r) => `- (${r.rating ?? '?'}★) ${r.text}`).join('\n')

    const prompt = `Sos un asistente que ayuda a dueños de negocios locales a entender sus reseñas de Google Maps y a decidir qué hacer.

Negocio: ${business.name}

Reseñas recientes (${withText.length}, más nuevas primero):
${reviewsBlock}

Basándote ÚNICAMENTE en estas reseñas — no inventes nada que no esté respaldado por ellas — respondé con un JSON con exactamente esta forma, en español:

{
  "bien": "una o dos frases: qué hace bien el negocio",
  "mejorar": "una o dos frases: qué debería mejorar",
  "acciones": [
    { "accion": "...", "motivo": "...", "prioridad": "alta", "respaldo": 3, "cita": "..." }
  ]
}

Reglas para "acciones":
- Máximo ${MAX_ACTIONS}, ordenadas de más a menos prioritaria.
- "accion": una acción concreta que el dueño pueda hacer esta semana, en una sola frase que empiece con un verbo (ej. "Poner un cartel con el horario en la puerta").
- "motivo": una frase corta que explique por qué, basada en lo que dicen las reseñas.
- "prioridad": "alta" si 3 o más reseñas lo mencionan o si baja claramente la calificación; "media" si lo mencionan 2; "baja" si lo menciona solo 1.
- "respaldo": cuántas de las reseñas de la lista mencionan ese tema (un número entero entre 1 y ${withText.length}).
- "cita": un fragmento corto (máximo 15 palabras) copiado LITERALMENTE de una reseña que respalde la acción.
- Si las reseñas son todas positivas y no señalan ningún problema concreto, devolvé "acciones": [] y en "mejorar" decilo claramente. No inventes problemas para llenar la lista.

Respondé SOLO el JSON, sin texto adicional antes ni después.`

    // Providers in order of preference. A provider is skipped on to the next
    // when it errors (e.g. Gemini's free tier answering 503 "overloaded" at
    // peak times) or when its answer isn't valid JSON of the expected shape.
    const providers: { name: string; run: () => Promise<string> }[] = []
    if (geminiKey) providers.push({ name: 'gemini-3.6-flash', run: () => callGemini(prompt, geminiKey) })
    if (openRouterKey) {
      providers.push({ name: 'llama-3.3-70b (openrouter)', run: () => callOpenRouter(prompt, openRouterKey) })
    }

    const failures: string[] = []
    let analysis: Parsed | null = null
    let usedProvider = ''

    for (const provider of providers) {
      // A malformed answer is worth one quick retry on the same provider;
      // an HTTP error is not (we move straight on to the next provider).
      for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
        try {
          const text = await provider.run()
          analysis = parseAnalysis(text, reviewTexts)
          if (analysis) usedProvider = provider.name
          else if (attempt === 1) failures.push(`${provider.name}: respuesta con formato inválido`)
        } catch (err) {
          failures.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`)
          break
        }
      }
      if (analysis) break
    }

    if (!analysis) {
      throw new Error(`No se pudo generar el análisis. ${failures.join(' | ')}`)
    }

    const row = {
      business_id,
      review_count: withText.length,
      provider: usedProvider,
      bien: analysis.bien,
      mejorar: analysis.mejorar,
      acciones: analysis.acciones,
    }

    // Saving is best-effort: if it fails the user still gets their analysis,
    // it just won't appear in the history next time.
    const { data: saved } = await supabase.from('analyses').insert(row).select('id, created_at').single()

    return new Response(
      JSON.stringify({
        id: saved?.id ?? '',
        created_at: saved?.created_at ?? new Date().toISOString(),
        review_count: row.review_count,
        provider: row.provider,
        bien: row.bien,
        mejorar: row.mejorar,
        acciones: row.acciones,
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
