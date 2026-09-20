# Push notifications (Web Push)

Estado: **Fase 1 — solo infraestructura para admin.** No hay eventos de reseñas, motor de notificaciones,
notificaciones a clientes, hitos, inactividad ni mensajes manuales todavía.

## Arquitectura

```
Navegador (admin)                      Supabase                         Servicio push del navegador
─────────────────                      ────────                         ───────────────────────────
PushToggle ──(clic)──► permiso
   │  pushManager.subscribe(VAPID pública)
   └──► register-push ─► valida sesión + admin_users ─► push_subscriptions (upsert por endpoint)

send-test-push ─► valida sesión + admin_users ─► lee suscripciones ─► web-push (VAPID privada) ──► FCM/Mozilla/Apple
                                                                                                       │
push-sw.js (service worker) ◄──────────────────────── evento `push` ◄─────────────────────────────────┘
   └─► showNotification ─► clic ─► abre/enfoca Review Tracker
```

## Service worker

- Se mantiene `vite-plugin-pwa` con `generateSW` y `registerType: 'prompt'`.
- `vite.config.ts` agrega `workbox.importScripts: ['/push-sw.js']`. `public/push-sw.js` solo define los
  manejadores `push` y `notificationclick`; el precaché y el caché de `supabase-data` / `supabase-storage`
  no cambian.
- Al desplegar, los usuarios ven el aviso "Hay una versión nueva disponible" y deben pulsar "Actualizar".

## Tablas (migración `0020_push_subscriptions.sql`)

| Tabla | Propósito | Acceso |
|---|---|---|
| `admin_users` | Fuente de verdad de quién es admin (`user_id`). | RLS activo, sin políticas, `anon`/`authenticated` sin permisos. Solo `service_role`. |
| `push_subscriptions` | `id, user_id, audience ('admin'\|'business'), business_id, endpoint (único), p256dh, auth, created_at, updated_at, last_success_at, failure_count, enabled`. | Igual: solo `service_role`. |

`push_subscriptions` ya admite `audience = 'business'` con `business_id` (Fase posterior); la restricción
`push_subscriptions_audience_shape` exige `user_id` para admin y `business_id` para negocio.

Nota: las políticas RLS de `businesses` (migración 0019) siguen usando el UUID del admin escrito a mano.
Pueden pasar a leer `admin_users` en una fase posterior.

## Edge Functions

Ambas se despliegan con `--no-verify-jwt` y validan ellas mismas: resuelven al usuario desde el token
(`auth.getUser`) y comprueban que esté en `admin_users` (`_shared/admin.ts`). Nunca usan un id del body.

- `register-push` — `{ action: 'subscribe', subscription }` o `{ action: 'unsubscribe', endpoint }`.
  Upsert por endpoint (activar de nuevo no duplica). Rechaza endpoints que ya sean de un negocio.
- `send-test-push` — envía una notificación de prueba a los dispositivos activos del admin que llama.
  Opcional `{ delay_seconds: 0-30 }` para enviarla en segundo plano y poder cerrar la pestaña.
  Registra `last_success_at` / `failure_count`; con 404/410 desactiva la suscripción (o tras 5 fallos).
- `_shared/push.ts` — envoltorio de `npm:web-push@3.6.7`, reutilizable por el motor de la Fase 2.

## Variables y secretos

| Nombre | Dónde | Público |
|---|---|---|
| `VITE_VAPID_PUBLIC_KEY` | `.env` local y variables de Vercel (Production) | Sí (única clave VAPID en el frontend) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Secretos de Edge Functions de Supabase | **No.** La privada nunca va al frontend, al repo ni a logs |

`.env*` está en `.gitignore`. `.env.example` solo lleva marcadores.

## Flujo de permisos

1. Solo el admin logueado ve el botón "🔔 Activar notificaciones" (`PushToggle`).
2. El permiso se pide solo al hacer clic, nunca al cargar.
3. Concedido → `pushManager.subscribe` → `register-push`. Si el servidor falla, se revierte la suscripción local.
4. Estados: sin configurar / permiso concedido / activadas / bloqueadas / error.
5. Bloqueadas: el navegador no vuelve a preguntar; hay que habilitarlas en la configuración del sitio.

## Limitaciones

- **iPhone/iPad:** solo con la app instalada en la pantalla de inicio (iOS 16.4+). En Safari normal el botón no aparece.
- **Escritorio:** con Chrome completamente cerrado, Windows solo recibe si "Seguir ejecutando aplicaciones en segundo plano" está activo.
- Un endpoint es propio de un navegador y perfil; otro navegador u otro dispositivo es otra fila.

## Pruebas

Local (sin credenciales): `npm run lint`, `npm run build`; `deno check` de las funciones; prueba del envoltorio contra
un servidor push local que verifica la firma VAPID y el cifrado `aes128gcm`.

Producción (manual):
1. Entrar en `/admin`, aceptar "Actualizar" si aparece, ir al dashboard.
2. "🔔 Activar notificaciones" → permitir. Verificar la fila en `push_subscriptions`.
3. "Prueba en 20 s" → cerrar la pestaña → esperar → debe llegar "Review Tracker · 🔔 Esta es una notificación de prueba."
4. Clic en la notificación → abre Review Tracker.
5. Repetir activar/desactivar: sigue habiendo una sola fila por dispositivo.
6. Sin sesión de admin, `send-test-push` y `register-push` responden 403.
