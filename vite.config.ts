import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseOrigin = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : ''
  // generateSW serializes runtimeCaching predicates by stringifying the
  // function — it can't close over outer variables like supabaseOrigin, so
  // that reference came through as `undefined` in the built service worker
  // and the route silently never matched. A RegExp literal has no such
  // problem: its source is baked in as-is.
  const escapedOrigin = supabaseOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const supabaseRestPattern = new RegExp(`^${escapedOrigin}/rest/`)
  const supabaseStoragePattern = new RegExp(`^${escapedOrigin}/storage/`)

  return {
    plugins: [
      react(),
      VitePWA({
        // 'prompt' + manual registration (below, via the UpdatePrompt
        // component) instead of the default silent auto-reload — a tab
        // left open could sit on stale content for a while before the
        // background reload kicked in, with no visible sign anything
        // had changed. This surfaces it as a tap-to-update banner instead.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['icon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'MarketPulse',
          short_name: 'MarketPulse',
          start_url: '/',
          display: 'standalone',
          background_color: '#08080d',
          theme_color: '#08080d',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
        workbox: {
          // Lets the last-known dashboard/detail data show up when there's
          // no internet — the service worker always tries the network
          // first (so it's never stale while online) and falls back to
          // whatever was last cached when the request fails.
          runtimeCaching: [
            {
              urlPattern: supabaseRestPattern,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-data',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: supabaseStoragePattern,
              handler: 'CacheFirst',
              options: {
                cacheName: 'supabase-storage',
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],
  }
})
