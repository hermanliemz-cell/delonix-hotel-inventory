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

function RoomTypesPage() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification, showConfirm } = useApp();
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roomCounts, setRoomCounts] = useState({});
  const [form, setForm] = useState({ code: '', name: '', description: '', is_active: true });

  useEffect(() => { if (selectedOrg) loadData(); }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('room_types').select('*').order('code');
    setRoomTypes(data || []);
    // Count rooms per type (across all orgs since room types are shared)
    const { data: rooms } = await supabase.from('rooms').select('room_type_id');
    const counts = {};
    (rooms || []).forEach(r => { if (r.room_type_id) counts[r.room_type_id] = (counts[r.room_type_id] || 0) + 1; });
    setRoomCounts(counts);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ code: '', name: '', description: '', is_active: true });
    setShowModal(true);
  }

  function openEdit(rt) {
    setEditing(rt);
    setForm({ code: rt.code, name: rt.name, description: rt.description || '', is_active: rt.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active
      };
      if (editing) {
        const { error } = await supabase.from('room_types').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('room_types').insert(payload);
        if (error) throw error;
      }
      showNotification(t('roomType.successSave'));
      setShowModal(false);
      loadData();
    } catch (err) { showNotification(t('roomType.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(rt) {
    if (!(await showConfirm(t('roomType.confirmDelete'), { variant: 'danger' }))) return;
    try {
      const { error } = await supabase.from('room_types').delete().eq('id', rt.id);
      if (error) throw error;
      showNotification(t('roomType.successDelete'));
      loadData();
    } catch (err) { showNotification(t('roomType.errorSave') + ': ' + err.message, 'error'); }
  }

  return (
    <div>
      <PageHeader title={t('roomType.title')} subtitle={`${roomTypes.length} ${t('menu.roomTypes')}`}
        actions={<Button onClick={openAdd}><Icons.Plus /> {t('roomType.addNew')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('roomType.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('roomType.name'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('common.description'), key: 'description' },
            { header: t('roomType.roomCount'), render: r => <span className="font-semibold">{roomCounts[r.id] || 0}</span> },
            { header: t('common.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={roomTypes}
          actions={(row) => (
            <div className="flex gap-1">
              <button onClick={() => openEdit(row)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Icons.Edit /></button>
              {!(roomCounts[row.id] > 0) && <button onClick={() => handleDelete(row)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Icons.Trash /></button>}
            </div>
          )}
        />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? t('roomType.editTitle') : t('roomType.addNew')}>
        <div className="space-y-4">
          <FormField label={t('roomType.code')} required>
            <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g. STD, DLX, STE" />
          </FormField>
          <FormField label={t('roomType.name')} required>
            <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Standard, Deluxe" />
          </FormField>
          <FormField label={t('common.description')}>
            <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder={t('common.description')} />
          </FormField>
          <FormField label={t('common.status')}>
            <Select value={form.is_active} onChange={e => setForm({...form, is_active: e.target.value === 'true'})}>
              <option value="true">{t('common.active')}</option>
              <option value="false">{t('common.inactive')}</option>
            </Select>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}

export default RoomTypesPage;