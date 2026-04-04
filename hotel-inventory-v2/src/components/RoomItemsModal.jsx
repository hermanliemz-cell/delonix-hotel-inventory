import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Icons } from './Icons';
import { Modal } from './Modal';
import { Input, Select, Button } from './FormElements';

function RoomItemsModal({ room, open, onClose }) {
  const { t } = useTranslation();
  const { showNotification, selectedOrg } = useApp();
  const [roomItems, setRoomItems] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({ item_id: '', type: 'replace', default_qty: 1 });
  const [adding, setAdding] = useState(false);

  useEffect(() => { if (open && room) loadRoomItems(); }, [open, room]);

  async function loadRoomItems() {
    setLoading(true);
    const [riRes, itemsRes] = await Promise.all([
      supabase.from('room_items').select('*, items(id, code, name, brand)').eq('room_id', room.id).order('type').order('created_at'),
      supabase.from('items').select('id, code, name, brand').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('name'),
    ]);
    setRoomItems(riRes.data || []);
    setAllItems(itemsRes.data || []);
    setLoading(false);
  }

  async function handleAdd() {
    if (!addForm.item_id || !addForm.type) return;
    const exists = roomItems.find(ri => ri.item_id === addForm.item_id && ri.type === addForm.type);
    if (exists) { showNotification(t('roomItems.duplicate'), 'error'); return; }
    setAdding(true);
    try {
      const { error } = await supabase.from('room_items').insert({ room_id: room.id, item_id: addForm.item_id, type: addForm.type, default_qty: parseFloat(addForm.default_qty) || 1 });
      if (error) throw error;
      showNotification(t('roomItems.successAdd'));
      setAddForm({ item_id: '', type: 'replace', default_qty: 1 });
      loadRoomItems();
    } catch (err) { showNotification(t('roomItems.errorAdd') + ': ' + err.message, 'error'); }
    setAdding(false);
  }

  async function handleRemove(id) {
    try {
      const { error } = await supabase.from('room_items').delete().eq('id', id);
      if (error) throw error;
      showNotification(t('roomItems.successDelete'));
      loadRoomItems();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function handleQtyChange(id, newQty) {
    try {
      const { error } = await supabase.from('room_items').update({ default_qty: parseFloat(newQty) || 1 }).eq('id', id);
      if (error) throw error;
      setRoomItems(prev => prev.map(ri => ri.id === id ? { ...ri, default_qty: parseFloat(newQty) || 1 } : ri));
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  if (!room) return null;

  const replaceItems = roomItems.filter(ri => ri.type === 'replace');
  const refillItems = roomItems.filter(ri => ri.type === 'refill');

  return (
    <Modal open={open} onClose={onClose} title={`${t('roomItems.title')} - ${room.room_number}`} size="lg">
      <p className="text-sm text-gray-500 mb-4">{t('roomItems.subtitle')} {room.room_number}</p>

      {/* Add new item form */}
      <div className="bg-gray-50 rounded-lg p-4 mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('roomItems.addItem')}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('roomItems.item')}</label>
            <Select value={addForm.item_id} onChange={e => setAddForm({...addForm, item_id: e.target.value})}>
              <option value="">{t('roomItems.selectItem')}</option>
              {allItems.map(item => <option key={item.id} value={item.id}>{item.code} - {item.name}{item.brand ? ` (${item.brand})` : ''}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{t('roomItems.type')}</label>
            <Select value={addForm.type} onChange={e => setAddForm({...addForm, type: e.target.value})}>
              <option value="replace">{t('roomItems.replace')}</option>
              <option value="refill">{t('roomItems.refill')}</option>
            </Select>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('roomItems.defaultQty')}</label>
              <Input type="number" min="0.01" step="0.01" value={addForm.default_qty} onChange={e => setAddForm({...addForm, default_qty: e.target.value})} />
            </div>
            <Button onClick={handleAdd} disabled={adding || !addForm.item_id}><Icons.Plus /></Button>
          </div>
        </div>
      </div>

      {loading ? <div className="text-center py-8 text-gray-400">Loading...</div> : roomItems.length === 0 ? (
        <div className="text-center py-8 text-gray-400">{t('roomItems.noItems')}</div>
      ) : (
        <div className="space-y-4">
          {/* Replace items */}
          {replaceItems.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-orange-500 rounded-full"></span> {t('roomItems.replace')} ({replaceItems.length})
              </h4>
              <div className="bg-orange-50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-orange-100 text-orange-800">
                    <th className="text-left px-3 py-2 font-medium">{t('roomItems.item')}</th>
                    <th className="text-center px-3 py-2 font-medium w-24">{t('roomItems.defaultQty')}</th>
                    <th className="w-10"></th>
                  </tr></thead>
                  <tbody>
                    {replaceItems.map(ri => (
                      <tr key={ri.id} className="border-t border-orange-100">
                        <td className="px-3 py-2"><span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded mr-2">{ri.items?.code}</span>{ri.items?.name}{ri.items?.brand ? <span className="text-gray-400 ml-1">({ri.items.brand})</span> : ''}</td>
                        <td className="px-3 py-2 text-center"><input type="number" min="0.01" step="0.01" value={ri.default_qty} onChange={e => handleQtyChange(ri.id, e.target.value)} className="w-20 text-center border border-orange-200 rounded px-2 py-1 text-sm" /></td>
                        <td className="px-2 py-2"><button onClick={() => handleRemove(ri.id)} className="p-1 hover:bg-red-100 rounded text-red-400"><Icons.Trash /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Refill items */}
          {refillItems.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span> {t('roomItems.refill')} ({refillItems.length})
              </h4>
              <div className="bg-blue-50 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-blue-100 text-blue-800">
                    <th className="text-left px-3 py-2 font-medium">{t('roomItems.item')}</th>
                    <th className="text-center px-3 py-2 font-medium w-24">{t('roomItems.defaultQty')}</th>
                    <th className="w-10"></th>
                  </tr></thead>
                  <tbody>
                    {refillItems.map(ri => (
                      <tr key={ri.id} className="border-t border-blue-100">
                        <td className="px-3 py-2"><span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded mr-2">{ri.items?.code}</span>{ri.items?.name}{ri.items?.brand ? <span className="text-gray-400 ml-1">({ri.items.brand})</span> : ''}</td>
                        <td className="px-3 py-2 text-center"><input type="number" min="0.01" step="0.01" value={ri.default_qty} onChange={e => handleQtyChange(ri.id, e.target.value)} className="w-20 text-center border border-blue-200 rounded px-2 py-1 text-sm" /></td>
                        <td className="px-2 py-2"><button onClick={() => handleRemove(ri.id)} className="p-1 hover:bg-red-100 rounded text-red-400"><Icons.Trash /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end mt-6 pt-4 border-t">
        <Button variant="secondary" onClick={onClose}>{t('common.close') || 'Close'}</Button>
      </div>
    </Modal>
  );
}

export default RoomItemsModal;
