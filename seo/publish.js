#!/usr/bin/env node
/* نشر كامل بأمر واحد: يقرا آخر منيو من فايربيز → يولّد محتوى SEO ثابت →
   ينشر على الاستضافة → يبلّغ محركات البحث إن الخريطة اتغيّرت.

   ليه لازم: الموقع بيبني محتواه بجافاسكربت، فأي منتج جديد مايبقاش موجود في
   الـ HTML اللي الزواحف بتقراه إلا لما نولّده تاني وننشر. الأمر ده بيعمل ده كله.

   التشغيل:  node seo/publish.js      (أو دوس مرتين على  نشر.bat) */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://alih-5212b.web.app';
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });

(async () => {
  console.log('\n[١/٤] بنقرا المنيو ونولّد محتوى محركات البحث...');
  run('node seo/prerender.js');

  console.log('\n[٢/٤] بنجهّز نسخة نشر بدون تعليقات...');
  run('node seo/strip.js');

  console.log('\n[٣/٤] بننشر على الاستضافة...');
  run('firebase deploy --only hosting --project alih-5212b');

  console.log('\n[٤/٤] بنبلّغ محركات البحث بخريطة الموقع...');
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
