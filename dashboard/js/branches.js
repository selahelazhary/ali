import { ICONS } from '../../js/icons.js';
import { esc, safeUrl } from '../../js/escape.js';
import { filterBarHtml, wireFilterBar, matchesText, setFilterCount } from './filters.js';
import { db, ref, onValue, set, remove, push } from '../../js/firebase-config.js';
import { EGYPT_GOVERNORATES } from '../../js/defaults.js';
import { attachTranslateButton, autoFillEnglish } from '../../js/translate.js';
import { toast } from './app.js';
import { publishImage } from './assetStore.js';
import { imgSrc, wireAssets } from '../../js/assets.js';
import { imageFieldTemplate, wireImageField, getImageFieldValue } from '../../js/imageUtils.js';

export function renderBranches(container) {
  container.innerHTML = `
    <div class="ex-eg-card">
      <div class="ex-eg-card-head">
        <div><h3>الفروع</h3><p class="ex-eg-hint">الفروع بتظهر للعميل في "معلومات المحل" وبيختار منها عند الاستلام.</p></div>
        <button class="ex-eg-btn" id="add-branch">${ICONS.plus} فرع جديد</button>
      </div>
      ${filterBarHtml({ id: 'branches', placeholder: 'ابحث باسم الفرع أو العنوان أو التليفون...' })}
      <div id="branch-list" class="ex-eg-branch-cards"></div>
    </div>
  `;
  container.querySelector('#add-branch').addEventListener('click', () => openModal());

  let flt = { q: '' };
  const readBranchFilters = wireFilterBar(container, 'branches', (v) => { flt = v; paint(); });
  flt = readBranchFilters();

  let list = [];
  onValue(ref(db, 'branches'), (snap) => {
    list = [];
    snap.forEach(c => { list.push({ id: c.key, ...c.val() }); });
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
    paint();
  }, () => {
    const box = container.querySelector('#branch-list');
    if (box) box.innerHTML = `<div class="ex-eg-empty-d">مفيش صلاحية</div>`;
  });

  function paint() {
    const box = container.querySelector('#branch-list');
    if (!box) return;
    const shown = flt.q
      ? list.filter(b => matchesText(b, ['name', 'address', 'phone', 'governorateId'], flt.q))
      : list;
    setFilterCount(container, 'branches', shown.length, list.length);
    if (!shown.length) { box.innerHTML = `<div class="ex-eg-empty-d">${list.length ? 'مفيش فرع مطابق للبحث' : 'مفيش فروع لسه'}</div>`; return; }
    // الترتيب بيتعامل مع مكان الفرع في القايمة الكاملة مش المفلترة
    box.innerHTML = shown.map((b) => { const i = list.indexOf(b); return `
      <div class="ex-eg-branch-card ${b.enabled === false ? 'ex-eg-off' : ''}">
        <div class="ex-eg-bc-icon">${b.image ? `<img ${imgSrc(b.image)} alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : ICONS.storefront}</div>
        <div class="ex-eg-bc-body">
          <div class="ex-eg-bc-name">${esc(b.name?.ar)} <span class="ex-eg-hint">${esc(b.name?.en)}</span></div>
          <div class="ex-eg-hint">${esc(b.address?.ar)}${b.governorateId ? ` • ${esc((EGYPT_GOVERNORATES.find(g => g.id === b.governorateId) || {}).ar)}` : ''}${b.phone ? ` • ${esc(b.phone)}` : ''}</div>
          ${b.mapUrl ? `<a class="ex-eg-map-pill" href="${safeUrl(b.mapUrl)}" target="_blank" rel="noopener noreferrer">${ICONS.map} الخريطة</a>` : ''}
        </div>
        <div class="ex-eg-bc-actions">
          <button class="ex-eg-icon-action" data-up="${i}" title="لأعلى">${ICONS.plus}</button>
          <button class="ex-eg-icon-action" data-down="${i}" title="لأسفل">${ICONS.minus}</button>
          <button class="ex-eg-icon-action" data-toggle="${esc(b.id)}" title="${b.enabled === false ? 'تفعيل' : 'إيقاف'}">${b.enabled === false ? ICONS.check : ICONS.close}</button>
          <button class="ex-eg-icon-action" data-edit="${esc(b.id)}">${ICONS.edit}</button>
          <button class="ex-eg-icon-action ex-eg-danger" data-del="${esc(b.id)}">${ICONS.trash}</button>
        </div>
      </div>
    `; }).join('');
    wireAssets(box);
    box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(list.find(x => x.id === b.dataset.edit))));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('حذف الفرع؟')) return;
      await remove(ref(db, `branches/${b.dataset.del}`)); toast('اتحذف', 'success');
    }));
    box.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
      const br = list.find(x => x.id === b.dataset.toggle);
      await set(ref(db, `branches/${br.id}/enabled`), br.enabled === false);
    }));
    const swap = async (i, j) => {
      if (j < 0 || j >= list.length) return;
      const a = list[i], b = list[j];
      await set(ref(db, `branches/${a.id}/order`), j);
      await set(ref(db, `branches/${b.id}/order`), i);
    };
    box.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.up), Number(b.dataset.up) - 1)));
    box.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', () => swap(Number(b.dataset.down), Number(b.dataset.down) + 1)));
  }

  function openModal(existing) {
    const b = existing || { name: { ar: '', en: '' }, address: { ar: '', en: '' }, mapUrl: '', phone: '', governorateId: 'cairo', enabled: true };
    const bg = document.createElement('div');
    bg.className = 'ex-eg-modal-bg';
    bg.innerHTML = `
      <div class="ex-eg-modal-box">
        <h3>${existing ? 'تعديل الفرع' : 'فرع جديد'}</h3>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>اسم الفرع (عربي)</label><input id="b-name-ar" value="${esc(b.name?.ar || '')}"></div>
          <div class="ex-eg-field"><label>اسم الفرع (إنجليزي)</label><input id="b-name-en" value="${esc(b.name?.en || '')}"></div>
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>العنوان (عربي)</label><textarea id="b-addr-ar" rows="2">${b.address?.ar || ''}</textarea></div>
          <div class="ex-eg-field"><label>العنوان (إنجليزي)</label><textarea id="b-addr-en" rows="2">${b.address?.en || ''}</textarea></div>
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>المحافظة</label><select id="b-gov">${EGYPT_GOVERNORATES.map(g => `<option value="${esc(g.id)}" ${g.id === b.governorateId ? 'selected' : ''}>${g.ar}</option>`).join('')}</select></div>
          <div class="ex-eg-field"><label>تليفون الفرع</label><input id="b-phone" value="${esc(b.phone || '')}" dir="ltr"></div>
        </div>
        <div class="ex-eg-field"><label>لينك الخريطة (Google Maps)</label><input id="b-map" value="${esc(b.mapUrl || '')}" dir="ltr" placeholder="https://maps.app.goo.gl/..."></div>
        ${imageFieldTemplate('b-image', b.image || '', 'صورة الفرع (بتظهر للعميل في "فروعنا")')}
        <div class="ex-eg-modal-close-row">
          <button class="ex-eg-btn ex-eg-ghost" id="m-cancel">إلغاء</button>
          <button class="ex-eg-btn" id="m-save">${ICONS.check} حفظ</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    attachTranslateButton(bg, 'b-name-ar', 'b-name-en');
    attachTranslateButton(bg, 'b-addr-ar', 'b-addr-en');
    wireImageField(bg, 'b-image');
    bg.querySelector('#m-cancel').addEventListener('click', () => bg.remove());
    bg.querySelector('#m-save').addEventListener('click', async () => {
      const $ = s => bg.querySelector(s);
      await autoFillEnglish($('#b-name-ar'), $('#b-name-en'));
      await autoFillEnglish($('#b-addr-ar'), $('#b-addr-en'));
      const data = {
        name: { ar: $('#b-name-ar').value.trim(), en: $('#b-name-en').value.trim() },
        address: { ar: $('#b-addr-ar').value.trim(), en: $('#b-addr-en').value.trim() },
        governorateId: $('#b-gov').value,
        phone: $('#b-phone').value.trim(),
        mapUrl: $('#b-map').value.trim(),
        image: await publishImage(getImageFieldValue(bg, 'b-image')) || '',
        enabled: b.enabled !== false,
        order: existing ? (b.order || 0) : list.length,
      };
      if (!data.name.ar) { toast('اكتب اسم الفرع', 'error'); return; }
      const id = existing ? existing.id : push(ref(db, 'branches')).key;
      await set(ref(db, `branches/${id}`), data);
      bg.remove(); toast('اتحفظ الفرع', 'success');
    });
  }
}
