import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatCurrency, formatNumber, formatDate, formatDateSys, getLocalDateString } from '../utils/format.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { FormField } from '../components/FormField';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { StatusBadge } from '../components/StatusBadge';
import { Tab } from '../components/Tab';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function PurchaseInvoicePage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [pos, setPos] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ vendor_id: '', invoice_number: '', invoice_date: getLocalDateString(), due_date: '', po_id: '', notes: '' });
  const [lineItems, setLineItems] = useState([]);
  const [viewDoc, setViewDoc] = useState(null);
  const [viewItems, setViewItems] = useState([]);

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [piRes, vendorRes, itemRes, poRes, userRes] = await Promise.all([
      supabase.from('purchase_invoices').select('*, vendors(name, code), purchase_orders(po_number)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('vendors').select('*').eq('is_active', true).order('name'),
      supabase.from('items').select('id, code, name, unit_id, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation, name)').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('purchase_orders').select('id, po_number, vendor_id, status').eq('organization_id', selectedOrg.id).in('status', ['APPROVED','SENT','RECEIVED','PARTIAL_INVOICED']).order('po_number'),
      supabase.from('users').select('id, full_name').order('full_name'),
    ]);
    setInvoices(piRes.data || []);
    setVendors(vendorRes.data || []);
    setItems(itemRes.data || []);
    setPos(poRes.data || []);
    setUsers(userRes.data || []);
    setLoading(false);
  }

  function getUserName(userId) {
    if (!userId) return '-';
    const u = users.find(u => u.id === userId);
    return u ? u.full_name : '-';
  }

  async function openView(pi) {
    setViewDoc(pi);
    const { data } = await supabase.from('purchase_invoice_items').select('*, items(code, name, purchase_unit_id, purchase_unit:units!items_purchase_unit_id_fkey(abbreviation))').eq('pi_id', pi.id);
    setViewItems(data || []);
  }

  function openCreate() {
    setEditing(null);
    setForm({ vendor_id: '', invoice_number: '', invoice_date: getLocalDateString(), due_date: '', po_id: '', notes: '' });
    setLineItems([{ item_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 11 }]);
    setShowModal(true);
  }

  async function openEdit(pi) {
    setEditing(pi);
    setForm({ vendor_id: pi.vendor_id || '', invoice_number: pi.invoice_number || '', invoice_date: pi.invoice_date, due_date: pi.due_date || '', po_id: pi.po_id || '', notes: pi.notes || '' });
    const { data: piItems } = await supabase.from('purchase_invoice_items').select('*').eq('pi_id', pi.id);
    setLineItems((piItems || []).map(i => ({ item_id: i.item_id, quantity: i.quantity, unit_price: i.unit_price || 0, discount_percent: i.discount_percent || 0, tax_percent: i.tax_percent || 11 })));
    if (!piItems || piItems.length === 0) setLineItems([{ item_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 11 }]);
    setShowModal(true);
  }

  async function importFromPO(poId) {
    if (!poId) return;
    const selectedPO = pos.find(p => p.id === poId);
    if (selectedPO) setForm(f => ({ ...f, vendor_id: selectedPO.vendor_id || f.vendor_id, po_id: poId }));
    const { data: poItems } = await supabase.from('purchase_order_items').select('*').eq('po_id', poId);
    if (poItems && poItems.length > 0) {
      setLineItems(poItems.map(i => ({ item_id: i.item_id, quantity: i.quantity, unit_price: i.unit_price || 0, discount_percent: i.discount_percent || 0, tax_percent: i.tax_percent || 11 })));
    }
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

  async function generatePINumber() {
    const prefix = `PI-${selectedOrg.code}-`;
    const { data } = await supabase.from('purchase_invoices').select('invoice_number').eq('organization_id', selectedOrg.id).like('invoice_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].invoice_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleSave() {
    if (!form.vendor_id || lineItems.filter(l => l.item_id).length === 0) return;
    setSaving(true);
    try {
      // Validate invoice date
      const inputDate = new Date(form.invoice_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Invoice date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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
        const { error } = await supabase.from('purchase_invoices').update({
          vendor_id: form.vendor_id, invoice_number: form.invoice_number || null,
          invoice_date: form.invoice_date, due_date: form.due_date || null,
          po_id: form.po_id || null, notes: form.notes || null,
          subtotal, discount_amount: totalDiscount, tax_amount: totalTax, total_amount: totalAmount
        }).eq('id', editing.id);
        if (error) throw error;
        await supabase.from('purchase_invoice_items').delete().eq('pi_id', editing.id);
        const itemsPayload = validLines.map(l => ({
          pi_id: editing.id, item_id: l.item_id, quantity: l.quantity,
          unit_price: l.unit_price, discount_percent: l.discount_percent, tax_percent: l.tax_percent,
          total_price: calcLineTotal(l)
        }));
        const { error: itemErr } = await supabase.from('purchase_invoice_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      } else {
        const piNumber = await generatePINumber();
        const { data: newPI, error } = await supabase.from('purchase_invoices').insert({
          pi_number: piNumber, organization_id: selectedOrg.id, vendor_id: form.vendor_id,
          invoice_number: form.invoice_number || null, invoice_date: form.invoice_date,
          due_date: form.due_date || null, po_id: form.po_id || null,
          status: 'DRAFT', payment_status: 'UNPAID', notes: form.notes || null,
          subtotal, discount_amount: totalDiscount, tax_amount: totalTax, total_amount: totalAmount,
          created_by: currentUser?.id || null
        }).select().single();
        if (error) throw error;
        const itemsPayload = validLines.map(l => ({
          pi_id: newPI.id, item_id: l.item_id, quantity: l.quantity,
          unit_price: l.unit_price, discount_percent: l.discount_percent, tax_percent: l.tax_percent,
          total_price: calcLineTotal(l)
        }));
        const { error: itemErr } = await supabase.from('purchase_invoice_items').insert(itemsPayload);
        if (itemErr) throw itemErr;
      }
      showNotification(t('pi.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(pi) {
    if (pi.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + pi.status, 'error'); return; }
    if (!(await showConfirm(t('pi.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('purchase_invoice_items').delete().eq('pi_id', pi.id);
      const { error } = await supabase.from('purchase_invoices').delete().eq('id', pi.id);
      if (error) throw error;
      showNotification(t('pi.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function submitForApproval(pi) {
    if (!(await showConfirm('Submit for approval?', { variant: 'warning' }))) return;
    const upd = { status: 'PENDING', submitted_by: currentUser?.id, submitted_at: new Date().toISOString() };
    await supabase.from('purchase_invoices').update(upd).eq('id', pi.id);
    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: 'PI', document_id: pi.id,
      document_number: pi.pi_number, action: 'SUBMITTED', action_by: currentUser?.id,
    });
    showNotification(t('pi.title') + ' submitted for approval', 'success');
    loadAll();
  }

  async function markPaid(pi) {
    await supabase.from('purchase_invoices').update({ payment_status: 'PAID' }).eq('id', pi.id);
    showNotification(t('pi.markPaid'));
    loadAll();
  }

  const grandSubtotal = lineItems.reduce((s, l) => s + (l.quantity * l.unit_price), 0);
  const grandDiscount = lineItems.reduce((s, l) => s + (l.quantity * l.unit_price * l.discount_percent / 100), 0);
  const grandTax = lineItems.reduce((s, l) => { const b = l.quantity * l.unit_price; const d = b * (l.discount_percent/100); return s + ((b-d) * l.tax_percent / 100); }, 0);
  const grandTotal = grandSubtotal - grandDiscount + grandTax;

  const paymentBadgeColor = (ps) => ps === 'PAID' ? 'green' : ps === 'PARTIAL' ? 'yellow' : 'red';

  return (
    <div>
      <PageHeader title={t('pi.title')} subtitle={t('pi.subtitle')}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('pi.create')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('pi.number'), render: r => <button onClick={() => openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.pi_number}</button> },
            { header: t('pi.invoiceDate'), render: r => formatDateSys(r.invoice_date) },
            { header: t('pi.vendor'), render: r => r.vendors?.name || '-' },
            { header: t('pi.fromPO'), render: r => r.purchase_orders?.po_number ? <Badge color="blue">{r.purchase_orders.po_number}</Badge> : '-' },
            { header: t('pi.totalAmount'), align: 'right', render: r => formatCurrency(r.total_amount) },
            { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
            { header: t('approval.info'), render: r => r.approved_by ? (
              <div className="text-xs">
                <div className="font-medium text-green-700">{getUserName(r.approved_by)}</div>
                <div className="text-gray-400">{r.approved_at ? formatDateSys(r.approved_at) : ''}</div>
              </div>
            ) : r.status === 'PENDING' ? <span className="text-xs text-yellow-600">{t('approval.notApproved')}</span> : <span className="text-xs text-gray-400">-</span> },
            { header: t('pi.paymentStatus'), render: r => <Badge color={paymentBadgeColor(r.payment_status)}>{r.payment_status}</Badge> },
          ]}
          data={invoices}
          actions={(row) => (
            <div className="flex items-center gap-1">
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();submitForApproval(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">{t('pi.submit')}</button>}
              {row.status === 'APPROVED' && row.payment_status !== 'PAID' && <button onClick={e=>{e.stopPropagation();markPaid(row)}} className="p-1 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">{t('pi.markPaid')}</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit /></button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Icons.Trash /></button>}
            </div>
          )}
        />
        {invoices.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500"><Icons.ClipboardList /><p className="mt-2">{t('pi.empty')}</p></div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Invoice' : t('pi.create')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <FormField label={t('pi.vendor')} required>
            <Select value={form.vendor_id} onChange={e => setForm({...form, vendor_id: e.target.value})}>
              <option value="">{t('pi.selectVendor')}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.code} - {v.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('pi.invoiceNumber')}>
            <Input value={form.invoice_number} onChange={e => setForm({...form, invoice_number: e.target.value})} placeholder="INV-001" />
          </FormField>
          <FormField label={t('pi.invoiceDate')} required>
            <Input type="date" value={form.invoice_date} onChange={e => setForm({...form, invoice_date: e.target.value})} />
          </FormField>
          <FormField label={t('pi.dueDate')}>
            <Input type="date" value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} />
          </FormField>
          <FormField label={t('pi.importFromPO')}>
            <Select value={form.po_id} onChange={e => { setForm({...form, po_id: e.target.value}); importFromPO(e.target.value); }}>
              <option value="">{t('pi.selectPO')}</option>
              {pos.map(p => <option key={p.id} value={p.id}>{p.po_number}</option>)}
            </Select>
          </FormField>
          <FormField label={t('pi.notes')}>
            <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
          </FormField>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-sm">{t('pi.addItem')}</h4>
            <button onClick={addLine} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ {t('pi.addItem')}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50">
                <th className="p-2 text-left">{t('dashboard.item')}</th>
                <th className="p-2 text-center w-20">{t('items.purchaseUnit')}</th>
                <th className="p-2 text-right w-16">{t('pi.qty')}</th>
                <th className="p-2 text-right w-28">{t('pi.unitPrice')}</th>
                <th className="p-2 text-right w-16">{t('pi.discount')}</th>
                <th className="p-2 text-right w-16">{t('pi.tax')}</th>
                <th className="p-2 text-right w-28">{t('pi.lineTotal')}</th>
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
            <div className="flex gap-4"><span className="text-gray-500">{t('pi.subtotal')}:</span><span className="w-28 text-right">{formatCurrency(grandSubtotal)}</span></div>
            <div className="flex gap-4"><span className="text-gray-500">{t('pi.discountAmount')}:</span><span className="w-28 text-right text-red-500">-{formatCurrency(grandDiscount)}</span></div>
            <div className="flex gap-4"><span className="text-gray-500">{t('pi.taxAmount')}:</span><span className="w-28 text-right">+{formatCurrency(grandTax)}</span></div>
            <div className="flex gap-4 font-bold text-base border-t pt-1"><span>{t('pi.totalAmount')}:</span><span className="w-28 text-right">{formatCurrency(grandTotal)}</span></div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>

      {viewDoc && (
        <Modal open={!!viewDoc} onClose={() => setViewDoc(null)} title={`PI Details: ${viewDoc.pi_number}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded">
              <div>
                <p className="text-xs text-gray-500">{t('pi.number')}</p>
                <p className="font-semibold">{viewDoc.pi_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('pi.invoiceNumber')}</p>
                <p className="font-semibold">{viewDoc.invoice_number || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('pi.invoiceDate')}</p>
                <p className="font-semibold">{formatDateSys(viewDoc.invoice_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('pi.vendor')}</p>
                <p className="font-semibold">{viewDoc.vendors?.name}</p>
              </div>
              {viewDoc.po_id && (
                <div>
                  <p className="text-xs text-gray-500">{t('pi.fromPO')}</p>
                  <p className="font-semibold">{viewDoc.purchase_orders?.po_number}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">{t('common.status')}</p>
                <StatusBadge status={viewDoc.status} />
              </div>
              {viewDoc.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('pi.notes')}</p>
                  <p className="text-sm">{viewDoc.notes}</p>
                </div>
              )}
            </div>
            {viewItems.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">{t('pi.items')}</h4>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">{t('dashboard.item')}</th>
                      <th className="text-center p-2">{t('items.purchaseUnit')}</th>
                      <th className="text-right p-2">{t('pi.qty')}</th>
                      <th className="text-right p-2">{t('pi.unitPrice')}</th>
                      <th className="text-right p-2">{t('pi.lineTotal')}</th>
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

export default PurchaseInvoicePage;
