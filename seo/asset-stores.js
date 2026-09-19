#!/usr/bin/env node
/* مخازن الصور الإضافية — الحالة والإعداد.
   ------------------------------------------------------------------
   الصور أتقل حاجة بتتنزّل من القاعدة، وسقف الخطة المجانية ١ جيجا مساحة
   و١٠ جيجا تحميل في الشهر **لكل مشروع**. عشان كده الصور الجديدة بتتخزّن
   في مشاريع إضافية: أول مخزن يقبل الكتابة هو اللي الصورة تستقر فيه، ولما
   يمتلي الرفع بيكمّل على اللي بعده لوحده.

   الصور القديمة (إشارتها a:) فاضلة مكانها على القاعدة الأساسية ومحدش
   بيلمسها — الكلام ده على الجديد بس.

   التشغيل:  node seo/asset-stores.js           عرض الحالة
             node seo/asset-stores.js --apply   تظبيط قواعد المخازن (مرة واحدة) */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* لازم يطابقوا ASSET_STORES في js/assets.js */
const STORES = [
  { key: 'b', project: 'mdhj-d3cdb', url: 'https://mdhj-d3cdb-default-rtdb.firebaseio.com' },
  { key: 'c', project: 'earc-55619', url: 'https://earc-55619-default-rtdb.europe-west1.firebasedatabase.app' },
  { key: 'd', project: 'newserver1-c9a15', url: 'https://newserver1-c9a15-default-rtdb.firebaseio.com' },
];
const PRIMARY = { key: 'a', project: 'alih-5212b', url: 'https://alih-5212b-default-rtdb.firebaseio.com' };
const RULES = path.join(__dirname, '..', 'mirror-rules.json');
const apply = process.argv.includes('--apply');

async function status(store) {
  try {
    const res = await fetch(`${store.url}/assets.json?shallow=true`, { signal: AbortSignal.timeout(15000) });
    if (res.status === 401) return { ok: false, note: 'القواعد مانعة القراءة — محتاج --apply' };
    if (!res.ok) return { ok: false, note: `رد ${res.status}` };
    const ids = Object.keys((await res.json()) || {});
    return { ok: true, count: ids.length };
  } catch (e) { return { ok: false, note: e.message.slice(0, 60) }; }
}

/* قواعد المخزن: قراءة عامة للصور، وكتابة "إنشاء بس" — الصورة تتكتب مرة
   ومتتغيّرش ولا تتمسح أبداً، وباقي القاعدة مقفول. */
function deployRules(store) {
  const cfg = path.join(os.tmpdir(), `store-${store.project}-${Date.now()}.json`);
  fs.writeFileSync(cfg, JSON.stringify({ database: { rules: RULES.split(path.sep).join('/') } }), 'utf8');
  execFileSync('firebase', ['deploy', '--only', 'database', '--project', store.project, '--config', cfg],
    { stdio: 'inherit', shell: true });
  fs.unlinkSync(cfg);
}

(async () => {
  for (const store of [PRIMARY, ...STORES]) {
    const st = await status(store);
    const label = store.key === 'a' ? 'الأساسي' : `مخزن ${store.key}`;
    console.log(`${label.padEnd(9)} ${store.project.padEnd(14)} ${st.ok ? `${st.count} صورة` : '✗ ' + st.note}`);
  }

  if (!apply) {
    console.log('\nلتظبيط قواعد المخازن (مرة واحدة):  node seo/asset-stores.js --apply');
    return;
  }
  for (const store of STORES) {
    console.log(`\n── قواعد ${store.project} ──`);
    try { deployRules(store); } catch (e) { console.error(`فشل ${store.project}: ${e.message.split('\n')[0]}`); }
  }
  console.log('\nتم ✓ — من دلوقتي أي صورة جديدة بتتخزّن في أول مخزن فيه مكان، أوتوماتيك.');
})();
