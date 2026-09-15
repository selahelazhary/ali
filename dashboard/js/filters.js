/* شريط فلترة موحّد لكل أقسام لوحة التحكم: بحث بالنص + فلتر باليوم + تصنيفات.
   كل قسم بينادي filterBarHtml() في الـ HTML بتاعه، وبعدين wireFilterBar()
   وبيديها دالة بتتنفّذ مع أي تغيير. */
import { ICONS } from '../../js/icons.js';
import { esc } from '../../js/escape.js';

export const DATE_PRESETS = [
  { id: 'all', label: 'كل الأوقات' },
  { id: 'today', label: 'النهاردة' },
  { id: 'yesterday', label: 'إمبارح' },
  { id: 'last7', label: 'آخر ٧ أيام' },
  { id: 'last30', label: 'آخر ٣٠ يوم' },
  { id: 'month', label: 'الشهر ده' },
  { id: 'custom', label: 'يوم محدد...' },
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

/* هل الوقت ده داخل الفترة المختارة؟ */
export function inDateRange(ts, preset, customDate) {
  if (!preset || preset === 'all') return true;
  const t = Number(ts) || 0;
  if (!t) return false;
  const today = startOfDay(Date.now());
  const DAY = 86400000;
  switch (preset) {
    case 'today': return t >= today && t < today + DAY;
    case 'yesterday': return t >= today - DAY && t < today;
    case 'last7': return t >= today - 6 * DAY;
    case 'last30': return t >= today - 29 * DAY;
    case 'month': { const d = new Date(); return t >= startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)); }
    case 'custom': {
      if (!customDate) return true;
      const from = startOfDay(new Date(customDate + 'T00:00:00'));
      return t >= from && t < from + DAY;
    }
    default: return true;
  }
}

/* بحث نصي في أكتر من حقل — بيتعامل مع { ar, en } والأرقام */
export function matchesText(item, fields, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const parts = [];
  const push = (v) => {
    if (v == null) return;
    if (typeof v === 'object') { parts.push(v.ar || '', v.en || ''); return; }
    parts.push(String(v));
  };
  fields.forEach(f => {
    const v = typeof f === 'function' ? f(item) : f.split('.').reduce((o, k) => (o == null ? o : o[k]), item);
    if (Array.isArray(v)) v.forEach(push); else push(v);
  });
  return parts.join(' ').toLowerCase().includes(q);
}

/* selects: [{ id, label, options:[{value,label}] }] */
export function filterBarHtml({ id, placeholder = 'بحث...', date = false, selects = [] } = {}) {
  return `
    <div class="ex-eg-filterbar" data-filterbar="${esc(id)}">
      <div class="ex-eg-fb-search">
        ${ICONS.search}
        <input type="search" data-f="q" placeholder="${esc(placeholder)}" autocomplete="off">
        <button type="button" class="ex-eg-fb-clear" data-f="clear" hidden>${ICONS.close}</button>
      </div>
      ${date ? `
        <select data-f="date" class="ex-eg-fb-select">
          ${DATE_PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
        </select>
        <input type="date" data-f="day" class="ex-eg-fb-date" hidden>
      ` : ''}
      ${selects.map(s => `
        <select data-f="sel:${esc(s.id)}" class="ex-eg-fb-select" aria-label="${esc(s.label)}">
          ${s.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}
        </select>
      `).join('')}
      <span class="ex-eg-fb-count" data-f="count"></span>
    </div>`;
}

/* بيرجّع دالة بتقرا القيم الحالية، وبينادي onChange مع أي تعديل */
export function wireFilterBar(root, id, onChange) {
  const bar = root.querySelector(`[data-filterbar="${id}"]`);
  if (!bar) return () => ({ q: '', date: 'all', day: '', sel: {} });

  const qEl = bar.querySelector('[data-f="q"]');
  const clearEl = bar.querySelector('[data-f="clear"]');
  const dateEl = bar.querySelector('[data-f="date"]');
  const dayEl = bar.querySelector('[data-f="day"]');

  const read = () => {
    const sel = {};
    bar.querySelectorAll('[data-f^="sel:"]').forEach(s => { sel[s.dataset.f.slice(4)] = s.value; });
    return {
      q: qEl ? qEl.value.trim() : '',
      date: dateEl ? dateEl.value : 'all',
      day: dayEl ? dayEl.value : '',
      sel,
    };
  };

  const fire = () => { if (clearEl) clearEl.hidden = !(qEl && qEl.value); if (onChange) onChange(read()); };

  if (qEl) qEl.addEventListener('input', fire);
  if (clearEl) clearEl.addEventListener('click', () => { qEl.value = ''; fire(); qEl.focus(); });
  if (dateEl) dateEl.addEventListener('change', () => {
    if (dayEl) { dayEl.hidden = dateEl.value !== 'custom'; if (dateEl.value !== 'custom') dayEl.value = ''; }
    fire();
  });
  if (dayEl) dayEl.addEventListener('change', fire);
  bar.querySelectorAll('[data-f^="sel:"]').forEach(s => s.addEventListener('change', fire));

  return read;
}

/* عدّاد النتائج جنب الفلاتر */
export function setFilterCount(root, id, shown, total) {
  const el = root.querySelector(`[data-filterbar="${id}"] [data-f="count"]`);
  if (!el) return;
  el.textContent = shown === total ? `${total}` : `${shown} من ${total}`;
}
