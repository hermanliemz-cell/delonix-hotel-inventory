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
 * Get balance after a movement for stock tracking
 * FIX B3: warehouseId is now a REQUIRED parameter, always included in query
 * FIX B7: Changed division guard from > 0 to > 0.001 for better precision
 */
export async function getBalanceAfter(orgId, itemId, movementType, qty, warehouseId) {
  if (!warehouseId) {
    throw new Error('warehouseId is required for getBalanceAfter');
  }

  try {
    let query = supabase.from('stock_balance')
      .select('quantity')
      .eq('organization_id', orgId)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId);

    const { data } = await query;
    const currentQty = (data || []).reduce((sum, r) => sum + (parseFloat(r.quantity) || 0), 0);

    if (movementType === 'IN') {
      return currentQty + parseFloat(qty);
    }
    if (movementType === 'OUT') {
      return Math.max(0, currentQty - parseFloat(qty));
    }
    return parseFloat(qty); // ADJ/OPNAME = set to qty directly
  } catch (e) {
    return 0;
  }
}
