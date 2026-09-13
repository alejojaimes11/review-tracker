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

/** Re-scrapes a known Maps URL — used by the daily sync job. */
export async function getReviewStats(
  mapsUrl: string,
  apiToken: string,
): Promise<{ rating: number | null; reviewCount: number }> {
  const items = await runScraper(
    { startUrls: [{ url: mapsUrl }], maxCrawledPlacesPerSearch: 1, scrapePlaceDetailPage: true },
    apiToken,
  )
  const place = items?.[0]
  if (!place) {
    throw new Error('El negocio ya no se encuentra en esa URL de Google Maps.')
  }
  return { rating: place.totalScore ?? null, reviewCount: place.reviewsCount ?? 0 }
}
