/* Discount helpers shared by the storefront and the dashboard.
   product.discount = { type: 'percent'|'fixed', value, until: ms|null, campaignId?, label? } */

export function activeDiscount(product, now = Date.now()) {
  const d = product && product.discount;
  if (!d || !(Number(d.value) > 0)) return null;
  if (d.until && now > Number(d.until)) return null;
  return d;
}

export function discountedPrice(price, d) {
  if (!d) return price;
  const p = Number(price) || 0;
  if (d.type === 'fixed') return Math.max(0, p - Number(d.value));
  return Math.max(0, Math.round(p * (1 - Number(d.value) / 100) * 100) / 100);
}

export function discountBadge(d, currencyCode) {
  if (!d) return '';
  return d.type === 'fixed' ? `-${Number(d.value)} ${currencyCode || ''}`.trim() : `-${Number(d.value)}%`;
}

export function fmtDateShort(ts, lang = 'ar') {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
}
