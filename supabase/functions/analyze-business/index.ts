import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// MarketPulse block 2: a complete, evidence-backed read of a business's
// recent reviews — summary, real numbers, strengths, opportunities, themes,
// a step-by-step action plan and ready-to-send replies — saved to `analyses`
// so the dashboard can show it (and its history) without calling the AI again.

type Priority = 'alta' | 'media' | 'baja'
type Horizon = 'esta semana' | 'este mes' | 'próximos 3 meses'

interface Strength {
  tema: string
  detalle: string
  respaldo: number
  cita: string
}

interface Opportunity {
  tema: string
  detalle: string
  gravedad: Priority
  respaldo: number
  cita: string
}

interface ThemeCount {
  nombre: string
  positivas: number
  negativas: number
}

interface Action {
  accion: string
  motivo: string
  prioridad: Priority
  plazo: Horizon
  impacto: string
  pasos: string[]
  respaldo: number
  cita: string
}

interface SuggestedReply {
  rating: number | null
  resena: string
  respuesta: string
}

interface Parsed {
  resumen: string
  fortalezas: Strength[]
  oportunidades: Opportunity[]
  temas: ThemeCount[]
  acciones: Action[]
  respuestas: SuggestedReply[]
}

interface Review {
  rating: number | null
  text: string
  published_at: string | null
}

const PRIORITY_ORDER: Record<Priority, number> = { alta: 0, media: 1, baja: 2 }
const MAX_REVIEWS = 40
const MAX_STRENGTHS = 5
const MAX_OPPORTUNITIES = 5
const MAX_THEMES = 8
const MAX_ACTIONS = 5
const MAX_REPLIES = 3

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

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

function toPriority(v: unknown): Priority {
  const p = str(v).toLowerCase()
  return p === 'alta' || p === 'media' || p === 'baja' ? p : 'media'
}

function toHorizon(v: unknown): Horizon {
  const h = normalize(str(v))
  if (h.includes('semana')) return 'esta semana'
  if (h.includes('3') || h.includes('tres') || h.includes('trimestre')) return 'próximos 3 meses'
  return 'este mes'
}

/** Real numbers computed from the data itself — never asked of the model. */
function computeStats(reviews: Review[]) {
  const ratings = reviews.map((r) => r.rating).filter((r): r is number => typeof r === 'number')
  const n = ratings.length
  const distribucion: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  for (const r of ratings) distribucion[String(Math.min(Math.max(Math.round(r), 1), 5))]++

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)

  // `reviews` is newest-first: compare the newer half with the older half.
  let tendencia: 'sube' | 'baja' | 'estable' | null = null
  let promedioRecientes: number | null = null
  let promedioAnteriores: number | null = null
  if (n >= 8) {
    const half = Math.floor(n / 2)
    promedioRecientes = round1(avg(ratings.slice(0, half)))
    promedioAnteriores = round1(avg(ratings.slice(half)))
    const diff = (avg(ratings.slice(0, half)) ?? 0) - (avg(ratings.slice(half)) ?? 0)
    tendencia = diff >= 0.3 ? 'sube' : diff <= -0.3 ? 'baja' : 'estable'
  }

  return {
    total: reviews.length,
    con_calificacion: n,
    promedio: round1(avg(ratings)),
    distribucion,
    positivas_pct: n ? Math.round((ratings.filter((r) => r >= 4).length / n) * 100) : 0,
    negativas_pct: n ? Math.round((ratings.filter((r) => r <= 2).length / n) * 100) : 0,
    tendencia,
    promedio_recientes: promedioRecientes,
    promedio_anteriores: promedioAnteriores,
  }
}

/**
 * Turns the model's raw text into a validated analysis, or null when it isn't
 * usable (so the caller can retry / fall back to another provider instead of
 * showing a broken result). Every quote is only kept when it genuinely appears
 * in one of the reviews we sent, and every count is clamped to what's possible
 * — the model is never trusted on its own.
 */
function parseAnalysis(raw: string, reviews: Review[]): Parsed | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }

  const resumen = str(data.resumen)
  if (!resumen || !Array.isArray(data.acciones)) return null

  const total = reviews.length
  const normalizedReviews = reviews.map((r) => normalize(r.text))

  const quote = (v: unknown) => {
    const cita = str(v).replace(/^["“”']+|["“”']+$/g, '')
    const norm = normalize(cita)
    const grounded = norm.length >= 8 && normalizedReviews.some((r) => r.includes(norm))
    return grounded ? cita.slice(0, 220) : ''
  }
  const count = (v: unknown) => Math.min(Math.max(typeof v === 'number' ? Math.round(v) : 1, 1), total)
  const tally = (v: unknown) => Math.min(Math.max(typeof v === 'number' ? Math.round(v) : 0, 0), total)

  const fortalezas: Strength[] = asArray(data.fortalezas)
    .filter(isObject)
    .filter((f) => str(f.tema) && str(f.detalle))
    .map((f) => ({ tema: str(f.tema), detalle: str(f.detalle), respaldo: count(f.respaldo), cita: quote(f.cita) }))
    .sort((a, b) => b.respaldo - a.respaldo)
    .slice(0, MAX_STRENGTHS)

  const oportunidades: Opportunity[] = asArray(data.oportunidades)
    .filter(isObject)
    .filter((o) => str(o.tema) && str(o.detalle))
    .map((o) => ({
      tema: str(o.tema),
      detalle: str(o.detalle),
      gravedad: toPriority(o.gravedad),
      respaldo: count(o.respaldo),
      cita: quote(o.cita),
    }))
    .sort((a, b) => PRIORITY_ORDER[a.gravedad] - PRIORITY_ORDER[b.gravedad] || b.respaldo - a.respaldo)
    .slice(0, MAX_OPPORTUNITIES)

  const temas: ThemeCount[] = asArray(data.temas)
    .filter(isObject)
    .filter((t) => str(t.nombre))
    .map((t) => {
      const positivas = tally(t.positivas)
      // A theme can't have more mentions than there are reviews.
      return { nombre: str(t.nombre), positivas, negativas: Math.min(tally(t.negativas), total - positivas) }
    })
    .filter((t) => t.positivas + t.negativas > 0)
    .sort((a, b) => b.positivas + b.negativas - (a.positivas + a.negativas))
    .slice(0, MAX_THEMES)

  const acciones: Action[] = data.acciones
    .filter(isObject)
    .filter((a) => str(a.accion))
    .map((a) => ({
      accion: str(a.accion),
      motivo: str(a.motivo),
      prioridad: toPriority(a.prioridad),
      plazo: toHorizon(a.plazo),
      impacto: str(a.impacto),
      pasos: asArray(a.pasos)
        .map(str)
        .filter(Boolean)
        .slice(0, 4),
      respaldo: count(a.respaldo),
      cita: quote(a.cita),
    }))
    .sort((a, b) => PRIORITY_ORDER[a.prioridad] - PRIORITY_ORDER[b.prioridad])
    .slice(0, MAX_ACTIONS)

  // The model only says WHICH review (by number) to answer and drafts the
  // reply; the rating and the review text shown to the user come from our
  // own data, so they can never be misquoted.
  const respuestas: SuggestedReply[] = asArray(data.respuestas)
    .filter(isObject)
    .map((r) => {
      const idx = typeof r.numero === 'number' ? Math.round(r.numero) - 1 : -1
      const review = reviews[idx]
      return review && str(r.respuesta)
        ? { rating: review.rating, resena: review.text.slice(0, 300), respuesta: str(r.respuesta).slice(0, 700) }
        : null
    })
    .filter((r): r is SuggestedReply => r !== null)
    .slice(0, MAX_REPLIES)

  return { resumen, fortalezas, oportunidades, temas, acciones, respuestas }
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
        // "low" keeps that minimal. The complete analysis is a much longer
        // JSON than the old 3-field one, so the output budget is generous
        // (a too-small limit cuts the JSON off mid-way).
        generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } },
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
      .select('name, category')
      .eq('id', business_id)
      .single()
    if (businessError || !business) throw new Error('Negocio no encontrado.')

    const { data: rawReviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('rating, text, published_at')
      .eq('business_id', business_id)
      .order('published_at', { ascending: false })
      .limit(MAX_REVIEWS)
    if (reviewsError) throw new Error(reviewsError.message)

    const reviews = (rawReviews ?? []).filter(
      (r): r is Review => typeof r.text === 'string' && r.text.trim().length > 0,
    )

    if (reviews.length === 0) {
      throw new Error(
        'Todavía no hay reseñas con texto guardadas para este negocio. El sync las trae de a poco cada 6h — probá de nuevo más tarde.',
      )
    }

    const stats = computeStats(reviews)
    const reviewsBlock = reviews
      .map((r, i) => `[${i + 1}] (${r.rating ?? '?'}★, ${r.published_at?.slice(0, 10) ?? 's/f'}) ${r.text}`)
      .join('\n')

    const prompt = `Sos un consultor que ayuda a dueños de negocios locales a entender sus reseñas de Google Maps y a decidir qué hacer. Tu análisis tiene que ser COMPLETO, específico y útil, no genérico.

Negocio: ${business.name}${business.category ? ` (${business.category})` : ''}

Reseñas recientes (${reviews.length}, más nuevas primero, cada una con su número):
${reviewsBlock}

Basándote ÚNICAMENTE en estas reseñas — no inventes nada que no esté respaldado por ellas — respondé con un JSON con exactamente esta forma, en español:

{
  "resumen": "3 a 4 frases: diagnóstico general de cómo perciben al negocio sus clientes, qué predomina y qué es lo más importante a saber",
  "fortalezas": [
    { "tema": "nombre corto", "detalle": "1 a 2 frases concretas", "respaldo": 4, "cita": "..." }
  ],
  "oportunidades": [
    { "tema": "nombre corto", "detalle": "1 a 2 frases concretas", "gravedad": "alta", "respaldo": 3, "cita": "..." }
  ],
  "temas": [
    { "nombre": "Atención", "positivas": 7, "negativas": 2 }
  ],
  "acciones": [
    {
      "accion": "...",
      "motivo": "...",
      "prioridad": "alta",
      "plazo": "esta semana",
      "impacto": "...",
      "pasos": ["...", "..."],
      "respaldo": 3,
      "cita": "..."
    }
  ],
  "respuestas": [
    { "numero": 5, "respuesta": "..." }
  ]
}

Reglas:
- "fortalezas": hasta ${MAX_STRENGTHS} cosas que los clientes valoran, ordenadas de más a menos mencionadas.
- "oportunidades": hasta ${MAX_OPPORTUNITIES} problemas o cosas a mejorar. "gravedad" es "alta" si 3 o más reseñas lo mencionan o si baja claramente la calificación, "media" si lo mencionan 2, "baja" si solo 1.
- "temas": hasta ${MAX_THEMES} temas que aparecen en las reseñas (por ejemplo atención, comida o producto, precio, ambiente, tiempos de espera, limpieza, ubicación). "positivas" y "negativas" son cuántas reseñas hablan bien y mal de ese tema. Solo incluí temas que realmente se mencionan.
- "acciones": hasta ${MAX_ACTIONS}, de más a menos prioritaria. Cada una tiene: "accion" (una frase concreta que empiece con un verbo y que el dueño pueda ejecutar), "motivo" (por qué, según las reseñas), "prioridad" ("alta", "media" o "baja"), "plazo" (uno de: "esta semana", "este mes", "próximos 3 meses"), "impacto" (qué mejora esperable trae, en una frase, sin prometer números), "pasos" (2 a 4 pasos cortos y prácticos para hacerla).
- "respaldo": cuántas de las reseñas de la lista mencionan ese tema (un número entero entre 1 y ${reviews.length}).
- "cita": un fragmento corto (máximo 15 palabras) copiado LITERALMENTE de una reseña que respalde el punto.
- "respuestas": hasta ${MAX_REPLIES} respuestas listas para publicar, para las reseñas más negativas o mixtas (idealmente de 3 estrellas o menos). "numero" es el número de la reseña de la lista. "respuesta" es lo que el dueño puede contestar públicamente en Google: cordial y profesional, en primera persona, agradece, reconoce el problema puntual sin discutir, ofrece una solución o invita a volver, y no promete nada que no se sepa ni inventa datos. Máximo 60 palabras. Si no hay reseñas negativas o mixtas, devolvé "respuestas": [].
- Si las reseñas son todas positivas y no señalan ningún problema, devolvé "oportunidades": [] y "acciones": [] y decilo en el "resumen". No inventes problemas para llenar las listas.

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
          analysis = parseAnalysis(text, reviews)
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
      review_count: reviews.length,
      provider: usedProvider,
      // Kept for the original columns / older UI: short prose versions of the
      // strengths and opportunities.
      bien: analysis.fortalezas
        .slice(0, 2)
        .map((f) => f.detalle)
        .join(' '),
      mejorar: analysis.oportunidades.length
        ? analysis.oportunidades
            .slice(0, 2)
            .map((o) => o.detalle)
            .join(' ')
        : 'Las reseñas recientes no señalan ningún problema concreto.',
      acciones: analysis.acciones,
      detalle: {
        resumen: analysis.resumen,
        estadisticas: stats,
        fortalezas: analysis.fortalezas,
        oportunidades: analysis.oportunidades,
        temas: analysis.temas,
        respuestas: analysis.respuestas,
      },
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
        detalle: row.detalle,
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
