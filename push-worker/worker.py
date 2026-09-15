"""Daily Bake background worker.

Does everything that would otherwise need a paid backend, from this machine:
  • Web Push to customers (new products, discounts, order status) — standard
    VAPID push straight to the browser's push service, no Firebase Cloud
    Messaging credentials and no Blaze plan.
  • Telegram messages to the shop for every new order and status change.
  • Uploads pending images to Google Drive and swaps in the public link.

Run:  py worker.py      (Ctrl+C to stop)
"""
import base64
import json
import os
import sys
import time
import traceback
from datetime import datetime

import requests
from pywebpush import WebPushException, webpush

# Windows consoles default to cp1252 and would crash on Arabic output
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
STATE = os.path.join(HERE, "state.json")

STATUS_AR = {
    "preparing": "بدأنا نجهز طلبك 🥐",
    "ready": "طلبك جاهز ✅",
    "completed": "تم تسليم طلبك — بالهنا والشفا 🧡",
    "cancelled": "تم إلغاء طلبك ❌",
}
STATUS_SHOP = {
    "preparing": "👨‍🍳 بدأ تحضير الطلب",
    "ready": "✅ الطلب جاهز",
    "completed": "📦 تم تسليم الطلب",
    "cancelled": "❌ تم إلغاء الطلب",
}
PAY_LABELS = {
    "cod": "الدفع عند الاستلام",
    "vodafoneCash": "فودافون كاش",
    "etisalatCash": "اتصالات كاش",
    "instapay": "إنستاباي",
}


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


class Db:
    """Firebase Realtime Database over REST, authenticated as the owner account."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.base = cfg["databaseUrl"].rstrip("/")
        self.id_token = None
        self.refresh_token = None
        self.expires_at = 0
        self.sign_in()

    def sign_in(self):
        r = requests.post(
            f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={self.cfg['apiKey']}",
            json={"email": self.cfg["email"], "password": self.cfg["password"], "returnSecureToken": True},
            timeout=20,
        )
        if r.status_code != 200:
            raise SystemExit("فشل تسجيل الدخول — راجع الإيميل والباسورد في config.json\n" + r.text[:200])
        d = r.json()
        self.id_token = d["idToken"]
        self.refresh_token = d["refreshToken"]
        self.expires_at = time.time() + int(d.get("expiresIn", 3600)) - 120
        log("تم تسجيل الدخول ✓")

    def token(self):
        if time.time() >= self.expires_at:
            r = requests.post(
                f"https://securetoken.googleapis.com/v1/token?key={self.cfg['apiKey']}",
                data={"grant_type": "refresh_token", "refresh_token": self.refresh_token},
                timeout=20,
            )
            if r.status_code == 200:
                d = r.json()
                self.id_token = d["id_token"]
                self.refresh_token = d["refresh_token"]
                self.expires_at = time.time() + int(d.get("expires_in", 3600)) - 120
            else:
                self.sign_in()
        return self.id_token

    def get(self, path):
        r = requests.get(f"{self.base}/{path}.json", params={"auth": self.token()}, timeout=30)
        return r.json() if r.status_code == 200 else None

    def patch(self, path, data):
        return requests.patch(f"{self.base}/{path}.json", params={"auth": self.token()}, json=data, timeout=30)

    def put(self, path, data):
        return requests.put(f"{self.base}/{path}.json", params={"auth": self.token()}, json=data, timeout=30)

    def delete(self, path):
        return requests.delete(f"{self.base}/{path}.json", params={"auth": self.token()}, timeout=30)


class Notifier:
    def __init__(self, cfg, db):
        self.cfg = cfg
        self.db = db
        self.vapid = cfg["vapid"]

    # ---------- Web Push ----------
    def push_to(self, sub_id, subscription, payload):
        try:
            webpush(
                subscription_info=subscription,
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=self.vapid["private"],
                vapid_claims={"sub": self.cfg.get("vapidSubject", "mailto:admin@example.com")},
                timeout=20,
            )
            return True
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                log(f"اشتراك منتهي — اتشال ({sub_id[:8]})")
                self.db.delete(f"subscribers/{sub_id}/webPush")
            else:
                log(f"فشل الإرسال لمشترك {sub_id[:8]}: {code}")
            return False
        except Exception as e:
            log(f"خطأ في الإرسال: {e}")
            return False

    def broadcast(self, payload):
        subs = self.db.get("subscribers") or {}
        sent = 0
        for sub_id, s in subs.items():
            if isinstance(s, dict) and s.get("webPush"):
                if self.push_to(sub_id, s["webPush"], payload):
                    sent += 1
        return sent, len(subs)

    def push_one(self, sub_id, payload):
        s = self.db.get(f"subscribers/{sub_id}")
        if isinstance(s, dict) and s.get("webPush"):
            return self.push_to(sub_id, s["webPush"], payload)
        return False

    # ---------- Telegram ----------
    def tg_creds(self):
        tg = self.db.get("settings/telegram") or {}
        return tg.get("botToken"), tg.get("chatId")

    def tg_call(self, method, payload=None, files=None, data=None):
        token, _ = self.tg_creds()
        if not token:
            return None
        try:
            url = f"https://api.telegram.org/bot{token}/{method}"
            r = requests.post(url, json=payload, files=files, data=data, timeout=30) if (files or data) \
                else requests.post(url, json=payload, timeout=30)
            return r.json() if r.ok else None
        except Exception as e:
            log(f"تليجرام ({method}): {e}")
            return None

    def telegram(self, text, reply_markup=None):
        token, chat = self.tg_creds()
        if not token or not chat:
            return False
        payload = {"chat_id": chat, "text": text, "parse_mode": "Markdown"}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return bool(self.tg_call("sendMessage", payload))

    def telegram_photo(self, data_url, caption, reply_markup=None):
        """سكرين التحويل بيتبعت كصورة والتفاصيل في الكابشن."""
        token, chat = self.tg_creds()
        if not token or not chat or not str(data_url or "").startswith("data:"):
            return False
        try:
            head, b64 = str(data_url).split(",", 1)
            blob = base64.b64decode(b64)
            mime = head.split(":", 1)[1].split(";")[0] if ":" in head else "image/jpeg"
            ext = "png" if "png" in mime else "jpg"
            data = {"chat_id": str(chat), "caption": caption[:1000], "parse_mode": "Markdown"}
            if reply_markup:
                data["reply_markup"] = json.dumps(reply_markup)
            files = {"photo": (f"transfer.{ext}", blob, mime)}
            return bool(self.tg_call("sendPhoto", files=files, data=data))
        except Exception as e:
            log(f"تليجرام (صورة): {e}")
            return False


def order_text(order, oid):
    name = lambda o: (o or {}).get("ar") or (o or {}).get("en") or "" if isinstance(o, dict) else (o or "")
    lines = [f"🥐 *طلب جديد #{oid[-6:].upper()}*"]
    if order.get("orderType") == "inside":
        lines.append(f"🍽 داخل المخبز — طاولة {order.get('tableNumber') or '-'}")
    elif order.get("deliveryMethod") == "delivery":
        lines.append(f"🛵 توصيل — {order.get('governorateName') or ''}")
        if order.get("address"):
            lines.append(f"📍 {order['address']}")
    else:
        lines.append("🛍 استلام من الفرع" + (f" — {order['branchName']}" if order.get("branchName") else ""))
    lines.append(f"👤 {order.get('customerName')} — {order.get('customerPhone')}")
    pay = PAY_LABELS.get(order.get("paymentMethod"), order.get("paymentMethod") or "-")
    lines.append(f"💳 {pay}" + (f" — ref: {order['paymentRef']}" if order.get("paymentRef") else ""))
    lines.append("")
    for it in order.get("items") or []:
        variant = f" ({name(it.get('variantName'))})" if it.get("variantName") else ""
        lines.append(f"• {name(it.get('name'))}{variant} × {it.get('qty')} — {order.get('currencyCode')} {it.get('price', 0) * it.get('qty', 0)}")
    lines.append("")
    if order.get("deliveryFee"):
        lines.append(f"🚚 رسوم التوصيل: {order.get('currencyCode')} {order['deliveryFee']}")
    lines.append(f"💰 *الإجمالي: {order.get('currencyCode')} {order.get('total')}*")
    if order.get("notes"):
        lines.append(f"📝 {order['notes']}")
    return "\n".join(lines)


STATUS_BUTTONS = {
    "preparing": "👨‍🍳 جاري التحضير",
    "ready": "🥐 جاهز",
    "completed": "📦 تم التسليم",
    "cancelled": "❌ تم رفض الطلب",
}


def decision_keyboard(oid):
    """أزرار القبول/الرفض + متابعة حالة الطلب من نفس الرسالة."""
    return {"inline_keyboard": [
        [
            {"text": "✅ قبول الطلب", "callback_data": f"ok:{oid}"},
            {"text": "❌ رفض الطلب", "callback_data": f"no:{oid}"},
        ],
        [
            {"text": "👨‍🍳 جاري التحضير", "callback_data": f"st:preparing:{oid}"},
            {"text": "🥐 جاهز", "callback_data": f"st:ready:{oid}"},
        ],
        [
            {"text": "📦 تم التسليم", "callback_data": f"st:completed:{oid}"},
        ],
    ]}


def handle_telegram_decisions(db, notifier, state):
    """بيقرا ضغطات أزرار البوت ويحوّلها لحالة الطلب في قاعدة البيانات."""
    res = notifier.tg_call("getUpdates", {
        "offset": state.get("tgOffset", 0),
        "timeout": 0,
        "allowed_updates": ["callback_query", "message"],
    })
    if not res or not res.get("ok"):
        return
    for upd in res.get("result") or []:
        state["tgOffset"] = upd["update_id"] + 1

        # /start <subscriberId> — العميل بيربط تليجرامه عشان توصله إشعاراته
        msg = upd.get("message") or {}
        text = msg.get("text") or ""
        if text.startswith("/start"):
            chat_id = msg["chat"]["id"]
            parts = text.split(maxsplit=1)
            if len(parts) > 1 and parts[1].strip():
                sub_id = parts[1].strip()
                db.patch(f"subscribers/{sub_id}", {
                    "telegramChatId": chat_id,
                    "linked": True,
                    "createdAt": int(time.time() * 1000),
                    "lastSeen": int(time.time() * 1000),
                })
                notifier.tg_call("sendMessage", {
                    "chat_id": chat_id,
                    "text": "🥐 تمام! إشعارات Daily Bake اتفعّلت على تليجرام.\nهنبعتلك كل تحديث لطلبك وكل منتج جديد أو خصم.",
                })
                log(f"عميل ربط تليجرام: {sub_id[:8]}")
            else:
                notifier.tg_call("sendMessage", {
                    "chat_id": chat_id,
                    "text": f"أهلاً بيك في Daily Bake 🥐\nرقم الشات بتاعك: {chat_id}",
                })
            continue

        cq = upd.get("callback_query")
        if not cq:
            continue
        data = cq.get("data") or ""
        cid = cq["id"]
        if ":" not in data:
            notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid})
            continue
        # الأشكال: "ok:<id>" / "no:<id>" / "st:<status>:<id>"
        parts = data.split(":")
        action = parts[0]
        oid = ":".join(parts[2:]) if action == "st" else ":".join(parts[1:])

        order = db.get(f"orders/{oid}")
        if not isinstance(order, dict):
            notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid, "text": "الطلب مش موجود", "show_alert": True})
            continue
        current = order.get("status") or "new"

        if action == "st":
            status = parts[1] if parts[1] in STATUS_BUTTONS else None
            if not status:
                notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid})
                continue
        else:
            # القبول والرفض للطلبات الجديدة بس؛ أزرار المتابعة شغالة في أي وقت
            if current != "new":
                notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid, "text": f"الطلب اتقبل أو اترفض قبل كده ({current})", "show_alert": True})
                continue
            status = "preparing" if action == "ok" else "cancelled"

        if current == status:
            notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid, "text": "الطلب بالفعل في الحالة دي"})
            continue

        db.patch(f"orders/{oid}", {"status": status, f"statusHistory/{status}": int(time.time() * 1000), "decidedVia": "telegram"})
        # الحلقة الرئيسية هتبعت إشعار العميل تلقائياً لما تشوف الحالة اتغيرت
        label = STATUS_BUTTONS.get(status, status)
        notifier.tg_call("answerCallbackQuery", {"callback_query_id": cid, "text": label})
        if status in ("completed", "cancelled"):
            _clear_buttons(notifier, cq, label)
        else:
            _stamp(notifier, cq, label, decision_keyboard(oid))
        log(f"من البوت: #{oid[-6:].upper()} → {status}")


def _stamp(notifier, cq, note, keyboard):
    """بيحدّث نص الرسالة ويسيب الأزرار مكانها عشان المتابعة تكمل."""
    msg = cq.get("message") or {}
    if not msg:
        return
    sep = "\n———\n"
    is_photo = bool(msg.get("photo"))
    base = (msg.get("caption") if is_photo else msg.get("text")) or ""
    body = base.split(sep)[0] + sep + note
    payload = {
        "chat_id": msg.get("chat", {}).get("id"),
        "message_id": msg.get("message_id"),
        "reply_markup": keyboard,
    }
    payload["caption" if is_photo else "text"] = body
    notifier.tg_call("editMessageCaption" if is_photo else "editMessageText", payload)


def _clear_buttons(notifier, cq, label):
    msg = cq.get("message") or {}
    if not msg:
        return
    notifier.tg_call("editMessageReplyMarkup", {
        "chat_id": msg.get("chat", {}).get("id"),
        "message_id": msg.get("message_id"),
        "reply_markup": {"inline_keyboard": [[{"text": label, "callback_data": "done"}]]},
    })


def main():
    cfg = load_json(CONFIG, None)
    if not cfg:
        raise SystemExit("مفيش config.json — شغّل الأول:  py setup.py")

    db = Db(cfg)
    notifier = Notifier(cfg, db)
    state = load_json(STATE, {"orders": {}, "broadcasts": [], "started": time.time() * 1000})

    # publish the public key so the site can subscribe browsers to push
    features = db.get("settings/features") or {}
    if features.get("vapidPublicKey") != cfg["vapid"]["public"]:
        db.patch("settings/features", {"vapidPublicKey": cfg["vapid"]["public"], "pythonWorker": True})
        log("اتحط المفتاح العام في إعدادات الموقع ✓")

    # أول تشغيل: تجاهل ضغطات الأزرار القديمة المتراكمة
    if "tgOffset" not in state:
        drain = notifier.tg_call("getUpdates", {"offset": -1, "timeout": 0})
        result = (drain or {}).get("result") or []
        state["tgOffset"] = result[-1]["update_id"] + 1 if result else 0

    log("الوركر شغال — بيراقب الطلبات والإشعارات. (Ctrl+C للإيقاف)")
    last_beat = 0
    drive = None
    if (cfg.get("drive") or {}).get("enabled"):
        try:
            from drive_upload import DriveUploader
            drive = DriveUploader(HERE, cfg["drive"].get("folderName", "Daily Bake Images"))
            log("رفع الصور على Drive مفعّل ✓")
        except Exception as e:
            log(f"Drive متوقف: {e}")

    while True:
        try:
            # نبضة كل 30 ثانية: اللوحة بتعرف منها إن الوركر شغال فمش بتزاحمه على أزرار البوت
            if time.time() - last_beat > 30:
                db.patch("settings/features", {"workerHeartbeat": int(time.time() * 1000)})
                last_beat = time.time()

            # ---- قبول/رفض الطلبات من أزرار البوت ----
            handle_telegram_decisions(db, notifier, state)

            # ---- new orders & status changes ----
            orders = db.get("orders") or {}
            for oid, o in orders.items():
                if not isinstance(o, dict):
                    continue
                prev = state["orders"].get(oid) or {}
                status = o.get("status") or "new"

                # telegramSent في القاعدة هو المرجع الوحيد — مش الحالة المحلية.
                # قبل كده الوركر كان بيعتمد على prev["announced"] بس، فلو اللوحة
                # بعتت الطلب الوركر يبعته تاني والعميل يشوف رسالتين.
                # وبنعلّم **قبل** الإرسال عشان مايحصلش سباق.
                if status == "new" and not o.get("telegramSent") and not prev.get("announced"):
                    db.patch(f"orders/{oid}", {"telegramSent": True})
                    prev["announced"] = True
                    text, kb = order_text(o, oid), decision_keyboard(oid)
                    proof = o.get("paymentProof")
                    if not proof and o.get("hasProof"):
                        proof = db.get(f"orderProofs/{oid}")
                    sent = notifier.telegram_photo(proof, text, kb) if proof else False
                    if not sent:
                        sent = notifier.telegram(text, kb)
                    if sent:
                        log(f"تليجرام: طلب جديد #{oid[-6:].upper()}")
                elif status == "new" and o.get("telegramSent"):
                    prev["announced"] = True

                if prev.get("status") and prev["status"] != status:
                    if status in STATUS_SHOP:
                        notifier.telegram(f"{STATUS_SHOP[status]} — #{oid[-6:].upper()}")
                    if status in STATUS_AR and o.get("subscriberId"):
                        # تليجرام الأول: بيوصل حتى لو المتصفح مقفول والإشعارات مرفوضة
                        sub = db.get(f"subscribers/{o['subscriberId']}") or {}
                        if sub.get("telegramChatId"):
                            notifier.tg_call("sendMessage", {
                                "chat_id": sub["telegramChatId"],
                                "text": f"{STATUS_AR[status]}\nطلب رقم #{oid[-6:].upper()}",
                            })
                        notifier.push_one(o["subscriberId"], {
                            "title": STATUS_AR[status],
                            "body": f"طلب رقم {oid[-6:].upper()}",
                            "url": f"/index.html?track={oid}",
                            "tag": f"order-{oid}",
                        })
                        log(f"إشعار للعميل: {status} #{oid[-6:].upper()}")
                prev["status"] = status
                state["orders"][oid] = prev

            # ---- broadcasts (new product / discount / manual) ----
            broadcasts = db.get("broadcasts") or {}
            for bid, b in broadcasts.items():
                if not isinstance(b, dict) or bid in state["broadcasts"]:
                    continue
                if (b.get("createdAt") or 0) < state["started"] - 3600_000:
                    state["broadcasts"].append(bid)
                    continue
                sent, total = notifier.broadcast({
                    "title": b.get("title") or "Daily Bake",
                    "body": b.get("body") or "",
                    "icon": b.get("image") or "/assets/logo.png",
                    "url": f"/index.html?product={b['productId']}" if b.get("productId") else "/index.html",
                    "tag": f"bc-{bid}",
                })
                # نفس الإشعار بيتبعت كرسالة تليجرام لكل اللي رابطين البوت
                tg_text = f"🥐 *{b.get('title') or 'Daily Bake'}*\n{b.get('body') or ''}"
                tg_sent = 0
                for sid, s in (db.get("subscribers") or {}).items():
                    if isinstance(s, dict) and s.get("telegramChatId"):
                        r = notifier.tg_call("sendMessage", {
                            "chat_id": s["telegramChatId"], "text": tg_text, "parse_mode": "Markdown",
                        })
                        if r and r.get("ok"):
                            tg_sent += 1
                db.patch(f"broadcasts/{bid}", {"sentTo": sent, "telegramSentTo": tg_sent})
                log(f"إشعار جماعي: {b.get('title')} → {sent}/{total}")
                state["broadcasts"].append(bid)
            state["broadcasts"] = state["broadcasts"][-200:]

            # ---- pending Drive uploads ----
            if drive:
                pending = db.get("uploads") or {}
                for uid, u in pending.items():
                    if not isinstance(u, dict) or u.get("status") != "pending":
                        continue
                    try:
                        url = drive.upload_data_url(u.get("dataUrl"), u.get("name") or f"{uid}.png")
                        db.patch(f"uploads/{uid}", {"status": "done", "url": url, "dataUrl": None})
                        log(f"اترفعت صورة على Drive: {url}")
                    except Exception as e:
                        db.patch(f"uploads/{uid}", {"status": "error", "error": str(e)[:200]})
                        log(f"فشل رفع صورة: {e}")

            save_json(STATE, state)
        except KeyboardInterrupt:
            raise
        except Exception:
            log("خطأ غير متوقع:")
            traceback.print_exc()
        time.sleep(max(2, int(cfg.get("pollSeconds", 5))))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nتم الإيقاف.")
        sys.exit(0)
