/* شبكة أمان للوحة التحكم.
   لو الصفحة فضلت على شاشة اللوجو، بنوري السبب الحقيقي بدل شاشة صامتة،
   ومعاه زرار بيمسح أي نسخة قديمة متخزّنة ويعيد التحميل. */
/* الحارس مابيقيسش الوقت من أول الصفحة، لأن الإقلاع ممكن ياخد وقت طويل ومشروع
   على نت بطيء. بيقيس **التوقّف**: طول ما في خطوة بتخلص، الساعة بتترجع لصفر.
   قبل كده كان بيوري "اللوحة مش راضية تفتح" بعد ١٤ ثانية حتى والإقلاع شغال. */
const STALL_MS = 15000;   // مفيش أي تقدّم للمدة دي ⇒ في مشكلة فعلاً
const HARD_MS = 60000;    // سقف مطلق مهما حصل
const problems = [];

let lastStage = 'بيبدأ التشغيل';
let lastAt = Date.now();
const startedAt = Date.now();

/* بتتنادى من app.js عند كل خطوة — بتحدّث النص اللي تحت اللوجو كمان
   فالمستخدم يشوف اللوحة بتعمل إيه بدل شاشة صامتة. */
export function bootProgress(stage) {
  lastStage = stage || lastStage;
  lastAt = Date.now();
  const el = document.getElementById('boot-stage');
  if (el) el.textContent = lastStage;
  else {
    const splash = document.querySelector('.ex-eg-boot-splash');
    if (splash) {
      const p = document.createElement('p');
      p.id = 'boot-stage';
      p.style.cssText = 'margin-top:14px;font-size:12.5px;color:#9a8577;text-align:center';
      p.textContent = lastStage;
      splash.appendChild(p);
    }
  }
}

function note(msg) {
  if (!msg) return;
  const t = String(msg).slice(0, 300);
  if (!problems.includes(t)) problems.push(t);
  try { sessionStorage.setItem('dash_last_error', problems.join(' | ').slice(0, 600)); } catch (e) { /* ignore */ }
}

window.addEventListener('error', (e) => {
  note(e && (e.message || (e.target && e.target.src ? 'فشل تحميل: ' + e.target.src : '')));
}, true);
window.addEventListener('unhandledrejection', (e) => {
  note('رفض غير معالَج: ' + (e && e.reason && (e.reason.message || e.reason)));
});

export function showStuck(detailOverride) {
  const root = document.getElementById('dash-root');
  if (!root || !root.querySelector('.ex-eg-boot-splash')) return;
  const detail = detailOverride
    || [problems.join(' | '), 'آخر خطوة: ' + lastStage].filter(Boolean).join(' — ')
    || 'اللوحة مش بترد — غالباً النت أو نسخة قديمة في المتصفح.';
  root.innerHTML = `
    <div class="ex-eg-auth-screen"><div class="ex-eg-auth-card">
      <img class="ex-eg-auth-logo" src="../assets/logo.png" alt="">
      <h1>اللوحة مش راضية تفتح</h1>
      <p>وقفت عند: <b>${lastStage.replace(/[<>&]/g, '')}</b><br>اضغط الزرار ده — بيمسح النسخة القديمة من المتصفح ويفتح اللوحة من جديد.</p>
      <button id="bg-reload">امسح الكاش وافتح اللوحة</button>
      <button id="bg-relogin" style="background:var(--primary-light);color:var(--primary);box-shadow:none;margin-top:8px">سجّل خروج وادخل من جديد</button>
      <button id="bg-show" style="background:transparent;color:var(--muted);box-shadow:none;margin-top:6px;font-size:12px">عرض تفاصيل المشكلة</button>
      <p class="ex-eg-auth-hint" id="bg-detail" hidden></p>
    </div></div>`;
  const d = root.querySelector('#bg-detail');
  d.textContent = detail;
  root.querySelector('#bg-show').addEventListener('click', () => { d.hidden = !d.hidden; });
  root.querySelector('#bg-reload').addEventListener('click', () => hardReset(false));
  root.querySelector('#bg-relogin').addEventListener('click', () => hardReset(true));

  /* لو الشاشة دي ظهرت مرتين ورا بعض، الجلسة نفسها على الأغلب هي المشكلة —
     فبنعمل خروج ونرجّع شاشة الدخول لوحدنا بدل ما المستخدم يفضل في نفس اللفة. */
  let fails = 0;
  try { fails = Number(sessionStorage.getItem('dash_fail_count') || 0) + 1; sessionStorage.setItem('dash_fail_count', String(fails)); } catch (e) { /* ignore */ }
  if (fails >= 2) {
    d.hidden = false;
    d.textContent = 'بنعيد تسجيل الدخول تلقائياً... | ' + detail;
    setTimeout(() => hardReset(true), 1200);
  }
}

/* تنضيف كامل: service worker + كاش + قواعد بيانات محلية،
   و(اختيارياً) تسجيل خروج فترجع لشاشة الدخول نضيفة. */
async function hardReset(signOutToo) {
  /* App Check بيخزّن حالة فشل في IndexedDB بتفضل ٢٤ ساعة وبتفسد اتصال
     قاعدة البيانات حتى بعد ما نقفله من الكود — فبنمسحها دايماً. */
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.filter(x => /app-?check/i.test(x.name || '')).map(x => new Promise(r => {
        const req = indexedDB.deleteDatabase(x.name); req.onsuccess = req.onerror = req.onblocked = () => r();
      })));
    }
  } catch (e) { /* ignore */ }
  try {
    if (signOutToo) {
      const [{ auth }, fbAuth] = await Promise.all([
        import('../../js/firebase-config.js'),
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      ]);
      await fbAuth.signOut(auth).catch(() => {});
    }
  } catch (e) { /* لو فشل الخروج بنكمّل التنضيف برضه */ }
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (signOutToo && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.filter(x => /firebase/i.test(x.name || '')).map(x => new Promise(r => {
        const req = indexedDB.deleteDatabase(x.name); req.onsuccess = req.onerror = req.onblocked = () => r();
      })));
    }
  } catch (e) { /* مش مشكلة */ }
  try { sessionStorage.removeItem('dash_fail_count'); sessionStorage.removeItem('dash_sw_off'); } catch (e) { /* ignore */ }
  location.replace(location.pathname + '?fresh=' + Date.now());
}

/* لو في service worker ماسك اللوحة، نفكّه مرة واحدة — اللوحة مش محتاجة
   تشتغل أوفلاين، وده بيمنع خلط ملف جديد بملف قديم. */
(async () => {
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller && !sessionStorage.getItem('dash_sw_off')) {
      sessionStorage.setItem('dash_sw_off', '1');
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      location.reload();
    }
  } catch (e) { /* ignore */ }
})();

/* تحميل الملفات نفسه تقدّم.
   اللوحة بتحمّل ~١٥ وحدة + مكتبات فايربيز، وبين تحميل الحارس وبداية boot()
   مفيش أي خطوة بتتسجّل — فعلى نت بطيء كان الحارس بيستسلم والتحميل لسه شغال.
   دلوقتي أي ملف جديد بيوصل بيتحسب تقدّم. */
let lastResourceCount = 0;
function networkProgressing() {
  try {
    const n = performance.getEntriesByType('resource').length;
    if (n > lastResourceCount) { lastResourceCount = n; return true; }
  } catch (e) { /* ignore */ }
  return false;
}

/* المراقب.
   القاعدة: البطء **مش** عطل. الشاشة دي بتظهر بس لما يكون في سبب حقيقي:
     ١) خطأ جافاسكربت اتمسك فعلاً (ملف مش بيتحمّل، استيراد غلط، …) ⇒ فوراً.
     ٢) توقّف تام: مفيش خطوة ومفيش أي ملف بيوصل من ١٥ ثانية.
     ٣) سقف مطلق ٦٠ ثانية.
   وقبل كل ده، لو الوقت طال والتحميل لسه شغال بنطمّن المستخدم بنص بدل الصمت. */
const watchdog = setInterval(() => {
  const root = document.getElementById('dash-root');
  if (!root || !root.querySelector('.ex-eg-boot-splash')) { clearInterval(watchdog); return; }

  if (problems.length) { clearInterval(watchdog); showStuck(); return; }   // عطل حقيقي

  const busy = networkProgressing();
  if (busy) lastAt = Date.now();

  const waited = Date.now() - startedAt;
  if (waited > 8000 && busy) bootProgress('النت بطيء شوية — لسه بنحمّل...');

  const stalled = Date.now() - lastAt > STALL_MS;
  const tooLong = waited > HARD_MS;
  if (stalled || tooLong) { clearInterval(watchdog); showStuck(); }
}, 1000);

bootProgress('بيحمّل اللوحة');
