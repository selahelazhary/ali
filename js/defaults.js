/* Shared fallback data used by both the storefront and the dashboard
   whenever the corresponding Firebase node is empty or unreadable. */

export const EGYPT_GOVERNORATES = [
  { id: 'cairo', ar: 'القاهرة', en: 'Cairo' },
  { id: 'giza', ar: 'الجيزة', en: 'Giza' },
  { id: 'alexandria', ar: 'الإسكندرية', en: 'Alexandria' },
  { id: 'qalyubia', ar: 'القليوبية', en: 'Qalyubia' },
  { id: 'dakahlia', ar: 'الدقهلية', en: 'Dakahlia' },
  { id: 'sharqia', ar: 'الشرقية', en: 'Sharqia' },
  { id: 'gharbia', ar: 'الغربية', en: 'Gharbia' },
  { id: 'monufia', ar: 'المنوفية', en: 'Monufia' },
  { id: 'beheira', ar: 'البحيرة', en: 'Beheira' },
  { id: 'kafr-el-sheikh', ar: 'كفر الشيخ', en: 'Kafr El Sheikh' },
  { id: 'damietta', ar: 'دمياط', en: 'Damietta' },
  { id: 'port-said', ar: 'بورسعيد', en: 'Port Said' },
  { id: 'ismailia', ar: 'الإسماعيلية', en: 'Ismailia' },
  { id: 'suez', ar: 'السويس', en: 'Suez' },
  { id: 'fayoum', ar: 'الفيوم', en: 'Fayoum' },
  { id: 'beni-suef', ar: 'بني سويف', en: 'Beni Suef' },
  { id: 'minya', ar: 'المنيا', en: 'Minya' },
  { id: 'asyut', ar: 'أسيوط', en: 'Asyut' },
  { id: 'sohag', ar: 'سوهاج', en: 'Sohag' },
  { id: 'qena', ar: 'قنا', en: 'Qena' },
  { id: 'luxor', ar: 'الأقصر', en: 'Luxor' },
  { id: 'aswan', ar: 'أسوان', en: 'Aswan' },
  { id: 'red-sea', ar: 'البحر الأحمر', en: 'Red Sea' },
  { id: 'new-valley', ar: 'الوادي الجديد', en: 'New Valley' },
  { id: 'matrouh', ar: 'مطروح', en: 'Matrouh' },
  { id: 'north-sinai', ar: 'شمال سيناء', en: 'North Sinai' },
  { id: 'south-sinai', ar: 'جنوب سيناء', en: 'South Sinai' },
];

/* Governorate settings as stored in Firebase: { [id]: { enabled, deliveryFee } } */
export function defaultGovernorateSettings() {
  const out = {};
  EGYPT_GOVERNORATES.forEach(g => {
    out[g.id] = { enabled: g.id === 'cairo' || g.id === 'giza', deliveryFee: 0 };
  });
  return out;
}

/* scope = مين يشوف طريقة الدفع دي: both = الكل، inside = طلبات جوّه المحل،
   outside = طلبات برّه (توصيل/استلام). requireProof = العميل لازم يرفع صورة التحويل. */
export const DEFAULT_PAYMENTS = {
  cod: { enabled: true, scope: 'both' },
  vodafoneCash: { enabled: false, number: '', scope: 'both' },
  etisalatCash: { enabled: false, number: '', scope: 'both' },
  instapay: { enabled: false, address: '', link: '', scope: 'both' },
  requireProof: true,
};

export const PAYMENT_SCOPES = [
  { id: 'both', ar: 'جوّه وبرّه المحل' },
  { id: 'inside', ar: 'جوّه المحل بس' },
  { id: 'outside', ar: 'برّه المحل بس' },
];

export function paymentInScope(cfg, orderType) {
  const s = (cfg && cfg.scope) || 'both';
  if (s === 'both') return true;
  return s === (orderType === 'inside' ? 'inside' : 'outside');
}

/* Feature switches controlled from the dashboard (settings/features). */
export const DEFAULT_FEATURES = {
  notifications: true,      // customers can subscribe + receive broadcasts
  notifyNewProducts: true,  // auto-broadcast when a new product is added
  notifyDiscounts: true,    // auto-broadcast when a discount is created
  pwaInstall: true,         // "install as app" prompt + offline shell
  serverRelay: false,       // Cloud Functions deployed → Telegram + push are sent server-side
  vapidPublicKey: '',       // published automatically by the Python worker
  pythonWorker: false,      // true once the local worker has checked in
  driveUploads: false,      // worker uploads dashboard images to Google Drive
  cookieBanner: true,       // شريط موافقة ملفات تعريف الارتباط للعملاء
  /* ربط حساب الأدمن بمتصفح واحد. مقفول افتراضياً: رقم الجهاز بيتخزّن في
     المتصفح، وأي مسح لبيانات الموقع بيغيّره فيتقفل صاحب الحساب بره لوحته.
     الحماية الأساسية هي الإيميل والباسورد + قواعد قاعدة البيانات. */
  deviceBinding: false,
};

export const ORDER_STATUSES = ['new', 'preparing', 'ready', 'completed', 'cancelled'];

export const STATUS_LABELS = {
  ar: { new: 'جديد', preparing: 'قيد التجهيز', ready: 'جاهز', completed: 'مكتمل', cancelled: 'ملغي' },
  en: { new: 'New', preparing: 'Preparing', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' },
};

export const BANNER_ANIMATIONS = [
  { id: 'fade', ar: 'تلاشي (Fade)', en: 'Fade' },
  { id: 'slide', ar: 'انزلاق (Slide)', en: 'Slide' },
  { id: 'zoom', ar: 'تكبير (Zoom)', en: 'Zoom' },
  { id: 'flip', ar: 'قلب (Flip)', en: 'Flip' },
];

/* نموذج آراء العملاء الافتراضي — بيتعرض لو مفيش نموذج متسجّل في قاعدة البيانات،
   عشان زرار "رأيك مهم لينا" مايفضلش ساكت. */
export const DEFAULT_FEEDBACK_FORM = {
  title: { ar: 'رأيك يهمنا! شاركنا تجربتك 😊', en: 'Tell us about your experience! 😊' },
  questions: [
    { id: 1, type: 'rating', question: { ar: 'تجربتك معانا بشكل عام؟', en: 'How was your overall experience?' } },
    { id: 2, type: 'rating', question: { ar: 'رأيك في جودة المنتجات؟', en: 'How do you rate our products?' } },
    { id: 3, type: 'rating', question: { ar: 'رأيك في الخدمة؟', en: 'What do you think about our service?' } },
    { id: 4, type: 'text', question: { ar: 'أي اقتراحات أو ملاحظات؟', en: 'Any suggestions or comments?' } },
    { id: 5, type: 'text', question: { ar: 'رقم التليفون (اختياري)', en: 'Phone number (optional)' } },
  ],
};
