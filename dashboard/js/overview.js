import { ICONS } from '../../js/icons.js';
import { db, ref, onValue } from '../../js/firebase-config.js';

function tName(obj) { if (!obj) return ''; return obj.ar || obj.en || ''; }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function renderOverview(container, { profile } = {}) {
  /* أدمن مربوط بفرع: الإحصائيات بتاعة فرعه بس */
  const myBranch = profile && profile.role !== 'owner' && profile.branchId ? String(profile.branchId) : '';
  container.innerHTML = `
    <div class="ex-eg-stat-grid" id="stat-grid"></div>
    <div class="ex-eg-row-2">
      <div class="ex-eg-card">
        <h3 style="margin:0 0 12px;font-size:14px;">أحدث الطلبات</h3>
        <div id="recent-orders"></div>
      </div>
      <div class="ex-eg-card">
        <h3 style="margin:0 0 12px;font-size:14px;">الأكثر طلباً</h3>
        <div id="top-items"></div>
      </div>
    </div>
  `;

  onValue(ref(db, 'orders'), (snap) => {
    let orders = [];
    snap.forEach(child => { orders.push({ id: child.key, ...child.val() }); });
    if (myBranch) orders = orders.filter(o => o.branchId === myBranch);
    orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const today = startOfToday();
    const todays = orders.filter(o => (o.createdAt || 0) >= today);
    const revenueToday = todays.reduce((s, o) => s + (o.total || 0), 0);
    const pending = orders.filter(o => o.status === 'new' || o.status === 'preparing').length;

    container.querySelector('#stat-grid').innerHTML = `
      ${statCard(ICONS.bag, 'طلبات اليوم', todays.length)}
      ${statCard(ICONS.chart, 'إيراد اليوم', `${todays[0]?.currencyCode || ''} ${revenueToday}`)}
      ${statCard(ICONS.clock, 'طلبات قيد التنفيذ', pending)}
      ${statCard(ICONS.list, 'إجمالي الطلبات', orders.length)}
    `;

    const recent = orders.slice(0, 6);
    container.querySelector('#recent-orders').innerHTML = recent.length ? `
      <div class="ex-eg-table-wrap"><table><tbody>
        ${recent.map(o => `
          <tr>
            <td><b>#${o.id.slice(-5)}</b></td>
            <td>${o.customerName || '-'}</td>
            <td>${o.currencyCode || ''} ${o.total || 0}</td>
            <td><span class="ex-eg-badge-status ${o.status}">${statusLabel(o.status)}</span></td>
          </tr>
        `).join('')}
      </tbody></table></div>
    ` : `<div class="ex-eg-empty-d">لسه مفيش طلبات</div>`;

    const counts = {};
    orders.forEach(o => (o.items || []).forEach(i => {
      const key = tName(i.name);
      counts[key] = (counts[key] || 0) + i.qty;
    }));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    container.querySelector('#top-items').innerHTML = top.length ? `
      <div class="ex-eg-table-wrap"><table><tbody>
        ${top.map(([name, qty]) => `<tr><td>${name}</td><td><b>${qty}</b></td></tr>`).join('')}
      </tbody></table></div>
    ` : `<div class="ex-eg-empty-d">لسه مفيش بيانات</div>`;
  });
}

function statCard(icon, label, value) {
  return `
    <div class="ex-eg-stat-card">
      <div class="ex-eg-stat-icon">${icon}</div>
      <div class="ex-eg-stat-label">${label}</div>
      <div class="ex-eg-stat-value">${value}</div>
    </div>
  `;
}

function statusLabel(s) {
  return { new: 'جديد', preparing: 'قيد التجهيز', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' }[s] || s || '-';
}

export { statusLabel };
