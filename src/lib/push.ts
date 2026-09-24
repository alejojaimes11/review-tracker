// Browser-side Web Push helpers shared by the client (business) flow.
// PushToggle (admin) keeps its own copies on purpose: Phase 1 code is not touched.

export const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export const isPushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** applicationServerKey must be raw bytes; the VAPID key is base64url text. */
export function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** `serviceWorker.ready` never resolves if no worker registers (e.g. dev), so don't wait forever. */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/** True when the app runs from the home screen (iOS standalone or a standard installed PWA). */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
