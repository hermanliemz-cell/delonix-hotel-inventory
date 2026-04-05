import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatNumber, formatDateSys, getLocalDateString } from '../utils/format';
import { checkPeriodLock, getBalanceAfter } from '../utils/stock.js';
import { recordMovement, deleteMovementsByRef } from '../services/stockService.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Badge } from '../components/Badge';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function PurchaseReceivedPage() {
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const { t } = useTranslation();
  const [receipts, setReceipts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ pi_id: '', received_date: getLocalDateString(), notes: '', department_id: '' });
  const [lineItems, setLineItems] = useState([]);
  const [selectedPI, setSelectedPI] = useState(null);
  const [viewDoc, setViewDoc] = useState(null);
  const [viewItems, setViewItems] = useState([]);

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [grRes, piRes, itemRes, whRes, deptRes] = await Promise.all([
      supabase.from('purchase_received').select('*, vendors(name, code), purchase_invoices(pi_number, invoice_number), departments(name, code)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('purchase_invoices').select('*, vendors(name, code)').eq('organization_id', selectedOrg.id).eq('status', 'APPROVED').order('pi_number'),
      supabase.from('items').select('id, code, name, default_warehouse_id').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('warehouses').select('*').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      supabase.from('departments').select('id, code, name').eq('is_active', true).order('name'),
    ]);
    setReceipts(grRes.data || []);
    setInvoices(piRes.data || []);
    setAllItems(itemRes.data || []);
    setWarehouses(whRes.data || []);
    setDepartments(deptRes.data || []);
    setLoading(false);
  }

  async function generateGRNumber() {
    const prefix = `GR-${selectedOrg.code}-`;
    const { data } = await supabase.from('goods_receipts').select('gr_number').eq('organization_id', selectedOrg.id).like('gr_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].gr_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function loadPIItems(piId) {
    if (!piId) { setLineItems([]); setSelectedPI(null); return; }
    const pi = invoices.find(p => p.id === piId);
    setSelectedPI(pi);
    setForm(f => ({ ...f, pi_id: piId }));

    // Auto-populate department from chain PI → PO → PR
    try {
      if (pi?.po_id) {
        const { data: poData } = await supabase.from('purchase_orders').select('pr_id, pr_reference_id').eq('id', pi.po_id).single();
        const prId = poData?.pr_reference_id || poData?.pr_id;
        if (prId) {
          const { data: prData } = await supabase.from('purchase_requests').select('department_id').eq('id', prId).single();
          if (prData?.department_id) setForm(f => ({ ...f, department_id: prData.department_id }));
        }
      }
    } catch (e) { /* ignore lookup errors */ }

    // Load PI line items
    const { data: piItems } = await supabase.from('purchase_invoice_items').select('*').eq('pi_id', piId);

    // Load previously received quantities for this PI
    const { data: prevGRs } = await supabase.from('purchase_received').select('id').eq('pi_id', piId).eq('status', 'CONFIRMED');
    let prevReceivedMap = {};
    if (prevGRs && prevGRs.length > 0) {
      const grIds = prevGRs.map(g => g.id);
      const { data: prevItems } = await supabase.from('purchase_received_items').select('item_id, received_qty').in('gr_id', grIds);
      (prevItems || []).forEach(pi => {
        prevReceivedMap[pi.item_id] = (prevReceivedMap[pi.item_id] || 0) + parseFloat(pi.received_qty);
      });
    }

    const lines = (piItems || []).map(pi => {
      const item = allItems.find(i => i.id === pi.item_id);
      const prevReceived = prevReceivedMap[pi.item_id] || 0;
      const remaining = parseFloat(pi.quantity) - prevReceived;
      return {
        item_id: pi.item_id,
        item_code: item?.code || '',
        item_name: item?.name || '',
        pi_qty: parseFloat(pi.quantity),
        unit_price: parseFloat(pi.unit_price) || 0,
        prev_received: prevReceived,
        remaining: remaining,
        received_qty: remaining > 0 ? remaining : 0,
        warehouse_id: item?.default_warehouse_id || '',
      };
    });
    setLineItems(lines);
  }

  async function openView(gr) {
    setViewDoc(gr);
    const { data } = await supabase.from('purchase_received_items').select('*, items(code, name)').eq('gr_id', gr.id);
    setViewItems(data || []);
  }

  function openCreate() {
    setForm({ pi_id: '', received_date: getLocalDateString(), notes: '', department_id: currentUser?.department_id || '' });
    setLineItems([]);
    setSelectedPI(null);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.pi_id || lineItems.length === 0) { showNotification('Please select a Purchase Invoice', 'error'); return; }
    const validLines = lineItems.filter(l => l.received_qty > 0);
    if (validLines.length === 0) { showNotification('No items to receive', 'error'); return; }

    // Validate warehouse is selected for every line
    for (const l of validLines) {
      if (!l.warehouse_id) {
        showNotification(t('gr.errorNoWarehouse') + `: ${l.item_code}`, 'error');
        return;
      }
    }

    // Validate no line exceeds remaining
    for (const l of validLines) {
      if (l.received_qty > l.remaining + 0.001) {
        showNotification(t('gr.errorOverQty') + `: ${l.item_code}`, 'error');
        return;
      }
    }

    // Check period lock based on received date
    const lockCheck = await checkPeriodLock(selectedOrg.id, form.received_date || new Date().toISOString());
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
      return;
    }

    setSaving(true);
    try {
      const grNumber = await generateGRNumber();
      const pi = invoices.find(p => p.id === form.pi_id);
      const { data: newGR, error } = await supabase.from('purchase_received').insert({
        organization_id: selectedOrg.id,
        gr_number: grNumber,
        pi_id: form.pi_id,
        vendor_id: pi?.vendor_id || null,
        received_date: form.received_date,
        notes: form.notes || null,
        status: 'DRAFT',
        department_id: form.department_id || null,
      }).select().single();
      if (error) throw error;

      const itemsPayload = validLines.map(l => ({
        gr_id: newGR.id,
        item_id: l.item_id,
        pi_item_qty: l.pi_qty,
        received_qty: l.received_qty,
        unit_price: l.unit_price,
        warehouse_id: l.warehouse_id || null,
      }));
      const { error: itemErr } = await supabase.from('purchase_received_items').insert(itemsPayload);
      if (itemErr) throw itemErr;

      showNotification(t('gr.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification(t('gr.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function confirmReceipt(gr) {
    if (!(await showConfirm(t('gr.confirmReceipt'), { variant: 'warning' }))) return;
    try {
      // Check period lock based on received date
      const lockCheck = await checkPeriodLock(selectedOrg.id, gr.received_date || new Date().toISOString());
      if (lockCheck.locked) {
        showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
        return;
      }

      // Load GR items
      const { data: grItems, error: grErr } = await supabase.from('purchase_received_items').select('*').eq('gr_id', gr.id);
      if (grErr) throw new Error('Failed to load GR items: ' + grErr.message);
      if (!grItems || grItems.length === 0) throw new Error('No items in this receipt');

      // Use currentUser's department as primary source, fallback to GR record, then chain lookup
      let grDepartmentId = currentUser?.department_id || gr.department_id || null;
      if (!grDepartmentId && gr.pi_id) {
        const { data: piData } = await supabase.from('purchase_invoices').select('po_id').eq('id', gr.pi_id).single();
        if (piData?.po_id) {
          const { data: poData } = await supabase.from('purchase_orders').select('pr_id, pr_reference_id').eq('id', piData.po_id).single();
          const prId = poData?.pr_reference_id || poData?.pr_id;
          if (prId) {
            const { data: prData } = await supabase.from('purchase_requests').select('department_id').eq('id', prId).single();
            if (prData?.department_id) grDepartmentId = prData.department_id;
          }
        }
      }

      // Create stock movements and update stock balance for each item
      for (const item of grItems) {
        const qty = parseFloat(item.received_qty);
        if (qty <= 0) continue;
        const unitPrice = parseFloat(item.unit_price) || 0;
        const totalCost = qty * unitPrice;

        const { error: smErr } = await recordMovement({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          warehouseId: item.warehouse_id || null,
          departmentId: grDepartmentId,
          movementType: 'IN',
          quantity: qty,
          unitCost: unitPrice,
          referenceType: 'GR',
          referenceNumber: gr.gr_number,
          referenceId: gr.id,
          notes: 'Goods received from ' + (gr.purchase_invoices?.pi_number || 'PI'),
        });
        if (smErr) throw new Error('Stock movement error: ' + smErr.message);
      }

      // Update GR status to CONFIRMED
      await supabase.from('purchase_received').update({ status: 'CONFIRMED' }).eq('id', gr.id);

      // Update PI status to RECEIVED if all items fully received
      if (gr.pi_id) {
        const { data: piItems } = await supabase.from('purchase_invoice_items').select('item_id, quantity').eq('pi_id', gr.pi_id);
        const { data: allGRs } = await supabase.from('purchase_received').select('id').eq('pi_id', gr.pi_id).eq('status', 'CONFIRMED');
        const grIds = (allGRs || []).map(g => g.id);
        // Include the current GR we just confirmed
        if (!grIds.includes(gr.id)) grIds.push(gr.id);
        const { data: allGRItems } = await supabase.from('purchase_received_items').select('item_id, received_qty').in('gr_id', grIds);

        let totalReceivedMap = {};
        (allGRItems || []).forEach(g => {
          totalReceivedMap[g.item_id] = (totalReceivedMap[g.item_id] || 0) + parseFloat(g.received_qty);
        });

        const allFullyReceived = (piItems || []).every(pi => {
          const received = totalReceivedMap[pi.item_id] || 0;
          return received >= parseFloat(pi.quantity) - 0.001;
        });

        if (allFullyReceived) {
          await supabase.from('purchase_invoices').update({ status: 'RECEIVED' }).eq('id', gr.pi_id);
        }
      }

      showNotification(t('gr.successConfirm'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function handleDelete(gr) {
    if (gr.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + gr.status, 'error'); return; }
    if (!(await showConfirm(t('gr.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('purchase_received_items').delete().eq('gr_id', gr.id);
      const { error } = await supabase.from('purchase_received').delete().eq('id', gr.id);
      if (error) throw error;
      showNotification(t('gr.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function handleRevokeGR(gr) {
    if (gr.status !== 'CONFIRMED') return;
    const userRole = currentUser?.role?.code || '';
    if (userRole !== 'superadmin' && userRole !== 'gm') {
      showNotification('Only GM or Superadmin can revoke', 'error'); return;
    }
    // Check period lock
    const lockCheck = await checkPeriodLock(selectedOrg.id, gr.received_date || new Date().toISOString());
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot revoke in locked period.', 'error');
      return;
    }
    // Superadmin dan GM boleh revoke dokumen sendiri
    if (!(await showConfirm(`Revoke GR ${gr.gr_number}? Stock movements will be reversed.`, { variant: 'danger' }))) return;
    try {
      // Load GR items to reverse stock
      const { data: grItems } = await supabase.from('purchase_received_items').select('*').eq('gr_id', gr.id);
      if (!grItems || grItems.length === 0) throw new Error('No items found');

      // Reverse stock movements via RPC (trigger auto-revert stock_balance)
      const { error: delErr } = await deleteMovementsByRef({
        organizationId: selectedOrg.id,
        referenceType: 'GR',
        referenceId: gr.id,
      });
      if (delErr) throw delErr;

      // Revert GR status to DRAFT
      await supabase.from('purchase_received').update({ status: 'DRAFT' }).eq('id', gr.id);

      // If PI was marked as RECEIVED, revert PI status back to APPROVED
      if (gr.pi_id) {
        const { data: piData } = await supabase.from('purchase_invoices').select('status').eq('id', gr.pi_id).single();
        if (piData?.status === 'RECEIVED') {
          await supabase.from('purchase_invoices').update({ status: 'APPROVED' }).eq('id', gr.pi_id);
        }
      }

      showNotification(gr.gr_number + ' revoked to draft', 'success');
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  function updateLine(idx, field, val) {
    const nl = [...lineItems];
    nl[idx] = { ...nl[idx], [field]: val };
    setLineItems(nl);
  }

  return (
    <div>
      <PageHeader title={t('gr.title')} subtitle={t('gr.subtitle')}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('gr.create')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('gr.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.gr_number}</button> },
            { header: t('gr.receivedDate'), render: r => formatDateSys(r.received_date) },
            { header: t('pi.vendor'), render: r => r.vendors?.name || '-' },
            { header: t('gr.fromPI'), render: r => r.purchase_invoices?.pi_number ? <Badge color="blue">{r.purchase_invoices.pi_number}</Badge> : '-' },
            { header: t('writeoff.department'), render: r => r.departments?.code ? <Badge color="blue">{r.departments.code}</Badge> : '-' },
            { header: t('gr.status'), render: r => <Badge color={r.status === 'CONFIRMED' ? 'green' : 'yellow'}>{r.status}</Badge> },
            { header: t('gr.notes'), render: r => r.notes || '-' },
          ]}
          data={receipts}
          actions={(row) => (
            <div className="flex items-center gap-1">
              <button onClick={e=>{e.stopPropagation();openView(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"><Icons.Eye /> Detail</button>
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();confirmReceipt(row)}} className="p-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100">{t('gr.confirm')}</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Icons.Trash /></button>}
              {row.status === 'CONFIRMED' && (currentUser?.role?.code === 'superadmin' || currentUser?.role?.code === 'gm') && (
                <button onClick={e=>{e.stopPropagation();handleRevokeGR(row)}} className="p-1 text-xs bg-orange-50 text-orange-600 rounded hover:bg-orange-100"><Icons.RotateCcw /> Revoke</button>
              )}
            </div>
          )}
        />
        {receipts.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500"><Icons.Truck /><p className="mt-2">{t('gr.empty')}</p></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={t('gr.create')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <FormField label="User">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.full_name || currentUser?.username || '-'}
            </div>
          </FormField>
          <FormField label={t('writeoff.department')}>
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
            </div>
          </FormField>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
          <FormField label={t('gr.selectPI')} required>
            <Select value={form.pi_id} onChange={e => loadPIItems(e.target.value)}>
              <option value="">{t('gr.selectPI')}</option>
              {invoices.map(pi => <option key={pi.id} value={pi.id}>{pi.pi_number} - {pi.vendors?.name || ''} ({pi.invoice_number || ''})</option>)}
            </Select>
          </FormField>
          <FormField label={t('gr.receivedDate')} required>
            <Input type="date" value={form.received_date} onChange={e => setForm({...form, received_date: e.target.value})} />
          </FormField>
          <FormField label="">
            <div></div>
          </FormField>
          <FormField label={t('gr.notes')}>
            <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder={t('gr.notes')} />
          </FormField>
        </div>

        {lineItems.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="font-semibold text-sm mb-3">{t('pi.addItem')}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50">
                  <th className="p-2 text-left">{t('dashboard.item')}</th>
                  <th className="p-2 text-right w-20">{t('gr.piQty')}</th>
                  <th className="p-2 text-right w-20">{t('gr.prevReceived')}</th>
                  <th className="p-2 text-right w-20">{t('gr.remaining')}</th>
                  <th className="p-2 text-right w-24">{t('gr.receivedQty')}</th>
                  <th className="p-2 text-left w-40">{t('gr.warehouse')}</th>
                </tr></thead>
                <tbody>
                  {lineItems.map((line, idx) => (
                    <tr key={idx} className={`border-b ${line.remaining <= 0 ? 'bg-gray-50 opacity-50' : ''}`}>
                      <td className="p-2"><span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-1">{line.item_code}</span> {line.item_name}</td>
                      <td className="p-2 text-right font-medium">{formatNumber(line.pi_qty)}</td>
                      <td className="p-2 text-right">{line.prev_received > 0 ? <span className="text-blue-600">{formatNumber(line.prev_received)}</span> : <span className="text-gray-300">0</span>}</td>
                      <td className="p-2 text-right">{line.remaining > 0 ? <span className="text-orange-600 font-medium">{formatNumber(line.remaining)}</span> : <span className="text-green-600 font-medium">Done</span>}</td>
                      <td className="p-2">
                        <input {...intQtyInputProps} max={line.remaining}
                          value={line.received_qty} onChange={e => updateLine(idx, 'received_qty', toIntQty(e.target.value))}
                          className="w-full px-2 py-1 border rounded text-sm text-right" disabled={line.remaining <= 0} />
                      </td>
                      <td className="p-2">
                        <select value={line.warehouse_id} onChange={e => updateLine(idx, 'warehouse_id', e.target.value)}
                          className="w-full px-2 py-1 border rounded text-sm">
                          <option value="">{t('gr.selectWarehouse')}</option>
                          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || lineItems.length === 0}>{t('common.save')}</Button>
        </div>
      </Modal>

      {viewDoc && (
        <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={`GR Details: ${viewDoc.gr_number}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded">
              <div>
                <p className="text-xs text-gray-500">{t('gr.number')}</p>
                <p className="font-semibold">{viewDoc.gr_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('gr.receivedDate')}</p>
                <p className="font-semibold">{formatDateSys(viewDoc.received_date)}</p>
              </div>
              {viewDoc.purchase_invoices && (
                <div>
                  <p className="text-xs text-gray-500">{t('gr.fromPI')}</p>
                  <p className="font-semibold">{viewDoc.purchase_invoices.pi_number}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">{t('gr.status')}</p>
                <Badge color={viewDoc.status === 'CONFIRMED' ? 'green' : 'yellow'}>{viewDoc.status}</Badge>
              </div>
              {viewDoc.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('gr.notes')}</p>
                  <p className="text-sm">{viewDoc.notes}</p>
                </div>
              )}
            </div>
            {viewItems.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">{t('gr.items')}</h4>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">{t('dashboard.item')}</th>
                      <th className="text-right p-2">{t('gr.piQty')}</th>
                      <th className="text-right p-2">{t('gr.receivedQty')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewItems.map((item, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2"><span className="font-mono text-xs">{item.items?.code}</span> - {item.items?.name}</td>
                        <td className="p-2 text-right">{formatNumber(item.pi_item_qty)}</td>
                        <td className="p-2 text-right font-medium">{formatNumber(item.received_qty)}</td>
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

export default PurchaseReceivedPage;
