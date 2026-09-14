const APIFY_ACTOR = 'compass~crawler-google-places'

export interface ScrapedPlace {
  mapsUrl: string
  name: string
  rating: number | null
  reviewCount: number
  photoUrl: string | null
}

/** Follows redirects to turn a short link (maps.app.goo.gl/...) into a canonical Maps URL. */
async function resolveMapsUrl(input: string): Promise<string | null> {
  const trimmed = input.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  const res = await fetch(trimmed, { redirect: 'follow' })
  await res.body?.cancel()
  return res.url
}

async function runScraper(runInput: Record<string, unknown>, apiToken: string) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runInput),
    },
  )
  if (!res.ok) throw new Error(`Apify falló: ${res.status} ${await res.text()}`)
  return res.json()
}

/** Accepts a Google Maps URL (including short links) or a free-text search query. */
export async function scrapePlace(input: string, apiToken: string): Promise<ScrapedPlace> {
  const mapsUrl = await resolveMapsUrl(input)
  const runInput = mapsUrl
    ? { startUrls: [{ url: mapsUrl }], maxCrawledPlacesPerSearch: 1, scrapePlaceDetailPage: true }
    : { searchStringsArray: [input.trim()], maxCrawledPlacesPerSearch: 1, scrapePlaceDetailPage: true }

  const items = await runScraper(runInput, apiToken)
  const place = items?.[0]
  if (!place) {
    throw new Error(`No se encontró ningún negocio para "${input}".`)
  }

  return {
    mapsUrl: place.url ?? mapsUrl ?? input.trim(),
    name: place.title ?? 'Sin nombre',
    rating: place.totalScore ?? null,
    reviewCount: place.reviewsCount ?? 0,
    photoUrl: place.imageUrl ?? null,
  }
}

export interface RawReview {
  reviewId: string
  text: string | null
  stars: number | null
  publishedAtDate: string | null
}

/** Re-scrapes a known Maps URL — used by the recurring sync job. */
export async function getReviewStats(
  mapsUrl: string,
  apiToken: string,
): Promise<{ rating: number | null; reviewCount: number; reviews: RawReview[] }> {
  const items = await runScraper(
    {
      startUrls: [{ url: mapsUrl }],
      maxCrawledPlacesPerSearch: 1,
      scrapePlaceDetailPage: true,
      // MarketPulse block 1: pull recent review text alongside the
      // rating/count we already tracked. newest-first + a small cap keeps
      // this from re-fetching (and re-billing) a business's entire review
      // history on every sync — see PROGRESO.md for the cost reasoning.
      maxReviews: 20,
      reviewsSort: 'newest',
      // Explicitly opt out of reviewer identity (name, photo, profile) —
      // we only want the review content itself, not personal data about
      // whoever left it.
      scrapeReviewsPersonalData: false,
    },
    apiToken,
  )
  const place = items?.[0]
  if (!place) {
    throw new Error('El negocio ya no se encuentra en esa URL de Google Maps.')
  }

  // Defensive: the exact shape of `place.reviews` hasn't been confirmed
  // against a live payload yet (per Apify's docs it should be an array on
  // the place item). If it's missing or shaped differently, degrade to no
  // reviews rather than breaking the rating/count sync that's worked
  // reliably for weeks — that part must never depend on this.
  let reviews: RawReview[] = []
  try {
    if (Array.isArray(place.reviews)) {
      reviews = place.reviews
        .filter((r: unknown): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r: Record<string, unknown>) => ({
          reviewId: String(r.reviewId ?? ''),
          text: typeof r.text === 'string' ? r.text : null,
          stars: typeof r.stars === 'number' ? r.stars : null,
          publishedAtDate: typeof r.publishedAtDate === 'string' ? r.publishedAtDate : null,
        }))
        .filter((r) => r.reviewId)
    }
  } catch {
    reviews = []
  }

  return { rating: place.totalScore ?? null, reviewCount: place.reviewsCount ?? 0, reviews }
}
