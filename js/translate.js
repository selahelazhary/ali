/* Automatic Arabic → English translation for admin content.
   Uses two free, browser-callable services (no key needed), in order. */

async function viaMyMemory(text) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ar|en`);
  const j = await r.json();
  const t = j && j.responseData && j.responseData.translatedText;
  if (!t || Number(j.responseStatus) !== 200 || /MYMEMORY WARNING/i.test(t)) throw new Error('mymemory');
  return t;
}

async function viaGoogle(text) {
  const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=en&dt=t&q=${encodeURIComponent(text)}`);
  const j = await r.json();
  const out = (j && j[0] || []).map(x => x[0]).join('');
  if (!out) throw new Error('google');
  return out;
}

export async function translateToEnglish(text) {
  const src = (text || '').trim();
  if (!src) return '';
  if (!/[؀-ۿ]/.test(src)) return src; // already latin
  try { return await viaGoogle(src); } catch (e) { /* fall through */ }
  try { return await viaMyMemory(src); } catch (e) { /* fall through */ }
  throw new Error('الترجمة التلقائية غير متاحة حالياً');
}

/* Fills `enInput` from `arInput` unless the admin typed the English text by hand. */
export async function autoFillEnglish(arInput, enInput) {
  if (!arInput || !enInput) return;
  const src = arInput.value.trim();
  const manual = enInput.value.trim() && enInput.dataset.autoTranslated !== '1';
  if (!src || manual) return;
  if (enInput.dataset.autoFrom === src) return; // اترجمت قبل كده
  try {
    enInput.value = await translateToEnglish(src);
    enInput.dataset.autoTranslated = '1';
    enInput.dataset.autoFrom = src;
  } catch (e) { /* نسيب الحقل زي ما هو */ }
}

/* الترجمة تلقائية بالكامل: أول ما تكتب العربي، الإنجليزي بيتملي لوحده.
   الزرار موجود للترجمة اليدوية أو لإعادة الترجمة بعد تعديل يدوي. */
export function attachTranslateButton(root, arId, enId, label = 'ترجم تلقائياً') {
  const en = root.querySelector(`#${enId}`);
  const ar = root.querySelector(`#${arId}`);
  if (!en || !ar || en.dataset.translateWired) return;
  en.dataset.translateWired = '1';
  if (!en.value.trim()) en.dataset.autoTranslated = '1';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'translate-btn';
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = '...';
    try {
      en.value = await translateToEnglish(ar.value);
      en.dataset.autoTranslated = '1';
      en.dataset.autoFrom = ar.value.trim();
    } catch (e) {
      btn.textContent = 'فشل'; setTimeout(() => { btn.textContent = label; }, 1500); btn.disabled = false; return;
    }
    btn.textContent = label; btn.disabled = false;
  });
  en.insertAdjacentElement('afterend', btn);

  /* أي كتابة يدوية في حقل الإنجليزي بتوقف الترجمة التلقائية عليه */
  en.addEventListener('input', () => { en.dataset.autoTranslated = ''; });

  /* الترجمة بتشتغل وانت بتكتب (بعد ما تهدى ثانية) وكمان عند الخروج من الحقل */
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => autoFillEnglish(ar, en), 900); };
  ar.addEventListener('input', schedule);
  ar.addEventListener('blur', () => { clearTimeout(timer); autoFillEnglish(ar, en); });
}
