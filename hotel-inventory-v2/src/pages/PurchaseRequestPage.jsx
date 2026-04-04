import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { TreeSelect } from '../components/TreeSelect';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { StatusBadge } from '../components/StatusBadge';
import { formatCurrency, formatDate, formatNumber, formatDateSys, getLocalDateString } from '../utils/format';

export default function PurchaseRequestPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [prs, setPrs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ department_id: '', category_id: '', request_date: getLocalDateString(), needed_date: '', priority: 'NORMAL', notes: '' });
  const [lineItems, setLineItems] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);
  const [viewItems, setViewItems] = useState([]);
  const [orderStatusMap, setOrderStatusMap] = useState({});

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [prRes, deptRes, itemRes, unitRes, userRes, catRes] = await Promise.all([
      supabase.from('purchase_requests').select('*, departments(name, code), item_categories:category_id(name, code)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('departments').select('*').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      supabase.from('items').select('id, code, name, unit_id, category_id, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation, name)').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('units').select('*').order('name'),
      supabase.from('users').select('id, full_name').order('full_name'),
      supabase.from('item_categories').select('id, code, name, parent_id').order('name'),
    ]);
    const allPrs = prRes.data || [];
    setPrs(allPrs);
    setDepartments(deptRes.data || []);
    setItems(itemRes.data || []);
    setCategories(catRes.data || []);
    setUnits(unitRes.data || []);
    setUsers(userRes.data || []);

    // Load order status data for approved PRs
    const approvedPrIds = allPrs.filter(p => ['APPROVED','PARTIAL_ORDERED','FULLY_ORDERED'].includes(p.status)).map(p => p.id);
    if (approvedPrIds.length > 0) {
      const [prItemsRes, poRes] = await Promise.all([
        supabase.from('purchase_request_items').select('pr_id, item_id, quantity').in('pr_id', approvedPrIds),
        supabase.from('purchase_orders').select('id, pr_reference_id').eq('organization_id', selectedOrg.id).in('pr_reference_id', approvedPrIds),
      ]);
      const prItemsData = prItemsRes.data || [];
      const linkedPOs = poRes.data || [];
      const poIds = linkedPOs.map(po => po.id);
      let poItemsData = [];
      if (poIds.length > 0) {
        const { data } = await supabase.from('purchase_order_items').select('po_id, item_id, quantity').in('po_id', poIds);
        poItemsData = data || [];
      }
      // Build order status map: pr_id -> { status, ordered, total }
      const orderStatusMap = {};
      approvedPrIds.forEach(prId => {
        const prItems = prItemsData.filter(i => i.pr_id === prId);
        const prPoIds = linkedPOs.filter(po => po.pr_reference_id === prId).map(po => po.id);
        const poItems = poItemsData.filter(i => prPoIds.includes(i.po_id));

        let totalRequested = 0;
        let totalOrdered = 0;
        prItems.forEach(pri => {
          totalRequested += pri.quantity;
          const orderedQty = poItems.filter(poi => poi.item_id === pri.item_id).reduce((sum, poi) => sum + poi.quantity, 0);
          totalOrdered += Math.min(orderedQty, pri.quantity);
        });

        if (totalRequested === 0) {
          orderStatusMap[prId] = 'NOT_ORDERED';
        } else if (totalOrdered >= totalRequested) {
          orderStatusMap[prId] = 'FULLY_ORDERED';
        } else if (totalOrdered > 0) {
          orderStatusMap[prId] = 'PARTIAL_ORDERED';
        } else {
          orderStatusMap[prId] = 'NOT_ORDERED';
        }
      });
      setOrderStatusMap(orderStatusMap);
    }
    setLoading(false);
  }

  // Get filtered items based on selected category (including all child categories if parent is selected)
  const filteredItems = React.useMemo(() => {
    if (!form.category_id) return items;
    // Collect the selected category and ALL its descendants recursively
    function getDescendantIds(parentId) {
      const childIds = categories.filter(c => c.parent_id === parentId).map(c => c.id);
      let all = [...childIds];
      childIds.forEach(cid => { all = all.concat(getDescendantIds(cid)); });
      return all;
    }
    const selectedCatIds = [form.category_id, ...getDescendantIds(form.category_id)];
    return items.filter(i => selectedCatIds.includes(i.category_id));
  }, [form.category_id, items, categories]);

  function getUserName(userId) {
    if (!userId) return '-';
    const u = users.find(u => u.id === userId);
    return u ? u.full_name : '-';
  }

  async function openView(pr) {
    setViewDoc(pr);
    const { data } = await supabase.from('purchase_request_items').select('*, items(code, name, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation), units:units!items_unit_id_fkey(abbreviation))').eq('pr_id', pr.id);
    setViewItems(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({ department_id: currentUser?.department_id || departments[0]?.id || '', category_id: '', request_date: getLocalDateString(), needed_date: '', priority: 'NORMAL', notes: '' });
    setLineItems([{ item_id: '', quantity: 1, unit_id: '' }]);
    setShowModal(true);
  }

  async function openEdit(pr) {
    setEditing(pr);
    setForm({ department_id: pr.department_id || '', category_id: pr.category_id || '', request_date: pr.request_date, needed_date: pr.needed_date || '', priority: pr.priority, notes: pr.notes || '' });
    const { data: prItems } = await supabase.from('purchase_request_items').select('*').eq('pr_id', pr.id);
    setLineItems((prItems || []).map(i => ({ item_id: i.item_id, quantity: i.quantity, unit_id: i.unit_id || '' })));
    if (!prItems || prItems.length === 0) setLineItems([{ item_id: '', quantity: 1, unit_id: '' }]);
    setShowModal(true);
  }

  function handleCategoryChange(catId) {
    // Clear line items when category changes (because items are now filtered)
    if (catId !== form.category_id) {
      setLineItems([{ item_id: '', quantity: 1, unit_id: '' }]);
    }
    setForm({ ...form, category_id: catId });
  }

  function addLine() { setLineItems([...lineItems, { item_id: '', quantity: 1, unit_id: '' }]); }
  function removeLine(idx) { setLineItems(lineItems.filter((_, i) => i !== idx)); }
  function updateLine(idx, field, val) { const nl = [...lineItems]; nl[idx] = { ...nl[idx], [field]: val }; setLineItems(nl); }

  async function generatePRNumber() {
    const prefix = `PR-${selectedOrg.code}-`;
    const { data } = await supabase.from('purchase_requests').select('pr_number').eq('organization_id', selectedOrg.id).like('pr_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].pr_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleSave() {
    if (!form.category_id) { showNotification('Pilih kategori item terlebih dahulu', 'error'); return; }
    if (!form.department_id || lineItems.filter(l => l.item_id).length === 0) return;
    setSaving(true);
    try {
      // Validate request date
      const inputDate = new Date(form.request_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Request date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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

      const validLines = lineItems.filter(l => l.item_id);
      if (editing) {
        const { error } = await supabase.from('purchase_requests').update({
          department_id: form.department_id, category_id: form.category_id || null, request_date: form.request_date, needed_date: form.needed_date || null,
          priority: form.priority, notes: form.notes || null
        }).eq('id', editing.id);
        if (error) throw error;
        await supabase.from('purchase_request_items').delete().eq('pr_id', editing.id);
        const itemsPayload = validLines.map(l => {
          const itm = items.find(i => i.id === l.item_id);
          return { pr_id: editing.id, item_id: l.item_id, quantity: l.quantity, unit_id: itm?.purchase_unit_id || itm?.unit_id || l.unit_id || null };
        });
        const { error: itemErr } = await supabase.from('purchase_request_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      } else {
        const prNumber = await generatePRNumber();
        const { data: newPR, error } = await supabase.from('purchase_requests').insert({
          pr_number: prNumber, organization_id: selectedOrg.id, department_id: form.department_id,
          category_id: form.category_id || null, request_date: form.request_date, needed_date: form.needed_date || null,
          priority: form.priority, status: 'DRAFT', notes: form.notes || null, requested_by: currentUser?.id || null
        }).select().single();
        if (error) throw error;
        const itemsPayload = validLines.map(l => {
          const itm = items.find(i => i.id === l.item_id);
          return { pr_id: newPR.id, item_id: l.item_id, quantity: l.quantity, unit_id: itm?.purchase_unit_id || itm?.unit_id || l.unit_id || null };
        });
        const { error: itemErr } = await supabase.from('purchase_request_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      }
      showNotification(t('pr.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(pr) {
    if (pr.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + pr.status, 'error'); return; }
    if (!(await showConfirm(t('pr.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('purchase_request_items').delete().eq('pr_id', pr.id);
      const { error } = await supabase.from('purchase_requests').delete().eq('id', pr.id);
      if (error) throw error;
      showNotification(t('pr.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function submitForApproval(pr) {
    if (!(await showConfirm('Submit for approval?', { variant: 'warning' }))) return;
    const upd = { status: 'PENDING', submitted_by: currentUser?.id, submitted_at: new Date().toISOString() };
    await supabase.from('purchase_requests').update(upd).eq('id', pr.id);
    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: 'PR', document_id: pr.id,
      document_number: pr.pr_number, action: 'SUBMITTED', action_by: currentUser?.id,
    });
    showNotification(t('pr.title') + ' submitted for approval', 'success');
    loadAll();
  }

  // Price removed from PR - only filled in PO

  return (
    <div>
      <PageHeader title={t('pr.title')} subtitle={t('pr.subtitle')}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('pr.create')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('pr.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.pr_number}</button> },
            { header: t('common.date'), render: r => formatDateSys(r.request_date) },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: 'Category', render: r => r.item_categories ? <Badge color="purple">{r.item_categories.code}</Badge> : <span className="text-xs text-gray-400">-</span> },
            { header: t('pr.priority'), render: r => <Badge color={r.priority==='URGENT'?'red':r.priority==='HIGH'?'orange':'gray'}>{r.priority}</Badge> },
            { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
            { header: 'Order Status', render: r => {
              if (!['APPROVED','PARTIAL_ORDERED','FULLY_ORDERED'].includes(r.status)) return <span className="text-xs text-gray-400">-</span>;
              const os = orderStatusMap[r.id];
              if (os === 'FULLY_ORDERED') return <Badge color="green">Fully Ordered</Badge>;
              if (os === 'PARTIAL_ORDERED') return <Badge color="orange">Partial Ordered</Badge>;
              return <Badge color="gray">Not Ordered</Badge>;
            }},
            { header: t('approval.info'), render: r => r.approved_by ? (
              <div className="text-xs">
                <div className="font-medium text-green-700">{getUserName(r.approved_by)}</div>
                <div className="text-gray-400">{r.approved_at ? formatDateSys(r.approved_at) : ''}</div>
              </div>
            ) : r.status === 'PENDING' ? <span className="text-xs text-yellow-600">{t('approval.notApproved')}</span> : <span className="text-xs text-gray-400">-</span> },
          ]}
          data={prs}
          actions={(row) => (
            <div className="flex items-center gap-1">
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();submitForApproval(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">{t('pr.submit')}</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit /></button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Icons.Trash /></button>}
            </div>
          )}
        />
        {prs.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500"><Icons.ShoppingCart /><p className="mt-2">{t('pr.empty')}</p></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit PR' : t('pr.create')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <FormField label="User">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.full_name || currentUser?.username || '-'}
            </div>
          </FormField>
          <FormField label={t('stock.dept')} required>
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
            </div>
          </FormField>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <FormField label="Item Category" required>
            <TreeSelect value={form.category_id} onChange={v => handleCategoryChange(v)} categories={categories} placeholder="-- Pilih Kategori --" disabled={editing && lineItems.some(l => l.item_id)} />
          </FormField>
          <FormField label={t('common.date')} required>
            <Input type="date" value={form.request_date} disabled className="bg-gray-100 cursor-not-allowed" />
          </FormField>
          <FormField label={t('pr.neededDate')}>
            <Input type="date" value={form.needed_date} onChange={e => setForm({...form, needed_date: e.target.value})} />
          </FormField>
          <FormField label={t('pr.priority')}>
            <Select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          </FormField>
          <FormField label={t('bincard.notes')}>
            <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
          </FormField>
        </div>

        {/* Category info */}
        {form.category_id && (
          <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
            <Icons.Info className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <span className="text-xs text-blue-700">
              Kategori: <strong>{categories.find(c => c.id === form.category_id)?.name}</strong>
              {categories.some(c => c.parent_id === form.category_id) ? ' (termasuk semua sub-kategori)' : ''} — {filteredItems.length} item tersedia
            </span>
          </div>
        )}
        {!form.category_id && (
          <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <Icons.AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span className="text-xs text-amber-700">Pilih kategori item terlebih dahulu sebelum menambahkan item.</span>
          </div>
        )}

        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-sm">{t('pr.addItem')}</h4>
            <button onClick={addLine} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ {t('pr.addItem')}</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50">
              <th className="p-2 text-left">{t('dashboard.item')}</th>
              <th className="p-2 text-right w-20">{t('pr.qty')}</th>
              <th className="p-2 text-center w-32">{t('items.purchaseUnit')}</th>
              <th className="p-2 w-10"></th>
            </tr></thead>
            <tbody>
              {lineItems.map((line, idx) => {
                const selectedItem = items.find(i => i.id === line.item_id);
                const puName = selectedItem?.purchase_unit?.abbreviation || (selectedItem?.unit_id ? (units.find(u => u.id === selectedItem.unit_id)?.abbreviation || '-') : '-');
                return (
                <tr key={idx} className="border-b">
                  <td className="p-2">
                    <SearchableItemSelect items={filteredItems} value={line.item_id} onChange={v => updateLine(idx, 'item_id', v)} placeholder={form.category_id ? t('pr.selectItem') : 'Pilih kategori dulu...'} disabled={!form.category_id} />
                  </td>
                  <td className="p-2"><input type="number" value={line.quantity} onChange={e => updateLine(idx, 'quantity', parseFloat(e.target.value)||0)}
                    className="w-full px-2 py-1 border rounded text-sm text-right" min="1" disabled={!form.category_id} /></td>
                  <td className="p-2 text-center text-sm text-gray-600">{line.item_id ? puName : '-'}</td>
                  <td className="p-2">{lineItems.length > 1 && <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600"><Icons.Trash /></button>}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>

      {viewDoc && (
        <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={`PR Details: ${viewDoc.pr_number}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded">
              <div>
                <p className="text-xs text-gray-500">{t('pr.number')}</p>
                <p className="font-semibold">{viewDoc.pr_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('common.date')}</p>
                <p className="font-semibold">{formatDateSys(viewDoc.request_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('stock.dept')}</p>
                <p className="font-semibold">{viewDoc.departments?.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Category</p>
                <p className="font-semibold">{viewDoc.item_categories?.name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('pr.priority')}</p>
                <Badge color={viewDoc.priority==='URGENT'?'red':viewDoc.priority==='HIGH'?'orange':'gray'}>{viewDoc.priority}</Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('common.status')}</p>
                <StatusBadge status={viewDoc.status} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('approval.info')}</p>
                <p className="text-sm">{viewDoc.approved_by ? getUserName(viewDoc.approved_by) : '-'}</p>
              </div>
              {viewDoc.needed_date && (
                <div>
                  <p className="text-xs text-gray-500">{t('pr.neededDate')}</p>
                  <p className="font-semibold">{formatDateSys(viewDoc.needed_date)}</p>
                </div>
              )}
              {viewDoc.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('bincard.notes')}</p>
                  <p className="text-sm">{viewDoc.notes}</p>
                </div>
              )}
            </div>
            {viewItems.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">{t('pr.items')}</h4>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">{t('dashboard.item')}</th>
                      <th className="text-right p-2">{t('pr.qty')}</th>
                      <th className="text-center p-2">{t('items.purchaseUnit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((item, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2"><span className="font-mono text-xs">{item.items?.code}</span> - {item.items?.name}</td>
                        <td className="p-2 text-right">{formatNumber(item.quantity)}</td>
                        <td className="p-2 text-center">{item.items?.purchase_unit?.abbreviation || item.items?.units?.abbreviation || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <Button variant="secondary" onClick={() => setViewDoc(null)}>{t('common.close')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}