import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { formatDateSys, formatCurrency } from '../utils/format';
import { Modal } from './Modal';

export function DocDetailModal({ movement, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!movement) return;
    loadDetail();
  }, [movement]);

  async function loadDetail() {
    setLoading(true);
    const rt = movement.reference_type;
    const rid = movement.reference_id;
    const rn = movement.reference_number;
    let result = null;
    try {
      if (rt === 'USAGE' && (rid || rn)) {
        let query = supabase.from('single_item_usage').select('*, items(code, name, units:unit_id(abbreviation)), warehouses(code, name), departments(code, name)');
        query = rid ? query.eq('id', rid) : query.eq('usage_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'USAGE', title: data.usage_number, data, fields: [
          { label: 'Document No', value: data.usage_number },
          { label: 'Status', value: data.status },
          { label: 'Item', value: `${data.items?.code} - ${data.items?.name}` },
          { label: 'Qty', value: `${data.quantity} ${data.items?.units?.abbreviation || ''}` },
          { label: 'Warehouse', value: data.warehouses?.name || '-' },
          { label: 'Department', value: data.departments?.name || '-' },
          { label: 'Date', value: formatDateSys(data.created_at, { includeTime: true }) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if (rt === 'GR' && (rid || rn)) {
        let query = supabase.from('goods_receipts').select('*, vendors(name), purchase_orders(po_number)');
        query = rid ? query.eq('id', rid) : query.eq('gr_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'GR', title: data.gr_number, data, fields: [
          { label: 'Document No', value: data.gr_number },
          { label: 'Status', value: data.status },
          { label: 'Vendor', value: data.vendors?.name || '-' },
          { label: 'PO Reference', value: data.purchase_orders?.po_number || '-' },
          { label: 'Date', value: formatDateSys(data.receipt_date) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if (rt === 'DIRECT_PURCHASE' && (rid || rn)) {
        let query = supabase.from('direct_purchases').select('*, departments(name)');
        query = rid ? query.eq('id', rid) : query.eq('purchase_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'DP', title: data.purchase_number, data, fields: [
          { label: 'Document No', value: data.purchase_number },
          { label: 'Status', value: data.status },
          { label: 'Location', value: data.purchase_location || '-' },
          { label: 'Department', value: data.departments?.name || '-' },
          { label: 'Date', value: formatDateSys(data.purchase_date) },
          { label: 'Total', value: formatCurrency(data.total_amount) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if (rt === 'WRITEOFF' && (rid || rn)) {
        let query = supabase.from('write_offs').select('*, departments(code, name)');
        query = rid ? query.eq('id', rid) : query.eq('wo_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'WO', title: data.wo_number || rn || 'Write-Off', data, fields: [
          { label: 'Document No', value: data.wo_number || rn || '-' },
          { label: 'Status', value: data.status },
          { label: 'Department', value: data.departments?.name || '-' },
          { label: 'Reason', value: data.reason || '-' },
          { label: 'Total Value', value: data.total_value ? formatCurrency(data.total_value) : '-' },
          { label: 'Date', value: formatDateSys(data.write_off_date || data.created_at) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if ((rt === 'MAKEUP' || rt === 'REPLACEMENT' || rt === 'LOST_BREAKAGE') && (rid || rn)) {
        let query = supabase.from('room_makeups').select('*, departments(code, name)');
        query = rid ? query.eq('id', rid) : query.eq('makeup_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'MU', title: data.makeup_number || rn, data, fields: [
          { label: 'Document No', value: data.makeup_number || rn || '-' },
          { label: 'Type', value: rt },
          { label: 'Status', value: data.status },
          { label: 'Department', value: data.departments?.name || '-' },
          { label: 'Date', value: formatDateSys(data.makeup_date || data.created_at) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if (rt === 'ADDITIONAL_REQUEST' && (rid || rn)) {
        let query = supabase.from('room_additional_requests').select('*, rooms(room_number), departments(code, name)');
        query = rid ? query.eq('id', rid) : query.eq('request_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'AR', title: data.request_number || rn, data, fields: [
          { label: 'Document No', value: data.request_number || rn || '-' },
          { label: 'Type', value: 'Additional Request' },
          { label: 'Status', value: data.status },
          { label: 'Room', value: data.rooms?.room_number || '-' },
          { label: 'Department', value: data.departments?.name || '-' },
          { label: 'Date', value: formatDateSys(data.request_date || data.created_at) },
        ]} : null;
      } else if (rt === 'OPENING_BALANCE') {
        result = { type: 'OB', title: rn || 'Opening Balance', fields: [
          { label: 'Document No', value: rn || '-' },
          { label: 'Type', value: 'Opening Balance' },
          { label: 'Date', value: formatDateSys(movement.created_at, { includeTime: true }) },
        ]};
      } else if (rt === 'TRANSFER' && (rid || rn)) {
        let query = supabase.from('transfers').select('*, source_warehouse:warehouses!transfers_source_warehouse_id_fkey(name), dest_warehouse:warehouses!transfers_destination_warehouse_id_fkey(name)');
        query = rid ? query.eq('id', rid) : query.eq('transfer_number', rn);
        const { data } = await query.single();
        result = data ? { type: 'TR', title: data.transfer_number || rn, data, fields: [
          { label: 'Document No', value: data.transfer_number || rn || '-' },
          { label: 'Status', value: data.status },
          { label: 'From', value: data.source_warehouse?.name || '-' },
          { label: 'To', value: data.dest_warehouse?.name || '-' },
          { label: 'Date', value: formatDateSys(data.transfer_date || data.created_at) },
          { label: 'Notes', value: data.notes || '-' },
        ]} : null;
      } else if ((rt === 'LAUNDRY_SEND' || rt === 'LAUNDRY_RECEIVE') && rid) {
        result = { type: 'LDR', title: rn || rt, fields: [
          { label: 'Document No', value: rn || '-' },
          { label: 'Type', value: rt === 'LAUNDRY_SEND' ? 'Laundry Send' : 'Laundry Receive' },
          { label: 'Date', value: formatDateSys(movement.created_at, { includeTime: true }) },
        ]};
      } else {
        result = { type: rt || 'UNKNOWN', title: rn || rt || 'Document', fields: [
          { label: 'Reference', value: rn || '-' },
          { label: 'Type', value: rt || '-' },
          { label: 'Date', value: formatDateSys(movement.created_at, { includeTime: true }) },
        ]};
      }
    } catch (e) {
      result = { type: rt, title: rn || 'Error', fields: [{ label: 'Error', value: e.message }] };
    }
    setDetail(result);
    setLoading(false);
  }

  if (!movement) return null;

  return (
    <Modal open={true} onClose={onClose} title="Document Detail" size="md">
      <div className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8"><div className="spinner"></div></div>
        ) : detail ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{detail.title}</p>
            {detail.fields.map((f, i) => (
              <div key={i} className="flex justify-between items-start gap-4 py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500 whitespace-nowrap">{f.label}</span>
                <span className="text-sm font-medium text-gray-800 text-right">{f.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-400 py-4">Document not found</p>
        )}
      </div>
    </Modal>
  );
}
