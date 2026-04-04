import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { FormField } from '../components/FormField';
import { Tab } from '../components/Tab';
import { Button, Input, Select, Badge } from '../components/FormElements';

function DepartmentsPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [departments, setDepartments] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', is_active: true, warehouse_id: '' });

  const canManage = currentUser && ['superadmin','gm','opdir'].includes(currentUser.role?.code);

  useEffect(() => { if(selectedOrg) loadDepts(); }, [selectedOrg]);

  async function loadDepts() {
    setLoading(true);
    const [deptRes, whRes] = await Promise.all([
      supabase.from('departments').select('*, warehouses:warehouse_id(id, code, name)').order('name'),
      supabase.from('warehouses').select('id, code, name, warehouse_type').eq('organization_id', selectedOrg.id).eq('is_active', true).in('warehouse_type', ['store','general']).order('code')
    ]);
    setDepartments(deptRes.data || []);
    setWarehouses(whRes.data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ code: '', name: '', description: '', is_active: true, warehouse_id: '' });
    setShowModal(true);
  }

  function openEdit(dept) {
    setEditing(dept);
    setForm({ code: dept.code, name: dept.name, description: dept.description || '', is_active: dept.is_active, warehouse_id: dept.warehouse_id || '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) return;
    try {
      if (editing) {
        const { error } = await supabase.from('departments').update({
          code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim(),
          is_active: form.is_active, warehouse_id: form.warehouse_id || null, updated_at: new Date().toISOString()
        }).eq('id', editing.id);
        if (error) throw error;
        showNotification('Department updated', 'success');
      } else {
        const { error } = await supabase.from('departments').insert({
          code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim(),
          is_active: form.is_active, warehouse_id: form.warehouse_id || null, organization_id: selectedOrg.id
        });
        if (error) throw error;
        showNotification('Department added', 'success');
      }
      setShowModal(false);
      loadDepts();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  async function handleDelete(dept) {
    if (!(await showConfirm(`Delete department "${dept.name}"?`, { variant: 'danger' }))) return;
    try {
      const { error } = await supabase.from('departments').delete().eq('id', dept.id);
      if (error) throw error;
      showNotification('Department deleted', 'success');
      loadDepts();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  return (
    <div>
      <PageHeader title={t('departments.title')} subtitle={`${t('departments.at')} ${selectedOrg?.name}`}
        actions={canManage && <Button onClick={openAdd}><Icons.Plus /> Add Department</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('common.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('common.name'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('common.description'), key:'description' },
            { header: 'Warehouse', render: r => r.warehouses ? <span className="text-xs">{r.warehouses.code} - {r.warehouses.name}</span> : <span className="text-gray-400 text-xs">-</span> },
            { header: t('common.status'), render: r => <Badge color={r.is_active?'green':'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={departments}
          actions={canManage ? (row) => (
            <>
              <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500" title="Edit"><Icons.Edit /></button>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(row); }} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400" title="Delete"><Icons.Trash /></button>
            </>
          ) : undefined}
        />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Department' : 'Add Department'}>
        <div className="space-y-4">
          <FormField label={t('common.code')} required>
            <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g. MGT" />
          </FormField>
          <FormField label={t('common.name')} required>
            <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Management" />
          </FormField>
          <FormField label={t('common.description')}>
            <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Department description" />
          </FormField>
          <FormField label="Department Warehouse" hint="Warehouse yang digunakan department ini">
            <Select value={form.warehouse_id} onChange={e => setForm({...form, warehouse_id: e.target.value})}>
              <option value="">-- Pilih Warehouse --</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </Select>
          </FormField>
          <FormField label={t('common.status')}>
            <Select value={form.is_active ? 'true' : 'false'} onChange={e => setForm({...form, is_active: e.target.value === 'true'})}>
              <option value="true">{t('common.active')}</option>
              <option value="false">{t('common.inactive')}</option>
            </Select>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.code.trim() || !form.name.trim()}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}

export default DepartmentsPage;
