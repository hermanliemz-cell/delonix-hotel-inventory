import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { recordMovement } from '../services/stockService.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Icons } from '../components/Icons';
import { formatCurrency, formatNumber, formatDate, formatDateSys, getLocalDateString } from '../utils/format';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
import { Badge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { DocDetailModal } from '../components/DocDetailModal';
import { Button, Input } from '../components/FormElements';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { FormField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader } from '../components/PageLoader';

export default function AdjustmentPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [adjustments, setAdjustments] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ warehouse_id: '', description: '', notes: '' });
  const [lineItems, setLineItems] = useState([]);
  const [itemSearch, setItemSearch] = useState({});
  const [viewAdj, setViewAdj] = useState(null);
  const [viewAdjItems, setViewAdjItems] = useState([]);
  const [viewAdjLoading, setViewAdjLoading] = useState(false);

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [adjRes, itemRes, whRes] = await Promise.all([
      supabase.from('adjustments').select('*, departments(name, code), warehouses(name, code)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('items').select('id, code, name, usage_unit:units!items_usage_unit_id_fkey(abbreviation)').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('warehouses').select('id, code, name, warehouse_type').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
    ]);
    setAdjustments(adjRes.data || []);
    setItems(itemRes.data || []);
    setWarehouses(whRes.data || []);
    setLoading(false);
  }

  async function openViewAdj(adj) {
    setViewAdj(adj);
    setViewAdjLoading(true);
    try {
      const { data } = await supabase.from('adjustment_items').select('*, items(code, name)').eq('adjustment_id', adj.id);
      setViewAdjItems(data || []);
    } catch (err) {
      setViewAdjItems([]);
    }
    setViewAdjLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ warehouse_id: warehouses[0]?.id || '', description: '', notes: '' });
    setLineItems([{ item_id: '', quantity: 0, unit_cost: 0, total_cost: 0, notes: '' }]);
    setItemSearch({});
    setShowModal(true);
  }

  async function openEdit(adj) {
    setEditing(adj);
    setForm({ warehouse_id: adj.warehouse_id || '', description: adj.description || '', notes: adj.notes || '' });
    const { data: adjItems } = await supabase.from('adjustment_items').select('*').eq('adjustment_id', adj.id);
    setLineItems((adjItems || []).map(i => ({ item_id: i.item_id, quantity: parseFloat(i.quantity), unit_cost: parseFloat(i.unit_cost), total_cost: parseFloat(i.total_cost), notes: i.notes || '' })));
    if (!adjItems || adjItems.length === 0) setLineItems([{ item_id: '', quantity: 0, unit_cost: 0, total_cost: 0, notes: '' }]);
    setItemSearch({});
    setShowModal(true);
  }

  function addLine() { setLineItems([...lineItems, { item_id: '', quantity: 0, unit_cost: 0, total_cost: 0, notes: '' }]); }
  function removeLine(idx) { setLineItems(lineItems.filter((_, i) => i !== idx)); }
  function updateLine(idx, field, val) {
    const nl = [...lineItems];
    nl[idx] = { ...nl[idx], [field]: val };
    if (field === 'quantity' || field === 'unit_cost') {
      nl[idx].total_cost = parseFloat(nl[idx].quantity || 0) * parseFloat(nl[idx].unit_cost || 0);
    }
    setLineItems(nl);
  }

  async function generateADJNumber() {
    const prefix = `ADJ-${selectedOrg.code}-`;
    const { data } = await supabase.from('adjustments').select('adj_number').eq('organization_id', selectedOrg.id).like('adj_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].adj_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleSave() {
    if (!form.warehouse_id || lineItems.filter(l => l.item_id).length === 0) {
      showNotification('Pilih warehouse dan minimal 1 item', 'error');
      return;
    }
    setSaving(true);
    try {
      const validLines = lineItems.filter(l => l.item_id);
      if (editing) {
        const { error } = await supabase.from('adjustments').update({
          warehouse_id: form.warehouse_id, description: form.description || null,
          notes: form.notes || null, updated_at: new Date().toISOString(),
        }).eq('id', editing.id);
        if (error) throw error;
        await supabase.from('adjustment_items').delete().eq('adjustment_id', editing.id);
        const itemsPayload = validLines.map(l => ({
          adjustment_id: editing.id, item_id: l.item_id,
          quantity: parseFloat(l.quantity) || 0,
          unit_cost: parseFloat(l.unit_cost) || 0,
          total_cost: parseFloat(l.total_cost) || 0,
          notes: l.notes || null,
        }));
        await supabase.from('adjustment_items').insert(itemsPayload);
      } else {
        const adjNumber = await generateADJNumber();
        const { data: newAdj, error } = await supabase.from('adjustments').insert({
          adj_number: adjNumber, organization_id: selectedOrg.id,
          warehouse_id: form.warehouse_id,
          department_id: currentUser?.department_id || null,
          adjustment_date: getLocalDateString(),
          description: form.description || null, notes: form.notes || null,
          status: 'DRAFT', created_by: currentUser?.id,
        }).select().single();
        if (error) throw error;
        const itemsPayload = validLines.map(l => ({
          adjustment_id: newAdj.id, item_id: l.item_id,
          quantity: parseFloat(l.quantity) || 0,
          unit_cost: parseFloat(l.unit_cost) || 0,
          total_cost: parseFloat(l.total_cost) || 0,
          notes: l.notes || null,
        }));
        await supabase.from('adjustment_items').insert(itemsPayload);
      }
      showNotification('Adjustment berhasil disimpan', 'success');
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(adj) {
    if (adj.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + adj.status, 'error'); return; }
    if (!(await showConfirm('Hapus adjustment ' + adj.adj_number + '?', { variant: 'danger' }))) return;
    try {
      const { error } = await supabase.from('adjustments').delete().eq('id', adj.id);
      if (error) throw error;
      showNotification('Adjustment berhasil dihapus', 'success');
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function handleConfirm(adj) {
    if (adj.status !== 'DRAFT') { showNotification('Hanya dokumen DRAFT yang bisa di-confirm', 'error'); return; }
    if (!(await showConfirm('Confirm adjustment ' + adj.adj_number + '? Stok akan diperbarui.', { variant: 'warning' }))) return;
    try {
      const now = new Date().toISOString();
      const { data: adjItems } = await supabase.from('adjustment_items').select('*').eq('adjustment_id', adj.id);
      if (!adjItems || adjItems.length === 0) { showNotification('Tidak ada item untuk di-confirm', 'error'); return; }

      for (const ai of adjItems) {
        const qty = parseFloat(ai.quantity);
        const unitCost = parseFloat(ai.unit_cost) || 0;
        const totalCost = parseFloat(ai.total_cost) || 0;

        const { error: mvErr } = await recordMovement({
          organizationId: selectedOrg.id,
          itemId: ai.item_id,
          warehouseId: adj.warehouse_id,
          movementType: qty >= 0 ? 'IN' : 'OUT',
          quantity: Math.abs(qty),
          unitCost: unitCost,
          referenceType: 'ADJUSTMENT',
          referenceNumber: adj.adj_number,
          referenceId: adj.id,
          departmentId: adj.department_id || null,
          notes: ai.notes || 'Stock Adjustment',
        });
        if (mvErr) throw mvErr;
      }

      await supabase.from('adjustments').update({
        status: 'CONFIRMED', confirmed_by: currentUser?.id,
        confirmed_at: now, updated_at: now,
      }).eq('id', adj.id);

      showNotification(adj.adj_number + ' confirmed — stok diperbarui', 'success');
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  const grandTotal = useMemo(() => lineItems.reduce((sum, l) => sum + (parseFloat(l.total_cost) || 0), 0), [lineItems]);

  return (
    <div>
      <PageHeader title="Adjustment" subtitle="Stock adjustment documents"
        actions={<Button onClick={openCreate}><Icons.Plus /> Create Adjustment</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: 'No. Dokumen', render: r => <button onClick={() => openViewAdj(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.adj_number}</button> },
            { header: 'Tanggal', render: r => formatDateSys(r.adjustment_date) },
            { header: 'Warehouse', render: r => <Badge color="green">{r.warehouses?.code || '-'}</Badge> },
            { header: 'Dept', render: r => <Badge color="blue">{r.departments?.code || '-'}</Badge> },
            { header: 'Description', render: r => <span className="text-xs text-gray-600 truncate max-w-[200px] block">{r.description || '-'}</span> },
            { header: 'Status', render: r => <StatusBadge status={r.status}/> },
          ]}
          data={adjustments}
          actions={(row) => (
            <div className="flex items-center gap-1">
              <button onClick={e=>{e.stopPropagation();openViewAdj(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-0.5"><Icons.Eye /> Detail</button>
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleConfirm(row)}} className="p-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 flex items-center gap-0.5"><Icons.Check /> Confirm</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1 text-xs bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100 flex items-center gap-0.5"><Icons.Edit /> Edit</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-0.5"><Icons.Trash /> Hapus</button>}
            </div>
          )}
        />
        {adjustments.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500">Belum ada dokumen adjustment</div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Adjustment' : 'Create Adjustment'} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <FormField label="Date">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {editing ? formatDateSys(editing.adjustment_date) : formatDateSys(getLocalDateString())}
            </div>
          </FormField>
          <FormField label="Department">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
            </div>
          </FormField>
          <FormField label="User">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.full_name || currentUser?.username || '-'}
            </div>
          </FormField>
          <FormField label="Warehouse" required>
            <select value={form.warehouse_id} onChange={e => setForm({...form, warehouse_id: e.target.value})}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">-- Pilih Warehouse --</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description">
              <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Deskripsi adjustment..." />
            </FormField>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-sm">Item Adjustment</h4>
            <button onClick={addLine} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ Tambah Item</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50">
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right w-24">Qty (+/-)</th>
              <th className="p-2 text-right w-32">Cost/Unit</th>
              <th className="p-2 text-right w-32">Total Cost</th>
              <th className="p-2 text-left w-40">Notes</th>
              <th className="p-2 w-10"></th>
            </tr></thead>
            <tbody>
              {lineItems.map((line, idx) => {
                const searchKey = itemSearch[idx] || '';
                const filteredItems = searchKey
                  ? items.filter(i => (i.code + ' ' + i.name).toLowerCase().includes(searchKey.toLowerCase()))
                  : items;
                return (
                <tr key={idx} className="border-b">
                  <td className="p-2">
                    <div className="relative">
                      {line.item_id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">{items.find(i=>i.id===line.item_id)?.code} - {items.find(i=>i.id===line.item_id)?.name}</span>
                          <button onClick={() => { updateLine(idx, 'item_id', ''); setItemSearch({...itemSearch, [idx]: ''}); }} className="text-gray-400 hover:text-red-500 text-xs">&times;</button>
                        </div>
                      ) : (
                        <div>
                          <input type="text" placeholder="Cari item..." value={searchKey}
                            onChange={e => setItemSearch({...itemSearch, [idx]: e.target.value})}
                            className="w-full px-2 py-1 border rounded text-sm" />
                          {searchKey && filteredItems.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                              {filteredItems.slice(0, 20).map(i => (
                                <div key={i.id} onClick={() => { updateLine(idx, 'item_id', i.id); setItemSearch({...itemSearch, [idx]: ''}); }}
                                  className="px-2 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-b border-gray-50">
                                  <span className="font-medium">{i.code}</span> - {i.name} <span className="text-gray-400">({i.usage_unit?.abbreviation || '-'})</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-2"><input {...intQtyInputProps} value={line.quantity} onChange={e => updateLine(idx, 'quantity', toIntQty(e.target.value))}
                    className="w-full px-2 py-1 border rounded text-sm text-right" /></td>
                  <td className="p-2"><input type="number" value={line.unit_cost} onChange={e => updateLine(idx, 'unit_cost', parseFloat(e.target.value)||0)}
                    className="w-full px-2 py-1 border rounded text-sm text-right" min="0" step="any" /></td>
                  <td className="p-2 text-right">
                    <span className={`text-xs font-semibold ${line.total_cost >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {(line.total_cost || 0).toLocaleString('id-ID', {minimumFractionDigits: 0, maximumFractionDigits: 2})}
                    </span>
                  </td>
                  <td className="p-2"><input value={line.notes || ''} onChange={e => updateLine(idx, 'notes', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm" placeholder="Notes..." /></td>
                  <td className="p-2">{lineItems.length > 1 && <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600"><Icons.Trash /></button>}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-semibold">
                <td colSpan="3" className="p-2 text-right text-xs text-gray-600">Grand Total:</td>
                <td className="p-2 text-right">
                  <span className={`text-sm font-bold ${grandTotal >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {grandTotal.toLocaleString('id-ID', {minimumFractionDigits: 0, maximumFractionDigits: 2})}
                  </span>
                </td>
                <td colSpan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4">
          <FormField label="Notes">
            <Input value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Catatan tambahan..." />
          </FormField>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Save')}</Button>
        </div>
      </Modal>

      <Modal open={!!viewAdj} onClose={() => setViewAdj(null)} title={`Detail Adjustment - ${viewAdj?.adj_number || ''}`} size="lg">
        {viewAdj && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500">No. Dokumen</p>
                <p className="font-mono text-sm font-semibold">{viewAdj.adj_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Tanggal</p>
                <p className="text-sm">{formatDateSys(viewAdj.adjustment_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Warehouse</p>
                <p className="text-sm">{viewAdj.warehouses?.code ? `${viewAdj.warehouses.code} - ${viewAdj.warehouses.name}` : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Department</p>
                <p className="text-sm">{viewAdj.departments?.code ? `${viewAdj.departments.code} - ${viewAdj.departments.name}` : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Description</p>
                <p className="text-sm">{viewAdj.description || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <StatusBadge status={viewAdj.status} />
              </div>
              {viewAdj.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Notes</p>
                  <p className="text-sm">{viewAdj.notes}</p>
                </div>
              )}
            </div>
            <div className="border-t pt-3">
              <h4 className="font-semibold text-sm mb-2">Items</h4>
              {viewAdjLoading ? <PageLoader /> : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50">
                    <th className="p-2 text-left">Item</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2 text-right">Cost/Unit</th>
                    <th className="p-2 text-right">Total Cost</th>
                    <th className="p-2 text-left">Notes</th>
                  </tr></thead>
                  <tbody>
                    {viewAdjItems.map(ai => (
                      <tr key={ai.id} className="border-b">
                        <td className="p-2 text-xs"><span className="font-medium">{ai.items?.code}</span> - {ai.items?.name}</td>
                        <td className={`p-2 text-right text-xs font-semibold ${parseFloat(ai.quantity) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{parseFloat(ai.quantity)}</td>
                        <td className="p-2 text-right text-xs">{parseFloat(ai.unit_cost).toLocaleString('id-ID')}</td>
                        <td className={`p-2 text-right text-xs font-semibold ${parseFloat(ai.total_cost) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{parseFloat(ai.total_cost).toLocaleString('id-ID')}</td>
                        <td className="p-2 text-xs text-gray-500">{ai.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td colSpan="3" className="p-2 text-right text-xs">Grand Total:</td>
                      <td className="p-2 text-right text-sm font-bold text-blue-700">
                        {viewAdjItems.reduce((s, ai) => s + parseFloat(ai.total_cost || 0), 0).toLocaleString('id-ID')}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}