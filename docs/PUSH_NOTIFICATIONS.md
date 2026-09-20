# Push notifications (Web Push)

Estado: **Fase 1 (infraestructura push para admin) y Fase 2 (eventos + Notification Engine para admin) terminadas.**
Todavía no hay notificaciones a clientes/negocios, mensajes manuales, hitos, inactividad ni recordatorios (Fase 3).
La Fase 1 se describe primero; la Fase 2 empieza en "Fase 2 — Notification Engine (admin)".

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

---

# Fase 2 — Notification Engine (admin)

```
sync-businesses ──► review_snapshots (ya existía, solo se agrega)
      │
      ├─ emit_review_gained_events()  ──►  notification_events   (hechos, event_key único)
      └─ recordSyncFailure()          ──►  notification_events

cron independiente cada 15 min ──► notification-engine
      1. barrido de seguridad: emit_review_gained_events (últimas 24 h)
      2. reglas: eventos ──► notifications           (engine_commit: 1 transacción)
      3. envío: notifications pendientes y vencidas ──► Web Push ──► notification_deliveries
```

`sync-businesses` **nunca envía push**: solo escribe hechos. Un fallo del motor no afecta al sync y viceversa.

## Tablas (migración `0021_notification_engine.sql`)

| Tabla | Qué guarda | Acceso |
|---|---|---|
| `notification_events` | Hechos: `event_key` (único), `event_type`, `business_id`, `payload`, `occurred_at`, `processed_at`, `notification_id`, `skipped_reason`. | Solo `service_role`. |
| `notifications` | Mensaje concreto: `recipient_user_id`, `type`, `title`, `body`, `data`, `status` (pending/sent/failed), `scheduled_for`, `sent_at`, `read_at`, `attempt_count`, `last_error`. Genérica: sirve para cualquier tipo. | El usuario **lee solo las suyas y ya vencidas**, y solo puede cambiar `read_at`. Sin insert ni delete. |
| `notification_deliveries` | Un intento por (notificación, dispositivo): estado, intentos, `delivered_at`, `error_code`, `error_message`. Único por `(notification_id, push_subscription_id)`. | Solo `service_role`. |
| `notification_engine_state` | `events_from`: instante de lanzamiento. Nada anterior genera eventos (evita una ráfaga con el historial). | Solo `service_role`. |

Funciones SQL (solo `service_role`, `search_path` fijado en la migración 0023):
`emit_review_gained_events(p_since)` y `engine_commit(...)`.

## Eventos

- **`reviews_gained`** — se deriva de `review_snapshots`, que es de solo agregar (a diferencia de `businesses.current_reviews`, que el
  sync sobrescribe). Cada snapshot se compara con el snapshot anterior del mismo negocio; **solo un aumento** crea evento.
  `100 → 95` no crea nada; después `95 → 97` crea `gained = 2`. Clave: `reviews_gained:{business_id}:{snapshot_id}`.
  Payload: `previous_count`, `new_count`, `gained`, `snapshot_id`.
- **`sync_failed`** — lo escribe `sync-businesses` cuando falla un negocio (`business_id` = ese negocio) o el sync completo
  (`business_id` = null). Clave: `sync_failed:{business_id|global}:{hora}`. El error de un negocio no detiene el lote
  (`Promise.allSettled`, sin cambios). Como `pg_cron + net.http_post` es asíncrono y no refleja un HTTP 400/500, el propio sync
  registra el evento antes de responder.

## Reglas y agrupación (`_shared/notification-rules.ts`)

Cada regla = eventos → items → (fusión con lo ya pendiente) → título/cuerpo/`data`. Agregar un tipo nuevo es agregar una entrada a `RULES`.

- **`reviews_activity`** (de `reviews_gained`): **una sola notificación por ciclo**.
  - 1 negocio: `🔔 Valejo Kids recibió 2 nuevas reseñas ⭐` → clic abre `/business/{id}`.
  - 2 a 5 negocios: título `🔔 Nueva actividad en Review Tracker` y una línea por negocio, de mayor a menor → clic abre `/`.
  - Más de 5: resumen `N negocios recibieron nuevas reseñas. Total: X nuevas reseñas ⭐`.
  - Los negocios con +0 no aparecen. `data` guarda `items`, `business_ids`, `total` y `url`.
- **`sync_failed`**: `⚠️ Error de sincronización`. Un negocio: `No se pudo actualizar X.`; varios: se listan hasta 5 y `y N más`.
  Un mismo negocio solo alerta una vez cada 24 h (`SYNC_FAILED_COOLDOWN_HOURS`), para no repetir cada ciclo.

Un evento sin regla se marca procesado con `skipped_reason = 'no_rule'`; los que una regla descarta llevan su motivo.

## Idempotencia y reintentos

| Situación | Cómo se evita el duplicado o la pérdida |
|---|---|
| Se repite el sync / el cron / el barrido | El evento tiene clave única (`on conflict do nothing`). |
| El sync guardó snapshots y cayó antes de emitir eventos | El motor repite `emit_review_gained_events` (24 h atrás). No se pierde nada. |
| Dos ejecuciones del motor toman los mismos eventos | `engine_commit` bloquea las filas y devuelve `null` a la segunda. |
| El motor cae **después** de crear la notificación | Los eventos ya quedaron ligados (misma transacción). La notificación sigue `pending` y el siguiente ciclo solo la envía. |
| Se reintenta el envío | Se salta cada dispositivo con entrega `sent`; el push lleva `tag: n-{id}`, así un reenvío reemplaza en el dispositivo en vez de mostrarse doble. Se reintentan solo errores temporales (sin respuesta, 429, 5xx), hasta 3 intentos. |

Un dispositivo con 404/410 se desactiva (`enabled = false`) y **solo ese**; su historial de entregas se conserva. Tras 5 fallos seguidos también se desactiva.
Si no hay dispositivos activos, la notificación queda `failed` con `last_error = 'no_active_subscriptions'` (igual se ve en la campana).

## Horas de silencio (`_shared/quiet-hours.ts`)

`America/Bogota`, 22:00–07:00. Una notificación creada en ese intervalo **se crea igual** pero con `scheduled_for` = las 07:00 siguientes;
el motor solo envía las que ya vencieron. Mientras esté pendiente y sin tocar, nueva actividad de ese tipo **se fusiona** en ella, para que a las
07:00 llegue un solo aviso. La campana tampoco muestra lo que aún no venció (lo garantiza la política RLS). `scheduled_for` es genérico y
lo reutilizarán otros tipos.

## Edge Functions

- **`notification-engine`** — `verify_jwt = true` y además comprueba que quien llama pueda leer una tabla exclusiva de `service_role`
  (funciona con cualquier formato de clave). Con la clave pública, sin cabecera o con token falso: 401. No hace scraping, no llama a Apify,
  no toca `current_reviews`.
- **`sync-businesses`** — cambio aditivo (42 líneas, ninguna existente modificada): `recordSyncFailure()` y una llamada final a
  `emit_review_gained_events`, ambas dentro de `try/catch` que se tragan sus errores.

## Cron (migración `0022_notification_engine_cron.sql`)

`notification-engine-every-15m` (`*/15 * * * *`), con la clave de Vault, igual que el sync. Espera 3 minutos tras crearse un evento
(`SETTLE_MINUTES`) para que un sync en curso termine y un mismo ciclo caiga en la misma notificación.

## Frontend

`NotificationBell` (solo admin, junto a `PushToggle`): contador de no leídas, últimas 30 notificaciones, título, mensaje, hora relativa y
leída/sin leer. Clic: marca como leída y navega a `data.url`. "Marcar todas como leídas". Lee `notifications` directo con RLS (refresco cada 60 s).

## Cambios a la Fase 1 (los únicos)

1. `_shared/push.ts`: campo opcional `tag` en `PushPayload`. Necesario para que un reenvío reemplace la notificación en el dispositivo.
   `push-sw.js` ya soportaba `tag`, así que no se tocó.
2. `PushToggle.tsx`: solo clases de fondo opaco en sus dos paneles flotantes (eran translúcidos y el texto de abajo se mezclaba).

No se tocaron `push-sw.js`, VAPID, `register-push`, `send-test-push` ni la configuración PWA.

## Decisiones

- **Rutas de clic:** el pedido mencionaba `/admin/business/{id}` y `/admin`, pero esas rutas no existen (`/admin` es el login).
  Se usan `/business/{id}` y `/`.
- **Varios admins:** las notificaciones se crean por admin, pero los eventos los consume el primero. Con un solo admin no hay diferencia;
  si hay más, una interrupción entre admins podría dejar a uno sin aviso. Se revisa en la Fase 3 al definir destinatarios.
- **Entrega "aceptada" ≠ "vista":** `delivered_at` significa que el servicio push aceptó el mensaje; el dispositivo no lo confirma.
- Al hacer clic en la notificación del sistema no se marca como leída (el service worker no tiene la sesión); se marca al abrirla en la campana.

## QA realizado

Datos: con transacciones que se revierten (casos 1 a 6). Envío real: negocios de prueba "🧪 QA …", borrados al terminar.

| Caso | Resultado |
|---|---|
| 1. 100 → 102 | 1 evento (`gained: 2`) |
| 2. Valejo +2, Granja +7, Go Market +1 | 3 eventos → **1** notificación agrupada, sin negocios en +0 |
| 3. Sin crecimiento | 0 eventos, 0 notificaciones |
| 4. 100 → 95; luego 95 → 97 | 0 eventos; luego `gained: 2`, `previous_count: 95` |
| 5. Reintentos (sync, barrido, cron, snapshot repetido) | 0 eventos nuevos, 0 claves duplicadas |
| 6. Motor cae tras crear la notificación | Notificación pendiente enviada una sola vez a cada dispositivo; no se crea otra |
| 7. Dos dispositivos (Chrome/FCM + iPhone/Apple) | Ambos aceptados por su servicio push, para cada notificación |
| 8. Suscripción que responde 410 | Se desactiva solo esa; las reales siguen activas; historial intacto |
| 9. Silencio | `scheduled_for` a futuro: 0 entregas hasta vencer; al vencer, se envía |
| 10. Fallo de sync | 7 negocios reales + 1 de prueba fallaron (Apify sin crédito, 402): 8 eventos con clave propia, el sync respondió 200 y recorrió todo el lote |
| Extra: error temporal (503) | Se reintenta solo el dispositivo con error; los demás no reciben el aviso otra vez; a los 3 intentos se cierra |
| Extra: seguridad | `anon` denegado en todas las tablas nuevas y en las dos funciones SQL; otro usuario no ve ni marca notificaciones ajenas; el admin solo puede cambiar `read_at` |

Pruebas automáticas: `deno test supabase/functions/_shared/notification-rules_test.ts` (10 pruebas: horas de silencio, formato, fusión,
reglas). Ejecutarlas desde un directorio sin `package.json`.

Pendiente de comprobar por una persona: que la notificación **aparezca físicamente** en el iPhone y en el PC (el servicio push la aceptó en ambos).

---

# Endurecimiento posterior a la auditoría de la Fase 2

Dos hallazgos de la auditoría final, corregidos sin cambiar agrupación, silencio, snapshots, UI, service worker, VAPID, `register-push` ni `send-test-push`.

## 1. `sync-businesses` solo para backend

Hallazgo: `verify_jwt = true` deja pasar también la clave pública del frontend, así que cualquiera con esa clave podía disparar un sync
(gasta crédito de Apify y puede generar eventos `sync_failed`).

Corrección: `_shared/backend-auth.ts` (`callerIsBackend`), el mismo principio que ya usaba `notification-engine`. Quien llama debe poder leer una
tabla exclusiva de `service_role` (`admin_users`); funciona con cualquier formato de clave y rechaza la clave pública, el token de un usuario y
tokens falsos. `sync-businesses` lo comprueba antes de hacer nada (10 líneas añadidas, ninguna existente modificada). El motor pasó a usar el mismo helper.

El único que llama al sync es el cron (`sync-businesses-every-6h`, con la clave de Vault); ningún frontend lo invoca.

## 2. Un solo worker envía cada notificación (claim + lease + fencing)

Hallazgo: la etapa de envío leía las notificaciones pendientes sin bloquearlas; dos ejecuciones solapadas del motor (cron + llamada manual,
dos crons lentos, un reintento tras timeout) podían enviar la misma notificación dos veces.

Migración `0024_notification_claims.sql`:
- `notifications.claimed_at` y `notifications.claim_token`.
- `claim_due_notifications(p_limit, p_lease_seconds)`: en una sola sentencia atómica (`FOR UPDATE SKIP LOCKED`) marca como reclamadas las
  notificaciones vencidas y sin reclamar (o cuyo lease expiró) y devuelve **solo** las que esa ejecución ganó, con un `claim_token` propio.
  Solo `service_role` puede ejecutarla.
- `engine_commit` ahora tampoco fusiona actividad nueva en una notificación reclamada (`claimed_at is null`). Sin esto, una notificación que
  se está enviando podía recibir eventos ya marcados como procesados que nunca se anunciarían. La agrupación normal no cambia.

Motor (`notification-engine`):
- Reclama antes de enviar. Lo que otra ejecución ya reclamó no se devuelve.
- El `claim_token` funciona como **token de fencing**: renueva el lease antes de empezar y **antes de cada push**, y las escrituras que cierran la
  notificación llevan `and claim_token = …`. Una ejecución que perdió el claim (lease vencido) se detiene y no puede sobrescribir a la nueva dueña.
- El claim es un **lease de 300 s**: si una ejecución muere o hace timeout, el claim expira y un ciclo posterior retoma la notificación
  (más largo que la ejecución más lenta, más corto que los 15 min del cron). Un reintento por error temporal conserva el claim hasta que expire,
  así hay una espera natural antes de reintentar.
- `notification_deliveries` se comporta igual: se saltan los dispositivos con entrega `sent`.
- El resumen del motor cambia: `due` → `claimed`, y se agrega `lost_claim`.

Límite que un claim no puede cubrir: si una ejecución cae **entre** "el proveedor aceptó el push" y "guardé la entrega", el reintento reenvía a ese
dispositivo. Ahí sigue actuando el `tag` (el reenvío reemplaza la notificación en el dispositivo). Es una ventana de milisegundos; no se probó físicamente.

## QA de este endurecimiento

| Prueba | Resultado |
|---|---|
| `sync-businesses` sin cabecera / con clave pública / con token falso | 401 en los tres (con la clave pública lo rechaza el guard: antes el gateway la dejaba pasar) |
| Tras 3 intentos con la clave pública | Estado idéntico: 14 eventos, 915 snapshots, mismo último update y misma huella del estado de sync |
| `sync-businesses` con la clave de backend (igual que el cron) | 200, `checked: 13` (el sync corrió; los 402 son el crédito de Apify) |
| Motor: 3 ejecuciones simultáneas sobre 1 notificación | 1 solo worker con `claimed: 1` y `pushes_ok: 2`; los otros dos `claimed: 0`. 1 notificación, 2 entregas (una por dispositivo), 0 duplicadas |
| Motor repetido tras completar | 0 notificaciones y 0 entregas nuevas |
| Cron real de las 16:45 con el motor nuevo | `succeeded`; descartó 7 eventos por enfriamiento (`recently_alerted`) sin enviar nada |
| SQL determinista (transacción con rollback) | Solo un worker reclama; la futura no se reclama; token ajeno = 0 filas; tras expirar el lease otro worker reclama y el token viejo pierde el derecho; no se fusiona en una reclamada, sí en una sin reclamar |

Pendiente de observar: el cron real del sync de las 18:00 (hora Colombia) con la clave de Vault. La llamada manual con esa misma clave ya fue aceptada.
