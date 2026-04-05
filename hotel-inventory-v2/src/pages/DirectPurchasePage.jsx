import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDateSys, getLocalDateString } from '../utils/format';
import { checkPeriodLock, getBalanceAfter } from '../utils/stock.js';
import { recordMovement, deleteMovementsByRef } from '../services/stockService.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Badge } from '../components/Badge';
import { StatusBadge } from '../components/StatusBadge';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { TreeSelect } from '../components/TreeSelect';

function DirectPurchasePage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [editingDp, setEditingDp] = useState(null);

  // Form state
  const [purchaseDate, setPurchaseDate] = useState(getLocalDateString());
  const [purchaseLocation, setPurchaseLocation] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [viewDoc, setViewDoc] = useState(null);
  const [viewItems, setViewItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dpCategoryId, setDpCategoryId] = useState('');

  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [dpRes, itemRes, whRes, deptRes, catRes] = await Promise.all([
      supabase.from('direct_purchases')
        .select('*, departments(name, code), direct_purchase_items(*, items(code, name, brand, units:unit_id(abbreviation)))')
        .eq('organization_id', selectedOrg.id)
        .order('created_at', { ascending: false }),
      supabase.from('items').select('id, code, name, brand, category_id, default_warehouse_id, allow_direct_purchase').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('name'),
      supabase.from('warehouses').select('id, code, name').eq('organization_id', selectedOrg.id).eq('is_active', true).order('code'),
      supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
      supabase.from('item_categories').select('id, code, name, parent_id').eq('is_active', true).order('name'),
    ]);
    setPurchases(dpRes.data || []);
    setItems(itemRes.data || []);
    setWarehouses(whRes.data || []);
    setDepartments(deptRes.data || []);
    setCategories(catRes.data || []);
    setLoading(false);
  }

  async function generateNumber() {
    const code = selectedOrg.code || 'ORG';
    const { data } = await supabase.from('direct_purchases').select('purchase_number')
      .eq('organization_id', selectedOrg.id).like('purchase_number', `DP-${code}-%`)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const last = parseInt(data[0].purchase_number.split('-').pop()) || 0;
      next = last + 1;
    }
    return `DP-${code}-${String(next).padStart(4, '0')}`;
  }

  function addItem() {
    setPurchaseItems(prev => [...prev, { item_id: '', quantity: 0, unit_price: 0, warehouse_id: '', notes: '' }]);
  }

  function removeItem(idx) {
    setPurchaseItems(prev => prev.filter((_, i) => i !== idx));
  }

  function updateItem(idx, field, value) {
    setPurchaseItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }

  function openNew() {
    setViewing(null);
    setEditingDp(null);
    setPurchaseDate(getLocalDateString());
    setPurchaseLocation('');
    setDepartmentId(currentUser?.department_id || '');
    setPurchaseItems([{ item_id: '', quantity: 0, unit_price: 0, warehouse_id: '', notes: '' }]);
    setNotes('');
    setDpCategoryId('');
    setShowModal(true);
  }

  function openView(dp) {
    setViewing(dp);
    setViewDoc(dp);
    setViewItems(dp.direct_purchase_items || []);
    setShowModal(true);
  }

  function openEdit(dp) {
    setViewing(null);
    setPurchaseDate(dp.purchase_date || getLocalDateString());
    setPurchaseLocation(dp.purchase_location || '');
    setDepartmentId(dp.department_id || '');
    setNotes(dp.notes || '');
    const dpItems = (dp.direct_purchase_items || []).map(di => ({
      item_id: di.item_id, quantity: di.quantity, unit_price: di.unit_price,
      warehouse_id: di.warehouse_id || '', notes: di.notes || '',
    }));
    setPurchaseItems(dpItems.length > 0 ? dpItems : [{ item_id: '', quantity: 0, unit_price: 0, warehouse_id: '', notes: '' }]);
    setEditingDp(dp);
    setShowModal(true);
  }

  async function handleSave() {
    if (!purchaseLocation.trim()) {
      showNotification(t('dp.locationRequired'), 'error'); return;
    }
    const validItems = purchaseItems.filter(i => i.item_id && parseFloat(i.quantity) > 0);
    if (validItems.length === 0) {
      showNotification(t('dp.addItems'), 'error'); return;
    }
    // Validate warehouse for every item
    for (const item of validItems) {
      if (!item.warehouse_id) {
        const it = items.find(i => i.id === item.item_id);
        showNotification(t('dp.selectWarehouse') + `: ${it?.code || ''}`, 'error'); return;
      }
    }

    setSaving(true);
    try {
      // Validate purchase date
      const inputDate = new Date(purchaseDate);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Purchase date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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

      const totalAmount = validItems.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price)), 0);

      let dpId;
      if (editingDp) {
        // Update existing draft
        const { error: dpErr } = await supabase.from('direct_purchases').update({
          purchase_date: purchaseDate,
          purchase_location: purchaseLocation.trim(),
          department_id: departmentId || null,
          total_amount: totalAmount,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        }).eq('id', editingDp.id);
        if (dpErr) throw dpErr;
        dpId = editingDp.id;
        // Delete old items and re-insert
        await supabase.from('direct_purchase_items').delete().eq('direct_purchase_id', dpId);
      } else {
        // Create new
        const dpNumber = await generateNumber();
        const { data: dp, error: dpErr } = await supabase.from('direct_purchases').insert({
          organization_id: selectedOrg.id,
          purchase_number: dpNumber,
          purchase_date: purchaseDate,
          purchase_location: purchaseLocation.trim(),
          department_id: departmentId || null,
          status: 'DRAFT',
          total_amount: totalAmount,
          notes: notes || null,
        }).select().single();
        if (dpErr) throw dpErr;
        dpId = dp.id;
      }

      const payload = validItems.map(i => ({
        direct_purchase_id: dpId,
        item_id: i.item_id,
        quantity: parseFloat(i.quantity),
        unit_price: parseFloat(i.unit_price),
        total_price: parseFloat(i.quantity) * parseFloat(i.unit_price),
        warehouse_id: i.warehouse_id,
        notes: i.notes || null,
      }));
      const { error: iErr } = await supabase.from('direct_purchase_items').insert(payload);
      if (iErr) throw iErr;

      showNotification(editingDp ? 'Draft updated' : t('dp.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification(t('dp.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function confirmPurchase(dp) {
    if (!(await showConfirm(t('dp.confirmMsg'), { variant: 'warning' }))) return;
    setSaving(true);
    try {
      const dpItems = dp.direct_purchase_items || [];
      if (dpItems.length === 0) throw new Error('No items');

      for (const item of dpItems) {
        const qty = parseFloat(item.quantity);
        if (qty <= 0) continue;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const totalCost = qty * unitPrice;

        // Create stock movement IN via RPC (Fase 6)
        const { error: smErr } = await recordMovement({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          warehouseId: item.warehouse_id || null,
          movementType: 'IN',
          quantity: qty,
          unitCost: unitPrice,
          referenceType: 'DIRECT_PURCHASE',
          referenceNumber: dp.purchase_number,
          referenceId: dp.id,
          departmentId: dp.department_id || null,
          notes: 'Direct purchase from ' + dp.purchase_location,
        });
        if (smErr) throw new Error('Stock movement error: ' + smErr.message);
      }

      await supabase.from('direct_purchases').update({
        status: 'CONFIRMED',
        confirmed_by: currentUser?.id || null,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', dp.id);

      showNotification(t('dp.successConfirm'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function submitForApproval(dp) {
    if (!(await showConfirm('Submit for approval?', { variant: 'warning' }))) return;
    const upd = { status: 'PENDING', submitted_by: currentUser?.id, submitted_at: new Date().toISOString() };
    await supabase.from('direct_purchases').update(upd).eq('id', dp.id);
    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: 'DIRECT_PURCHASE', document_id: dp.id,
      document_number: dp.purchase_number, action: 'SUBMITTED', action_by: currentUser?.id,
    });
    showNotification(dp.purchase_number + ' submitted for approval', 'success');
    setShowModal(false);
    loadAll();
  }

  async function handleRevokeDPConfirmed(dp) {
    const userRole = currentUser?.role?.code || '';
    if (userRole !== 'superadmin' && userRole !== 'gm') {
      showNotification('Hanya GM atau Superadmin yang bisa revoke', 'error'); return;
    }
    // Check period lock
    const lockCheck = await checkPeriodLock(selectedOrg.id, dp.purchase_date || new Date().toISOString());
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot revoke in locked period.', 'error');
      return;
    }
    if (!(await showConfirm(`Revoke ${dp.purchase_number}? Stok akan dikembalikan.`, { variant: 'danger' }))) return;
    setSaving(true);
    try {
      // Delete semua movement DP ini via RPC (trigger auto-revert stock_balance)
      const { error: delErr } = await deleteMovementsByRef({
        organizationId: selectedOrg.id,
        referenceType: 'DIRECT_PURCHASE',
        referenceId: dp.id,
      });
      if (delErr) throw delErr;
      // Update status back to APPROVED
      await supabase.from('direct_purchases').update({
        status: 'APPROVED', confirmed_by: null, confirmed_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', dp.id);
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id, document_type: 'DIRECT_PURCHASE', document_id: dp.id,
        document_number: dp.purchase_number, action: 'REVOKE_CONFIRM', action_by: currentUser?.id,
      });
      showNotification(`${dp.purchase_number} berhasil di-revoke. Stok dikembalikan.`, 'success');
      setShowModal(false);
      loadAll();
    } catch (e) {
      showNotification('Error revoke: ' + e.message, 'error');
    }
    setSaving(false);
  }

  async function handleDelete(dp) {
    if (dp.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + dp.status, 'error'); return; }
    if (!(await showConfirm(t('dp.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('direct_purchase_items').delete().eq('direct_purchase_id', dp.id);
      const { error } = await supabase.from('direct_purchases').delete().eq('id', dp.id);
      if (error) throw error;
      showNotification(t('dp.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  const filtered = useMemo(() => purchases.filter(dp => {
    if (filterStatus && dp.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      return dp.purchase_number?.toLowerCase().includes(s) || dp.purchase_location?.toLowerCase().includes(s);
    }
    return true;
  }), [purchases, filterStatus, search]);

  const isView = !!viewing;
  const isDraft = viewing && viewing.status === 'DRAFT';

  // Get filtered items based on selected category (including all child categories if parent is selected)
  const filteredDpItems = React.useMemo(() => {
    const dpItems = items.filter(it => it.allow_direct_purchase);
    if (!dpCategoryId) return dpItems;
    function getDescendantIds(parentId) {
      const childIds = categories.filter(c => c.parent_id === parentId).map(c => c.id);
      let all = [...childIds];
      childIds.forEach(cid => { all = all.concat(getDescendantIds(cid)); });
      return all;
    }
    const selectedCatIds = [dpCategoryId, ...getDescendantIds(dpCategoryId)];
    return dpItems.filter(i => selectedCatIds.includes(i.category_id));
  }, [dpCategoryId, items, categories]);

  // Set item without auto-setting warehouse (warehouse default: null)
  function handleItemSelect(idx, itemId) {
    setPurchaseItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      item_id: itemId,
    } : item));
  }

  return (
    <div>
      <PageHeader title={t('dp.title')} subtitle={`${t('dp.subtitle')} ${selectedOrg?.name}`}
        actions={<Button onClick={openNew}>{t('dp.create')}</Button>} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <input type="text" placeholder={t('dp.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">{t('common.all')}</option>
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="PENDING">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CONFIRMED">{t('status.confirmed')}</option>
          </select>
        </div>
        <DataTable loading={loading} columns={[
          { header: t('dp.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.purchase_number}</button> },
          { header: t('dp.date'), render: r => formatDateSys(r.purchase_date) },
          { header: t('dp.location'), render: r => r.purchase_location || '-' },
          { header: 'Dept', render: r => r.departments?.code ? <Badge color="blue">{r.departments.code}</Badge> : '-' },
          { header: t('common.status'), render: r => <StatusBadge status={r.status} /> },
          { header: t('dp.grandTotal'), render: r => 'Rp ' + formatNumber(r.total_amount) },
          { header: t('dp.items'), render: r => r.direct_purchase_items?.length || 0 },
          { header: t('common.actions'), render: r => (
            <div className="flex gap-1 items-center">
              <Button size="sm" variant="ghost" onClick={() => openView(r)}>{t('common.view')}</Button>
              {r.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();submitForApproval(r)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">Submit</button>}
              {r.status === 'APPROVED' && <Button size="sm" variant="primary" onClick={() => confirmPurchase(r)} disabled={saving}>{t('dp.confirm')}</Button>}

              {r.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(r)}} className="p-1 text-xs bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100 flex items-center gap-0.5"><Icons.Edit /> Edit</button>}
              {r.status === 'DRAFT' && <button onClick={e => { e.stopPropagation(); handleDelete(r); }} className="p-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-0.5"><Icons.Trash /> Hapus</button>}
            </div>
          )},
        ]} data={filtered} />
        {filtered.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500"><p>{t('dp.empty')}</p></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={isView ? viewing.purchase_number : (editingDp ? 'Edit ' + editingDp.purchase_number : t('dp.create'))} size="xl">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <FormField label={t('dp.date')} required>
                <Input type="date" value={purchaseDate} disabled className="bg-gray-100 cursor-not-allowed" />
              </FormField>
              <FormField label={t('dp.location')} required>
                <Input value={purchaseLocation} onChange={e => setPurchaseLocation(e.target.value)} placeholder={t('dp.locationPlaceholder')} />
              </FormField>
              <FormField label="">
                <div></div>
              </FormField>
              <FormField label={t('dp.notes')}>
                <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('dp.notes')} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <FormField label="Item Category">
                <TreeSelect value={dpCategoryId} onChange={v => setDpCategoryId(v)} categories={categories} placeholder="-- Semua Kategori --" />
              </FormField>
              {dpCategoryId && (
                <div className="flex items-end pb-1">
                  <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <Icons.Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-blue-700">
                      Filter: <strong>{categories.find(c => c.id === dpCategoryId)?.name}</strong>
                      {categories.some(c => c.parent_id === dpCategoryId) ? ' (termasuk semua sub-kategori)' : ''} — {filteredDpItems.length} item tersedia
                    </span>
                    <button onClick={() => setDpCategoryId('')} className="text-blue-400 hover:text-blue-600 text-xs ml-1">&times; Reset</button>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">{t('dp.items')}</h4>
              <Button size="sm" variant="secondary" onClick={addItem}>+ {t('dp.addItem')}</Button>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('dp.selectItem')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">{t('dp.qty')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-32">{t('dp.unitPrice')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-32">{t('dp.totalPrice')}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600 w-40">{t('dp.warehouse')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseItems.map((pi, idx) => {
                    const lineTotal = (parseFloat(pi.quantity) || 0) * (parseFloat(pi.unit_price) || 0);
                    return (
                      <tr key={idx} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <SearchableItemSelect items={filteredDpItems} value={pi.item_id} onChange={v => handleItemSelect(idx, v)} placeholder={t('dp.selectItem')} />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input {...intQtyInputProps} value={pi.quantity} onChange={e => updateItem(idx, 'quantity', toIntQty(e.target.value))}
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-center" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="number" value={pi.unit_price} min="0" onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                            className="w-32 border border-gray-300 rounded px-2 py-1 text-sm text-right" />
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-700">
                          Rp {formatNumber(lineTotal)}
                        </td>
                        <td className="px-3 py-2">
                          <select value={pi.warehouse_id} onChange={e => updateItem(idx, 'warehouse_id', e.target.value)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                            <option value="">{t('dp.selectWarehouse')}</option>
                            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-xs">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan="3" className="px-3 py-2 text-right font-semibold text-gray-700">{t('dp.grandTotal')}</td>
                    <td className="px-3 py-2 text-right font-bold text-primary-700">
                      Rp {formatNumber(purchaseItems.reduce((sum, i) => sum + ((parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price) || 0)), 0))}
                    </td>
                    <td colSpan="2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 bg-gray-50 rounded-lg p-4">
              <div><p className="text-xs text-gray-500">{t('dp.date')}</p><p className="font-medium">{formatDateSys(viewing.purchase_date)}</p></div>
              <div><p className="text-xs text-gray-500">{t('dp.location')}</p><p className="font-medium">{viewing.purchase_location}</p></div>
              <div><p className="text-xs text-gray-500">Department</p><p className="font-medium">{viewing.departments ? `${viewing.departments.code} - ${viewing.departments.name}` : '-'}</p></div>
              <div><p className="text-xs text-gray-500">{t('common.status')}</p><StatusBadge status={viewing.status} /></div>
              <div><p className="text-xs text-gray-500">{t('dp.grandTotal')}</p><p className="font-bold text-primary-700">Rp {formatNumber(viewing.total_amount)}</p></div>
            </div>
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('dp.selectItem')}</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600">{t('dp.qty')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">{t('dp.unitPrice')}</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600">{t('dp.totalPrice')}</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('dp.warehouse')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.direct_purchase_items || []).map((di, idx) => (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <span className="font-medium">{di.items?.name}</span>
                        {di.items?.brand && <span className="text-xs text-gray-400 ml-1">({di.items.brand})</span>}
                        <br/><span className="text-xs text-gray-400">{di.items?.code}</span>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold">{formatNumber(di.quantity)} {di.items?.units?.abbreviation}</td>
                      <td className="px-3 py-2 text-right">Rp {formatNumber(di.unit_price)}</td>
                      <td className="px-3 py-2 text-right font-medium">Rp {formatNumber(di.total_price)}</td>
                      <td className="px-3 py-2 text-sm">{warehouses.find(w => w.id === di.warehouse_id)?.code || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewing.notes && <div className="bg-gray-50 rounded-lg p-3 mb-4"><p className="text-xs text-gray-500 mb-1">{t('dp.notes')}</p><p className="text-sm">{viewing.notes}</p></div>}
          </>
        )}

        <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{isView ? t('common.close') : t('common.cancel')}</Button>
          {!isView && <Button onClick={handleSave} disabled={saving}>{saving ? t('common.saving') : t('dp.saveDraft')}</Button>}
          {isDraft && <button onClick={() => submitForApproval(viewing)} className="px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium">Submit for Approval</button>}
          {isView && viewing.status === 'APPROVED' && <Button variant="primary" onClick={() => confirmPurchase(viewing)} disabled={saving}>{t('dp.confirm')}</Button>}
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// LAUNDRY PAGE
// ============================================================

export default DirectPurchasePage;
