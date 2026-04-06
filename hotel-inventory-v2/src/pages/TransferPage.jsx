import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatNumber, formatDate, formatDateSys, getLocalDateString } from '../utils/format.js';
import { recordTransfer } from '../services/stockService.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { FormField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { Tab } from '../components/Tab';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function TransferPage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState([]);
  const [items, setItems] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Form state
  const [fromWarehouse, setFromWarehouse] = useState('');
  const [toWarehouse, setToWarehouse] = useState('');
  const [transferDate, setTransferDate] = useState(getLocalDateString());
  const [transferItems, setTransferItems] = useState([]);
  const [notes, setNotes] = useState('');

  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [trRes, whRes, itemRes] = await Promise.all([
      supabase.from('transfers')
        .select('*, transfer_items(*, items(code, name, brand, units:unit_id(abbreviation)))')
        .eq('organization_id', selectedOrg.id)
        .order('created_at', { ascending: false }),
      supabase.from('warehouses').select('id, code, name, warehouse_type').eq('organization_id', selectedOrg.id).eq('is_active', true).order('code'),
      supabase.from('items').select('id, code, name, brand').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('name'),
    ]);
    setTransfers(trRes.data || []);
    setWarehouses(whRes.data || []);
    setItems(itemRes.data || []);
    setLoading(false);
  }

  async function generateNumber() {
    const code = selectedOrg.code || 'ORG';
    const { data } = await supabase.from('transfers').select('transfer_number')
      .eq('organization_id', selectedOrg.id).like('transfer_number', `TR-${code}-%`)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const last = parseInt(data[0].transfer_number.split('-').pop()) || 0;
      next = last + 1;
    }
    return `TR-${code}-${String(next).padStart(4, '0')}`;
  }

  function addItem() {
    setTransferItems(prev => [...prev, { item_id: '', quantity: 0, notes: '' }]);
  }

  function removeItem(idx) {
    setTransferItems(prev => prev.filter((_, i) => i !== idx));
  }

  function updateTransferItem(idx, field, value) {
    setTransferItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function openNew() {
    setViewing(null);
    setFromWarehouse('');
    setToWarehouse('');
    setTransferDate(getLocalDateString());
    setTransferItems([{ item_id: '', quantity: 0, notes: '' }]);
    setNotes('');
    setShowModal(true);
  }

  function openView(tr) {
    setViewing(tr);
    setShowModal(true);
  }

  async function handleSave() {
    if (!fromWarehouse || !toWarehouse) {
      showNotification(t('transfer.selectWarehouses'), 'error'); return;
    }
    if (fromWarehouse === toWarehouse) {
      showNotification(t('transfer.sameWarehouse'), 'error'); return;
    }
    const validItems = transferItems.filter(i => i.item_id && parseFloat(i.quantity) > 0);
    if (validItems.length === 0) {
      showNotification(t('transfer.addItems'), 'error'); return;
    }
    setSaving(true);
    try {
      // Validate transfer date
      const inputDate = new Date(transferDate);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Transfer date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
        setSaving(false);
        return;
      }

      // Check if period is locked
      const periodMonth = inputDate.getMonth() + 1;
      const periodYear = inputDate.getFullYear();
      const { data: locks } = await supabase.from('period_locks')
        .select('*')
        .eq('organization_id', selectedOrg.id)
        .eq('period_month', periodMonth)
        .eq('period_year', periodYear)
        .eq('is_locked', true)
        .single();
      if (locks) {
        showNotification('Period is locked', 'error');
        setSaving(false);
        return;
      }

      // Validate In-Use Warehouse: cannot transfer same item if it still has stock there
      const destWh = warehouses.find(w => w.id === toWarehouse);
      if (destWh && destWh.warehouse_type === 'in_use') {
        const itemIds = validItems.map(i => i.item_id);
        const { data: existingStock } = await supabase.from('stock_balance')
          .select('item_id, quantity, items:item_id(name)')
          .eq('warehouse_id', toWarehouse)
          .gt('quantity', 0)
          .in('item_id', itemIds);
        if (existingStock && existingStock.length > 0) {
          const names = existingStock.map(s => s.items?.name || 'Unknown').join(', ');
          showNotification(`Item masih ada di In-Use Warehouse (harus ditandai habis dulu): ${names}`, 'error');
          setSaving(false);
          return;
        }
      }

      const trNumber = await generateNumber();
      const { data: tr, error: trErr } = await supabase.from('transfers').insert({
        organization_id: selectedOrg.id,
        transfer_number: trNumber,
        transfer_date: transferDate,
        from_warehouse_id: fromWarehouse,
        to_warehouse_id: toWarehouse,
        status: 'DRAFT',
        notes,
      }).select().single();
      if (trErr) throw trErr;

      const payload = validItems.map(i => ({
        transfer_id: tr.id,
        item_id: i.item_id,
        quantity: parseFloat(i.quantity),
        notes: i.notes,
      }));
      const { error: iErr } = await supabase.from('transfer_items').insert(payload);
      if (iErr) throw iErr;

      showNotification(t('transfer.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification(t('transfer.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function confirmTransfer(tr) {
    if (!(await showConfirm(t('transfer.confirmMsg'), { variant: 'warning' }))) return;
    setSaving(true);
    try {
      const trItems = tr.transfer_items || [];
      if (trItems.length === 0) throw new Error('No items');

      // ====== PRE-VALIDATION: cek semua stok source warehouse SEBELUM create movement ======
      const insufficientItems = [];
      for (const item of trItems) {
        const qty = parseFloat(item.quantity);
        if (qty <= 0) continue;
        const { data: sb } = await supabase.from('stock_balance')
          .select('quantity')
          .eq('organization_id', selectedOrg.id)
          .eq('item_id', item.item_id)
          .eq('warehouse_id', tr.from_warehouse_id)
          .maybeSingle();
        const currentQty = sb ? parseFloat(sb.quantity) || 0 : 0;
        if (currentQty < qty) {
          const itemName = item.items?.code ? `${item.items.code} - ${item.items.name}` : (item.items?.name || item.item_id);
          insufficientItems.push(`${itemName}: saldo=${currentQty}, diminta=${qty}`);
        }
      }
      if (insufficientItems.length > 0) {
        const srcWh = warehouses.find(w => w.id === tr.from_warehouse_id);
        showNotification(`Stok tidak cukup di [${srcWh?.code || ''} - ${srcWh?.name || ''}]:\n${insufficientItems.join('\n')}`, 'error');
        setSaving(false);
        return;
      }

      // ====== SEMUA STOK CUKUP — Proses movements ======
      const attemptStartedAt = new Date().toISOString();
      for (const item of trItems) {
        const qty = parseFloat(item.quantity);
        if (qty <= 0) continue;

        const { error: transferErr } = await recordTransfer({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          sourceWarehouseId: tr.from_warehouse_id,
          destWarehouseId: tr.to_warehouse_id,
          quantity: qty,
          referenceType: 'TRANSFER',
          referenceNumber: tr.transfer_number,
          referenceId: tr.id,
          unitCost: null,
          departmentId: currentUser?.department_id || null,
          notes: `Transfer ${warehouses.find(w => w.id === tr.from_warehouse_id)?.code || ''} → ${warehouses.find(w => w.id === tr.to_warehouse_id)?.code || ''}`,
        });
        if (transferErr) throw new Error('Transfer movement: ' + transferErr.message);
      }

      await supabase.from('transfers').update({
        status: 'CONFIRMED',
        updated_at: new Date().toISOString(),
      }).eq('id', tr.id);

      showNotification(t('transfer.successConfirm'));
      setShowModal(false);
      loadAll();
    } catch (err) {
      // Rollback: hapus movements yang sudah ter-insert
      try {
        const { data: orphaned } = await supabase.from('stock_movements')
          .select('id').eq('reference_number', tr.transfer_number).gte('created_at', attemptStartedAt);
        if (orphaned && orphaned.length > 0) {
          await supabase.from('stock_movements').delete().in('id', orphaned.map(o => o.id));
        }
      } catch (cleanupErr) { console.error('[transfer confirm rollback]', cleanupErr); }
      showNotification('Error: ' + err.message + '. Movements sudah di-rollback.', 'error');
    }
    setSaving(false);
  }

  async function revokeTransfer(tr) {
    if (tr.status !== 'CONFIRMED') return;
    if (!(await showConfirm('Revoke transfer ' + tr.transfer_number + '?\n\nStock movement akan dibalik dan item dikembalikan ke warehouse asal.', { variant: 'danger' }))) return;
    setSaving(true);
    try {
      const trItems = tr.transfer_items || [];
      for (const item of trItems) {
        const qty = parseFloat(item.quantity);
        if (qty <= 0) continue;

        // Get unit_cost from original OUT movement
        const { data: origOut } = await supabase.from('stock_movements')
          .select('unit_cost')
          .eq('reference_number', tr.transfer_number)
          .eq('reference_type', 'TRANSFER')
          .eq('item_id', item.item_id)
          .eq('movement_type', 'OUT')
          .limit(1).maybeSingle();
        const unitCost = origOut ? parseFloat(origOut.unit_cost) || 0 : 0;
        const totalCost = qty * unitCost;

        // Check destination warehouse still has stock to reverse
        const { data: destBal } = await supabase.from('stock_balance')
          .select('quantity').eq('organization_id', selectedOrg.id).eq('item_id', item.item_id).eq('warehouse_id', tr.to_warehouse_id).maybeSingle();
        if (!destBal || parseFloat(destBal.quantity) < qty) {
          const itemName = item.items?.name || 'Unknown';
          showNotification('Tidak bisa revoke. Stock ' + itemName + ' di warehouse tujuan tidak cukup (qty: ' + (destBal?.quantity || 0) + ', dibutuhkan: ' + qty + ')', 'error');
          setSaving(false); return;
        }

        // Reverse atomic: OUT from dest + IN back to source via RPC (Fase 6)
        const { error: revErr } = await recordTransfer({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          sourceWarehouseId: tr.to_warehouse_id,
          destWarehouseId: tr.from_warehouse_id,
          quantity: qty,
          referenceType: 'TRANSFER-REV',
          referenceNumber: tr.transfer_number,
          referenceId: tr.id,
          unitCost: unitCost,
          departmentId: currentUser?.department_id || null,
          notes: 'Revoke: return ' + (warehouses.find(w => w.id === tr.to_warehouse_id)?.code || '') + ' → ' + (warehouses.find(w => w.id === tr.from_warehouse_id)?.code || ''),
        });
        if (revErr) throw new Error('Revoke movement: ' + revErr.message);
      }

      await supabase.from('transfers').update({
        status: 'REVOKED', updated_at: new Date().toISOString(),
      }).eq('id', tr.id);

      showNotification(tr.transfer_number + ' berhasil di-revoke.', 'success');
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  const filtered = transfers.filter(tr => {
    if (filterStatus && tr.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      return tr.transfer_number?.toLowerCase().includes(s);
    }
    return true;
  });

  const isView = !!viewing;
  const isDraft = viewing && viewing.status === 'DRAFT';

  return (
    <div>
      <PageHeader title={t('transfer.title')} subtitle={`${t('transfer.subtitle')} ${selectedOrg?.name}`}
        actions={<Button onClick={openNew}>{t('transfer.newTransfer')}</Button>} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <input type="text" placeholder={t('transfer.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">{t('common.all')}</option>
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="REVOKED">Revoked</option>
          </select>
        </div>
        <DataTable loading={loading} columns={[
          { header: t('transfer.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.transfer_number}</button> },
          { header: t('common.date'), render: r => formatDateSys(r.transfer_date) },
          { header: t('transfer.from'), render: r => <Badge color="red">{warehouses.find(w => w.id === r.from_warehouse_id)?.code || '-'}</Badge> },
          { header: t('transfer.to'), render: r => <Badge color="green">{warehouses.find(w => w.id === r.to_warehouse_id)?.code || '-'}</Badge> },
          { header: t('common.status'), render: r => <StatusBadge status={r.status} /> },
          { header: t('makeup.itemCount'), render: r => r.transfer_items?.length || 0 },
          { header: t('common.actions'), render: r => (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => openView(r)}>View</Button>
              {r.status === 'DRAFT' && <Button size="sm" variant="primary" onClick={() => confirmTransfer(r)} disabled={saving}>{t('transfer.confirm')}</Button>}
              {r.status === 'CONFIRMED' && <button onClick={() => revokeTransfer(r)} disabled={saving} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-orange-50 text-orange-600 rounded hover:bg-orange-100 disabled:opacity-50"><Icons.RotateCcw /> Revoke</button>}
            </div>
          )},
        ]} data={filtered} />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={isView ? viewing.transfer_number : t('transfer.newTransfer')} size="xl">
        {!isView ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <FormField label="User">
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                  {currentUser?.full_name || currentUser?.username || '-'}
                </div>
              </FormField>
              <FormField label="Department">
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                  {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
                </div>
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <FormField label={t('transfer.from')} required>
                <Select value={fromWarehouse} onChange={e => setFromWarehouse(e.target.value)}>
                  <option value="">{t('transfer.selectWarehouse')}</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </Select>
              </FormField>
              <FormField label={t('transfer.to')} required>
                <Select value={toWarehouse} onChange={e => setToWarehouse(e.target.value)}>
                  <option value="">{t('transfer.selectWarehouse')}</option>
                  {warehouses.filter(w => w.id !== fromWarehouse).map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </Select>
              </FormField>
              <FormField label={t('common.date')} required>
                <Input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)} />
              </FormField>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">{t('transfer.items')}</h4>
              <Button size="sm" variant="secondary" onClick={addItem}>+ {t('transfer.addItem')}</Button>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('dashboard.item')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">{t('dashboard.qty')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {transferItems.map((ti, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <select value={ti.item_id} onChange={e => updateTransferItem(idx, 'item_id', e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                          <option value="">{t('transfer.selectItem')}</option>
                          {items.map(it => <option key={it.id} value={it.id}>{it.code} - {it.name}{it.brand ? ` (${it.brand})` : ''}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input {...intQtyInputProps} value={ti.quantity} onChange={e => updateTransferItem(idx, 'quantity', toIntQty(e.target.value))}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-center" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-xs">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <FormField label={t('transfer.notes')}>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </FormField>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 bg-gray-50 rounded-lg p-4">
              <div><p className="text-xs text-gray-500">{t('common.date')}</p><p className="font-medium">{formatDateSys(viewing.transfer_date)}</p></div>
              <div><p className="text-xs text-gray-500">{t('transfer.from')}</p><Badge color="red">{warehouses.find(w => w.id === viewing.from_warehouse_id)?.code}</Badge></div>
              <div><p className="text-xs text-gray-500">{t('transfer.to')}</p><Badge color="green">{warehouses.find(w => w.id === viewing.to_warehouse_id)?.code}</Badge></div>
              <div><p className="text-xs text-gray-500">{t('common.status')}</p><StatusBadge status={viewing.status} /></div>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('dashboard.item')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600">{t('dashboard.qty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.transfer_items || []).map((ti, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <span className="font-medium">{ti.items?.name}</span>
                        {ti.items?.brand && <span className="text-xs text-gray-400 ml-1">({ti.items.brand})</span>}
                        <br/><span className="text-xs text-gray-400">{ti.items?.code}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{formatNumber(ti.quantity)} {ti.items?.units?.abbreviation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewing.notes && <div className="bg-gray-50 rounded-lg p-3 mb-4"><p className="text-xs text-gray-500 mb-1">{t('transfer.notes')}</p><p className="text-sm">{viewing.notes}</p></div>}
          </>
        )}

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{isView ? t('common.close') : t('common.cancel')}</Button>
          {!isView && <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : t('transfer.saveDraft')}</Button>}
          {isDraft && <Button variant="primary" onClick={() => confirmTransfer(viewing)} disabled={saving}>{t('transfer.confirm')}</Button>}
          {viewing && viewing.status === 'CONFIRMED' && <button onClick={() => revokeTransfer(viewing)} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 disabled:opacity-50"><Icons.RotateCcw /> Revoke</button>}
        </div>
      </Modal>
    </div>
  );
}

export default TransferPage;
