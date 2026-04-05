import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDateSys, getLocalDateString } from '../utils/format';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Badge } from '../components/Badge';
import { StatusBadge } from '../components/StatusBadge';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function PurchaseOrderPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [pos, setPos] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', order_date: getLocalDateString(), expected_delivery: '', payment_terms: '', notes: '' });
  const [lineItems, setLineItems] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);
  const [viewItems, setViewItems] = useState([]);
  const [approvedPRs, setApprovedPRs] = useState([]);
  const [showPRSelect, setShowPRSelect] = useState(false);
  const [selectedPR, setSelectedPR] = useState('');
  const [invoiceStatusMap, setInvoiceStatusMap] = useState({});

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [poRes, vendorRes, itemRes, userRes, prRes] = await Promise.all([
      supabase.from('purchase_orders').select('*, vendors(name, code), pr_reference_id').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('vendors').select('*').eq('is_active', true).order('name'),
      supabase.from('items').select('id, code, name, unit_id, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation, name)').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('users').select('id, full_name').order('full_name'),
      supabase.from('purchase_requests').select('id, pr_number, request_date, needed_date, priority, notes, departments(name, code)').eq('organization_id', selectedOrg.id).in('status', ['APPROVED', 'PARTIAL_ORDERED']).order('created_at', { ascending: false }),
    ]);
    setPos(poRes.data || []);
    setVendors(vendorRes.data || []);
    setItems(itemRes.data || []);
    setUsers(userRes.data || []);

    // Filter out PRs that already have a PO linked (check notes or pr_reference_id)
    const allApprovedPRs = prRes.data || [];
    // Get all PO notes to check if PR number is referenced
    const poList = poRes.data || [];
    const linkedPRNumbers = new Set();
    poList.forEach(po => {
      if (po.pr_reference_id) linkedPRNumbers.add(po.pr_reference_id);
      if (po.notes && po.notes.startsWith('Imported from PR:')) {
        const prNum = po.notes.replace('Imported from PR: ', '').trim();
        const matchPR = allApprovedPRs.find(p => p.pr_number === prNum);
        if (matchPR) linkedPRNumbers.add(matchPR.id);
      }
    });
    setApprovedPRs(allApprovedPRs.filter(pr => !linkedPRNumbers.has(pr.id)));

    // Load invoice status data for POs
    const allPOs = poList;
    const approvedPoIds = allPOs.filter(p => ['APPROVED','SENT','RECEIVED','PARTIAL_INVOICED','FULLY_INVOICED'].includes(p.status)).map(p => p.id);
    if (approvedPoIds.length > 0) {
      const [poItemsRes, piRes] = await Promise.all([
        supabase.from('purchase_order_items').select('po_id, item_id, quantity').in('po_id', approvedPoIds),
        supabase.from('purchase_invoices').select('id, po_id').eq('organization_id', selectedOrg.id).in('po_id', approvedPoIds),
      ]);
      const poItemsData = poItemsRes.data || [];
      const linkedPIs = piRes.data || [];
      const piIds = linkedPIs.map(pi => pi.id);
      let piItemsData = [];
      if (piIds.length > 0) {
        const { data } = await supabase.from('purchase_invoice_items').select('pi_id, item_id, quantity').in('pi_id', piIds);
        piItemsData = data || [];
      }
      const invoiceStatusMap = {};
      approvedPoIds.forEach(poId => {
        const poItems = poItemsData.filter(i => i.po_id === poId);
        const posPiIds = linkedPIs.filter(pi => pi.po_id === poId).map(pi => pi.id);
        const piItems = piItemsData.filter(i => posPiIds.includes(i.pi_id));

        let totalOrdered = 0;
        let totalInvoiced = 0;
        poItems.forEach(poi => {
          totalOrdered += poi.quantity;
          const invoicedQty = piItems.filter(pii => pii.item_id === poi.item_id).reduce((sum, pii) => sum + pii.quantity, 0);
          totalInvoiced += Math.min(invoicedQty, poi.quantity);
        });

        if (totalOrdered === 0) {
          invoiceStatusMap[poId] = 'NOT_INVOICED';
        } else if (totalInvoiced >= totalOrdered) {
          invoiceStatusMap[poId] = 'FULLY_INVOICED';
        } else if (totalInvoiced > 0) {
          invoiceStatusMap[poId] = 'PARTIAL_INVOICED';
        } else {
          invoiceStatusMap[poId] = 'NOT_INVOICED';
        }
      });
      setInvoiceStatusMap(invoiceStatusMap);
    }
    setLoading(false);
  }

  async function importFromPR(prId) {
    if (!prId) return;
    const pr = approvedPRs.find(p => p.id === prId);
    if (!pr) return;

    // Load PR items
    const { data: prItems } = await supabase.from('purchase_request_items').select('*, items(code, name)').eq('pr_id', prId);
    if (!prItems || prItems.length === 0) {
      showNotification('PR tidak memiliki item', 'error');
      return;
    }

    // Set line items from PR
    const newLines = prItems.map(pi => ({
      item_id: pi.item_id,
      quantity: pi.quantity || 1,
      unit_price: 0,
      discount_percent: 0,
      tax_percent: 11
    }));
    setLineItems(newLines);
    setForm(prev => ({
      ...prev,
      notes: 'Imported from PR: ' + pr.pr_number,
      pr_reference_id: pr.id
    }));
    setShowPRSelect(false);
    setSelectedPR('');
    showNotification('Item dari ' + pr.pr_number + ' berhasil di-import (' + newLines.length + ' items)');
  }

  function getUserName(userId) {
    if (!userId) return '-';
    const u = users.find(u => u.id === userId);
    return u ? u.full_name : '-';
  }

  async function openView(po) {
    setViewDoc(po);
    const { data } = await supabase.from('purchase_order_items').select('*, items(code, name, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation))').eq('po_id', po.id);
    setViewItems(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({ vendor_id: '', order_date: getLocalDateString(), expected_delivery: '', payment_terms: '', notes: '' });
    setLineItems([{ item_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 11 }]);
    setShowModal(true);
  }

  async function openEdit(po) {
    setEditing(po);
    setForm({ vendor_id: po.vendor_id || '', order_date: po.order_date, expected_delivery: po.expected_delivery || '', payment_terms: po.payment_terms || '', notes: po.notes || '' });
    const { data: poItems } = await supabase.from('purchase_order_items').select('*').eq('po_id', po.id);
    setLineItems((poItems || []).map(i => ({ item_id: i.item_id, quantity: i.quantity, unit_price: i.unit_price || 0, discount_percent: i.discount_percent || 0, tax_percent: i.tax_percent || 11 })));
    if (!poItems || poItems.length === 0) setLineItems([{ item_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 11 }]);
    setShowModal(true);
  }

  function addLine() { setLineItems([...lineItems, { item_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 11 }]); }
  function removeLine(idx) { setLineItems(lineItems.filter((_, i) => i !== idx)); }
  function updateLine(idx, field, val) { const nl = [...lineItems]; nl[idx] = { ...nl[idx], [field]: val }; setLineItems(nl); }

  function calcLineTotal(line) {
    const base = line.quantity * line.unit_price;
    const disc = base * (line.discount_percent / 100);
    const afterDisc = base - disc;
    const tax = afterDisc * (line.tax_percent / 100);
    return afterDisc + tax;
  }

  async function generatePONumber() {
    const prefix = `PO-${selectedOrg.code}-`;
    const { data } = await supabase.from('purchase_orders').select('po_number').eq('organization_id', selectedOrg.id).like('po_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].po_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleSave() {
    if (!form.vendor_id || lineItems.filter(l => l.item_id).length === 0) return;
    setSaving(true);
    try {
      // Validate order date
      const inputDate = new Date(form.order_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Order date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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
      const subtotal = validLines.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
      const totalDiscount = validLines.reduce((s, l) => s + (l.quantity * l.unit_price * l.discount_percent / 100), 0);
      const afterDiscTotal = subtotal - totalDiscount;
      const totalTax = validLines.reduce((s, l) => {
        const base = l.quantity * l.unit_price;
        const disc = base * (l.discount_percent / 100);
        return s + ((base - disc) * l.tax_percent / 100);
      }, 0);
      const totalAmount = afterDiscTotal + totalTax;

      if (editing) {
        const { error } = await supabase.from('purchase_orders').update({
          vendor_id: form.vendor_id, order_date: form.order_date, expected_delivery: form.expected_delivery || null,
          payment_terms: form.payment_terms || null, notes: form.notes || null,
          subtotal, discount_amount: totalDiscount, tax_amount: totalTax, total_amount: totalAmount
        }).eq('id', editing.id);
        if (error) throw error;
        await supabase.from('purchase_order_items').delete().eq('po_id', editing.id);
        const itemsPayload = validLines.map(l => ({
          po_id: editing.id, item_id: l.item_id, quantity: l.quantity,
          unit_price: l.unit_price, discount_percent: l.discount_percent, tax_percent: l.tax_percent,
          total_price: calcLineTotal(l)
        }));
        const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      } else {
        const poNumber = await generatePONumber();
        const poPayload = {
          po_number: poNumber, organization_id: selectedOrg.id, vendor_id: form.vendor_id,
          order_date: form.order_date, expected_delivery: form.expected_delivery || null,
          payment_terms: form.payment_terms || null, status: 'DRAFT', notes: form.notes || null,
          subtotal, discount_amount: totalDiscount, tax_amount: totalTax, total_amount: totalAmount,
          created_by: currentUser?.id || null
        };
        if (form.pr_reference_id) poPayload.pr_reference_id = form.pr_reference_id;
        const { data: newPO, error } = await supabase.from('purchase_orders').insert(poPayload).select().single();
        if (error) throw error;
        const itemsPayload = validLines.map(l => ({
          po_id: newPO.id, item_id: l.item_id, quantity: l.quantity,
          unit_price: l.unit_price, discount_percent: l.discount_percent, tax_percent: l.tax_percent,
          total_price: calcLineTotal(l)
        }));
        const { error: itemErr } = await supabase.from('purchase_order_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      }
      showNotification(t('po.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(po) {
    if (po.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + po.status, 'error'); return; }
    if (!(await showConfirm(t('po.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('purchase_order_items').delete().eq('po_id', po.id);
      const { error } = await supabase.from('purchase_orders').delete().eq('id', po.id);
      if (error) throw error;
      showNotification(t('po.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function submitForApproval(po) {
    if (!(await showConfirm('Submit for approval?', { variant: 'warning' }))) return;
    const upd = { status: 'PENDING', submitted_by: currentUser?.id, submitted_at: new Date().toISOString() };
    await supabase.from('purchase_orders').update(upd).eq('id', po.id);
    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: 'PO', document_id: po.id,
      document_number: po.po_number, action: 'SUBMITTED', action_by: currentUser?.id,
    });
    showNotification(t('po.title') + ' submitted for approval', 'success');
    loadAll();
  }
  async function updateStatus(po, newStatus) {
    await supabase.from('purchase_orders').update({ status: newStatus }).eq('id', po.id);
    showNotification(t('po.title') + ' → ' + newStatus);
    loadAll();
  }

  const { grandSubtotal, grandDiscount, grandTax, grandTotal } = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0;
    lineItems.forEach(l => {
      const base = l.quantity * l.unit_price;
      subtotal += base;
      const disc = base * (l.discount_percent / 100);
      discount += disc;
      tax += (base - disc) * (l.tax_percent / 100);
    });
    return { grandSubtotal: subtotal, grandDiscount: discount, grandTax: tax, grandTotal: subtotal - discount + tax };
  }, [lineItems]);

  return (
    <div>
      <PageHeader title={t('po.title')} subtitle={t('po.subtitle')}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('po.create')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('po.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.po_number}</button> },
            { header: t('po.orderDate'), render: r => formatDateSys(r.order_date) },
            { header: t('po.vendor'), render: r => r.vendors?.name || '-' },
            { header: t('po.expectedDelivery'), render: r => r.expected_delivery ? formatDateSys(r.expected_delivery) : '-' },
            { header: t('po.totalAmount'), align: 'right', render: r => formatCurrency(r.total_amount) },
            { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
            { header: 'Invoice Status', render: r => {
              if (!['APPROVED','SENT','RECEIVED','PARTIAL_INVOICED','FULLY_INVOICED'].includes(r.status)) return <span className="text-xs text-gray-400">-</span>;
              const is = invoiceStatusMap[r.id];
              if (is === 'FULLY_INVOICED') return <Badge color="green">Fully Invoiced</Badge>;
              if (is === 'PARTIAL_INVOICED') return <Badge color="orange">Partial Invoiced</Badge>;
              return <Badge color="gray">Not Invoiced</Badge>;
            }},
            { header: t('approval.info'), render: r => r.approved_by ? (
              <div className="text-xs">
                <div className="font-medium text-green-700">{getUserName(r.approved_by)}</div>
                <div className="text-gray-400">{r.approved_at ? formatDateSys(r.approved_at) : ''}</div>
              </div>
            ) : r.status === 'PENDING' ? <span className="text-xs text-yellow-600">{t('approval.notApproved')}</span> : <span className="text-xs text-gray-400">-</span> },
          ]}
          data={pos}
          actions={(row) => (
            <div className="flex items-center gap-1">
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();submitForApproval(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">{t('po.submit')}</button>}
              {row.status === 'APPROVED' && <button onClick={e=>{e.stopPropagation();updateStatus(row,'SENT')}} className="p-1 text-xs bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100">{t('po.send')}</button>}
              {row.status === 'SENT' && <button onClick={e=>{e.stopPropagation();updateStatus(row,'RECEIVED')}} className="p-1 text-xs bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100">{t('po.receive')}</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit /></button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Icons.Trash /></button>}
            </div>
          )}
        />
        {pos.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500"><Icons.ShoppingCart /><p className="mt-2">{t('po.empty')}</p></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit PO' : t('po.create')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <FormField label={t('po.vendor')} required>
            <Select value={form.vendor_id} onChange={e => setForm({...form, vendor_id: e.target.value})}>
              <option value="">{t('po.selectVendor')}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.code} - {v.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('po.orderDate')} required>
            <Input type="date" value={form.order_date} onChange={e => setForm({...form, order_date: e.target.value})} />
          </FormField>
          <FormField label={t('po.expectedDelivery')}>
            <Input type="date" value={form.expected_delivery} onChange={e => setForm({...form, expected_delivery: e.target.value})} />
          </FormField>
          <FormField label={t('po.paymentTerms')}>
            <Input value={form.payment_terms} onChange={e => setForm({...form, payment_terms: e.target.value})} placeholder="e.g. NET 30" />
          </FormField>
          <FormField label={t('po.notes')}>
            <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
          </FormField>
          {!editing && (
          <FormField label="Import dari PR">
            <Select value={selectedPR} onChange={e => { setSelectedPR(e.target.value); if(e.target.value) importFromPR(e.target.value); }}>
              <option value="">-- Pilih PR --</option>
              {approvedPRs.map(pr => <option key={pr.id} value={pr.id}>{pr.pr_number} — {pr.departments?.name || ''}</option>)}
            </Select>
          </FormField>
          )}
        </div>


        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-sm">{t('po.addItem')}</h4>
            <button onClick={addLine} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ {t('po.addItem')}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50">
                <th className="p-2 text-left">{t('dashboard.item')}</th>
                <th className="p-2 text-center w-20">{t('items.purchaseUnit')}</th>
                <th className="p-2 text-right w-16">{t('po.qty')}</th>
                <th className="p-2 text-right w-28">{t('po.unitPrice')}</th>
                <th className="p-2 text-right w-16">{t('po.discount')}</th>
                <th className="p-2 text-right w-16">{t('po.tax')}</th>
                <th className="p-2 text-right w-28">{t('po.lineTotal')}</th>
                <th className="p-2 w-10"></th>
              </tr></thead>
              <tbody>
                {lineItems.map((line, idx) => {
                  const selItem = items.find(i => i.id === line.item_id);
                  const puAbbr = selItem?.purchase_unit?.abbreviation || '-';
                  return (
                  <tr key={idx} className="border-b">
                    <td className="p-2">
                      <SearchableItemSelect items={items} value={line.item_id} onChange={v => updateLine(idx, 'item_id', v)} placeholder={t('pr.selectItem')} />
                    </td>
                    <td className="p-2 text-center text-sm text-gray-600">{line.item_id ? puAbbr : '-'}</td>
                    <td className="p-2"><input {...intQtyInputProps} value={line.quantity} onChange={e => updateLine(idx, 'quantity', toIntQty(e.target.value))}
                      className="w-full px-2 py-1 border rounded text-sm text-right" /></td>
                    <td className="p-2"><input type="number" value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', parseFloat(e.target.value)||0)}
                      className="w-full px-2 py-1 border rounded text-sm text-right" min="0" /></td>
                    <td className="p-2"><input type="number" value={line.discount_percent} onChange={e => updateLine(idx, 'discount_percent', parseFloat(e.target.value)||0)}
                      className="w-full px-2 py-1 border rounded text-sm text-right" min="0" max="100" /></td>
                    <td className="p-2"><input type="number" value={line.tax_percent} onChange={e => updateLine(idx, 'tax_percent', parseFloat(e.target.value)||0)}
                      className="w-full px-2 py-1 border rounded text-sm text-right" min="0" max="100" /></td>
                    <td className="p-2 text-right font-medium">{formatCurrency(calcLineTotal(line))}</td>
                    <td className="p-2">{lineItems.length > 1 && <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600"><Icons.Trash /></button>}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-4"><span className="text-gray-500">{t('po.subtotal')}:</span><span className="w-28 text-right">{formatCurrency(grandSubtotal)}</span></div>
            <div className="flex gap-4"><span className="text-gray-500">{t('po.discountAmount')}:</span><span className="w-28 text-right text-red-500">-{formatCurrency(grandDiscount)}</span></div>
            <div className="flex gap-4"><span className="text-gray-500">{t('po.taxAmount')}:</span><span className="w-28 text-right">+{formatCurrency(grandTax)}</span></div>
            <div className="flex gap-4 font-bold text-base border-t pt-1"><span>{t('po.totalAmount')}:</span><span className="w-28 text-right">{formatCurrency(grandTotal)}</span></div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>

      {viewDoc && (
        <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={`PO Details: ${viewDoc.po_number}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded">
              <div>
                <p className="text-xs text-gray-500">{t('po.number')}</p>
                <p className="font-semibold">{viewDoc.po_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('po.orderDate')}</p>
                <p className="font-semibold">{formatDateSys(viewDoc.order_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('po.vendor')}</p>
                <p className="font-semibold">{viewDoc.vendors?.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('common.status')}</p>
                <StatusBadge status={viewDoc.status} />
              </div>
              {viewDoc.expected_delivery && (
                <div>
                  <p className="text-xs text-gray-500">{t('po.expectedDelivery')}</p>
                  <p className="font-semibold">{formatDateSys(viewDoc.expected_delivery)}</p>
                </div>
              )}
              {viewDoc.payment_terms && (
                <div>
                  <p className="text-xs text-gray-500">{t('po.paymentTerms')}</p>
                  <p className="font-semibold">{viewDoc.payment_terms}</p>
                </div>
              )}
              {viewDoc.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('po.notes')}</p>
                  <p className="text-sm">{viewDoc.notes}</p>
                </div>
              )}
            </div>
            {viewItems.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">{t('po.items')}</h4>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">{t('dashboard.item')}</th>
                      <th className="text-center p-2">{t('items.purchaseUnit')}</th>
                      <th className="text-right p-2">{t('po.qty')}</th>
                      <th className="text-right p-2">{t('po.unitPrice')}</th>
                      <th className="text-right p-2">{t('po.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((item, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2"><span className="font-mono text-xs">{item.items?.code}</span> - {item.items?.name}</td>
                        <td className="p-2 text-center">{item.items?.purchase_unit?.abbreviation || '-'}</td>
                        <td className="p-2 text-right">{formatNumber(item.quantity)}</td>
                        <td className="p-2 text-right">{formatCurrency(item.unit_price)}</td>
                        <td className="p-2 text-right font-medium">{formatCurrency(item.total_price)}</td>
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

export default PurchaseOrderPage;
