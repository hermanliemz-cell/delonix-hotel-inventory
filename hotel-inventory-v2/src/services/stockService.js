import { supabase } from './supabase.js';

/**
 * Stock movement service (Fase 6: RPC migration)
 *
 * Semua mutasi stok WAJIB lewat fungsi ini. Tidak ada lagi insert langsung
 * ke tabel stock_movements atau stock_balance dari frontend.
 *
 * Trigger di DB akan otomatis:
 *   - Validate quantity > 0
 *   - Reject jika movement OUT melebihi stok (strict reject, no clamp)
 *   - Update stock_balance cache + stamp balance_after
 *   - Tolak UPDATE movement (immutable)
 */

/**
 * Record a single stock movement (IN or OUT).
 * @returns {Promise<{ data: string|null, error: any }>} UUID of created movement
 */
export async function recordMovement({
  organizationId,
  itemId,
  warehouseId,
  movementType,        // 'IN' | 'OUT'
  quantity,
  referenceType,       // whitelist, lihat DB constraint stock_movements_ref_whitelist
  referenceNumber = null,
  referenceId = null,
  unitCost = null,
  departmentId = null,
  notes = null,
  vendorId = null,
}) {
  const { data, error } = await supabase.rpc('record_movement', {
    p_organization_id: organizationId,
    p_item_id: itemId,
    p_warehouse_id: warehouseId,
    p_movement_type: movementType,
    p_quantity: quantity,
    p_reference_type: referenceType,
    p_reference_number: referenceNumber,
    p_reference_id: referenceId,
    p_unit_cost: unitCost,
    p_department_id: departmentId,
    p_notes: notes,
    p_vendor_id: vendorId,
  });
  return { data, error };
}

/**
 * Record an atomic transfer: OUT from source + IN to dest in single transaction.
 * @returns {Promise<{ data: { out_id, in_id }|null, error: any }>}
 */
export async function recordTransfer({
  organizationId,
  itemId,
  sourceWarehouseId,
  destWarehouseId,
  quantity,
  referenceType,
  referenceNumber = null,
  referenceId = null,
  unitCost = null,
  departmentId = null,
  notes = null,
  vendorId = null,
}) {
  const { data, error } = await supabase.rpc('record_transfer', {
    p_organization_id: organizationId,
    p_item_id: itemId,
    p_source_warehouse_id: sourceWarehouseId,
    p_dest_warehouse_id: destWarehouseId,
    p_quantity: quantity,
    p_reference_type: referenceType,
    p_reference_number: referenceNumber,
    p_reference_id: referenceId,
    p_unit_cost: unitCost,
    p_department_id: departmentId,
    p_notes: notes,
    p_vendor_id: vendorId,
  });
  return { data: data?.[0] || data, error };
}

/**
 * Delete all movements linked to a reference (for approval rejection / reversal).
 * Trigger BEFORE DELETE akan auto-revert stock_balance.
 */
export async function deleteMovementsByRef({
  organizationId,
  referenceType,
  referenceId,
}) {
  const { data, error } = await supabase.rpc('delete_movements_by_ref', {
    p_organization_id: organizationId,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
  });
  return { data, error };
}
