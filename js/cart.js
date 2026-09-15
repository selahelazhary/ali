import { ICONS } from './icons.js';
import { esc, escNum, safeUrl } from './escape.js';
import { db, ref, push, set, get, onValue } from './firebase-config.js';
/* The shop's Telegram token is never exposed to customers: order notifications are
   relayed by the dashboard (or by Cloud Functions when server relay is enabled). */
import { EGYPT_GOVERNORATES, DEFAULT_PAYMENTS, STATUS_LABELS, defaultGovernorateSettings, paymentInScope } from './defaults.js';
import { compressImage } from './imageUtils.js';
import { imgSrc, wireAssets } from './assets.js';

const STORAGE_KEY = 'bakery_cart_v1';
const MY_ORDERS_KEY = 'bakery_my_orders_v1';

/* ---------------- cart state ---------------- */
function readCart() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
}
function writeCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  updateBadge();
  document.dispatchEvent(new CustomEvent('cart-changed', { detail: { items } }));
}
export function getCart() { return readCart(); }
export function addToCart(item) {
  const items = readCart();
  const existing = items.find(i => i.key === item.key);
  if (existing) existing.qty += item.qty || 1;
  else items.push({ ...item, qty: item.qty || 1 });
  writeCart(items);
}
export function removeFromCart(key) { writeCart(readCart().filter(i => i.key !== key)); }
export function setQty(key, qty) {
  let items = readCart();
  if (qty <= 0) items = items.filter(i => i.key !== key);
  else { const it = items.find(i => i.key === key); if (it) it.qty = qty; }
  writeCart(items);
}
export function clearCart() { writeCart([]); }

/* الأسعار في العربة بتتحدّث من المنيو الحالي — لو الأدمن غيّر سعر منتج
   بعد ما العميل حطه في العربة، العربة تاخد السعر الجديد. */
export function syncCartPrices(menu, priceOf) {
  const items = readCart();
  if (!items.length || !menu || !Array.isArray(menu.categories)) return;
  const byId = new Map();
  (menu.categories || []).forEach(c => ((c && c.products) || []).forEach(p => byId.set(String(p.id), p)));
  let changed = false;
  const next = items.filter(i => {
    const p = byId.get(String(i.productId));
    if (!p) { changed = true; return false; }           // المنتج اتشال من المنيو
    const variants = p.variants || [];
    const vn = i.variantName && (i.variantName.ar || i.variantName.en || i.variantName);
    const v = variants.find(x => x.name && (x.name.ar === vn || x.name.en === vn)) || variants[0];
    if (!v) { changed = true; return false; }
    const price = typeof priceOf === 'function' ? priceOf(p, v) : Number(v.price) || 0;
    if (i.price !== price) { i.price = price; changed = true; }
    return true;
  });
  if (changed) writeCart(next);
}
export function cartCount() { return readCart().reduce((s, i) => s + i.qty, 0); }
export function cartTotal() { return readCart().reduce((s, i) => s + i.qty * i.price, 0); }

function updateBadge() {
  document.querySelectorAll('.ex-eg-cart-badge').forEach(b => {
    const n = cartCount();
    b.textContent = n > 0 ? String(n) : '';
    b.classList.toggle('ex-eg-show', n > 0);
  });
}
document.addEventListener('DOMContentLoaded', updateBadge);
updateBadge();

/* ---------------- my orders (this device) ---------------- */
export function getMyOrders() {
  try { return JSON.parse(localStorage.getItem(MY_ORDERS_KEY) || '[]'); } catch (e) { return []; }
}
function rememberOrder(id, summary) {
  const list = getMyOrders().filter(o => o.id !== id);
  list.unshift({ id, ...summary });
  localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(list.slice(0, 20)));
}

/* ---------------- i18n ---------------- */
const STR = {
  ar: {
    cart: 'عربة الطلبات', empty: 'العربة فاضية', total: 'الإجمالي', subtotal: 'المجموع', deliveryFee: 'رسوم التوصيل', checkout: 'إتمام الطلب',
    orderType: 'نوع الطلب', inside: 'داخل المخبز (طاولة)', outside: 'خارج المخبز',
    tableNumber: 'رقم الطاولة', pickup: 'استلام من الفرع', delivery: 'توصيل للعنوان', branch: 'اختار الفرع', branchFrom: 'الفرع اللي هيجهّز طلبك',
    governorate: 'المحافظة', chooseGov: 'اختار المحافظة', noGov: 'التوصيل مش متاح حالياً في محافظات تانية',
    name: 'الاسم', phone: 'رقم التليفون', address: 'العنوان بالتفصيل', notes: 'ملاحظات (اختياري)',
    payment: 'طريقة الدفع', cod: 'الدفع عند الاستلام', codSub: 'كاش لما يوصلك الطلب', vodafone: 'فودافون كاش', vodafoneSub: 'حوّل على الرقم وابعت رقم العملية', etisalat: 'اتصالات كاش (e& cash)', etisalatSub: 'حوّل على الرقم وابعت رقم العملية',
    instapay: 'إنستاباي', instapaySub: 'حوّل على العنوان وابعت رقم العملية', payTo: 'حوّل المبلغ على:', txRef: 'رقم العملية / رقم المحوِّل', copy: 'نسخ', copied: 'تم النسخ', optional: '(اختياري)',
    proof: 'صورة (سكرين) التحويل', proofHint: 'اضغط لاختيار صورة التحويل من جهازك', proofWorking: 'جاري تجهيز الصورة...', proofDone: 'تم رفع الصورة ✓', proofFail: 'تعذر قراءة الصورة — جرب صورة تانية', proofRequired: 'لازم ترفع صورة التحويل', refRequired: 'اكتب رقم العملية أو رقم المحوِّل',
    submit: 'تأكيد الطلب', back: 'رجوع', remove: 'حذف',
    required: 'من فضلك املأ الحقول المطلوبة', orderFailed: 'تعذر إرسال الطلب — اتأكد من النت وجرب تاني', placing: 'جاري إرسال الطلب...',
    success: 'تم استلام طلبك بنجاح!', orderNo: 'رقم الطلب', successSub: 'هنبلغك أول ما نبدأ في التحضير',
    continueShopping: 'متابعة الطلب', track: 'تتبع الطلب', myOrders: 'طلباتي', enableNotif: 'فعّل الإشعارات', notifHint: 'عشان يوصلك تنبيه لما يبدأ تحضير طلبك',
    notifOn: 'الإشعارات مفعّلة ✓', stepNew: 'تم استلام الطلب', stepPreparing: 'بدأنا في التحضير', stepReady: 'الطلب جاهز', stepCompleted: 'تم التسليم', stepCancelled: 'تم إلغاء الطلب',
    prepNotifTitle: 'بدأنا نجهز طلبك 🥐', prepNotifBody: 'طلبك رقم', readyNotifTitle: 'طلبك جاهز ✅', noOrders: 'مفيش طلبات على الجهاز ده',
  },
  en: {
    cart: 'Your Cart', empty: 'Your cart is empty', total: 'Total', subtotal: 'Subtotal', deliveryFee: 'Delivery fee', checkout: 'Checkout',
    orderType: 'Order Type', inside: 'Dine-in (Table)', outside: 'Outside the bakery',
    tableNumber: 'Table Number', pickup: 'Pickup from branch', delivery: 'Delivery to address', branch: 'Choose a branch', branchFrom: 'Branch preparing your order',
    governorate: 'Governorate', chooseGov: 'Choose governorate', noGov: 'Delivery is not available in other governorates yet',
    name: 'Name', phone: 'Phone Number', address: 'Full Address', notes: 'Notes (optional)',
    payment: 'Payment method', cod: 'Cash on delivery', codSub: 'Pay in cash when you receive it', vodafone: 'Vodafone Cash', vodafoneSub: 'Transfer to the number and enter the transaction ref', etisalat: 'e& cash (Etisalat)', etisalatSub: 'Transfer to the number and enter the transaction ref',
    instapay: 'InstaPay', instapaySub: 'Transfer to the address and enter the transaction ref', payTo: 'Transfer the amount to:', txRef: 'Transaction ref / sender number', copy: 'Copy', copied: 'Copied', optional: '(optional)',
    proof: 'Transfer screenshot', proofHint: 'Tap to pick the transfer screenshot', proofWorking: 'Preparing the image...', proofDone: 'Image uploaded ✓', proofFail: 'Could not read the image — try another one', proofRequired: 'Please upload the transfer screenshot', refRequired: 'Enter the transaction reference or sender number',
    submit: 'Confirm Order', back: 'Back', remove: 'Remove',
    required: 'Please fill in the required fields', orderFailed: 'Could not place the order — check your connection and try again', placing: 'Placing your order...',
    success: 'Order placed successfully!', orderNo: 'Order #', successSub: "We'll notify you once we start preparing it",
    continueShopping: 'Continue browsing', track: 'Track order', myOrders: 'My orders', enableNotif: 'Enable notifications', notifHint: 'Get alerted when we start preparing your order',
    notifOn: 'Notifications enabled ✓', stepNew: 'Order received', stepPreparing: 'Preparing your order', stepReady: 'Order is ready', stepCompleted: 'Delivered', stepCancelled: 'Order cancelled',
    prepNotifTitle: 'We started preparing your order 🥐', prepNotifBody: 'Order #', readyNotifTitle: 'Your order is ready ✅', noOrders: 'No orders on this device yet',
  },
};

function fmt(n, code) { const isInt = Math.round(n) === n; return `${code} ${isInt ? Math.round(n) : n.toFixed(2)}`; }
/* الاسم الخام (للتخزين في الطلب) */
function tNameRaw(obj, lang) { if (!obj) return ''; if (typeof obj === 'string') return obj; return obj[lang] || obj.ar || obj.en || ''; }
/* الاسم المهرَّب (للعرض في HTML) */
function tName(obj, lang) { return esc(tNameRaw(obj, lang)); }
function shortId(id) { return (id || '').slice(-6).toUpperCase(); }

function sheet(html, cls = '') {
  const overlay = document.createElement('div');
  overlay.className = `ex-eg-modal-overlay cart-overlay ${cls}`;
  overlay.innerHTML = `<div class="ex-eg-modal-sheet ex-eg-cart-sheet">${html}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  wireAssets(overlay);
  const close = overlay.querySelector('.close-modal');
  if (close) close.addEventListener('click', () => overlay.remove());
  return overlay;
}

/* ---------------- cart drawer ---------------- */
export function openCartDrawer(ctx) {
  const { lang, currencyCode } = ctx;
  const S = STR[lang] || STR.ar;
  render();

  function render() {
    const items = readCart();
    const overlay = sheet(`
      <div class="ex-eg-sheet-title">${S.cart}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
      ${items.length === 0 ? `<div class="ex-eg-empty-state">${ICONS.cart}<br>${S.empty}</div>` : `
        <div class="ex-eg-cart-items">
          ${items.map(i => `
            <div class="ex-eg-cart-item-row" data-key="${i.key}">
              <img ${imgSrc(i.image)} alt="" loading="lazy">
              <div class="ex-eg-ci-info">
                <div class="ex-eg-ci-name">${tName(i.name, lang)}${i.variantName ? ` <span class="ex-eg-ci-variant">(${tName(i.variantName, lang)})</span>` : ''}</div>
                <div class="ex-eg-ci-price">${fmt(i.price, currencyCode)}</div>
              </div>
              <div class="ex-eg-qty-stepper">
                <button class="ex-eg-qty-btn" data-act="dec">${ICONS.minus}</button>
                <span>${i.qty}</span>
                <button class="ex-eg-qty-btn" data-act="inc">${ICONS.plus}</button>
              </div>
              <button class="ex-eg-ci-remove" data-act="remove" title="${S.remove}">${ICONS.trash}</button>
            </div>
          `).join('')}
        </div>
        <div class="ex-eg-cart-total-row"><span>${S.total}</span><span class="ex-eg-cart-total-val">${fmt(cartTotal(), currencyCode)}</span></div>
        <button class="ex-eg-checkout-btn" id="go-checkout">${S.checkout}</button>
      `}
    `);
    overlay.querySelectorAll('.ex-eg-cart-item-row').forEach(row => {
      const key = row.dataset.key;
      const rerender = () => { overlay.remove(); render(); };
      row.querySelector('[data-act="inc"]').addEventListener('click', () => { const it = readCart().find(x => x.key === key); if (it) setQty(key, it.qty + 1); rerender(); });
      row.querySelector('[data-act="dec"]').addEventListener('click', () => { const it = readCart().find(x => x.key === key); if (it) setQty(key, it.qty - 1); rerender(); });
      row.querySelector('[data-act="remove"]').addEventListener('click', () => { removeFromCart(key); rerender(); });
    });
    const goCheckout = overlay.querySelector('#go-checkout');
    if (goCheckout) goCheckout.addEventListener('click', () => { overlay.remove(); renderCheckout(ctx); });
  }
}

/* ---------------- checkout ---------------- */
function renderCheckout(ctx) {
  const { lang, currencyCode } = ctx;
  const S = STR[lang] || STR.ar;
  const settings = ctx.settings || {};
  const payments = settings.payments || DEFAULT_PAYMENTS;
  const govSettings = settings.governorates || defaultGovernorateSettings();
  const branches = (settings.branches || []).filter(b => b && b.name);
  const enabledGovs = EGYPT_GOVERNORATES.filter(g => govSettings[g.id] && govSettings[g.id].enabled);
  const codOption = { id: 'cod', icon: ICONS.cash, label: S.cod, sub: S.codSub, cfg: payments.cod };
  const allPayOptions = [
    payments.cod && payments.cod.enabled ? codOption : null,
    payments.vodafoneCash && payments.vodafoneCash.enabled ? { id: 'vodafoneCash', icon: ICONS.vodafoneCash, label: S.vodafone, sub: S.vodafoneSub, payTo: payments.vodafoneCash.number, cfg: payments.vodafoneCash } : null,
    payments.etisalatCash && payments.etisalatCash.enabled ? { id: 'etisalatCash', icon: ICONS.etisalatCash, label: S.etisalat, sub: S.etisalatSub, payTo: payments.etisalatCash.number, cfg: payments.etisalatCash } : null,
    payments.instapay && payments.instapay.enabled ? { id: 'instapay', icon: ICONS.instapay, label: S.instapay, sub: S.instapaySub, payTo: payments.instapay.address, link: payments.instapay.link, cfg: payments.instapay } : null,
  ].filter(Boolean);
  /* كل بوابة ممكن تتحدد من الأدمن: تظهر لطلبات جوّه المخبز ولا برّه ولا الاتنين */
  const optionsFor = (type) => {
    const list = allPayOptions.filter(o => paymentInScope(o.cfg, type));
    return list.length ? list : [codOption];
  };
  const requireProof = payments.requireProof !== false;

  const items = readCart();
  let orderType = 'inside';
  let deliveryMethod = 'pickup';
  let payOptions = optionsFor(orderType);
  let paymentMethod = payOptions[0].id;
  let paymentProof = null;
  let branchId = branches[0] ? branches[0].id : null;
  let govId = enabledGovs[0] ? enabledGovs[0].id : null;

  const overlay = sheet(`
    <div class="ex-eg-sheet-title">${S.checkout}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
    <div class="ex-eg-checkout-form">
      <div class="ex-eg-order-type-tabs">
        <button type="button" class="ex-eg-ot-tab ex-eg-active" data-type="inside">${ICONS.table}${S.inside}</button>
        <button type="button" class="ex-eg-ot-tab" data-type="outside">${ICONS.bag}${S.outside}</button>
      </div>
      <div id="type-fields"></div>

      <label class="ex-eg-field-label">${S.name}</label>
      <input class="ex-eg-field-input" id="f-name" type="text" required>
      <label class="ex-eg-field-label">${S.phone}</label>
      <input class="ex-eg-field-input" id="f-phone" type="tel" inputmode="tel" required>
      <label class="ex-eg-field-label">${S.notes}</label>
      <textarea class="ex-eg-field-input" id="f-notes" rows="2"></textarea>

      <label class="ex-eg-field-label">${S.payment}</label>
      <div class="ex-eg-pay-methods" id="pay-methods"></div>
      <div id="pay-details"></div>

      <div id="summary"></div>
      <div class="ex-eg-checkout-error" id="checkout-error" hidden></div>
      <button class="ex-eg-checkout-btn" id="place-order">${S.submit}</button>
    </div>
  `);

  const q = (sel) => overlay.querySelector(sel);

  function deliveryFee() {
    if (orderType !== 'outside' || deliveryMethod !== 'delivery' || !govId) return 0;
    return Number((govSettings[govId] || {}).deliveryFee || 0);
  }
  function renderSummary() {
    const sub = cartTotal(), fee = deliveryFee();
    q('#summary').innerHTML = `
      <div class="ex-eg-summary-row"><span>${S.subtotal}</span><b>${fmt(sub, currencyCode)}</b></div>
      ${fee ? `<div class="ex-eg-summary-row"><span>${S.deliveryFee}</span><b>${fmt(fee, currencyCode)}</b></div>` : ''}
      <div class="ex-eg-cart-total-row"><span>${S.total}</span><span>${fmt(sub + fee, currencyCode)}</span></div>
    `;
  }

  function renderTypeFields() {
    const box = q('#type-fields');
    if (orderType === 'inside') {
      box.innerHTML = `
        ${branches.length > 1 ? branchPicker() : ''}
        <label class="ex-eg-field-label">${S.tableNumber}</label>
        <input class="ex-eg-field-input" id="f-table" type="text" inputmode="numeric" required>
      `;
    } else {
      box.innerHTML = `
        <div class="ex-eg-order-type-tabs ex-eg-sub-tabs">
          <button type="button" class="ex-eg-ot-tab ${deliveryMethod === 'pickup' ? 'ex-eg-active' : ''}" data-dm="pickup">${ICONS.bag}${S.pickup}</button>
          <button type="button" class="ex-eg-ot-tab ${deliveryMethod === 'delivery' ? 'ex-eg-active' : ''}" data-dm="delivery">${ICONS.bike}${S.delivery}</button>
        </div>
        <div id="dm-fields"></div>
      `;
      renderDmFields();
      box.querySelectorAll('[data-dm]').forEach(btn => btn.addEventListener('click', () => {
        deliveryMethod = btn.dataset.dm;
        box.querySelectorAll('[data-dm]').forEach(b => b.classList.toggle('ex-eg-active', b === btn));
        renderDmFields();
        renderSummary();
      }));
    }
    wireBranchPicker();
  }
  /* اختيار الفرع: زرار بيفتح قائمة عائمة فيها كل الفروع مع بحث —
     أنضف بكتير من قائمة طويلة مفرودة وقت ما الفروع تكتر. */
  function branchPicker(list = branches, label = S.branch) {
    const sel = list.find(b => b.id === branchId) || list[0];
    return `
      <label class="ex-eg-field-label">${label}</label>
      <button type="button" class="ex-eg-branch-select" id="branch-select" aria-haspopup="listbox" aria-expanded="false">
        <span class="ex-eg-bic">${ICONS.storefront}</span>
        <span class="ex-eg-bs-body">
          <span class="ex-eg-bn" id="branch-sel-name">${sel ? tName(sel.name, lang) : S.branch}</span>
          <span class="ex-eg-ba" id="branch-sel-addr">${sel ? tName(sel.address, lang) : ''}</span>
        </span>
        <span class="ex-eg-bs-caret">${ICONS.back}</span>
      </button>
    `;
  }

  /* القائمة العائمة نفسها */
  /* قائمة عائمة عامة (بتتستخدم للفروع والمحافظات):
     items = [{ id, name, sub, icon }] — name/sub نصوص مهرَّبة جاهزة للعرض */
  function openSheet({ title, items, selectedId, icon, searchPlaceholder, emptyText, onPick }) {
    const sheetEl = document.createElement('div');
    sheetEl.className = 'ex-eg-branch-sheet-overlay';
    const showSearch = items.length > 5;
    sheetEl.innerHTML = `
      <div class="ex-eg-branch-sheet" role="listbox">
        <div class="ex-eg-bs-head">
          <b>${title}</b>
          <button type="button" class="ex-eg-icon-btn ex-eg-ghost" data-close>${ICONS.close}</button>
        </div>
        ${showSearch ? `<div class="ex-eg-bs-search">${ICONS.search}<input type="search" id="sheet-search" placeholder="${esc(searchPlaceholder || '')}" autocomplete="off"></div>` : ''}
        <div class="ex-eg-bs-list" id="sheet-list"></div>
      </div>`;
    document.body.appendChild(sheetEl);
    requestAnimationFrame(() => sheetEl.classList.add('ex-eg-show'));

    const close = () => { sheetEl.classList.remove('ex-eg-show'); setTimeout(() => sheetEl.remove(), 260); };
    sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) close(); });
    sheetEl.querySelector('[data-close]').addEventListener('click', close);

    const listEl = sheetEl.querySelector('#sheet-list');
    const paint = (q = '') => {
      const needle = q.trim().toLowerCase();
      const shown = needle ? items.filter(it => `${it.plain || ''}`.toLowerCase().includes(needle)) : items;
      listEl.innerHTML = shown.length ? shown.map(it => `
        <button type="button" class="ex-eg-bs-item ${it.id === selectedId ? 'ex-eg-active' : ''}" data-pick="${esc(it.id)}" role="option" aria-selected="${it.id === selectedId}">
          <span class="ex-eg-bic">${it.icon || icon}</span>
          <span class="ex-eg-bs-body">
            <span class="ex-eg-bn">${it.name}</span>
            ${it.sub ? `<span class="ex-eg-ba">${it.sub}</span>` : ''}
          </span>
          <span class="ex-eg-bs-check">${ICONS.check}</span>
        </button>`).join('')
        : `<div class="ex-eg-bs-empty">${emptyText || ''}</div>`;
      listEl.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
        const it = items.find(x => x.id === btn.dataset.pick);
        close();
        if (it) onPick(it);
      }));
    };
    paint();

    const search = sheetEl.querySelector('#sheet-search');
    if (search) { search.addEventListener('input', () => paint(search.value)); setTimeout(() => search.focus(), 260); }
  }

  function openBranchSheet(list = branches) {
    openSheet({
      title: S.branch,
      icon: ICONS.storefront,
      selectedId: branchId,
      searchPlaceholder: lang === 'ar' ? 'دوّر على فرع...' : 'Search branches...',
      emptyText: lang === 'ar' ? 'مفيش فرع بالاسم ده' : 'No branch matches',
      items: list.map(b => ({ id: b.id, name: tName(b.name, lang), sub: tName(b.address, lang), plain: `${tNameRaw(b.name, lang)} ${tNameRaw(b.address, lang)}` })),
      onPick: (it) => {
        branchId = it.id;
        const nameEl = overlay.querySelector('#branch-sel-name');
        const addrEl = overlay.querySelector('#branch-sel-addr');
        if (nameEl) nameEl.innerHTML = it.name;
        if (addrEl) addrEl.innerHTML = it.sub;
      },
    });
  }

  /* المحافظة بنفس شكل قائمة الفروع */
  function govLabel(g) { return lang === 'ar' ? g.ar : g.en; }
  function govFee(g) { const fee = Number((govSettings[g.id] || {}).deliveryFee || 0); return fee ? `${lang === 'ar' ? 'رسوم التوصيل' : 'Delivery fee'}: ${fmt(fee, currencyCode)}` : (lang === 'ar' ? 'توصيل مجاني' : 'Free delivery'); }
  function govPicker() {
    const g = enabledGovs.find(x => x.id === govId) || enabledGovs[0];
    return `
      <button type="button" class="ex-eg-branch-select" id="gov-select" aria-haspopup="listbox" aria-expanded="false">
        <span class="ex-eg-bic">${ICONS.truck}</span>
        <span class="ex-eg-bs-body">
          <span class="ex-eg-bn" id="gov-sel-name">${g ? esc(govLabel(g)) : esc(S.chooseGov)}</span>
          <span class="ex-eg-ba" id="gov-sel-sub">${g ? esc(govFee(g)) : ''}</span>
        </span>
        <span class="ex-eg-bs-caret">${ICONS.back}</span>
      </button>`;
  }
  function openGovSheet() {
    openSheet({
      title: S.governorate,
      icon: ICONS.truck,
      selectedId: govId,
      searchPlaceholder: lang === 'ar' ? 'دوّر على محافظة...' : 'Search governorates...',
      emptyText: lang === 'ar' ? 'مفيش محافظة بالاسم ده' : 'No governorate matches',
      items: enabledGovs.map(g => ({ id: g.id, name: esc(govLabel(g)), sub: esc(govFee(g)), plain: `${g.ar} ${g.en}` })),
      onPick: (it) => {
        govId = it.id;
        const nameEl = overlay.querySelector('#gov-sel-name');
        const subEl = overlay.querySelector('#gov-sel-sub');
        if (nameEl) nameEl.innerHTML = it.name;
        if (subEl) subEl.innerHTML = it.sub;
        // الفروع بتتغيّر حسب المحافظة
        const list = branchesForGov();
        if (!list.some(b => b.id === branchId)) branchId = list[0] ? list[0].id : null;
        paintGovBranch();
        renderSummary();
      },
    });
  }
  function wireBranchPicker(list = branches) {
    const btn = overlay.querySelector('#branch-select');
    if (btn) btn.addEventListener('click', () => openBranchSheet(list));
  }
  /* الفروع اللي بتخدم المحافظة المختارة — لو مفيش فرع متخصص بنعرض الكل */
  function branchesForGov() {
    if (!govId) return branches;
    const inGov = branches.filter(b => b.governorateId === govId);
    return inGov.length ? inGov : branches;
  }

  function renderDmFields() {
    const box = q('#dm-fields');
    if (!box) return;
    if (deliveryMethod === 'delivery') {
      box.innerHTML = `
        <label class="ex-eg-field-label">${S.governorate}</label>
        ${enabledGovs.length ? govPicker() : `<div class="ex-eg-checkout-error">${S.noGov}</div>`}
        <div id="gov-branch"></div>
        <label class="ex-eg-field-label">${S.address}</label>
        <textarea class="ex-eg-field-input" id="f-address" rows="2" required></textarea>
      `;
      paintGovBranch();
      const govBtn = q('#gov-select');
      if (govBtn) govBtn.addEventListener('click', openGovSheet);
    } else {
      box.innerHTML = branches.length ? branchPicker() : '';
      wireBranchPicker();
    }
  }

  /* الفرع اللي هيجهّز طلب التوصيل — بيظهر تحت المحافظة */
  function paintGovBranch() {
    const holder = q('#gov-branch');
    if (!holder) return;
    const list = branchesForGov();
    if (!list.length) { holder.innerHTML = ''; return; }
    if (!list.some(b => b.id === branchId)) branchId = list[0].id;
    holder.innerHTML = branchPicker(list, S.branchFrom);
    wireBranchPicker(list);
  }

  /* طرق الدفع بتتغيّر حسب نوع الطلب (جوّه/برّه) زي ما الأدمن ظابطها */
  function renderPayMethods() {
    payOptions = optionsFor(orderType);
    if (!payOptions.some(p => p.id === paymentMethod)) paymentMethod = payOptions[0].id;
    q('#pay-methods').innerHTML = payOptions.map(p => `
      <button type="button" class="ex-eg-pay-opt ${p.id === paymentMethod ? 'ex-eg-active' : ''}" data-pay="${p.id}">
        <span class="ex-eg-pay-logo">${p.icon}</span>
        <span><span>${p.label}</span><small>${p.sub}</small></span>
        <span class="ex-eg-pay-check">${ICONS.check}</span>
      </button>`).join('');
    q('#pay-methods').querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', () => {
      paymentMethod = btn.dataset.pay;
      q('#pay-methods').querySelectorAll('[data-pay]').forEach(b => b.classList.toggle('ex-eg-active', b === btn));
      renderPayDetails();
    }));
    renderPayDetails();
  }

  function renderPayDetails() {
    const opt = payOptions.find(p => p.id === paymentMethod);
    const box = q('#pay-details');
    if (!opt || opt.id === 'cod') { box.innerHTML = ''; paymentProof = null; return; }
    box.innerHTML = `
      <div class="ex-eg-pay-info-box">
        ${S.payTo} <b id="pay-to">${opt.payTo || '-'}</b>
        ${opt.payTo ? `<button type="button" class="ex-eg-copy-btn" id="copy-pay">${S.copy}</button>` : ''}
        ${opt.link ? `<br><a href="${safeUrl(opt.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);font-weight:700;">${esc(opt.link)}</a>` : ''}
      </div>
      <label class="ex-eg-field-label">${S.txRef} <span class="ex-eg-req-star" aria-hidden="true">*</span></label>
      <input class="ex-eg-field-input" id="f-txref" type="text" required inputmode="text" autocomplete="off">
      ${requireProof ? `
      <label class="ex-eg-field-label">${S.proof}</label>
      <label class="ex-eg-proof-drop" id="proof-drop">
        <input type="file" accept="image/*" id="f-proof" hidden>
        <div class="ex-eg-proof-empty" id="proof-empty">${ICONS.images}<span>${S.proofHint}</span></div>
        <img id="proof-img" alt="" hidden>
        <span class="ex-eg-proof-status" id="proof-status"></span>
      </label>` : ''}
    `;
    const copy = q('#copy-pay');
    if (copy) copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(opt.payTo); copy.textContent = S.copied; setTimeout(() => copy.textContent = S.copy, 1500); } catch (e) { /* ignore */ }
    });
    const proofInput = q('#f-proof');
    if (proofInput) {
      if (paymentProof) showProof(paymentProof);
      proofInput.addEventListener('change', async () => {
        const f = proofInput.files[0];
        if (!f) return;
        const status = q('#proof-status');
        status.textContent = S.proofWorking;
        try {
          paymentProof = await compressImage(f, { maxSide: 1000, quality: 0.7, forceJpeg: true, maxBytes: 620 * 1024 });
          showProof(paymentProof);
          status.textContent = S.proofDone;
        } catch (e) {
          paymentProof = null;
          status.textContent = S.proofFail;
        }
        proofInput.value = '';
      });
    }
  }

  function showProof(dataUrl) {
    const img = q('#proof-img'), empty = q('#proof-empty');
    if (!img) return;
    img.src = dataUrl; img.hidden = false;
    if (empty) empty.hidden = true;
  }

  renderTypeFields();
  renderPayMethods();
  renderSummary();

  overlay.querySelectorAll('.ex-eg-order-type-tabs:not(.ex-eg-sub-tabs) [data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      orderType = btn.dataset.type;
      overlay.querySelectorAll('.ex-eg-order-type-tabs:not(.ex-eg-sub-tabs) [data-type]').forEach(b => b.classList.toggle('ex-eg-active', b === btn));
      renderTypeFields();
      renderPayMethods();
      renderSummary();
    });
  });

  q('#place-order').addEventListener('click', async () => {
    const name = q('#f-name').value.trim();
    const phone = q('#f-phone').value.trim();
    const notes = q('#f-notes').value.trim();
    const table = q('#f-table');
    const addressEl = q('#f-address');
    const txRef = q('#f-txref');
    const errBox = q('#checkout-error');
    const isDelivery = orderType === 'outside' && deliveryMethod === 'delivery';

    const needsProof = paymentMethod !== 'cod' && requireProof;
    const missing = !name || !phone
      || (orderType === 'inside' && (!table || !table.value.trim()))
      || (isDelivery && (!addressEl || !addressEl.value.trim() || !govId));
    if (missing) { errBox.hidden = false; errBox.textContent = S.required; return; }
    /* رقم العملية إجباري في أي دفع غير الكاش — حتى لو العميل رفع صورة التحويل،
       عشان الأدمن يقدر يطابق التحويل على كشف حسابه من غير ما يقرا الصورة. */
    if (paymentMethod !== 'cod' && (!txRef || !txRef.value.trim())) {
      errBox.hidden = false; errBox.textContent = S.refRequired;
      if (txRef) { txRef.focus(); txRef.classList.add('ex-eg-field-error'); }
      return;
    }
    if (needsProof && !paymentProof) { errBox.hidden = false; errBox.textContent = S.proofRequired; return; }
    errBox.hidden = true;

    const btn = q('#place-order');
    btn.disabled = true; btn.textContent = S.placing;

    const branch = branches.find(b => b.id === branchId) || null;
    const gov = EGYPT_GOVERNORATES.find(g => g.id === govId) || null;
    const fee = deliveryFee();
    const order = {
      items: items.map(i => ({ key: i.key, productId: i.productId || null, name: i.name, variantName: i.variantName || null, price: i.price, qty: i.qty })),
      subtotal: cartTotal(),
      deliveryFee: fee,
      total: cartTotal() + fee,
      currencyCode,
      orderType,
      deliveryMethod: orderType === 'outside' ? deliveryMethod : null,
      tableNumber: orderType === 'inside' ? table.value.trim() : null,
      branchId: branchId || null,
      branchName: branch ? tNameRaw(branch.name, 'ar') : null,
      governorateId: isDelivery ? govId : null,
      governorateName: isDelivery && gov ? gov.ar : null,
      address: isDelivery ? addressEl.value.trim() : null,
      customerName: name,
      customerPhone: phone,
      notes: notes || null,
      paymentMethod,
      paymentRef: paymentMethod !== 'cod' && txRef ? txRef.value.trim() : null,
      hasProof: !!(paymentMethod !== 'cod' && paymentProof),
      status: 'new',
      statusHistory: { new: Date.now() },
      createdAt: Date.now(),
      lang,
      subscriberId: localStorage.getItem('nb_subscriber_id') || null,
    };

    try {
      const orderId = await submitOrder(order, paymentProof);
      clearCart();
      rememberOrder(orderId, { createdAt: order.createdAt, total: order.total, currencyCode, status: 'new' });
      overlay.remove();
      showSuccess(orderId, ctx);
      document.dispatchEvent(new CustomEvent('order-placed', { detail: { orderId } }));
    } catch (err) {
      errBox.hidden = false;
      // مانوريش رسايل فايربيز الخام للعميل
      console.warn('order failed:', err);
      errBox.textContent = S.orderFailed;
      btn.disabled = false; btn.textContent = S.submit;
    }
  });
}

/* ---------------- success + tracking ---------------- */
function showSuccess(orderId, ctx) {
  const S = STR[ctx.lang] || STR.ar;
  const overlay = sheet(`
    <div class="ex-eg-order-success">
      <div class="ex-eg-order-success-icon">${ICONS.check}</div>
      <div class="ex-eg-order-success-title">${S.success}</div>
      <div class="ex-eg-track-code">${S.orderNo} ${shortId(orderId)}</div>
      <div class="ex-eg-order-success-sub">${S.successSub}</div>
      <button class="ex-eg-checkout-btn" id="track-now">${ICONS.receipt} ${S.track}</button>
      <button class="ex-eg-checkout-btn ex-eg-secondary" id="close-success">${S.continueShopping}</button>
    </div>
  `);
  overlay.querySelector('#close-success').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#track-now').addEventListener('click', () => { overlay.remove(); openOrderTracking(orderId, ctx); });
  requestNotificationPermission();
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return Promise.resolve('unsupported');
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Promise.resolve(Notification.permission);
  return Notification.requestPermission();
}

export function openOrderTracking(orderId, ctx) {
  const S = STR[ctx.lang] || STR.ar;
  const lang = ctx.lang;
  const steps = [
    { key: 'new', label: S.stepNew },
    { key: 'preparing', label: S.stepPreparing },
    { key: 'ready', label: S.stepReady },
    { key: 'completed', label: S.stepCompleted },
  ];
  const overlay = sheet(`
    <div class="ex-eg-sheet-title">${S.track} <span class="ex-eg-track-code" style="font-size:12px;padding:4px 10px;">${shortId(orderId)}</span><button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
    <div class="ex-eg-order-success" style="padding-top:8px;">
      <div class="ex-eg-track-steps" id="track-steps"></div>
      <div class="ex-eg-notif-hint" id="notif-hint" hidden>${ICONS.bell}<span>${S.notifHint}</span><button id="enable-notif">${S.enableNotif}</button></div>
      <div id="track-items" style="width:100%"></div>
    </div>
  `);
  const stepsEl = overlay.querySelector('#track-steps');
  const hint = overlay.querySelector('#notif-hint');
  // مايظهرش غير لو الإشعارات مفعّلة من لوحة التحكم
  const notifOn = !(ctx.settings && ctx.settings.features && ctx.settings.features.notifications === false);
  if (notifOn && 'Notification' in window && Notification.permission === 'default') hint.hidden = false;
  overlay.querySelector('#enable-notif').addEventListener('click', async () => {
    const r = await requestNotificationPermission();
    if (r === 'granted') { hint.innerHTML = `${ICONS.bell}<span>${S.notifOn}</span>`; }
  });

  function paint(order) {
    const status = order.status || 'new';
    const order_i = ['new', 'preparing', 'ready', 'completed'].indexOf(status);
    const hist = order.statusHistory || {};
    const fmtT = (ts) => ts ? new Date(ts).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    if (status === 'cancelled') {
      stepsEl.innerHTML = `<div class="ex-eg-track-step cancelled ex-eg-current"><span class="ex-eg-ts-dot">${ICONS.close}</span><div><div class="ex-eg-ts-label">${S.stepCancelled}</div><div class="ex-eg-ts-sub">${fmtT(hist.cancelled)}</div></div></div>`;
    } else {
      stepsEl.innerHTML = steps.map((s, i) => `
        <div class="ex-eg-track-step ${i < order_i ? 'ex-eg-done' : ''} ${i === order_i ? 'ex-eg-current' : ''}">
          <span class="ex-eg-ts-dot">${i <= order_i ? ICONS.check : ''}</span>
          <div><div class="ex-eg-ts-label">${s.label}</div><div class="ex-eg-ts-sub">${fmtT(hist[s.key])}</div></div>
        </div>
      `).join('');
    }
    overlay.querySelector('#track-items').innerHTML = `
      <div class="ex-eg-cart-items" style="padding:0;max-height:none;">
        ${(order.items || []).map(i => `<div class="ex-eg-summary-row" style="padding:4px 0;"><span>${tName(i.name, lang)}${i.variantName ? ` (${tName(i.variantName, lang)})` : ''} × ${i.qty}</span><b>${fmt(i.price * i.qty, order.currencyCode)}</b></div>`).join('')}
      </div>
      <div class="ex-eg-cart-total-row" style="padding:12px 0 0;"><span>${S.total}</span><span>${fmt(order.total, order.currencyCode)}</span></div>
    `;
  }

  const unsub = onValue(ref(db, `orders/${orderId}`), (snap) => {
    if (!snap.exists()) return;
    paint(snap.val());
  }, () => { stepsEl.innerHTML = `<div class="ex-eg-empty-state">—</div>`; });
  const obs = new MutationObserver(() => { if (!document.body.contains(overlay)) { unsub(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
}

export function openMyOrders(ctx) {
  const S = STR[ctx.lang] || STR.ar;
  const lang = ctx.lang;
  const list = getMyOrders();
  const labels = STATUS_LABELS[lang] || STATUS_LABELS.ar;
  const overlay = sheet(`
    <div class="ex-eg-sheet-title">${S.myOrders}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
    ${list.length ? `<div class="ex-eg-orders-list">${list.map(o => `
      <button class="ex-eg-order-mini" data-id="${o.id}">
        <span><div class="ex-eg-om-id">#${shortId(o.id)}</div><div class="ex-eg-om-sub">${new Date(o.createdAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })} • ${fmt(o.total, o.currencyCode)}</div></span>
        <span class="ex-eg-status-pill ${o.status || 'new'}">${labels[o.status || 'new']}</span>
      </button>
    `).join('')}</div>` : `<div class="ex-eg-empty-state">${S.noOrders}</div>`}
  `);
  overlay.querySelectorAll('.ex-eg-order-mini').forEach(b => b.addEventListener('click', () => { overlay.remove(); openOrderTracking(b.dataset.id, ctx); }));
}

/* Keeps this device's recent orders in sync and fires a browser notification
   when the bakery starts preparing / finishes an order. */
const watched = new Set();
export function watchMyOrders(ctx) {
  const S = STR[ctx.lang] || STR.ar;
  getMyOrders().forEach(o => {
    if (watched.has(o.id)) return;
    watched.add(o.id);
    if (o.status === 'completed' || o.status === 'cancelled') return;
    let last = o.status || 'new';
    onValue(ref(db, `orders/${o.id}/status`), (snap) => {
      const status = snap.val();
      if (!status) return;
      const list = getMyOrders();
      const it = list.find(x => x.id === o.id);
      if (it) { it.status = status; localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(list)); }
      if (status !== last) {
        last = status;
        if (status === 'preparing') notify(S.prepNotifTitle, `${S.prepNotifBody} ${shortId(o.id)}`, ctx);
        if (status === 'ready') notify(S.readyNotifTitle, `${S.prepNotifBody} ${shortId(o.id)}`, ctx);
      }
    }, () => {});
  });
}
document.addEventListener('order-placed', () => { /* new order gets watched on next watchMyOrders call */ });

function notify(title, body, ctx) {
  if (window.__sfToast) window.__sfToast(`${title} — ${body}`, ICONS.bell);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: ctx.logo || undefined, tag: body }); } catch (e) { /* ignore */ }
  }
  try { navigator.vibrate && navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ }
}

/* ---------------- persistence ---------------- */
/* صورة التحويل بتتخزن في عقدة لوحدها (orderProofs) مش جوه الطلب:
   الطلب نفسه مقروء برقمه عشان العميل يتابعه، والصورة دي بيانات بنكية
   حساسة فمقروءة للأدمن بس. وكمان بتخفّف حجم قائمة الطلبات في اللوحة. */
export async function submitOrder(order, paymentProof) {
  const orderRef = push(ref(db, 'orders'));
  const orderId = orderRef.key;

  /* الصورة بتتكتب **قبل** الطلب، وعلامة hasProof بتتسجّل حسب اللي حصل فعلاً.
     قبل كده الطلب كان بيتسجّل بـ hasProof:true حتى لو الصورة فشلت، فالأدمن
     يشوف "سكرين التحويل مرفق" ومفيش صورة. */
  let proofSaved = false;
  if (paymentProof && String(paymentProof).startsWith('data:image/')) {
    try { await set(ref(db, `orderProofs/${orderId}`), paymentProof); proofSaved = true; }
    catch (e) { proofSaved = false; }
  }

  await set(orderRef, Object.assign({}, order, { hasProof: proofSaved }));
  return orderId;
}
