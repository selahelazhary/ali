/* Storefront side of "الإشعارات": subscription, live broadcast feed, inbox and PWA install. */
import { ICONS } from './icons.js';
import { esc, safeUrl } from './escape.js';
import { imgSrc, wireAssets } from './assets.js';
import { db, ref, set, push, update, onValue, query, limitToLast, orderByChild } from './firebase-config.js';
import { registerPushToken } from './push.js';

const SUB_KEY = 'nb_subscriber_id';
const SEEN_KEY = 'nb_last_seen_broadcast';
const DISMISS_KEY = 'nb_install_dismissed_at';
const TG_LINKED_KEY = 'nb_telegram_linked';

const STR = {
  ar: {
    inbox: 'الإشعارات', empty: 'مفيش إشعارات لسه', enable: 'فعّل الإشعارات', enableSub: 'هيوصلك كل جديد وكل خصم أول بأول', enabled: 'الإشعارات مفعّلة ✓',
    denied: 'الإشعارات مقفولة من إعدادات المتصفح', install: 'ثبّت التطبيق', installSub: 'افتح Bakery من شاشتك الرئيسية زي أي تطبيق', installBtn: 'تثبيت', later: 'لاحقاً',
    iosHint: 'على iPhone: اضغط زر المشاركة ثم "إضافة إلى الشاشة الرئيسية"', newProduct: 'منتج جديد', discount: 'خصم', custom: 'إشعار', markRead: 'تحديد الكل كمقروء',
    tgBtn: 'فعّل على تليجرام', tgSub: 'هيوصلك تحديث طلبك وكل منتج جديد أو خصم كرسالة على تليجرام', tgLinked: 'تليجرام مربوط ✓', tgWaiting: 'كمّل في تليجرام', tgWaitingSub: 'اضغط Start في البوت وهترجع تلاقيها اتفعّلت',
  },
  en: {
    inbox: 'Notifications', empty: 'No notifications yet', enable: 'Enable notifications', enableSub: 'Get every new product and discount first', enabled: 'Notifications enabled ✓',
    denied: 'Notifications are blocked in your browser settings', install: 'Install the app', installSub: 'Open Bakery from your home screen like any app', installBtn: 'Install', later: 'Later',
    iosHint: 'On iPhone: tap Share then "Add to Home Screen"', newProduct: 'New product', discount: 'Discount', custom: 'Notice', markRead: 'Mark all as read',
    tgBtn: 'Enable on Telegram', tgSub: 'Get your order updates, new products and offers as Telegram messages', tgLinked: 'Telegram linked ✓', tgWaiting: 'Finish in Telegram', tgWaitingSub: 'Press Start in the bot and come back',
  },
};

let broadcasts = [];
let loadedAt = 0;
let listeners = [];
let feedStarted = false;

export function isSubscribed() { return !!localStorage.getItem(SUB_KEY) && ('Notification' in window) && Notification.permission === 'granted'; }
export function notificationsBlocked() { return ('Notification' in window) && Notification.permission === 'denied'; }
export function onFeedChange(fn) { listeners.push(fn); }
function emit() { listeners.forEach(fn => { try { fn(getUnreadCount()); } catch (e) { /* ignore */ } }); }

export function getUnreadCount() {
  const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
  return broadcasts.filter(b => (b.createdAt || 0) > seen).length;
}
export function markAllSeen() {
  const latest = broadcasts.reduce((m, b) => Math.max(m, b.createdAt || 0), 0);
  localStorage.setItem(SEEN_KEY, String(latest || Date.now()));
  emit();
}

export async function subscribe(ctx) {
  if (!('Notification' in window)) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  let id = localStorage.getItem(SUB_KEY);
  if (!id) {
    id = push(ref(db, 'subscribers')).key;
    localStorage.setItem(SUB_KEY, id);
    if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, String(Date.now()));
  }
  try {
    await update(ref(db, `subscribers/${id}`), { createdAt: Date.now(), lang: ctx.lang, ua: navigator.userAgent.slice(0, 120), standalone: isStandalone(), lastSeen: Date.now() });
  } catch (e) { /* rules may block until pasted; local subscription still works */ }
  startFeed(ctx);
  refreshPushToken(ctx);
  return 'granted';
}

/* Registers/refreshes the FCM token when the owner has configured web push (VAPID key). */
export function refreshPushToken(ctx) {
  const id = localStorage.getItem(SUB_KEY);
  const vapid = ctx.settings && ctx.settings.features && (ctx.settings.features.vapidPublicKey || ctx.settings.features.vapidKey);
  if (!id || !vapid || !isSubscribed()) return;
  registerPushToken(id, vapid).catch(() => {});
}

export function startFeed(ctx) {
  if (feedStarted) return;
  feedStarted = true;
  loadedAt = Date.now();
  const q = query(ref(db, 'broadcasts'), orderByChild('createdAt'), limitToLast(30));
  onValue(q, (snap) => {
    const list = [];
    snap.forEach(c => { list.push({ id: c.key, ...c.val() }); });
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const fresh = list.filter(b => (b.createdAt || 0) > loadedAt && !broadcasts.some(x => x.id === b.id));
    broadcasts = list;
    fresh.forEach(b => showNotification(b, ctx));
    emit();
    const id = localStorage.getItem(SUB_KEY);
    if (id) update(ref(db, `subscribers/${id}`), { lastSeen: Date.now() }).catch(() => {});
  }, () => {});
}

function showNotification(b, ctx) {
  if (window.__sfToast) window.__sfToast(b.title, ICONS.bell);
  if (!isSubscribed()) return;
  try {
    const opts = { body: b.body || '', icon: b.image || ctx.logo || 'assets/logo.png', badge: 'assets/logo.png', tag: b.id, data: { url: './index.html' } };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(reg => reg.showNotification(b.title, opts)).catch(() => new Notification(b.title, opts));
    } else {
      new Notification(b.title, opts);
    }
  } catch (e) { /* ignore */ }
  try { navigator.vibrate && navigator.vibrate([100, 50, 100]); } catch (e) { /* ignore */ }
}

/* ---------- inbox UI ---------- */
export function openInbox(ctx, onOpenProduct) {
  const S = STR[ctx.lang] || STR.ar;
  const overlay = document.createElement('div');
  overlay.className = 'ex-eg-modal-overlay';
  const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
  const typeIcon = { newProduct: ICONS.star, discount: ICONS.receipt, custom: ICONS.bell };
  const typeLabel = { newProduct: S.newProduct, discount: S.discount, custom: S.custom };
  overlay.innerHTML = `
    <div class="ex-eg-modal-sheet">
      <div class="ex-eg-sheet-title">${S.inbox}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
      ${subscribeCardHtml(ctx)}
      <div class="ex-eg-inbox-list">
        ${broadcasts.length ? broadcasts.map(b => `
          <button class="ex-eg-inbox-item ${(b.createdAt || 0) > seen ? 'ex-eg-unread' : ''}" data-id="${b.id}" ${b.productId ? `data-product="${b.productId}"` : ''}>
            ${b.image ? `<img ${imgSrc(b.image)} alt="" loading="lazy">` : `<span class="ex-eg-ii-icon">${typeIcon[b.type] || ICONS.bell}</span>`}
            <span class="ex-eg-ii-body">
              <span class="ex-eg-ii-type">${typeLabel[b.type] || S.custom}</span>
              <span class="ex-eg-ii-title">${esc(b.title)}</span>
              ${b.body ? `<span class="ex-eg-ii-text">${esc(b.body)}</span>` : ''}
              <span class="ex-eg-ii-time">${new Date(b.createdAt).toLocaleString(ctx.lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </span>
          </button>
        `).join('') : `<div class="ex-eg-empty-state">${ICONS.bell}<br>${S.empty}</div>`}
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  wireSubscribeCard(overlay, ctx);
  overlay.querySelectorAll('.ex-eg-inbox-item[data-product]').forEach(b => b.addEventListener('click', () => { overlay.remove(); onOpenProduct && onOpenProduct(Number(b.dataset.product)); }));
  document.body.appendChild(overlay);
  wireAssets(overlay);
  markAllSeen();
}

/* ---------- الربط بتليجرام ----------
   العميل بيضغط زرار واحد، تليجرام بيفتح على البوت ومعاه رقم اشتراكه، وأول ما
   يضغط Start بيتسجّل ويستقبل كل إشعاراته كرسائل من البوت. */
export function telegramBot(ctx) {
  const f = (ctx && ctx.settings && ctx.settings.features) || {};
  return f.telegramBot || '';
}
export function isTelegramLinked() { return localStorage.getItem(TG_LINKED_KEY) === '1'; }

/* بينشئ رقم اشتراك من غير ما يطلب إذن إشعارات المتصفح */
export function ensureSubscriberId(ctx) {
  let id = localStorage.getItem(SUB_KEY);
  if (!id) {
    id = push(ref(db, 'subscribers')).key;
    localStorage.setItem(SUB_KEY, id);
    if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, String(Date.now()));
  }
  update(ref(db, `subscribers/${id}`), { createdAt: Date.now(), lang: ctx.lang, lastSeen: Date.now() }).catch(() => {});
  return id;
}

/* بيراقب اشتراك الجهاز ده لحد ما البوت يسجّل الربط */
export function watchTelegramLink(onLinked) {
  const id = localStorage.getItem(SUB_KEY);
  if (!id) return;
  /* بنراقب علامة linked بس — رقم شات تليجرام نفسه مقروء للأدمن بس */
  onValue(ref(db, `subscribers/${id}/linked`), (snap) => {
    if (snap.exists() && snap.val()) {
      localStorage.setItem(TG_LINKED_KEY, '1');
      if (onLinked) onLinked();
    }
  }, () => {});
}

/* الميزة مقفولة من لوحة التحكم؟ يبقى مايبانش أي حاجة عن الإشعارات للعميل */
export function notificationsEnabled(ctx) {
  const f = ctx && ctx.settings && ctx.settings.features;
  return !f || f.notifications !== false;
}

/* كارت الإشعارات للعميل — إشعارات المتصفح العادية بس.
   تليجرام بقى للأدمن فقط (بيستقبل عليه الطلبات وصور التحويل)، فالعميل
   مايشوفش أي حاجة عنه. */
export function subscribeCardHtml(ctx) {
  if (!notificationsEnabled(ctx)) return '';
  const S = STR[ctx.lang] || STR.ar;
  if (isSubscribed()) return '';
  const blocked = notificationsBlocked();
  return `
    <div class="ex-eg-subscribe-card ex-eg-reveal ex-eg-in">
      <span class="ex-eg-sc-icon">${ICONS.bell}</span>
      <span class="ex-eg-sc-body"><b>${S.enable}</b><small>${blocked ? S.denied : S.enableSub}</small></span>
      ${blocked ? '' : `<button class="ex-eg-sc-btn" data-subscribe>${S.enable}</button>`}
    </div>
  `;
}

export function wireSubscribeCard(root, ctx) {
  root.querySelectorAll('[data-subscribe]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const r = await subscribe(ctx);
    const S = STR[ctx.lang] || STR.ar;
    if (r === 'granted') { btn.closest('.ex-eg-subscribe-card').innerHTML = `<span class="ex-eg-sc-icon">${ICONS.check}</span><span class="ex-eg-sc-body"><b>${S.enabled}</b></span>`; if (window.__sfToast) window.__sfToast(S.enabled, ICONS.bell); }
    else { btn.disabled = false; if (window.__sfToast) window.__sfToast(S.denied, ICONS.close); }
  }));

  root.querySelectorAll('[data-telegram]').forEach(btn => btn.addEventListener('click', () => {
    const S = STR[ctx.lang] || STR.ar;
    const bot = telegramBot(ctx);
    if (!bot) return;
    const id = ensureSubscriberId(ctx);
    window.open(`https://t.me/${bot}?start=${id}`, '_blank', 'noopener');
    const card = btn.closest('.ex-eg-subscribe-card');
    if (card) card.innerHTML = `<span class="ex-eg-sc-icon">${ICONS.send}</span><span class="ex-eg-sc-body"><b>${S.tgWaiting}</b><small>${S.tgWaitingSub}</small></span>`;
    startFeed(ctx);
    watchTelegramLink(() => {
      if (card) card.innerHTML = `<span class="ex-eg-sc-icon">${ICONS.check}</span><span class="ex-eg-sc-body"><b>${S.tgLinked}</b></span>`;
      if (window.__sfToast) window.__sfToast(S.tgLinked, ICONS.send);
    });
  }));
}

/* ---------- PWA install ---------- */
let deferredPrompt = null;
export function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

export async function setupPwa(enabled, ctx) {
  if (!('serviceWorker' in navigator)) return;
  if (!enabled) {
    try { const regs = await navigator.serviceWorker.getRegistrations(); regs.forEach(r => r.unregister()); } catch (e) { /* ignore */ }
    return;
  }
  try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { /* ignore */ }
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open-inbox') document.dispatchEvent(new CustomEvent('open-inbox')); });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; maybeShowInstallBanner(ctx); });
  window.addEventListener('appinstalled', () => { hideInstallBanner(); if (window.__sfToast) window.__sfToast('✓', ICONS.check); });
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (isIos && !isStandalone()) setTimeout(() => maybeShowInstallBanner(ctx, true), 2500);
}

function maybeShowInstallBanner(ctx, ios = false) {
  if (isStandalone()) return;
  const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (Date.now() - dismissed < 3 * 24 * 3600 * 1000) return;
  if (document.querySelector('.ex-eg-install-banner')) return;
  const S = STR[ctx.lang] || STR.ar;
  const el = document.createElement('div');
  el.className = 'ex-eg-install-banner';
  el.innerHTML = `
    <img src="assets/logo.png" alt="">
    <span class="ex-eg-ib-body"><b>${S.install}</b><small>${ios ? S.iosHint : S.installSub}</small></span>
    ${ios ? '' : `<button class="ex-eg-ib-btn" id="ib-install">${S.installBtn}</button>`}
    <button class="ex-eg-ib-close" id="ib-close">${ICONS.close}</button>
  `;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('ex-eg-show'));
  el.querySelector('#ib-close').addEventListener('click', () => { localStorage.setItem(DISMISS_KEY, String(Date.now())); hideInstallBanner(); });
  const btn = el.querySelector('#ib-install');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome !== 'accepted') localStorage.setItem(DISMISS_KEY, String(Date.now()));
    hideInstallBanner();
  });
}
function hideInstallBanner() { const el = document.querySelector('.ex-eg-install-banner'); if (el) { el.classList.remove('ex-eg-show'); setTimeout(() => el.remove(), 300); } }

export function installAvailable() { return !!deferredPrompt && !isStandalone(); }
export function triggerInstall(ctx) { maybeShowInstallBanner(ctx, /iphone|ipad|ipod/i.test(navigator.userAgent)); }
