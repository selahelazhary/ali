"""Daily Bake worker — one-time setup.

Generates the VAPID key pair used for Web Push (no Google Cloud, no service
account, no paid plan) and writes config.json. Run once:

    py setup.py
"""
import base64
import getpass
import json
import os
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "config.json")
DB_URL = "https://alih-5212b-default-rtdb.firebaseio.com"
API_KEY = "AIzaSyDiPGPUYEB57L_nQNQUqZnmZQIDmR5aBS4"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def generate_vapid():
    key = ec.generate_private_key(ec.SECP256R1())
    priv_raw = key.private_numbers().private_value.to_bytes(32, "big")
    pub_raw = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return {"public": b64(pub_raw), "private": b64(priv_raw), "pem": pem}


def main():
    existing = {}
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding="utf-8") as fh:
            existing = json.load(fh)
        print("config.json موجود بالفعل — هيتم تحديثه.\n")

    print("=== إعداد سيرفر الإشعارات (Daily Bake) ===\n")
    print("محتاج بيانات دخول حساب المالك في لوحة التحكم (بتتخزن على جهازك فقط).")
    email = input(f"الإيميل [{existing.get('email', '')}]: ").strip() or existing.get("email", "")
    password = getpass.getpass("الباسورد (مش هيظهر وانت بتكتب): ").strip() or existing.get("password", "")
    if not email or not password:
        print("لازم تدخل الإيميل والباسورد.")
        sys.exit(1)

    vapid = existing.get("vapid") or generate_vapid()
    if existing.get("vapid"):
        print("\nمفاتيح Web Push موجودة — هنستخدم نفسها (متغيّرهاش عشان الاشتراكات القديمة تفضل شغالة).")
    else:
        print("\nاتولدت مفاتيح Web Push جديدة ✓")

    cfg = {
        "email": email,
        "password": password,
        "databaseUrl": existing.get("databaseUrl", DB_URL),
        "apiKey": existing.get("apiKey", API_KEY),
        "vapid": vapid,
        "vapidSubject": existing.get("vapidSubject", "mailto:" + email),
        "pollSeconds": existing.get("pollSeconds", 5),
        "drive": existing.get("drive", {"enabled": False, "folderName": "Daily Bake Images"}),
    }
    with open(CONFIG, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)

    print("\nاتحفظ config.json ✓")
    print("\nالمفتاح العام (هيتحط تلقائياً في الموقع أول ما تشغّل الوركر):")
    print("  " + vapid["public"])
    print("\nالخطوة الجاية:  py worker.py")


if __name__ == "__main__":
    main()
