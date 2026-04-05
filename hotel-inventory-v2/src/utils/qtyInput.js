/**
 * Utilitas untuk input Qty integer-only.
 *
 * Policy (v2.0.04): semua input quantity di aplikasi WAJIB integer (kelipatan 1).
 * Input seperti 0.5, 1.25 dst tidak diperbolehkan — langsung di-floor ke integer
 * terdekat pada saat onChange, dan karakter titik/koma/e di-block di keydown.
 *
 * Cara pakai:
 *
 *   import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
 *
 *   <input
 *     {...intQtyInputProps}
 *     value={qty}
 *     onChange={e => setQty(toIntQty(e.target.value))}
 *   />
 *
 * Atau kalau handler sudah ada (mis. updateLine):
 *
 *   <input
 *     {...intQtyInputProps}
 *     value={line.quantity}
 *     onChange={e => updateLine(idx, 'quantity', toIntQty(e.target.value))}
 *   />
 */

/**
 * Konversi nilai apa pun ke integer non-negatif.
 * - Nilai desimal di-floor (0.5 → 0, 1.9 → 1)
 * - NaN / undefined / null → 0
 * - Angka negatif → 0
 */
export function toIntQty(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = parseFloat(value);
  if (!isFinite(n)) return 0;
  if (n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Validasi apakah sebuah nilai integer qty yang valid (>=0).
 */
export function isValidIntQty(value) {
  if (value === '' || value === null || value === undefined) return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

/**
 * Block karakter desimal di keydown supaya user tidak bisa mengetik '.', ',', 'e', '+', '-'.
 */
function blockDecimalKeys(e) {
  const blocked = ['.', ',', 'e', 'E', '+', '-'];
  if (blocked.includes(e.key)) {
    e.preventDefault();
  }
}

/**
 * Block paste konten yang mengandung desimal.
 */
function sanitizePaste(e) {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (/[.,eE+-]/.test(text)) {
    e.preventDefault();
    // Masukkan hanya digit-nya
    const digitsOnly = text.replace(/[^0-9]/g, '');
    if (digitsOnly && e.target && typeof e.target.value !== 'undefined') {
      // Trigger synthetic input event via native setter
      try {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeInputValueSetter.call(e.target, digitsOnly);
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Spread-able props untuk `<input>` integer-only qty.
 * Gabung dengan prop lain: `<input {...intQtyInputProps} value={...} onChange={...} />`
 */
export const intQtyInputProps = {
  type: 'number',
  step: 1,
  min: 0,
  inputMode: 'numeric',
  pattern: '[0-9]*',
  onKeyDown: blockDecimalKeys,
  onPaste: sanitizePaste,
};
