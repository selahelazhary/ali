رفع وركر الإشعارات على حسابك في فيرسل
=====================================

المجلد ده مستقل تماماً عن الموقع — ممكن يترفع على أي حساب فيرسل.

الرفع (مرة واحدة)
-----------------
افتح Command Prompt جوه المجلد ده ونفّذ بالترتيب:

  npx vercel login
      ← اختار "Continue with GitHub" أو "Continue with Email"
        وادخل بالحساب اللي عايز ترفع عليه

  npx vercel --prod
      ← اضغط Enter على كل سؤال (الافتراضي مظبوط)
      ← في الآخر هيديك رابط زي:  https://xxxx.vercel.app


بعد الرفع: متغيّرين في لوحة فيرسل
----------------------------------
المشروع ← Settings ← Environment Variables ← Production:

  CRON_SECRET     أي كلمة سر عشوائية تختارها (احفظها)
  WORKER_CONFIG   سطر واحد فيه بيانات المحل:

  {"pollSeconds":5,"projects":[{"name":"اسم المحل",
   "databaseUrl":"https://<مشروعك>-default-rtdb.firebaseio.com",
   "apiKey":"AIza...","email":"<إيميل حساب الوركر>","password":"<باسوردة>"}]}

  البيانات دي كلها في config.json اللي بتنزّله من لوحة المحل:
  الأدمن ← وركر الإشعارات. ولإضافة محل تاني زوّد عنصر تاني في projects.

بعد ما تحفظ المتغيّرين اعمل Redeploy (Deployments ← آخر واحد ← ⋯ ← Redeploy).


التشغيل المستمر
---------------
سجّل الرابط ده في cron-job.org (مجاني) كل دقيقة:

  https://<رابط-مشروعك>.vercel.app/api/worker?key=<CRON_SECRET>


الاختبار
--------
افتح نفس الرابط في المتصفح. المفروض يرد:

  {"ok":true,"at":...,"results":[{"name":"...","newOrders":0,"statusUpdates":0}]}

  • بدون مفتاح أو بمفتاح غلط  ← 401
  • WORKER_CONFIG ناقص        ← رسالة بتقول كده بالظبط
