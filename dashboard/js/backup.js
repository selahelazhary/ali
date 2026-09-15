/* النسخ الاحتياطي — تنزيل نسخة كاملة من بيانات المحل كملف JSON،
   ورفع نسخة قديمة لاسترجاعها. القسم للمالك بس. */
import { ICONS } from '../../js/icons.js';
import { db, ref, get, set, update, push, remove, auth } from '../../js/firebase-config.js';
import { toast } from './app.js';

/* كل جزء من البيانات: المفتاح في القاعدة + اسمه + إزاي نعدّ عناصره */
const PARTS = [
  { key: 'menu', label: 'المنيو والهوية', hint: 'الأقسام والمنتجات واللوجو والألوان والبانرات', count: v => (v && Array.isArray(v.categories) ? v.categories.reduce((n, c) => n + ((c.products || []).length), 0) + ' منتج' : '—'), safe: true },
  { key: 'settings', label: 'الإعدادات', hint: 'الدفع والمحافظات والتواصل والمزايا وبوت تليجرام', count: v => (v ? Object.keys(v).length + ' إعداد' : '—'), safe: true },
  { key: 'branches', label: 'الفروع', hint: 'أماكن الفروع ولينكات الخرايط', count: v => (v ? Object.keys(v).length + ' فرع' : '0'), safe: true },
  { key: 'orders', label: 'الطلبات', hint: 'كل الطلبات وحالتها وتفاصيلها', count: v => (v ? Object.keys(v).length + ' طلب' : '0'), safe: true },
  { key: 'feedback', label: 'آراء العملاء', hint: 'الرسائل والتقييمات', count: v => (v ? Object.keys(v).length + ' رأي' : '0'), safe: true },
  { key: 'subscribers', label: 'المشتركين في الإشعارات', hint: 'أجهزة العملاء وربط تليجرام', count: v => (v ? Object.keys(v).length + ' مشترك' : '0'), safe: true },
  { key: 'broadcasts', label: 'الإشعارات المرسلة', hint: 'سجل الإشعارات الجماعية', count: v => (v ? Object.keys(v).length + ' إشعار' : '0'), safe: true },
  { key: 'admins', label: 'الأدمنز والصلاحيات', hint: 'خطر: استرجاعه ممكن يقفل دخولك — سيبه مقفول إلا لو متأكد', count: v => (v ? Object.keys(v).length + ' أدمن' : '0'), safe: false },
];

/* الأجزاء اللي ينفع تتمسح.
   perChild = قواعد الأمان بتدّي صلاحية الكتابة على الأبناء مش على العقدة نفسها،
   فالمسح لازم يتم ابن ابن (بندمجهم في طلب واحد). */
const WIPE_PARTS = [
  { key: 'orders', label: 'الطلبات', hint: 'كل الطلبات وتاريخها', perChild: true, also: ['orderProofs'] },
  { key: 'feedback', label: 'آراء العملاء', hint: 'كل الرسائل والتقييمات المرسلة', perChild: true },
  { key: 'ratings', label: 'تقييمات المنتجات', hint: 'النجوم اللي حطها العملاء', perChild: true, deep: true },
  { key: 'subscribers', label: 'المشتركين في الإشعارات', hint: 'أجهزة العملاء وربط تليجرام', perChild: true },
  { key: 'broadcasts', label: 'الإشعارات المرسلة', hint: 'سجل الإشعارات الجماعية', perChild: false },
  { key: 'menu', label: 'المنيو', hint: 'الأقسام والمنتجات والبانرات — المتجر هيفضى', perChild: false, also: ['assets'] },
  { key: 'branches', label: 'الفروع', hint: 'كل الفروع وعناوينها', perChild: false },
];

/* عمرها ما تتمسح — مسحها بيقفل المالك بره اللوحة */
const PROTECTED = ['admins', 'settings/adminConfigured', 'settings/ownerEmail'];

const FILE_TAG = 'daily-bake-backup';

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}
function prettySize(bytes) {
  if (bytes < 1024) return bytes + ' بايت';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' ك.ب';
  return (bytes / 1024 / 1024).toFixed(1) + ' ميجا';
}
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

/* القراءة عبر REST بتوكن الحساب: أضمن من الـ SDK للعقد الكبيرة
   (الـ SDK بيدمج اللي متزامن عنده وممكن يرجّع عقدة ناقصة). */
async function readNodeRest(node) {
  const user = auth.currentUser;
  if (!user) throw new Error('مفيش جلسة');
  const token = await user.getIdToken();
  const base = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/${node}.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`تعذر قراءة ${node}`);
  return await res.json();
}

export function renderBackup(container, { profile } = {}) {
  container.innerHTML = `
    <div class="ex-eg-card ex-eg-narrow">
      <div class="ex-eg-card-head"><div>
        <h3>${ICONS.upload} نسخة احتياطية</h3>
        <p class="ex-eg-hint">نزّل نسخة من بيانات المحل على جهازك، وارفعها تاني في أي وقت لو حصل أي حاجة. النسخة ملف JSON واحد تقدر تحفظه على الدرايف أو الإيميل.</p>
      </div></div>

      <h4 class="ex-eg-backup-h">${ICONS.upload} تنزيل نسخة جديدة</h4>
      <div class="ex-eg-backup-parts" id="bk-parts">
        ${PARTS.map(p => `
          <label class="ex-eg-backup-part ${p.safe ? '' : 'ex-eg-risky'}">
            <input type="checkbox" data-part="${p.key}" ${p.safe ? 'checked' : ''}>
            <span class="ex-eg-bp-body">
              <b>${p.label}</b>
              <small>${p.hint}</small>
            </span>
            <span class="ex-eg-bp-count" data-count="${p.key}">…</span>
          </label>`).join('')}
      </div>
      <div class="ex-eg-backup-actions">
        <button class="ex-eg-btn" id="bk-download">${ICONS.upload} نزّل النسخة</button>
        <span class="ex-eg-hint" id="bk-status"></span>
      </div>

      <hr class="ex-eg-backup-sep">

      <h4 class="ex-eg-backup-h">${ICONS.upload} استرجاع من ملف</h4>
      <p class="ex-eg-hint" style="margin-bottom:10px">اختار ملف نسخة احتياطية اتنزّل من هنا قبل كده. هنوريك اللي جواه الأول قبل ما نغيّر أي حاجة.</p>
      <label class="ex-eg-backup-drop" id="bk-drop">
        <input type="file" accept="application/json,.json" id="bk-file" hidden>
        <span>${ICONS.upload}</span>
        <b>اضغط لاختيار ملف النسخة</b>
        <small>ملف .json اتنزّل من قسم النسخ الاحتياطي</small>
      </label>
      <div id="bk-preview"></div>

      <hr class="ex-eg-backup-sep">
      <h4 class="ex-eg-backup-h">${ICONS.clock} آخر النسخ</h4>
      <div id="bk-log"><div class="ex-eg-empty-d">جاري التحميل...</div></div>
    </div>

    <div class="ex-eg-card ex-eg-narrow ex-eg-danger-zone">
      <div class="ex-eg-card-head"><div>
        <h3>${ICONS.trash} حذف البيانات</h3>
        <p class="ex-eg-hint">بيمسح البيانات نهائياً من قاعدة البيانات. <b>مفيش رجوع.</b>
           نزّل نسخة احتياطية الأول من فوق.</p>
      </div></div>
      <div class="ex-eg-backup-parts" id="wipe-parts">
        ${WIPE_PARTS.map(p => `
          <label class="ex-eg-backup-part">
            <input type="checkbox" data-wipe="${p.key}">
            <span class="ex-eg-bp-body"><b>${p.label}</b><small>${p.hint}</small></span>
            <span class="ex-eg-bp-count" data-wcount="${p.key}">…</span>
          </label>`).join('')}
      </div>
      <p class="ex-eg-hint" style="margin:10px 0">
        ${ICONS.shield} <b>محميّة ومش هتتمسح:</b> حسابات الأدمنز وصلاحياتهم، وإيميل المالك —
        عشان ماتتقفلش بره اللوحة.
      </p>
      <label class="ex-eg-wipe-ack"><input type="checkbox" id="wipe-ack"> عملت نسخة احتياطية وفاهم إن الحذف نهائي</label>
      <div class="ex-eg-field" style="margin-top:10px">
        <label>اكتب <code>احذف البيانات</code> بالظبط عشان الزرار يشتغل</label>
        <input id="wipe-phrase" autocomplete="off" placeholder="احذف البيانات">
      </div>
      <div class="ex-eg-backup-actions">
        <button class="ex-eg-btn ex-eg-danger" id="wipe-go" disabled>${ICONS.trash} احذف المحدّد نهائياً</button>
        <span class="ex-eg-hint" id="wipe-status"></span>
      </div>
    </div>`;

  const $ = s => container.querySelector(s);

  /* عدّادات حيّة لكل جزء */
  (async () => {
    for (const p of PARTS) {
      const el = container.querySelector(`[data-count="${p.key}"]`);
      if (!el) continue;
      try { el.textContent = p.count(await readNodeRest(p.key)); }
      catch (e) { el.textContent = 'مش متاح'; }
    }
  })();

  /* ---------- تنزيل ---------- */
  $('#bk-download').addEventListener('click', async () => {
    const chosen = [...container.querySelectorAll('[data-part]:checked')].map(c => c.dataset.part);
    if (!chosen.length) { toast('اختار جزء واحد على الأقل', 'error'); return; }
    const btn = $('#bk-download');
    btn.disabled = true;
    $('#bk-status').textContent = 'جاري تجهيز النسخة...';
    try {
      const data = {};
      for (const key of chosen) {
        $('#bk-status').textContent = `جاري قراءة ${PARTS.find(p => p.key === key).label}...`;
        data[key] = await readNodeRest(key);
      }
      const payload = {
        _tag: FILE_TAG,
        _version: 1,
        createdAt: Date.now(),
        createdBy: (profile && (profile.name || profile.email)) || (auth.currentUser && auth.currentUser.email) || '',
        parts: chosen,
        data,
      };
      const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${FILE_TAG}-${stamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      $('#bk-status').textContent = `اتنزّلت ✓ (${prettySize(blob.size)})`;
      toast('النسخة اتنزّلت على جهازك', 'success');
      logBackup({ at: payload.createdAt, by: payload.createdBy, parts: chosen, size: blob.size, kind: 'download' });
    } catch (e) {
      $('#bk-status').textContent = '';
      toast(e.message || 'تعذر تجهيز النسخة', 'error');
    }
    btn.disabled = false;
  });

  /* ---------- استرجاع ---------- */
  $('#bk-file').addEventListener('change', async () => {
    const f = $('#bk-file').files[0];
    if (!f) return;
    try {
      const payload = JSON.parse(await f.text());
      if (!payload || payload._tag !== FILE_TAG || !payload.data) throw new Error('الملف ده مش نسخة احتياطية من Bakery');
      showPreview(payload, f);
    } catch (e) {
      $('#bk-preview').innerHTML = `<div class="ex-eg-backup-bad">${e.message || 'ملف غير صالح'}</div>`;
    }
    $('#bk-file').value = '';
  });

  function showPreview(payload, file) {
    const keys = Object.keys(payload.data);
    $('#bk-preview').innerHTML = `
      <div class="ex-eg-backup-preview">
        <div class="ex-eg-backup-meta">
          <b>${file.name}</b>
          <span>${prettySize(file.size)} · اتعملت ${fmtDate(payload.createdAt)}${payload.createdBy ? ` · بواسطة ${payload.createdBy}` : ''}</span>
        </div>
        <div class="ex-eg-backup-parts">
          ${keys.map(k => {
            const p = PARTS.find(x => x.key === k) || { label: k, hint: '', count: () => '—', safe: true };
            return `<label class="ex-eg-backup-part ${p.safe ? '' : 'ex-eg-risky'}">
              <input type="checkbox" data-restore="${k}" ${p.safe ? 'checked' : ''}>
              <span class="ex-eg-bp-body"><b>${p.label}</b><small>${p.hint || ''}</small></span>
              <span class="ex-eg-bp-count">${p.count(payload.data[k])}</span>
            </label>`;
          }).join('')}
        </div>
        <div class="ex-eg-field">
          <label>طريقة الاسترجاع</label>
          <select id="bk-mode">
            <option value="merge">دمج — يضيف ويحدّث اللي في النسخة ويسيب الباقي زي ما هو (الأأمن)</option>
            <option value="replace">استبدال كامل — يمسح الموجود ويحط اللي في النسخة بالظبط</option>
          </select>
        </div>
        <div class="ex-eg-backup-warn" id="bk-warn" hidden></div>
        <div class="ex-eg-backup-actions">
          <button class="ex-eg-btn ex-eg-ghost" id="bk-cancel">إلغاء</button>
          <button class="ex-eg-btn ex-eg-danger" id="bk-restore">${ICONS.check} استرجع النسخة</button>
        </div>
      </div>`;

    const mode = $('#bk-mode');
    const warn = $('#bk-warn');
    const syncWarn = () => {
      const risky = [...container.querySelectorAll('[data-restore]:checked')]
        .some(c => { const p = PARTS.find(x => x.key === c.dataset.restore); return p && !p.safe; });
      const msgs = [];
      if (mode.value === 'replace') msgs.push('الاستبدال الكامل هيمسح أي بيانات موجودة دلوقتي في الأجزاء المختارة.');
      if (risky) msgs.push('اخترت استرجاع الأدمنز — لو النسخة قديمة ممكن تقفل دخولك على اللوحة.');
      warn.hidden = !msgs.length;
      warn.innerHTML = msgs.map(m => `⚠️ ${m}`).join('<br>');
    };
    mode.addEventListener('change', syncWarn);
    container.querySelectorAll('[data-restore]').forEach(c => c.addEventListener('change', syncWarn));
    syncWarn();

    $('#bk-cancel').addEventListener('click', () => { $('#bk-preview').innerHTML = ''; });
    $('#bk-restore').addEventListener('click', async () => {
      const chosen = [...container.querySelectorAll('[data-restore]:checked')].map(c => c.dataset.restore);
      if (!chosen.length) { toast('اختار جزء واحد على الأقل', 'error'); return; }
      const replace = mode.value === 'replace';
      const names = chosen.map(k => (PARTS.find(p => p.key === k) || { label: k }).label).join('، ');
      if (!confirm(`هيتم ${replace ? 'استبدال' : 'دمج'}: ${names}\n\nمتأكد؟ العملية دي مش هتترجع.`)) return;

      const btn = $('#bk-restore');
      btn.disabled = true; btn.textContent = 'جاري الاسترجاع...';
      const done = [], failed = [];
      for (const key of chosen) {
        try {
          const value = payload.data[key];
          if (value == null) await remove(ref(db, key));
          else if (replace) await set(ref(db, key), value);
          else await update(ref(db, key), value);
          done.push(key);
        } catch (e) { failed.push(key); }
      }
      btn.disabled = false; btn.textContent = 'استرجع النسخة';
      if (done.length) {
        toast(`اترجع ${done.length} جزء ✓${failed.length ? ` — فشل ${failed.length}` : ''}`, failed.length ? 'error' : 'success');
        logBackup({ at: Date.now(), by: (profile && (profile.name || profile.email)) || '', parts: done, size: file.size, kind: replace ? 'restore-replace' : 'restore-merge' });
        $('#bk-preview').innerHTML = `<div class="ex-eg-backup-good">تم الاسترجاع ✓ — اعمل ريفرش للصفحة عشان تشوف البيانات الجديدة.</div>`;
      } else {
        toast('تعذر الاسترجاع — راجع صلاحيات حسابك', 'error');
      }
    });
  }

  /* ---------- سجل النسخ ---------- */
  /* ---------- حذف البيانات ---------- */

  /* بيمسح عقدة كاملة أو أبناءها حسب اللي القواعد بتسمح بيه.
     بيرجّع عدد العناصر اللي اتمسحت. */
  async function wipeNode(node, { perChild = true, deep = false } = {}) {
    if (PROTECTED.includes(node)) return 0;
    if (!perChild) { await set(ref(db, node), null); return 1; }

    const val = await readNodeRest(node);
    if (!val || typeof val !== 'object') return 0;

    /* بنبني مسارات نسبية للعقدة عشان نمسحها في دفعات */
    const paths = [];
    if (deep) {
      for (const [a, kids] of Object.entries(val)) {
        if (kids && typeof kids === 'object') for (const b of Object.keys(kids)) paths.push(`${a}/${b}`);
        else paths.push(a);
      }
    } else {
      paths.push(...Object.keys(val));
    }

    for (let i = 0; i < paths.length; i += 150) {
      const patch = {};
      paths.slice(i, i + 150).forEach(p => { patch[p] = null; });
      await update(ref(db, node), patch);
    }
    return paths.length;
  }

  /* عدّادات منطقة الخطر */
  (async () => {
    for (const p of WIPE_PARTS) {
      const el = container.querySelector(`[data-wcount="${p.key}"]`);
      if (!el) continue;
      try {
        const v = await readNodeRest(p.key);
        el.textContent = v && typeof v === 'object' ? Object.keys(v).length + ' عنصر' : (v ? 'موجود' : 'فاضي');
      } catch (e) { el.textContent = '—'; }
    }
  })();

  const wipeBtn = $('#wipe-go');
  const wipePhrase = $('#wipe-phrase');
  const wipeAck = $('#wipe-ack');
  const wipeStatus = $('#wipe-status');

  /* الزرار مايشتغلش غير لما الشروط التلاتة تتحقق مع بعض */
  function refreshWipeBtn() {
    const chosen = [...container.querySelectorAll('[data-wipe]:checked')];
    wipeBtn.disabled = !(chosen.length && wipeAck.checked && wipePhrase.value.trim() === 'احذف البيانات');
  }
  container.querySelectorAll('[data-wipe]').forEach(c => c.addEventListener('change', refreshWipeBtn));
  wipeAck.addEventListener('change', refreshWipeBtn);
  wipePhrase.addEventListener('input', refreshWipeBtn);

  wipeBtn.addEventListener('click', async () => {
    const chosen = [...container.querySelectorAll('[data-wipe]:checked')].map(c => c.dataset.wipe);
    const parts = WIPE_PARTS.filter(p => chosen.includes(p.key));
    const names = parts.map(p => p.label).join('، ');
    if (!confirm(`هيتمسح نهائياً: ${names}\n\nمتأكد؟ مفيش تراجع.`)) return;

    wipeBtn.disabled = true;
    let total = 0;
    try {
      for (const p of parts) {
        wipeStatus.textContent = `جاري حذف ${p.label}...`;
        total += await wipeNode(p.key, { perChild: p.perChild, deep: p.deep });
        /* عقد مرتبطة بتتمسح مع بعضها (صور التحويل مع الطلبات، والصور مع المنيو) */
        for (const extra of (p.also || [])) total += await wipeNode(extra, { perChild: true });
      }
      await logBackup({ kind: 'wipe', parts: chosen, size: total, at: Date.now(), by: (profile && (profile.name || profile.email)) || '' });
      wipeStatus.textContent = '';
      toast(`اتمسح ${total} عنصر نهائياً`, 'success');
      wipePhrase.value = ''; wipeAck.checked = false;
      container.querySelectorAll('[data-wipe]').forEach(c => { c.checked = false; });
      refreshWipeBtn();
      loadLog();
    } catch (e) {
      wipeStatus.textContent = '';
      toast('تعذر إتمام الحذف — ' + (e.message || 'مفيش صلاحية'), 'error');
      wipeBtn.disabled = false;
    }
  });

  async function logBackup(entry) {
    try { await push(ref(db, 'backups/log'), entry); } catch (e) { /* مش مشكلة */ }
    loadLog();
  }

  async function loadLog() {
    const box = $('#bk-log');
    if (!box) return;
    try {
      const snap = await get(ref(db, 'backups/log'));
      const rows = [];
      snap.forEach(c => { rows.push({ id: c.key, ...(c.val() || {}) }); });
      rows.sort((a, b) => (b.at || 0) - (a.at || 0));
      const KINDS = { download: 'تنزيل', 'restore-merge': 'استرجاع (دمج)', 'restore-replace': 'استرجاع (استبدال)', wipe: 'حذف نهائي' };
      box.innerHTML = rows.length ? `
        <div class="ex-eg-table-wrap"><table>
          <thead><tr><th>التاريخ</th><th>العملية</th><th>الأجزاء</th><th>الحجم</th><th>بواسطة</th></tr></thead>
          <tbody>${rows.slice(0, 20).map(r => `
            <tr>
              <td>${fmtDate(r.at)}</td>
              <td><span class="ex-eg-badge-status ${r.kind === 'download' ? 'ready' : 'new'}">${KINDS[r.kind] || r.kind || '—'}</span></td>
              <td class="ex-eg-hint">${(r.parts || []).map(k => (PARTS.find(p => p.key === k) || { label: k }).label).join('، ') || '—'}</td>
              <td>${r.size ? prettySize(r.size) : '—'}</td>
              <td class="ex-eg-hint">${r.by || '—'}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : `<div class="ex-eg-empty-d">مفيش نسخ اتعملت لسه</div>`;
    } catch (e) {
      box.innerHTML = `<div class="ex-eg-empty-d">مفيش صلاحية لقراءة سجل النسخ</div>`;
    }
  }
  loadLog();
}
