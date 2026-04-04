/**
 * Format currency based on system settings
 */
export function formatCurrency(amount) {
  const curr = window.__systemSettings?.currency || 'IDR';
  const locale = curr === 'IDR' ? 'id-ID' : curr === 'CNY' ? 'zh-CN' : curr === 'THB' ? 'th-TH' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: curr, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(amount || 0));
}

/**
 * Format number with locale-specific separators
 */
export function formatNumber(num) {
  return new Intl.NumberFormat('id-ID').format(num || 0);
}

/**
 * Format date using system timezone (default WIB)
 */
export function formatDateSys(dateStr, opts = {}) {
  if (!dateStr) return '-';
  const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
  const d = new Date(dateStr);
  const { includeTime } = opts;
  if (includeTime) {
    return d.toLocaleString('id-ID', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  }
  return d.toLocaleDateString('id-ID', { timeZone: tz });
}

/**
 * Format date/time with system timezone
 */
export function formatDate(ts) {
  if (!ts) return '-';
  const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(ts));
}

/**
 * Get local date string in YYYY-MM-DD format
 */
export function getLocalDateString(date) {
  if (!date) date = new Date();
  if (typeof date === 'string') date = new Date(date);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
