import { ICONS } from '../../js/icons.js';
import { esc, safeUrl } from '../../js/escape.js';
import { db, ref, get, set } from '../../js/firebase-config.js';
import { toast } from './app.js';
import { publishImage } from './assetStore.js';
import { imgSrc, wireAssets } from '../../js/assets.js';
import { imageFieldTemplate, wireImageField, getImageFieldValue, getImageFitValue } from '../../js/imageUtils.js';
import { attachTranslateButton, autoFillEnglish } from '../../js/translate.js';
import { sendBroadcast } from '../../js/broadcast.js';
import { DEFAULT_FEATURES } from '../../js/defaults.js';
import { loadAllRatings } from '../../js/ratings.js';

async function readFeatures() {
  try { const s = await get(ref(db, 'settings/features')); return Object.assign({}, DEFAULT_FEATURES, s.exists() ? s.val() : {}); } catch (e) { return { ...DEFAULT_FEATURES }; }
}

let menu = null; // { categories: [...] }
let activeCatIndex = 0;
let searchQuery = '';
let RATINGS = {};

async function loadMenu() {
  try {
    const snap = await get(ref(db, 'menu'));
    if (snap.exists()) return snap.val();
  } catch (e) { /* not readable yet */ }
  return null;
}
/* حارس الحفظ.
   المشكلة اللي بيحلّها: الحفظ بياخد ثواني (ترجمة + رفع الصورة + الكتابة)،
   والزرار كان فاضل شغال — فأي ضغطتين أو تلاتة كانوا بيضيفوا المنتج مرتين
   وتلاتة. وكمان لو الحفظ فشل مكانش بيظهر أي خطأ فيبان إنه "مش بيحفظ". */
function guardSave(btn, label, fn) {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'جاري الحفظ...';
  Promise.resolve()
    .then(fn)
    .catch((e) => {
      const msg = (e && e.message) || '';
      toast(/permission|PERMISSION/i.test(msg) ? 'مفيش صلاحية للحفظ' : 'الحفظ ما تمّش — ' + (msg.slice(0, 60) || 'حاول تاني'), 'error');
    })
    .finally(() => {
      if (!btn.isConnected) return;   // النافذة اتقفلت بعد نجاح الحفظ
      btn.dataset.busy = '0';
      btn.disabled = false;
      btn.innerHTML = original;
    });
}

async function saveMenu() {
  (menu.categories || []).forEach((c, i) => { if (c && c.id == null) c.id = Date.now() + i; });
  try { await set(ref(db, 'menu/categories'), menu.categories || []); }
  catch (e) { toast('مفيش صلاحية للحفظ — راجع صلاحيات حسابك', 'error'); throw e; }
}

export async function renderMenuEditor(container) {
  container.innerHTML = `<div class="ex-eg-empty-d">جاري التحميل...</div>`;
  menu = await loadMenu();

  if (!menu) menu = { categories: [] };
  if (!Array.isArray(menu.categories)) menu.categories = [];

  loadAllRatings().then(r => { RATINGS = r; paint(); }).catch(() => {});
  paint();

  function paint() {
    container.innerHTML = `
      <div class="ex-eg-row-2" style="align-items:flex-start;">
        <div class="ex-eg-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:14px;">الأقسام</h3>
            <button class="ex-eg-btn ex-eg-sm" id="add-cat">${ICONS.plus} قسم جديد</button>
          </div>
          <div class="ex-eg-cat-manager" id="cat-manager"></div>
        </div>
        <div class="ex-eg-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:14px;" id="products-title">المنتجات</h3>
            <button class="ex-eg-btn ex-eg-sm" id="add-product">${ICONS.plus} منتج جديد</button>
          </div>
          <div class="ex-eg-menu-search">
            ${ICONS.search}
            <input id="menu-search" type="search" placeholder="دوّر على أي منتج في المنيو كله..." value="${esc(searchQuery)}" autocomplete="off">
            <button type="button" class="ex-eg-search-clear" id="menu-search-clear" ${searchQuery ? '' : 'hidden'}>${ICONS.close}</button>
          </div>
          <div class="ex-eg-product-grid-d" id="products-grid"></div>
        </div>
      </div>
    `;
    paintCategories();
    paintProducts();
    container.querySelector('#add-cat').addEventListener('click', () => openCategoryModal());
    container.querySelector('#add-product').addEventListener('click', () => openProductModal());

    /* البحث بيدوّر في كل أقسام المنيو مش القسم المفتوح بس */
    const search = container.querySelector('#menu-search');
    const clear = container.querySelector('#menu-search-clear');
    search.addEventListener('input', () => {
      searchQuery = search.value;
      clear.hidden = !searchQuery;
      paintProducts();
    });
    clear.addEventListener('click', () => {
      searchQuery = '';
      search.value = '';
      clear.hidden = true;
      paintProducts();
      search.focus();
    });
  }

  function paintCategories() {
    const box = container.querySelector('#cat-manager');
    if (!menu.categories.length) { box.innerHTML = `<div class="ex-eg-empty-d">مفيش أقسام لسه — اضغط "قسم جديد" وابدأ ببناء المنيو</div>`; return; }
    box.innerHTML = menu.categories.map((c, i) => `
      <div class="ex-eg-cat-row ${i === activeCatIndex ? 'ex-eg-active' : ''}" style="${i === activeCatIndex ? `border-color:var(--primary);background:var(--primary-light);` : ''}" data-i="${i}">
        <button class="ex-eg-drag-handle" data-act="drag" title="اسحب للترتيب" aria-label="اسحب للترتيب">${ICONS.menu}</button>
        <img ${imgSrc(c.image)} alt="" loading="lazy">
        <span class="ex-eg-cn"><span class="ex-eg-cat-num">${i + 1}</span>${esc(c.name?.ar || c.name?.en || '')}</span>
        <button class="ex-eg-icon-action" data-act="up" title="لأعلى">${ICONS.plus}</button>
        <button class="ex-eg-icon-action" data-act="down" title="لأسفل">${ICONS.minus}</button>
        <button class="ex-eg-icon-action" data-act="edit" title="تعديل">${ICONS.edit}</button>
        <button class="ex-eg-icon-action" data-act="del" title="حذف">${ICONS.trash}</button>
      </div>
    `).join('');

    box.querySelectorAll('.ex-eg-cat-row').forEach(row => {
      const i = Number(row.dataset.i);
      row.addEventListener('click', (e) => {
        if (e.target.closest('[data-act]')) return;
        activeCatIndex = i;
        paintCategories(); paintProducts();
      });
      row.querySelector('[data-act="edit"]').addEventListener('click', () => openCategoryModal(i));
      wireAssets(row);
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm('متأكد من حذف القسم ده وكل منتجاته؟')) return;
        menu.categories.splice(i, 1);
        if (activeCatIndex >= menu.categories.length) activeCatIndex = Math.max(0, menu.categories.length - 1);
        await saveMenu(); toast('اتحذف القسم', 'success'); paint();
      });
      row.querySelector('[data-act="up"]').addEventListener('click', async () => {
        if (i === 0) return;
        [menu.categories[i - 1], menu.categories[i]] = [menu.categories[i], menu.categories[i - 1]];
        if (activeCatIndex === i) activeCatIndex = i - 1; else if (activeCatIndex === i - 1) activeCatIndex = i;
        await saveMenu(); paint();
      });
      row.querySelector('[data-act="down"]').addEventListener('click', async () => {
        if (i === menu.categories.length - 1) return;
        [menu.categories[i + 1], menu.categories[i]] = [menu.categories[i], menu.categories[i + 1]];
        if (activeCatIndex === i) activeCatIndex = i + 1; else if (activeCatIndex === i + 1) activeCatIndex = i;
        await saveMenu(); paint();
      });
    });

    wireCategoryDrag(box);
  }

  /* سحب وإفلات عام للترتيب (بيتستخدم للأقسام والمنتجات).
     ليه مش drag & drop بتاع HTML: مابيشتغلش باللمس على الموبايل، واللوحة
     بتتفتح من الموبايل كتير. Pointer Events بتغطي الماوس واللمس مع بعض.
     onReorder(from, to) بترتّب الداتا وبتحفظ. */
  function wireDragSort(box, { itemSelector, handleSelector, indexAttr, onReorder }) {
    let dragging = null, startY = 0, fromIndex = -1, moved = false;

    const rowsNow = () => [...box.querySelectorAll(itemSelector)];

    box.querySelectorAll(handleSelector).forEach((handle) => {
      const owner = handle.closest(itemSelector);
      if (!owner) return;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        dragging = owner;
        fromIndex = Number(dragging.dataset[indexAttr]);
        startY = e.clientY;
        moved = false;
        dragging.classList.add('ex-eg-dragging');
        handle.setPointerCapture(e.pointerId);
      });

      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        if (Math.abs(dy) > 3) moved = true;
        dragging.style.transform = `translateY(${dy}px)`;

        /* بندوّر على الصف اللي مركزه عدّى عليه مركز الصف المسحوب */
        const rows = rowsNow().filter(r => r !== dragging);
        const y = e.clientY;
        let target = null;
        for (const r of rows) {
          const b = r.getBoundingClientRect();
          if (y > b.top && y < b.bottom) { target = r; break; }
        }
        if (target) {
          const tb = target.getBoundingClientRect();
          const after = y > tb.top + tb.height / 2;
          target.parentNode.insertBefore(dragging, after ? target.nextSibling : target);
          startY = e.clientY;
          dragging.style.transform = '';
        }
      });

      const finish = async (e) => {
        if (!dragging) return;
        const el = dragging;
        dragging = null;
        el.style.transform = '';
        el.classList.remove('ex-eg-dragging');
        try { handle.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (!moved) return;

        const toIndex = rowsNow().indexOf(el);
        if (toIndex < 0 || toIndex === fromIndex) { paint(); return; }
        await onReorder(fromIndex, toIndex);
      };
      handle.addEventListener('pointerup', finish);
      handle.addEventListener('pointercancel', finish);
    });
  }

  /* ترتيب الأقسام */
  function wireCategoryDrag(box) {
    wireDragSort(box, {
      itemSelector: '.ex-eg-cat-row',
      handleSelector: '[data-act="drag"]',
      indexAttr: 'i',
      onReorder: async (from, to) => {
        const [item] = menu.categories.splice(from, 1);
        menu.categories.splice(to, 0, item);
        /* القسم المفتوح يفضل هو هو بعد الترتيب */
        if (activeCatIndex === from) activeCatIndex = to;
        else if (from < activeCatIndex && to >= activeCatIndex) activeCatIndex -= 1;
        else if (from > activeCatIndex && to <= activeCatIndex) activeCatIndex += 1;
        try { await saveMenu(); toast('اتغيّر ترتيب الأقسام', 'success'); }
        catch (err) { /* saveMenu بتوري الخطأ بنفسها */ }
        paint();
      },
    });
  }

  /* ترتيب المنتجات جوّه القسم المفتوح */
  function wireProductDrag(grid) {
    wireDragSort(grid, {
      itemSelector: '.ex-eg-product-card-d',
      handleSelector: '[data-act="pdrag"]',
      indexAttr: 'pi',
      onReorder: async (from, to) => {
        const cat = menu.categories[activeCatIndex];
        if (!cat || !Array.isArray(cat.products)) { paint(); return; }
        const [item] = cat.products.splice(from, 1);
        cat.products.splice(to, 0, item);
        try { await saveMenu(); toast('اتغيّر ترتيب المنتجات', 'success'); }
        catch (err) { /* saveMenu بتوري الخطأ بنفسها */ }
        paint();
      },
    });
  }

  /* كل منتجات المنيو اللي بتطابق كلمة البحث، مع قسمها */
  function searchMatches(query) {
    const q = query.trim().toLowerCase();
    const out = [];
    menu.categories.forEach((cat, ci) => {
      (cat.products || []).forEach((p, pi) => {
        const hay = [
          p.name?.ar, p.name?.en, p.description?.ar, p.description?.en,
          cat.name?.ar, cat.name?.en,
          ...(p.variants || []).map(v => `${v.name?.ar || ''} ${v.name?.en || ''} ${v.price}`),
        ].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) out.push({ cat, ci, p, pi });
      });
    });
    return out;
  }

  function productCardHtml(p, ci, pi, catLabel) {
    /* السحب بيشتغل بس في عرض القسم الواحد (catLabel فاضي) — في نتايج البحث
       المنتجات جاية من أقسام مختلفة فالترتيب مالوش معنى. */
    return `
      <div class="ex-eg-product-card-d" data-pi="${pi}">
        ${catLabel ? '' : `<button class="ex-eg-drag-handle ex-eg-pcd-drag" data-act="pdrag" title="اسحب للترتيب" aria-label="اسحب للترتيب">${ICONS.menu}</button>`}
        <img ${imgSrc(p.image)} alt="" loading="lazy">
        <div class="ex-eg-pcd-body">
          ${catLabel ? `<div class="ex-eg-pcd-cat">${esc(catLabel)}</div>` : ''}
          <div class="ex-eg-pcd-name">${esc(p.name?.ar || p.name?.en || '')}</div>
          <div class="ex-eg-pcd-price">${(p.variants || []).map(v => Number(v.price) || 0).join(' / ')}</div>
          ${(() => { const r = RATINGS[p.id]; return r && r.count
            ? `<div class="ex-eg-pcd-rating" title="متوسط تقييم العملاء">★ ${r.avg} <small>(${r.count})</small></div>` : ''; })()}
          <div class="ex-eg-pcd-actions">
            <button class="ex-eg-btn ex-eg-sm ex-eg-ghost" data-act="edit" data-ci="${ci}" data-i="${pi}">${ICONS.edit}</button>
            <button class="ex-eg-btn ex-eg-sm ex-eg-danger" data-act="del" data-ci="${ci}" data-i="${pi}">${ICONS.trash}</button>
          </div>
        </div>
      </div>`;
  }

  function paintProducts() {
    const cat = menu.categories[activeCatIndex];
    const grid = container.querySelector('#products-grid');
    const title = container.querySelector('#products-title');
    const addBtn = container.querySelector('#add-product');
    const searching = !!searchQuery.trim();

    if (addBtn) addBtn.disabled = !cat || searching;

    if (searching) {
      const hits = searchMatches(searchQuery);
      title.textContent = `نتائج البحث (${hits.length})`;
      grid.innerHTML = hits.length
        ? hits.map(h => productCardHtml(h.p, h.ci, h.pi, h.cat.name?.ar || h.cat.name?.en || '')).join('')
        : `<div class="ex-eg-empty-d">مفيش منتج بالاسم ده في المنيو</div>`;
    } else {
      title.textContent = cat ? `منتجات: ${cat.name?.ar || cat.name?.en || ''}` : 'المنتجات';
      if (!cat) { grid.innerHTML = `<div class="ex-eg-empty-d">اعمل قسم الأول عشان تضيف فيه منتجات</div>`; return; }
      if (!cat.products || !cat.products.length) { grid.innerHTML = `<div class="ex-eg-empty-d">مفيش منتجات في القسم ده</div>`; return; }
      grid.innerHTML = cat.products.map((p, i) => productCardHtml(p, activeCatIndex, i, '')).join('');
    }

    wireAssets(grid);
    wireProductDrag(grid);
    grid.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => {
      activeCatIndex = Number(b.dataset.ci);
      openProductModal(Number(b.dataset.i));
    }));
    grid.querySelectorAll('[data-act="del"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('متأكد من حذف المنتج؟')) return;
      const target = menu.categories[Number(b.dataset.ci)];
      target.products.splice(Number(b.dataset.i), 1);
      await saveMenu(); toast('اتحذف المنتج', 'success'); paintProducts(); paintCategories();
    }));
  }

  function openCategoryModal(index) {
    const isEdit = index != null;
    const cat = isEdit ? menu.categories[index] : { id: Date.now(), name: { ar: '', en: '' }, image: '', products: [] };
    const bg = document.createElement('div');
    bg.className = 'ex-eg-modal-bg';
    bg.innerHTML = `
      <div class="ex-eg-modal-box">
        <h3>${isEdit ? 'تعديل القسم' : 'قسم جديد'}</h3>
        <div class="ex-eg-field"><label>الاسم (عربي)</label><input id="m-name-ar" value="${esc(cat.name?.ar || '')}"></div>
        <div class="ex-eg-field"><label>الاسم (إنجليزي)</label><input id="m-name-en" value="${esc(cat.name?.en || '')}"></div>
        ${imageFieldTemplate('m-image', cat.image, 'صورة القسم', cat.imageFit)}
        <div class="ex-eg-modal-close-row">
          <button class="ex-eg-btn ex-eg-ghost" id="m-cancel">إلغاء</button>
          <button class="ex-eg-btn" id="m-save">${ICONS.check} حفظ</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    wireImageField(bg, 'm-image');
    attachTranslateButton(bg, 'm-name-ar', 'm-name-en');
    bg.querySelector('#m-cancel').addEventListener('click', () => bg.remove());
    const saveBtn = bg.querySelector('#m-save');
    saveBtn.addEventListener('click', () => guardSave(saveBtn, 'حفظ', async () => {
      await autoFillEnglish(bg.querySelector('#m-name-ar'), bg.querySelector('#m-name-en'));
      const newCat = {
        ...cat,
        name: { ar: bg.querySelector('#m-name-ar').value.trim(), en: bg.querySelector('#m-name-en').value.trim() },
        image: await publishImage(getImageFieldValue(bg, 'm-image')) || cat.image || '',
        imageFit: getImageFitValue(bg, 'm-image'),
      };
      if (isEdit) menu.categories[index] = newCat; else menu.categories.push(newCat);
      await saveMenu();
      bg.remove(); toast('اتحفظ', 'success'); paint();
    }));
  }

  function openProductModal(index) {
    const cat = menu.categories[activeCatIndex];
    if (!cat) { toast('اعمل قسم الأول', 'error'); return; }
    if (!Array.isArray(cat.products)) cat.products = [];
    const isEdit = index != null;
    const p = isEdit ? cat.products[index] : {
      id: Date.now(), name: { ar: '', en: '' }, description: { ar: '', en: '' }, image: '', isNew: false, isBestseller: false,
      variants: [{ name: { ar: '', en: '' }, price: 0, oldPrice: null }],
    };
    const bg = document.createElement('div');
    bg.className = 'ex-eg-modal-bg';
    bg.innerHTML = `
      <div class="ex-eg-modal-box">
        <h3>${isEdit ? 'تعديل المنتج' : 'منتج جديد'}</h3>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>الاسم (عربي)</label><input id="p-name-ar" value="${esc(p.name?.ar || '')}"></div>
          <div class="ex-eg-field"><label>الاسم (إنجليزي)</label><input id="p-name-en" value="${esc(p.name?.en || '')}"></div>
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>الوصف (عربي)</label><textarea id="p-desc-ar" rows="2">${p.description?.ar || ''}</textarea></div>
          <div class="ex-eg-field"><label>الوصف (إنجليزي)</label><textarea id="p-desc-en" rows="2">${p.description?.en || ''}</textarea></div>
        </div>
        ${imageFieldTemplate('p-image', p.image, 'صورة المنتج', p.imageFit)}
        <div class="ex-eg-field">
          <label><input type="checkbox" id="p-new" ${p.isNew ? 'checked' : ''}> منتج جديد</label>
          &nbsp;&nbsp;
          <label><input type="checkbox" id="p-best" ${p.isBestseller ? 'checked' : ''}> الأكثر مبيعاً</label>
          ${isEdit ? '' : `&nbsp;&nbsp;<label><input type="checkbox" id="p-notify" checked> إرسال إشعار للمشتركين بالمنتج الجديد</label>`}
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>خصم سريع (%) — اختياري</label><input id="p-disc" type="number" min="0" max="99" value="${esc(p.discount && p.discount.type === 'percent' ? p.discount.value : '')}" placeholder="مثال: 15"></div>
          <div class="ex-eg-field"><label>الخصم ينتهي في</label><input id="p-disc-until" type="date" value="${esc(p.discount && p.discount.until ? new Date(p.discount.until).toISOString().slice(0, 10) : '')}"></div>
        </div>
        <div class="ex-eg-field">
          <label>الأحجام / الأسعار</label>
          <div id="variant-rows"></div>
          <button class="ex-eg-btn ex-eg-sm ex-eg-ghost" id="add-variant" type="button">${ICONS.plus} حجم جديد</button>
        </div>
        <div class="ex-eg-modal-close-row">
          <button class="ex-eg-btn ex-eg-ghost" id="m-cancel">إلغاء</button>
          <button class="ex-eg-btn" id="m-save">${ICONS.check} حفظ</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    wireImageField(bg, 'p-image');
    attachTranslateButton(bg, 'p-name-ar', 'p-name-en');
    attachTranslateButton(bg, 'p-desc-ar', 'p-desc-en');

    let variants = JSON.parse(JSON.stringify(p.variants || []));
    function paintVariants() {
      bg.querySelector('#variant-rows').innerHTML = variants.map((v, vi) => `
        <div class="ex-eg-variant-editor-row" data-vi="${vi}">
          <input class="ex-eg-v-name-ar" placeholder="الحجم (عربي)" value="${esc(v.name?.ar || '')}">
          <input class="ex-eg-v-name-en" placeholder="الحجم (إنجليزي)" value="${esc(v.name?.en || '')}">
          <input class="ex-eg-v-price" type="number" placeholder="السعر" value="${esc(v.price ?? '')}">
          <input class="ex-eg-v-old" type="number" placeholder="سعر قديم" value="${esc(v.oldPrice ?? '')}">
          <button class="ex-eg-icon-action" data-del-variant="${vi}">${ICONS.trash}</button>
        </div>
      `).join('');
      bg.querySelectorAll('[data-del-variant]').forEach(b => b.addEventListener('click', () => {
        variants.splice(Number(b.dataset.delVariant), 1);
        paintVariants();
      }));
    }
    paintVariants();
    bg.querySelector('#add-variant').addEventListener('click', () => {
      variants.push({ name: { ar: '', en: '' }, price: 0, oldPrice: null });
      paintVariants();
    });

    bg.querySelector('#m-cancel').addEventListener('click', () => bg.remove());
    const saveBtn = bg.querySelector('#m-save');
    saveBtn.addEventListener('click', () => guardSave(saveBtn, 'حفظ', async () => {
      await autoFillEnglish(bg.querySelector('#p-name-ar'), bg.querySelector('#p-name-en'));
      await autoFillEnglish(bg.querySelector('#p-desc-ar'), bg.querySelector('#p-desc-en'));
      bg.querySelectorAll('.ex-eg-variant-editor-row').forEach((row, vi) => {
        variants[vi] = {
          name: { ar: row.querySelector('.ex-eg-v-name-ar').value.trim(), en: row.querySelector('.ex-eg-v-name-en').value.trim() },
          price: Number(row.querySelector('.ex-eg-v-price').value) || 0,
          oldPrice: row.querySelector('.ex-eg-v-old').value ? Number(row.querySelector('.ex-eg-v-old').value) : null,
        };
      });
      const newP = {
        ...p,
        name: { ar: bg.querySelector('#p-name-ar').value.trim(), en: bg.querySelector('#p-name-en').value.trim() },
        description: { ar: bg.querySelector('#p-desc-ar').value.trim(), en: bg.querySelector('#p-desc-en').value.trim() },
        image: await publishImage(getImageFieldValue(bg, 'p-image')) || p.image || '',
        imageFit: getImageFitValue(bg, 'p-image'),
        isNew: bg.querySelector('#p-new').checked,
        isBestseller: bg.querySelector('#p-best').checked,
        variants,
      };
      const discVal = Number(bg.querySelector('#p-disc').value);
      if (discVal > 0 && discVal < 100) {
        const untilStr = bg.querySelector('#p-disc-until').value;
        newP.discount = { type: 'percent', value: discVal, until: untilStr ? new Date(untilStr + 'T23:59:59').getTime() : null, createdAt: (p.discount && p.discount.createdAt) || Date.now() };
      } else if (p.discount && !p.discount.campaignId) {
        delete newP.discount;
      }
      if (isEdit) cat.products[index] = newP; else cat.products.push(newP);
      await saveMenu();
      bg.remove(); toast('اتحفظ', 'success'); paintProducts();

      const notifyEl = bg.querySelector('#p-notify');
      if (!isEdit && notifyEl && notifyEl.checked) {
        const f = await readFeatures();
        if (f.notifications && f.notifyNewProducts) {
          const price = (newP.variants[0] || {}).price;
          try {
            await sendBroadcast({ type: 'newProduct', title: `جديد: ${newP.name.ar} 🥩`, body: price ? `${menu.currencyCode || 'EGP'} ${price} — جرّبه دلوقتي` : 'جرّبه دلوقتي', productId: newP.id, image: newP.image || null });
            toast('اتبعت إشعار المنتج الجديد للمشتركين', 'success');
          } catch (e) { /* broadcast is best-effort */ }
        }
      }
    }));
  }
}
