import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatDate, formatDateSys } from '../utils/format';
import { Modal } from '../components/Modal';
import { Button, Input, Badge, Select } from '../components/FormElements';
import { Checkbox } from '../components/Checkbox';
import { FormField } from '../components/FormField';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Tab } from '../components/Tab';
import { DataTable } from '../components/DataTable';

function WarehousesPage() {
  const { selectedOrg, showNotification, showConfirm } = useApp();
  const { t } = useTranslation();
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', warehouse_type: 'store', is_active: true });
  const [activeTab, setActiveTab] = useState('storage');

  useEffect(() => { if (selectedOrg) loadWarehouses(); }, [selectedOrg]);

  async function loadWarehouses() {
    setLoading(true);
    const { data } = await supabase.from('warehouses').select('*')
      .eq('organization_id', selectedOrg.id).order('code');
    setWarehouses(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    const defaultType = activeTab === 'room' ? 'room' : 'store';
    setForm({ code: '', name: '', description: '', warehouse_type: defaultType, is_active: true });
    setShowModal(true);
  }

  function openEdit(wh) {
    setEditing(wh);
    setForm({ code: wh.code, name: wh.name, description: wh.description || '', warehouse_type: wh.warehouse_type, is_active: wh.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase.from('warehouses').update({
          code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim(),
          warehouse_type: form.warehouse_type, is_active: form.is_active, updated_at: new Date().toISOString()
        }).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('warehouses').insert({
          organization_id: selectedOrg.id, code: form.code.trim().toUpperCase(), name: form.name.trim(),
          description: form.description.trim(), warehouse_type: form.warehouse_type, is_active: form.is_active
        });
        if (error) throw error;
      }
      setShowModal(false);
      loadWarehouses();
    } catch (err) { showNotification(t('wh.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(wh) {
    // Check dependencies before delete
    const [sbRes, smRes, rmRes] = await Promise.all([
      supabase.from('stock_balance').select('id', { count: 'exact', head: true }).eq('warehouse_id', wh.id),
      supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('warehouse_id', wh.id),
      supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('warehouse_id', wh.id),
    ]);
    const deps = [];
    if (sbRes.count > 0) deps.push(`${sbRes.count} stock balance(s)`);
    if (smRes.count > 0) deps.push(`${smRes.count} stock movement(s)`);
    if (rmRes.count > 0) deps.push(`${rmRes.count} room(s)`);
    if (deps.length > 0) {
      const msg = `Cannot delete "${wh.name}" — it has linked data: ${deps.join(', ')}. Deactivate instead?`;
      if (await showConfirm(msg, { variant: 'warning' })) {
        await supabase.from('warehouses').update({ is_active: false }).eq('id', wh.id);
        loadWarehouses();
      }
      return;
    }
    if (!(await showConfirm(t('wh.confirmDelete'), { variant: 'danger' }))) return;
    await supabase.from('warehouses').delete().eq('id', wh.id);
    loadWarehouses();
  }

  const typeLabel = (type) => {
    const map = { general: t('wh.type.general'), store: t('wh.type.store'), room: t('wh.type.room') };
    return map[type] || type;
  };

  const typeColor = (type) => {
    const map = { general: 'blue', store: 'green', room: 'purple', dirty: 'orange', laundry: 'cyan', damage: 'red', in_use: 'yellow' };
    return map[type] || 'gray';
  };

  const filteredWarehouses = warehouses.filter(wh => {
    if (activeTab === 'room') return wh.warehouse_type === 'room';
    return ['store', 'damage', 'in_use', 'general', 'dirty', 'laundry'].includes(wh.warehouse_type);
  });

  return (
    <div>
      <PageHeader title={t('wh.title')} subtitle={`${t('wh.subtitle')} ${selectedOrg?.name}`}
        actions={<Button onClick={openAdd}><Icons.Plus /> {t('wh.addNew')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="border-b border-gray-100 flex gap-0">
          <button onClick={() => setActiveTab('storage')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'storage' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-600 hover:text-gray-800'}`}>
            Storage Warehouses
          </button>
          <button onClick={() => setActiveTab('room')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${activeTab === 'room' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-600 hover:text-gray-800'}`}>
            Room Warehouses
          </button>
        </div>
        <DataTable loading={loading}
          columns={[
            { header: t('wh.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('wh.name'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('wh.description'), key: 'description' },
            { header: t('wh.type'), render: r => <Badge color={typeColor(r.warehouse_type)}>{typeLabel(r.warehouse_type)}</Badge> },
            { header: t('wh.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
            { header: t('common.actions'), render: r => (
              <div className="flex gap-1">
                <button onClick={() => openEdit(r)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Icons.Edit /></button>
                <button onClick={() => handleDelete(r)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Icons.Trash /></button>
              </div>
            )},
          ]}
          data={filteredWarehouses}
        />
      </div>

      {showModal && (
        <Modal open={true} title={editing ? t('wh.editTitle') : t('wh.addNew')} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <FormField label={t('wh.code')}>
              <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g. GS, FNB" />
            </FormField>
            <FormField label={t('wh.name')}>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="General Store" />
            </FormField>
            <FormField label={t('wh.description')}>
              <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </FormField>
            {activeTab !== 'room' && (
              <FormField label={t('wh.type')}>
                <Select value={form.warehouse_type} onChange={e => setForm({...form, warehouse_type: e.target.value})}>
                  <option value="general">{t('wh.type.general')}</option>
                  <option value="store">{t('wh.type.store')}</option>
                  <option value="damage">Damage</option>
                  <option value="in_use">In Use</option>
                  <option value="dirty">Dirty (Linen Kotor)</option>
                  <option value="laundry">Laundry Vendor</option>
                </Select>
              </FormField>
            )}
            <FormField label={t('wh.status')}>
              <Select value={form.is_active ? 'true' : 'false'} onChange={e => setForm({...form, is_active: e.target.value === 'true'})}>
                <option value="true">{t('common.active')}</option>
                <option value="false">{t('common.inactive')}</option>
              </Select>
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? '...' : (editing ? t('common.update') : t('common.create'))}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default WarehousesPage;