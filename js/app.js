import { ICONS } from './icons.js';
import { addToCart, cartCount, openCartDrawer, openMyOrders, getMyOrders, watchMyOrders, syncCartPrices } from './cart.js';
import { db, ref, push, set as fbSet, onValue, loadMenuFromFirebase, loadPublicSettings, ensureGuest } from './firebase-config.js';
import { activeDiscount, discountedPrice, discountBadge, fmtDateShort } from './pricing.js';
import { fitStyle, toDirectImageUrl } from './imageUtils.js';
import { esc, safeUrl, safeTel } from './escape.js';
import { DEFAULT_FEATURES, DEFAULT_FEEDBACK_FORM, EGYPT_GOVERNORATES } from './defaults.js';
import { imgSrc, wireAssets, preloadAssets } from './assets.js';
import { isSubscribed, startFeed, onFeedChange, getUnreadCount, openInbox, subscribeCardHtml, wireSubscribeCard, setupPwa, refreshPushToken } from './notify.js';
import { openOrderTracking } from './cart.js';
import { setupCookieConsent, openCookiePolicy } from './cookies.js';
import { loadAllRatings, watchRatings, myRating, rateProduct } from './ratings.js';

(function () {
  'use strict';
  let DATA = { name: 'منوعات عباد الرحمان', categories: [], currencyCode: 'EGP', fallbackProductImage: 'assets/logo.png?v=4' };
  let SETTINGS = { branches: [], payments: null, governorates: null };
  let FIRST_PRODUCT_ID = null;
  let RATINGS = {};   // { [productId]: { avg, count } }

  const state = {
    lang: localStorage.getItem('etoile_lang') || 'ar',
    page: 'home', // home | menu
    activeCat: null,
    menuQuery: '',
    menuLoading: true,
    visibleCategoryCount: 1,
    menuBatchLoading: false,
    tapHintDismissed: localStorage.getItem('etoile_tap_hint_dismissed') === '1',
  };

  function applyData(d) {
    /* طبقتي اللوجو (العربة/النص) ملفات ثابتة في الموقع مش في القاعدة */
    if (d) DATA = Object.assign({ currencyCode: 'EGP', fallbackProductImage: 'assets/logo.png?v=4', logoCart: 'assets/logo-cart.png?v=1', logoText: 'assets/logo-text.png?v=1' }, d);
    /* تطبيع الأقسام:
       - قسم من غير id بيكسر التبويبات والقائمة ⇒ نديله رقم ثابت حسب ترتيبه.
       - فايربيز بيشيل المصفوفات الفاضية، فقسم لسه مفيهوش منتجات بيرجع من
         غير `products` خالص — وده كان بيرمي خطأ ويسيب الصفحة فاضية. */
    if (!Array.isArray(DATA.categories)) DATA.categories = [];
    DATA.categories = DATA.categories.filter(Boolean);
    DATA.categories.forEach((c, i) => {
      if (c.id == null) c.id = 900000 + i;
      if (!Array.isArray(c.products)) c.products = [];
      c.products = c.products.filter(Boolean);
    });
    const root = document.documentElement.style;
    root.setProperty('--primary', DATA.primaryColor || '#0A3A7D');
    root.setProperty('--bg', DATA.backgroundColor || '#ffffff');
    root.setProperty('--text', DATA.textColor || '#0F2740');
    root.setProperty('--btn-text', DATA.buttonTextColor || '#ffffff');
    if (DATA.surfaceColor) root.setProperty('--surface', DATA.surfaceColor);
    root.setProperty('--primary-soft', mix(DATA.primaryColor || '#0A3A7D', 0.1));
    root.setProperty('--primary-dark', shade(DATA.primaryColor || '#0A3A7D', -0.12));
    document.title = `${DATA.name || 'منوعات عباد الرحمان'}`;
    state.activeCat = DATA.categories[0] ? DATA.categories[0].id : null;
    state.visibleCategoryCount = 1;
    FIRST_PRODUCT_ID = DATA.categories[0]?.products?.[0]?.id ?? null;
    updateSearchMetadata();
  }

  function updateSearchMetadata() {
    const storeName = tPlain(DATA.name, DATA.name) || 'منوعات عباد الرحمان';
    const description = `${storeName} - تصفح المنتجات المتاحة واطلب بسهولة.`;
    document.title = storeName;
    const descriptionTag = document.querySelector('meta[name="description"]');
    if (descriptionTag) descriptionTag.setAttribute('content', description);
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: storeName,
      url: 'https://monawaat.web.app/',
      description,
      hasPart: (DATA.categories || []).flatMap(category => (category.products || []).map(product => ({
        '@type': 'Product',
        name: tPlain(product.name, 'منتج'),
        image: product.image || DATA.logo || 'https://monawaat.web.app/assets/logo.png',
        offers: (product.variants || []).map(variant => ({
          '@type': 'Offer', price: variant.price, priceCurrency: DATA.currencyCode || 'EGP', availability: 'https://schema.org/InStock'
        }))
      })))
    };
    let jsonLd = document.getElementById('store-structured-data');
    if (!jsonLd) { jsonLd = document.createElement('script'); jsonLd.id = 'store-structured-data'; jsonLd.type = 'application/ld+json'; document.head.appendChild(jsonLd); }
    jsonLd.textContent = JSON.stringify(structuredData);
  }

  // tiny colour helpers so the whole palette follows the admin-chosen primary colour
  function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(hex, amount) { const [r, g, b] = hexToRgb(hex); return `rgb(${Math.round(255 - (255 - r) * amount)},${Math.round(255 - (255 - g) * amount)},${Math.round(255 - (255 - b) * amount)})`; }
  function shade(hex, amount) { const [r, g, b] = hexToRgb(hex); const f = 1 + amount; return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`; }

  function dismissTapHint() {
    if (state.tapHintDismissed) return;
    state.tapHintDismissed = true;
    localStorage.setItem('etoile_tap_hint_dismissed', '1');
    document.querySelectorAll('.ex-eg-tap-details').forEach(el => el.remove());
  }

  /* النص الخام زي ما هو — للعنوان والميتا (مش HTML) */
  function tPlain(field, fallback) {
    if (!field) return fallback || '';
    if (typeof field === 'string') return field;
    return field[state.lang] || field.ar || field.en || fallback || '';
  }
  /* النص المهرَّب — ده اللي بيتحط جوه HTML. محتوى المنيو بيكتبه الأدمن،
     ولو فيه كود بيتعرض كنص عادي مش بيشتغل. */
  function t(field, fallback) { return esc(tPlain(field, fallback)); }

  function fmtPrice(n) {
    if (n == null) return '';
    const isInt = Math.round(n) === n;
    return isInt ? String(Math.round(n)) : n.toFixed(DATA.currencyFractionDigits || 2);
  }

  function priceLabel(product) {
    const variants = product.variants || [];
    if (!variants.length) return '';
    const d = activeDiscount(product);
    const cur = DATA.currencyCode;
    const range = (arr) => { const min = Math.min(...arr), max = Math.max(...arr); return min === max ? `${cur} ${fmtPrice(min)}` : `${cur} ${fmtPrice(min)} - ${cur} ${fmtPrice(max)}`; };
    const base = variants.map(v => v.price);
    if (!d) return range(base);
    return `<span class="ex-eg-old">${range(base)}</span>${range(base.map(p => discountedPrice(p, d)))}`;
  }
  function features() { return SETTINGS.features || DEFAULT_FEATURES; }

  function catId(id) { return `cat-${id}`; }

  function setLang(lang) {
    state.lang = lang;
    localStorage.setItem('etoile_lang', lang);
    render();
  }

  function cartCtx() {
    return { lang: state.lang, currencyCode: DATA.currencyCode, settings: SETTINGS, storeName: tPlain(DATA.name, DATA.name), logo: DATA.logo };
  }

  // ---------------- storefront toast ----------------
  let toastTimer = null;
  function toast(msg, icon = ICONS.check) {
    let el = document.querySelector('.ex-eg-sf-toast');
    if (!el) { el = document.createElement('div'); el.className = 'ex-eg-sf-toast'; document.body.appendChild(el); }
    el.innerHTML = `${icon}<span>${msg}</span>`;
    requestAnimationFrame(() => el.classList.add('ex-eg-show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('ex-eg-show'), 2600);
  }
  window.__sfToast = toast;

  // ---------------- rendering ----------------
  const app = document.getElementById('app');

  /* بديل onload/onerror اللي كانوا مكتوبين جوه الـ HTML — شيلناهم عشان
     نقدر نفعّل Content-Security-Policy صارمة تمنع أي كود مدسوس. */
  /* بعض المتصفحات بتوقف التشغيل التلقائي حتى لو الفيديو صامت —
     بنحاول نشغّله، ولو رفض بنستنى أول لمسة من المستخدم. */
  function wireBackgroundVideo(root) {
    const v = root.querySelector('.ex-eg-home-video');
    if (!v || v.dataset.wired) return;
    v.dataset.wired = '1';
    v.muted = true;
    const tryPlay = () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    const onFirstTouch = () => { tryPlay(); document.removeEventListener('pointerdown', onFirstTouch); document.removeEventListener('touchstart', onFirstTouch); };
    document.addEventListener('pointerdown', onFirstTouch, { once: true, passive: true });
    document.addEventListener('touchstart', onFirstTouch, { once: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tryPlay(); });
  }

  function wireImageLoaders(root) {
    root.querySelectorAll('img[data-imgload]').forEach(img => {
      if (img.dataset.imgloadWired) return;
      img.dataset.imgloadWired = '1';
      const done = () => { if (img.parentElement) img.parentElement.classList.add('ex-eg-img-loaded'); };
      if (img.complete) { done(); return; }
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
  }

  let lastHtml = '';
  let lastPage = '';

  function render() {
    document.documentElement.lang = state.lang;
    document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';

    const html = state.page === 'home' ? renderHome() : renderMenu();

    /* render() بتتنادى كذا مرة وقت التحميل (البيانات، التقييمات، المزايا،
       تحديثات المنيو اللحظية). لو النتيجة هي هي مافيش داعي نعيد بناء الصفحة —
       ده كان بيعمل رعشة واضحة لأن كل بناء بيعيد تشغيل أنيميشن الدخول. */
    if (html === lastHtml && app.firstChild) return;
    lastHtml = html;

    app.innerHTML = html;
    /* الأنيميشن بس لما الصفحة نفسها تتغيّر (رئيسية ↔ منيو)،
       مش مع كل تحديث بيانات جاي من الخلفية. */
    if (state.page !== lastPage) {
      lastPage = state.page;
      app.classList.remove('ex-eg-page-enter'); void app.offsetWidth; app.classList.add('ex-eg-page-enter');
    }
    bindGlobalEvents();
    wireImageLoaders(app);
    wireAssets(app);
    wireBackgroundVideo(app);
    if (state.page === 'menu') {
      setupCategoryObserver();
      setupRevealObserver();
      setupMenuBatchObserver();
      startCarousel();
    }
  }

  function renderHome() {
    const T = state.lang === 'ar'
      ? { menu: 'المنيو الرئيسي', feedback: 'رأيك مهم لينا! شاركنا تجربتك 😊', orders: 'طلباتي', branches: 'فروعنا' }
      : { menu: 'Main Menu', feedback: 'Tell us about your experience! 😊', orders: 'My orders', branches: 'Our branches' };
    const hasBranches = (SETTINGS.branches || []).some(b => b && b.name && b.enabled !== false);
    const hasOrders = getMyOrders().length > 0;
    /* خلفية الصفحة الرئيسية بتتحدد من الداش بورد. لو الخلفية نفسها فيها اللوجو
       بنخفي لوجو الصفحة عشان ميتكررش. */
    const bgRaw = DATA.homeBackground || DATA.homeBg || '';
    const bg = safeUrl(toDirectImageUrl(bgRaw));
    /* الخلفية ممكن تبقى فيديو أو صورة:
       - فيديو (mp4/webm) بيتعرض كـ <video> بيلفّ لوحده.
       - صورة عادية بتتعرض كطبقة ورا المحتوى، وبتتحرك حركة بطيئة
         (تقريب وانزلاق) فتبان حيّة من غير ما تحمّل الجهاز.
       والاتنين بيحترموا إعداد "تقليل الحركة" في الجهاز. */
    const isVideoBg = /\.(mp4|webm|mov)(\?|$)/i.test(bgRaw);
    const poster = safeUrl(DATA.homeBackgroundPoster || '');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const showVideo = isVideoBg && !reduceMotion;
    const animateImage = !isVideoBg && !!bg && DATA.homeBgAnimate !== false && !reduceMotion;
    const stillBg = isVideoBg ? poster : bg;
    const bgHasLogo = bg && DATA.homeBgHasLogo !== false;
    /* اللوجو الرسمي بيتعرض طبقتين: العربة بتدخل من جنب الشاشة وتستقر فوق النص.
       بيشتغل بس مع لوجو الموقع الافتراضي — لو المالك غيّر اللوجو من اللوحة بنرجع لصورة واحدة. */
    const splitLogo = !!(DATA.logoCart && DATA.logoText && (!DATA.logo || /^assets\/logo\.png(\?|$)/.test(String(DATA.logo))));
    return `
      <div class="ex-eg-home ${bg ? 'ex-eg-has-bg' : ''} ${animateImage ? 'ex-eg-bg-animated' : ''}" ${stillBg && !animateImage ? `style="background-image:url('${stillBg}')"` : ''}>
        ${showVideo ? `<video class="ex-eg-home-video" autoplay muted loop playsinline preload="auto" poster="${poster}" aria-hidden="true" tabindex="-1"><source src="${bg}" type="video/${/\.webm/i.test(bgRaw) ? 'webm' : 'mp4'}"></video>` : ''}
        ${animateImage ? `
        <div class="ex-eg-home-bg" aria-hidden="true">
          <div class="ex-eg-bg-base" style="background-image:url('${safeUrl(DATA.homeBackgroundBase || 'assets/home-bg-base.webp')}')"></div>
          <div class="ex-eg-bg-left" style="background-image:url('${bg}')"></div>
          <div class="ex-eg-bg-right" style="background-image:url('${bg}')"></div>
        </div>` : ''}
        <div class="ex-eg-lang-switch">
          <button data-lang="ar" class="${state.lang === 'ar' ? 'ex-eg-active' : ''}">AR</button>
          <button data-lang="en" class="${state.lang === 'en' ? 'ex-eg-active' : ''}">EN</button>
        </div>
        ${bgHasLogo ? '' : `
        <div class="ex-eg-logo-wrap">
            ${splitLogo ? `
            <div class="ex-eg-logo-stack" role="img" aria-label="${t(DATA.name, DATA.name)}">
              <img class="ex-eg-logo-text" src="${safeUrl(DATA.logoText)}" alt="" decoding="async">
              <img class="ex-eg-logo-cart" src="${safeUrl(DATA.logoCart)}" alt="" decoding="async">
            </div>` : `
            <img ${imgSrc(DATA.logo, 'assets/logo.png?v=4')} alt="${t(DATA.name, DATA.name)}">`}
          ${DATA.isRestaurantNameDisplayedOnHomePage ? `<div class="ex-eg-restaurant-name">${t(DATA.name, DATA.name)}</div>` : ''}
        </div>`}
        <button class="ex-eg-main-menu-btn ex-eg-pressable" id="go-menu">${T.menu}</button>
        ${(hasOrders || hasBranches) ? `
        <div class="ex-eg-home-row">
          ${hasOrders ? `<button class="ex-eg-feedback-link ex-eg-pressable" id="open-my-orders-home">${ICONS.receipt} ${T.orders}</button>` : ''}
          ${hasBranches ? `<button class="ex-eg-feedback-link ex-eg-pressable" id="open-branches-home">${ICONS.storefront} ${T.branches}</button>` : ''}
        </div>` : ''}
        <button class="ex-eg-feedback-link ex-eg-pressable" id="open-feedback-home">${ICONS.chat} ${T.feedback}</button>
        ${(DATA.instagram || DATA.tiktok || DATA.facebook) ? `
          <div class="ex-eg-social-row">
            ${DATA.instagram ? `<a href="${DATA.instagram}" target="_blank" rel="nofollow">${ICONS.instagram}</a>` : ''}
            ${DATA.tiktok ? `<a href="${DATA.tiktok}" target="_blank" rel="nofollow">${ICONS.tiktok}</a>` : ''}
            ${DATA.facebook ? `<a href="${DATA.facebook}" target="_blank" rel="nofollow">${ICONS.facebook}</a>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function bannerList() {
    const list = Array.isArray(DATA.banners) && DATA.banners.length ? DATA.banners.filter(b => b && b.url) : (DATA.banner ? [{ url: DATA.banner, id: 'b1' }] : []);
    return list;
  }

  function renderMenu() {
    if (!DATA.categories || !DATA.categories.length) return renderEmptyMenu();
    const note = t(DATA.menuNote, '');
    const query = state.menuQuery.trim().toLowerCase();
    const categories = DATA.categories.map(c => ({
      ...c,
      products: (c.products || []).filter(p => {
        if (!query) return true;
        const name = `${p.name?.ar || ''} ${p.name?.en || ''}`.toLowerCase();
        return name.includes(query);
      }),
    }));
    const shownCategories = query ? categories : categories.slice(0, state.visibleCategoryCount);
    // كل الأقسام بتظهر كتبويبات من الأول — الأقسام نفسها هي اللي بتتحمّل على دفعات
    const tabs = categories.map(c => `
      <button class="ex-eg-cat-tab ${c.id === state.activeCat ? 'ex-eg-active' : ''}" data-cat="${c.id}">${t(c.name)}</button>
    `).join('');

    const sections = shownCategories.map(c => `
      <section class="ex-eg-category-section" id="${catId(c.id)}" data-cat-section="${c.id}">
        <h2>${t(c.name)}</h2>
        ${t(c.note) ? `<div class="ex-eg-cat-note">${t(c.note)}</div>` : ''}
        <div class="ex-eg-product-grid">
          ${(c.products || []).length ? c.products.map((p, i) => productCard(p, i)).join('') : `<div class="ex-eg-empty-state">${query ? (state.lang === 'ar' ? 'لا توجد نتائج' : 'No results') : (state.lang === 'ar' ? 'لا توجد أصناف بعد' : 'No items yet')}</div>`}
        </div>
      </section>
    `).join('');

    const banners = bannerList();
    const hasOrders = getMyOrders().length > 0;

    return `
      <div id="top-sentinel" aria-hidden="true"></div>
      <div class="ex-eg-topbar">
        <button class="ex-eg-icon-btn" id="go-home">${ICONS.back}</button>
        <div class="ex-eg-topbar-actions">
          ${hasOrders ? `<button class="ex-eg-icon-btn ex-eg-ghost" id="open-my-orders" title="${state.lang === 'ar' ? 'طلباتي' : 'My orders'}">${ICONS.receipt}</button>` : ''}
          <button class="ex-eg-icon-btn ex-eg-ghost" id="open-info">${ICONS.info}</button>
          <button class="ex-eg-icon-btn ex-eg-ghost" id="open-search" title="${state.lang === 'ar' ? 'بحث' : 'Search'}">${ICONS.search}</button>
          <button class="ex-eg-icon-btn ex-eg-cart-btn" id="open-cart">${ICONS.cart}<span class="ex-eg-cart-badge">${cartCount() || ''}</span></button>
        </div>
      </div>
      ${banners.length ? `
        <div class="ex-eg-banner-carousel" id="banner-carousel" data-anim="${DATA.bannerAnimation || 'fade'}">
          ${banners.map((b, i) => `<div class="ex-eg-banner-slide ${i === 0 ? 'ex-eg-active' : ''}" data-i="${i}"><img ${imgSrc(b.url)} alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} style="${fitStyle(b.fit)}"></div>`).join('')}
          ${banners.length > 1 ? `<div class="ex-eg-banner-dots">${banners.map((b, i) => `<button class="ex-eg-dot ${i === 0 ? 'ex-eg-active' : ''}" data-i="${i}"></button>`).join('')}</div>` : ''}
        </div>
      ` : ''}
      ${note ? `<div class="ex-eg-notes"><b>${note}</b></div>` : ''}
      <div class="ex-eg-cat-tabs-row">
        <div class="ex-eg-cat-tabs" id="cat-tabs">${tabs}</div>
        <button class="ex-eg-icon-btn ex-eg-hamburger-btn" id="open-drawer">${ICONS.menu}</button>
      </div>
      <div class="ex-eg-menu-tools" aria-label="${state.lang === 'ar' ? 'أدوات المينيو' : 'Menu tools'}">
        <input id="menu-filter" class="ex-eg-menu-filter" type="search" value="${state.menuQuery}" placeholder="${state.lang === 'ar' ? 'فلتر الأصناف...' : 'Filter items...'}" autocomplete="off">
      </div>
      <div id="sections">${sections}</div>
      <button class="ex-eg-to-top" id="to-top" aria-label="${state.lang === 'ar' ? 'الرجوع لأعلى' : 'Back to top'}" hidden>${ICONS.back}</button>
      ${!query && shownCategories.length < categories.length ? `<div id="menu-load-more" class="ex-eg-menu-load-more" aria-live="polite">${state.menuBatchLoading ? (state.lang === 'ar' ? 'جاري تحميل القسم التالي...' : 'Loading next section...') : (state.lang === 'ar' ? 'انزل لعرض القسم التالي' : 'Scroll for the next section')}</div>` : ''}
    `;
  }

  /* هيكل عظمي بيتعرض لحد ما البيانات توصل من فايربيز، بدل شاشة فاضية */
  function skeletonScreen() {
    const cards = Array.from({ length: 6 }, (_, i) => `
      <div class="ex-eg-skeleton-card" style="--i:${i}">
        <div class="ex-eg-sk-img"></div>
        <div class="ex-eg-sk-line"></div>
        <div class="ex-eg-sk-line ex-eg-short"></div>
      </div>`).join('');
    return `
      <div class="ex-eg-skeleton-screen">
        <div class="ex-eg-sk-topbar">
          <div class="ex-eg-sk-dot"></div>
          <div class="ex-eg-sk-dots">
            <div class="ex-eg-sk-dot"></div><div class="ex-eg-sk-dot"></div>
            <div class="ex-eg-sk-dot"></div><div class="ex-eg-sk-dot"></div>
          </div>
        </div>
        <div class="ex-eg-sk-banner"></div>
        <div class="ex-eg-sk-tabs">
          <div class="ex-eg-sk-tab"></div><div class="ex-eg-sk-tab"></div><div class="ex-eg-sk-tab"></div>
        </div>
        <div class="ex-eg-skeleton-grid">${cards}</div>
      </div>
    `;
  }

  function renderEmptyMenu() {
    const loading = state.menuLoading;
    const T = state.lang === 'ar'
      ? { title: loading ? 'جاري تحميل المينيو...' : 'البيانات مش متاحة حالياً', sub: loading ? 'بنحمّل الأصناف، استنى لحظات' : 'اضغط تحميل البيانات وحاول تاني', load: loading ? 'جاري التحميل...' : 'تحميل البيانات' }
      : { title: loading ? 'Loading the menu...' : 'Menu data is unavailable', sub: loading ? 'Loading items, please wait a moment' : 'Press load data and try again', load: loading ? 'Loading...' : 'Load data' };
    const skeletonCards = Array.from({ length: 6 }, (_, i) => `
      <div class="ex-eg-skeleton-card" style="--i:${i}">
        <div class="ex-eg-sk-img"></div><div class="ex-eg-sk-line"></div><div class="ex-eg-sk-line ex-eg-short"></div>
      </div>`).join('');
    return `
      <div class="ex-eg-topbar">
        <button class="ex-eg-icon-btn" id="go-home">${ICONS.back}</button>
        <div class="ex-eg-topbar-actions">
          ${features().notifications ? `<button class="ex-eg-icon-btn ex-eg-ghost" id="open-inbox" style="position:relative">${ICONS.bell}<span class="ex-eg-notif-badge" id="notif-badge">${getUnreadCount() || ''}</span></button>` : ''}
          <button class="ex-eg-icon-btn ex-eg-ghost" id="toggle-lang">${ICONS.globe}</button>
          <button class="ex-eg-icon-btn ex-eg-ghost" id="open-info">${ICONS.info}</button>
        </div>
      </div>
      <div class="ex-eg-menu-empty">
        ${loading ? `
          <div class="ex-eg-menu-loading-head"><h2>${T.title}</h2><p>${T.sub}</p></div>
          <div class="ex-eg-skeleton-grid ex-eg-menu-skeleton-grid">${skeletonCards}</div>
        ` : `
          <img src="${DATA.logo || 'assets/logo.png?v=4'}" alt="">
          <h2>${T.title}</h2>
          <p>${T.sub}</p>
        `}
        ${features().notifications ? subscribeCardHtml(cartCtx()) : ''}
      </div>
    `;
  }

  // ---------------- banner carousel ----------------
  let carouselTimer = null;
  function startCarousel() {
    clearInterval(carouselTimer);
    const car = document.getElementById('banner-carousel');
    if (!car) return;
    const slides = [...car.querySelectorAll('.ex-eg-banner-slide')];
    const dots = [...car.querySelectorAll('.ex-eg-dot')];
    if (slides.length < 2) return;
    let i = 0;
    function go(n) {
      const prev = slides[i];
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => { s.classList.toggle('ex-eg-active', k === i); s.classList.remove('ex-eg-leaving'); });
      if (prev && prev !== slides[i]) { prev.classList.add('ex-eg-leaving'); setTimeout(() => prev.classList.remove('ex-eg-leaving'), 900); }
      dots.forEach((d, k) => d.classList.toggle('ex-eg-active', k === i));
    }
    dots.forEach(d => d.addEventListener('click', () => { go(Number(d.dataset.i)); restart(); }));
    let startX = null;
    car.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    car.addEventListener('touchend', e => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { go(dx < 0 ? i + 1 : i - 1); restart(); }
      startX = null;
    });
    function restart() { clearInterval(carouselTimer); carouselTimer = setInterval(() => go(i + 1), 4500); }
    restart();
  }

  /* شارة "جديد" — بتظهر قبل اسم المنتج، بتتفعّل من الداش بورد (منتج جديد) */
  /* نجوم العرض — متوسط تقييم المنتج */
  function starsHtml(avg) {
    const full = Math.round(Number(avg) || 0);
    return [1, 2, 3, 4, 5].map(n => `<span class="${n <= full ? 'ex-eg-st-on' : ''}">★</span>`).join('');
  }
  function ratingLine(p) {
    const r = RATINGS[p.id];
    if (!r || !r.count) return '';
    return `<div class="ex-eg-prating">${starsHtml(r.avg)}<b>${r.avg}</b><small>(${r.count})</small></div>`;
  }

  /* ودجت التقييم التفاعلي داخل نافذة المنتج */
  function ratingWidget(p) {
    const r = RATINGS[p.id] || { avg: 0, count: 0 };
    const T = state.lang === 'ar'
      ? { rate: 'قيّم المنتج ده', none: 'لسه مفيش تقييمات — كن أول واحد', thanks: 'شكراً لتقييمك 🧡' }
      : { rate: 'Rate this product', none: 'No ratings yet — be the first', thanks: 'Thanks for rating 🧡' };
    return `
      <div class="ex-eg-rate-box" data-rate-for="${esc(p.id)}">
        <div class="ex-eg-rate-head">
          <span class="ex-eg-rate-label">${T.rate}</span>
          <span class="ex-eg-rate-avg">${r.count ? `${starsHtml(r.avg)} <b>${r.avg}</b> <small>(${r.count})</small>` : `<small>${T.none}</small>`}</span>
        </div>
        <div class="ex-eg-rate-stars" role="radiogroup">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="ex-eg-rate-star" data-v="${n}" role="radio" aria-checked="false" aria-label="${n}">★</button>`).join('')}
        </div>
        <div class="ex-eg-rate-msg" hidden>${T.thanks}</div>
      </div>`;
  }

  function wireRatingWidget(root, p) {
    const box = root.querySelector('.ex-eg-rate-box');
    if (!box) return;
    const stars = [...box.querySelectorAll('.ex-eg-rate-star')];
    const paint = (v) => stars.forEach(s => {
      const on = Number(s.dataset.v) <= v;
      s.classList.toggle('ex-eg-on', on);
      s.setAttribute('aria-checked', String(Number(s.dataset.v) === v));
    });

    // تقييمي السابق لو موجود
    myRating(p.id).then(v => { if (v) { paint(v); box.dataset.mine = String(v); } }).catch(() => {});

    stars.forEach(star => {
      star.addEventListener('mouseenter', () => paint(Number(star.dataset.v)));
      star.addEventListener('click', async () => {
        const v = Number(star.dataset.v);
        paint(v);
        box.dataset.mine = String(v);
        const msg = box.querySelector('.ex-eg-rate-msg');
        try {
          await rateProduct(p.id, v);
          if (msg) { msg.hidden = false; }
          box.classList.add('ex-eg-rated');
        } catch (e) {
          if (msg) { msg.hidden = false; msg.textContent = state.lang === 'ar' ? 'تعذر حفظ التقييم' : 'Could not save rating'; }
        }
      });
    });
    box.addEventListener('mouseleave', () => paint(Number(box.dataset.mine) || 0));
  }

  function newTag(p) {
    if (!p || !p.isNew) return '';
    return `<span class="ex-eg-new-tag" title="${state.lang === 'ar' ? 'منتج جديد' : 'New product'}">${ICONS.verified}<span>${state.lang === 'ar' ? 'جديد' : 'NEW'}</span></span>`;
  }

  function productCard(p, index = 0) {
    const img = p.image || DATA.fallbackProductImage;
    // "جديد" بقت شارة صغيرة قبل الاسم؛ "مميز" فاضلة على الصورة زي ما هي
    const badge = p.isBestseller && !p.isNew
      ? `<span class="ex-eg-badge ex-eg-bestseller">${ICONS.star}<span>${state.lang === 'ar' ? 'مميز' : 'TOP'}</span></span>`
      : '';
    const showTapHint = DATA.isTapForDetailsEnabled && !state.tapHintDismissed && p.id === FIRST_PRODUCT_ID;
    const d = activeDiscount(p);
    return `
      <div class="ex-eg-product-card ex-eg-reveal" style="--i:${index % 10}" data-product="${p.id}">
        <div class="ex-eg-img-wrap">
          <img ${imgSrc(img)} alt="${t(p.name)}" style="${fitStyle(p.imageFit)}" loading="lazy" data-imgload>
          ${badge}
          ${showTapHint ? `<div class="ex-eg-tap-details">${ICONS.tap}<span>${state.lang === 'ar' ? 'اضغط للتفاصيل' : 'Tap for details'}</span></div>` : ''}
        </div>
        <div class="ex-eg-product-info">
          <div class="ex-eg-pname">${newTag(p)}${t(p.name)}</div>
          <div class="ex-eg-pprice">${priceLabel(p)}</div>
          ${ratingLine(p)}
        </div>
      </div>
    `;
  }

  // ---------------- overlays ----------------
  function openOverlay(html) {
    const wrap = document.createElement('div');
    wrap.className = 'ex-eg-modal-overlay';
    wrap.innerHTML = html;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    wireImageLoaders(wrap);
    wireAssets(wrap);
    return wrap;
  }

  function openProduct(p) {
    const img = p.image || DATA.fallbackProductImage;
    const variants = p.variants || [];
    const desc = t(p.description);
    const d = activeDiscount(p);
    const cur = DATA.currencyCode;
    const eff = (price) => discountedPrice(price, d);
    let variantIdx = 0;
    let qty = 1;
    const overlay = openOverlay(`
      <div class="ex-eg-modal-sheet">
        <div class="ex-eg-close-row">
          <button type="button" class="ex-eg-share-btn" id="share-product">${ICONS.share}<span>${state.lang === 'ar' ? 'مشاركة' : 'Share'}</span></button>
          <button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button>
        </div>
        <div class="ex-eg-modal-img"><img ${imgSrc(img)} alt="${t(p.name)}" style="${fitStyle(p.imageFit)}" data-imgload></div>
        <div class="ex-eg-modal-body">
          <h2>${newTag(p)}${t(p.name)}</h2>
          ${ratingWidget(p)}
          ${desc ? `<div class="ex-eg-desc">${desc}</div>` : ''}
          ${d ? `<div class="ex-eg-disc-line">${ICONS.receipt}<span>${state.lang === 'ar' ? 'خصم' : 'Discount'} ${discountBadge(d, cur)}${d.label ? ` — ${d.label}` : ''}${d.until ? ` • ${state.lang === 'ar' ? 'حتى' : 'until'} ${fmtDateShort(d.until, state.lang)}` : ''}</span></div>` : ''}
          ${variants.length > 1 ? `
            <div class="ex-eg-variant-picker">
              ${variants.map((v, i) => `
                <button type="button" class="ex-eg-variant-chip ${i === 0 ? 'ex-eg-active' : ''}" data-i="${i}">
                  ${t(v.name) ? `<span>${t(v.name)}</span>` : ''}
                  ${d ? `<span class="ex-eg-vc-old">${cur} ${fmtPrice(v.price)}</span>` : ''}
                  <b>${cur} ${fmtPrice(eff(v.price))}</b>
                </button>
              `).join('')}
            </div>
          ` : variants.length === 1 ? `
            <div class="ex-eg-variant-row ex-eg-single">
              <span class="ex-eg-price">${d ? `<span class="ex-eg-old-price">${cur} ${fmtPrice(variants[0].price)}</span>` : (variants[0].oldPrice ? `<span class="ex-eg-old-price">${cur} ${fmtPrice(variants[0].oldPrice)}</span>` : '')}${cur} ${fmtPrice(eff(variants[0].price))}</span>
            </div>
          ` : ''}
          <div class="ex-eg-add-to-cart-row">
            <div class="ex-eg-qty-stepper">
              <button type="button" class="ex-eg-qty-btn" id="qty-dec">${ICONS.minus}</button>
              <span id="qty-val">1</span>
              <button type="button" class="ex-eg-qty-btn" id="qty-inc">${ICONS.plus}</button>
            </div>
            <button type="button" class="ex-eg-add-cart-btn" id="add-cart">${ICONS.cart} ${state.lang === 'ar' ? 'أضف للعربة' : 'Add to cart'}</button>
          </div>
        </div>
      </div>
    `);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#share-product').addEventListener('click', () => shareProduct(p));
    wireRatingWidget(overlay, p);
    overlay.querySelectorAll('.ex-eg-variant-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        variantIdx = Number(chip.dataset.i);
        overlay.querySelectorAll('.ex-eg-variant-chip').forEach(c => c.classList.toggle('ex-eg-active', c === chip));
      });
    });
    const qtyVal = overlay.querySelector('#qty-val');
    overlay.querySelector('#qty-dec').addEventListener('click', () => { qty = Math.max(1, qty - 1); qtyVal.textContent = qty; });
    overlay.querySelector('#qty-inc').addEventListener('click', () => { qty = Math.min(99, qty + 1); qtyVal.textContent = qty; });
    overlay.querySelector('#add-cart').addEventListener('click', () => {
      const v = variants[variantIdx] || { price: 0, name: {} };
      addToCart({
        key: `${p.id}-${variantIdx}`,
        productId: p.id,
        name: p.name,
        variantName: variants.length > 1 ? v.name : null,
        price: eff(v.price),
        originalPrice: d ? v.price : null,
        image: img,
        qty,
      });
      overlay.remove();
      flashCartAdded();
      toast(state.lang === 'ar' ? 'اتضاف للعربة' : 'Added to cart', ICONS.cart);
    });
  }

  /* رابط مباشر للمنتج — نفس صيغة الـ deep link اللي بتفتح من الإشعارات (?product=ID) */
  function productLink(p) {
    return `${location.origin}${location.pathname}?product=${p.id}`;
  }

  /* مشاركة المنتج: Web Share API لو متاح (موبايل)، وإلا نسخ الرابط + خيار واتساب */
  async function shareProduct(p) {
    const ar = state.lang === 'ar';
    const url = productLink(p);
    const v = (p.variants || [])[0];
    const price = v ? `${DATA.currencyCode} ${fmtPrice(discountedPrice(v.price, activeDiscount(p)))}` : '';
    const text = [[t(p.name), price].filter(Boolean).join(' — '), tPlain(DATA.name, DATA.name)].filter(Boolean).join('\n');
    if (navigator.share) {
      try { await navigator.share({ title: t(p.name), text, url }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const copied = await copyText(url);
    const wa = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
    const overlay = openOverlay(`
      <div class="ex-eg-modal-sheet ex-eg-share-sheet">
        <div class="ex-eg-sheet-title">${ar ? 'مشاركة المنتج' : 'Share product'}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
        <div class="ex-eg-share-body">
          <input class="ex-eg-share-link" readonly value="${url}" dir="ltr">
          <div class="ex-eg-share-actions">
            <button type="button" class="ex-eg-share-act" id="share-copy">${ICONS.copy}<span>${copied ? (ar ? 'اتنسخ الرابط ✓' : 'Link copied ✓') : (ar ? 'نسخ الرابط' : 'Copy link')}</span></button>
            <a class="ex-eg-share-act ex-eg-share-wa" href="${wa}" target="_blank" rel="noopener">${ICONS.whatsapp}<span>${ar ? 'واتساب' : 'WhatsApp'}</span></a>
          </div>
        </div>
      </div>
    `);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#share-copy').addEventListener('click', async () => {
      const ok = await copyText(url);
      overlay.querySelector('#share-copy span').textContent = ok ? (ar ? 'اتنسخ الرابط ✓' : 'Link copied ✓') : (ar ? 'انسخه يدوياً من الخانة' : 'Copy it manually');
      if (ok) toast(ar ? 'اتنسخ رابط المنتج' : 'Product link copied');
    });
    const inp = overlay.querySelector('.ex-eg-share-link');
    inp.addEventListener('focus', () => inp.select());
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch (e2) { return false; }
    }
  }

  function flashCartAdded() {
    const btn = document.getElementById('open-cart');
    if (!btn) return;
    btn.classList.add('ex-eg-bump');
    setTimeout(() => btn.classList.remove('ex-eg-bump'), 450);
  }

  function openInfo() {
    const T = state.lang === 'ar'
      ? { title: 'معلومات المحل', address: 'العنوان', hours: 'مواعيد العمل', phone: 'التليفون', site: 'الموقع الإلكتروني', branches: 'فروعنا', map: 'الخريطة' }
      : { title: 'About us', address: 'Address', hours: 'Opening Hours', phone: 'Phone', site: 'Website', branches: 'Our branches', map: 'Map' };
    const branches = SETTINGS.branches || [];
    const overlay = openOverlay(`
      <div class="ex-eg-modal-sheet">
        <div class="ex-eg-sheet-title">${T.title}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
        <div class="ex-eg-info-list">
          ${DATA.address ? `<div class="ex-eg-info-row"><span class="ex-eg-ic">${ICONS.pin}</span><div><b>${T.address}</b><br>${DATA.address}</div></div>` : ''}
          ${DATA.openingHours ? `<div class="ex-eg-info-row"><span class="ex-eg-ic">${ICONS.clock}</span><div><b>${T.hours}</b><br>${DATA.openingHours.replace(/\n/g, '<br>')}</div></div>` : ''}
          ${DATA.contactNumber ? `<div class="ex-eg-info-row"><span class="ex-eg-ic">${ICONS.phone}</span><div><b>${T.phone}</b><br><a href="tel:${DATA.contactNumber}">${DATA.contactNumber}</a></div></div>` : ''}
          ${DATA.website ? `<div class="ex-eg-info-row"><span class="ex-eg-ic">${ICONS.web}</span><div><b>${T.site}</b><br><a href="${DATA.website}" target="_blank" rel="noopener">${DATA.website}</a></div></div>` : ''}
        </div>
        ${branches.length ? `
          <div class="ex-eg-branches-title">${ICONS.storefront} ${T.branches}</div>
          ${branches.map(b => `
            <div class="ex-eg-branch-row">
              <span class="ex-eg-bic">${ICONS.storefront}</span>
              <div class="ex-eg-binfo">
                <div class="ex-eg-bname">${t(b.name)}</div>
                <div class="ex-eg-baddr">${t(b.address)}${b.phone ? ` • <a href="tel:${safeTel(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
              </div>
              ${b.mapUrl ? `<a class="ex-eg-map-link" href="${safeUrl(b.mapUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.map} ${T.map}</a>` : ''}
            </div>
          `).join('')}
        ` : ''}
        <div class="ex-eg-social-row">
          ${DATA.instagram ? `<a href="${DATA.instagram}" target="_blank" rel="noopener">${ICONS.instagram}</a>` : ''}
          ${DATA.facebook ? `<a href="${DATA.facebook}" target="_blank" rel="noopener">${ICONS.facebook}</a>` : ''}
          ${DATA.tiktok ? `<a href="${DATA.tiktok}" target="_blank" rel="noopener">${ICONS.tiktok}</a>` : ''}
        </div>
        <div class="ex-eg-policy-link"><a href="privacy-policy.html" target="_blank" rel="noopener">الخصوصية والسياسة</a></div>
      </div>
    `);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  }

  /* صفحة "فروعنا": كارت لكل فرع بصورته وعنوانه ومكانه على الخريطة */
  function openBranches() {
    const ar = state.lang === 'ar';
    const T = ar
      ? { title: 'فروعنا', map: 'الموقع على الخريطة', call: 'اتصل بالفرع', empty: 'مفيش فروع مضافة لسه' }
      : { title: 'Our branches', map: 'View on map', call: 'Call branch', empty: 'No branches yet' };
    const list = (SETTINGS.branches || []).filter(b => b && b.name && b.enabled !== false);
    const govName = (id) => { const g = EGYPT_GOVERNORATES.find(x => x.id === id); return g ? (ar ? g.ar : g.en) : ''; };
    const overlay = openOverlay(`
      <div class="ex-eg-modal-sheet">
        <div class="ex-eg-sheet-title">${ICONS.storefront} ${T.title}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
        <div class="ex-eg-branch-cards">
          ${list.length ? list.map(b => `
            <article class="ex-eg-branch-cardc">
              <div class="ex-eg-bcc-media">
                ${b.image ? `<img ${imgSrc(b.image)} alt="${t(b.name)}" loading="lazy">` : `<div class="ex-eg-bcc-ph">${ICONS.storefront}</div>`}
                ${b.governorateId ? `<span class="ex-eg-bcc-gov">${ICONS.pin} ${esc(govName(b.governorateId))}</span>` : ''}
              </div>
              <div class="ex-eg-bcc-body">
                <div class="ex-eg-bcc-name">${t(b.name)}</div>
                ${t(b.address) ? `<div class="ex-eg-bcc-addr">${ICONS.pin} ${t(b.address)}</div>` : ''}
                <div class="ex-eg-bcc-actions">
                  ${b.mapUrl ? `<a class="ex-eg-bcc-btn ex-eg-pressable" href="${safeUrl(b.mapUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.map} ${T.map}</a>` : ''}
                  ${b.phone ? `<a class="ex-eg-bcc-btn ex-eg-ghost ex-eg-pressable" href="tel:${safeTel(b.phone)}">${ICONS.phone} ${T.call}</a>` : ''}
                </div>
              </div>
            </article>`).join('') : `<div class="ex-eg-empty">${T.empty}</div>`}
        </div>
      </div>
    `);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  }

  function openFeedback() {
    // لو المحل مسجّلش نموذج خاص بيه، بنستخدم النموذج الافتراضي بدل ما الزرار ميعملش حاجة
    const form = (DATA.feedbackForm && Array.isArray(DATA.feedbackForm.questions) && DATA.feedbackForm.questions.length)
      ? DATA.feedbackForm
      : DEFAULT_FEEDBACK_FORM;
    const ratings = {};
    const overlay = openOverlay(`
      <div class="ex-eg-modal-sheet">
        <div class="ex-eg-sheet-title">${t(form.title)}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
        <form class="ex-eg-feedback-body" id="feedback-form">
          ${form.questions.map(q => `
            <div>
              <div class="ex-eg-fb-q">${t(q.question)}</div>
              ${q.type === 'rating'
                ? `<div class="ex-eg-fb-stars" data-qid="${q.id}">${[1,2,3,4,5].map(n => `<span class="ex-eg-star" data-val="${n}">★</span>`).join('')}</div>`
                : `<textarea class="ex-eg-fb-textarea" data-qid="${q.id}"></textarea>`}
            </div>
          `).join('')}
          <button type="submit" class="ex-eg-fb-submit ex-eg-pressable">${state.lang === 'ar' ? 'إرسال' : 'Submit'}</button>
        </form>
      </div>
    `);
    overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('.ex-eg-fb-stars').forEach(group => {
      group.addEventListener('click', (e) => {
        const star = e.target.closest('.ex-eg-star');
        if (!star) return;
        const val = Number(star.dataset.val);
        ratings[group.dataset.qid] = val;
        group.querySelectorAll('.ex-eg-star').forEach(s => s.classList.toggle('ex-eg-filled', Number(s.dataset.val) <= val));
      });
    });
    overlay.querySelector('#feedback-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const answers = form.questions.map(q => ({
        question: tPlain(q.question),
        answer: q.type === 'rating' ? (ratings[q.id] || null) : (overlay.querySelector(`textarea[data-qid="${q.id}"]`).value || null),
      }));
      const entry = { date: Date.now(), answers };
      fbSet(push(ref(db, 'feedback')), entry).catch(() => {});
      overlay.querySelector('.ex-eg-modal-sheet').innerHTML = `<div class="ex-eg-fb-thanks">${state.lang === 'ar' ? 'شكراً لمشاركتك رأيك! 🙏' : 'Thanks for your feedback! 🙏'}</div>`;
      setTimeout(() => overlay.remove(), 1600);
    });
  }

  function openDrawer() {
    const overlay = document.createElement('div');
    overlay.className = 'ex-eg-drawer-overlay';
    const DT = state.lang === 'ar'
      ? { settings: 'الإعدادات', lang: 'اللغة', notif: 'الإشعارات', inbox: 'فتح الإشعارات' }
      : { settings: 'Settings', lang: 'Language', notif: 'Notifications', inbox: 'Open inbox' };
    overlay.innerHTML = `
      <div class="ex-eg-drawer">
        <div class="ex-eg-drawer-logo"><img ${imgSrc(DATA.logo, 'assets/logo.png?v=4')} alt="${t(DATA.name, DATA.name)}"></div>
        <h3>${state.lang === 'ar' ? 'الأقسام' : 'Categories'}</h3>
        <ul>
          ${DATA.categories.map(c => `
            <li><button class="ex-eg-drawer-item ${c.id === state.activeCat ? 'ex-eg-active' : ''}" data-cat="${c.id}">
              <img ${imgSrc(c.image, safeUrl(DATA.fallbackProductImage))} alt="" loading="lazy" style="${fitStyle(c.imageFit)}">
              <span>${t(c.name)}</span>
            </button></li>
          `).join('')}
        </ul>

        <div class="ex-eg-drawer-settings">
          <h3>${DT.settings}</h3>

          <div class="ex-eg-set-row">
            <span class="ex-eg-set-ic">${ICONS.globe}</span>
            <span class="ex-eg-set-label">${DT.lang}</span>
            <span class="ex-eg-lang-switch ex-eg-set-ctl">
              <button data-lang="ar" class="${state.lang === 'ar' ? 'ex-eg-active' : ''}">AR</button>
              <button data-lang="en" class="${state.lang === 'en' ? 'ex-eg-active' : ''}">EN</button>
            </span>
          </div>

          ${features().notifications ? `
          <div class="ex-eg-set-row">
            <span class="ex-eg-set-ic">${ICONS.bell}</span>
            <span class="ex-eg-set-label">${DT.notif}</span>
            <button class="ex-eg-set-ctl ex-eg-set-btn" id="open-inbox">${DT.inbox}${getUnreadCount() ? `<b class="ex-eg-notif-badge" id="notif-badge">${getUnreadCount()}</b>` : ''}</button>
          </div>
          ${subscribeCardHtml(cartCtx())}` : ''}
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.ex-eg-drawer-item').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.remove();
        scrollToCat(Number(btn.dataset.cat));
      });
    });
    /* إعدادات القائمة الجانبية: اللغة + الإشعارات */
    overlay.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => { overlay.remove(); setLang(b.dataset.lang); }));
    const inboxBtn = overlay.querySelector('#open-inbox');
    if (inboxBtn) inboxBtn.addEventListener('click', () => {
      overlay.remove();
      openInbox(cartCtx(), (pid) => { const p = findProduct(pid); if (p) openProduct(p); });
    });
    wireSubscribeCard(overlay, cartCtx());
    document.body.appendChild(overlay);
  }

  function openSearch() {
    const overlay = document.createElement('div');
    overlay.className = 'ex-eg-search-overlay';
    overlay.innerHTML = `
      <div class="ex-eg-search-header">
        <button class="ex-eg-icon-btn ex-eg-ghost close-search">${ICONS.back}</button>
        <input type="text" class="ex-eg-search-input" placeholder="${state.lang === 'ar' ? 'ابحث في المنيو...' : 'Search the menu...'}">
      </div>
      <div class="ex-eg-search-results" id="search-results"></div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.close-search').addEventListener('click', () => overlay.remove());
    const input = overlay.querySelector('.ex-eg-search-input');
    setTimeout(() => input.focus(), 50);
    const results = overlay.querySelector('#search-results');
    function doSearch(q) {
      q = q.trim().toLowerCase();
      if (!q) { results.innerHTML = ''; return; }
      const matches = [];
      DATA.categories.forEach(c => (c.products || []).forEach(p => {
        const n = `${p.name?.ar || ''} ${p.name?.en || ''}`.toLowerCase();
        if (n.includes(q)) matches.push(p);
      }));
      results.innerHTML = matches.length
        ? `<div class="ex-eg-product-grid">${matches.map(p => productCard(p)).join('')}</div>`
        : `<div class="ex-eg-empty-state">${state.lang === 'ar' ? 'لا توجد نتائج' : 'No results'}</div>`;
      results.querySelectorAll('.ex-eg-reveal').forEach(el => el.classList.add('ex-eg-in'));
      results.querySelectorAll('.ex-eg-product-card').forEach(card => {
        card.addEventListener('click', () => {
          dismissTapHint();
          const p = findProduct(Number(card.dataset.product));
          if (p) openProduct(p);
        });
      });
    }
    input.addEventListener('input', () => doSearch(input.value));
  }

  function findProduct(id) {
    for (const c of DATA.categories) {
      const p = (c.products || []).find(x => x.id === id);
      if (p) return p;
    }
    return null;
  }

  function applyMenuFilter(query) {
    const normalized = query.trim().toLowerCase();
    document.querySelectorAll('.ex-eg-category-section').forEach(section => {
      let visible = 0;
      section.querySelectorAll('.ex-eg-product-card').forEach(card => {
        const product = findProduct(Number(card.dataset.product));
        const name = `${product?.name?.ar || ''} ${product?.name?.en || ''}`.toLowerCase();
        const matches = !normalized || name.includes(normalized);
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      section.hidden = Boolean(normalized && !visible);
    });
  }

  function scrollToCat(id) {
    state.activeCat = id;
    /* الأقسام بتتحمّل على دفعات وانت بتنزل — لو القسم المطلوب لسه ماترسمش،
       نرسمه هو واللي قبله الأول وبعدين ننزل له (الزرار كان بيبقى ساكت). */
    const idx = (DATA.categories || []).findIndex(c => c.id === id);
    if (idx >= 0 && idx + 1 > state.visibleCategoryCount && !state.menuQuery) {
      state.visibleCategoryCount = idx + 1;
      render();
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToCat(id)));
      return;
    }
    const el = document.getElementById(catId(id));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const tab = document.querySelector(`.ex-eg-cat-tab[data-cat="${id}"]`);
    if (tab) tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    document.querySelectorAll('.ex-eg-cat-tab').forEach(b => b.classList.toggle('ex-eg-active', Number(b.dataset.cat) === id));
  }

  let observer = null;
  function setupCategoryObserver() {
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = Number(entry.target.dataset.catSection);
          state.activeCat = id;
          document.querySelectorAll('.ex-eg-cat-tab').forEach(b => b.classList.toggle('ex-eg-active', Number(b.dataset.cat) === id));
        }
      });
    }, { rootMargin: '-140px 0px -70% 0px', threshold: 0 });
    document.querySelectorAll('[data-cat-section]').forEach(el => observer.observe(el));
  }

  let batchObserver = null;
  function setupMenuBatchObserver() {
    if (batchObserver) batchObserver.disconnect();
    const loader = document.getElementById('menu-load-more');
    if (!loader) return;
    batchObserver = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting) || state.menuBatchLoading) return;
      state.menuBatchLoading = true;
      render();
      setTimeout(() => {
        state.visibleCategoryCount += 1;
        state.menuBatchLoading = false;
        render();
      }, 180);
    }, { rootMargin: '260px 0px' });
    batchObserver.observe(loader);
  }

  let topWatcher = null;
  let revealObserver = null;
  function setupRevealObserver() {
    if (revealObserver) revealObserver.disconnect();
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry, idx) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          /* الكروت بتظهر واحد ورا التاني: الترتيب جاي من --i، ولو مش موجود
             بنحسبه من ترتيب ظهوره في الشاشة. */
          if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(idx % 10));
          el.classList.add('ex-eg-in');
          revealObserver.unobserve(el);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    document.querySelectorAll('.ex-eg-reveal').forEach(el => revealObserver.observe(el));
  }

  function bindGlobalEvents() {
    app.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => setLang(b.dataset.lang)));

    const on = (sel, fn) => { const el = app.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('#go-menu', () => { state.page = 'menu'; render(); window.scrollTo(0, 0); });
    on('#go-home', () => { state.page = 'home'; render(); });
    on('#open-feedback-home', openFeedback);
    on('#open-feedback', openFeedback);
    on('#open-info', openInfo);
    on('#open-cart', () => openCartDrawer(cartCtx()));
    on('#open-my-orders', () => openMyOrders(cartCtx()));
    on('#open-my-orders-home', () => openMyOrders(cartCtx()));
    on('#open-branches-home', openBranches);
    on('#open-inbox', () => openInbox(cartCtx(), (pid) => { const p = findProduct(pid); if (p) { if (state.page !== 'menu') { state.page = 'menu'; render(); } openProduct(p); } }));
    wireSubscribeCard(app, cartCtx());
    on('#open-search', openSearch);
    on('#open-drawer', openDrawer);
    on('#toggle-lang', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));

    const filter = app.querySelector('#menu-filter');
    if (filter) filter.addEventListener('input', () => {
      const value = filter.value;
      state.menuQuery = value;
      render();
      const nextFilter = app.querySelector('#menu-filter');
      if (nextFilter) { nextFilter.focus(); nextFilter.setSelectionRange(value.length, value.length); }
    });
    const reload = app.querySelector('#reload-menu');
    if (reload) reload.addEventListener('click', async () => {
      state.menuLoading = true;
      reload.disabled = true;
      reload.querySelector('span').textContent = state.lang === 'ar' ? 'جاري التحميل...' : 'Loading...';
      try {
        const fbData = await loadMenuFromFirebase();
        if (fbData) {
          applyData(Object.assign({}, DATA, fbData));
          render();
        } else {
          toast(state.lang === 'ar' ? 'تعذر تحميل البيانات حالياً' : 'Could not load data right now');
        }
      } finally {
        state.menuLoading = false;
        if (document.body.contains(app) && state.page === 'menu') render();
      }
    });

    app.querySelectorAll('.ex-eg-cat-tab').forEach(b => b.addEventListener('click', () => scrollToCat(Number(b.dataset.cat))));
    /* زرار عائم للرجوع لأعلى — بيظهر بعد ما تنزل شوية */
    const toTop = app.querySelector('#to-top');
    const sentinel = app.querySelector('#top-sentinel');
    if (toTop && sentinel) {
      // بنراقب عنصر صغير أعلى الصفحة: أول ما يخرج من الشاشة يظهر الزرار
      if (topWatcher) topWatcher.disconnect();
      topWatcher = new IntersectionObserver(([e]) => { toTop.hidden = e.isIntersecting; }, { rootMargin: '200px 0px 0px 0px' });
      topWatcher.observe(sentinel);
      // احتياط: بعض المتصفحات بتأخّر الـ observer، فبنسمع للسكرول كمان
      const syncTop = () => { if (toTop.isConnected) toTop.hidden = window.scrollY < 200; };
      window.addEventListener('scroll', syncTop, { passive: true });
      syncTop();
      toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    app.querySelectorAll('.ex-eg-product-card').forEach(card => card.addEventListener('click', () => {
      dismissTapHint();
      const p = findProduct(Number(card.dataset.product));
      if (p) openProduct(p);
    }));
  }


  // ---------------- منع نسخ النصوص ----------------
  function guardContent() {
    const editable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    ['copy', 'cut'].forEach(evt => document.addEventListener(evt, (e) => { if (!editable(e.target)) e.preventDefault(); }));
    document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') e.preventDefault(); });
    document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
    document.addEventListener('keydown', (e) => {
      const k = (e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'u', 's'].includes(k) && !editable(e.target)) e.preventDefault();
    });
  }
  guardContent();

  (async function bootstrap() {
    /* جلسة زائر من فايربيز — بتخلّي التقييمات والآراء مربوطة بصاحبها فعلاً
       بدل رقم بيتخترع في المتصفح. بتمشي في الخلفية ومابتأخرش العرض. */
    ensureGuest().catch(() => {});
    const minSplash = new Promise(resolve => setTimeout(resolve, 900));
    /* الهيكل العظمي بيتحط من دلوقتي، فأول ما الاسبلاش يختفي يلاقي المستخدم
       شكل الصفحة قدامه وهي بتحمّل — مش شاشة بيضا. */
    app.innerHTML = skeletonScreen();

    const dataPromise = Promise.all([
      window.__firebaseMenuPromise || loadMenuFromFirebase(),
      loadPublicSettings(),
    ]).catch(() => [null, null]);

    await minSplash;
    let fbData = null, pub = null;
    try { [fbData, pub] = await dataPromise; } catch (e) { /* Firebase data remains unavailable. */ }
    hideSplash();
    if (pub) SETTINGS = pub;
    SETTINGS.features = Object.assign({}, DEFAULT_FEATURES, SETTINGS.features || {});
    if (fbData) applyData(Object.assign({}, DATA, fbData));
    state.menuLoading = !fbData;
    render();
    watchMyOrders(cartCtx());
    document.addEventListener('order-placed', () => {
      watchMyOrders(cartCtx());
      render();
    });

    /* المنيو لحظي: أي تعديل من اللوحة (سعر/منتج/قسم) بيوصل للصفحات المفتوحة
       فوراً، والعربة بتاخد الأسعار الجديدة من غير ريفرش. */
    let menuSyncedOnce = false;
    onValue(ref(db, 'menu'), (snap) => {
      if (!snap.exists()) return;
      if (!menuSyncedOnce) { menuSyncedOnce = true; syncCartPrices(snap.val(), (p, v) => discountedPrice(v.price, activeDiscount(p))); return; }
      applyData(Object.assign({ currencyCode: 'EGP', fallbackProductImage: 'assets/logo.png?v=4' }, snap.val()));
      syncCartPrices(DATA, (p, v) => discountedPrice(v.price, activeDiscount(p)));
      // مانقطعش على العميل وهو بيكمّل طلب
      if (!document.querySelector('.cart-overlay')) render();
    }, () => {});

    /* تقييمات المنتجات — بتتحمّل مرة وبتتحدّث لحظياً لكل الزوار */
    loadAllRatings().then(r => { RATINGS = r; if (state.page === 'menu') render(); }).catch(() => {});
    watchRatings((r) => {
      const before = JSON.stringify(RATINGS);
      RATINGS = r;
      // النوافذ المنبثقة بتتعلق على body مش على #app، فإعادة الرسم مش بتقفلها
      if (JSON.stringify(r) !== before && state.page === 'menu') render();
    });

    /* أي تغيير في مفاتيح المزايا من اللوحة بيوصل لكل الصفحات المفتوحة فوراً —
       فلما تقفل الإشعارات بتختفي عند كل العملاء من غير ما يعملوا ريفرش. */
    onValue(ref(db, 'settings/features'), (snap) => {
      if (!snap.exists()) return;
      const next = Object.assign({}, DEFAULT_FEATURES, snap.val());
      const before = JSON.stringify(SETTINGS.features || {});
      SETTINGS.features = next;
      if (JSON.stringify(next) !== before) render();
    }, () => {});

    if (SETTINGS.features.notifications) {
      if (isSubscribed()) startFeed(cartCtx());
      // لو العميل ضغط Start في البوت وهو بره الصفحة، نلتقط الربط أول ما يرجع
      onFeedChange((n) => { const b = document.getElementById('notif-badge'); if (b) b.textContent = n || ''; });
      document.addEventListener('open-inbox', () => openInbox(cartCtx(), (pid) => { const p = findProduct(pid); if (p) openProduct(p); }));
    }
    await setupPwa(!!SETTINGS.features.pwaInstall, cartCtx());
    if (SETTINGS.features.cookieBanner !== false) setTimeout(() => setupCookieConsent(cartCtx()), 1200);
    window.__openCookiePolicy = () => openCookiePolicy(state.lang);
    if (SETTINGS.features.notifications && SETTINGS.features.pwaInstall) refreshPushToken(cartCtx());

    // deep links from push notifications: ?product=ID or ?track=ORDER_ID
    const qs = new URLSearchParams(location.search);
    if (qs.get('product')) { const p = findProduct(Number(qs.get('product'))); if (p) { state.page = 'menu'; render(); openProduct(p); } }
    else if (qs.get('track')) { openOrderTracking(qs.get('track'), cartCtx()); }
    if (qs.get('product') || qs.get('track')) history.replaceState({}, '', location.pathname);
  })();

  function hideSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    splash.classList.add('ex-eg-hide');
    setTimeout(() => splash.remove(), 600);
  }
})();
