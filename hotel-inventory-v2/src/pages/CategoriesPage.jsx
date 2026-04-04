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
import { PageLoader } from '../components/PageLoader';

function CategoriesPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirm, selectedOrg } = useApp();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [itemCounts, setItemCounts] = useState({});
  const [form, setForm] = useState({ code: '', name: '', description: '', parent_id: '', is_active: true });
  const [collapsedParents, setCollapsedParents] = useState({});

  const toggleCollapse = (parentId) => {
    setCollapsedParents(prev => ({ ...prev, [parentId]: !prev[parentId] }));
  };

  useEffect(() => { loadCategories(); }, []);

  async function loadCategories() {
    setLoading(true);
    const { data } = await supabase.from('item_categories').select('*').order('code');
    setCategories(data || []);
    // Count items per category
    const { data: items } = await supabase.from('items').select('category_id').eq('organization_id', selectedOrg?.id);
    const counts = {};
    (items || []).forEach(i => { counts[i.category_id] = (counts[i.category_id] || 0) + 1; });
    setItemCounts(counts);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ code: '', name: '', description: '', parent_id: '', is_active: true });
    setShowModal(true);
  }

  function openEdit(cat) {
    setEditing(cat);
    setForm({ code: cat.code, name: cat.name, description: cat.description || '', parent_id: cat.parent_id || '', is_active: cat.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(), name: form.name.trim(),
        description: form.description.trim() || null,
        parent_id: form.parent_id || null, is_active: form.is_active
      };
      if (editing) {
        const { error } = await supabase.from('item_categories').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('item_categories').insert(payload);
        if (error) throw error;
      }
      setShowModal(false);
      loadCategories();
    } catch (err) { showNotification(t('cat.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(cat) {
    if (!(await showConfirm(t('cat.confirmDelete'), { variant: 'danger' }))) return;
    const { error } = await supabase.from('item_categories').delete().eq('id', cat.id);
    if (error) { showNotification(t('cat.errorSave') + ': ' + error.message, 'error'); return; }
    loadCategories();
  }

  const getParentName = (parentId) => {
    const p = categories.find(c => c.id === parentId);
    return p ? p.name : '-';
  };

  // Default collapse all parents that have children (on first load)
  useEffect(() => {
    if (categories.length > 0) {
      const childCats = categories.filter(c => c.parent_id);
      const parentsWithChildren = {};
      childCats.forEach(c => { parentsWithChildren[c.parent_id] = true; });
      setCollapsedParents(prev => {
        // Only set defaults if collapsedParents is empty (first load)
        if (Object.keys(prev).length === 0 && Object.keys(parentsWithChildren).length > 0) {
          return parentsWithChildren;
        }
        return prev;
      });
    }
  }, [categories]);

  // Build hierarchical list: parents first, then children indented
  const parentCategories = categories.filter(c => !c.parent_id);
  const childCategories = categories.filter(c => c.parent_id);
  const hierarchicalData = [];
  parentCategories.forEach(parent => {
    hierarchicalData.push({ ...parent, _isParent: true });
    const children = childCategories.filter(c => c.parent_id === parent.id);
    children.forEach(child => {
      hierarchicalData.push({ ...child, _isChild: true, _parentCode: parent.code });
    });
  });
  // Add orphan children (parent deleted)
  const assignedChildIds = new Set(hierarchicalData.filter(c => c._isChild).map(c => c.id));
  childCategories.filter(c => !assignedChildIds.has(c.id)).forEach(c => hierarchicalData.push({ ...c, _isChild: true }));

  // Count children per parent for display
  const childCountMap = {};
  childCategories.forEach(c => { childCountMap[c.parent_id] = (childCountMap[c.parent_id] || 0) + 1; });

  // Filter out children of collapsed parents
  const displayData = hierarchicalData.filter(r => {
    if (r._isChild && r.parent_id && collapsedParents[r.parent_id]) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title={t('cat.title')} subtitle={t('cat.subtitle')}
        actions={<Button onClick={openAdd}><Icons.Plus /> {t('cat.addNew')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        {loading ? (
          <PageLoader />
        ) : displayData.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('common.noData')}</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('cat.code')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('cat.name')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('cat.description')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Level</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">{t('cat.itemCount')}</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">{t('cat.status')}</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((r, i) => (
                <tr key={r.id || i} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${r._isParent && childCountMap[r.id] > 0 ? 'bg-blue-50/30' : ''}`}>
                  <td className="px-3 py-1.5">
                    <div className={r._isChild ? 'pl-5' : ''}>
                      <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${r._isParent ? 'bg-blue-100 text-blue-800 font-semibold' : 'bg-gray-100 text-gray-600'}`}>{r.code}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className={r._isChild ? 'pl-5 flex items-center gap-1' : 'flex items-center gap-1'}>
                      {r._isParent && childCountMap[r.id] > 0 && (
                        <button onClick={() => toggleCollapse(r.id)} className="p-0.5 rounded hover:bg-blue-100 flex-shrink-0" title={collapsedParents[r.id] ? 'Expand' : 'Collapse'}>
                          <svg className={`w-3.5 h-3.5 text-blue-500 transition-transform ${collapsedParents[r.id] ? '' : 'rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                        </button>
                      )}
                      {r._isChild && <span className="text-gray-300 text-xs">└</span>}
                      <span className={r._isParent ? 'font-semibold text-gray-900' : 'text-gray-700'}>{r.name}</span>
                      {r._isParent && childCountMap[r.id] > 0 && (
                        <span className="ml-1 text-xs bg-blue-50 text-blue-500 px-1.5 rounded-full cursor-pointer" onClick={() => toggleCollapse(r.id)}>{childCountMap[r.id]} sub</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">{r.description || '-'}</td>
                  <td className="px-3 py-1.5">
                    {r._isParent ? <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Parent</span> : <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Child</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center font-medium">{itemCounts[r.id] || 0}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${r.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.is_active ? t('common.active') : t('common.inactive')}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-0.5">
                      <button onClick={() => openEdit(r)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Icons.Edit /></button>
                      {!(itemCounts[r.id] > 0) && !childCountMap[r.id] && <button onClick={() => handleDelete(r)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Icons.Trash /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal open={true} title={editing ? t('cat.editTitle') : t('cat.addNew')} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <FormField label={t('cat.parent')}>
              <Select value={form.parent_id} onChange={e => setForm({...form, parent_id: e.target.value})}>
                <option value="">— Tidak ada (Parent Category) —</option>
                {parentCategories.filter(c => !editing || c.id !== editing.id).map(c =>
                  <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                )}
              </Select>
            </FormField>
            <FormField label={t('cat.code')}>
              <Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder={form.parent_id ? 'e.g. BDS, DVC' : 'e.g. LIN, AMN'} />
            </FormField>
            <FormField label={t('cat.name')}>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={form.parent_id ? 'e.g. Bed Sheet, Duvet Cover' : 'e.g. Linen & Uniform'} />
            </FormField>
            <FormField label={t('cat.description')}>
              <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
            </FormField>
            <FormField label={t('cat.status')}>
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

export default CategoriesPage;