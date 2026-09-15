/* Standard Web Push (VAPID) — no Firebase Cloud Messaging, no paid plan.
   The Python worker holds the private key and does the sending. */
import { db, ref, update } from './firebase-config.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/* Subscribes this browser to push and stores the subscription for the worker. */
export async function registerPushToken(subscriberId, vapidPublicKey) {
  if (!vapidPublicKey || !subscriberId || !pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const wanted = urlBase64ToUint8Array(vapidPublicKey);
    if (sub) {
      const current = new Uint8Array(sub.options.applicationServerKey || new ArrayBuffer(0));
      const same = current.length === wanted.length && current.every((v, i) => v === wanted[i]);
      if (!same) { await sub.unsubscribe().catch(() => {}); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });

    const json = sub.toJSON();
    localStorage.setItem('nb_push_endpoint', json.endpoint || '');
    await update(ref(db, `subscribers/${subscriberId}`), {
      webPush: { endpoint: json.endpoint, keys: json.keys },
      tokenUpdatedAt: Date.now(),
    }).catch(() => {});
    return json.endpoint;
  } catch (e) {
    console.warn('push subscribe failed:', e.message);
    return null;
  }
}

export function currentPushToken() { return localStorage.getItem('nb_push_endpoint') || null; }
