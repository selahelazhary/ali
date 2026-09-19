import { ICONS } from '../../js/icons.js';
import { db, ref, get, onValue, update } from '../../js/firebase-config.js';
import { notifyTelegramStatus, notifyCustomerTelegram } from '../../js/telegram.js';
import { toast } from './app.js';
import { esc, escName, escNum, safeUrl, safeTel } from '../../js/escape.js';
import { filterBarHtml, wireFilterBar, inDateRange, matchesText, setFilterCount } from './filters.js';

/* أسماء المنتجات جوه الطلب بيبعتها العميل، فبنهرّبها قبل العرض */
function tName(obj) { return escName(obj); }
function statusLabel(s) { return { new: 'جديد', preparing: 'قيد التجهيز', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' }[s] || esc(s) || '-'; }
function fmtDate(ts) { if (!ts) return '-'; return new Date(ts).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' }); }
const PAY = { cod: { l: 'عند الاستلام', i: ICONS.cash }, vodafoneCash: { l: 'فودافون كاش', i: ICONS.vodafoneCash }, etisalatCash: { l: 'اتصالات كاش', i: ICONS.etisalatCash }, instapay: { l: 'إنستاباي', i: ICONS.instapay } };
const STATUS_FLOW = ['new', 'preparing', 'ready', 'completed'];

let audioCtx = null;
function ping() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(audioCtx.currentTime + 0.18);
  } catch (e) { /* no audio */ }
}

export function renderOrders(container, { profile } = {}) {
  /* أدمن مربوط بفرع محدد: بيشوف طلبات فرعه بس، وفلتر الفرع بيتقفل عليه */
  const myBranch = profile && profile.role !== 'owner' && profile.branchId ? String(profile.branchId) : '';
  const inScope = (o) => !myBranch || o.branchId === myBranch;
  let filterStatus = 'all', filterType = 'all', allOrders = (Array.isArray(window.__dashboardOrders) ? window.__dashboardOrders.slice() : []).filter(inScope), knownIds = null;

  container.innerHTML = `
    <div class="ex-eg-tabs-row" id="status-tabs">
      ${['all', 'new', 'preparing', 'ready', 'completed', 'cancelled'].map(s => `<button class="ex-eg-tab-pill ${s === 'all' ? 'ex-eg-active' : ''}" data-status="${s}">${s === 'all' ? 'الكل' : statusLabel(s)}</button>`).join('')}
    </div>
    <div class="ex-eg-tabs-row" id="type-tabs">
      <button class="ex-eg-tab-pill ex-eg-active" data-type="all">كل الأنواع</button>
      <button class="ex-eg-tab-pill" data-type="pickup">${ICONS.bag} استلام</button>
      <button class="ex-eg-tab-pill" data-type="delivery">${ICONS.bike} توصيل</button>
    </div>
    ${filterBarHtml({
      id: 'orders',
      placeholder: 'ابحث برقم الطلب أو اسم العميل أو التليفون أو المنتج...',
      date: true,
      selects: [
        { id: 'branch', label: 'الفرع', options: [{ value: 'all', label: 'كل الفروع' }] },
        { id: 'pay', label: 'طريقة الدفع', options: [
          { value: 'all', label: 'كل طرق الدفع' },
          { value: 'cod', label: 'عند الاستلام' },
          { value: 'vodafoneCash', label: 'فودافون كاش' },
          { value: 'etisalatCash', label: 'اتصالات كاش' },
          { value: 'instapay', label: 'إنستاباي' },
        ] },
      ],
    })}
    <div id="orders-list"></div>
  `;
  let f = { q: '', date: 'all', day: '', sel: {} };
  const readFilters = wireFilterBar(container, 'orders', (v) => { f = v; renderList(); });
  f = readFilters();

  /* فلتر الفرع — الطلب بيتسجّل فيه branchId + branchName وقت الطلب؛
     القايمة بتتملى من عقدة الفروع (والفرع اللي اتمسح بيفضل يتفلتر بالاسم) */
  let branchNames = {};
  onValue(ref(db, 'branches'), (snap) => {
    const sel = container.querySelector('[data-f="sel:branch"]');
    if (!sel) return;
    const cur = sel.value;
    branchNames = {};
    const opts = [{ value: 'all', label: 'كل الفروع' }];
    snap.forEach((c) => {
      const b = c.val() || {};
      const nm = (b.name && (b.name.ar || b.name.en)) || c.key;
      branchNames[c.key] = nm;
      opts.push({ value: c.key, label: nm });
    });
    opts.push({ value: '__none', label: 'بدون فرع' });
    sel.innerHTML = opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (myBranch) {
      // الأدمن ده مربوط بفرع — الفلتر ثابت على فرعه
      if (!opts.some(o => o.value === myBranch)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(myBranch)}">فرعي</option>`);
      sel.value = myBranch; sel.disabled = true;
    } else {
      sel.value = opts.some(o => o.value === cur) ? cur : 'all';
    }
  });
  container.querySelectorAll('#status-tabs .ex-eg-tab-pill').forEach(btn => btn.addEventListener('click', () => {
    filterStatus = btn.dataset.status;
    container.querySelectorAll('#status-tabs .ex-eg-tab-pill').forEach(b => b.classList.toggle('ex-eg-active', b === btn));
    renderList();
  }));
  container.querySelectorAll('#type-tabs .ex-eg-tab-pill').forEach(btn => btn.addEventListener('click', () => {
    filterType = btn.dataset.type;
    container.querySelectorAll('#type-tabs .ex-eg-tab-pill').forEach(b => b.classList.toggle('ex-eg-active', b === btn));
    renderList();
  }));

  function consumeOrders(snap) {
    /* اللقطة الجاية من القاعدة هي المرجع — الدمج القديم كان بيخلّي الطلبات
       المحذوفة تفضل ظاهرة في اللوحة (طلبات وهمية). */
    const fresh = [];
    snap.forEach(child => { fresh.push({ id: child.key, ...child.val() }); });
    allOrders = fresh.filter(inScope);
    allOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const ids = new Set(allOrders.map(o => o.id));
    if (knownIds) { const fresh = allOrders.filter(o => !knownIds.has(o.id) && o.status === 'new'); if (fresh.length) { ping(); toast(`طلب جديد #${fresh[0].id.slice(-6).toUpperCase()}`, 'success'); } }
    knownIds = ids;
    renderList();
  }

  const consumeSharedOrders = (event) => {
    if (!container.isConnected || !Array.isArray(event.detail)) return;
    allOrders = event.detail.filter(inScope);
    allOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderList();
  };
  window.addEventListener('dashboard-orders-updated', consumeSharedOrders);

  const showReadError = () => {
    const list = container.querySelector('#orders-list');
    if (list) list.innerHTML = `<div class="ex-eg-empty-d">مفيش صلاحية قراءة الطلبات</div>`;
  };
  onValue(ref(db, 'orders'), consumeOrders, showReadError);
  // Force a fresh read when opening the section so a stale local cache cannot hide new orders.
  get(ref(db, 'orders')).then(consumeOrders).catch(showReadError);

  function typeOf(o) { return o.deliveryMethod === 'delivery' ? 'delivery' : 'pickup'; }

  function renderList() {
    const listEl = container.querySelector('#orders-list');
    if (!listEl) return;
    let orders = allOrders;
    if (filterStatus !== 'all') orders = orders.filter(o => (o.status || 'new') === filterStatus);
    if (filterType !== 'all') orders = orders.filter(o => typeOf(o) === filterType);
    // البحث + اليوم + طريقة الدفع
    if (f.sel && f.sel.pay && f.sel.pay !== 'all') orders = orders.filter(o => (o.paymentMethod || '') === f.sel.pay);
    if (myBranch) orders = orders.filter(inScope);
    else if (f.sel && f.sel.branch && f.sel.branch !== 'all') {
      const want = f.sel.branch;
      orders = orders.filter(o => (want === '__none'
        ? !o.branchId && !o.branchName
        : (o.branchId === want || (!o.branchId && o.branchName && o.branchName === branchNames[want]))));
    }
    if (f.date && f.date !== 'all') orders = orders.filter(o => inDateRange(o.createdAt, f.date, f.day));
    if (f.q) orders = orders.filter(o => matchesText(o, [
      'customerName', 'customerPhone', 'address', 'notes', 'paymentRef',
      'governorateName', 'branchName',
      (x) => (x.id || '').slice(-6).toUpperCase(),
      (x) => (x.items || []).map(i => (i.name && (i.name.ar || i.name.en)) || i.name || ''),
    ], f.q));
    setFilterCount(container, 'orders', orders.length, allOrders.length);
    if (!orders.length) { listEl.innerHTML = `<div class="ex-eg-empty-d">مفيش طلبات مطابقة للفلاتر</div>`; return; }

    listEl.innerHTML = orders.map(o => {
      const type = typeOf(o);
      const pay = PAY[o.paymentMethod] || { l: esc(o.paymentMethod) || '-', i: '' };
      const cur = esc(o.currencyCode);
      // صورة التحويل لازم تكون صورة فعلاً — مش لينك javascript:
      // الطلبات القديمة لسه فيها الصورة جوّاها؛ الجديدة بتتحمّل عند الطلب
      const proof = o.paymentProof ? safeUrl(o.paymentProof) : '';
      const statusClass = /^(new|preparing|ready|completed|cancelled)$/.test(o.status || '') ? o.status : 'new';
      return `
      <div class="ex-eg-card ex-eg-order-card ${o.status === 'new' ? 'ex-eg-is-new' : ''}">
        <div class="ex-eg-order-head">
          <div>
            <div class="ex-eg-order-id">#${esc(o.id.slice(-6).toUpperCase())} <span class="ex-eg-badge-status ${statusClass}">${statusLabel(o.status)}</span></div>
            <div class="ex-eg-hint" style="margin-top:4px">
              ${type === 'delivery' ? `${ICONS.bike} توصيل — ${esc(o.governorateName)}` : `${ICONS.bag} استلام`}
              ${o.branchName ? ` • ${esc(o.branchName)}` : ''} • ${fmtDate(o.createdAt)}
            </div>
            <div class="ex-eg-hint">👤 <b>${esc(o.customerName) || '-'}</b> — <a href="tel:${safeTel(o.customerPhone)}" dir="ltr">${esc(o.customerPhone) || '-'}</a></div>
            ${o.address ? `<div class="ex-eg-hint">📍 ${esc(o.address)}</div>` : ''}
            ${o.notes ? `<div class="ex-eg-hint">📝 ${esc(o.notes)}</div>` : ''}
          </div>
          <div class="ex-eg-pay-tag"><span class="ex-eg-pay-logo-sm">${pay.i}</span><span>${pay.l}${o.paymentRef ? `<br><small dir="ltr">${esc(o.paymentRef)}</small>` : ''}</span></div>
        </div>
        ${proof
          ? `<a class="ex-eg-proof-view" href="${proof}" target="_blank" rel="noopener noreferrer" title="افتح صورة التحويل"><img src="${proof}" alt="سكرين التحويل"><span>${ICONS.images} سكرين التحويل — اضغط للتكبير</span></a>`
          : (o.hasProof ? `<div class="ex-eg-proof-slot" data-proof="${esc(o.id)}"><button type="button" class="ex-eg-btn ex-eg-sm ex-eg-ghost">${ICONS.images} اعرض سكرين التحويل</button></div>` : '')}
        <div class="ex-eg-table-wrap" style="margin-top:10px"><table><tbody>
          ${(o.items || []).map(i => `<tr><td>${tName(i.name)}${i.variantName ? ` <span class="ex-eg-hint">(${tName(i.variantName)})</span>` : ''}</td><td>× ${escNum(i.qty)}</td><td>${cur} ${escNum(i.price) * escNum(i.qty)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="ex-eg-order-foot">
          <div><b>الإجمالي: ${cur} ${escNum(o.total)}</b>${o.deliveryFee ? `<span class="ex-eg-hint"> (منها توصيل ${escNum(o.deliveryFee)})</span>` : ''}</div>
          <div class="ex-eg-order-actions">${statusActions(o)}</div>
        </div>
      </div>`;
    }).join('');

    /* الصورة بتتحمّل لما تطلبها بس — عشان قايمة الطلبات تفضل خفيفة */
    listEl.querySelectorAll('[data-proof]').forEach(slot => {
      const btn = slot.querySelector('button');
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'جاري التحميل...';
        try {
          const snap = await get(ref(db, `orderProofs/${slot.dataset.proof}`));
          const url = snap.exists() ? safeUrl(snap.val()) : '';
          if (!url) throw new Error('مش موجودة');
          slot.outerHTML = `<a class="ex-eg-proof-view" href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="سكرين التحويل"><span>${ICONS.images} سكرين التحويل — اضغط للتكبير</span></a>`;
        } catch (e) {
          btn.disabled = false; btn.textContent = 'تعذر تحميل الصورة — جرب تاني';
        }
      });
    });

    listEl.querySelectorAll('[data-set-status]').forEach(btn => btn.addEventListener('click', async () => {
      const status = btn.dataset.setStatus, id = btn.dataset.id;
      const o = allOrders.find(x => x.id === id);
      try {
        await update(ref(db, `orders/${id}`), { status, [`statusHistory/${status}`]: Date.now() });
        toast(`الطلب بقى: ${statusLabel(status)} — العميل هيتبلغ تلقائياً`, 'success');
        notifyTelegramStatus(id, status, o);
        notifyCustomerTelegram(o, id, status).catch(() => {});
      } catch (e) { toast('حصل خطأ: ' + e.message, 'error'); }
    }));
  }

  function statusActions(o) {
    if (o.status === 'cancelled' || o.status === 'completed') {
      return `<button class="ex-eg-btn ex-eg-sm ex-eg-ghost" data-set-status="new" data-id="${esc(o.id)}">${ICONS.check} إعادة فتح</button>`;
    }
    const idx = STATUS_FLOW.indexOf(o.status || 'new');
    const next = STATUS_FLOW[idx + 1];
    let html = '';
    if (next) html += `<button class="ex-eg-btn ex-eg-sm" data-set-status="${next}" data-id="${esc(o.id)}">${next === 'preparing' ? ICONS.bell : ICONS.check} ${next === 'preparing' ? 'ابدأ التحضير + إشعار العميل' : statusLabel(next)}</button>`;
    html += `<button class="ex-eg-btn ex-eg-sm ex-eg-danger" data-set-status="cancelled" data-id="${esc(o.id)}">${ICONS.close} إلغاء</button>`;
    return html;
  }
}
