#!/usr/bin/env node
/* نشر كامل بأمر واحد: يقرا آخر منيو من فايربيز → يولّد محتوى SEO ثابت →
   ينشر على الاستضافة → يبلّغ محركات البحث إن الخريطة اتغيّرت.

   ليه لازم: الموقع بيبني محتواه بجافاسكربت، فأي منتج جديد مايبقاش موجود في
   الـ HTML اللي الزواحف بتقراه إلا لما نولّده تاني وننشر. الأمر ده بيعمل ده كله.

   التشغيل:  node seo/publish.js      (أو دوس مرتين على  نشر.bat) */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://monawaat.web.app';
/* مشروع فيرسل المرتبط (الرابط الثابت: https://monawaat.vercel.app) */
const VERCEL_LINK = { projectId: 'prj_ZFbOXtVQW4gREBcjiX0iR5GMAA2C', orgId: 'team_W3asu5A49RSFY9ukf8TdRD5x', projectName: 'ali' };
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });

(async () => {
  console.log('\n[١/٥] بنقرا المنيو ونولّد محتوى محركات البحث...');
  run('node seo/prerender.js');

  console.log('\n[٢/٥] بنجهّز نسخة نشر بدون تعليقات...');
  run('node seo/strip.js');

  console.log('\n[٣/٥] بننشر على الاستضافة...');
  run('firebase deploy --only hosting --project alih-5212b');

  console.log('\n[٤/٥] بننشر نفس النسخة على فيرسل (من dist بس — مفيش ملفات داخلية)...');
  /* strip.js بيمسح dist كل مرة، فبنكتب ربط المشروع من جديد قبل النشر.
     النشر لازم يتم من جوّه dist عشان مايترفعش غير الملفات العامة. */
  try {
    const fs = require('fs');
    const DIST = path.join(ROOT, 'dist');
    fs.mkdirSync(path.join(DIST, '.vercel'), { recursive: true });
    fs.writeFileSync(path.join(DIST, '.vercel', 'project.json'), JSON.stringify(VERCEL_LINK));
    execSync('vercel --prod --yes', { cwd: DIST, stdio: 'inherit', shell: true });
  } catch (e) {
    console.log('   فيرسل: اتخطّى (' + String(e.message || e).split('\n')[0] + ')');
  }

  console.log('\n[٥/٥] بنبلّغ محركات البحث بخريطة الموقع...');
  const sitemap = encodeURIComponent(`${SITE}/sitemap.xml`);
  const pings = [
    ['Bing / IndexNow', `https://www.bing.com/ping?sitemap=${sitemap}`],
  ];
  for (const [name, url] of pings) {
    try {
      const r = await fetch(url, { method: 'GET' });
      console.log(`   ${name}: ${r.ok ? 'تم ✓' : 'رد ' + r.status}`);
    } catch (e) {
      console.log(`   ${name}: تعذّر (${e.message})`);
    }
  }

  console.log('\nتم النشر ✓');
  console.log('جوجل بيزحف لوحده خلال ساعات/أيام. لو عايزه يشوف التغيير النهاردة:');
  console.log('  افتح Search Console → URL Inspection → حط ' + SITE + ' → Request Indexing');
})().catch((e) => { console.error('\nفشل النشر:', e.message); process.exit(1); });
