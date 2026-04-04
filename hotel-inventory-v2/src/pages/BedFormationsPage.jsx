import React, {useState, useEffect} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';

function BedFormationsPage() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification, showConfirm } = useApp();
  const [bedFormations, setBedFormations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [roomCounts, setRoomCounts] = useState({});
  const [form, setForm] = useState({ code: '', name: '', description: '', is_active: true });

  useEffect(() => { if (selectedOrg) loadData(); }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('bed_formations').select('*').order('code');
    setBedFormations(data || []);
    const { data: rooms } = await supabase.from('rooms').select('bed_formation_id');
    const counts = {};
    (rooms || []).forEach(r => { if (r.bed_formation_id) counts[r.bed_formation_id] = (counts[r.bed_formation_id] || 0) + 1; });
    setRoomCounts(counts);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ code: '', name: '', description: '', is_active: true });
    setShowModal(true);
  }

  function openEdit(bf) {
    setEditing(bf);
    setForm({ code: bf.code, name: bf.name, description: bf.description || '', is_active: bf.is_active });
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
        const { error } = await supabase.from('bed_formations').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('bed_formations').insert(payload);
        if (error) throw error;
      }
      showNotification(t('bedFormation.successSave'));
      setShowModal(false);
      loadData();
    } catch (err) { showNotification(t('bedFormation.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(bf) {
    if (!(await showConfirm(t('bedFormation.confirmDelete'), { variant: 'danger' }))) return;
    try {
      const { error } = await supabase.from('bed_formations').delete().eq('id', bf.id);
      if (error) throw error;
      showNotification(t('bedFormation.successDelete'));
      loadData();
    } catch (err) { showNotification(t('bedFormation.errorSave') + ': ' + err.message, 'error'); }
  }

  return (
    <div>
      <PageHeader title={t('bedFormation.title')} subtitle={`${bedFormations.length} ${t('menu.bedFormations')}`}
        actions={<Button onClick={openAdd}><Icons.Plus /> {t('bedFormation.addNew')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('bedFormation.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('bedFormation.name'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('common.description'), key: 'description' },
            { header: t('bedFormation.roomCount'), render: r => <span className="font-semibold">{roomCounts[r.id] || 0}</span> },
            { header: t('common.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={bedFormations}
          actions={(row) => (
            <div className="flex gap-1">
              <button onClick={() => openEdit(row)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Icons.Edit /></button>
              {!(roomCounts[row.id] > 0) && <button onClick={() => handleDelete(row)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Icons.Trash /></button>}
            </div>
          )}
        />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? t('bedFormation.editTitle') : t('bedFormation.addNew')}>
        <div className="space-y-4">
          <FormField label={t('bedFormation.code')} required>
            <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g. SKB, SQB, TWN" />
          </FormField>
          <FormField label={t('bedFormation.name')} required>
            <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Single King Bed, Twin Bed" />
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

export default BedFormationsPage;
