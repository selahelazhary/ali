/* وركر الإشعارات على فيرسل — بديل مجاني لـ Cloud Functions.
   ------------------------------------------------------------------
   فيرسل مابيشغّلش برامج مستمرة، فبدل حلقة `while True` بتاعة وركر بايثون
   الدالة دي بتعمل **دورة واحدة** وبتتنادى من كرون خارجي كل دقيقة:

     https://<موقعك>/api/worker?key=<CRON_SECRET>

   بتعمل إيه في الدورة:
     • كل طلب جديد لسه ماتبعتش عنه رسالة ⇒ رسالة تليجرام للمحل (بصورة التحويل)
     • كل طلب حالته اتغيّرت ⇒ سطر للمحل ورسالة تليجرام للعميل لو رابط البوت

   مفيش ملف حالة — الحالة نفسها في قاعدة البيانات:
     `telegramSent` للطلب الجديد، و`notifiedStatus` لآخر حالة اتبلّغ عنها.
   يعني الدالة ممكن تتنادى من أكتر من مكان من غير رسايل مكررة.

   الإعدادات كلها من متغيّرات البيئة في فيرسل (مش في الكود):
     CRON_SECRET     كلمة سر عشوائية — لازم تتبعت مع كل نداء
     WORKER_CONFIG   نفس JSON بتاع وركر بايثون:
                     {"projects":[{"name":"...","databaseUrl":"...",
                       "apiKey":"...","email":"...","password":"..."}]}
                     (مشروع واحد في الجذر برضه مقبول) */

const STATUS_SHOP = {
  preparing: '👨‍🍳 بدأ تحضير الطلب',
  ready: '✅ الطلب جاهز',
  completed: '📦 تم تسليم الطلب',
  cancelled: '❌ تم إلغاء الطلب',
};
const STATUS_CUSTOMER = {
  preparing: 'بدأنا نجهز طلبك 🥩',
  ready: 'طلبك جاهز ✅',
  completed: 'تم تسليم طلبك — بالهنا والشفا 🧡',
  cancelled: 'تم إلغاء طلبك ❌',
};
const PAY_LABELS = {
  cod: 'الدفع عند الاستلام',
  vodafoneCash: 'فودافون كاش',
  etisalatCash: 'اتصالات كاش',
  instapay: 'إنستاباي',
};

const shortId = (id) => String(id || '').slice(-6).toUpperCase();
const tName = (v) => (v && typeof v === 'object' ? (v.ar || v.en || '') : (v || ''));

/* ---------------- قاعدة البيانات عبر REST ---------------- */
class Db {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = String(cfg.databaseUrl).replace(/\/$/, '');
    this.token = null;
  }

  async signIn() {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.cfg.apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password, returnSecureToken: true }),
      },
    );
    if (!r.ok) throw new Error('فشل تسجيل الدخول: ' + (await r.text()).slice(0, 140));
    this.token = (await r.json()).idToken;
  }

  async get(path, query = '') {
    const r = await fetch(`${this.base}/${path}.json?auth=${this.token}${query}`);
    return r.ok ? r.json() : null;
  }

  patch(path, data) {
    return fetch(`${this.base}/${path}.json?auth=${this.token}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
  }
}

/* ---------------- تليجرام ---------------- */
class Telegram {
  constructor(token, chatId) {
    this.token = token;
    this.chatId = chatId;
  }

  async call(method, payload) {
    if (!this.token) return null;
    try {
      const r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return r.ok ? r.json() : null;
    } catch (e) {
      return null;
    }
  }

  send(text, chat = this.chatId) {
    if (!chat) return null;
    return this.call('sendMessage', { chat_id: chat, text, parse_mode: 'Markdown' });
  }

  /* صورة التحويل بتتبعت كصورة والتفاصيل في الكابشن — زي وركر بايثون */
  async sendPhoto(dataUrl, caption) {
    if (!this.token || !this.chatId || !String(dataUrl || '').startsWith('data:')) return false;
    try {
      const [head, b64] = String(dataUrl).split(',');
      const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
      const bytes = Buffer.from(b64, 'base64');
      const form = new FormData();
      form.append('chat_id', String(this.chatId));
      form.append('caption', caption.slice(0, 1000));
      form.append('parse_mode', 'Markdown');
      form.append('photo', new Blob([bytes], { type: mime }), `transfer.${mime.includes('png') ? 'png' : 'jpg'}`);
      const r = await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, { method: 'POST', body: form });
      return r.ok;
    } catch (e) {
      return false;
    }
  }
}

/* ---------------- نص الطلب (نفس صيغة الموقع) ---------------- */
function orderText(order, oid) {
  const L = [`🥩 *طلب جديد #${shortId(oid)}*`];
  if (order.deliveryMethod === 'delivery') {
    L.push(`🛵 توصيل — ${order.governorateName || ''}`);
    if (order.address) L.push(`📍 ${order.address}`);
  } else {
    L.push('🛍 استلام من الفرع' + (order.branchName ? ` — ${order.branchName}` : ''));
  }
  L.push(`👤 ${order.customerName || '-'} — ${order.customerPhone || '-'}`);
  const pay = PAY_LABELS[order.paymentMethod] || order.paymentMethod || '-';
  L.push(`💳 ${pay}` + (order.paymentRef ? ` — ref: ${order.paymentRef}` : ''));
  L.push('');
  for (const it of order.items || []) {
    const variant = it.variantName ? ` (${tName(it.variantName)})` : '';
    L.push(`• ${tName(it.name)}${variant} × ${it.qty} — ${order.currencyCode} ${(it.price || 0) * (it.qty || 0)}`);
  }
  L.push('');
  if (order.deliveryFee) L.push(`🚚 رسوم التوصيل: ${order.currencyCode} ${order.deliveryFee}`);
  L.push(`💰 *الإجمالي: ${order.currencyCode} ${order.total}*`);
  if (order.notes) L.push(`📝 ${order.notes}`);
  return L.join('\n');
}

/* ---------------- دورة واحدة على مشروع واحد ---------------- */
async function runProject(cfg, name) {
  const out = { name, newOrders: 0, statusUpdates: 0 };
  const db = new Db(cfg);
  await db.signIn();

  const tg = await db.get('settings/telegram');
  const bot = new Telegram(tg && tg.botToken, tg && tg.chatId);

  /* آخر ٢٥ طلب بس — الترتيب على createdAt مفهرس في القواعد */
  const orders = (await db.get('orders', '&orderBy=%22createdAt%22&limitToLast=25')) || {};

  for (const [oid, o] of Object.entries(orders)) {
    if (!o || typeof o !== 'object') continue;
    const status = o.status || 'new';

    /* طلب جديد: بنعلّم في القاعدة **قبل** الإرسال عشان نداءين في نفس الوقت
       مايبعتوش رسالتين. */
    if (status === 'new' && !o.telegramSent) {
      await db.patch(`orders/${oid}`, { telegramSent: true, notifiedStatus: 'new' });
      const text = orderText(o, oid);
      let sent = false;
      if (o.hasProof || o.paymentProof) {
        const proof = o.paymentProof || (await db.get(`orderProofs/${oid}`));
        sent = await bot.sendPhoto(proof, text);
      }
      if (!sent) await bot.send(text);
      out.newOrders++;
      continue;
    }

    /* الحالة اتغيّرت عن آخر حاجة بلّغنا عنها */
    const notified = o.notifiedStatus || (o.telegramSent ? 'new' : null);
    if (notified && notified !== status) {
      await db.patch(`orders/${oid}`, { notifiedStatus: status });
      if (STATUS_SHOP[status]) await bot.send(`${STATUS_SHOP[status]} — #${shortId(oid)}`);
      if (STATUS_CUSTOMER[status] && o.subscriberId) {
        const sub = (await db.get(`subscribers/${o.subscriberId}`)) || {};
        if (sub.telegramChatId) {
          await bot.send(`${STATUS_CUSTOMER[status]}\nطلب رقم #${shortId(oid)}`, sub.telegramChatId);
        }
      }
      out.statusUpdates++;
    }
  }

  /* نبضة: اللوحة بتعرف منها إن في وركر شغال فمابتزاحمهوش */
  await db.patch('settings/features', { workerHeartbeat: Date.now() });
  return out;
}

/* ---------------- المشاريع من متغيّرات البيئة ---------------- */
function loadProjects() {
  const raw = process.env.WORKER_CONFIG;
  if (!raw) throw new Error('متغيّر WORKER_CONFIG مش متظبّط في فيرسل');
  const cfg = JSON.parse(raw);
  const list = cfg.projects || [cfg];
  const shared = { ...cfg };
  delete shared.projects;
  return list.map((p, i) => {
    const merged = { ...shared, ...p };
    delete merged.projects;
    return [merged, merged.name || `محل ${i + 1}`];
  }).filter(([c, name]) => {
    const ok = c.databaseUrl && c.apiKey && c.email && c.password;
    if (!ok) console.warn(`[${name}] ناقص بيانات — اتخطّى`);
    return ok;
  });
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || new URL(req.url, 'http://x').searchParams.get('key');
  if (!secret || given !== secret) {
    res.status(401).json({ ok: false, error: 'مفتاح غلط' });
    return;
  }

  const results = [];
  try {
    for (const [cfg, name] of loadProjects()) {
      try {
        results.push(await runProject(cfg, name));
      } catch (e) {
        /* محل وقع؟ الباقي بيكمّل عادي */
        results.push({ name, error: String(e.message || e).slice(0, 200) });
      }
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
    return;
  }

  res.setHeader('cache-control', 'no-store');
  res.status(200).json({ ok: true, at: Date.now(), results });
}
