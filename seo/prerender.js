#!/usr/bin/env node
/* توليد محتوى SEO ثابت قبل النشر.
   ------------------------------------------------------------------
   المشكلة: الموقع بيبني كل محتواه بجافاسكربت، فالـ HTML اللي بيوصل لجوجل
   وللواتساب وفيسبوك وبنج كان **فاضي تماماً** (صفر حرف نص). جوجل بينفّذ
   جافاسكربت لكنه بيأجّل الفهرسة أيام، وباقي الزواحف مابتنفّذش أصلاً.

   الحل: قبل كل نشر بنقرا المنيو من فايربيز ونكتب:
     • محتوى حقيقي (اسم المحل، الأقسام، المنتجات، الأسعار) جوّه index.html
     • وسوم وصف وعنوان مبنية على البيانات الفعلية
     • بيانات منظّمة JSON-LD (محل + منيو + منتجات)
     • sitemap.xml بكل الأقسام
   والجافاسكربت بيستبدل المحتوى ده بنفسه وقت التشغيل — يعني اللي بيشوفه
   الزائر هو نفسه اللي بيشوفه جوجل (مفيش تمويه).

   التشغيل:  node seo/prerender.js        */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = 'https://alih-5212b-default-rtdb.firebaseio.com';
const SITE = 'https://alih-5212b.web.app';

const MARK_START = '<!-- SEO:START -->';
const MARK_END = '<!-- SEO:END -->';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* النصوص جوّه JSON-LD لازم تتهرّب من علامات تقفل الوسم */
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

async function read(node) {
  const res = await fetch(`${DB}/${node}.json`);
  if (!res.ok) throw new Error(`تعذر قراءة ${node}: ${res.status}`);
  return res.json();
}

const ar = (v, fb = '') => (v && typeof v === 'object' ? (v.ar || v.en || fb) : (v || fb));
const en = (v, fb = '') => (v && typeof v === 'object' ? (v.en || v.ar || fb) : (v || fb));

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/* صفحة منتج مستقلة: محتوى حقيقي للزوار وللزواحف، وزرار بيوّدي للتطبيق */
function productPage({ nm, desc, pr, currency, cat, url, name, id, ld, crumbs }) {
  const e = esc;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#1565C0">
<title>${e(nm)} — ${e(name)}</title>
<meta name="description" content="${e(desc.slice(0, 160))}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="product">
<meta property="og:title" content="${e(nm)} — ${e(name)}">
<meta property="og:description" content="${e(desc.slice(0, 200))}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/assets/logo.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="../assets/logo-sm.png" type="image/png">
<link rel="stylesheet" href="../css/style.css">
<script type="application/ld+json">${jsonLd(ld)}</script>
<script type="application/ld+json">${jsonLd(crumbs)}</script>
</head>
<body>
<main class="ex-eg-seo-page">
  <nav class="ex-eg-seo-crumbs"><a href="../">${e(name)}</a> <span>/</span> <span>${e(cat)}</span></nav>
  <h1>${e(nm)}</h1>
  ${pr ? `<p class="ex-eg-seo-price">${e(currency)} ${e(pr)}</p>` : ''}
  <p class="ex-eg-seo-desc">${e(desc)}</p>
  <a class="ex-eg-seo-cta" href="../?product=${encodeURIComponent(id)}">اطلب دلوقتي</a>
  <p class="ex-eg-seo-back"><a href="../">شوف المنيو كامل — ${e(name)}</a></p>
</main>
</body>
</html>
`;
}

function catSlug(c, i) {
  const base = en(c.name, '') || ar(c.name, '') || `cat-${i + 1}`;
  return String(base).toLowerCase().trim()
    .replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '') || `cat-${i + 1}`;
}

async function main() {
  const [menuRaw, features] = await Promise.all([read('menu'), read('settings/features').catch(() => null)]);
  const menu = menuRaw || {};
  const defaults = readDefaults();

  const name = ar(menu.name, defaults.name || 'براد أونلاين');
  const nameEn = en(menu.name, defaults.name || 'براد أونلاين');
  const cats = (Array.isArray(menu.categories) ? menu.categories : []).filter(Boolean);
  const products = cats.flatMap(c => (Array.isArray(c.products) ? c.products : []).filter(Boolean)
    .map(p => ({ ...p, catAr: ar(c.name), catEn: en(c.name) })));

  const address = ar(menu.address, '');
  const phone = menu.contactNumber || '';
  const hours = menu.openingHours || '';
  const currency = menu.currencyCode || 'EGP';

  /* ---------- الوصف: مبني على المحتوى الفعلي ---------- */
  const catNames = cats.map(c => ar(c.name)).filter(Boolean);
  const description = products.length
    ? `${name} — اطلب أونلاين من ${products.length} منتج طازة: ${catNames.slice(0, 6).join('، ')}. توصيل وطلب من الموبايل مباشرة.`
    : `${name} — براد أونلاين — لحوم ومجمدات. اطلب أونلاين: ${catNames.slice(0, 8).join('، ')}${catNames.length > 8 ? ' وغيرها' : ''}. توصيل سريع وطلب من الموبايل.`;

  const keywords = [name, 'لحوم', 'مجمدات', 'براد', 'فراخ', 'جمبري', 'سمك', 'طلب أونلاين', 'توصيل', 'frozen food', 'meat', 'order online']
    .concat(catNames.slice(0, 12)).join('، ');

  /* ---------- محتوى مقروء للزواحف ---------- */
  const priceOf = (p) => {
    const vs = Array.isArray(p.variants) ? p.variants : [];
    const nums = vs.map(v => Number(v.price) || 0).filter(Boolean);
    return nums.length ? Math.min(...nums) : null;
  };

  const content = `
  <div id="seo-content">
    <h1>${esc(name)}</h1>
    <p>${esc(description)}</p>
    ${address ? `<p><strong>العنوان:</strong> ${esc(address)}</p>` : ''}
    ${phone ? `<p><strong>التليفون:</strong> ${esc(phone)}</p>` : ''}
    ${hours ? `<p><strong>مواعيد العمل:</strong> ${esc(hours)}</p>` : ''}
    ${cats.length ? `<h2>أقسام المنيو</h2>
    <ul>${cats.map((c, i) => {
      const ps = (Array.isArray(c.products) ? c.products : []).filter(Boolean);
      return `<li><h3>${esc(ar(c.name))}${en(c.name) && en(c.name) !== ar(c.name) ? ` — ${esc(en(c.name))}` : ''}</h3>${
        ps.length ? `<ul>${ps.map(p => {
          const pr = priceOf(p);
          return `<li>${esc(ar(p.name))}${pr ? ` — ${esc(currency)} ${pr}` : ''}${
            ar(p.description) ? `<br><span>${esc(ar(p.description))}</span>` : ''}</li>`;
        }).join('')}</ul>` : ''
      }</li>`;
    }).join('')}</ul>` : ''}
  </div>`;

  /* ---------- بيانات منظّمة ---------- */
  const bakery = {
    '@context': 'https://schema.org',
    '@type': 'GroceryStore',
    name: nameEn,
    alternateName: name,
    url: SITE,
    image: `${SITE}/assets/logo.png`,
    description,
    priceRange: '$$',
    currenciesAccepted: currency,
    paymentAccepted: 'Cash, Vodafone Cash, InstaPay',
  };
  if (address) bakery.address = { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'EG' };
  if (phone) bakery.telephone = phone;
  if (hours) bakery.openingHours = hours;
  const socials = [menu.instagram, menu.facebook, menu.tiktok, menu.website].filter(Boolean);
  if (socials.length) bakery.sameAs = socials;

  if (cats.length) {
    bakery.hasMenu = {
      '@type': 'Menu',
      name: `منيو ${name}`,
      hasMenuSection: cats.map(c => ({
        '@type': 'MenuSection',
        name: ar(c.name),
        hasMenuItem: (Array.isArray(c.products) ? c.products : []).filter(Boolean).map(p => {
          const item = { '@type': 'MenuItem', name: ar(p.name) };
          if (ar(p.description)) item.description = ar(p.description);
          const pr = priceOf(p);
          if (pr) item.offers = { '@type': 'Offer', price: String(pr), priceCurrency: currency };
          return item;
        }),
      })),
    };
  }

  const website = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    url: SITE,
    inLanguage: 'ar-EG',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };

  /* ---------- حقن الكتلة في index.html ---------- */
  const head = `
<meta name="keywords" content="${esc(keywords)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="googlebot" content="index, follow">
<meta name="author" content="${esc(name)}">
<meta property="og:site_name" content="${esc(name)}">
<meta property="og:locale" content="ar_EG">
<meta property="og:locale:alternate" content="en_US">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<meta property="og:image:alt" content="${esc(name)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(name)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/assets/logo.png">
<link rel="alternate" hreflang="ar" href="${SITE}/">
<link rel="alternate" hreflang="en" href="${SITE}/?lang=en">
<link rel="alternate" hreflang="x-default" href="${SITE}/">
<script type="application/ld+json">${jsonLd(bakery)}</script>
<script type="application/ld+json">${jsonLd(website)}</script>`;

  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // نظّف أي كتلة قديمة
  const strip = (s) => {
    const a = s.indexOf(MARK_START);
    if (a === -1) return s;
    const b = s.indexOf(MARK_END, a);
    return s.slice(0, a) + s.slice(b + MARK_END.length);
  };
  html = strip(html);
  while (html.includes(MARK_START)) html = strip(html);

  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(name)} — اطلب أونلاين | براد أونلاين — لحوم ومجمدات</title>`);
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(description)}">`);
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(name)} — اطلب أونلاين">`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(description)}">`);

  html = html.replace('</head>', `${MARK_START}${head}\n${MARK_END}\n</head>`);
  html = html.replace('<div id="app"></div>', `<div id="app">${MARK_START}${content}\n${MARK_END}</div>`);

  fs.writeFileSync(path.join(ROOT, 'index.html'), html);

  /* ---------- صفحة مستقلة لكل منتج ----------
     من غير الصفحات دي كل المنتجات بتبقى جوّه صفحة واحدة، وجوجل بيفهرس
     **صفحات** مش منتجات — يعني المنتج مايظهرش بنتيجة خاصة بيه.
     كل صفحة هنا: عنوان ووصف وسعر وصورة وبيانات Product منظّمة + زرار طلب. */
  const prodDir = path.join(ROOT, 'p');
  fs.rmSync(prodDir, { recursive: true, force: true });
  const productPages = [];

  if (products.length) {
    fs.mkdirSync(prodDir, { recursive: true });
    const ratings = await read('ratings').catch(() => null) || {};

    for (const p of products) {
      const nm = ar(p.name);
      if (!nm) continue;
      const slug = `${slugify(en(p.name) || nm)}-${p.id}`;
      const pr = priceOf(p);
      const desc = ar(p.description) || `${nm} من ${name} — ${p.catAr}. اطلب أونلاين دلوقتي${pr ? ` بسعر ${currency} ${pr}` : ''}.`;
      const url = `${SITE}/p/${slug}.html`;

      const ld = {
        '@context': 'https://schema.org', '@type': 'Product',
        name: nm, description: desc, category: p.catAr, url,
        brand: { '@type': 'Brand', name },
      };
      if (pr) ld.offers = { '@type': 'Offer', price: String(pr), priceCurrency: currency, availability: 'https://schema.org/InStock', url };
      const r = ratings[p.id];
      if (r && typeof r === 'object') {
        const vals = Object.values(r).map(x => Number(x && x.v)).filter(v => v >= 1 && v <= 5);
        if (vals.length) ld.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
          reviewCount: vals.length,
        };
      }

      const crumbs = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: name, item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: p.catAr, item: `${SITE}/` },
          { '@type': 'ListItem', position: 3, name: nm, item: url },
        ],
      };

      fs.writeFileSync(path.join(prodDir, `${slug}.html`), productPage({
        nm, desc, pr, currency, cat: p.catAr, url, name, id: p.id, ld, crumbs,
      }));
      productPages.push({ url, nm });
    }
  }

  /* ---------- sitemap ---------- */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pri: '1.0', freq: 'daily' },
    { loc: `${SITE}/privacy-policy.html`, pri: '0.3', freq: 'monthly' },
  ];
  productPages.forEach(p => urls.push({ loc: p.url, pri: '0.9', freq: 'weekly' }));

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n')
    + `\n</urlset>\n`);

  console.log('تم توليد SEO:');
  console.log('  الاسم      :', name);
  console.log('  الوصف      :', description.slice(0, 90) + '...');
  console.log('  الأقسام    :', cats.length);
  console.log('  المنتجات   :', products.length);
  console.log('  نص للزواحف :', content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length, 'حرف');
  console.log('  صفحات منتجات:', productPages.length, '(كل منتج له رابط خاص يقدر يظهر في البحث)');
  console.log('  sitemap    :', urls.length, 'رابط');
  if (features && features.notifications === undefined) console.log('  (ملاحظة: settings/features مش متاحة للقراءة العامة)');
}

function readDefaults() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
    const m = src.match(/window\.MENU_DATA\s*=\s*(\{[\s\S]*?\n\});/);
    return m ? JSON.parse(m[1]) : {};
  } catch (e) { return {}; }
}

main().catch((e) => { console.error('فشل التوليد:', e.message); process.exit(1); });
