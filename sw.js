/* Freezer service worker — offline shell, Web Push delivery, notification clicks.
   Push payloads are sent by the Python worker using VAPID (no FCM). */
const CACHE = 'bakery-shell-v41';
/* ملاحظة: Hosting شغّال عليه cleanUrls، يعني /index.html بيتحوّل لـ / —
   فبنخزّن الجذر './' بس عشان مانخزّنش رد فيه تحويل. */
const SHELL = [
  './', './css/style.css',
  './js/app.js', './js/cart.js', './js/icons.js', './js/defaults.js', './js/pricing.js', './js/imageUtils.js',
  './js/telegram.js', './js/firebase-config.js', './js/data.js', './js/notify.js', './js/push.js', './js/cookies.js', './js/escape.js', './js/assets.js', './js/ratings.js',
  './assets/logo.png', './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* طلبات فتح الصفحة (التنقّل) — التطبيق المثبّت بيرفض أي رد فيه تحويل (redirect)
   وبيطلع صفحة فاضية. Hosting بيحوّل /index.html إلى / بسبب cleanUrls، فبنعيد
   بناء الرد من غير علامة التحويل قبل ما نرجّعه. */
async function handleNavigate(request) {
  try {
    const res = await fetch(request);
    const clean = res.redirected
      ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
      : res;
    const copy = clean.clone();
    caches.open(CACHE).then(c => c.put('./', copy)).catch(() => {});
    return clean;
  } catch (e) {
    const cached = (await caches.match('./')) || (await caches.match('./index.html'));
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  /* لوحة التحكم مابتتخزّنش أبداً: خلط ملف جديد مع ملف قديم من الكاش كان
     بيكسر الاستيراد وبيسيب الصفحة على اللوجو بس. */
  if (url.pathname.startsWith('/dashboard')) return;

  if (e.request.mode === 'navigate') { e.respondWith(handleNavigate(e.request)); return; }

  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then(r => {
      // never answer a script/style/image request with the HTML shell — it breaks the app
      return r || Response.error();
    }))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: e.data ? e.data.text() : 'منوعات الرحمان' }; }
  const title = data.title || 'منوعات الرحمان';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/assets/logo.png',
    badge: '/assets/logo.png',
    image: data.image || undefined,
    tag: data.tag || 'bakery',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    vibrate: [120, 60, 120],
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.focus(); c.postMessage({ type: 'open-inbox', url: target }); return; }
    }
    return self.clients.openWindow(target);
  }));
});
