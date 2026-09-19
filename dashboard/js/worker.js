/* وركر الإشعارات — إعداده كله من اللوحة:
   بنعمل له حساب موظف بصلاحيات محدودة، ونولّد مفاتيح الإشعارات في المتصفح،
   وننزّل config.json جاهز يتحط جنب worker.py ويتشغّل. القسم للمالك بس.
   الباسورد مش بيتخزن في القاعدة أبداً — بيتكتب في الملف اللي على جهازك بس. */
import { ICONS } from '../../js/icons.js';
import { esc } from '../../js/escape.js';
import { app, db, ref, get, set, onValue } from '../../js/firebase-config.js';
import { toast } from './app.js';
import { createStaffAdmin, authError } from './auth.js';

/* اللي الوركر محتاجه فعلاً: يقرأ الطلبات ويحدّث حالتها، يقرأ بوت تليجرام، ويكتب نبضته */
const WORKER_PERMS = { orders: true, menu: true, customers: true, settings: true, settings_telegram: true, settings_features: true };
const HEARTBEAT_MAX = 90000;

function b64url(bytes) {
  let s = ''; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
/* نفس اللي setup.py كان بيعمله، بس من المتصفح */
async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65); pub[0] = 4; pub.set(fromB64url(jwk.x), 1); pub.set(fromB64url(jwk.y), 33);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const body = btoa(String.fromCharCode(...new Uint8Array(pkcs8))).match(/.{1,64}/g).join('\n');
  return { public: b64url(pub), private: jwk.d, pem: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n` };
}
function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr, b => chars[b % chars.length]).join('');
}
function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `قبل ${s} ثانية`;
  if (s < 3600) return `قبل ${Math.round(s / 60)} دقيقة`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} ساعة`;
  return `قبل ${Math.round(s / 86400)} يوم`;
}

export async function renderWorker(container) {
  container.innerHTML = `<div class="ex-eg-empty-d">جاري التحميل...</div>`;
  let info = null;
  try { const s = await get(ref(db, 'settings/worker')); if (s.exists()) info = s.val(); } catch (e) { /* أول مرة */ }
  const projectId = app.options.projectId || 'store';
  const defaultEmail = (info && info.email) || `worker@${projectId}.web.app`;

  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div>
        <h3>${ICONS.bell} وركر الإشعارات</h3>
        <p class="ex-eg-hint">برنامج صغير بيشتغل على جهازك (بايثون) وهو اللي بيبعت الطلبات لبوت تليجرام وإشعارات العملاء ويتابع أزرار البوت. كل إعداده من هنا: اعمله حساب، نزّل ملف الإعداد، وشغّله.</p>
      </div></div>

      <div class="ex-eg-worker-status" id="w-status">
        <span class="ex-eg-worker-dot"></span><span id="w-status-text">بنتأكد من حالة الوركر...</span>
      </div>

      ${info ? `<p class="ex-eg-hint" id="w-existing">الحساب الحالي: <b dir="ltr">${esc(info.email)}</b> — لو الملف ضاع، اكتب نفس الباسورد ونزّله تاني (أو اكتب باسورد جديد لحساب جديد).</p>` : ''}

      <div class="ex-eg-field"><label>اسم الحساب</label><input id="w-name" value="${esc((info && info.name) || 'وركر الإشعارات')}"></div>
      <div class="ex-eg-row-2">
        <div class="ex-eg-field"><label>إيميل الوركر</label><input id="w-email" dir="ltr" value="${esc(defaultEmail)}"></div>
        <div class="ex-eg-field"><label>الباسورد</label>
          <div class="ex-eg-worker-pass"><input id="w-pass" dir="ltr" value="${info ? '' : randomPassword()}" placeholder="${info ? 'اكتب باسورد الحساب' : ''}"><button type="button" class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="w-gen" title="توليد باسورد قوي">${ICONS.refresh || '↻'}</button></div>
        </div>
      </div>
      <div class="ex-eg-auth-error" id="w-error" hidden></div>
      <div class="ex-eg-modal-close-row" style="justify-content:flex-start">
        <button class="ex-eg-btn" id="w-create">${ICONS.upload} ${info ? 'تنزيل config.json' : 'إنشاء الحساب وتنزيل config.json'}</button>
      </div>

      <div class="ex-eg-worker-steps" id="w-steps" ${info ? '' : 'hidden'}>
        <h4>التشغيل على الجهاز</h4>
        <ol>
          <li>حط <b>config.json</b> اللي نزل جوه مجلد <b>push-worker</b> (جنب <b>worker.py</b>).</li>
          <li>أول مرة بس: دوس مرتين على <b>install.bat</b>.</li>
          <li>دوس مرتين على <b>start.bat</b> وسيب الشاشة مفتوحة — الحالة فوق هتبقى "شغال" خلال ثواني.</li>
        </ol>
        <p class="ex-eg-hint">الملف فيه باسورد الحساب ومفاتيح الإشعارات — خليه على جهازك بس ومتبعتوش لحد.</p>
      </div>

    </div>
  `;

  /* حالة الوركر لحظياً من نبضته */
  const statusBox = container.querySelector('#w-status');
  const statusText = container.querySelector('#w-status-text');
  let beat = 0; let timer = null;
  const paint = () => {
    const alive = beat && Date.now() - beat < HEARTBEAT_MAX;
    statusBox.classList.toggle('ex-eg-on', !!alive);
    statusBox.classList.toggle('ex-eg-off', !alive);
    statusText.textContent = alive ? `شغال — آخر نبضة ${ago(beat)}` : (beat ? `متوقف — آخر مرة اشتغل ${ago(beat)}` : 'متوقف — لسه ماشتغلش على أي جهاز');
  };
  const unsub = onValue(ref(db, 'settings/features/workerHeartbeat'), (s) => { beat = Number(s.val() || 0); paint(); }, () => paint());
  timer = setInterval(() => { if (!document.body.contains(statusBox)) { clearInterval(timer); unsub(); return; } paint(); }, 5000);

  container.querySelector('#w-gen').addEventListener('click', () => { container.querySelector('#w-pass').value = randomPassword(); });

  container.querySelector('#w-create').addEventListener('click', async () => {
    const name = container.querySelector('#w-name').value.trim() || 'وركر الإشعارات';
    const email = container.querySelector('#w-email').value.trim();
    const password = container.querySelector('#w-pass').value;
    const err = container.querySelector('#w-error');
    const btn = container.querySelector('#w-create');
    err.hidden = true;
    if (!email || password.length < 8) { err.hidden = false; err.textContent = 'اكتب إيميل وباسورد 8 حروف على الأقل'; return; }
    btn.disabled = true;
    try {
      /* لو الحساب موجود بنفس الباسورد بيرجّع نفس الـ uid — كده تنزيل الملف تاني شغال */
      const uid = await createStaffAdmin({ name, email, password, permissions: WORKER_PERMS, role: 'staff', branchId: '' });
      const vapid = await generateVapid();
      await set(ref(db, 'settings/worker'), { name, email, uid, vapidPublic: vapid.public, createdAt: (info && info.createdAt) || Date.now(), updatedAt: Date.now() });
      downloadJson('config.json', {
        email, password,
        databaseUrl: app.options.databaseURL,
        apiKey: app.options.apiKey,
        vapid,
        vapidSubject: 'mailto:' + email,
        pollSeconds: 5,
        drive: { enabled: false, folderName: 'Freezer Images' },
      });
      info = { name, email, uid };
      container.querySelector('#w-steps').hidden = false;
      btn.textContent = 'تنزيل config.json';
      toast('نزل config.json — حطه في مجلد push-worker وشغّل start.bat', 'success');
    } catch (e) {
      err.hidden = false;
      err.textContent = e && e.code === 'auth/existing-wrong-password'
        ? 'الحساب ده موجود بباسورد مختلف — اكتب الباسورد الصح أو استخدم إيميل جديد'
        : authError(e);
    } finally { btn.disabled = false; }
  });
}
