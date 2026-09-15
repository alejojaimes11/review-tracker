# MarketPulse (antes Review Tracker)

Trackea cuántas reseñas de Google gana un negocio desde que se agrega hasta que se detiene el seguimiento. Usa [Apify](https://apify.com) (actor `compass/crawler-google-places`) para consultar nombre, rating y número de reseñas — no depende de Google Cloud ni de la API oficial de Google.

## Requisitos

- Node 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- Un proyecto de Supabase
- Una cuenta gratuita de Apify + API Token

## 1. Crear cuenta de Apify y obtener el token

1. Ve a [apify.com](https://apify.com) y crea una cuenta gratuita (con Google/GitHub o email — no pide tarjeta).
2. El plan gratuito incluye $5 USD de crédito de plataforma cada mes, más que suficiente para 20 negocios actualizados 1 vez al día (~600 consultas/mes cuestan aproximadamente $2-3).
3. Entra a [console.apify.com/settings/integrations](https://console.apify.com/settings/integrations).
4. Copia tu **Personal API token** (empieza con `apify_api_...`).

No necesitas instalar ni configurar el actor manualmente — se invoca directo por API desde la Edge Function.

## 2. Configurar Supabase

```bash
supabase login
supabase link --project-ref <tu-project-ref>
supabase db push
```

Esto crea las tablas `businesses` y `review_snapshots`, y habilita `pg_cron`/`pg_net`.

## 3. Desplegar las Edge Functions

```bash
supabase functions deploy add-business
supabase functions deploy sync-businesses
supabase secrets set APIFY_API_TOKEN=<tu-token-de-apify>
```

## 4. Activar el cron diario

`supabase/migrations/0002_cron.sql` programa `sync-businesses` cada hora (cada negocio se sincroniza según su propio `update_frequency_hours`, 24h por defecto). Para que el job pueda llamarse a sí mismo necesita dos secretos en Supabase Vault — créalos una sola vez desde el SQL Editor del dashboard (no los pongas en un archivo versionado):

```sql
select vault.create_secret('https://<tu-project-ref>.supabase.co', 'project_url');
select vault.create_secret('<tu-service-role-key>', 'service_role_key');
```

## 5. Configurar el frontend

```bash
cp .env.example .env
# completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY con los valores de tu proyecto
npm install
npm run dev
```

## Cómo agregar un negocio

En el dashboard, click en "+ Agregar negocio" y pega una URL de Google Maps (incluye links cortos `maps.app.goo.gl`) o escribe el nombre del negocio + ciudad (ej. "Restaurante XYZ, Bogotá"). El sistema consulta el negocio vía Apify, guarda el conteo de reseñas actual como punto de partida, y desde ahí calcula cuántas reseñas nuevas ha ganado.

## Deploy (Vercel)

La app ya está desplegada en `https://review-tracker-one.vercel.app` (proyecto `ajg-solutions/review-tracker`), con `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` configuradas como env vars de producción. Para publicar cambios nuevos del frontend:

```bash
vercel --prod
```

En el celular, entra a esa URL y usa "Agregar a pantalla de inicio" (Android/iOS) para tener un ícono como app — no requiere Play Store ni un APK.

## Qué se guarda (y qué no)

Lo mínimo necesario para calcular el crecimiento: nombre, URL de Google Maps, rating, número de reseñas, y la fecha de cada consulta (`review_snapshots.created_at`). Desde MarketPulse (bloque 1), también se guardan hasta 20 reseñas individuales recientes por negocio (rating, texto y fecha — tabla `reviews`) para poder generar el análisis con IA. No se almacenan teléfonos, emails, redes sociales, fotos, horarios, coordenadas, ni ningún dato de identidad de quien dejó la reseña (nombre, foto o perfil del reviewer).

## Notas

- El scraping de Google Maps no es un uso oficialmente sancionado por Google — es una zona gris de sus términos de servicio. Para uso interno de bajo volumen como este, el riesgo práctico es mínimo, pero tenlo presente.
- El actor de Apify puede romperse temporalmente si Google cambia el HTML de Maps; en ese caso `sync-businesses` devolverá errores en su respuesta (revisa el campo `errors` del resultado) hasta que el mantenedor del actor lo actualice.
- El conteo de reseñas de Google no es estrictamente creciente (puede bajar por depuración de reseñas falsas); el historial completo queda en `review_snapshots` de todos modos.
