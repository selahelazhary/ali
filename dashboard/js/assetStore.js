/* رفع صور اللوحة إلى عقدة assets بدل ما تتحط جوّه المنيو.
   الـ id بصمة المحتوى، فرفع نفس الصورة مرتين ما بيكرّرهاش، وصفحة العميل
   بتقدر تخزّنها في كاش المتصفح للأبد من غير إعادة تحقق. */
import { db, ref, set, get } from '../../js/firebase-config.js';
import { isAssetRef, ASSET_STORES } from '../../js/assets.js';
import { ASSET_MAX_CHARS } from '../../js/imageUtils.js';

/* ترتيب مخازن الصور وقت الرفع: b بعدين c بعدين القاعدة الأساسية.
   أول مخزن يقبل الكتابة هي اللي الصورة تستقر فيه، والإشارة اللي بتترجع
   بتحمل حرفه — فلما مخزن يمتلي (القاعدة بترفض الكتابة) الرفع بيكمّل على
   اللي بعده لوحده من غير أي تدخّل. القاعدة الأساسية آخر الطابور. */
const UPLOAD_CHAIN = ['b', 'c'];

async function storeHas(base, id) {
  try {
    const r = await fetch(`${base}/assets/${encodeURIComponent(id)}.json`);
    if (!r.ok) return false;
    const v = await r.json();
    return typeof v === 'string' && !!v;
  } catch (e) { return false; }
}

async function storePut(base, id, dataUrl) {
  try {
    const r = await fetch(`${base}/assets/${encodeURIComponent(id)}.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(dataUrl),
    });
    return r.ok;
  } catch (e) { return false; }
}

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* بتاخد قيمة حقل صورة وبترجّع القيمة اللي تتخزّن في المنيو:
   - إشارة أصل أو رابط عادي → زي ما هي
   - data URL → بترفعها لعقدة assets وبترجّع "a:<id>" */
export async function publishImage(value) {
  const v = String(value || '');
  if (!v || !v.startsWith('data:')) return v;
  /* القاعدة بترفض أي صورة أطول من الحد ده — بنمسكها بدري برسالة مفهومة
     بدل ما الحفظ يفشل بصمت وتفضل إشارة معلّقة في المنيو. */
  if (v.length > ASSET_MAX_CHARS) {
    throw new Error(`الصورة كبيرة على القاعدة (${Math.round(v.length / 1024)} ك.ب) — صغّرها وجرب تاني`);
  }
  const id = (await sha1Hex(v)).slice(0, 16);

  /* نجرّب المخازن الإضافية الأول — بيوفّروا مساحة وتحميل على القاعدة الأساسية */
  for (const key of UPLOAD_CHAIN) {
    const base = ASSET_STORES[key];
    if (!base) continue;
    if (await storeHas(base, id)) return key + ':' + id;
    if (await storePut(base, id, v)) return key + ':' + id;
  }

  /* كل المخازن رفضت (امتلت أو مش متاحة) ⇒ القاعدة الأساسية */
  const slot = ref(db, `assets/${id}`);
  let exists = false;
  try { exists = (await get(slot)).exists(); } catch (e) { exists = false; }
  if (!exists) {
    try {
      await set(slot, v);
    } catch (e) {
      throw new Error('متقدرناش نحفظ الصورة — راجع صلاحيات حسابك والإنترنت');
    }
  }
  return 'a:' + id;
}

/* نفس الحاجة لمجموعة صور مرة واحدة */
export async function publishImages(values) {
  return Promise.all((values || []).map(publishImage));
}

export { isAssetRef };
