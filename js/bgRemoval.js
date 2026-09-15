/* إزالة خلفية الصورة — بتشتغل كلها جوّه المتصفح (ONNX/WASM)، من غير سيرفر
   ولا مفتاح API.

   المشكلة اللي كانت بتخلّيها "تفشل": الموديل (حوالي 40 ميجا) بيتحمّل على شكل
   ~40 قطعة من staticimgly.com، وكان بيتعاد تحميله من الأول بعد كل ريفرش —
   يعني دقيقة استنى في كل مرة. الحل: بنخزّن قطع الموديل في Cache Storage
   بتاعة المتصفح، فأول مرة بس هي اللي بتستنى، وبعد كده بتفتح في ثواني حتى
   بعد قفل المتصفح. */

const CDNS = [
  'https://esm.sh/@imgly/background-removal@1.5.8',
  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm',
];
const MODEL_HOST = 'staticimgly.com';
const MODEL_CACHE = 'bakery-bgmodel-v1';

let libPromise = null;
function loadLib() {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    for (const url of CDNS) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        if (mod && typeof mod.removeBackground === 'function') return mod;
      } catch (e) { /* جرّب الـ CDN اللي بعده */ }
    }
    libPromise = null; // اسمح بإعادة المحاولة لو النت رجع
    throw new Error('تعذر تحميل أداة إزالة الخلفية — اتأكد إن النت شغال وجرب تاني');
  })();
  return libPromise;
}

/* بنلفّ fetch مؤقتاً عشان قطع الموديل تتقري من الكاش بدل الشبكة.
   المكتبة بتنادي fetch العام، فالتغليف ده بيشتغل من غير ما نلمس كودها. */
let patchDepth = 0;
let originalFetch = null;
async function patchModelFetch() {
  if (patchDepth++ > 0) return;
  if (!('caches' in window)) return;
  let cache = null;
  try { cache = await caches.open(MODEL_CACHE); } catch (e) { return; }
  originalFetch = window.fetch;
  const orig = originalFetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes(MODEL_HOST)) return orig.call(window, input, init);
    try {
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch (e) { /* الكاش مش متاح — كمّل عادي */ }
    const res = await orig.call(window, input, init);
    if (res && res.ok && res.status === 200) {
      try { await cache.put(url, res.clone()); } catch (e) { /* مساحة مش كفاية */ }
    }
    return res;
  };
}
function unpatchModelFetch() {
  if (--patchDepth > 0) return;
  if (originalFetch) { window.fetch = originalFetch; originalFetch = null; }
}

/* هل الموديل متخزّن خلاص؟ (عشان نعرف نقول للمستخدم هيستنى ولا لأ) */
export async function isModelCached() {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open(MODEL_CACHE);
    const keys = await cache.keys();
    return keys.length > 5;
  } catch (e) { return false; }
}

/* تحميل الأداة والموديل في الخلفية عشان أول استخدام ميستناش */
let warmPromise = null;
export function warmUpBackgroundRemoval(onProgress) {
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    const mod = await loadLib();
    if (typeof mod.preload !== 'function') return;
    await patchModelFetch();
    try {
      await mod.preload({
        progress: (key, current, total) => {
          if (onProgress && total) onProgress(Math.min(100, Math.round((current / total) * 100)), key);
        },
      });
    } finally { unpatchModelFetch(); }
  })().catch(() => { warmPromise = null; });
  return warmPromise;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('تعذرت قراءة نتيجة المعالجة'));
    reader.readAsDataURL(blob);
  });
}

/* تصغير الصورة قبل المعالجة عشان تطلع أسرع والنتيجة تبقى حجمها معقول */
async function downscale(file, maxSide = 900) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) { if (bitmap.close) bitmap.close(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return await new Promise(res => canvas.toBlob(res, 'image/png'));
}

/* الناتج PNG بشفافية وممكن يبقى كبير — بنصغّره مع الحفاظ على الشفافية
   عشان يتخزن مع المنتج من غير ما يكبّر قاعدة البيانات. */
async function shrinkPng(blob, maxSide = 700) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/png');
}

export async function removeImageBackground(file, onProgress) {
  const report = (pct, key) => { try { if (onProgress) onProgress(pct, key); } catch (e) { /* ignore */ } };
  report(0, 'fetch:lib');
  const mod = await loadLib();
  const input = await downscale(file);
  await patchModelFetch();
  let blob;
  try {
    blob = await mod.removeBackground(input, {
      progress: (key, current, total) => {
        if (total) report(Math.min(100, Math.round((current / total) * 100)), key);
      },
    });
  } catch (e) {
    throw new Error('تعذر فصل الخلفية: ' + (e && e.message ? e.message : 'خطأ غير متوقع'));
  } finally { unpatchModelFetch(); }
  if (!blob || !blob.size) throw new Error('تعذر فصل الخلفية — جرب صورة أوضح');
  report(100, 'compute:done');
  return shrinkPng(blob);
}

/* مسح الموديل المخزّن (لو حصلت مشكلة أو عايز تفضّي مساحة) */
export async function clearModelCache() {
  try { await caches.delete(MODEL_CACHE); warmPromise = null; return true; } catch (e) { return false; }
}
