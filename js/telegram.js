/* Telegram relay — only ever runs from an authenticated dashboard session (or from
   Cloud Functions when server relay is on), so the bot token is never readable by customers. */
import { db, ref, get, update } from './firebase-config.js';

function tName(obj) { if (!obj) return ''; if (typeof obj === 'string') return obj; return obj.ar || obj.en || ''; }

const PAY_LABELS = { cod: 'الدفع عند الاستلام', vodafoneCash: 'فودافون كاش', etisalatCash: 'اتصالات كاش', instapay: 'إنستاباي' };

/* بيانات البوت.
   لكل فرع ممكن يبقى ليه شات (وحتى بوت) لوحده، فطلبات الفرع توصل لمسؤوله هو بس.
   الإعداد بيتخزّن في settings/telegram/branches/{branchId} — مش في عقدة branches
   لأن دي **مقروءة للجميع** والتوكن سر.
   لو الفرع مش متظبّط بنرجع للبوت العام، فمفيش طلب بيضيع. */
async function creds(branchId) {
  const snap = await get(ref(db, 'settings/telegram'));
  if (!snap.exists()) return null;
  const cfg = snap.val() || {};
  const main = cfg.botToken && cfg.chatId ? { botToken: cfg.botToken, chatId: cfg.chatId, scope: 'main' } : null;

  if (branchId) {
    const b = (cfg.branches || {})[branchId];
    if (b && b.chatId) {
      const token = b.botToken || cfg.botToken;
      if (token) return { botToken: token, chatId: b.chatId, scope: 'branch' };
    }
  }
  return main;
}

async function serverRelayOn() {
  try { const s = await get(ref(db, 'settings/features/serverRelay')); return s.exists() && s.val() === true; } catch (e) { return false; }
}

async function send(text, extra, branchId) {
  const c = await creds(branchId);
  if (!c) return false;
  const res = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ chat_id: c.chatId, text, parse_mode: 'Markdown' }, extra || {})),
  });
  return res.ok;
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const type = (head.match(/data:([^;]+)/) || [, 'image/jpeg'])[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/* سكرين التحويل بيتبعت كصورة مع تفاصيل الطلب في نفس الرسالة */
async function sendPhoto(dataUrl, caption, extra, branchId) {
  const c = await creds(branchId);
  if (!c) return false;
  const form = new FormData();
  form.append('chat_id', c.chatId);
  form.append('caption', caption.slice(0, 1000));
  form.append('parse_mode', 'Markdown');
  form.append('photo', dataUrlToBlob(dataUrl), 'transfer.jpg');
  if (extra && extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
  const res = await fetch(`https://api.telegram.org/bot${c.botToken}/sendPhoto`, { method: 'POST', body: form });
  return res.ok;
}

/* أزرار القبول/الرفض — البوت بيرد عليها عن طريق الـ worker المحلي */
function decisionKeyboard(orderId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ قبول الطلب', callback_data: `ok:${orderId}` },
          { text: '❌ رفض الطلب', callback_data: `no:${orderId}` },
        ],
        /* متابعة الحالة من نفس الرسالة من غير ما تفتح اللوحة */
        [
          { text: '👨‍🍳 جاري التحضير', callback_data: `st:preparing:${orderId}` },
          { text: '🥩 جاهز', callback_data: `st:ready:${orderId}` },
        ],
        [
          { text: '📦 تم التسليم', callback_data: `st:completed:${orderId}` },
        ],
      ],
    },
  };
}

function formatOrderMessage(order, orderId) {
  const L = [];
  L.push(`🥩 *طلب جديد #${(orderId || '').slice(-6).toUpperCase()}*`);
  if (order.orderType === 'inside') {
    L.push(`🍽 داخل المحل — طاولة ${order.tableNumber || '-'}${order.branchName ? ` (${order.branchName})` : ''}`);
  } else if (order.deliveryMethod === 'delivery') {
    L.push(`🛵 توصيل — ${order.governorateName || ''}`);
    if (order.address) L.push(`📍 ${order.address}`);
  } else {
    L.push(`🛍 استلام من الفرع${order.branchName ? ` — ${order.branchName}` : ''}`);
  }
  L.push(`👤 ${order.customerName} — ${order.customerPhone}`);
  L.push(`💳 ${PAY_LABELS[order.paymentMethod] || order.paymentMethod || '-'}${order.paymentRef ? ` — ref: ${order.paymentRef}` : ''}`);
  if (order.hasProof || order.paymentProof) L.push('🧾 سكرين التحويل مرفق');
  L.push('');
  (order.items || []).forEach(i => {
    const variant = i.variantName ? ` (${tName(i.variantName)})` : '';
    L.push(`• ${tName(i.name)}${variant} × ${i.qty} — ${order.currencyCode} ${i.price * i.qty}`);
  });
  L.push('');
  if (order.deliveryFee) L.push(`🚚 رسوم التوصيل: ${order.currencyCode} ${order.deliveryFee}`);
  L.push(`💰 *الإجمالي: ${order.currencyCode} ${order.total}*`);
  if (order.notes) L.push(`📝 ${order.notes}`);
  return L.join('\n');
}

/* صورة التحويل اتنقلت لعقدة orderProofs — بنجيبها من هناك وقت الإرسال */
async function loadOrderProof(order, orderId) {
  if (order && typeof order.paymentProof === 'string' && order.paymentProof.startsWith('data:')) return order.paymentProof;
  if (!order || !order.hasProof || !orderId) return null;
  try {
    const snap = await get(ref(db, `orderProofs/${orderId}`));
    const v = snap.exists() ? snap.val() : null;
    return typeof v === 'string' && v.startsWith('data:') ? v : null;
  } catch (e) { return null; }
}

export async function notifyTelegram(order, orderId) {
  try {
    if (await serverRelayOn()) return;
    /* وركر بايثون هو نظام الإشعارات. لما يكون شغال بيبعت هو، فاللوحة
       مابتبعتش عشان الطلب مايوصلش مرتين. */
    if (await workerAlive()) return;
    const text = formatOrderMessage(order, orderId);
    const kb = decisionKeyboard(orderId);
    const branchId = order && order.branchId ? String(order.branchId) : '';
    const proof = await loadOrderProof(order, orderId);
    if (proof) {
      const ok = await sendPhoto(proof, text, kb, branchId);
      if (ok) return;
    }
    await send(text, kb, branchId);
  } catch (e) { /* best effort */ }
}

export async function notifyTelegramStatus(orderId, status, order) {
  const labels = { preparing: '👨‍🍳 بدأ تحضير الطلب', ready: '✅ الطلب جاهز', completed: '📦 تم تسليم الطلب', cancelled: '❌ تم إلغاء الطلب' };
  try {
    if (!labels[status] || await serverRelayOn()) return;
    if (await workerAlive()) return;   // الوركر بيتولّى الإشعار
    await send(`${labels[status]} — #${(orderId || '').slice(-6).toUpperCase()}${order && order.customerName ? ` (${order.customerName})` : ''}`,
      null, order && order.branchId ? String(order.branchId) : '');
  } catch (e) { /* best effort */ }
}

/* ---------------- إشعارات العملاء على تليجرام ----------------
   العميل بيربط تليجرامه بالبوت مرة واحدة، وبعد كده كل تحديث لطلبه وكل
   منتج جديد أو خصم بيوصله كرسالة من البوت — من غير إذن إشعارات ولا تطبيق. */
const CUSTOMER_STATUS = {
  preparing: { ar: '👨‍🍳 بدأنا نجهّز طلبك', en: '👨‍🍳 We started preparing your order' },
  ready: { ar: '✅ طلبك جاهز', en: '✅ Your order is ready' },
  completed: { ar: '📦 تم تسليم طلبك — بالهنا والشفا 🧡', en: '📦 Your order was delivered — enjoy!' },
  cancelled: { ar: '❌ تم إلغاء طلبك', en: '❌ Your order was cancelled' },
};

async function chatIdOfSubscriber(subscriberId) {
  if (!subscriberId) return null;
  try {
    const s = await get(ref(db, `subscribers/${subscriberId}/telegramChatId`));
    return s.exists() ? s.val() : null;
  } catch (e) { return null; }
}

export async function notifyCustomerTelegram(order, orderId, status) {
  const label = CUSTOMER_STATUS[status];
  if (!label) return false;
  const chatId = await chatIdOfSubscriber(order && order.subscriberId);
  if (!chatId) return false;
  const lang = (order && order.lang) === 'en' ? 'en' : 'ar';
  const text = `${label[lang]}\n${lang === 'ar' ? 'طلب رقم' : 'Order'} #${(orderId || '').slice(-6).toUpperCase()}`;
  const r = await tgCall('sendMessage', { chat_id: chatId, text });
  return !!(r && r.ok);
}

/* إرسال إشعار جماعي (منتج جديد / خصم) لكل اللي ربطوا تليجرام */
export async function broadcastTelegram({ title, body = '' }) {
  let subs = null;
  try { const s = await get(ref(db, 'subscribers')); subs = s.exists() ? s.val() : null; } catch (e) { return 0; }
  if (!subs) return 0;
  const chats = Object.values(subs).map(s => s && s.telegramChatId).filter(Boolean);
  let sent = 0;
  for (const chat of chats) {
    const r = await tgCall('sendMessage', { chat_id: chat, text: `🥩 *${title}*\n${body}`, parse_mode: 'Markdown' });
    if (r && r.ok) sent++;
  }
  return sent;
}

/* بيانات البوت (اسمه ويوزره) — بتتستخدم في شاشة الإعداد وفي لينك ربط العملاء */
export async function getBotInfo(botToken) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'التوكن مش صحيح');
  return j.result;
}

/* بيقرا آخر الرسائل اللي وصلت للبوت ويرجّع chat id بتاع آخر واحد كلّمه —
   ده بيغني المدير عن فتح getUpdates بنفسه ونسخ الرقم. */
export async function detectAdminChatId(botToken) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=-20`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'تعذر قراءة رسائل البوت');
  const msgs = (j.result || []).map(u => u.message || u.channel_post || (u.my_chat_member || {}).chat && { chat: u.my_chat_member.chat }).filter(Boolean);
  const last = msgs[msgs.length - 1];
  if (!last || !last.chat) throw new Error('مفيش رسائل للبوت لسه — افتح البوت واضغط Start وابعتله أي رسالة');
  return { chatId: String(last.chat.id), title: last.chat.title || last.chat.first_name || last.chat.username || '' };
}

/* ---------------- قبول/رفض الطلب من أزرار البوت ----------------
   الوركر البايثون بيعمل ده لوحده. لو مش شغال، لوحة التحكم المفتوحة بتتولى
   المهمة بنفسها — فالأزرار بتشتغل في كل الحالات. */
const TG_OFFSET_KEY = 'ex_eg_tg_offset';

async function tgCall(method, payload) {
  const c = await creds();
  if (!c) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${c.botToken}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
    });
    return r.ok ? r.json() : null;
  } catch (e) { return null; }
}

async function workerAlive() {
  try {
    const s = await get(ref(db, 'settings/features/workerHeartbeat'));
    return s.exists() && Date.now() - Number(s.val()) < 90000;
  } catch (e) { return false; }
}

async function clearButtons(msg, label) {
  if (!msg) return;
  await tgCall('editMessageReplyMarkup', {
    chat_id: msg.chat && msg.chat.id, message_id: msg.message_id,
    reply_markup: { inline_keyboard: [[{ text: label, callback_data: 'done' }]] },
  });
}

/* بيحدّث نص الرسالة ويسيب الأزرار مكانها عشان المتابعة تكمل */
async function stampMessage(message, note, keyboard) {
  if (!message) return;
  const isPhoto = !!message.photo;
  const SEP = '\n———\n';
  const base = (isPhoto ? (message.caption || '') : (message.text || '')).split(SEP)[0];
  const body = base + SEP + note;
  const payload = Object.assign(
    { chat_id: message.chat.id, message_id: message.message_id },
    isPhoto ? { caption: body } : { text: body },
    keyboard || {},
  );
  await tgCall(isPhoto ? 'editMessageCaption' : 'editMessageText', payload);
}

export async function pollTelegramDecisions() {
  if (await serverRelayOn()) return 0;
  if (await workerAlive()) return 0;
  let offset = Number(localStorage.getItem(TG_OFFSET_KEY) || 0);
  if (!offset) {
    const drain = await tgCall('getUpdates', { offset: -1, timeout: 0 });
    const last = drain && drain.ok && drain.result.length ? drain.result[drain.result.length - 1] : null;
    offset = last ? last.update_id + 1 : 1;
    localStorage.setItem(TG_OFFSET_KEY, String(offset));
    return 0;
  }
  const res = await tgCall('getUpdates', { offset, timeout: 0, allowed_updates: ['callback_query', 'message'] });
  if (!res || !res.ok) return 0;
  let handled = 0;
  for (const upd of res.result || []) {
    localStorage.setItem(TG_OFFSET_KEY, String(upd.update_id + 1));

    /* /start <subscriberId> — العميل بيربط تليجرامه عشان توصله إشعارات طلباته */
    if (upd.message && typeof upd.message.text === 'string' && upd.message.text.startsWith('/start')) {
      const payload = upd.message.text.split(' ')[1];
      const chatId = upd.message.chat.id;
      if (payload) {
        try {
          await update(ref(db, `subscribers/${payload}`), { telegramChatId: chatId, linked: true, createdAt: Date.now(), lastSeen: Date.now() });
          await tgCall('sendMessage', { chat_id: chatId, text: '🥩 تمام! إشعارات منوعات الرحمان اتفعّلت على تليجرام.\nهنبعتلك كل تحديث لطلبك وكل منتج جديد أو خصم.' });
          handled++;
        } catch (e) { /* الاشتراك مش موجود */ }
      } else {
        await tgCall('sendMessage', { chat_id: chatId, text: `أهلاً بيك في منوعات الرحمان 🥩\nرقم الشات بتاعك: ${chatId}` });
      }
      continue;
    }

    const cq = upd.callback_query;
    if (!cq || !cq.data || !cq.data.includes(':')) { if (cq) await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }
    /* الأشكال: "ok:<id>" / "no:<id>" / "st:<status>:<id>" */
    const parts = cq.data.split(':');
    const action = parts[0];
    const orderId = action === 'st' ? parts.slice(2).join(':') : parts.slice(1).join(':');

    const STATUS_LABEL = {
      preparing: '👨‍🍳 جاري التحضير', ready: '🥩 الطلب جاهز',
      completed: '📦 تم التسليم', cancelled: '❌ تم رفض الطلب',
    };

    let order = null;
    try { const s = await get(ref(db, `orders/${orderId}`)); order = s.exists() ? s.val() : null; } catch (e) { /* no access */ }
    if (!order) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'الطلب مش موجود', show_alert: true }); continue; }

    let status;
    if (action === 'st') {
      status = STATUS_LABEL[parts[1]] ? parts[1] : null;
      if (!status) { await tgCall('answerCallbackQuery', { callback_query_id: cq.id }); continue; }
    } else {
      /* القبول/الرفض للطلبات الجديدة بس — أزرار المتابعة شغالة في أي وقت */
      if ((order.status || 'new') !== 'new') {
        await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'الطلب اتقبل أو اترفض قبل كده', show_alert: true });
        continue;
      }
      status = action === 'ok' ? 'preparing' : 'cancelled';
    }

    if ((order.status || 'new') === status) {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'الطلب بالفعل في الحالة دي' });
      continue;
    }

    try {
      await update(ref(db, `orders/${orderId}`), { status, [`statusHistory/${status}`]: Date.now(), decidedVia: 'telegram' });
    } catch (e) {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'تعذر حفظ الحالة', show_alert: true });
      continue;
    }

    const label = STATUS_LABEL[status] || status;
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: label });
    /* العميل يعرف بالتحديث فوراً */
    notifyCustomerTelegram(order, orderId, status).catch(() => {});
    /* الأزرار تفضل موجودة عشان يكمّل المتابعة — بنحدّث النص بس */
    if (status === 'cancelled' || status === 'completed') await clearButtons(cq.message, label);
    else await stampMessage(cq.message, label, decisionKeyboard(orderId));
    handled++;
  }
  return handled;
}
