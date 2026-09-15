/* تهريب النصوص قبل ما تتحط في HTML.

   ليه ده مهم: الطلبات وآراء العملاء بيكتبها أي حد من الموقع من غير تسجيل
   دخول. لو اسم العميل كان فيه كود HTML واتحط في اللوحة زي ما هو، الكود ده
   بيشتغل في متصفح صاحب المخبز وهو داخل بصلاحياته — يعني حد من بره يقدر
   يسيطر على اللوحة. فبنهرّب أي نص جاي من بره قبل عرضه. */

const HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;' };

/* للنصوص جوه الصفحة وجوه خصائص العناصر (value="..." وكده) */
export function esc(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"'`=]/g, c => HTML_MAP[c]);
}

/* أسماء وأوصاف بلغتين: { ar, en } أو نص عادي */
export function escName(obj, lang) {
  if (obj == null) return '';
  if (typeof obj === 'string') return esc(obj);
  if (typeof obj !== 'object') return esc(obj);
  return esc((lang && obj[lang]) || obj.ar || obj.en || '');
}

/* أرقام بس — لأي حاجة بتتحط في HTML وهي المفروض رقم */
export function escNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* السكيمات المسموح بيها في اللينكات والصور.
   data:image بس — مش data:text/html اللي ممكن يشغّل كود. و svg مستبعدة
   لأنها ممكن تحتوي سكربت لو اتفتحت كصفحة. */
const ALLOWED_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:', 'blob:'];
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);/i;

/* لينكات وصور: بنمنع javascript: و vbscript: و data:text/html.
   المسارات النسبية (assets/x.png) بتعدّي عادي لأنها مالهاش سكيم. */
export function safeUrl(url, fallback = '') {
  if (url == null) return fallback;
  const raw = String(url).trim();
  if (!raw) return fallback;

  // بنشيل أي مسافات/أسطر/محارف تحكّم مخبّية جوه السكيم قبل الفحص
  const flat = raw.replace(/[\u0000-\u0020]/g, '').toLowerCase();

  const colon = flat.indexOf(':');
  if (colon !== -1) {
    // السكيم بيبقى موجود بس لو النقطتين قبل أول / أو ? أو #
    const seps = ['/', '?', '#'].map(c => flat.indexOf(c)).filter(i => i !== -1);
    const firstSep = seps.length ? Math.min(...seps) : Infinity;
    if (colon < firstSep) {
      const scheme = flat.slice(0, colon + 1);
      const ok = ALLOWED_SCHEMES.indexOf(scheme) !== -1 || (scheme === 'data:' && DATA_IMAGE.test(flat));
      if (!ok) return fallback;
    }
  }
  return esc(raw);
}

/* رقم تليفون لـ href="tel:" — أرقام وعلامة + بس */
export function safeTel(phone) {
  return String(phone == null ? '' : phone).replace(/[^0-9+]/g, '').slice(0, 24);
}
