import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { Icons } from './Icons';
import { Modal } from './Modal';
import { Button, Select } from './FormElements';
import { TreeSelect } from './TreeSelect';

function RoomCategoryStandardsModal({ room, open, onClose, standardType, parentCategoryCode, title, colorScheme, allRooms }) {
  const { showNotification, showConfirm, selectedOrg } = useApp();
  const [localItems, setLocalItems] = useState([]);
  const [originalItems, setOriginalItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [copyFromRoom, setCopyFromRoom] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editCategoryId, setEditCategoryId] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  const colors = colorScheme || { bg: 'purple-50', header: 'purple-100', text: 'purple-800', border: 'purple-200', dot: 'purple-500' };

  useEffect(() => { if (open && room) { loadData(); setHasChanges(false); setEditingIdx(null); } }, [open, room]);

  async function loadData() {
    setLoading(true);
    try {
      const [stdRes, catRes] = await Promise.all([
        supabase.from('room_category_standards').select('*, item_categories(id, code, name)')
          .eq('room_id', room.id).eq('standard_type', standardType).order('sort_order').order('created_at'),
        supabase.from('item_categories').select('*').eq('is_active', true).order('name'),
      ]);
      const loaded = (stdRes.data || []).map((s, i) => ({ ...s, sort_order: s.sort_order || i }));
      setOriginalItems(JSON.parse(JSON.stringify(loaded)));
      setLocalItems(loaded);
      const allCats = catRes.data || [];
      const parentCat = allCats.find(c => !c.parent_id && c.code === parentCategoryCode);
      const children = parentCat ? allCats.filter(c => c.parent_id === parentCat.id) : [];
      setCategories(parentCat ? [parentCat, ...children] : []);
    } catch (err) {
      setLocalItems([]);
      setOriginalItems([]);
      setCategories([]);
    }
    setLoading(false);
  }

  function handleAdd() {
    if (!selectedCategory) return;
    const exists = localItems.find(s => s.category_id === selectedCategory);
    if (exists) { showNotification('Category already added', 'error'); return; }
    const cat = categories.find(c => c.id === selectedCategory);
    const maxSort = localItems.reduce((max, a) => Math.max(max, a.sort_order || 0), 0);
    setLocalItems([...localItems, {
      _tempId: 'temp_' + Date.now(), category_id: selectedCategory,
      item_categories: cat ? { id: cat.id, code: cat.code, name: cat.name } : null,
      sort_order: maxSort + 1, quantity: 1
    }]);
    setSelectedCategory('');
    setHasChanges(true);
  }

  function handleRemove(idx) {
    const updated = localItems.filter((_, i) => i !== idx);
    setLocalItems(updated);
    setHasChanges(true);
    if (editingIdx === idx) setEditingIdx(null);
  }

  function handleMoveUp(idx) {
    if (idx === 0) return;
    const items = [...localItems];
    [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
    setLocalItems(items);
    setHasChanges(true);
  }

  function handleMoveDown(idx) {
    if (idx >= localItems.length - 1) return;
    const items = [...localItems];
    [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
    setLocalItems(items);
    setHasChanges(true);
  }

  function startEdit(idx) {
    setEditingIdx(idx);
    setEditCategoryId(localItems[idx].category_id);
  }

  function saveEdit(idx) {
    if (!editCategoryId) return;
    const existsElsewhere = localItems.find((s, i) => i !== idx && s.category_id === editCategoryId);
    if (existsElsewhere) { showNotification('Category already exists in list', 'error'); return; }
    const cat = categories.find(c => c.id === editCategoryId);
    const updated = [...localItems];
    updated[idx] = { ...updated[idx], category_id: editCategoryId,
      item_categories: cat ? { id: cat.id, code: cat.code, name: cat.name } : updated[idx].item_categories };
    setLocalItems(updated);
    setEditingIdx(null);
    setHasChanges(true);
  }

  function handleCopyFrom() {
    if (!copyFromRoom) return;
    setSaving(true);
    supabase.from('room_category_standards').select('*, item_categories(id, code, name)')
      .eq('room_id', copyFromRoom).eq('standard_type', standardType).order('sort_order')
      .then(({ data: sourceStandards, error: fetchErr }) => {
        if (fetchErr) { showNotification('Error: ' + fetchErr.message, 'error'); setSaving(false); return; }
        if (!sourceStandards || sourceStandards.length === 0) {
          showNotification('Source room has no ' + title.toLowerCase() + ' categories', 'error'); setSaving(false); return;
        }
        const existingIds = localItems.map(s => s.category_id);
        const newItems = sourceStandards.filter(s => !existingIds.includes(s.category_id));
        if (newItems.length === 0) {
          showNotification('All categories from source room already exist', 'error'); setSaving(false); return;
        }
        const maxSort = localItems.reduce((max, a) => Math.max(max, a.sort_order || 0), 0);
        const toAdd = newItems.map((s, i) => ({
          _tempId: 'temp_' + Date.now() + '_' + i, category_id: s.category_id,
          item_categories: s.item_categories, sort_order: maxSort + i + 1,
          quantity: s.quantity || 1
        }));
        setLocalItems([...localItems, ...toAdd]);
        setCopyFromRoom('');
        setHasChanges(true);
        showNotification('Added ' + toAdd.length + ' categories (click Save to confirm)');
        setSaving(false);
      });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const origIds = originalItems.map(o => o.id).filter(Boolean);
      const localIds = localItems.map(l => l.id).filter(Boolean);
      const toDelete = origIds.filter(id => !localIds.includes(id));
      const toInsert = localItems.filter(l => !l.id || l._tempId);
      const toUpdate = localItems.filter(l => l.id && !l._tempId);

      if (toDelete.length > 0) {
        const { error } = await supabase.from('room_category_standards').delete().in('id', toDelete);
        if (error) throw error;
      }
      if (toInsert.length > 0) {
        const maxExistingSort = toUpdate.length > 0 ? Math.max(...toUpdate.map((_, i) => i)) : -1;
        const payload = toInsert.map((s, i) => ({
          room_id: room.id, category_id: s.category_id, standard_type: standardType,
          sort_order: localItems.indexOf(s), quantity: s.quantity || 1
        }));
        const { error } = await supabase.from('room_category_standards').insert(payload);
        if (error) throw error;
      }
      for (let i = 0; i < toUpdate.length; i++) {
        const item = toUpdate[i];
        const orig = originalItems.find(o => o.id === item.id);
        const newSortOrder = localItems.indexOf(item);
        if (orig && (orig.category_id !== item.category_id || orig.sort_order !== newSortOrder || orig.quantity !== item.quantity)) {
          const { error } = await supabase.from('room_category_standards')
            .update({ category_id: item.category_id, sort_order: newSortOrder, quantity: item.quantity || 1 }).eq('id', item.id);
          if (error) throw error;
        }
      }
      showNotification(title + ' saved successfully');
      setHasChanges(false);
      onClose();
    } catch (err) { showNotification('Error saving: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleCancel() {
    if (hasChanges) {
      if (!(await showConfirm('Discard unsaved changes?', { variant: 'warning' }))) return;
    }
    setLocalItems(JSON.parse(JSON.stringify(originalItems)));
    setHasChanges(false);
    setEditingIdx(null);
    onClose();
  }

  if (!room) return null;

  const usedCategoryIds = localItems.map(s => s.category_id);
  const availableCategories = categories.filter(c => !usedCategoryIds.includes(c.id));
  const editAvailableCategories = editingIdx !== null
    ? categories.filter(c => c.id === localItems[editingIdx]?.category_id || !usedCategoryIds.includes(c.id))
    : [];
  const otherRooms = (allRooms || []).filter(r => r.id !== room.id);

  return (
    <Modal open={open} onClose={handleCancel} title={`${title} - Room ${room.room_number}`} size="md">
      <p className="text-sm text-gray-500 mb-4">Define standard {title.toLowerCase()} categories for Room {room.room_number}
        {hasChanges && <span className="ml-2 text-xs text-orange-500 font-medium">(unsaved changes)</span>}
      </p>

      {/* Add category row */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Add Category</h4>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Sub-Category</label>
            <TreeSelect value={selectedCategory} onChange={v => setSelectedCategory(v)} categories={availableCategories} placeholder="-- Select Category --" />
          </div>
          <Button onClick={handleAdd} disabled={!selectedCategory}><Icons.Plus /></Button>
        </div>
      </div>

      {/* Copy from another room */}
      {otherRooms.length > 0 && (
        <div className="bg-blue-50 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-blue-700 whitespace-nowrap">Copy from:</label>
            <Select value={copyFromRoom} onChange={e => setCopyFromRoom(e.target.value)} className="flex-1">
              <option value="">-- Select Room --</option>
              {otherRooms.map(r => <option key={r.id} value={r.id}>{r.room_number}{r.room_types?.name ? ` (${r.room_types.name})` : ''}</option>)}
            </Select>
            <Button variant="secondary" onClick={handleCopyFrom} disabled={!copyFromRoom || saving}>Copy</Button>
          </div>
        </div>
      )}

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : localItems.length === 0 ? (
        <div className="text-center py-8 text-gray-400">No categories assigned yet</div>
      ) : (
        <div>
          <h4 className={`text-sm font-semibold text-${colors.text} mb-2 flex items-center gap-2`}>
            <span className={`w-2 h-2 bg-${colors.dot} rounded-full`}></span> Assigned Categories ({localItems.length})
          </h4>
          <div className={`bg-${colors.bg} rounded-lg overflow-hidden`}>
            <table className="w-full text-sm">
              <thead><tr className={`bg-${colors.header} text-${colors.text}`}>
                <th className="text-left px-3 py-2 font-medium w-10">#</th>
                <th className="text-left px-3 py-2 font-medium">Code</th>
                <th className="text-left px-3 py-2 font-medium">Category Name</th>
                <th className="text-center px-3 py-2 font-medium w-20">Qty</th>
                <th className="w-32"></th>
              </tr></thead>
              <tbody>
                {localItems.map((s, idx) => (
                  <tr key={s.id || s._tempId} className={`border-t border-${colors.border}`}>
                    {editingIdx === idx ? (
                      <>
                        <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                        <td className="px-3 py-2" colSpan={2}>
                          <TreeSelect value={editCategoryId} onChange={v => setEditCategoryId(v)} categories={editAvailableCategories} placeholder="-- Pilih Kategori --" />
                        </td>
                        <td className="px-2 py-2">
                          <input type="number" min="1" value={s.quantity || 1}
                            onChange={e => { const updated = [...localItems]; updated[idx] = { ...updated[idx], quantity: parseInt(e.target.value) || 1 }; setLocalItems(updated); setHasChanges(true); }}
                            className="w-16 text-center border border-gray-300 rounded px-1 py-0.5 text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(idx)} className="p-1 hover:bg-green-100 rounded text-green-600" title="Save"><Icons.Save /></button>
                            <button onClick={() => setEditingIdx(null)} className="p-1 hover:bg-gray-100 rounded text-gray-400" title="Cancel"><Icons.X /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                        <td className="px-3 py-2"><span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded">{s.item_categories?.code}</span></td>
                        <td className="px-3 py-2 font-medium">{s.item_categories?.name}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="number" min="1" value={s.quantity || 1}
                            onChange={e => { const updated = [...localItems]; updated[idx] = { ...updated[idx], quantity: parseInt(e.target.value) || 1 }; setLocalItems(updated); setHasChanges(true); }}
                            className="w-16 text-center border border-gray-300 rounded px-1 py-0.5 text-sm" />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30" title="Move up">&#9650;</button>
                            <button onClick={() => handleMoveDown(idx)} disabled={idx === localItems.length - 1} className="p-1 hover:bg-gray-100 rounded text-gray-400 disabled:opacity-30" title="Move down">&#9660;</button>
                            <button onClick={() => startEdit(idx)} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="Edit"><Icons.Edit /></button>
                            <button onClick={() => handleRemove(idx)} className="p-1 hover:bg-red-100 rounded text-red-400" title="Delete"><Icons.Trash /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

export default RoomCategoryStandardsModal;
