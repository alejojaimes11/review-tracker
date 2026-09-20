import webpush from 'npm:web-push@3.6.7'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  /** Where the notification click should open, relative to the app origin. */
  url?: string
  /** Notifications sharing a tag replace each other on the device, so a resend never shows twice. */
  tag?: string
}

export type PushResult =
  | { ok: true }
  // `gone` = the push service says the subscription no longer exists (404/410).
  | { ok: false; status: number | null; gone: boolean; message: string }

let configured = false

function configure() {
  if (configured) return
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT en los secretos.')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  configure()
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12, urgency: 'normal' },
    )
    return { ok: true }
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? null
    return {
      ok: false,
      status,
      gone: status === 404 || status === 410,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
