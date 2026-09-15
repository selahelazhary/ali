import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
import {
  getDatabase, ref, get, set, push, update, remove, onValue, child, query, limitToLast, orderByChild, runTransaction,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBGp0GjrSqv7vKKhK0ayubzispEpkFmakA",
  authDomain: "alih-5212b.firebaseapp.com",
  databaseURL: "https://alih-5212b-default-rtdb.firebaseio.com",
  projectId: "alih-5212b",
  storageBucket: "alih-5212b.firebasestorage.app",
  messagingSenderId: "765951629862",
  appId: "1:765951629862:web:927037acddb01e7685a4e7",
  measurementId: "G-QBYQN23SPE",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export { ref, get, set, push, update, remove, onValue, child, query, limitToLast, orderByChild, runTransaction, signInAnonymously, onAuthStateChanged, signOut };

analyticsSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function loadMenuFromFirebase() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${firebaseConfig.databaseURL}/menu.json`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.ok) return await response.json();
  } catch (err) {
    console.warn("Firebase menu load failed:", err.message);
  } finally {
    clearTimeout(timeout);
  }
  return null;
}

/* Public, read-only store configuration the storefront needs at checkout.
   Each node falls back gracefully when empty or unreadable. */
export async function loadPublicSettings() {
  const read = async (path) => {
    try {
      const snap = await withTimeout(get(ref(db, path)), 10000);
      return snap && snap.exists() ? snap.val() : null;
    } catch (e) { return null; }
  };
  const [branches, payments, governorates, features] = await Promise.all([
    read('branches'), read('settings/payments'), read('settings/governorates'), read('settings/features'),
  ]);
  const branchList = branches ? Object.entries(branches).map(([id, b]) => ({ id, ...b })).filter(b => b.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  return { branches: branchList, payments, governorates, features };
}

// Kept for the classic (non-module-import) consumer in app.js
window.__firebaseMenuPromise = loadMenuFromFirebase();

/* تسجيل دخول مجهول للزائر.
   ليه: من غيره أي حد يقدر يكتب تقييمات وآراء وطلبات بأي معرّف يخترعه، والقواعد
   مش لاقية حاجة تربطها بيه. مع الدخول المجهول بيبقى لكل زائر معرّف ثابت من
   فايربيز، فالقواعد تقدر تقول "التقييم ده لازم يكون بمعرّفك إنت".
   لو الميزة مش مفعّلة في إعدادات المشروع بنكمّل عادي من غير ما نكسر حاجة.
   مهم: بتتنادى من صفحة العميل بس. لو اشتغلت في لوحة التحكم ممكن تحل محل
   جلسة الأدمن، عشان كده هي دالة بتتنادى صراحةً مش بتشتغل لوحدها. */
let guestPromise = null;
export function ensureGuest() {
  if (guestPromise) return guestPromise;
  guestPromise = (async () => {
    /* نستنى فايربيز يرجّع الجلسة المحفوظة الأول — عشان مانستبدلش حساب قايم */
    const current = await new Promise((resolve) => {
      const un = onAuthStateChanged(auth, (u) => { un(); resolve(u); }, () => resolve(null));
      setTimeout(() => resolve(auth.currentUser), 5000);
    });
    if (current) return current;
    try {
      const { user } = await signInAnonymously(auth);
      return user;
    } catch (e) {
      /* ADMIN_ONLY_OPERATION = الدخول المجهول متقفل من الكونسول — نكمّل عادي */
      return null;
    }
  })();
  return guestPromise;
}
