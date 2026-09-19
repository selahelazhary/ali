#!/usr/bin/env node
/* تجهيز نسخة النشر.
   الكود فيه تعليقات بتشرح بنية الموقع وقرارات التصميم، وهي بتتبعت لأي زائر
   مع الملفات. هنا بنعمل نسخة نضيفة في مجلد dist:
     • التعليقات بتتشال والملفات بتتصغّر (esbuild — أداة حقيقية مش تجريد يدوي)
     • الملفات الداخلية (شروحات، سكربتات، إعدادات الوركر) مابتتنسخش أصلاً
   الأصل مابيتلمسش خالص، والنشر بيتم من dist. */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');


const SKIP_DIRS = new Set(['dist', 'node_modules', '.git', '.firebase', 'functions', 'push-worker', 'seo', 'vercel-worker']);
const SKIP_FILES = new Set(['firebase.json', '.firebaserc', 'build-data.js', 'build-logo.js', 'serve.js', 'source-data.json', 'firebase-seed.json', 'package.json', 'package-lock.json']);
const SKIP_EXT = new Set(['.md', '.bat', '.ps1', '.sh', '.py', '.log']);

function transform(file, loader) {
  /* minifyWhitespace + minifySyntax بيشيلوا التعليقات والمسافات.
     مابنغيّرش أسماء المتغيرات عشان أسماء الـ exports تفضل زي ما هي. */
  const res = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
    loader,
    format: loader === 'js' ? 'esm' : undefined,
    minifyWhitespace: true,
    minifySyntax: true,
    charset: 'utf8',
  });
  return res.code;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith('.')) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(name)) copyTree(src, dst);
      continue;
    }
    if (SKIP_FILES.has(name) || SKIP_EXT.has(path.extname(name))) continue;
    if (/^firebase-rules.*\.json$/.test(name) || name === 'database.rules.json') continue;

    const ext = path.extname(name);
    if (ext === '.js' || ext === '.css') {
      fs.writeFileSync(dst, transform(src, ext.slice(1)));
    } else if (ext === '.html') {
      /* تعليقات HTML بتتشال، بس علامات SEO بتفضل عشان السكربت يلاقيها */
      const html = fs.readFileSync(src, 'utf8')
        .replace(/<!--(?!\s*(SEO:START|SEO:END|\[if))[\s\S]*?-->/g, '');
      fs.writeFileSync(dst, html);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
}

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
copyTree(ROOT, DIST);

let files = 0, bytes = 0;
(function walk(p) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f); else { files++; bytes += fs.statSync(f).size; }
  }
})(DIST);

console.log(`   نسخة النشر: ${files} ملف، ${Math.round(bytes / 1024)} ك.ب — بدون تعليقات ولا ملفات داخلية`);
