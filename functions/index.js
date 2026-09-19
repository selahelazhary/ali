/* Bakery — Cloud Functions (Google Cloud / Firebase, region europe-west1)
 *
 *  onBroadcastCreated   /broadcasts/{id}         → FCM push to every subscriber with a token
 *  onOrderCreated       /orders/{id}             → Telegram message to the shop (token stays server-side)
 *  onOrderStatusChanged /orders/{id}/status      → push to the customer's device + Telegram status line
 *  cleanupSubscribers   daily                    → drops subscribers whose tokens are dead
 */
const { onValueCreated, onValueUpdated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const db = () => admin.database();
const INSTANCE = 'alih-5212b-default-rtdb';

/* ---------------- helpers ---------------- */
const STATUS_AR = { preparing: 'بدأنا نجهز طلبك 🥐', ready: 'طلبك جاهز ✅', completed: 'تم تسليم طلبك — بالهنا والشفا 🧡', cancelled: 'تم إلغاء طلبك ❌' };
const STATUS_EN = { preparing: 'We started preparing your order 🥐', ready: 'Your order is ready ✅', completed: 'Order delivered — enjoy 🧡', cancelled: 'Your order was cancelled ❌' };
const PAY_LABELS = { cod: 'الدفع عند الاستلام', vodafoneCash: 'فودافون كاش', etisalatCash: 'اتصالات كاش', instapay: 'إنستاباي' };
const shortId = (id) => (id || '').slice(-6).toUpperCase();
const tName = (o) => (o && typeof o === 'object') ? (o.ar || o.en || '') : (o || '');
const SITE_URL = 'https://alih-5212b.web.app';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function absoluteUrl(value) {
  if (!value) return `${SITE_URL}/assets/logo.png`;
  try { return new URL(value, SITE_URL).href; } catch (e) { return `${SITE_URL}/assets/logo.png`; }
}

function productsFromMenu(menu) {
  return (menu.categories || []).flatMap((category) => (category.products || []).map((product) => ({ product, category })));
}

function productSeoHtml(product, menu) {
  const name = tName(product.name) || 'منتج';
  const description = tName(product.description) || `تعرف على ${name} واطلبه من ${tName(menu.name) || 'المتجر'}.`;
  const image = absoluteUrl(product.image || menu.logo);
  const url = `${SITE_URL}/product/${encodeURIComponent(product.id)}`;
  const offers = (product.variants || []).map((variant) => ({ '@type': 'Offer', price: variant.price, priceCurrency: menu.currencyCode || 'EGP', availability: 'https://schema.org/InStock', url }));
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, description, image: [image], url, brand: { '@type': 'Brand', name: tName(menu.name) || 'Bakery' }, offers });
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)} | ${escapeHtml(tName(menu.name) || 'Bakery')}</title><meta name="description" content="${escapeHtml(description.slice(0, 155))}"><link rel="canonical" href="${url}"><meta property="og:type" content="product"><meta property="og:title" content="${escapeHtml(name)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><script type="application/ld+json">${jsonLd}</script></head><body><main><a href="/">${escapeHtml(tName(menu.name) || 'Bakery')}</a><article><img src="${image}" alt="${escapeHtml(name)}"><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description)}</p><a href="/index.html?product=${encodeURIComponent(product.id)}">عرض المنتج والطلب</a></article></main></body></html>`;
}

exports.seoProduct = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const id = decodeURIComponent((req.path || '').split('/').filter(Boolean).pop() || '');
  const menu = (await db().ref('menu').get()).val() || {};
  const match = productsFromMenu(menu).find(({ product }) => String(product.id) === String(id));
  if (!match) { res.status(404).send('Not found'); return; }
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900');
  res.status(200).send(productSeoHtml(match.product, menu));
});

exports.seoSitemap = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const menu = (await db().ref('menu').get()).val() || {};
  const entries = productsFromMenu(menu).map(({ product }) => `<url><loc>${SITE_URL}/product/${encodeURIComponent(product.id)}</loc><changefreq>daily</changefreq><priority>0.8</priority><image:image><image:loc>${absoluteUrl(product.image || menu.logo)}</image:loc><image:title>${escapeHtml(tName(product.name))}</image:title></image:image></url>`).join('');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=900');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>${SITE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url><url><loc>${SITE_URL}/privacy-policy.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>${entries}</urlset>`);
});

async function telegramSettings() {
  const snap = await db().ref('settings/telegram').get();
  const v = snap.val() || {};
  return v.botToken && v.chatId ? v : null;
}

async function sendTelegram(text) {
  const tg = await telegramSettings();
  if (!tg) return false;
  const res = await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tg.chatId, text, parse_mode: 'Markdown' }),
  });
  if (!res.ok) logger.warn('telegram failed', await res.text());
  return res.ok;
}

function orderMessage(order, id) {
  const L = [`🥐 *طلب جديد #${shortId(id)}*`];
  if (order.deliveryMethod === 'delivery') { L.push(`🛵 توصيل — ${order.governorateName || ''}`); if (order.address) L.push(`📍 ${order.address}`); }
  else L.push(`🛍 استلام من الفرع${order.branchName ? ` — ${order.branchName}` : ''}`);
  L.push(`👤 ${order.customerName} — ${order.customerPhone}`);
  L.push(`💳 ${PAY_LABELS[order.paymentMethod] || order.paymentMethod || '-'}${order.paymentRef ? ` — ref: ${order.paymentRef}` : ''}`);
  L.push('');
  (order.items || []).forEach(i => L.push(`• ${tName(i.name)}${i.variantName ? ` (${tName(i.variantName)})` : ''} × ${i.qty} — ${order.currencyCode} ${i.price * i.qty}`));
  L.push('');
  if (order.deliveryFee) L.push(`🚚 رسوم التوصيل: ${order.currencyCode} ${order.deliveryFee}`);
  L.push(`💰 *الإجمالي: ${order.currencyCode} ${order.total}*`);
  if (order.notes) L.push(`📝 ${order.notes}`);
  return L.join('\n');
}

/* Sends one FCM message to a list of tokens (500 per batch) and returns the dead tokens. */
async function pushToTokens(tokens, { title, body, image, url, tag }) {
  const dead = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body: body || '', ...(image ? { imageUrl: image } : {}) },
      data: { url: url || '/index.html', tag: tag || 'bakery' },
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        notification: { icon: '/assets/logo.png', badge: '/assets/logo.png', ...(image ? { image } : {}), tag: tag || 'bakery', renotify: true, dir: 'rtl', lang: 'ar' },
        fcmOptions: { link: url || '/index.html' },
      },
    });
    res.responses.forEach((r, k) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(chunk[k]);
      }
    });
    logger.info(`push batch: ${res.successCount} ok / ${res.failureCount} failed`);
  }
  return dead;
}

/* ---------------- triggers ---------------- */
exports.onBroadcastCreated = onValueCreated({ ref: '/broadcasts/{id}', instance: INSTANCE }, async (event) => {
  const b = event.data.val() || {};
  const subsSnap = await db().ref('subscribers').get();
  const subs = subsSnap.val() || {};
  const tokenOwners = {};
  Object.entries(subs).forEach(([sid, s]) => { if (s && s.fcmToken) tokenOwners[s.fcmToken] = sid; });
  const tokens = Object.keys(tokenOwners);
  if (!tokens.length) { logger.info('broadcast: no tokens'); return; }
  const url = b.productId ? `/product/${encodeURIComponent(b.productId)}` : '/index.html';
  const dead = await pushToTokens(tokens, { title: b.title, body: b.body, image: b.image || null, url, tag: `bc-${event.params.id}` });
  await Promise.all(dead.map(t => db().ref(`subscribers/${tokenOwners[t]}/fcmToken`).remove()));
  await event.data.ref.child('sentTo').set(tokens.length - dead.length);
});

exports.onOrderCreated = onValueCreated({ ref: '/orders/{id}', instance: INSTANCE }, async (event) => {
  const order = event.data.val();
  if (!order) return;
  try { await sendTelegram(orderMessage(order, event.params.id)); } catch (e) { logger.warn('telegram order failed', e.message); }
});

exports.onOrderStatusChanged = onValueUpdated({ ref: '/orders/{id}/status', instance: INSTANCE }, async (event) => {
  const status = event.data.after.val();
  const before = event.data.before.val();
  if (!status || status === before) return;
  const orderSnap = await db().ref(`orders/${event.params.id}`).get();
  const order = orderSnap.val() || {};
  const id = shortId(event.params.id);

  if (order.fcmToken && (STATUS_AR[status])) {
    const ar = order.lang !== 'en';
    const title = ar ? STATUS_AR[status] : STATUS_EN[status];
    const body = ar ? `طلب رقم ${id}` : `Order #${id}`;
    try {
      const dead = await pushToTokens([order.fcmToken], { title, body, url: `/index.html?track=${event.params.id}`, tag: `order-${event.params.id}` });
      if (dead.length) await db().ref(`orders/${event.params.id}/fcmToken`).remove();
    } catch (e) { logger.warn('customer push failed', e.message); }
  }

  const line = { preparing: '👨‍🍳 بدأ تحضير الطلب', ready: '✅ الطلب جاهز', completed: '📦 تم تسليم الطلب', cancelled: '❌ تم إلغاء الطلب' }[status];
  if (line) { try { await sendTelegram(`${line} — #${id}${order.customerName ? ` (${order.customerName})` : ''}`); } catch (e) { /* best effort */ } }
});

exports.cleanupSubscribers = onSchedule({ schedule: 'every 24 hours', region: 'europe-west1' }, async () => {
  const snap = await db().ref('subscribers').get();
  const subs = snap.val() || {};
  const cutoff = Date.now() - 180 * 86400000;
  const stale = Object.entries(subs).filter(([, s]) => !s || (!s.fcmToken && (s.lastSeen || s.createdAt || 0) < cutoff)).map(([id]) => id);
  await Promise.all(stale.map(id => db().ref(`subscribers/${id}`).remove()));
  logger.info(`cleanup: removed ${stale.length} stale subscribers`);
});
