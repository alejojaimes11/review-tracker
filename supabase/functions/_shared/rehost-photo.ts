import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Downloads a Google-hosted photo (from Apify's scrape) and re-uploads it to
 * our own `business-photos` bucket, returning the new public URL.
 *
 * Google's photo CDN (`lh3.googleusercontent.com`) is hotlinked directly
 * otherwise, and its latency is wildly inconsistent — some photos load in
 * under a second, others took 15+ seconds in production, which is what made
 * the whole app feel like it was hanging on open. Re-hosting once at
 * add-business time makes every business's photo load from the same fast,
 * reliable Storage CDN regardless of source.
 *
 * Best-effort: returns null on any failure so the caller can fall back to
 * the original Google URL rather than blocking business creation on it.
 */
export async function rehostPhoto(
  supabase: SupabaseClient,
  businessId: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())

    const path = `${businessId}-google.jpg`
    const { error } = await supabase.storage
      .from('business-photos')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
    if (error) return null

    return supabase.storage.from('business-photos').getPublicUrl(path).data.publicUrl
  } catch {
    return null
  }
}
