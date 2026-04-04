import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatDate, formatDateSys, getLocalDateString } from '../utils/format.js';
import { getBalanceAfter } from '../utils/stock.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { PageLoader } from '../components/PageLoader';

function SingleItemUsagePage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [form, setForm] = useState({ usage_date: getLocalDateString(), item_id: '', warehouse_id: '', department_id: '', quantity: 1, notes: '' });
  const [saving, setSaving] = useState(false);

  const userRole = currentUser?.role?.code || '';

  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    try {
      const [recRes, itemRes, whRes, deptRes] = await Promise.all([
        supabase.from('single_item_usage').select('*, items:item_id(code, name, brand), warehouses:warehouse_id(code, name), departments:department_id(code, name)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
        supabase.from('items').select('id, code, name, brand, allow_single_usage').eq('organization_id', selectedOrg?.id).eq('is_active', true).eq('allow_single_usage', true).order('name'),
        supabase.from('warehouses').select('id, code, name, warehouse_type').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
        supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
      ]);
      setRecords(recRes.data || []);
      setItems(itemRes.data || []);
      setWarehouses((whRes.data || []).filter(w => w.warehouse_type === 'store'));
      setDepartments(deptRes.data || []);
    } catch (e) { }
    setLoading(false);
  }

  async function generateNumber() {
    const { count } = await supabase.from('single_item_usage').select('*', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id);
    const seq = String((count || 0) + 1).padStart(4, '0');
    return `SIU-${selectedOrg.code}-${seq}`;
  }

  function openCreate() {
    setEditingId(null);
    setForm({ usage_date: getLocalDateString(), item_id: '', warehouse_id: '', department_id: currentUser?.department_id || '', quantity: 1, notes: '' });
    setShowModal(true);
  }

  function openEdit(record) {
    setEditingId(record.id);
    setForm({
      usage_date: record.usage_date,
      item_id: record.item_id,
      warehouse_id: record.warehouse_id,
      department_id: record.department_id,
      quantity: record.quantity,
      notes: record.notes || '',
    });
    setShowModal(true);
  }

  // Save as DRAFT (no stock deduction)
  async function handleSaveDraft() {
    if (!form.item_id) return showNotification(t('siu.itemRequired'), 'error');
    if (!form.warehouse_id) return showNotification(t('siu.warehouseRequired'), 'error');
    if (!form.department_id) return showNotification(t('siu.departmentRequired'), 'error');
    if (parseFloat(form.quantity) <= 0 || parseFloat(form.quantity) > 1) return showNotification(t('siu.qtyMax1'), 'error');

    setSaving(true);
    try {
      // Validate usage date
      const inputDate = new Date(form.usage_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Tanggal melebihi batas backdate (' + maxBackdateDays + ' hari)', 'error');
        setSaving(false);
        return;
      }

      // Check period lock
      const lockCheck = await checkPeriodLock(selectedOrg.id, form.usage_date);
      if (lockCheck.locked) {
        showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
        setSaving(false);
        return;
      }

      const qty = parseFloat(form.quantity);

      if (editingId) {
        // Update existing DRAFT
        const { error } = await supabase.from('single_item_usage').update({
          usage_date: form.usage_date,
          item_id: form.item_id,
          quantity: qty,
          warehouse_id: form.warehouse_id,
          department_id: form.department_id,
          notes: form.notes || null,
        }).eq('id', editingId);
        if (error) throw error;
        showNotification('SIU berhasil diupdate', 'success');
      } else {
        // Create new DRAFT
        const usageNumber = await generateNumber();
        const { error } = await supabase.from('single_item_usage').insert({
          organization_id: selectedOrg.id,
          usage_number: usageNumber,
          usage_date: form.usage_date,
          item_id: form.item_id,
          quantity: qty,
          warehouse_id: form.warehouse_id,
          department_id: form.department_id,
          notes: form.notes || null,
          created_by: currentUser?.id || null,
          status: 'DRAFT',
        });
        if (error) throw error;
        showNotification('SIU berhasil disimpan sebagai DRAFT', 'success');
      }

      setShowModal(false);
      setEditingId(null);
      loadAll();
    } catch (e) {
      showNotification('Error: ' + e.message, 'error');
    }
    setSaving(false);
  }

  // Confirm DRAFT → CONFIRMED (deduct stock)
  async function handleConfirmSIU(record) {
    if (!(await showConfirm(`Konfirmasi ${record.usage_number}? Stok akan dikurangi.`, { variant: 'warning' }))) return;
    setSaving(true);
    try {
      // Check if period is locked
      const inputDate = new Date(record.usage_date);
      const periodMonth = inputDate.getMonth() + 1;
      const periodYear = inputDate.getFullYear();
      const { data: locks } = await supabase.from('period_locks')
        .select('*').eq('organization_id', selectedOrg.id)
        .eq('period_month', periodMonth).eq('period_year', periodYear)
        .eq('is_locked', true).single();
      if (locks) { showNotification('Periode sudah dikunci', 'error'); setSaving(false); return; }

      // Check stock
      const { data: stockData } = await supabase.from('stock_balance').select('quantity, avg_cost, total_value').eq('item_id', record.item_id).eq('warehouse_id', record.warehouse_id).single();
      const qty = parseFloat(record.quantity);
      if (!stockData || stockData.quantity < qty) {
        showNotification('Stok tidak mencukupi!', 'error'); setSaving(false); return;
      }
      const avgCost = parseFloat(stockData.avg_cost) || 0;

      // Update status to CONFIRMED
      const { error: updErr } = await supabase.from('single_item_usage').update({
        status: 'CONFIRMED',
        confirmed_by: currentUser?.id || null,
        confirmed_at: new Date().toISOString(),
      }).eq('id', record.id);
      if (updErr) throw updErr;

      // Stock movement OUT
      const deptName = record.departments?.name || '';
      const siuBalAfter = await getBalanceAfter(selectedOrg.id, record.item_id, 'OUT', qty);
      await supabase.from('stock_movements').insert({
        organization_id: selectedOrg.id,
        item_id: record.item_id,
        warehouse_id: record.warehouse_id,
        department_id: record.department_id || null,
        movement_type: 'OUT',
        quantity: qty,
        unit_cost: avgCost,
        total_cost: qty * avgCost,
        balance_after: siuBalAfter,
        reference_type: 'USAGE',
        reference_id: record.id,
        reference_number: record.usage_number,
        notes: `Single usage: ${record.usage_number} - Dept: ${deptName}`,
        created_by: currentUser?.id || null,
      });

      // Update stock_balance manually after OUT (single usage)
      {
        const { data: _sbSIU } = await supabase.from('stock_balance')
          .select('id, quantity, avg_cost, total_value')
          .eq('organization_id', selectedOrg.id).eq('item_id', record.item_id).eq('warehouse_id', record.warehouse_id).maybeSingle();
        if (_sbSIU) {
          const _newQtySIU = Math.max(0, (parseFloat(_sbSIU.quantity) || 0) - qty);
          const _avgCostSIU = parseFloat(_sbSIU.avg_cost) || 0;
          await supabase.from('stock_balance').update({ quantity: _newQtySIU, total_value: _newQtySIU * _avgCostSIU, avg_cost: _newQtySIU > 0 ? _avgCostSIU : 0, last_movement_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', _sbSIU.id);
        }
      }

      showNotification(`${record.usage_number} berhasil dikonfirmasi. Stok berkurang ${qty}.`, 'success');
      loadAll();
    } catch (e) {
      showNotification('Error konfirmasi: ' + e.message, 'error');
    }
    setSaving(false);
  }

  // Revoke CONFIRMED → DRAFT (reverse stock) - GM/Superadmin only
  async function handleRevokeSIU(record) {
    if (userRole !== 'superadmin' && userRole !== 'gm') {
      showNotification('Hanya GM atau Superadmin yang bisa revoke', 'error'); return;
    }
    // Check period lock
    const lockCheck = await checkPeriodLock(selectedOrg.id, record.usage_date || new Date().toISOString());
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot revoke in locked period.', 'error');
      return;
    }
    if (!(await showConfirm(`Revoke ${record.usage_number}? Stok akan dikembalikan.`, { variant: 'danger' }))) return;
    setSaving(true);
    try {
      const qty = parseFloat(record.quantity);

      // Hapus stock movement asli SIU dari bincard
      // stock_balance will be automatically recalculated by DB trigger (trg_sync_stock_balance) on DELETE
      await supabase.from('stock_movements').delete()
        .eq('reference_type', 'USAGE')
        .eq('reference_id', record.id);

      // Update status back to DRAFT
      const { error: updErr } = await supabase.from('single_item_usage').update({
        status: 'DRAFT',
        confirmed_by: null,
        confirmed_at: null,
      }).eq('id', record.id);
      if (updErr) throw updErr;

      showNotification(`${record.usage_number} berhasil di-revoke. Stok dikembalikan +${qty}.`, 'success');
      loadAll();
    } catch (e) {
      showNotification('Error revoke: ' + e.message, 'error');
    }
    setSaving(false);
  }

  // Delete DRAFT
  async function handleDeleteSIU(record) {
    if (!(await showConfirm(`Hapus ${record.usage_number}?`, { variant: 'danger' }))) return;
    try {
      await supabase.from('single_item_usage').delete().eq('id', record.id);
      showNotification(`${record.usage_number} dihapus`, 'success');
      loadAll();
    } catch (e) {
      showNotification('Error: ' + e.message, 'error');
    }
  }

  const filtered = records.filter(r => {
    const txt = search.toLowerCase();
    const matchTxt = !txt || r.usage_number?.toLowerCase().includes(txt) || r.items?.name?.toLowerCase().includes(txt) || r.departments?.name?.toLowerCase().includes(txt);
    const matchStatus = !filterStatus || r.status === filterStatus;
    return matchTxt && matchStatus;
  });

  const statusCounts = {
    all: records.length,
    DRAFT: records.filter(r => r.status === 'DRAFT').length,
    CONFIRMED: records.filter(r => r.status === 'CONFIRMED').length,
  };

  return (
    <div className="fade-in">
      <PageHeader title={t('siu.title')} subtitle={`${t('siu.subtitle')} ${selectedOrg?.name || ''}`} actions={
        <Button onClick={openCreate}><Icons.Plus /> {t('siu.create')}</Button>
      } />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input placeholder={t('siu.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
        <div className="flex gap-1">
          <button onClick={() => setFilterStatus('')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${!filterStatus ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Semua ({statusCounts.all})
          </button>
          <button onClick={() => setFilterStatus('DRAFT')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterStatus === 'DRAFT' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Draft ({statusCounts.DRAFT})
          </button>
          <button onClick={() => setFilterStatus('CONFIRMED')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${filterStatus === 'CONFIRMED' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Confirmed ({statusCounts.CONFIRMED})
          </button>
        </div>
      </div>

      {loading ? <PageLoader /> :
       filtered.length === 0 ? <div className="text-center py-12 text-gray-500">{t('siu.empty')}</div> :
       <div className="bg-white rounded-lg shadow overflow-hidden">
         <table className="min-w-full divide-y divide-gray-200">
           <thead className="bg-gray-50">
             <tr>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.number')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.date')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.item')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.qty')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.warehouse')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('siu.department')}</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
               <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
             </tr>
           </thead>
           <tbody className="divide-y divide-gray-200">
             {filtered.map(r => (
               <tr key={r.id} className="hover:bg-gray-50">
                 <td className="px-4 py-3 text-sm font-medium text-blue-600"><button onClick={() => setViewRecord(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.usage_number}</button></td>
                 <td className="px-4 py-3 text-sm text-gray-600">{r.usage_date}</td>
                 <td className="px-4 py-3 text-sm">{r.items?.name} {r.items?.brand ? `(${r.items.brand})` : ''}</td>
                 <td className="px-4 py-3 text-sm">{r.quantity}</td>
                 <td className="px-4 py-3 text-sm">{r.warehouses?.name || '-'}</td>
                 <td className="px-4 py-3 text-sm">{r.departments?.name || '-'}</td>
                 <td className="px-4 py-3 text-sm">
                   <Badge color={r.status === 'CONFIRMED' ? 'green' : 'yellow'}>{r.status || 'DRAFT'}</Badge>
                 </td>
                 <td className="px-4 py-3 text-sm">
                   <div className="flex items-center gap-1">
                     <button onClick={() => setViewRecord(r)} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
                       <Icons.Eye /> Detail
                     </button>
                     {r.status === 'DRAFT' && r.created_by === currentUser?.id && (
                       <button onClick={() => openEdit(r)} className="p-1 text-xs bg-yellow-50 text-yellow-600 rounded hover:bg-yellow-100">
                         <Icons.Edit /> Edit
                       </button>
                     )}
                     {r.status === 'DRAFT' && (
                       <button onClick={() => handleConfirmSIU(r)} className="p-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100" disabled={saving}>
                         <Icons.Check /> Confirm
                       </button>
                     )}
                     {r.status === 'DRAFT' && r.created_by === currentUser?.id && (
                       <button onClick={() => handleDeleteSIU(r)} className="p-1 text-xs bg-red-50 text-red-400 rounded hover:bg-red-100">
                         <Icons.Trash />
                       </button>
                     )}
                     {r.status === 'CONFIRMED' && (userRole === 'superadmin' || userRole === 'gm') && (
                       <button onClick={() => handleRevokeSIU(r)} className="p-1 text-xs bg-orange-50 text-orange-600 rounded hover:bg-orange-100" disabled={saving}>
                         <Icons.RotateCcw /> Revoke
                       </button>
                     )}
                   </div>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
      }

      {/* View Detail Modal */}
      <Modal open={!!viewRecord} onClose={() => setViewRecord(null)} title={`Detail SIU - ${viewRecord?.usage_number || ''}`} size="md">
        {viewRecord && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div><span className="text-xs text-gray-500">Nomor</span><div className="font-medium">{viewRecord.usage_number}</div></div>
              <div><span className="text-xs text-gray-500">Tanggal</span><div>{viewRecord.usage_date}</div></div>
              <div><span className="text-xs text-gray-500">Status</span><div><Badge color={viewRecord.status === 'CONFIRMED' ? 'green' : 'yellow'}>{viewRecord.status || 'DRAFT'}</Badge></div></div>
              <div><span className="text-xs text-gray-500">Item</span><div>{viewRecord.items?.code} - {viewRecord.items?.name}</div></div>
              <div><span className="text-xs text-gray-500">Qty</span><div>{viewRecord.quantity}</div></div>
              <div><span className="text-xs text-gray-500">Warehouse</span><div>{viewRecord.warehouses?.code} - {viewRecord.warehouses?.name}</div></div>
              <div><span className="text-xs text-gray-500">Department</span><div>{viewRecord.departments?.code} - {viewRecord.departments?.name}</div></div>
              <div><span className="text-xs text-gray-500">Notes</span><div>{viewRecord.notes || '-'}</div></div>
            </div>
            {viewRecord.status === 'CONFIRMED' && viewRecord.confirmed_at && (
              <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                Dikonfirmasi pada: {formatDateSys(viewRecord.confirmed_at, { includeTime: true })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditingId(null); }} title={editingId ? 'Edit SIU' : t('siu.create')} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="User">
              <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                {currentUser?.full_name || currentUser?.username || '-'}
              </div>
            </FormField>
            <FormField label={t('siu.department')} required>
              <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
              </div>
            </FormField>
          </div>
          <FormField label={t('siu.date')} required>
            <Input type="date" value={form.usage_date} onChange={e => setForm({...form, usage_date: e.target.value})} />
          </FormField>
          <FormField label={t('siu.warehouse')} required>
            <Select value={form.warehouse_id} onChange={e => setForm({...form, warehouse_id: e.target.value})}>
              <option value="">{t('siu.selectWarehouse')}</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('siu.item')} required>
            <Select value={form.item_id} onChange={e => setForm({...form, item_id: e.target.value})}>
              <option value="">{t('siu.selectItem')}</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.code} - {i.name} {i.brand ? `(${i.brand})` : ''}</option>)}
            </Select>
          </FormField>
          <FormField label={`${t('siu.qty')} (max: 1)`} required>
            <Input type="number" min="0.01" max="1" step="0.01" value={form.quantity} onChange={e => setForm({...form, quantity: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0))})} />
          </FormField>
          <FormField label={t('siu.notes')}>
            <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder={t('siu.notes')} />
          </FormField>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="secondary" onClick={() => { setShowModal(false); setEditingId(null); }}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveDraft} disabled={saving}>{saving ? t('common.saving') : (editingId ? 'Update Draft' : 'Save as Draft')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default SingleItemUsagePage;
