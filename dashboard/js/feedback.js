import { db, ref, onValue } from '../../js/firebase-config.js';
import { esc } from '../../js/escape.js';
import { filterBarHtml, wireFilterBar, inDateRange, matchesText, setFilterCount } from './filters.js';

function fmtDate(ts) { if (!ts) return '-'; return new Date(ts).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); }

export function renderFeedback(container) {
  container.innerHTML = `
    ${filterBarHtml({
      id: 'feedback',
      placeholder: 'ابحث في الآراء والملاحظات وأرقام التليفون...',
      date: true,
      selects: [{ id: 'rate', label: 'التقييم', options: [
        { value: 'all', label: 'كل التقييمات' },
        { value: 'high', label: 'راضي (4 و 5 نجوم)' },
        { value: 'mid', label: 'متوسط (3 نجوم)' },
        { value: 'low', label: 'غير راضي (1 و 2)' },
      ] }],
    })}
    <div id="fb-list"><div class="ex-eg-empty-d">جاري التحميل...</div></div>`;

  let all = [];
  let flt = { q: '', date: 'all', day: '', sel: {} };
  const readFilters = wireFilterBar(container, 'feedback', (v) => { flt = v; paint(); });
  flt = readFilters();

  /* أعلى تقييم في الرأي — بنفلتر بيه */
  function topRating(f) {
    const nums = (f.answers || []).map(a => a && a.answer).filter(v => typeof v === 'number');
    return nums.length ? Math.max(...nums) : null;
  }

  function paint() {
    const list = container.querySelector('#fb-list');
    if (!list) return;
    let items = all;
    if (flt.date && flt.date !== 'all') items = items.filter(f => inDateRange(f.date, flt.date, flt.day));
    if (flt.sel && flt.sel.rate && flt.sel.rate !== 'all') items = items.filter(f => {
      const r = topRating(f);
      if (r == null) return false;
      return flt.sel.rate === 'high' ? r >= 4 : flt.sel.rate === 'mid' ? r === 3 : r <= 2;
    });
    if (flt.q) items = items.filter(f => matchesText(f, [
      (x) => (x.answers || []).map(a => a && a.question),
      (x) => (x.answers || []).map(a => (a && typeof a.answer === 'string') ? a.answer : ''),
    ], flt.q));
    setFilterCount(container, 'feedback', items.length, all.length);
    if (!items.length) { list.innerHTML = `<div class="ex-eg-empty-d">${all.length ? 'مفيش آراء مطابقة للفلاتر' : 'لسه مفيش آراء عملاء'}</div>`; return; }
    list.innerHTML = items.map(f => `
      <div class="ex-eg-card" style="margin-bottom:12px;">
        <div style="color:var(--muted);font-size:11.5px;margin-bottom:8px;">${fmtDate(f.date)}</div>
        ${(f.answers || []).map(a => `
          <div style="margin-bottom:6px;">
            <div style="font-size:12.5px;font-weight:700;">${esc(a.question)}</div>
            <div style="font-size:13px;color:${a.answer == null ? 'var(--muted)' : 'var(--text)'};">
              ${typeof a.answer === 'number' ? '⭐'.repeat(Math.max(0, Math.min(5, Math.round(a.answer)))) : (esc(a.answer) || 'بدون إجابة')}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  onValue(ref(db, 'feedback'), (snap) => {
    all = [];
    snap.forEach(child => { all.push({ id: child.key, ...child.val() }); });
    all.sort((a, b) => (b.date || 0) - (a.date || 0));
    paint();
  }, () => {
    const list = container.querySelector('#fb-list');
    if (list) list.innerHTML = `<div class="ex-eg-empty-d">مفيش صلاحية لقراءة آراء العملاء</div>`;
  });
}
