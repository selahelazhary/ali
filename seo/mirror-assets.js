#!/usr/bin/env node
/* مزامنة مخزن الصور مع مشروع فايربيز التاني (المرآة).
   ------------------------------------------------------------------
   ليه: الصور هي أتقل حاجة بتتنزّل من القاعدة، وسقف الخطة المجانية ١٠ جيجا
   في الشهر لكل مشروع. لما الصور تبقى موجودة على مشروعين، الموقع بيقسّم
   القراءة عليهم نص بنص (حسب أول حرف في اسم الصورة) فالسقف بيتضاعف.

   الصور محتواها ثابت — اسم الصورة هو بصمة محتواها — فالنسخة التانية
   مش محتاجة أي تزامن مستمر، بس تشغيل الأمر ده بعد ما تضيف صور جديدة.

   التشغيل:  node seo/mirror-assets.js           (يعرض الناقص بس)
             node seo/mirror-assets.js --apply   (ينسخ الناقص فعلاً)  */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRIMARY = 'alih-5212b';
const MIRROR = 'mdhj-d3cdb';
const PRIMARY_URL = 'https://alih-5212b-default-rtdb.firebaseio.com';
const MIRROR_URL = 'https://mdhj-d3cdb-default-rtdb.firebaseio.com';

const apply = process.argv.includes('--apply');

async function ids(base) {
  const res = await fetch(`${base}/assets.json?shallow=true`);
  if (!res.ok) throw new Error(`${base} رد ${res.status}`);
  return Object.keys((await res.json()) || {});
}

(async () => {
  const [here, there] = await Promise.all([ids(PRIMARY_URL), ids(MIRROR_URL)]);
  const missing = here.filter(id => !there.includes(id));
  const extra = there.filter(id => !here.includes(id));

  console.log(`الأساسي (${PRIMARY}): ${here.length} صورة`);
  console.log(`المرآة  (${MIRROR}): ${there.length} صورة`);
  console.log(`ناقص على المرآة: ${missing.length}${extra.length ? ` — وزيادة عندها: ${extra.length}` : ''}`);

  if (!missing.length) { console.log('\nالمرآة متطابقة ✓'); return; }
  if (!apply) {
    console.log('\nللنسخ فعلاً:  node seo/mirror-assets.js --apply');
    return;
  }

  const tmp = path.join(os.tmpdir(), `asset-${Date.now()}.json`);
  let done = 0;
  for (const id of missing) {
    const res = await fetch(`${PRIMARY_URL}/assets/${id}.json`);
    const value = await res.json();
    if (typeof value !== 'string' || !value) { console.log(`  تخطّي ${id} — مش صورة`); continue; }
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    execFileSync('firebase', ['database:set', `/assets/${id}`, tmp, '--project', MIRROR, '--force'],
      { stdio: 'ignore', shell: true });
    done++;
    process.stdout.write(`\r  اتنسخ ${done}/${missing.length}`);
  }
  fs.existsSync(tmp) && fs.unlinkSync(tmp);
  console.log(`\nتم ✓ — ${done} صورة اتنسخت للمرآة`);
})().catch(e => { console.error('فشل:', e.message); process.exit(1); });
