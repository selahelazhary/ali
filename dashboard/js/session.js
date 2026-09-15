/* Device binding: an admin account works on one device only.
   The first device to sign in claims the account. Any other device can file a
   transfer request, which the owner approves from "الأدمنز والصلاحيات" — the bound
   device is never signed out on its own. */
import { db, ref, get, set, update, remove, onValue, auth } from '../../js/firebase-config.js';

const DEVICE_KEY = 'ex_eg_device_id';

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 32);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Mac/i.test(ua) ? 'Mac' : 'جهاز';
  const br = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : '';
  return `${os} ${br}`.trim();
}

/* هل ربط الجهاز مفعّل؟ المفتاح في settings/features/deviceBinding
   (بيتظبط من "الإشعارات والتطبيق" في اللوحة). لو القراءة فشلت بنعتبره مقفول
   عشان عطل في الشبكة مايقفلش حد بره لوحته. */
async function deviceBindingOn() {
  try {
    const snap = await Promise.race([
      get(ref(db, 'settings/features/deviceBinding')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 5000)),
    ]);
    return snap.exists() && snap.val() === true;
  } catch (e) { return false; }
}

/* قراءة احتياطية عبر REST — بتشتغل حتى لو الـ WebSocket محجوب أو بطيء،
   فمانضطرش نتجاهل فحص الجهاز عشان قراءة فشلت. */
async function readRest(path) {
  const user = auth.currentUser;
  if (!user) throw new Error('no user');
  const token = await user.getIdToken();
  const base = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/${path}.json?auth=${encodeURIComponent(token)}`, { signal: ctrl.signal });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error('REST ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/* → { ok: true } لما الجهاز ده هو المربوط بالحساب،
     { ok: false, boundTo, pending } لما الحساب مربوط بجهاز تاني،
     { ok: false, unverified: true } لما مقدرناش نتحقق خالص.
   مهم: مفيش دخول من غير تحقق. فشل القراءة بيمنع الدخول ومايسمحش بيه. */
export async function bindOrVerifyDevice(uid) {
  /* الميزة اختيارية ومقفولة افتراضياً.
     السبب: رقم الجهاز بيتخزّن في المتصفح، وأي مسح لبيانات الموقع بيغيّره
     فصاحب الحساب يتقفل بره لوحته من نفس الجهاز اللي بيشتغل عليه.
     لما تكون مقفولة، الحماية هي الإيميل والباسورد + قواعد قاعدة البيانات. */
  if (!(await deviceBindingOn())) return { ok: true, disabled: true };
  const slot = ref(db, `admins/${uid}/boundDevice`);
  let current = null, read = false;
  try {
    const snap = await Promise.race([
      get(slot),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
    ]);
    current = snap.exists() ? snap.val() : null;
    read = true;
  } catch (e) {
    /* الـ SDK فشل — نجرّب REST قبل ما نمنع الدخول */
    try { current = await readRest(`admins/${uid}/boundDevice`); read = true; }
    catch (e2) { return { ok: false, unverified: true }; }
  }
  if (!read) return { ok: false, unverified: true };
  if (current && current.id) {
    if (current.id === deviceId()) return { ok: true };
    let pending = false;
    try {
      const reqSnap = await get(ref(db, `admins/${uid}/deviceRequest`));
      pending = reqSnap.exists() && reqSnap.val() && reqSnap.val().id === deviceId();
    } catch (e) { /* ignore */ }
    return { ok: false, boundTo: current.device || 'جهاز آخر', at: current.at || null, pending };
  }
  /* مفيش جهاز مربوط — الجهاز ده بياخد الحساب. لازم الكتابة تنجح، وإلا
     يبقى الحساب مش محمي فمانكملش. */
  try {
    await set(slot, { id: deviceId(), device: deviceLabel(), at: Date.now() });
  } catch (e) {
    return { ok: false, unverified: true, reason: 'bind-failed' };
  }
  return { ok: true, justBound: true };
}

export function requestDeviceTransfer(uid) {
  return set(ref(db, `admins/${uid}/deviceRequest`), { id: deviceId(), device: deviceLabel(), at: Date.now() });
}

/* Fires once the owner has approved this device. */
export function watchMyBinding(uid, onApproved) {
  const mine = deviceId();
  return onValue(ref(db, `admins/${uid}/boundDevice/id`), (snap) => {
    if (snap.val() === mine) onApproved();
  }, () => {});
}

/* Moving the binding and clearing the request happen in one atomic write. */
export function approveDeviceRequest(uid, request) {
  return update(ref(db, `admins/${uid}`), {
    boundDevice: { id: request.id, device: request.device || 'جهاز', at: Date.now() },
    deviceRequest: null,
  });
}
export function rejectDeviceRequest(uid) { return remove(ref(db, `admins/${uid}/deviceRequest`)); }
export function releaseDevice(uid) { return remove(ref(db, `admins/${uid}/boundDevice`)); }

/* المالك بينقل حسابه لجهاز جديد بنفسه — بس بشرط إن إيميله متأكَّد.
   السبب: من غير الشرط ده، أي حد معاه الباسورد كان يقدر ينقل الحساب لجهازه
   ويتخطّى ربط الجهاز بالكامل. دلوقتي لازم يوصل لإيميل المالك كمان. */
export async function claimDeviceForOwner(uid) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error('no user'), { code: 'no-user' });
  await user.reload();
  if (!user.emailVerified) throw Object.assign(new Error('unverified'), { code: 'needs-verify' });
  await user.getIdToken(true);
  await set(ref(db, `admins/${uid}/boundDevice`), { id: deviceId(), device: deviceLabel(), at: Date.now() });
  await remove(ref(db, `admins/${uid}/deviceRequest`));
}
