/* The settings area is split into one screen per topic; each is its own sidebar item. */
import { ICONS } from '../../js/icons.js';
import { esc, safeUrl } from '../../js/escape.js';
import { db, ref, get, set, onValue } from '../../js/firebase-config.js';
import { toast } from './app.js';
import { publishImage } from './assetStore.js';
import { imgSrc, wireAssets } from '../../js/assets.js';
import { imageFieldTemplate, wireImageField, getImageFieldValue, getImageFitValue, fitStyle, toDirectImageUrl } from '../../js/imageUtils.js';
import { EGYPT_GOVERNORATES, defaultGovernorateSettings, DEFAULT_PAYMENTS, PAYMENT_SCOPES, BANNER_ANIMATIONS, DEFAULT_FEATURES } from '../../js/defaults.js';
import { attachTranslateButton } from '../../js/translate.js';
import { sendBroadcast } from '../../js/broadcast.js';
import { getBotInfo, detectAdminChatId } from '../../js/telegram.js';

async function readMenu() {
  try { const s = await get(ref(db, 'menu')); if (s.exists()) return s.val(); } catch (e) { /* fall back */ }
  return window.MENU_DATA ? JSON.parse(JSON.stringify(window.MENU_DATA)) : {};
}
async function readNode(path, fallback) {
  try { const s = await get(ref(db, path)); return s.exists() ? s.val() : fallback; } catch (e) { return fallback; }
}
async function patchMenu(fn) {
  const full = await readMenu();
  fn(full);
  try { await set(ref(db, 'menu'), full); }
  catch (e) { toast('مفيش صلاحية للحفظ — راجع صلاحيات حسابك', 'error'); throw e; }
}
const loading = (c) => { c.innerHTML = `<div class="ex-eg-empty-d">جاري التحميل...</div>`; };

/* ---------------- الهوية ---------------- */
export async function renderIdentity(container) {
  loading(container);
  const menu = await readMenu();
  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.storefront} هوية المحل</h3><p class="ex-eg-hint">الاسم واللوجو والألوان اللي بتظهر للعملاء.</p></div></div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>اسم المحل</label><input id="s-name" value="${esc(menu.name || '')}"></div>
        <div class="ex-eg-field"><label>العملة</label><input id="s-currency" value="${esc(menu.currencyCode || 'EGP')}"></div>
      </div>
      ${imageFieldTemplate('s-logo', menu.logo, 'اللوجو', menu.logoFit)}
      <div class="ex-eg-homebg-box">
        <label class="ex-eg-homebg-label">خلفية الصفحة الرئيسية</label>
        <p class="ex-eg-hint" style="margin-bottom:8px">حط لينك صورة أو GIF أو فيديو (mp4 / webm). الفيديو بيشتغل لوحده وبيلفّ، وأخف بكتير من الـ GIF.</p>
        <input id="s-homebg" class="ex-eg-field-wide" dir="ltr" placeholder="assets/home-bg.mp4  أو  https://..." value="${esc(menu.homeBackground || '')}">
        <div class="ex-eg-homebg-row">
          <button type="button" class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="s-homebg-clear">شيل الخلفية</button>
          <span class="ex-eg-hint" id="s-homebg-kind"></span>
        </div>
        <label class="ex-eg-homebg-label" style="margin-top:12px">صورة ثابتة تظهر لحد ما الفيديو يشتغل (اختياري)</label>
        <input id="s-homebg-poster" class="ex-eg-field-wide" dir="ltr" placeholder="assets/home-bg-poster.jpg" value="${esc(menu.homeBackgroundPoster || '')}">
        <div class="ex-eg-homebg-preview" id="s-homebg-preview"></div>
      </div>
      <label class="ex-eg-pay-config-row"><span class="ex-eg-pc-name">الخلفية نفسها فيها اللوجو (اخفي لوجو الصفحة)</span>
        <input type="checkbox" id="s-homebg-logo" ${menu.homeBgHasLogo !== false ? 'checked' : ''}><span class="ex-eg-switch"></span></label>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>اللون الأساسي</label><input type="color" id="s-primary" value="${esc(menu.primaryColor || '#1565C0')}"></div>
        <div class="ex-eg-field"><label>لون الخلفية</label><input type="color" id="s-bg" value="${esc(menu.backgroundColor || '#ffffff')}"></div>
      </div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>لون النصوص</label><input type="color" id="s-text" value="${esc(menu.textColor || '#0F2740')}"></div>
        <div class="ex-eg-field"><label>لون نص الأزرار</label><input type="color" id="s-btntext" value="${esc(menu.buttonTextColor || '#ffffff')}"></div>
      </div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>ملاحظة أعلى المنيو (عربي)</label><input id="s-note-ar" value="${esc(menu.menuNote?.ar || '')}" placeholder="مثال: جميع الأسعار شاملة الضريبة"></div>
        <div class="ex-eg-field"><label>الملاحظة (إنجليزي)</label><input id="s-note-en" value="${esc(menu.menuNote?.en || '')}"></div>
      </div>
      <button class="ex-eg-btn" id="save-identity">${ICONS.check} حفظ</button>
    </div>`;
  wireImageField(container, 's-logo');
  /* معاينة حيّة للخلفية + توضيح نوعها */
  (function wireHomeBg() {
    const input = container.querySelector('#s-homebg');
    const poster = container.querySelector('#s-homebg-poster');
    const box = container.querySelector('#s-homebg-preview');
    const kind = container.querySelector('#s-homebg-kind');
    const clear = container.querySelector('#s-homebg-clear');
    const paint = () => {
      const raw = (input.value || '').trim();
      const url = safeUrl(toDirectImageUrl(raw));
      const isVid = /\.(mp4|webm|mov)(\?|$)/i.test(raw);
      kind.textContent = !raw ? 'مفيش خلفية — هيظهر التدرّج البرتقالي العادي'
        : isVid ? 'فيديو — بيشتغل ويلفّ لوحده وبدون صوت'
        : (/\.gif(\?|$)/i.test(raw) ? 'صورة متحركة GIF' : 'صورة ثابتة');
      if (!raw) { box.innerHTML = ''; return; }
      box.innerHTML = isVid
        ? `<video src="${url}" muted loop autoplay playsinline></video>`
        : `<img src="${url}" alt="">`;
    };
    input.addEventListener('input', paint);
    clear.addEventListener('click', () => { input.value = ''; poster.value = ''; paint(); });
    paint();
  })();
  attachTranslateButton(container, 's-note-ar', 's-note-en');
  container.querySelector('#save-identity').addEventListener('click', async () => {
    const $ = s => container.querySelector(s);
    /* رفع اللوجو لمخزن الصور لازم يحصل قبل ما نبدأ تعديل المنيو */
    const logoRef = await publishImage(getImageFieldValue(container, 's-logo'));
    await patchMenu(m => {
      m.name = $('#s-name').value.trim();
      m.currencyCode = $('#s-currency').value.trim();
      m.logo = logoRef || m.logo || '';
      m.logoFit = getImageFitValue(container, 's-logo');
      m.homeBackground = $('#s-homebg').value.trim();
      m.homeBackgroundPoster = $('#s-homebg-poster').value.trim();
      m.homeBgHasLogo = $('#s-homebg-logo').checked;
      m.primaryColor = $('#s-primary').value;
      m.backgroundColor = $('#s-bg').value;
      m.textColor = $('#s-text').value;
      m.buttonTextColor = $('#s-btntext').value;
      m.menuNote = { ar: $('#s-note-ar').value.trim(), en: $('#s-note-en').value.trim() };
    });
    document.documentElement.style.setProperty('--primary', container.querySelector('#s-primary').value);
    toast('اتحفظت الهوية', 'success');
  });
}

/* ---------------- صور البانر ---------------- */
export async function renderBanners(container) {
  loading(container);
  const menu = await readMenu();
  let banners = Array.isArray(menu.banners) ? menu.banners.filter(b => b && b.url) : (menu.banner ? [{ id: 'b1', url: menu.banner }] : []);

  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.images} صور البانر</h3><p class="ex-eg-hint">الصور اللي بتظهر أعلى المنيو وبتتبدّل تلقائياً.</p></div></div>
      <div class="ex-eg-field"><label>نوع الأنميشن بين الصور</label>
        <select id="s-anim">${BANNER_ANIMATIONS.map(a => `<option value="${esc(a.id)}" ${(menu.bannerAnimation || 'fade') === a.id ? 'selected' : ''}>${a.ar}</option>`).join('')}</select>
      </div>
      <div id="banner-list" class="ex-eg-banner-list"></div>
      ${imageFieldTemplate('s-banner-new', '', 'أضف صورة بانر')}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ex-eg-btn ex-eg-ghost" id="banner-add">${ICONS.plus} أضف الصورة للقائمة</button>
        <button class="ex-eg-btn" id="save-banners">${ICONS.check} حفظ</button>
      </div>
    </div>`;
  wireImageField(container, 's-banner-new');

  function paint() {
    const box = container.querySelector('#banner-list');
    box.innerHTML = banners.length ? banners.map((b, i) => `
      <div class="ex-eg-banner-item">
        <img ${imgSrc(toDirectImageUrl(b.url))} alt="" loading="lazy" style="${fitStyle(b.fit)}">
        <div class="ex-eg-banner-actions">
          <button class="ex-eg-icon-action" data-bup="${i}" title="لليسار">${ICONS.plus}</button>
          <button class="ex-eg-icon-action" data-bdown="${i}" title="لليمين">${ICONS.minus}</button>
          <button class="ex-eg-icon-action ex-eg-danger" data-bdel="${i}">${ICONS.trash}</button>
        </div>
      </div>`).join('') : `<div class="ex-eg-empty-d">مفيش صور بانر لسه</div>`;
    wireAssets(box);
    box.querySelectorAll('[data-bdel]').forEach(b => b.addEventListener('click', () => { banners.splice(+b.dataset.bdel, 1); paint(); }));
    box.querySelectorAll('[data-bup]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.bup; if (i > 0) { [banners[i - 1], banners[i]] = [banners[i], banners[i - 1]]; paint(); } }));
    box.querySelectorAll('[data-bdown]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.bdown; if (i < banners.length - 1) { [banners[i + 1], banners[i]] = [banners[i], banners[i + 1]]; paint(); } }));
  }
  paint();

  container.querySelector('#banner-add').addEventListener('click', async () => {
    const url = await publishImage(getImageFieldValue(container, 's-banner-new'));
    if (!url) { toast('ارفع صورة أو حط لينك الأول', 'error'); return; }
    banners.push({ id: 'b' + Date.now(), url, fit: getImageFitValue(container, 's-banner-new') });
    const w = container.querySelector('.ex-eg-image-field[data-field="s-banner-new"]');
    delete w.dataset.inline;
    container.querySelector('#s-banner-new').value = '';
    container.querySelector('#s-banner-new-preview').innerHTML = '<span>لا توجد صورة</span>';
    container.querySelector('#s-banner-new-status').textContent = '';
    paint();
  });
  container.querySelector('#save-banners').addEventListener('click', async () => {
    /* m.banner كان نسخة تانية من أول بانر ومحدش بيقراها — شيلناها عشان
       ماتكبّرش عقدة المنيو من غير فايدة. */
    await patchMenu(m => { m.banners = banners; m.banner = null; m.bannerAnimation = container.querySelector('#s-anim').value; });
    toast('اتحفظت البانرات', 'success');
  });
}

/* ---------------- التواصل ---------------- */
export async function renderContact(container) {
  loading(container);
  const menu = await readMenu();
  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.phone} التواصل والعنوان</h3><p class="ex-eg-hint">بتظهر للعميل في صفحة "معلومات المحل".</p></div></div>
      <div class="ex-eg-field"><label>العنوان</label><textarea id="s-address" rows="2">${menu.address || ''}</textarea></div>
      <div class="ex-eg-field"><label>مواعيد العمل</label><textarea id="s-hours" rows="2">${menu.openingHours || ''}</textarea></div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>رقم التليفون</label><input id="s-phone" value="${esc(menu.contactNumber || '')}" dir="ltr"></div>
        <div class="ex-eg-field"><label>الموقع الإلكتروني</label><input id="s-website" value="${esc(menu.website || '')}" dir="ltr"></div>
      </div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>إنستجرام</label><input id="s-ig" value="${esc(menu.instagram || '')}" dir="ltr"></div>
        <div class="ex-eg-field"><label>فيسبوك</label><input id="s-fb" value="${esc(menu.facebook || '')}" dir="ltr"></div>
      </div>
      <div class="ex-eg-field"><label>تيك توك</label><input id="s-tt" value="${esc(menu.tiktok || '')}" dir="ltr"></div>
      <button class="ex-eg-btn" id="save-contact">${ICONS.check} حفظ</button>
    </div>`;
  container.querySelector('#save-contact').addEventListener('click', async () => {
    const $ = s => container.querySelector(s);
    await patchMenu(m => {
      m.address = $('#s-address').value.trim(); m.openingHours = $('#s-hours').value.trim();
      m.contactNumber = $('#s-phone').value.trim(); m.website = $('#s-website').value.trim();
      m.instagram = $('#s-ig').value.trim(); m.facebook = $('#s-fb').value.trim(); m.tiktok = $('#s-tt').value.trim();
    });
    toast('اتحفظت بيانات التواصل', 'success');
  });
}

/* ---------------- بوابات الدفع ---------------- */
export async function renderPayments(container) {
  loading(container);
  const payments = Object.assign({}, DEFAULT_PAYMENTS, await readNode('settings/payments', {}));
  const row = (id, icon, name, checked) => `
    <label class="ex-eg-pay-config-row"><span class="ex-eg-pay-logo-sm">${icon}</span><span class="ex-eg-pc-name">${name}</span>
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="ex-eg-switch"></span></label>`;
  /* لمين تظهر طريقة الدفع دي: طلبات جوّه المحل ولا برّه ولا الاتنين */
  const scopeRow = (id, cfg) => `
    <div class="ex-eg-field ex-eg-indent"><label>تظهر لعملاء</label>
      <select id="${id}">${PAYMENT_SCOPES.map(s => `<option value="${esc(s.id)}" ${((cfg && cfg.scope) || 'both') === s.id ? 'selected' : ''}>${s.ar}</option>`).join('')}</select>
    </div>`;
  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.cash} بوابات الدفع</h3><p class="ex-eg-hint">اللي تفعّله بس هو اللي هيظهر للعميل وقت إتمام الطلب. المحافظ بتشتغل بالتحويل اليدوي: العميل بيحوّل ويكتب رقم العملية، وانت بتشوفه مع الطلب.</p></div></div>
      <div class="ex-eg-pay-config">
        ${row('p-cod', ICONS.cash, 'الدفع عند الاستلام', payments.cod?.enabled)}
        ${scopeRow('p-cod-scope', payments.cod)}
        ${row('p-vf', ICONS.vodafoneCash, 'فودافون كاش', payments.vodafoneCash?.enabled)}
        <div class="ex-eg-field ex-eg-indent"><label>رقم محفظة فودافون كاش</label><input id="p-vf-number" value="${esc(payments.vodafoneCash?.number || '')}" dir="ltr" placeholder="01xxxxxxxxx"></div>
        ${scopeRow('p-vf-scope', payments.vodafoneCash)}
        ${row('p-et', ICONS.etisalatCash, 'اتصالات كاش (e& cash)', payments.etisalatCash?.enabled)}
        <div class="ex-eg-field ex-eg-indent"><label>رقم محفظة اتصالات كاش</label><input id="p-et-number" value="${esc(payments.etisalatCash?.number || '')}" dir="ltr" placeholder="01xxxxxxxxx"></div>
        ${scopeRow('p-et-scope', payments.etisalatCash)}
        ${row('p-ip', ICONS.instapay, 'إنستاباي', payments.instapay?.enabled)}
        <div class="ex-eg-row-2 ex-eg-indent">
          <div class="ex-eg-field"><label>عنوان إنستاباي (IPA)</label><input id="p-ip-address" value="${esc(payments.instapay?.address || '')}" dir="ltr" placeholder="name@instapay"></div>
          <div class="ex-eg-field"><label>لينك الدفع (اختياري)</label><input id="p-ip-link" value="${esc(payments.instapay?.link || '')}" dir="ltr" placeholder="https://ipn.eg/S/..."></div>
        </div>
        ${scopeRow('p-ip-scope', payments.instapay)}
      </div>
      ${row('p-proof', ICONS.images, 'طلب صورة (سكرين) التحويل من العميل', payments.requireProof !== false)}
      <p class="ex-eg-hint">لما تكون مفعّلة، العميل لازم يرفع سكرين التحويل مع الطلب — والصورة بتوصل مع رسالة البوت وبتظهر في تفاصيل الطلب.</p>
      <button class="ex-eg-btn" id="save-payments">${ICONS.check} حفظ</button>
    </div>`;
  container.querySelector('#save-payments').addEventListener('click', async () => {
    const $ = s => container.querySelector(s);
    const data = {
      cod: { enabled: $('#p-cod').checked, scope: $('#p-cod-scope').value },
      vodafoneCash: { enabled: $('#p-vf').checked, number: $('#p-vf-number').value.trim(), scope: $('#p-vf-scope').value },
      etisalatCash: { enabled: $('#p-et').checked, number: $('#p-et-number').value.trim(), scope: $('#p-et-scope').value },
      instapay: { enabled: $('#p-ip').checked, address: $('#p-ip-address').value.trim(), link: $('#p-ip-link').value.trim(), scope: $('#p-ip-scope').value },
      requireProof: $('#p-proof').checked,
    };
    if (data.vodafoneCash.enabled && !data.vodafoneCash.number) { toast('اكتب رقم فودافون كاش', 'error'); return; }
    if (data.etisalatCash.enabled && !data.etisalatCash.number) { toast('اكتب رقم اتصالات كاش', 'error'); return; }
    if (data.instapay.enabled && !data.instapay.address && !data.instapay.link) { toast('اكتب عنوان إنستاباي', 'error'); return; }
    try { await set(ref(db, 'settings/payments'), data); toast('اتحفظت بوابات الدفع', 'success'); }
    catch (e) { toast('مفيش صلاحية للحفظ', 'error'); }
  });
}

/* ---------------- محافظات التوصيل ---------------- */
export async function renderGovernorates(container) {
  loading(container);
  const govs = Object.assign(defaultGovernorateSettings(), await readNode('settings/governorates', {}));
  container.innerHTML = `
    <div class="ex-eg-card">
      <div class="ex-eg-card-head"><div><h3>${ICONS.truck} محافظات التوصيل</h3><p class="ex-eg-hint">فعّل المحافظات اللي بتوصّل ليها وحدد رسوم التوصيل لكل واحدة — العميل مش هيشوف غيرها.</p></div>
        <div style="display:flex;gap:6px"><button class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="gov-all">تفعيل الكل</button><button class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="gov-none">إلغاء الكل</button></div>
      </div>
      <div class="ex-eg-gov-grid">
        ${EGYPT_GOVERNORATES.map(g => `
          <div class="ex-eg-gov-row ${govs[g.id]?.enabled ? 'ex-eg-on' : ''}" data-gov="${g.id}">
            <label class="ex-eg-gov-name"><input type="checkbox" data-gov-enabled="${g.id}" ${govs[g.id]?.enabled ? 'checked' : ''}><span>${g.ar}</span></label>
            <input type="number" min="0" class="ex-eg-gov-fee" data-gov-fee="${g.id}" value="${esc(govs[g.id]?.deliveryFee || 0)}" placeholder="رسوم">
          </div>`).join('')}
      </div>
      <button class="ex-eg-btn" id="save-govs" style="margin-top:14px">${ICONS.check} حفظ</button>
    </div>`;
  const sync = (cb) => cb.closest('.ex-eg-gov-row').classList.toggle('ex-eg-on', cb.checked);
  container.querySelectorAll('[data-gov-enabled]').forEach(cb => cb.addEventListener('change', () => sync(cb)));
  container.querySelector('#gov-all').addEventListener('click', () => container.querySelectorAll('[data-gov-enabled]').forEach(cb => { cb.checked = true; sync(cb); }));
  container.querySelector('#gov-none').addEventListener('click', () => container.querySelectorAll('[data-gov-enabled]').forEach(cb => { cb.checked = false; sync(cb); }));
  container.querySelector('#save-govs').addEventListener('click', async () => {
    const data = {};
    EGYPT_GOVERNORATES.forEach(g => {
      data[g.id] = {
        enabled: container.querySelector(`[data-gov-enabled="${g.id}"]`).checked,
        deliveryFee: Number(container.querySelector(`[data-gov-fee="${g.id}"]`).value) || 0,
      };
    });
    try { await set(ref(db, 'settings/governorates'), data); toast('اتحفظت المحافظات', 'success'); }
    catch (e) { toast('مفيش صلاحية للحفظ', 'error'); }
  });
}

/* ---------------- الإشعارات والتطبيق ---------------- */
export async function renderFeatures(container) {
  loading(container);
  const features = Object.assign({}, DEFAULT_FEATURES, await readNode('settings/features', {}));
  const fr = (id, icon, title, sub, on, sub2) => `
    <label class="ex-eg-feature-row ${sub2 ? 'ex-eg-sub' : ''}"><span class="ex-eg-fr-icon">${icon}</span>
      <span class="ex-eg-fr-body"><b>${title}</b><small>${sub}</small></span>
      <input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span class="ex-eg-switch"></span></label>`;
  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.bell} الإشعارات والتطبيق</h3><p class="ex-eg-hint">التغيير بيظهر للعملاء فوراً.</p></div>
        <span class="ex-eg-subs-count" id="subs-count">${ICONS.users} <span>—</span> مشترك</span></div>
      ${fr('f-notif', ICONS.bell, 'الإشعارات للعملاء', 'زرار "فعّل الإشعارات" وصندوق الإشعارات في الموقع', features.notifications)}
      ${fr('f-notif-new', ICONS.star, 'إشعار تلقائي عند إضافة منتج جديد', 'لكل المشتركين، بصورة المنتج', features.notifyNewProducts, true)}
      ${fr('f-notif-disc', ICONS.receipt, 'إشعار تلقائي عند إضافة خصم', 'لكل المشتركين', features.notifyDiscounts, true)}
      ${fr('f-pwa', ICONS.grid, 'تثبيت الموقع كتطبيق', 'اقتراح تثبيت براد أونلاين على شاشة العميل + يشتغل بدون إنترنت', features.pwaInstall)}
      ${fr('f-cookies', ICONS.cookie, 'شريط ملفات تعريف الارتباط (الكوكيز)', 'إشعار للعميل بالبيانات المحفوظة على جهازه + صفحة تفاصيل', features.cookieBanner !== false)}
      ${fr('f-devbind', ICONS.shield, 'اربط كل حساب أدمن بمتصفح واحد', 'حماية زيادة للموظفين — بس لو مسحت بيانات المتصفح هتحتاج توافق على الجهاز من جديد', features.deviceBinding === true)}
      <button class="ex-eg-btn" id="save-features">${ICONS.check} حفظ</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:18px 0">
      <h3 style="font-size:14px;margin:0 0 10px">${ICONS.send} إرسال إشعار يدوي</h3>
      <div class="ex-eg-field"><label>العنوان</label><input id="bc-title" placeholder="مثال: لحمة مفرومة طازة وصل 🥖"></div>
      <div class="ex-eg-field"><label>النص (اختياري)</label><textarea id="bc-body" rows="2" placeholder="اطلب دلوقتي من المنيو"></textarea></div>
      <button class="ex-eg-btn ex-eg-ghost" id="send-bc">${ICONS.send} إرسال لكل المشتركين</button>
    </div>`;
  onValue(ref(db, 'subscribers'), (snap) => {
    const el = container.querySelector('#subs-count span');
    if (el) el.textContent = snap.exists() ? Object.keys(snap.val()).length : 0;
  }, () => {});
  container.querySelector('#save-features').addEventListener('click', async () => {
    const $ = s => container.querySelector(s);
    const prev = await readNode('settings/features', {});
    try {
      await set(ref(db, 'settings/features'), Object.assign({}, DEFAULT_FEATURES, prev, {
        notifications: $('#f-notif').checked, notifyNewProducts: $('#f-notif-new').checked,
        notifyDiscounts: $('#f-notif-disc').checked, pwaInstall: $('#f-pwa').checked,
        cookieBanner: $('#f-cookies').checked,
        deviceBinding: $('#f-devbind').checked,
      }));
      toast('اتحفظت الإعدادات', 'success');
    } catch (e) { toast('مفيش صلاحية للحفظ', 'error'); }
  });
  container.querySelector('#send-bc').addEventListener('click', async () => {
    const title = container.querySelector('#bc-title').value.trim();
    const body = container.querySelector('#bc-body').value.trim();
    if (!title) { toast('اكتب عنوان الإشعار', 'error'); return; }
    try { await sendBroadcast({ type: 'custom', title, body }); toast('اتبعت لكل المشتركين', 'success'); container.querySelector('#bc-title').value = ''; container.querySelector('#bc-body').value = ''; }
    catch (e) { toast('فشل الإرسال', 'error'); }
  });
}

/* ---------------- تليجرام ---------------- */
export async function renderTelegram(container) {
  loading(container);
  const tg = await readNode('settings/telegram', { botToken: '', chatId: '' });
  const subs = await readNode('subscribers', {});
  const linked = Object.values(subs || {}).filter(s => s && s.telegramChatId).length;

  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div><h3>${ICONS.send} بوت تليجرام</h3><p class="ex-eg-hint">
        البوت هو قلب الإشعارات: كل طلب جديد بيوصلك عليه بأزرار قبول/رفض، وكل عميل ربط تليجرامه بيوصله تحديثات طلبه والمنتجات الجديدة والخصومات — من غير ما يحتاج يسمح بإشعارات المتصفح.
      </p></div></div>

      <ol class="ex-eg-tg-steps">
        <li><b>افتح <span dir="ltr">@BotFather</span> على تليجرام</b> واكتب <code dir="ltr">/newbot</code>، سمّي البوت، وانسخ التوكن اللي هيديهولك.</li>
        <li><b>الصق التوكن تحت</b> واضغط "تأكد من البوت".</li>
        <li><b>افتح البوت واضغط Start</b> (أو ضيفه في جروب الشغل واكتب أي رسالة) وبعدين اضغط "اربط الشات تلقائياً".</li>
      </ol>

      <div class="ex-eg-field"><label>Bot Token</label><input id="s-tg-token" value="${esc(tg.botToken || '')}" dir="ltr" placeholder="123456:ABC-..."></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="ex-eg-btn ex-eg-ghost" id="check-tg">${ICONS.check} تأكد من البوت</button>
      </div>
      <div class="ex-eg-tg-bot" id="tg-bot-info" ${tg.botUsername ? '' : 'hidden'}>
        ${tg.botUsername ? `🤖 <b dir="ltr">@${tg.botUsername}</b> — البوت شغال` : ''}
      </div>

      <div class="ex-eg-field"><label>Chat ID (الشات اللي هتوصله الطلبات)</label><input id="s-tg-chat" value="${esc(tg.chatId || '')}" dir="ltr" placeholder="-100123456789"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="ex-eg-btn ex-eg-ghost" id="detect-tg">${ICONS.bell} اربط الشات تلقائياً</button>
        <button class="ex-eg-btn" id="save-tg">${ICONS.check} حفظ</button>
        <button class="ex-eg-btn ex-eg-ghost" id="test-tg">${ICONS.send} رسالة تجريبية</button>
      </div>
      <div class="ex-eg-tg-help" id="tg-help" hidden></div>

      <hr class="ex-eg-backup-sep">
      <h4 class="ex-eg-backup-h">${ICONS.storefront} بوت لكل فرع</h4>
      <p class="ex-eg-hint" style="margin-bottom:10px">
        طلبات كل فرع توصل لشاته هو بس — مع صورة التحويل وأزرار القبول والرفض.<br>
        سيب التوكن فاضي عشان الفرع يستخدم البوت الرئيسي، أو حط توكن بوت مستقل للفرع.
        أي فرع من غير Chat ID طلباته هتروح للشات الرئيسي فوق.
      </p>
      <div id="tg-branches"><div class="ex-eg-empty-d">جاري تحميل الفروع...</div></div>

      <div class="ex-eg-tg-linked">${ICONS.users} <b>${linked}</b> عميل مربوط بالبوت وبيستقبل إشعاراته على تليجرام</div>
    </div>`;

  const $ = s => container.querySelector(s);
  const token = () => $('#s-tg-token').value.trim();
  /* شرح واضح لسبب الفشل بدل رسالة تليجرام العامة */
  const showTgHelp = (html) => { const b = $('#tg-help'); if (!b) return; b.hidden = false; b.innerHTML = html; };

  /* ---------- بوت/شات لكل فرع ---------- */
  const branches = await readNode('branches', {}) || {};
  const branchIds = Object.keys(branches);
  const box = $('#tg-branches');
  box.innerHTML = branchIds.length ? branchIds.map((id) => {
    const b = branches[id] || {};
    const cfg = ((tg.branches || {})[id]) || {};
    const nm = (b.name && (b.name.ar || b.name.en)) || id;
    return `
      <div class="ex-eg-tg-branch" data-branch="${esc(id)}">
        <div class="ex-eg-tgb-head">${ICONS.storefront} <b>${esc(nm)}</b>
          <span class="ex-eg-tgb-state" data-state="${esc(id)}">${cfg.chatId ? 'مربوط ✓' : 'بيستخدم البوت الرئيسي'}</span>
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>Chat ID للفرع</label>
            <input data-tgchat="${esc(id)}" value="${esc(cfg.chatId || '')}" dir="ltr" placeholder="-100123456789"></div>
          <div class="ex-eg-field"><label>توكن بوت خاص (اختياري)</label>
            <input data-tgtoken="${esc(id)}" value="${esc(cfg.botToken || '')}" dir="ltr" placeholder="سيبه فاضي = البوت الرئيسي"></div>
        </div>
        <button class="ex-eg-btn ex-eg-sm ex-eg-ghost" data-tgtest="${esc(id)}">${ICONS.send} رسالة تجريبية للفرع</button>
      </div>`;
  }).join('') : `<div class="ex-eg-empty-d">مفيش فروع — ضيف فرع من قسم "الفروع" الأول</div>`;

  /* اختبار فرع بعينه بنفس المنطق اللي بيستخدمه الإرسال الحقيقي */
  box.querySelectorAll('[data-tgtest]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.tgtest;
    const chatId = box.querySelector(`[data-tgchat="${id}"]`).value.trim();
    const bt = box.querySelector(`[data-tgtoken="${id}"]`).value.trim() || token();
    if (!chatId) { toast('اكتب Chat ID للفرع الأول', 'error'); return; }
    if (!bt) { toast('مفيش توكن — لا للفرع ولا رئيسي', 'error'); return; }
    btn.disabled = true;
    try {
      const r = await fetch(`https://api.telegram.org/bot${bt}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: '✅ رسالة تجريبية لفرع — الطلبات هتوصل هنا' }),
      });
      const d = await r.json();
      if (d.ok) { toast('اتبعتت للفرع ✓', 'success'); }
      else if (/chat not found|bot was blocked/i.test(d.description || '')) {
        showTgHelp('الشات ده لسه مافتحش محادثة مع البوت. افتح البوت من حساب الفرع (أو ضيفه في جروب الفرع) واضغط <b>Start</b>، وبعدين جرّب تاني.');
        toast('لازم Start مع البوت الأول', 'error');
      } else { toast('فشل: ' + (d.description || ''), 'error'); }
    } catch (e) { toast('حصل خطأ في الإرسال', 'error'); }
    btn.disabled = false;
  }));

  /* بيتجمّع وقت الحفظ */
  const readBranchCfg = () => {
    const out = {};
    box.querySelectorAll('[data-branch]').forEach((row) => {
      const id = row.dataset.branch;
      const chatId = row.querySelector(`[data-tgchat="${id}"]`).value.trim();
      const botToken = row.querySelector(`[data-tgtoken="${id}"]`).value.trim();
      if (chatId || botToken) out[id] = Object.assign({}, chatId ? { chatId } : {}, botToken ? { botToken } : {});
    });
    return out;
  };

  $('#check-tg').addEventListener('click', async () => {
    if (!token()) { toast('الصق التوكن الأول', 'error'); return; }
    const btn = $('#check-tg'); btn.disabled = true;
    try {
      const info = await getBotInfo(token());
      const box = $('#tg-bot-info');
      box.hidden = false;
      box.innerHTML = `🤖 <b dir="ltr">@${info.username}</b> — ${info.first_name || ''} · البوت شغال ✓`;
      /* اليوزرنيم بيتخزن في الإعدادات العامة عشان لينك ربط العملاء يبقى متاح للموقع */
      try { await set(ref(db, 'settings/features/telegramBot'), info.username); } catch (e) { /* صلاحية owner */ }
      toast('البوت اتأكد ✓', 'success');
    } catch (e) { toast(e.message || 'التوكن مش صحيح', 'error'); }
    btn.disabled = false;
  });

  $('#detect-tg').addEventListener('click', async () => {
    if (!token()) { toast('الصق التوكن الأول', 'error'); return; }
    const btn = $('#detect-tg'); btn.disabled = true;
    try {
      const { chatId, title } = await detectAdminChatId(token());
      $('#s-tg-chat').value = chatId;
      toast(`اتربط بـ ${title || chatId} — اضغط حفظ`, 'success');
    } catch (e) { toast(e.message || 'تعذر قراءة رسائل البوت', 'error'); }
    btn.disabled = false;
  });

  $('#save-tg').addEventListener('click', async () => {
    if (!token() || !$('#s-tg-chat').value.trim()) { toast('اكمل التوكن والشات الأول', 'error'); return; }
    try {
      let botUsername = tg.botUsername || '';
      try { botUsername = (await getBotInfo(token())).username; } catch (e) { /* نسيب القديم */ }
      await set(ref(db, 'settings/telegram'), {
        botToken: token(), chatId: $('#s-tg-chat').value.trim(), botUsername,
        branches: readBranchCfg(),   // شات/توكن كل فرع
      });
      if (botUsername) { try { await set(ref(db, 'settings/features/telegramBot'), botUsername); } catch (e) { /* ignore */ } }
      toast('اتحفظت إعدادات تليجرام — البوت شغال دلوقتي', 'success');
    } catch (e) { toast('مفيش صلاحية للحفظ', 'error'); }
  });

  $('#test-tg').addEventListener('click', async () => {
    const chatId = $('#s-tg-chat').value.trim();
    if (!token() || !chatId) { toast('اكتب التوكن والشات الأول', 'error'); return; }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: '✅ رسالة تجريبية من لوحة تحكم Bakery' }) });
      const data = await res.json();
      if (data.ok) { toast('اتبعتت الرسالة بنجاح', 'success'); return; }

      /* تليجرام بيمنع أي بوت يبعت لحد لسه مافتحش معاه محادثة — وده أشهر سبب
         للفشل هنا. الرسالة العامة ("chat not found") مابتقولش ده، فبنوضّحه. */
      const d = String(data.description || '');
      const bot = (await getBotInfo(token()).catch(() => null));
      const at = bot && bot.username ? '@' + bot.username : 'البوت';
      if (/chat not found|bot was blocked|user is deactivated/i.test(d)) {
        showTgHelp(`افتح تليجرام ودوّر على ${at} واضغط <b>Start</b>، وبعدين ارجع هنا واضغط "اكتشف رقم المحادثة" تاني.<br>
          تليجرام مابيسمحش للبوت يبعتلك غير بعد ما تبدأ معاه محادثة.`);
        toast('لازم تضغط Start مع البوت الأول', 'error');
      } else if (/unauthorized/i.test(d)) {
        showTgHelp('التوكن غلط أو اتلغى — هاته من BotFather من جديد.');
        toast('التوكن غلط', 'error');
      } else {
        toast('فشل: ' + d, 'error');
      }
    } catch (e) { toast('حصل خطأ في الإرسال — اتأكد من النت', 'error'); }
  });
}
