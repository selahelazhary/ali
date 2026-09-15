import { db, ref, push, set } from './firebase-config.js';
import { broadcastTelegram } from './telegram.js';

/* Writes a broadcast that every subscribed storefront client picks up live.
   type: 'newProduct' | 'discount' | 'custom' */
export async function sendBroadcast({ type = 'custom', title, body = '', productId = null, image = null, url = null }) {
  if (!title) throw new Error('title required');
  // الإشعارات مقفولة من اللوحة؟ مانبعتش أصلاً
  try {
    const { get } = await import('./firebase-config.js');
    const f = await get(ref(db, 'settings/features/notifications'));
    if (f.exists() && f.val() === false) return null;
  } catch (e) { /* لو القراءة فشلت نكمل عادي */ }
  const r = push(ref(db, 'broadcasts'));
  await set(r, { type, title, body, productId, image, url, createdAt: Date.now() });
  // نفس الإشعار بيتبعت لكل اللي رابطين تليجرام
  broadcastTelegram({ title, body }).catch(() => {});
  return r.key;
}
