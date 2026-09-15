/* ملفات تعريف الارتباط (الكوكيز) — شريط موافقة بسيط + سياسة مكتوبة.
   الموقع مش بيستخدم أي تتبّع خارجي: كل اللي بيتخزّن محلي على جهاز العميل
   (عربة الطلبات، اللغة، طلباته، تفعيل الإشعارات). */
import { ICONS } from './icons.js';

const KEY = 'nb_cookie_consent';      // 'all' | 'essential'
const AT_KEY = 'nb_cookie_consent_at';

const STR = {
  ar: {
    title: 'ملفات تعريف الارتباط (الكوكيز)',
    text: 'بنستخدم تخزين محلي على جهازك عشان نفتكر عربة طلباتك ولغتك وطلباتك السابقة. مفيش أي تتبّع إعلاني ولا مشاركة بياناتك مع حد.',
    accept: 'موافق',
    essential: 'الضروري فقط',
    policy: 'تفاصيل الكوكيز',
    close: 'إغلاق',
    manage: 'إعدادات الكوكيز',
    saved: 'اتحفظ اختيارك',
    sections: [
      {
        h: 'إيه اللي بنخزّنه؟',
        items: [
          ['عربة الطلبات', 'الأصناف اللي اخترتها عشان متضيعش لما تقفل الصفحة.', 'ضروري'],
          ['اللغة', 'عربي ولا إنجليزي — عشان الموقع يفتح بلغتك.', 'ضروري'],
          ['طلباتي', 'أرقام طلباتك على الجهاز ده عشان تقدر تتبّعها.', 'ضروري'],
          ['الإشعارات', 'رقم اشتراكك في الإشعارات وربط تليجرام لو فعّلتهم.', 'اختياري'],
          ['تفضيلات العرض', 'حاجات صغيرة زي إخفاء تنبيه التثبيت.', 'اختياري'],
        ],
      },
      {
        h: 'إيه اللي مش بنعمله؟',
        items: [
          ['مفيش تتبّع إعلاني', 'مفيش Google Analytics ولا بكسل فيسبوك ولا أي طرف تالت.', ''],
          ['مفيش بيع بيانات', 'بياناتك مش بتتباع ولا بتتشارك مع أي حد.', ''],
          ['بيانات الطلب', 'اسمك وتليفونك وعنوانك بيتبعتوا للمخبز عشان يجهّز طلبك بس.', ''],
        ],
      },
      {
        h: 'تقدر تمسحها في أي وقت',
        items: [['من المتصفح', 'امسح بيانات الموقع من إعدادات المتصفح وهيتشال كل حاجة اتخزنت.', '']],
      },
    ],
  },
  en: {
    title: 'Cookies & local storage',
    text: 'We store data locally on your device to remember your cart, language and past orders. No ad tracking and no sharing of your data.',
    accept: 'Accept',
    essential: 'Essential only',
    policy: 'Cookie details',
    close: 'Close',
    manage: 'Cookie settings',
    saved: 'Your choice was saved',
    sections: [
      {
        h: 'What we store',
        items: [
          ['Cart', 'The items you picked, so they survive a page close.', 'Essential'],
          ['Language', 'Arabic or English, so the site opens in your language.', 'Essential'],
          ['My orders', 'Your order numbers on this device so you can track them.', 'Essential'],
          ['Notifications', 'Your notification subscription and Telegram link, if enabled.', 'Optional'],
          ['Display preferences', 'Small things like dismissing the install hint.', 'Optional'],
        ],
      },
      {
        h: 'What we never do',
        items: [
          ['No ad tracking', 'No Google Analytics, no Facebook pixel, no third parties.', ''],
          ['No data selling', 'Your data is never sold or shared.', ''],
          ['Order details', 'Your name, phone and address go to the bakery only, to fulfil your order.', ''],
        ],
      },
      {
        h: 'You can clear it anytime',
        items: [['From your browser', 'Clear this site’s data in your browser settings and everything stored is gone.', '']],
      },
    ],
  },
};

export function cookieChoice() {
  try { return localStorage.getItem(KEY); } catch (e) { return null; }
}
function saveChoice(v) {
  try { localStorage.setItem(KEY, v); localStorage.setItem(AT_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}
/* الكوكيز الاختيارية (زي ربط الإشعارات) بتشتغل بس لو العميل وافق على الكل */
export function optionalCookiesAllowed() { return cookieChoice() === 'all'; }

export function openCookiePolicy(lang = 'ar') {
  const S = STR[lang] || STR.ar;
  const overlay = document.createElement('div');
  overlay.className = 'ex-eg-modal-overlay';
  overlay.innerHTML = `
    <div class="ex-eg-modal-sheet">
      <div class="ex-eg-sheet-title">${S.title}<button class="ex-eg-icon-btn ex-eg-ghost close-modal">${ICONS.close}</button></div>
      <div class="ex-eg-cookie-policy">
        <p class="ex-eg-cookie-intro">${S.text}</p>
        ${S.sections.map(sec => `
          <h4>${sec.h}</h4>
          <ul>
            ${sec.items.map(([t, d, tag]) => `
              <li><b>${t}</b>${tag ? `<span class="ex-eg-cookie-tag ${tag === 'ضروري' || tag === 'Essential' ? 'ex-eg-req' : ''}">${tag}</span>` : ''}<span>${d}</span></li>
            `).join('')}
          </ul>
        `).join('')}
      </div>
    </div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('.close-modal').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

export function setupCookieConsent(ctx) {
  const lang = ctx.lang === 'en' ? 'en' : 'ar';
  const S = STR[lang];
  if (cookieChoice()) return;              // اختار قبل كده
  if (document.querySelector('.ex-eg-cookie-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'ex-eg-cookie-bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', S.title);
  bar.innerHTML = `
    <div class="ex-eg-cookie-body">
      <span class="ex-eg-cookie-icon">${ICONS.cookie || ICONS.info}</span>
      <div>
        <b>${S.title}</b>
        <p>${S.text} <button type="button" class="ex-eg-cookie-link" data-policy>${S.policy}</button></p>
      </div>
    </div>
    <div class="ex-eg-cookie-actions">
      <button type="button" class="ex-eg-cookie-ghost" data-choice="essential">${S.essential}</button>
      <button type="button" class="ex-eg-cookie-ok" data-choice="all">${S.accept}</button>
    </div>`;
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('ex-eg-show'));

  bar.querySelector('[data-policy]').addEventListener('click', () => openCookiePolicy(lang));
  bar.querySelectorAll('[data-choice]').forEach(b => b.addEventListener('click', () => {
    saveChoice(b.dataset.choice);
    bar.classList.remove('ex-eg-show');
    setTimeout(() => bar.remove(), 300);
    if (window.__sfToast) window.__sfToast(S.saved, ICONS.check);
  }));
}
