import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatDateSys, getLocalDateString } from '../utils/format';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Badge } from '../components/Badge';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader } from '../components/PageLoader';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function WriteOffPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [writeoffs, setWriteoffs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ department_id: '', write_off_date: getLocalDateString(), notes: '' });
  const [lineItems, setLineItems] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [itemSearch, setItemSearch] = useState({});
  const [viewWo, setViewWo] = useState(null);
  const [viewWoItems, setViewWoItems] = useState([]);
  const [viewWoLoading, setViewWoLoading] = useState(false);

  useEffect(() => { if(selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    const [woRes, deptRes, itemRes, sbRes] = await Promise.all([
      supabase.from('write_offs').select('*, departments(name, code)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }),
      supabase.from('departments').select('*').eq('is_active', true).order('name'),
      supabase.from('items').select('id, code, name').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
      supabase.from('stock_balance').select('item_id, quantity').eq('organization_id', selectedOrg.id).gt('quantity', 0),
    ]);
    setWriteoffs(woRes.data || []);
    setDepartments(deptRes.data || []);
    // Filter items that have stock > 0
    const stockMap = {};
    (sbRes.data || []).forEach(s => { stockMap[s.item_id] = (stockMap[s.item_id] || 0) + parseFloat(s.quantity); });
    const itemsWithStock = (itemRes.data || []).filter(i => stockMap[i.id] && stockMap[i.id] > 0);
    setItems(itemsWithStock);
    setStockItems(stockMap);
    setLoading(false);
  }

  async function openViewWo(wo) {
    setViewWo(wo);
    setViewWoLoading(true);
    try {
      const { data } = await supabase.from('write_off_items').select('*, items(code, name, unit)').eq('write_off_id', wo.id);
      setViewWoItems(data || []);
    } catch (err) {
      setViewWoItems([]);
    }
    setViewWoLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ department_id: currentUser?.department_id || departments[0]?.id || '', write_off_date: getLocalDateString(), notes: '' });
    setLineItems([{ item_id: '', quantity: 1, reason: 'DAMAGED', notes: '' }]);
    setItemSearch({});
    setShowModal(true);
  }

  async function openEdit(wo) {
    setEditing(wo);
    setForm({ department_id: wo.department_id || '', write_off_date: wo.write_off_date, notes: wo.notes || '' });
    const { data: woItems } = await supabase.from('write_off_items').select('*').eq('wo_id', wo.id);
    setLineItems((woItems || []).map(i => ({ item_id: i.item_id, quantity: i.quantity, reason: i.reason || wo.reason || 'DAMAGED', notes: i.notes || '' })));
    if (!woItems || woItems.length === 0) setLineItems([{ item_id: '', quantity: 1, reason: 'DAMAGED', notes: '' }]);
    setItemSearch({});
    setShowModal(true);
  }

  function addLine() { setLineItems([...lineItems, { item_id: '', quantity: 1, reason: 'DAMAGED', notes: '' }]); }
  function removeLine(idx) { setLineItems(lineItems.filter((_, i) => i !== idx)); }
  function updateLine(idx, field, val) { const nl = [...lineItems]; nl[idx] = { ...nl[idx], [field]: val }; setLineItems(nl); }

  async function generateWONumber() {
    const prefix = `WO-${selectedOrg.code}-`;
    const { data } = await supabase.from('write_offs').select('wo_number').eq('organization_id', selectedOrg.id).like('wo_number', prefix + '%').order('created_at', { ascending: false }).limit(1);
    let nextNum = 1;
    if (data && data.length > 0) {
      const lastNum = parseInt(data[0].wo_number.replace(prefix, ''), 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    return prefix + String(nextNum).padStart(4, '0');
  }

  async function handleSave() {
    if (!form.department_id || lineItems.filter(l => l.item_id).length === 0) return;
    setSaving(true);
    try {
      // Validate write-off date
      const inputDate = new Date(form.write_off_date);
      const today = new Date();
      const maxBackdateDays = selectedOrg.max_backdate_days || 3;
      const daysDiff = Math.floor((today - inputDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > maxBackdateDays) {
        showNotification('Write-off date exceeds maximum backdate limit (' + maxBackdateDays + ' days)', 'error');
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
        const { error } = await supabase.from('write_offs').update({
          department_id: form.department_id, write_off_date: form.write_off_date,
          reason: validLines[0]?.reason || 'DAMAGED', notes: form.notes || null,
        }).eq('id', editing.id);
        if (error) throw error;
        await supabase.from('write_off_items').delete().eq('wo_id', editing.id);
        const itemsPayload = validLines.map(l => ({
          wo_id: editing.id, item_id: l.item_id, quantity: l.quantity,
          notes: l.reason || 'DAMAGED'
        }));
        await supabase.from('write_off_items').insert(itemsPayload);
      } else {
        const woNumber = await generateWONumber();
        const { data: newWO, error } = await supabase.from('write_offs').insert({
          wo_number: woNumber, organization_id: selectedOrg.id, department_id: form.department_id,
          write_off_date: form.write_off_date, reason: validLines[0]?.reason || 'DAMAGED', status: 'DRAFT',
          notes: form.notes || null, requested_by: currentUser?.id
        }).select().single();
        if (error) throw error;
        const itemsPayload = validLines.map(l => ({
          wo_id: newWO.id, item_id: l.item_id, quantity: l.quantity,
          notes: l.reason || 'DAMAGED'
        }));
        await supabase.from('write_off_items').insert(itemsPayload);
      }
      showNotification(t('writeoff.successSave'));
      setShowModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(wo) {
    if (wo.status !== 'DRAFT') { showNotification('Cannot delete — status is ' + wo.status, 'error'); return; }
    if (!(await showConfirm(t('writeoff.confirmDelete'), { variant: 'danger' }))) return;
    try {
      await supabase.from('write_off_items').delete().eq('wo_id', wo.id);
      const { error } = await supabase.from('write_offs').delete().eq('id', wo.id);
      if (error) throw error;
      showNotification(t('writeoff.successDelete'));
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function submitForApproval(wo) {
    if (!(await showConfirm('Submit for approval?', { variant: 'warning' }))) return;
    const upd = { status: 'PENDING', submitted_by: currentUser?.id, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('write_offs').update(upd).eq('id', wo.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); return; }
    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: 'WRITEOFF', document_id: wo.id,
      document_number: wo.wo_number, action: 'SUBMITTED', action_by: currentUser?.id,
    });
    showNotification(t('writeoff.title') + ' submitted for approval', 'success');
    loadAll();
  }

  return (
    <div>
      <PageHeader title={t('writeoff.title')} subtitle={t('writeoff.subtitle')}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('writeoff.create')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('writeoff.number'), render: r => <button onClick={() => openViewWo(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.wo_number}</button> },
            { header: t('writeoff.date'), render: r => formatDateSys(r.write_off_date) },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
          ]}
          data={writeoffs}
          actions={(row) => (
            <div className="flex items-center gap-1">
              <button onClick={e=>{e.stopPropagation();openViewWo(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 flex items-center gap-0.5"><Icons.Eye /> Detail</button>
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();submitForApproval(row)}} className="p-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100">Submit</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1 text-xs bg-yellow-50 text-yellow-700 rounded hover:bg-yellow-100 flex items-center gap-0.5"><Icons.Edit /> Edit</button>}
              {row.status === 'DRAFT' && <button onClick={e=>{e.stopPropagation();handleDelete(row)}} className="p-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 flex items-center gap-0.5"><Icons.Trash /> Hapus</button>}
            </div>
          )}
        />
        {writeoffs.length === 0 && !loading && (
          <div className="p-8 text-center text-gray-500">{t('writeoff.empty')}</div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Write-Off' : t('writeoff.create')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <FormField label="User">
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.full_name || currentUser?.username || '-'}
            </div>
          </FormField>
          <FormField label={t('writeoff.department')} required>
            <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
              {currentUser?.department ? `${currentUser.department.code} - ${currentUser.department.name}` : '-'}
            </div>
          </FormField>
          <FormField label={t('writeoff.date')} required>
            <Input type="date" value={form.write_off_date} onChange={e => setForm({...form, write_off_date: e.target.value})} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('writeoff.notes')}>
              <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </FormField>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold text-sm">{t('writeoff.addItem')}</h4>
            <button onClick={addLine} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ {t('writeoff.addItem')}</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50">
              <th className="p-2 text-left">{t('dashboard.item')}</th>
              <th className="p-2 text-right w-20">{t('writeoff.qty')}</th>
              <th className="p-2 text-left w-32">{t('writeoff.reason')}</th>
              <th className="p-2 text-left w-32">{t('writeoff.notes')}</th>
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
                          {filteredItems.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                              {filteredItems.slice(0, 20).map(i => (
                                <div key={i.id} onClick={() => { updateLine(idx, 'item_id', i.id); setItemSearch({...itemSearch, [idx]: ''}); }}
                                  className="px-2 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-b border-gray-50">
                                  <span className="font-medium">{i.code}</span> - {i.name}
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
                  <td className="p-2">
                    <select value={line.reason} onChange={e => updateLine(idx, 'reason', e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm">
                      <option value="EXPIRED">{t('writeoff.reasonExpired')}</option>
                      <option value="DAMAGED">{t('writeoff.reasonDamaged')}</option>
                      <option value="LOST">{t('writeoff.reasonLost')}</option>
                      <option value="OBSOLETE">{t('writeoff.reasonObsolete')}</option>
                      <option value="OTHER">{t('writeoff.reasonOther')}</option>
                    </select>
                  </td>
                  <td className="p-2"><input value={line.notes} onChange={e => updateLine(idx, 'notes', e.target.value)}
                    className="w-full px-2 py-1 border rounded text-sm" /></td>
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

      {/* Write-Off View/Detail Modal */}
      <Modal open={!!viewWo} onClose={() => setViewWo(null)} title={`Detail Write-Off - ${viewWo?.wo_number || ''}`} size="lg">
        {viewWo && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500">{t('writeoff.number')}</p>
                <p className="font-mono text-sm font-semibold">{viewWo.wo_number}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('writeoff.date')}</p>
                <p className="text-sm">{formatDateSys(viewWo.write_off_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('stock.dept')}</p>
                <p className="text-sm">{viewWo.departments?.code ? `${viewWo.departments.code} - ${viewWo.departments.name}` : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">{t('common.status')}</p>
                <StatusBadge status={viewWo.status} />
              </div>
              {viewWo.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">{t('writeoff.notes')}</p>
                  <p className="text-sm">{viewWo.notes}</p>
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h4 className="font-semibold text-sm mb-3">{t('writeoff.addItem')}</h4>
              {viewWoLoading ? (
                <PageLoader />
              ) : viewWoItems.length === 0 ? (
                <div className="text-center py-4 text-gray-500">No items found</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="p-2 text-left">#</th>
                      <th className="p-2 text-left">{t('dashboard.item')}</th>
                      <th className="p-2 text-right">{t('writeoff.qty')}</th>
                      <th className="p-2 text-left">{t('writeoff.reason')}</th>
                      <th className="p-2 text-left">{t('writeoff.notes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewWoItems.map((item, idx) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-2 text-gray-500">{idx + 1}</td>
                        <td className="p-2">
                          <span className="font-medium">{item.items?.code}</span> - {item.items?.name}
                        </td>
                        <td className="p-2 text-right">{item.quantity} {item.items?.unit || ''}</td>
                        <td className="p-2"><Badge color="orange">{item.reason}</Badge></td>
                        <td className="p-2 text-gray-600">{item.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end mt-6 pt-4 border-t">
              <Button variant="secondary" onClick={() => setViewWo(null)}>{t('common.close')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default WriteOffPage;
