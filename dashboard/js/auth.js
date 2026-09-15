import { db, ref, get, set, auth } from '../../js/firebase-config.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut, getAuth,
  setPersistence, inMemoryPersistence, sendEmailVerification,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';

/* مفاتيح الصلاحيات بتتخزن في القاعدة — ممنوع فيها النقطة (.) لأن Firebase
   بيرفضها كاسم حقل، فبنستخدم الشرطة السفلية. */
export const PERMISSIONS = [
  { key: 'orders', label: 'الطلبات' },
  { key: 'menu', label: 'المنيو' },
  { key: 'branches', label: 'الفروع' },
  { key: 'customers', label: 'العملاء' },
  { key: 'feedback', label: 'آراء العملاء' },
  { key: 'settings_identity', label: 'هوية المحل' },
  { key: 'settings_banners', label: 'صور البانر' },
  { key: 'settings_payments', label: 'بوابات الدفع' },
  { key: 'settings_governorates', label: 'محافظات التوصيل' },
  { key: 'settings_contact', label: 'التواصل والعنوان' },
  { key: 'settings_features', label: 'الإشعارات والتطبيق' },
  { key: 'settings_telegram', label: 'بوت تليجرام' },
];
/* 'settings.identity' و 'settings_identity' الاتنين مقبولين */
export function permKey(key) { return String(key || '').replace(/\./g, '_'); }

export function allPermissions() {
  const p = {}; PERMISSIONS.forEach(x => p[x.key] = true); return p;
}

export function logout() { return fbSignOut(auth); }

/* قراءة مباشرة عبر REST — مش محتاجة اتصال لحظي (WebSocket) يفضل مفتوح.
   ده بينقذ الإقلاع لو الشبكة بتحجب WebSocket أو الاتصال بطيء.
   مهم: بترمي خطأ لو القراءة فشلت، وبترجّع null بس لو العقدة مش موجودة فعلاً —
   عشان مانخلطش بين "مفيش صلاحية" و"القراءة فشلت". */
async function readViaRest(path) {
  const user = auth.currentUser;
  if (!user) throw new Error('no user');
  const token = await user.getIdToken();
  const base = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${base}/${path}.json?auth=${encodeURIComponent(token)}`, { signal: ctrl.signal });
    /* 401/403 = قواعد الأمان رفضت — ده جواب أكيد إن الحساب ده مش مضاف (مش عطل شبكة) */
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error('REST ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* أول نتيجة حقيقية تكسب. لو كل المحاولات فشلت أو رجعت فاضية → null.
   الفشل (undefined) عمره ما يتحسب "مفيش سجل". */
function firstTruthy(promises) {
  return new Promise((resolve) => {
    let left = promises.length;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    promises.forEach(p => Promise.resolve(p).then(
      (v) => { if (v) finish(v); else if (--left === 0) finish(null); },
      () => { if (--left === 0) finish(null); },
    ));
  });
}

export async function getAdminProfile(uid) {
  const viaSdk = get(ref(db, `admins/${uid}`)).then(s => (s.exists() ? { uid, ...s.val() } : null));
  const viaRest = readViaRest(`admins/${uid}`).then(v => (v ? { uid, ...v } : null));
  const first = await firstTruthy([viaSdk, viaRest]);
  if (first) return first;
  /* مالقيناش سجل — نتأكد بقراءة أخيرة مباشرة قبل ما نقول "لا توجد صلاحية"،
     عشان عطل مؤقت في الشبكة مايقفلش المالك بره لوحته. */
  try {
    const confirm = await readViaRest(`admins/${uid}`);
    return confirm ? { uid, ...confirm } : null;
  } catch (e) {
    return undefined; // القراءة فشلت — مش معناها إن مفيش صلاحية
  }
}

export function can(profile, key) {
  if (!profile) return false;
  if (profile.role === 'owner') return true;
  const p = profile.permissions || {};
  const k = permKey(key);
  if (Object.prototype.hasOwnProperty.call(p, k)) return !!p[k];
  // صلاحية "settings" العامة القديمة بتغطي كل أقسام الإعدادات
  return k.startsWith('settings_') && !!p.settings;
}

/* Creates another admin account WITHOUT signing the current owner out:
   Firebase's client SDK signs in any newly created user, so we do it on a
   throw-away secondary app instance and discard it afterwards. */
export async function createStaffAdmin({ name, email, password, permissions, role = 'staff', branchId = '' }) {
  const secondary = initializeApp(auth.app.options, 'staff-' + Date.now());
  const secondaryAuth = getAuth(secondary);
  try {
    // in-memory only: the new account never touches browser storage, so the
    // signed-in owner can never be swapped out by creating a staff account
    await setPersistence(secondaryAuth, inMemoryPersistence);
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    } catch (e) {
      /* الإيميل له حساب بالفعل في Firebase (اتعمل قبل كده أو صلاحياته اتشالت):
         لو الباسورد المكتوب صح بنضيفه بنفس الحساب بدل ما نفشل. */
      if (e.code !== 'auth/email-already-in-use') throw e;
      try { cred = await signInWithEmailAndPassword(secondaryAuth, email, password); }
      catch (e2) { const err = new Error('exists'); err.code = 'auth/existing-wrong-password'; throw err; }
    }
    const uid = cred.user.uid;
    const existing = await get(ref(db, `admins/${uid}`)).then(s => (s.exists() ? s.val() : null)).catch(() => null);
    await set(ref(db, `admins/${uid}`), {
      ...(existing || {}),
      name, email, role: role === 'owner' ? 'owner' : 'staff',
      permissions: role === 'owner' ? allPermissions() : (permissions || {}),
      branchId: role === 'owner' ? '' : String(branchId || ''),
      createdAt: (existing && existing.createdAt) || Date.now(),
      createdBy: auth.currentUser ? auth.currentUser.uid : null,
    });
    await fbSignOut(secondaryAuth);
    return uid;
  } finally {
    try { await deleteApp(secondary); } catch (e) { /* ignore */ }
  }
}

const ERR = {
  'auth/wrong-password': 'الباسورد غلط',
  'auth/invalid-credential': 'الإيميل أو الباسورد غلط',
  'auth/user-not-found': 'مفيش حساب بالإيميل ده',
  'auth/invalid-email': 'الإيميل مش صحيح',
  'auth/too-many-requests': 'محاولات كتير غلط — استنى شوية وجرب تاني',
  'auth/email-already-in-use': 'الإيميل ده مستخدم بالفعل',
  'auth/existing-wrong-password': 'الإيميل ده له حساب بالفعل — اكتب باسورده الحالي عشان يتضاف بنفس الحساب',
  'auth/network-request-failed': 'مفيش اتصال بالإنترنت — حاول تاني',
  'auth/weak-password': 'الباسورد ضعيف — 6 حروف على الأقل',
  'auth/configuration-not-found': 'تعذر تسجيل الدخول — راجع إعدادات النظام',
  'auth/operation-not-allowed': 'تعذر تسجيل الدخول — راجع إعدادات النظام',
};
export function authError(err) { return ERR[err && err.code] || 'تعذر إتمام العملية — حاول تاني'; }

export async function isAdminConfigured() {
  const viaSdk = get(ref(db, 'settings/adminConfigured')).then(s => (s.exists() ? s.val() === true : false));
  const viaRest = readViaRest('settings/adminConfigured').then(v => v === true);
  return (await firstTruthy([viaSdk, viaRest])) === true;
}

/* The first signed-in user, while no owner has been recorded yet, becomes the owner.
   This also heals the case where the Auth account was created but the database
   write was blocked (e.g. security rules not pasted yet). */
export async function bootstrapOwner(user, name) {
  await set(ref(db, `admins/${user.uid}`), {
    name: name || user.displayName || (user.email || '').split('@')[0], email: user.email, role: 'owner', permissions: allPermissions(), createdAt: Date.now(),
  });
  await set(ref(db, 'settings/adminConfigured'), true);
  /* إيميل المالك — بيسمح باستعادة الملكية لو الحساب اتمسح واتعمل من جديد (UID جديد) */
  try { await set(ref(db, 'settings/ownerEmail'), user.email || ''); } catch (e) { /* اختياري */ }
}

/* بعت رابط تأكيد لإيميل الحساب الحالي */
export function sendOwnerVerification(user) { return sendEmailVerification(user); }

/* هل الحساب ده هو إيميل المالك المسجّل؟ (القواعد بتسمح بقراءة settings/ownerEmail
   بس للحساب اللي إيميله مطابق — فأي حد تاني بياخد رفض) */
export async function isOwnerEmail(user) {
  if (!user || !user.email) return false;
  try {
    const v = await readViaRest('settings/ownerEmail');
    return !!v && String(v).toLowerCase() === String(user.email).toLowerCase();
  } catch (e) { return false; }
}

/* استعادة حساب المالك بعد ما اتمسح واتعمل من جديد في Firebase:
   الشرط الأمني إن الإيميل يكون متأكَّد (رابط التأكيد وصله على إيميله فعلاً) —
   القواعد بتتحقق من auth.token.email_verified + مطابقة settings/ownerEmail. */
export async function recoverOwner(user, name) {
  await user.reload();
  if (!user.emailVerified) {
    await sendEmailVerification(user);
    return { needsVerify: true };
  }
  // التوكن لازم يتجدد عشان يشيل email_verified الجديدة
  await user.getIdToken(true);
  await set(ref(db, `admins/${user.uid}`), {
    name: name || user.displayName || (user.email || '').split('@')[0],
    email: user.email, role: 'owner', permissions: allPermissions(),
    createdAt: Date.now(), recoveredAt: Date.now(),
  });
  return { ok: true };
}

export async function requireAuth(root, onReady) {
  renderAuthScreen(root, await isAdminConfigured(), onReady);
}

function renderAuthScreen(root, adminConfigured, onReady) {
  root.innerHTML = `
    <div class="ex-eg-auth-screen">
      <div class="ex-eg-auth-card">
        <img class="ex-eg-auth-logo" src="../assets/logo.png" alt="">
        <h1>${adminConfigured ? 'دخول لوحة التحكم' : 'إعداد حساب المالك'}</h1>
        <p>${adminConfigured ? 'ادخل الإيميل والباسورد' : 'أول مرة فقط — الحساب ده هيكون له كل الصلاحيات'}</p>
        <div class="ex-eg-auth-error" id="auth-error" hidden></div>
        ${adminConfigured ? '' : '<input type="text" id="name" placeholder="الاسم" autocomplete="name">'}
        <input type="email" id="email" placeholder="الإيميل" autocomplete="email" dir="ltr">
        <input type="password" id="pw1" placeholder="الباسورد" autocomplete="${adminConfigured ? 'current-password' : 'new-password'}" dir="ltr">
        ${adminConfigured ? '' : '<input type="password" id="pw2" placeholder="تأكيد الباسورد" dir="ltr">'}
        <button id="auth-submit">${adminConfigured ? 'دخول' : 'إنشاء الحساب'}</button>
        
      </div>
    </div>
  `;
  const $ = (s) => root.querySelector(s);
  const errBox = $('#auth-error'), submit = $('#auth-submit');
  const showError = (m) => { errBox.hidden = false; errBox.textContent = m; };

  submit.addEventListener('click', async () => {
    const email = $('#email').value.trim();
    const p1 = $('#pw1').value;
    errBox.hidden = true; submit.disabled = true;
    try {
      if (adminConfigured) {
        if (!email || !p1) { showError('اكتب الإيميل والباسورد'); submit.disabled = false; return; }
        await signInWithEmailAndPassword(auth, email, p1);
      } else {
        const name = $('#name').value.trim(), p2 = $('#pw2').value;
        if (!name || !email) { showError('اكتب الاسم والإيميل'); submit.disabled = false; return; }
        if (!p1 || p1.length < 6) { showError('الباسورد لازم يكون 6 حروف/أرقام على الأقل'); submit.disabled = false; return; }
        if (p1 !== p2) { showError('الباسوردين مش متطابقين'); submit.disabled = false; return; }
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(auth, email, p1);
        } catch (e) {
          if (e.code !== 'auth/email-already-in-use') throw e;
          cred = await signInWithEmailAndPassword(auth, email, p1);
        }
        try {
          await bootstrapOwner(cred.user, name);
        } catch (e) {
          showError('تم إنشاء الحساب لكن تعذر حفظ الصلاحيات — حاول تاني.');
          submit.disabled = false;
          return;
        }
      }
      onReady();
    } catch (err) {
      submit.disabled = false;
      showError(authError(err));
    }
  });
  root.querySelectorAll('input').forEach(el => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit.click(); }));
}
