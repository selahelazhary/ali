/* مخزن صور منفصل عن عقدة المنيو.
   ------------------------------------------------------------------
   المشكلة اللي بيحلّها: الصور كانت متخزّنة base64 جوّه `menu` نفسها، فعقدة
   المنيو وصلت 1.7 ميجا، والموقع كان بينزّلها كاملة مرتين (REST + WebSocket)
   قبل ما يعرض أي حاجة — حتى صور أقسام العميل عمره ما فتحها.

   الحل: الصورة بتتخزّن في `assets/{id}` والمنيو بيحمل إشارة `a:{id}` بس.
   - عقدة المنيو بقت ~20KB → الصفحة بتظهر فوراً.
   - كل صورة بتتحمّل لوحدها وقت ما تقرب من الشاشة (IntersectionObserver).
   - الـ id هو بصمة المحتوى (hash)، يعني الصورة الواحدة عمرها ما تتحمّل مرتين
     وتقدر تتخزّن في كاش المتصفح للأبد من غير إعادة تحقق. */

import { db } from './firebase-config.js';

const PREFIX = 'a:';
const CACHE_NAME = 'bakery-assets-v1';
const MEM = new Map();       // id -> data URL
const INFLIGHT = new Map();  // id -> Promise
/* بكسل شفاف — بيشغل مكان الصورة لحد ما تتحمّل فمفيش قفزة في التخطيط */
export const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function isAssetRef(v) { return typeof v === 'string' && v.startsWith(PREFIX); }
export function assetId(v) { return String(v).slice(PREFIX.length); }

/* مرآة الصور على مشروع فايربيز تاني — لتوزيع الضغط.
   الصور محتواها ثابت (الـ id بصمة المحتوى) فنسخة تانية منها آمنة تماماً،
   ومفيش تزامن ولا تعارض. بنقسّم القراءة على الاتنين حسب أول حرف في الـ id،
   فكل صورة بتيجي **دايماً** من نفس المكان (الكاش يفضل نافع) والحِمل يتقسم
   نص بنص. ولو صورة مش موجودة على واحد (صورة جديدة لسه ماتزامنتش) بنجرّب
   التاني تلقائياً. سيبها فاضية عشان توقف المرآة. */
const ASSET_MIRROR = 'https://mdhj-d3cdb-default-rtdb.firebaseio.com';

function assetHosts(id) {
  const primary = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  if (!ASSET_MIRROR || !/^[0-9a-f]/.test(id)) return [primary];
  return parseInt(id[0], 16) % 2 === 0 ? [ASSET_MIRROR, primary] : [primary, ASSET_MIRROR];
}

function restUrl(id, base) {
  return `${base}/assets/${encodeURIComponent(id)}.json`;
}

let cachePromise = null;
function openCache() {
  if (!('caches' in window)) return Promise.resolve(null);
  if (!cachePromise) cachePromise = caches.open(CACHE_NAME).catch(() => null);
  return cachePromise;
}

/* بيرجّع الـ data URL بتاع الصورة — من الذاكرة، وبعدين كاش المتصفح، وآخر حاجة الشبكة */
export async function getAsset(id) {
  if (!id) return null;
  if (MEM.has(id)) return MEM.get(id);
  if (INFLIGHT.has(id)) return INFLIGHT.get(id);

  const job = (async () => {
    const key = `/__asset/${id}`;
    const cache = await openCache();
    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) { const v = await hit.text(); if (v) { MEM.set(id, v); return v; } }
      } catch (e) { /* الكاش مش متاح — نكمل على الشبكة */ }
    }
    try {
      let v = null;
      for (const base of assetHosts(id)) {
        try {
          const res = await fetch(restUrl(id, base));
          if (!res.ok) continue;
          const body = await res.json();
          if (typeof body === 'string' && body) { v = body; break; }
        } catch (e) { /* المصدر ده وقع — نجرّب اللي بعده */ }
      }
      if (!v) return null;
      MEM.set(id, v);
      /* المحتوى ثابت (الـ id بصمته) فالتخزين آمن للأبد */
      if (cache) cache.put(key, new Response(v, { headers: { 'content-type': 'text/plain' } })).catch(() => {});
      return v;
    } catch (e) { return null; }
  })();

  INFLIGHT.set(id, job);
  try { return await job; } finally { INFLIGHT.delete(id); }
}

/* بتتحط مكان src داخل قوالب الـ HTML:
   - رابط عادي  → src مباشر
   - إشارة a:id → بكسل فاضي + data-asset عشان يتحمّل وقت ما يقرب من الشاشة */
export function imgSrc(value, fallback = '') {
  if (isAssetRef(value)) return `src="${BLANK}" data-asset="${assetId(value).replace(/[^A-Za-z0-9_-]/g, '')}"`;
  const v = value || fallback || '';
  return v ? `src="${String(v).replace(/"/g, '&quot;')}"` : `src="${BLANK}"`;
}

/* نفس الفكرة لخلفية CSS (بانرات/خلفية الصفحة) */
export function bgRef(value) {
  return isAssetRef(value) ? ` data-asset-bg="${assetId(value).replace(/[^A-Za-z0-9_-]/g, '')}"` : '';
}

const MARGIN = 600;   // بنبدأ التحميل قبل ما الصورة توصل الشاشة بالمسافة دي

function near(el) {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return true;     // عنصر مخفي/بدون مقاس — حمّله على طول
  return r.top < window.innerHeight + MARGIN && r.bottom > -MARGIN;
}

let io = null;
function observer() {
  if (io !== null) return io;
  if (!('IntersectionObserver' in window)) { io = false; return io; }
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      paint(e.target);
    });
  }, { rootMargin: MARGIN + 'px 0px' });
  return io;
}

/* شبكة أمان: في بعض الحالات (تبويب مخفي، متصفح قديم، صفحة مُسبقة التحميل)
   الـ IntersectionObserver مابيشتغلش خالص — فبنفحص بنفسنا كمان عند التمرير. */
let sweepQueued = false;
function sweep() {
  if (sweepQueued) return;
  sweepQueued = true;
  requestAnimationFrame(() => {
    sweepQueued = false;
    document.querySelectorAll('[data-asset]:not([data-asset-done]),[data-asset-bg]:not([data-asset-done])')
      .forEach((el) => { if (near(el)) paint(el); });
  });
}

let sweepBound = false;
function bindSweep() {
  if (sweepBound) return;
  sweepBound = true;
  addEventListener('scroll', sweep, { passive: true });
  addEventListener('resize', sweep, { passive: true });
}

async function paint(el) {
  const id = el.dataset.asset || el.dataset.assetBg;
  if (!id || el.dataset.assetDone) return;
  el.dataset.assetDone = '1';
  const url = await getAsset(id);
  /* الصورة اتمسحت من المخزن (إشارة معلّقة في المنيو) — بنبلّغ اللي فوقها
     عشان يخفي مكانها بدل ما يسيب مربع فاضي كبير في الصفحة. */
  if (!url) {
    el.dataset.assetMissing = '1';
    el.dispatchEvent(new CustomEvent('asset-missing', { bubbles: true }));
    return;
  }
  if (el.dataset.assetBg) el.style.backgroundImage = `url('${url}')`;
  else el.src = url;
}

/* بتتنادى بعد أي render — بتربط كل الصور الجديدة.
   اللي قريّب من الشاشة بيتحمّل فوراً، والباقي بيستنى التمرير. */
export function wireAssets(root) {
  if (!root || !root.querySelectorAll) return;
  bindSweep();
  const ob = observer();
  root.querySelectorAll('[data-asset]:not([data-asset-done]),[data-asset-bg]:not([data-asset-done])')
    .forEach((el) => {
      if (near(el)) { paint(el); return; }
      if (ob) ob.observe(el); else paint(el);
    });
}

/* تحميل مبكر لصور مهمة (أول بانر مثلاً) من غير انتظار التمرير */
export function preloadAssets(values) {
  (values || []).forEach((v) => { if (isAssetRef(v)) getAsset(assetId(v)); });
}
