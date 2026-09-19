import { ICONS } from '../../js/icons.js';
import { db, ref, onValue, update, auth, onAuthStateChanged, get, runTransaction } from '../../js/firebase-config.js';
import { notifyTelegram, pollTelegramDecisions } from '../../js/telegram.js';
import { requireAuth, logout, getAdminProfile, can, isAdminConfigured, bootstrapOwner, isOwnerEmail, recoverOwner, sendOwnerVerification } from './auth.js';
import { bindOrVerifyDevice, requestDeviceTransfer, watchMyBinding, claimDeviceForOwner } from './session.js';
import { renderOverview } from './overview.js';
import { renderOrders } from './orders.js';
import { renderMenuEditor } from './menuEditor.js';
import { renderBranches } from './branches.js';
import { renderCustomers } from './customers.js';
import { renderIdentity, renderBanners, renderContact, renderPayments, renderGovernorates, renderFeatures, renderTelegram } from './settings.js';
import { renderFeedback } from './feedback.js';
import { renderAdmins } from './admins.js';
import { renderDiscounts } from './discounts.js';
import { renderBackup } from './backup.js';
import { renderWorker } from './worker.js';
import { showStuck, bootProgress } from './boot-guard.js';
import { esc } from '../../js/escape.js';

const root = document.getElementById('dash-root');

export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `ex-eg-toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('ex-eg-show'), 10);
  setTimeout(() => { el.classList.remove('ex-eg-show'); setTimeout(() => el.remove(), 300); }, 3200);
}

const SECTIONS = [
  { key: 'overview', group: 'main', label: 'نظرة عامة', icon: ICONS.chart, render: renderOverview, perm: null },
  { key: 'orders', group: 'sales', label: 'الطلبات', icon: ICONS.bag, render: renderOrders, perm: 'orders' },
  { key: 'menu', group: 'catalog', label: 'المنيو', icon: ICONS.grid, render: renderMenuEditor, perm: 'menu' },
  { key: 'discounts', group: 'sales', label: 'الخصومات', icon: ICONS.receipt, render: renderDiscounts, perm: 'menu' },
  { key: 'branches', group: 'catalog', label: 'الفروع', icon: ICONS.storefront, render: renderBranches, perm: 'branches' },
  { key: 'customers', group: 'customers', label: 'العملاء', icon: ICONS.users, render: renderCustomers, perm: 'customers' },
  { key: 'feedback', group: 'customers', label: 'آراء العملاء', icon: ICONS.chat, render: renderFeedback, perm: 'feedback' },
  { key: 'identity', group: 'settings', label: 'هوية المحل', icon: ICONS.storefront, render: renderIdentity, perm: 'settings.identity' },
  { key: 'banners', group: 'settings', label: 'صور البانر', icon: ICONS.images, render: renderBanners, perm: 'settings.banners' },
  { key: 'payments', group: 'settings', label: 'بوابات الدفع', icon: ICONS.cash, render: renderPayments, perm: 'settings.payments' },
  { key: 'governorates', group: 'settings', label: 'محافظات التوصيل', icon: ICONS.truck, render: renderGovernorates, perm: 'settings.governorates' },
  { key: 'contact', group: 'settings', label: 'التواصل والعنوان', icon: ICONS.phone, render: renderContact, perm: 'settings.contact' },
  { key: 'features', group: 'settings', label: 'الإشعارات والتطبيق', icon: ICONS.bell, render: renderFeatures, perm: 'settings.features' },
  { key: 'telegram', group: 'settings', label: 'بوت تليجرام', icon: ICONS.send, render: renderTelegram, perm: 'settings.telegram' },
  { key: 'admins', group: 'admin', label: 'الأدمنز والصلاحيات', icon: ICONS.shield, render: renderAdmins, perm: 'owner' },
  { key: 'backup', group: 'admin', label: 'نسخة احتياطية', icon: ICONS.upload, render: renderBackup, perm: 'owner' },
  { key: 'worker', group: 'admin', label: 'وركر الإشعارات', icon: ICONS.bell, render: renderWorker, perm: 'owner' },
];

let currentProfile = null;
export function getProfile() { return currentProfile; }

function allowed(section) {
  if (!section.perm) return true;
  if (section.perm === 'owner') return currentProfile && currentProfile.role === 'owner';
  return can(currentProfile, section.perm);
}

/* أي قراءة من القاعدة ممكن تفضل معلّقة لو الاتصال اتقطع — بنحط لها مهلة
   عشان اللوحة ماتفضلش على شاشة اللوجو للأبد. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة ' + label)), ms)),
  ]);
}

function boot() {
  let started = false;
  bootProgress('بيتأكد من تسجيل الدخول');

  onAuthStateChanged(auth, async (user) => {
    if (!user) { bootProgress('شاشة الدخول'); currentProfile = null; requireAuth(root, () => {}); return; }
    try {
      bootProgress('بيقرا صلاحياتك');
      currentProfile = await withTimeout(getAdminProfile(user.uid), 20000, 'قراءة الصلاحيات');
      bootProgress('اتقرت الصلاحيات');
      if (!currentProfile && !(await withTimeout(isAdminConfigured(), 12000, 'إعدادات النظام'))) {
        try { await bootstrapOwner(user); currentProfile = await getAdminProfile(user.uid); } catch (e) { /* rules not applied yet */ }
      }
      if (currentProfile === undefined) {
        // القراءة فشلت — مش "مفيش صلاحية". نوري رسالة اتصال وزرار إعادة محاولة.
        showStuck('تعذر الوصول لقاعدة البيانات — اتأكد من الإنترنت واضغط تحديث.');
        return;
      }
      if (!currentProfile) { renderNoAccess(user); return; }
      /* فحص الجهاز لازم يتم. لو فشل مابنفتحش اللوحة — قبل كده كان بيسمح
         بالدخول عند أي خطأ قراءة، وده كان بيخلّي ربط الجهاز بلا معنى. */
      bootProgress('بيتحقق من الجهاز');
      /* ألوان اللوحة قراءة مستقلة — بتمشي بالتوازي مع فحص الجهاز بدل ما
         تضيف رحلة زيادة على الطريق قبل ما اللوحة تظهر. */
      const brandJob = withTimeout(applyBrand(), 6000, 'ألوان اللوحة').catch(() => {});
      const device = await withTimeout(bindOrVerifyDevice(user.uid), 15000, 'فحص الجهاز')
        .catch(() => ({ ok: false, unverified: true }));
      if (device.unverified) { renderDeviceUnverified(); return; }
      if (!device.ok) { renderWrongDevice(device, user); return; }
      if (!started || !document.querySelector('.ex-eg-shell')) {
        started = true;
        bootProgress('بيجهّز اللوحة');
        await brandJob;
        renderShell();
        /* وصلنا للوحة ⇒ الجلسة سليمة، فبنصفّر عدّاد الفشل */
        try { sessionStorage.removeItem('dash_fail_count'); } catch (err) { /* ignore */ }
      }
    } catch (e) {
      showStuck((e && e.message) || 'تعذر تحميل اللوحة');
    }
  });
}

async function applyBrand() {
  try {
    const snap = await get(ref(db, 'menu/primaryColor'));
    const c = snap.exists() ? snap.val() : (window.MENU_DATA && window.MENU_DATA.primaryColor);
    if (c) document.documentElement.style.setProperty('--primary', c);
  } catch (e) { /* keep default */ }
}

/* مقدرناش نتحقق إن الجهاز ده مصرّح له — مفيش دخول من غير تحقق */
function renderDeviceUnverified() {
  root.innerHTML = `
    <div class="ex-eg-auth-screen"><div class="ex-eg-auth-card">
      <img class="ex-eg-auth-logo" src="../assets/logo.png?v=4" alt="">
      <h1>تعذّر التحقق من الجهاز</h1>
      <p>مقدرناش نتأكد إن الجهاز ده مصرّح له يفتح اللوحة — غالباً الاتصال ضعيف.<br>
         لأمان حسابك مش هنفتح اللوحة من غير التحقق ده.</p>
      <button id="du-retry">إعادة المحاولة</button>
      <button id="du-logout" style="background:var(--primary-light);color:var(--primary);box-shadow:none;margin-top:8px">تسجيل خروج</button>
    </div></div>`;
  root.querySelector('#du-retry').addEventListener('click', () => location.reload());
  root.querySelector('#du-logout').addEventListener('click', () => logout().then(() => location.reload()));
}

function renderWrongDevice(info, user) {
  const when = info.at ? new Date(info.at).toLocaleDateString('ar-EG') : '';
  const isOwner = !!(currentProfile && currentProfile.role === 'owner');
  const paint = (pending) => {
    root.innerHTML = `
      <div class="ex-eg-auth-screen"><div class="ex-eg-auth-card">
        <img class="ex-eg-auth-logo" src="../assets/logo.png?v=4" alt="">
        <h1>${pending ? 'في انتظار الموافقة' : 'جهاز غير مصرّح له'}</h1>
        <p>${pending
          ? 'تم إرسال طلب نقل الحساب لهذا الجهاز. بمجرد موافقة المالك هيفتح تلقائياً.'
          : `الحساب مربوط بجهاز <b>${esc(info.boundTo || '')}</b>${when ? ` منذ ${when}` : ''}.<br>${isOwner ? 'إنت المالك — تقدر تنقله للجهاز ده بعد تأكيد إيميلك.' : 'تقدر تطلب نقله للجهاز ده، والمالك هو اللي يوافق.'}`}</p>
        <div class="ex-eg-auth-error" id="wd-msg" hidden></div>
        ${pending ? '' : `<button id="wd-request">${isOwner ? 'انقل الحساب لهذا الجهاز' : 'اطلب نقل الحساب لهذا الجهاز'}</button>`}
        <button id="wd-logout" style="background:var(--primary-light);color:var(--primary);box-shadow:none;margin-top:8px">تسجيل خروج</button>
      </div></div>`;
    const msg = root.querySelector('#wd-msg');
    const say = (m) => { msg.hidden = false; msg.textContent = m; };
    const req = root.querySelector('#wd-request');
    if (req) req.addEventListener('click', async () => {
      req.disabled = true;
      try {
        if (isOwner) {
          /* نقل الحساب لجهاز جديد لازم يعدّي على إيميل المالك — الباسورد
             لوحده مش كفاية، وإلا كان ربط الجهاز بلا فايدة. */
          await claimDeviceForOwner(user.uid);
          location.reload();
          return;
        }
        await requestDeviceTransfer(user.uid);
        paint(true);
      } catch (e) {
        req.disabled = false;
        if (e && e.code === 'needs-verify') {
          try {
            await sendOwnerVerification(user);
            say('بعتنا رابط تأكيد على ' + (user.email || 'إيميلك') + ' — افتحه واضغط الرابط، وبعدين ارجع هنا واضغط الزرار تاني.');
          } catch (e2) { say('تعذر إرسال رابط التأكيد — حاول بعد دقيقة.'); }
        } else { say('تعذر تنفيذ العملية — حاول تاني.'); }
      }
    });
    root.querySelector('#wd-logout').addEventListener('click', () => logout().then(() => location.reload()));
  };
  paint(info.pending);
  watchMyBinding(user.uid, () => location.reload());
}

function renderNoAccess(user) {
  root.innerHTML = `
    <div class="ex-eg-auth-screen"><div class="ex-eg-auth-card">
      <h1>لا توجد صلاحية</h1>
      <p>الحساب <b dir="ltr">${esc(user.email || '')}</b> مش مضاف كأدمن. لو انت المالك وده أول دخول اضغط "إعادة المحاولة". غير كده اطلب من المالك يضيفك من "الأدمنز والصلاحيات".</p>
      <p style="font-size:12px;color:var(--muted)">لو الحساب ده اتمسح واتعمل من جديد من Firebase، رقمه اتغيّر ولازم يتضاف تاني.<br>رقم الحساب: <code dir="ltr">${esc(user.uid || '')}</code></p>
      <div id="na-recover-box" hidden>
        <div class="ex-eg-auth-error" id="na-msg" hidden></div>
        <button id="na-recover">استعادة حساب المالك</button>
      </div>
      <button id="na-retry" style="background:var(--primary-light);color:var(--primary);box-shadow:none;margin-top:8px">إعادة المحاولة</button>
      <button id="na-logout" style="background:var(--primary-light);color:var(--primary);box-shadow:none;margin-top:8px">تسجيل خروج</button>
    </div></div>`;
  root.querySelector('#na-logout').addEventListener('click', () => logout());
  root.querySelector('#na-retry').addEventListener('click', () => location.reload());

  /* الإيميل ده هو إيميل المالك المسجّل؟ يبقى نعرض زرار الاستعادة (بيتأكد من الإيميل الأول) */
  const box = root.querySelector('#na-recover-box'), msg = root.querySelector('#na-msg'), btn = root.querySelector('#na-recover');
  const say = (m) => { msg.hidden = false; msg.textContent = m; };
  isOwnerEmail(user).then((yes) => { if (yes) box.hidden = false; });
  btn.addEventListener('click', async () => {
    btn.disabled = true; msg.hidden = true;
    try {
      const r = await recoverOwner(user);
      if (r.needsVerify) {
        say('بعتنالك رابط تأكيد على ' + (user.email || 'إيميلك') + ' — افتحه واضغط على الرابط، وبعدين ارجع هنا واضغط "استعادة حساب المالك" تاني.');
      } else {
        say('تمت الاستعادة — بيتم فتح اللوحة...');
        setTimeout(() => location.reload(), 800);
        return;
      }
    } catch (e) {
      say(e && e.code === 'auth/too-many-requests' ? 'طلبات كتير — استنى دقيقة وجرب تاني' : 'تعذر الاستعادة — اتأكد إنك ضغطت رابط التأكيد اللي وصلك وحاول تاني.');
    }
    btn.disabled = false;
  });
}

function renderShell() {
  const initialSection = (location.hash || '#overview').replace('#', '');
  const visible = SECTIONS.filter(allowed);
  root.innerHTML = `
    <div class="ex-eg-sidebar-overlay" id="sidebar-overlay"></div>
    <div class="ex-eg-mobile-topbar">
      <button id="open-sidebar">${ICONS.menu}</button>
      <strong id="mobile-title">لوحة التحكم</strong>
      <button id="mobile-logout">${ICONS.logout}</button>
    </div>
    <div class="ex-eg-shell">
      <aside class="ex-eg-sidebar" id="sidebar">
        <div class="ex-eg-brand"><img src="../assets/logo.png?v=4" alt=""><span>منوعات عباد الرحمان</span></div>
        <div class="ex-eg-who">${ICONS.shield}<span>${currentProfile.name || currentProfile.email}</span><small>${currentProfile.role === 'owner' ? 'مالك' : 'موظف'}</small></div>
        <nav id="nav-list"></nav>
        <div class="ex-eg-sidebar-footer">
          <a class="ex-eg-nav-item" href="../index.html" target="_blank" rel="noopener">${ICONS.storefront}<span>عرض المتجر</span></a>
          <a class="ex-eg-nav-item" href="../privacy-policy.html" target="_blank" rel="noopener">${ICONS.shield}<span>الخصوصية والسياسة</span></a>
          <button class="ex-eg-nav-item" id="logout-btn">${ICONS.logout}<span>تسجيل خروج</span></button>
        </div>
      </aside>
      <div class="ex-eg-main">
        <div class="ex-eg-topbar-d">
          <h2 id="section-title"></h2>
          <a class="ex-eg-storefront-link" href="../index.html" target="_blank" rel="noopener">${ICONS.storefront} عرض المتجر</a>
        </div>
        <div class="ex-eg-content" id="content"></div>
      </div>
    </div>
  `;

  const navList = root.querySelector('#nav-list');
  /* المجموعات بتتبني من حقل `group` اللي في SECTIONS نفسه — مش من قوايم
     أسماء مكتوبة بالإيد. القايمة القديمة كانت بتفلتر "نظرة عامة" بشرط
     `!s.group` مع إن مجموعتها 'main'، فالقسم كان بيختفي من القايمة خالص.
     كده أي قسم جديد بيظهر تلقائياً طول ما ليه group. */
  const GROUP_LABELS = [
    ['main', 'الرئيسية'],
    ['sales', 'التشغيل'],
    ['catalog', 'المحتوى'],
    ['customers', 'العملاء'],
    ['settings', 'الإعدادات'],
    ['admin', 'الإدارة'],
  ];
  const groups = GROUP_LABELS
    .map(([key, label]) => ({ key, label, items: visible.filter(s => (s.group || 'main') === key) }))
    .filter(group => group.items.length);
  /* أي قسم مجموعته مش في القايمة فوق مايضيعش — بيتحط في "الرئيسية" */
  const grouped = new Set(groups.flatMap(g => g.items.map(s => s.key)));
  const orphans = visible.filter(s => !grouped.has(s.key));
  if (orphans.length) {
    const main = groups.find(g => g.key === 'main');
    if (main) main.items.push(...orphans);
    else groups.unshift({ key: 'main', label: 'الرئيسية', items: orphans });
  }
  navList.innerHTML = groups.map((group, index) => `
    <div class="ex-eg-nav-group" data-group="${group.key}">
      <button class="ex-eg-nav-group-toggle" type="button" aria-expanded="${index === 0 ? 'true' : 'false'}"><span>${group.label}</span><span class="ex-eg-nav-chevron">⌄</span></button>
      <div class="ex-eg-nav-group-items" ${index === 0 ? '' : 'hidden'}>${group.items.map(s => `
        <button class="ex-eg-nav-item" data-key="${s.key}">${s.icon}<span>${s.label}</span>${s.key === 'orders' ? '<span class="ex-eg-nav-count" id="new-orders-count" hidden></span>' : ''}</button>
      `).join('')}</div>
    </div>
  `).join('');

  navList.querySelectorAll('.ex-eg-nav-group-toggle').forEach(toggle => toggle.addEventListener('click', () => {
    const items = toggle.nextElementSibling;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    items.hidden = expanded;
  }));

  function goTo(key) {
    let section = visible.find(s => s.key === key) || visible[0];
    if (!section) return;
    const group = navList.querySelector(`[data-group="${section.group}"]`);
    if (group) { group.querySelector('.ex-eg-nav-group-toggle').setAttribute('aria-expanded', 'true'); group.querySelector('.ex-eg-nav-group-items').hidden = false; }
    location.hash = section.key;
    navList.querySelectorAll('.ex-eg-nav-item').forEach(b => b.classList.toggle('ex-eg-active', b.dataset.key === section.key));
    root.querySelector('#section-title').textContent = section.label;
    root.querySelector('#mobile-title').textContent = section.label;
    const contentEl = root.querySelector('#content');
    const view = document.createElement('div');
    view.className = 'ex-eg-section-view';
    view.innerHTML = '<div class="ex-eg-empty-d">جاري التحميل...</div>';
    contentEl.replaceChildren(view);
    contentEl.classList.remove('ex-eg-fade-in'); void contentEl.offsetWidth; contentEl.classList.add('ex-eg-fade-in');
    try {
      Promise.resolve(section.render(view, { profile: currentProfile })).catch(() => {
        if (view.isConnected) view.innerHTML = '<div class="ex-eg-empty-d">تعذر تحميل القسم — جرّب تاني</div>';
      });
    } catch (e) {
      view.innerHTML = '<div class="ex-eg-empty-d">تعذر تحميل القسم — جرّب تاني</div>';
    }
    closeSidebar();
  }

  navList.querySelectorAll('.ex-eg-nav-item').forEach(btn => btn.addEventListener('click', () => goTo(btn.dataset.key)));
  root.querySelector('#logout-btn').addEventListener('click', () => logout());
  root.querySelector('#mobile-logout').addEventListener('click', () => logout());

  const sidebar = root.querySelector('#sidebar');
  const overlay = root.querySelector('#sidebar-overlay');
  function closeSidebar() { sidebar.classList.remove('ex-eg-open'); overlay.classList.remove('ex-eg-show'); }
  root.querySelector('#open-sidebar').addEventListener('click', () => { sidebar.classList.add('ex-eg-open'); overlay.classList.add('ex-eg-show'); });
  overlay.addEventListener('click', closeSidebar);

  goTo(initialSection);
  /* زرار الرجوع في المتصفح / لينك مباشر بقسم معيّن */
  window.addEventListener('hashchange', () => {
    const key = (location.hash || '#overview').replace('#', '');
    const active = navList.querySelector('.ex-eg-nav-item.ex-eg-active');
    if (!active || active.dataset.key !== key) goTo(key);
  });

  if (allowed(SECTIONS[1])) {
    onValue(ref(db, 'orders'), (snap) => {
      let count = 0;
      const pending = [];
      const snapshotOrders = [];
      /* أدمن مربوط بفرع: العدّاد والتنبيه لطلبات فرعه بس */
      const myBranch = currentProfile && currentProfile.role !== 'owner' && currentProfile.branchId ? String(currentProfile.branchId) : '';
      snap.forEach(child => {
        const o = child.val() || {};
        snapshotOrders.push({ id: child.key, ...o });
        if (myBranch && o.branchId !== myBranch) return;
        if (o.status === 'new') {
          count++;
          // relay recent, not-yet-announced orders to Telegram from this signed-in session
          if (!o.telegramSent && Date.now() - (o.createdAt || 0) < 3600000) pending.push({ id: child.key, order: o });
        }
      });
      window.__dashboardOrders = snapshotOrders;
      window.dispatchEvent(new CustomEvent('dashboard-orders-updated', { detail: snapshotOrders }));
      const badge = root.querySelector('#new-orders-count');
      if (badge) { badge.textContent = count; badge.hidden = count === 0; }
      document.title = count ? `(${count}) لوحة التحكم` : 'لوحة التحكم';
      /* حجز ذرّي قبل الإرسال.
         الطلب ممكن يشوفه أكتر من مرسِل في نفس الوقت (لوحة مفتوحة في تبويبين،
         أو لوحة + وركر) فكانت الرسالة بتتبعت مرتين. runTransaction بيخلي
         واحد بس يكسب العلامة، والباقي بيتراجع من غير ما يبعت. */
      pending.forEach(({ id, order }) => {
        runTransaction(ref(db, `orders/${id}/telegramSent`), (cur) => (cur ? undefined : true))
          .then((res) => { if (res.committed) notifyTelegram(order, id); })
          .catch(() => {});
      });
    }, () => {});

    /* أزرار القبول/الرفض في البوت: الوركر البايثون بيتولاها، ولو مش شغال
       اللوحة المفتوحة هي اللي بترد عليها. */
    const tgTick = () => pollTelegramDecisions().catch(() => {});
    tgTick();
    setInterval(tgTick, 6000);
  }
}

boot();
