import { supabase } from '../services/supabase.js';

/**
 * Check if a period is locked for a given organization and date
 */
export async function checkPeriodLock(orgId, docDate) {
  const date = new Date(docDate);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  const { data } = await supabase.from('period_locks')
    .select('id')
    .eq('organization_id', orgId)
    .eq('month', month)
    .eq('year', year)
    .single();
  return { locked: !!data, month, year };
}

/**
 * Get balance after a movement for stock tracking.
 *
 * NOTE (Fase 2 hardening, 2026-04-05):
 * Sejak DB trigger `fn_apply_stock_movement` aktif, balance_after di-stamp otomatis
 * oleh DB. Nilai dari fungsi ini hanya dipakai untuk UI preview.
 *
 * PENTING: Tidak ada lagi `Math.max(0, ...)` clamp. Jika hasil negatif,
 * itu berarti user mencoba over-issue — trigger DB akan raise exception
 * dan transaksi ditolak. Return nilai negatif di sini sebagai sinyal untuk UI.
 */
export async function getBalanceAfter(orgId, itemId, movementType, qty, warehouseId) {
  if (!warehouseId) {
    throw new Error('warehouseId is required for getBalanceAfter');
  }

  try {
    const { data } = await supabase.from('stock_balance')
      .select('quantity')
      .eq('organization_id', orgId)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId);

    const currentQty = (data || []).reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0);
    const q = parseFloat(qty) || 0;

    if (movementType === 'IN') return currentQty + q;
    if (movementType === 'OUT') return currentQty - q; // NO clamp — DB trigger akan reject jika < 0
    return q; // ADJ/OPNAME = set to qty directly
  } catch (e) {
    return 0;
  }
}
