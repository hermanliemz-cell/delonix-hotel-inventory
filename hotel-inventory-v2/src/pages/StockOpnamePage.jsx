import React, {useState, useEffect} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatDate, formatDateSys, getLocalDateString } from '../utils/format';
import { checkPeriodLock } from '../utils/stock.js';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { TreeSelect } from '../components/TreeSelect';

function StockOpnamePage() {
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const { t } = useTranslation();
  const [opnames, setOpnames] = useState([]);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCountingModal, setShowCountingModal] = useState(false);
  const [countingOpname, setCountingOpname] = useState(null);
  const [countingDetails, setCountingDetails] = useState([]);
  const [saving, setSaving] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState({
    category_id: '',
    assigned_to: '',
    opname_date: getLocalDateString(),
    notes: ''
  });
  const [selectedItems, setSelectedItems] = useState([]);
  const [categoryItems, setCategoryItems] = useState([]);

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    try {
      const [opRes, catRes, itemRes, usrRes, deptRes] = await Promise.all([
        supabase.from('stock_opname').select('*').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
        supabase.from('item_categories').select('*').eq('is_active', true).order('name'),
        supabase.from('items').select('*').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
        supabase.from('users').select('*, roles:role_id(code, name)').eq('is_active', true).order('full_name'),
        supabase.from('departments').select('*').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      ]);
      setOpnames(opRes.data || []);
      setCategories(catRes.data || []);
      setItems(itemRes.data || []);
      setUsers(usrRes.data || []);
      setDepartments(deptRes.data || []);
    } catch (err) {
      showNotification('Error loading data: ' + err.message, 'error');
    }
    setLoading(false);
  }

  function canCreate() {
    return ['superadmin', 'gm', 'findir'].includes(currentUser?.role?.code);
  }

  function canStartCounting(opname) {
    return currentUser?.id === opname.assigned_to && opname.status === 'PENDING';
  }

  function canFillAndSubmit(opname) {
    return currentUser?.id === opname.assigned_to && opname.status === 'COUNTING';
  }

  function canDelete(opname) {
    return canCreate() && opname.status === 'PENDING';
  }

  function openCreateModal() {
    setCreateForm({
      category_id: '',
      assigned_to: '',
      opname_date: getLocalDateString(),
      notes: ''
    });
    setSelectedItems([]);
    setCategoryItems([]);
    setShowCreateModal(true);
  }

  function handleCategoryChange(catId) {
    setCreateForm({ ...createForm, category_id: catId });
    if (catId) {
      const filtered = items.filter(i => i.category_id === catId);
      setCategoryItems(filtered);
      setSelectedItems([]);
    } else {
      setCategoryItems([]);
      setSelectedItems([]);
    }
  }

  function toggleItem(itemId) {
    setSelectedItems(prev =>
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    );
  }

  function selectAllItems() {
    if (selectedItems.length === categoryItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(categoryItems.map(i => i.id));
    }
  }

  async function generateOpnameNumber() {
    const prefix = `OPN-${selectedOrg.code}-`;
    const { data } = await supabase.from('stock_opname').select('opname_number').eq('organization_id', selectedOrg.id).like('opname_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].opname_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleCreateOpname() {
    if (!createForm.category_id || !createForm.assigned_to || selectedItems.length === 0) {
      showNotification('Please fill all required fields and select items', 'error');
      return;
    }
    setSaving(true);
    try {
      // Validate date
      const inputDate = new Date(createForm.opname_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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

      // Get stock balances for selected items
      const { data: balances } = await supabase.from('stock_balances').select('*').eq('organization_id', selectedOrg.id).in('item_id', selectedItems);
      const balMap = {};
      (balances || []).forEach(b => { balMap[b.item_id] = b; });

      // Create stock_opname record
      const opnameNumber = await generateOpnameNumber();
      const { data: newOpname, error: opError } = await supabase.from('stock_opname').insert({
        opname_number: opnameNumber,
        organization_id: selectedOrg.id,
        category_id: createForm.category_id,
        assigned_to: createForm.assigned_to,
        assigned_by: currentUser.id,
        opname_date: createForm.opname_date,
        status: 'PENDING',
        notes: createForm.notes || null
      }).select().single();

      if (opError) throw opError;

      // Create stock_opname_details
      const details = selectedItems.map(itemId => {
        const bal = balMap[itemId];
        return {
          opname_id: newOpname.id,
          item_id: itemId,
          system_qty: bal?.quantity || 0,
          physical_qty: 0,
          unit_cost: bal?.avg_cost || 0,
          organization_id: selectedOrg.id
        };
      });

      const { error: detError } = await supabase.from('stock_opname_details').insert(details).select();
      if (detError) throw detError;

      // Log approval_logs entry
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id,
        document_type: 'STOCK_OPNAME',
        document_id: newOpname.id,
        document_number: opnameNumber,
        action: 'CREATED',
        action_by: currentUser.id,
        notes: 'Assignment created'
      });

      showNotification('Stock opname assignment created', 'success');
      setShowCreateModal(false);
      loadAll();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
    setSaving(false);
  }

  async function handleStartCounting(opname) {
    setSaving(true);
    try {
      const { error } = await supabase.from('stock_opname').update({
        status: 'COUNTING',
        started_at: new Date().toISOString()
      }).eq('id', opname.id);

      if (error) throw error;

      // Log approval_logs entry
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id,
        document_type: 'STOCK_OPNAME',
        document_id: opname.id,
        document_number: opname.opname_number,
        action: 'COUNTING_STARTED',
        action_by: currentUser.id,
        notes: 'Counting started'
      });

      showNotification('Counting started', 'success');
      openCountingModal(opname);
      loadAll();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
    setSaving(false);
  }

  async function openCountingModal(opname) {
    setCountingOpname(opname);
    const { data: dets } = await supabase.from('stock_opname_details').select('*').eq('opname_id', opname.id);
    setCountingDetails(dets || []);
    setShowCountingModal(true);
  }

  function updateCountingDetail(idx, field, value) {
    const nd = [...countingDetails];
    const updated = { ...nd[idx], [field]: value };

    if (field === 'physical_qty') {
      updated.variance_qty = updated.physical_qty - updated.system_qty;
      updated.variance_value = updated.variance_qty * updated.unit_cost;
    }

    nd[idx] = updated;
    setCountingDetails(nd);
  }

  async function handleSubmitCounting() {
    if (!countingOpname) return;
    setSaving(true);
    try {
      // Check period lock based on opname date
      const lockCheck = await checkPeriodLock(selectedOrg.id, countingOpname.opname_date || new Date().toISOString());
      if (lockCheck.locked) {
        showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
        setSaving(false);
        return;
      }

      // Delete old details
      await supabase.from('stock_opname_details').delete().eq('opname_id', countingOpname.id);

      // Insert updated details (variance_qty and variance_value are generated columns)
      const { error: detError } = await supabase.from('stock_opname_details').insert(
        countingDetails.map(d => ({
          opname_id: countingOpname.id,
          item_id: d.item_id,
          system_qty: d.system_qty,
          physical_qty: d.physical_qty,
          unit_cost: d.unit_cost,
          notes: d.notes || null,
          organization_id: selectedOrg.id
        }))
      );

      if (detError) throw detError;

      // Calculate total variance
      const totalVariance = countingDetails.reduce((s, d) => s + (d.variance_value || 0), 0);

      // Update opname status
      const { error: opError } = await supabase.from('stock_opname').update({
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        submitted_by: currentUser.id,
        total_variance_value: totalVariance
      }).eq('id', countingOpname.id);

      if (opError) throw opError;

      // Log approval_logs entry
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id,
        document_type: 'STOCK_OPNAME',
        document_id: countingOpname.id,
        document_number: countingOpname.opname_number,
        action: 'SUBMITTED',
        action_by: currentUser.id,
        notes: 'Counting submitted for approval'
      });

      showNotification('Counting submitted for approval', 'success');
      setShowCountingModal(false);
      loadAll();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
    setSaving(false);
  }

  async function handleDelete(opname) {
    if (!canDelete(opname)) {
      showNotification('Cannot delete this opname', 'error');
      return;
    }
    if (!(await showConfirm(t('opname.confirmDelete'), { variant: 'danger' }))) return;

    try {
      await supabase.from('stock_opname_details').delete().eq('opname_id', opname.id);
      await supabase.from('approval_logs').delete().eq('record_id', opname.id).eq('record_type', 'stock_opname');
      const { error } = await supabase.from('stock_opname').delete().eq('id', opname.id);
      if (error) throw error;
      showNotification('Opname deleted', 'success');
      loadAll();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  const userMap = {};
  users.forEach(u => { userMap[u.id] = u; });
  const catMap = {};
  categories.forEach(c => { catMap[c.id] = c; });
  const itemMap = {};
  items.forEach(i => { itemMap[i.id] = i; });

  return (
    <div>
      <PageHeader
        title={t('opname.title')}
        subtitle={t('opname.subtitle')}
        actions={canCreate() ? <Button onClick={openCreateModal}><Icons.Plus /> {t('opname.create')}</Button> : null}
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable
          loading={loading}
          columns={[
            { header: t('opname.number'), render: r => <span className="font-mono text-xs font-semibold text-primary-700">{r.opname_number}</span> },
            { header: t('opname.date'), render: r => formatDateSys(r.opname_date) },
            { header: 'Category', render: r => catMap[r.category_id]?.name || '-' },
            { header: 'Assigned To', render: r => userMap[r.assigned_to]?.full_name || '-' },
            { header: t('opname.totalVariance'), align: 'right', render: r => <span className={r.total_variance_value < 0 ? 'text-red-600' : r.total_variance_value > 0 ? 'text-green-600' : ''}>{formatCurrency(r.total_variance_value || 0)}</span> },
            { header: t('common.status'), render: r => {
              const opnameStatusMap = {
                PENDING: { color: 'yellow', label: t('opname.statusPending') },
                COUNTING: { color: 'orange', label: t('opname.statusCounting') },
                SUBMITTED: { color: 'blue', label: t('opname.statusSubmitted') },
                APPROVED: { color: 'green', label: t('opname.statusApproved') },
                REJECTED: { color: 'red', label: t('opname.statusRejected') },
              };
              const s = opnameStatusMap[r.status] || { color: 'gray', label: r.status };
              return <Badge color={s.color}>{s.label}</Badge>;
            }},
          ]}
          data={opnames}
          actions={(row) => (
            <div className="flex items-center gap-1">
              {canStartCounting(row) && (
                <Button
                  size="sm"
                  onClick={e => { e.stopPropagation(); handleStartCounting(row); }}
                >
                  Mulai
                </Button>
              )}
              {canFillAndSubmit(row) && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={e => { e.stopPropagation(); openCountingModal(row); }}
                  >
                    Buka Detail
                  </Button>
                  <Button
                    size="sm"
                    onClick={e => { e.stopPropagation(); handleSubmitCounting(); }}
                  >
                    Submit
                  </Button>
                </>
              )}
              {canDelete(row) && (
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(row); }}
                  className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"
                >
                  <Icons.Trash />
                </button>
              )}
            </div>
          )}
        />
        {opnames.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500">{t('opname.empty')}</div>
        )}
      </div>

      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t('opname.create')}
        size="lg"
      >
        <div className="space-y-4">
          <FormField label="Category" required>
            <TreeSelect value={createForm.category_id} onChange={v => handleCategoryChange(v)} categories={categories} placeholder="Select a category" />
          </FormField>

          {categoryItems.length > 0 && (
            <FormField label="Select Items">
              <div className="border rounded p-3 space-y-2 max-h-48 overflow-y-auto">
                <label className="flex items-center gap-2 cursor-pointer font-semibold">
                  <input
                    type="checkbox"
                    checked={selectedItems.length === categoryItems.length && categoryItems.length > 0}
                    onChange={selectAllItems}
                  />
                  Select All
                </label>
                {categoryItems.map(item => (
                  <label key={item.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span className="text-sm">{item.code} - {item.name}</span>
                  </label>
                ))}
              </div>
              <div className="text-xs text-gray-500 mt-1">{selectedItems.length} selected</div>
            </FormField>
          )}

          <FormField label="Assign To" required>
            <Select
              value={createForm.assigned_to}
              onChange={e => setCreateForm({ ...createForm, assigned_to: e.target.value })}
            >
              <option value="">Select a user</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </Select>
          </FormField>

          <FormField label={t('opname.date')} required>
            <Input
              type="date"
              value={createForm.opname_date}
              onChange={e => setCreateForm({ ...createForm, opname_date: e.target.value })}
            />
          </FormField>

          <FormField label={t('opname.notes')}>
            <Input
              value={createForm.notes}
              onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
              placeholder="Optional notes..."
            />
          </FormField>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateOpname} disabled={saving}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showCountingModal}
        onClose={() => setShowCountingModal(false)}
        title={`Counting: ${countingOpname?.opname_number}`}
        size="xl"
      >
        {countingDetails.length > 0 && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-right w-20">System Qty</th>
                    <th className="p-2 text-right w-20">Physical Qty</th>
                    <th className="p-2 text-right w-20">Variance</th>
                    <th className="p-2 text-right w-24">Unit Cost</th>
                    <th className="p-2 text-right w-28">Variance Value</th>
                  </tr>
                </thead>
                <tbody>
                  {countingDetails.map((det, idx) => {
                    const item = itemMap[det.item_id];
                    return (
                      <tr key={idx} className="border-b">
                        <td className="p-2 text-xs">{item ? `${item.code} - ${item.name}` : det.item_id}</td>
                        <td className="p-2 text-right text-gray-500">{det.system_qty}</td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={det.physical_qty}
                            onChange={e => updateCountingDetail(idx, 'physical_qty', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 border rounded text-sm text-right"
                            min="0"
                          />
                        </td>
                        <td className={`p-2 text-right font-medium ${det.variance_qty < 0 ? 'text-red-600' : det.variance_qty > 0 ? 'text-green-600' : ''}`}>
                          {det.variance_qty}
                        </td>
                        <td className="p-2 text-right text-gray-500">{formatCurrency(det.unit_cost)}</td>
                        <td className={`p-2 text-right font-medium ${det.variance_value < 0 ? 'text-red-600' : det.variance_value > 0 ? 'text-green-600' : ''}`}>
                          {formatCurrency(det.variance_value || 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="secondary" onClick={() => setShowCountingModal(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSubmitCounting} disabled={saving}>
                Submit Counting
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default StockOpnamePage;
