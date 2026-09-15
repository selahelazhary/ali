import { db, ref, onValue } from '../../js/firebase-config.js';
import { esc, escNum } from '../../js/escape.js';
import { filterBarHtml, wireFilterBar, inDateRange, matchesText, setFilterCount } from './filters.js';

function fmtDate(ts) { if (!ts) return '-'; return new Date(ts).toLocaleDateString('ar-EG'); }

/* Customers are derived from orders (grouped by phone), so no customer data
   ever needs to be publicly readable. */
export function renderCustomers(container) {
  let all = [];
  let query = '';

  container.innerHTML = `
    <div class="ex-eg-card">
      <div class="ex-eg-card-head">
        <div><h3>العملاء</h3><p class="ex-eg-hint">بيتجمعوا تلقائياً من الطلبات حسب رقم التليفون.</p></div>
      </div>
      ${filterBarHtml({
        id: 'customers',
        placeholder: 'ابحث بالاسم أو رقم التليفون أو العنوان...',
        date: true,
        selects: [{ id: 'loyal', label: 'عدد الطلبات', options: [
          { value: 'all', label: 'كل العملاء' },
          { value: 'repeat', label: 'عملاء متكررين (أكتر من طلب)' },
          { value: 'vip', label: 'الأكثر طلباً (5 فأكتر)' },
          { value: 'once', label: 'طلب واحد بس' },
        ] }],
      })}
      <div class="ex-eg-table-wrap"><table>
        <thead><tr><th>الاسم</th><th>التليفون</th><th>عدد الطلبات</th><th>إجمالي الإنفاق</th><th>آخر عنوان</th><th>آخر طلب</th></tr></thead>
        <tbody id="cust-tbody"></tbody>
      </table></div>
      <div id="cust-empty" class="ex-eg-empty-d" hidden>مفيش عملاء لسه</div>
    </div>
  `;
  let flt = { q: '', date: 'all', day: '', sel: {} };
  const readFilters = wireFilterBar(container, 'customers', (v) => { flt = v; paint(); });
  flt = readFilters();

  onValue(ref(db, 'orders'), (snap) => {
    const map = {};
    snap.forEach(child => {
      const o = child.val() || {};
      if (o.status === 'cancelled') return;
      const key = (o.customerPhone || '').replace(/[^0-9+]/g, '') || 'unknown';
      const c = map[key] || (map[key] = { phone: o.customerPhone || '-', name: o.customerName || '-', orderCount: 0, totalSpent: 0, lastOrderAt: 0, lastAddress: null });
      c.orderCount++;
      c.totalSpent += o.total || 0;
      if ((o.createdAt || 0) > c.lastOrderAt) { c.lastOrderAt = o.createdAt || 0; c.name = o.customerName || c.name; if (o.address) c.lastAddress = o.address; }
    });
    all = Object.values(map).sort((a, b) => b.lastOrderAt - a.lastOrderAt);
    paint();
  }, () => { container.querySelector('#cust-empty').hidden = false; });

  function paint() {
    let list = all;
    // فلتر آخر طلب باليوم
    if (flt.date && flt.date !== 'all') list = list.filter(c => inDateRange(c.lastOrderAt, flt.date, flt.day));
    const loyal = flt.sel && flt.sel.loyal;
    if (loyal === 'repeat') list = list.filter(c => c.orderCount > 1);
    else if (loyal === 'vip') list = list.filter(c => c.orderCount >= 5);
    else if (loyal === 'once') list = list.filter(c => c.orderCount === 1);
    if (flt.q) list = list.filter(c => matchesText(c, ['name', 'phone', 'lastAddress'], flt.q));
    setFilterCount(container, 'customers', list.length, all.length);
    container.querySelector('#cust-empty').hidden = list.length > 0;
    container.querySelector('#cust-tbody').innerHTML = list.map(c => `
      <tr>
        <td><b>${esc(c.name)}</b></td>
        <td dir="ltr">${esc(c.phone)}</td>
        <td>${escNum(c.orderCount)}</td>
        <td>${Math.round(escNum(c.totalSpent))}</td>
        <td class="ex-eg-hint">${esc(c.lastAddress) || '-'}</td>
        <td>${fmtDate(c.lastOrderAt)}</td>
      </tr>
    `).join('');
  }
}
