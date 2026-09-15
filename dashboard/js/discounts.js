import { ICONS } from '../../js/icons.js';
import { esc } from '../../js/escape.js';
import { db, ref, get, set } from '../../js/firebase-config.js';
import { toast } from './app.js';
import { activeDiscount, discountedPrice, discountBadge } from '../../js/pricing.js';
import { DEFAULT_FEATURES } from '../../js/defaults.js';
import { sendBroadcast } from '../../js/broadcast.js';

async function readMenu() {
  try { const s = await get(ref(db, 'menu')); if (s.exists()) return s.val(); } catch (e) { /* fall through */ }
  return window.MENU_DATA ? JSON.parse(JSON.stringify(window.MENU_DATA)) : { categories: [] };
}
async function readFeatures() {
  try { const s = await get(ref(db, 'settings/features')); return Object.assign({}, DEFAULT_FEATURES, s.exists() ? s.val() : {}); } catch (e) { return { ...DEFAULT_FEATURES }; }
}
function tName(o) { return o ? (o.ar || o.en || '') : ''; }

export async function renderDiscounts(container) {
  container.innerHTML = `<div class="ex-eg-empty-d">جاري التحميل...</div>`;
  let menu = await readMenu();
  const features = await readFeatures();

  paint();

  function collect() {
    const rows = [];
    (menu.categories || []).forEach((c, ci) => (c.products || []).forEach((p, pi) => {
      const d = p.discount;
      if (d && Number(d.value) > 0) rows.push({ c, ci, p, pi, d, active: !!activeDiscount(p) });
    }));
    return rows.sort((a, b) => (b.d.createdAt || 0) - (a.d.createdAt || 0));
  }

  function paint() {
    const rows = collect();
    const cur = menu.currencyCode || 'EGP';
    container.innerHTML = `
      <div class="ex-eg-card">
        <div class="ex-eg-card-head">
          <div><h3>${ICONS.receipt} الخصومات</h3><p class="ex-eg-hint">الخصم بيظهر للعميل كسعر قديم مشطوب وسعر جديد مع شارة. تقدر تعمله على منتج، قسم كامل، أو كل المنتجات، مع تاريخ انتهاء.</p></div>
          <button class="ex-eg-btn" id="add-disc">${ICONS.plus} خصم جديد</button>
        </div>
        ${rows.length ? `
          <div class="ex-eg-table-wrap"><table>
            <thead><tr><th>المنتج</th><th>القسم</th><th>الخصم</th><th>السعر</th><th>حتى</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r, i) => {
                const v0 = (r.p.variants || [])[0] || { price: 0 };
                return `<tr>
                  <td><b>${tName(r.p.name)}</b></td>
                  <td class="ex-eg-hint">${tName(r.c.name)}</td>
                  <td><span class="ex-eg-disc-chip">${discountBadge(r.d, cur)}</span>${r.d.campaignId ? `<div class="ex-eg-hint">حملة</div>` : ''}</td>
                  <td><span class="ex-eg-hint" style="text-decoration:line-through">${v0.price}</span> <b>${discountedPrice(v0.price, r.d)}</b></td>
                  <td>${r.d.until ? new Date(r.d.until).toLocaleDateString('ar-EG') : '—'}</td>
                  <td><span class="ex-eg-badge-status ${r.active ? 'ready' : 'cancelled'}">${r.active ? 'فعّال' : 'منتهي'}</span></td>
                  <td><button class="ex-eg-btn ex-eg-sm ex-eg-danger" data-remove="${i}">${ICONS.trash}</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        ` : `<div class="ex-eg-empty-d">مفيش خصومات حالياً</div>`}
      </div>
    `;
    container.querySelector('#add-disc').addEventListener('click', openModal);
    container.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const r = rows[Number(b.dataset.remove)];
      if (!confirm(`إلغاء الخصم عن "${tName(r.p.name)}"${r.d.campaignId ? ' وكل منتجات نفس الحملة' : ''}؟`)) return;
      if (r.d.campaignId) {
        (menu.categories || []).forEach(c => (c.products || []).forEach(p => { if (p.discount && p.discount.campaignId === r.d.campaignId) delete p.discount; }));
      } else delete menu.categories[r.ci].products[r.pi].discount;
      await save(); toast('اتلغى الخصم', 'success'); paint();
    }));
  }

  async function save() {
    try { await set(ref(db, 'menu/categories'), menu.categories || []); }
    catch (e) { toast('مفيش صلاحية حفظ — تأكد من قواعد Firebase', 'error'); throw e; }
  }

  function openModal() {
    const cats = menu.categories || [];
    const bg = document.createElement('div');
    bg.className = 'ex-eg-modal-bg';
    const tomorrow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    bg.innerHTML = `
      <div class="ex-eg-modal-box">
        <h3>خصم جديد</h3>
        <div class="ex-eg-field"><label>نطاق الخصم</label>
          <select id="d-scope"><option value="product">منتج معين</option><option value="category">قسم كامل</option><option value="all">كل المنتجات</option></select>
        </div>
        <div class="ex-eg-field" id="d-cat-field"><label>القسم</label>
          <select id="d-cat">${cats.map((c, i) => `<option value="${esc(i)}">${tName(c.name)}</option>`).join('')}</select>
        </div>
        <div class="ex-eg-field" id="d-prod-field"><label>المنتج</label><select id="d-prod"></select></div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>نوع الخصم</label><select id="d-type"><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت</option></select></div>
          <div class="ex-eg-field"><label>القيمة</label><input id="d-value" type="number" min="1" value="10"></div>
        </div>
        <div class="ex-eg-row-2">
          <div class="ex-eg-field"><label>ينتهي في (اختياري)</label><input id="d-until" type="date" value="${esc(tomorrow)}"></div>
          <div class="ex-eg-field"><label>اسم الحملة (اختياري)</label><input id="d-label" placeholder="مثال: عرض الويكند"></div>
        </div>
        <label class="ex-eg-perm-item" style="margin-bottom:6px"><input type="checkbox" id="d-notify" ${features.notifications && features.notifyDiscounts ? 'checked' : ''} ${features.notifications ? '' : 'disabled'}><span>إرسال إشعار بالخصم لكل المشتركين${features.notifications ? '' : ' (الإشعارات متوقفة من الإعدادات)'}</span></label>
        <div class="ex-eg-modal-close-row">
          <button class="ex-eg-btn ex-eg-ghost" id="m-cancel">إلغاء</button>
          <button class="ex-eg-btn" id="m-save">${ICONS.check} تطبيق الخصم</button>
        </div>
      </div>
    `;
    document.body.appendChild(bg);
    const $ = s => bg.querySelector(s);
    function fillProducts() {
      const c = cats[Number($('#d-cat').value)] || { products: [] };
      $('#d-prod').innerHTML = (c.products || []).map((p, i) => `<option value="${esc(i)}">${tName(p.name)} — ${(p.variants || [])[0]?.price ?? ''}</option>`).join('');
    }
    function updateScope() {
      const s = $('#d-scope').value;
      $('#d-cat-field').hidden = s === 'all';
      $('#d-prod-field').hidden = s !== 'product';
    }
    $('#d-cat').addEventListener('change', fillProducts);
    $('#d-scope').addEventListener('change', updateScope);
    fillProducts(); updateScope();
    $('#m-cancel').addEventListener('click', () => bg.remove());
    $('#m-save').addEventListener('click', async () => {
      const value = Number($('#d-value').value);
      if (!(value > 0)) { toast('اكتب قيمة الخصم', 'error'); return; }
      const type = $('#d-type').value;
      if (type === 'percent' && value >= 100) { toast('النسبة لازم تكون أقل من 100', 'error'); return; }
      const until = $('#d-until').value ? new Date($('#d-until').value + 'T23:59:59').getTime() : null;
      const scope = $('#d-scope').value;
      const label = $('#d-label').value.trim();
      const campaignId = scope === 'product' ? null : 'c' + Date.now();
      const disc = { type, value, until, label: label || null, createdAt: Date.now() };
      if (campaignId) disc.campaignId = campaignId;

      const targets = [];
      if (scope === 'product') targets.push({ c: cats[Number($('#d-cat').value)], p: cats[Number($('#d-cat').value)].products[Number($('#d-prod').value)] });
      else if (scope === 'category') { const c = cats[Number($('#d-cat').value)]; (c.products || []).forEach(p => targets.push({ c, p })); }
      else cats.forEach(c => (c.products || []).forEach(p => targets.push({ c, p })));
      if (!targets.length) { toast('مفيش منتجات في النطاق ده', 'error'); return; }
      targets.forEach(t => { t.p.discount = { ...disc }; });

      $('#m-save').disabled = true;
      try { await save(); } catch (e) { $('#m-save').disabled = false; return; }

      if ($('#d-notify').checked) {
        const cur = menu.currencyCode || 'EGP';
        const badge = discountBadge(disc, cur);
        const first = targets[0];
        const title = scope === 'product' ? `خصم ${badge} على ${tName(first.p.name)} 🔥` : scope === 'category' ? `خصم ${badge} على كل ${tName(first.c.name)} 🔥` : `خصم ${badge} على كل المنيو 🔥`;
        const body = label || (until ? `العرض ساري حتى ${new Date(until).toLocaleDateString('ar-EG')}` : 'اطلب دلوقتي');
        try { await sendBroadcast({ type: 'discount', title, body, productId: scope === 'product' ? first.p.id : null, image: scope === 'product' ? (first.p.image || null) : null }); toast('اتطبّق الخصم واتبعت الإشعار', 'success'); }
        catch (e) { toast('اتطبّق الخصم لكن الإشعار فشل', 'error'); }
      } else toast('اتطبّق الخصم', 'success');
      bg.remove(); paint();
    });
  }
}
