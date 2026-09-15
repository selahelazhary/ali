/* تقييم المنتجات — كل جهاز بيقيّم المنتج مرة واحدة (ويقدر يغيّر تقييمه).
   التقييمات محفوظة في العقدة ratings/{productId}/{deviceId} والمتوسط
   بيتحسب في المتصفح، فمفيش سيرفر ولا حسابات لازمة. */
import { db, ref, get, set, onValue, auth } from './firebase-config.js';

const DEVICE_KEY = 'nb_rater_id';

/* معرّف المقيِّم: لو الزائر عنده جلسة من فايربيز بنستخدم رقمها — ده اللي
   بيخلّي القواعد تقدر تتأكد إن التقييم بتاع صاحبه فعلاً وتمنع التزوير.
   غير كده بنرجع لرقم عشوائي ثابت على الجهاز (مش مربوط بأي بيانات شخصية). */
export function raterId() {
  try { if (auth.currentUser) return auth.currentUser.uid; } catch (e) { /* ignore */ }
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
  if (!id) {
    id = 'r' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
  }
  return id;
}

export function summarise(node) {
  if (!node || typeof node !== 'object') return { avg: 0, count: 0 };
  const vals = Object.values(node)
    .map(r => (r && typeof r === 'object' ? Number(r.v) : Number(r)))
    .filter(v => Number.isFinite(v) && v >= 1 && v <= 5);
  if (!vals.length) return { avg: 0, count: 0 };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { avg: Math.round((sum / vals.length) * 10) / 10, count: vals.length };
}

/* كل التقييمات مرة واحدة — بتتنادى عند فتح المنيو */
export async function loadAllRatings() {
  try {
    const snap = await get(ref(db, 'ratings'));
    if (!snap.exists()) return {};
    const out = {};
    const raw = snap.val() || {};
    Object.keys(raw).forEach(pid => { out[pid] = summarise(raw[pid]); });
    return out;
  } catch (e) { return {}; }
}

export function watchRatings(onChange) {
  try {
    return onValue(ref(db, 'ratings'), (snap) => {
      const raw = snap.exists() ? (snap.val() || {}) : {};
      const out = {};
      Object.keys(raw).forEach(pid => { out[pid] = summarise(raw[pid]); });
      onChange(out);
    }, () => {});
  } catch (e) { return () => {}; }
}

export async function myRating(productId) {
  try {
    const snap = await get(ref(db, `ratings/${productId}/${raterId()}`));
    if (!snap.exists()) return 0;
    const v = snap.val();
    return Number(v && typeof v === 'object' ? v.v : v) || 0;
  } catch (e) { return 0; }
}

export async function rateProduct(productId, value) {
  const v = Math.max(1, Math.min(5, Math.round(Number(value) || 0)));
  if (!productId && productId !== 0) throw new Error('no product');
  await set(ref(db, `ratings/${productId}/${raterId()}`), { v, at: Date.now() });
  return v;
}
