import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { FormField } from '../components/FormField';
import { Button, Input, Select, Badge } from '../components/FormElements';

function VendorTypesPage() {
  const { showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [types, setTypes] = useState([]);
  const [vendorCounts, setVendorCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', is_active: true });

  const canManage = currentUser && ['superadmin', 'gm', 'opdir'].includes(currentUser.role?.code);

  // A global master, like vendors themselves — no organization filter anywhere.
  useEffect(() => { loadTypes(); }, []);

  async function loadTypes() {
    setLoading(true);
    try {
      const [typeRes, vendorRes] = await Promise.all([
        supabase.from('vendor_types').select('*').order('name'),
        supabase.from('vendors').select('vendor_type_id'),
      ]);
      if (typeRes.error) throw typeRes.error;
      const counts = {};
      (vendorRes.data || []).forEach(v => {
        if (v.vendor_type_id) counts[v.vendor_type_id] = (counts[v.vendor_type_id] || 0) + 1;
      });
      setVendorCounts(counts);
      setTypes(typeRes.data || []);
    } catch (err) {
      showNotification('Error loading vendor types: ' + err.message, 'error');
    }
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ code: '', name: '', is_active: true });
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({ code: row.code, name: row.name, is_active: row.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim() || saving) return;
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      if (editing) {
        const { error } = await supabase.from('vendor_types').update(payload).eq('id', editing.id);
        if (error) throw error;
        showNotification('Vendor type updated', 'success');
      } else {
        const { error } = await supabase.from('vendor_types').insert(payload);
        if (error) throw error;
        showNotification('Vendor type added', 'success');
      }
      setShowModal(false);
      loadTypes();
    } catch (err) {
      // The unique index on code is the likely culprit; say so rather than
      // showing the raw constraint name.
      const msg = /duplicate key|unique/i.test(err.message)
        ? `Code "${form.code.trim().toUpperCase()}" is already used by another vendor type.`
        : err.message;
      showNotification('Error: ' + msg, 'error');
    }
    setSaving(false);
  }

  async function handleDelete(row) {
    const used = vendorCounts[row.id] || 0;
    // Deleting a type still attached to vendors would blank their type and, for
    // Laundry, silently drop them out of the laundry handover dropdown.
    if (used > 0) {
      showNotification(`"${row.name}" is still assigned to ${used} vendor${used > 1 ? 's' : ''}. Change those vendors first, or set this type to Inactive instead.`, 'error');
      return;
    }
    if (!(await showConfirm(`Delete vendor type "${row.name}"?`, { variant: 'danger' }))) return;
    try {
      const { error } = await supabase.from('vendor_types').delete().eq('id', row.id);
      if (error) throw error;
      showNotification('Vendor type deleted', 'success');
      loadTypes();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title={t('vendorTypes.title')}
        subtitle={t('vendorTypes.subtitle')}
        actions={canManage && <Button onClick={openAdd}><Icons.Plus /> {t('vendorTypes.add')}</Button>}
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('common.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('vendorTypes.type'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('vendorTypes.vendorCount'), render: r => {
              const n = vendorCounts[r.id] || 0;
              return n > 0
                ? <span className="text-sm tabular-nums">{n}</span>
                : <span className="text-gray-400 text-sm">-</span>;
            } },
            { header: t('common.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={types}
          actions={canManage ? (row) => (
            <>
              <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500" title="Edit"><Icons.Edit /></button>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(row); }} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400" title="Delete"><Icons.Trash /></button>
            </>
          ) : undefined}
        />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? t('vendorTypes.edit') : t('vendorTypes.add')}>
        <div className="space-y-4">
          <FormField label={t('common.code')} required>
            <Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. LDR" />
          </FormField>
          <FormField label={t('vendorTypes.type')} required>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Laundry" />
          </FormField>
          <FormField label={t('common.status')}>
            <Select value={form.is_active ? 'true' : 'false'} onChange={e => setForm({ ...form, is_active: e.target.value === 'true' })}>
              <option value="true">{t('common.active')}</option>
              <option value="false">{t('common.inactive')}</option>
            </Select>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving || !form.code.trim() || !form.name.trim()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default VendorTypesPage;
