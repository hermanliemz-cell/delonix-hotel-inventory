import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useTranslation } from '../hooks/useTranslation';
import { useApp } from '../hooks/useApp';
import { Icons } from './Icons';
import { Modal } from './Modal';
import { Button, Input, Select } from './FormElements';

function RoomActivityChecklistModal({ room, open, onClose, allRooms }) {
  const { t } = useTranslation();
  const { showNotification, showConfirm } = useApp();
  const [localActivities, setLocalActivities] = useState([]);
  const [originalActivities, setOriginalActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', description: '' });
  const [editingIdx, setEditingIdx] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [copyFromRoom, setCopyFromRoom] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => { if (open && room) { loadActivities(); setHasChanges(false); setEditingIdx(null); } }, [open, room]);

  async function loadActivities() {
    setLoading(true);
    const { data, error } = await supabase.from('room_activity_checklist')
      .select('*').eq('room_id', room.id).order('sort_order').order('created_at');
    const loaded = (!error && data) ? data : [];
    setOriginalActivities(JSON.parse(JSON.stringify(loaded)));
    setLocalActivities(loaded);
    setLoading(false);
  }

  function handleAdd() {
    if (!addForm.name.trim()) return;
    const maxSort = localActivities.reduce((max, a) => Math.max(max, a.sort_order || 0), 0);
    setLocalActivities([...localActivities, {
      _tempId: 'temp_' + Date.now(), name: addForm.name.trim(),
      description: addForm.description.trim() || null,
      sort_order: maxSort + 1, is_active: true
    }]);
    setAddForm({ name: '', description: '' });
    setHasChanges(true);
  }

  function handleUpdateLocal(idx) {
    if (!editForm.name.trim()) return;
    const updated = [...localActivities];
    updated[idx] = { ...updated[idx], name: editForm.name.trim(), description: editForm.description.trim() || null };
    setLocalActivities(updated);
    setEditingIdx(null);
    setHasChanges(true);
  }

  function handleDelete(idx) {
    setLocalActivities(localActivities.filter((_, i) => i !== idx));
    setHasChanges(true);
    if (editingIdx === idx) setEditingIdx(null);
  }

  function handleToggleActive(idx) {
    const updated = [...localActivities];
    updated[idx] = { ...updated[idx], is_active: !updated[idx].is_active };
    setLocalActivities(updated);
    setHasChanges(true);
  }

  function handleMoveUp(idx) {
    if (idx === 0) return;
    const items = [...localActivities];
    [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    setLocalActivities(items);
    setHasChanges(true);
  }

  function handleMoveDown(idx) {
    if (idx >= localActivities.length - 1) return;
    const items = [...localActivities];
    [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
    setLocalActivities(items);
    setHasChanges(true);
  }

  function handleCopyFrom() {
    if (!copyFromRoom) return;
    setSaving(true);
    supabase.from('room_activity_checklist').select('*')
      .eq('room_id', copyFromRoom).eq('is_active', true).order('sort_order')
      .then(({ data: sourceActivities, error: fetchErr }) => {
        if (fetchErr) { showNotification('Error: ' + fetchErr.message, 'error'); setSaving(false); return; }
        if (!sourceActivities || sourceActivities.length === 0) {
          showNotification('Source room has no activities', 'error'); setSaving(false); return;
        }
        const maxSort = localActivities.reduce((max, a) => Math.max(max, a.sort_order || 0), 0);
        const toAdd = sourceActivities.map((a, i) => ({
          _tempId: 'temp_' + Date.now() + '_' + i, name: a.name, description: a.description,
          sort_order: maxSort + i + 1, is_active: true
        }));
        setLocalActivities([...localActivities, ...toAdd]);
        setCopyFromRoom('');
        setHasChanges(true);
        showNotification('Added ' + toAdd.length + ' activities (click Save to confirm)');
        setSaving(false);
      });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const origIds = originalActivities.map(o => o.id).filter(Boolean);
      const localIds = localActivities.map(l => l.id).filter(Boolean);
      const toDelete = origIds.filter(id => !localIds.includes(id));
      const toInsert = localActivities.filter(l => !l.id || l._tempId);
      const toUpdate = localActivities.filter(l => l.id && !l._tempId);

      if (toDelete.length > 0) {
        const { error } = await supabase.from('room_activity_checklist').delete().in('id', toDelete);
        if (error) throw error;
      }
      if (toInsert.length > 0) {
        const payload = toInsert.map((a, i) => ({
          room_id: room.id, name: a.name, description: a.description,
          sort_order: localActivities.indexOf(a), is_active: a.is_active
        }));
        const { error } = await supabase.from('room_activity_checklist').insert(payload);
        if (error) throw error;
      }
      for (const item of toUpdate) {
        const orig = originalActivities.find(o => o.id === item.id);
        const newSortOrder = localActivities.indexOf(item);
        if (orig && (orig.name !== item.name || orig.description !== item.description ||
            orig.is_active !== item.is_active || orig.sort_order !== newSortOrder)) {
          const { error } = await supabase.from('room_activity_checklist')
            .update({ name: item.name, description: item.description, is_active: item.is_active, sort_order: newSortOrder })
            .eq('id', item.id);
          if (error) throw error;
        }
      }
      showNotification('Activity list saved successfully');
      setHasChanges(false);
      onClose();
    } catch (err) { showNotification('Error saving: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleCancel() {
    if (hasChanges) {
      if (!(await showConfirm('Discard unsaved changes?', { variant: 'warning' }))) return;
    }
    setLocalActivities(JSON.parse(JSON.stringify(originalActivities)));
    setHasChanges(false);
    setEditingIdx(null);
    onClose();
  }

  if (!room) return null;

  const otherRooms = (allRooms || []).filter(r => r.id !== room.id);

  return (
    <Modal open={open} onClose={handleCancel} title={`${t('roomChecklist.title')} - ${room.room_number}`} size="lg">
      <p className="text-sm text-gray-500 mb-4">{t('roomChecklist.subtitle')} {room.room_number}
        {hasChanges && <span className="ml-2 text-xs text-orange-500 font-medium">(unsaved changes)</span>}
      </p>

      {/* Add new activity form */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('roomChecklist.addActivity')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('roomChecklist.name')}</label>
            <Input value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} placeholder="e.g. Check AC" />
          </div>
          <div className="sm:col-span-6">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('roomChecklist.description')}</label>
            <Input value={addForm.description} onChange={e => setAddForm({...addForm, description: e.target.value})} placeholder="Optional description" />
          </div>
          <div className="sm:col-span-2">
            <Button onClick={handleAdd} disabled={!addForm.name.trim()} className="w-full"><Icons.Plus /> Add</Button>
          </div>
        </div>
      </div>

      {/* Copy from another room */}
      {otherRooms.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-blue-700 whitespace-nowrap">{t('roomChecklist.copyFrom')}:</label>
            <Select value={copyFromRoom} onChange={e => setCopyFromRoom(e.target.value)} className="flex-1">
              <option value="">{t('roomChecklist.copyFromRoom')}</option>
              {otherRooms.map(r => <option key={r.id} value={r.id}>{r.room_number}{r.room_types?.name ? ` (${r.room_types.name})` : ''}</option>)}
            </Select>
            <Button variant="secondary" onClick={handleCopyFrom} disabled={!copyFromRoom || saving}>Copy</Button>
          </div>
        </div>
      )}

      {/* Activities list */}
      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : localActivities.length === 0 ? (
        <div className="text-center py-8 text-gray-400">{t('roomChecklist.noActivities')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-700">
              <th className="text-left px-3 py-2 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 font-medium">{t('roomChecklist.name')}</th>
              <th className="text-left px-3 py-2 font-medium">{t('roomChecklist.description')}</th>
              <th className="text-center px-3 py-2 font-medium w-20">{t('common.status')}</th>
              <th className="w-32"></th>
            </tr></thead>
            <tbody>
              {localActivities.map((act, idx) => (
                <tr key={act.id || act._tempId} className="border-t border-gray-100 hover:bg-gray-50">
                  {editingIdx === idx ? (
                    <>
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2"><Input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className="text-sm" /></td>
                      <td className="px-3 py-2"><Input value={editForm.description} onChange={e => setEditForm({...editForm, description: e.target.value})} className="text-sm" /></td>
                      <td></td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleUpdateLocal(idx)} className="p-1 hover:bg-green-100 rounded text-green-600" title="Save"><Icons.Save /></button>
                          <button onClick={() => setEditingIdx(null)} className="p-1 hover:bg-gray-100 rounded text-gray-400" title="Cancel"><Icons.X /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium">{act.name}</td>
                      <td className="px-3 py-2 text-gray-500">{act.description || '-'}</td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => handleToggleActive(idx)} className={`text-xs px-2 py-0.5 rounded-full ${act.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {act.is_active ? t('common.active') : t('common.inactive')}
                        </button>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30" title="Move up">&#9650;</button>
                          <button onClick={() => handleMoveDown(idx)} disabled={idx === localActivities.length - 1} className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30" title="Move down">&#9660;</button>
                          <button onClick={() => { setEditingIdx(idx); setEditForm({ name: act.name, description: act.description || '' }); }} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="Edit"><Icons.Edit /></button>
                          <button onClick={() => handleDelete(idx)} className="p-1 hover:bg-red-50 rounded text-red-400" title="Delete"><Icons.Trash /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
        <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !hasChanges}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}

export default RoomActivityChecklistModal;
