import { ICONS } from '../../js/icons.js';
import { esc } from '../../js/escape.js';
import { db, ref, onValue, update, remove, auth, get } from '../../js/firebase-config.js';
import { PERMISSIONS, createStaffAdmin, authError, allPermissions } from './auth.js';
import { toast } from './app.js';
import { releaseDevice, approveDeviceRequest, rejectDeviceRequest } from './session.js';

/* قراءة قائمة الأدمنز مباشرة من القاعدة عبر REST.
   الـ SDK بيرجّع أحياناً جزء من العقدة دي بس (لأنه بيدمجها مع اللي متزامن عنده
   من admins/{uid})، فكان الأدمن الجديد مش بيظهر. الـ REST بيرجّع القايمة كاملة. */
async function fetchAdmins() {
  const user = auth.currentUser;
  if (!user) return [];
  const token = await user.getIdToken();
  const base = String(db.app.options.databaseURL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/admins.json?auth=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error('read failed');
  const data = await res.json();
  return Object.entries(data || {}).map(([uid, v]) => ({ uid, ...(v || {}) }));
}

export function renderAdmins(container, { profile }) {
  container.innerHTML = `
    <div class="ex-eg-card">
      <div class="ex-eg-card-head">
        <div><h3>الأدمنز</h3><p class="ex-eg-hint">إنت اللي بتعمل حسابات الأدمنز بنفسك: اكتب الاسم والإيميل والباسورد، وحدد كل واحد يشوف إيه. الحساب بيشتغل فوراً.</p></div>
        <button class="ex-eg-btn" id="add-admin">${ICONS.plus} أدمن جديد</button>
      </div>
      <div class="ex-eg-table-wrap"><table>
        <thead><tr><th>الاسم</th><th>الإيميل</th><th>الدور</th><th>الصلاحيات</th><th>الجهاز المرتبط</th><th></th></tr></thead>
        <tbody id="admins-tbody"></tbody>
      </table></div>
    </div>
  `;

  container.querySelector('#add-admin').addEventListener('click', () => openAdminModal());

  /* الفروع — عشان نربط أدمن بفرع محدد (يشوف ويستقبل طلبات الفرع ده بس) */
  let branches = {};
  const loadBranches = () => get(ref(db, 'branches')).then((s) => {
    branches = {};
    s.forEach((c) => { const b = c.val() || {}; branches[c.key] = (b.name && (b.name.ar || b.name.en)) || c.key; });
  }).catch(() => {});
  const branchesReady = loadBranches();

  /* الـ onValue هنا مجرد جرس: أي تغيير في العقدة بيخلينا نعيد القراءة الكاملة.
     لو وصل تغيير وإحنا لسه بنقرا، بنعلّم إن فيه قراءة تانية مطلوبة بعد ما نخلص —
     عشان آخر حالة للقايمة تظهر دايماً (ده كان سبب إن الأدمن الجديد مش بيظهر). */
  let refreshing = false, again = false;
  async function refresh() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try { paint(await fetchAdmins()); }
    catch (e) {
      const tb = container.querySelector('#admins-tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="ex-eg-empty-d">مفيش صلاحية قراءة الأدمنز</td></tr>`;
    }
    refreshing = false;
    if (again) { again = false; refresh(); }
  }
  refresh();
  /* بنفك الاشتراك أول ما القسم يتشال من الصفحة عشان مايفضلش يقرا في الخلفية */
  const unsub = onValue(ref(db, 'admins'), () => { if (container.isConnected) refresh(); else unsub(); }, () => refresh());

  function paint(rows) {
    rows.sort((a, b) => (a.role === 'owner' ? -1 : 1) - (b.role === 'owner' ? -1 : 1) || (a.createdAt || 0) - (b.createdAt || 0));
    const tbody = container.querySelector('#admins-tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(a => `
      <tr>
        <td><b>${esc(a.name || '-')}</b></td>
        <td dir="ltr">${esc(a.email || '-')}</td>
        <td><span class="ex-eg-badge-status ${a.role === 'owner' ? 'ready' : 'new'}">${a.role === 'owner' ? 'مالك' : 'موظف'}</span></td>
        <td>${a.role === 'owner' ? 'كل الصلاحيات' : PERMISSIONS.filter(p => a.permissions && a.permissions[p.key]).map(p => `<span class="ex-eg-perm-chip">${p.label}</span>`).join('') || '<span class="ex-eg-hint">بدون</span>'}
          ${a.role !== 'owner' && a.branchId ? `<div class="ex-eg-hint" style="margin-top:4px">${ICONS.storefront} طلبات فرع: <b>${esc(branches[a.branchId] || a.branchId)}</b></div>` : ''}</td>
        <td>
          ${a.boundDevice ? `<span class="ex-eg-perm-chip">${esc(a.boundDevice.device || 'جهاز')}</span> <button class="ex-eg-btn ex-eg-sm ex-eg-ghost" data-unbind="${esc(a.uid)}">فك الارتباط</button>` : '<span class="ex-eg-hint">غير مرتبط</span>'}
          ${a.deviceRequest ? `
            <div class="ex-eg-device-req">
              ${ICONS.shield} طلب نقل إلى <b>${esc(a.deviceRequest.device || 'جهاز جديد')}</b>
              <button class="ex-eg-btn ex-eg-sm" data-approve="${esc(a.uid)}">${ICONS.check} موافقة</button>
              <button class="ex-eg-btn ex-eg-sm ex-eg-danger" data-reject="${esc(a.uid)}">${ICONS.close} رفض</button>
            </div>` : ''}
        </td>
        <td style="white-space:nowrap">
          ${a.uid === (profile && profile.uid) ? '<span class="ex-eg-hint">إنت</span>' : `<button class="ex-eg-btn ex-eg-sm ex-eg-ghost" data-edit="${esc(a.uid)}" title="تعديل">${ICONS.edit}</button> <button class="ex-eg-btn ex-eg-sm ex-eg-danger" data-del="${esc(a.uid)}" title="إلغاء الصلاحيات">${ICONS.trash}</button>`}
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6" class="ex-eg-empty-d">مفيش أدمنز غيرك — اضغط "أدمن جديد"</td></tr>`;

    tbody.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
      const row = rows.find(r => r.uid === b.dataset.approve);
      try { await approveDeviceRequest(row.uid, row.deviceRequest); toast('تمت الموافقة — الحساب اتنقل للجهاز الجديد', 'success'); }
      catch (e) { toast('تعذر تنفيذ الموافقة', 'error'); }
    }));
    tbody.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
      try { await rejectDeviceRequest(b.dataset.reject); toast('اترفض الطلب', 'success'); }
      catch (e) { toast('تعذر رفض الطلب', 'error'); }
    }));
    tbody.querySelectorAll('[data-unbind]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('فك ارتباط الجهاز؟ الحساب هيقدر يتربط بأول جهاز يسجّل منه بعد كده.')) return;
      try { await releaseDevice(b.dataset.unbind); toast('اتفك الارتباط', 'success'); }
      catch (e) { toast('مفيش صلاحية لفك الارتباط', 'error'); }
    }));
    tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openAdminModal(rows.find(r => r.uid === b.dataset.edit))));
    tbody.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const row = rows.find(r => r.uid === b.dataset.del);
      if (row && row.role === 'owner' && rows.filter(r => r.role === 'owner').length <= 1) { toast('لازم يفضل مالك واحد على الأقل', 'error'); return; }
      if (!confirm('إلغاء صلاحيات الأدمن ده؟ (مش هيقدر يدخل الداش بورد تاني — وحسابه في Firebase بيفضل موجود بدون صلاحيات)')) return;
      try { await remove(ref(db, `admins/${b.dataset.del}`)); toast('اتشالت الصلاحيات', 'success'); refresh(); }
      catch (e) { toast('مفيش صلاحية — المالك بس اللي يقدر', 'error'); }
    }));
  }

  async function openAdminModal(existing) {
    await branchesReady;
    const isEdit = !!existing;
    const curBranch = (existing && existing.branchId) || '';
    const perms = { ...((existing && existing.permissions) || { orders: true }) };
    /* صلاحية "settings" القديمة (قبل التقسيم) = كل أقسام الإعدادات؛ والمفاتيح
       القديمة بالنقطة (settings.identity) بتتحوّل للشكل الحالي بالشرطة السفلية */
    Object.keys(perms).forEach(k => { if (k.includes('.')) { perms[k.replace(/\./g, '_')] = perms[k]; delete perms[k]; } });
    const hasAnySettingsKey = Object.keys(perms).some(k => k.startsWith('settings_'));
    if (perms.settings && !hasAnySettingsKey) {
      PERMISSIONS.filter(p => p.key.startsWith('settings_')).forEach(p => { perms[p.key] = true; });
    }
    delete perms.settings;
    const bg = document.createElement('div');
    bg.className = 'ex-eg-modal-bg';
    bg.innerHTML = `
      <div class="ex-eg-modal-box">
        <h3>${isEdit ? 'تعديل صلاحيات' : 'أدمن جديد'}</h3>
        ${isEdit ? '' : '<p class="ex-eg-hint" style="margin-bottom:14px">الحساب بيتعمل على طول وإنت فاضل في حسابك — ابعت الإيميل والباسورد للموظف بعد كده.</p>'}
        <div class="ex-eg-field"><label>الاسم</label><input id="a-name" value="${esc(existing ? existing.name || '' : '')}"></div>
        ${isEdit ? `<div class="ex-eg-field"><label>الإيميل</label><input value="${esc(existing.email || '')}" disabled dir="ltr"></div>` : `
          <div class="ex-eg-field"><label>الإيميل</label><input id="a-email" type="email" dir="ltr" placeholder="staff@example.com"></div>
          <div class="ex-eg-field"><label>الباسورد</label><input id="a-pass" type="text" dir="ltr" placeholder="6 حروف على الأقل"></div>
        `}
        <div class="ex-eg-field"><label>الدور</label>
          <select id="a-role">
            <option value="staff" ${(existing && existing.role) === 'owner' ? '' : 'selected'}>موظف (صلاحيات محددة)</option>
            <option value="owner" ${(existing && existing.role) === 'owner' ? 'selected' : ''}>مالك (كل الصلاحيات)</option>
          </select>
        </div>
        <div class="ex-eg-field" id="a-branch-field" ${(existing && existing.role) === 'owner' ? 'hidden' : ''}>
          <label>طلبات فرع محدد</label>
          <select id="a-branch">
            <option value="">كل الفروع</option>
            ${Object.entries(branches).map(([id, nm]) => `<option value="${esc(id)}" ${id === curBranch ? 'selected' : ''}>${esc(nm)}</option>`).join('')}
          </select>
          <p class="ex-eg-hint" style="margin:6px 0 0">لو اخترت فرع، الأدمن ده هيشوف ويتنبّه لطلبات الفرع ده بس، ومش هيقدر يعدّل طلبات فرع تاني.</p>
        </div>
        <div class="ex-eg-field" id="a-perms-field" ${(existing && existing.role) === 'owner' ? 'hidden' : ''}>
          <label>الصلاحيات</label>
          <div class="ex-eg-perm-grid">
            ${PERMISSIONS.map(p => `
              <label class="ex-eg-perm-item"><input type="checkbox" data-perm="${p.key}" ${perms[p.key] ? 'checked' : ''}><span>${p.label}</span></label>
            `).join('')}
          </div>
        </div>
        <div class="ex-eg-auth-error" id="a-error" hidden></div>
        <div class="ex-eg-modal-close-row">
          <button class="ex-eg-btn ex-eg-ghost" id="m-cancel">إلغاء</button>
          <button class="ex-eg-btn" id="m-save">${ICONS.check} ${isEdit ? 'حفظ' : 'إنشاء الحساب'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    const roleSel = bg.querySelector('#a-role');
    roleSel.addEventListener('change', () => {
      bg.querySelector('#a-perms-field').hidden = roleSel.value === 'owner';
      bg.querySelector('#a-branch-field').hidden = roleSel.value === 'owner';
    });
    bg.querySelector('#m-cancel').addEventListener('click', () => bg.remove());
    bg.querySelector('#m-save').addEventListener('click', async () => {
      const role = roleSel.value;
      const permissions = role === 'owner' ? allPermissions() : {};
      if (role !== 'owner') {
        bg.querySelectorAll('[data-perm]').forEach(cb => permissions[cb.dataset.perm] = cb.checked);
        // قواعد القاعدة بتتحقق من "settings" العامة — بنفعّلها لو أي قسم إعدادات مفعّل
        permissions.settings = Object.keys(permissions).some(k => k.startsWith('settings_') && permissions[k]);
      }
      const name = bg.querySelector('#a-name').value.trim();
      const branchId = role === 'owner' ? '' : (bg.querySelector('#a-branch').value || '');
      const err = bg.querySelector('#a-error');
      const btn = bg.querySelector('#m-save');
      err.hidden = true; btn.disabled = true;
      try {
        if (isEdit) {
          await update(ref(db, `admins/${existing.uid}`), { name, role, permissions, branchId });
          toast('اتحفظت الصلاحيات', 'success');
        } else {
          const email = bg.querySelector('#a-email').value.trim();
          const password = bg.querySelector('#a-pass').value;
          if (!name || !email || password.length < 6) { err.hidden = false; err.textContent = 'اكمل البيانات (الباسورد 6 حروف على الأقل)'; btn.disabled = false; return; }
          await createStaffAdmin({ name, email, password, permissions, role, branchId });
          toast('اتعمل الحساب — ابعت الإيميل والباسورد للموظف', 'success');
        }
        bg.remove();
      } catch (e) {
        err.hidden = false; err.textContent = authError(e); btn.disabled = false;
      }
    });
  }
}
