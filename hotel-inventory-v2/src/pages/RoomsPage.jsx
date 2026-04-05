import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Badge } from '../components/Badge';
import RoomCategoryStandardsModal from '../components/RoomCategoryStandardsModal';
import RoomActivityChecklistModal from '../components/RoomActivityChecklistModal';

function RoomsPage() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification, showConfirm } = useApp();
  const [rooms, setRooms] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [bedFormations, setBedFormations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ room_number: '', floor: '', room_type_id: '', bed_formation_id: '', description: '', is_active: true });
  const [itemsRoom, setItemsRoom] = useState(null);
  const [checklistRoom, setChecklistRoom] = useState(null);
  const [linenRoom, setLinenRoom] = useState(null);
  const [fixedAssetRoom, setFixedAssetRoom] = useState(null);
  const [roomEquipmentRoom, setRoomEquipmentRoom] = useState(null);
  const [filterFloor, setFilterFloor] = useState('');
  const [filterRoomType, setFilterRoomType] = useState('');

  useEffect(() => { if (selectedOrg) loadRooms(); }, [selectedOrg]);

  async function loadRooms() {
    setLoading(true);
    const [roomRes, rtRes, bfRes] = await Promise.all([
      supabase.from('rooms').select('*, warehouses(id, code, name), room_types(id, code, name), bed_formations(id, code, name)')
        .eq('organization_id', selectedOrg.id).order('room_number'),
      supabase.from('room_types').select('*').eq('is_active', true).order('name'),
      supabase.from('bed_formations').select('*').eq('is_active', true).order('name'),
    ]);
    setRooms(roomRes.data || []);
    setRoomTypes(rtRes.data || []);
    setBedFormations(bfRes.data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditing(null);
    setForm({ room_number: '', floor: '', room_type_id: '', bed_formation_id: '', description: '', is_active: true });
    setShowModal(true);
  }

  function openEdit(room) {
    setEditing(room);
    setForm({ room_number: room.room_number, floor: room.floor || '', room_type_id: room.room_type_id || '', bed_formation_id: room.bed_formation_id || '', description: room.description || '', is_active: room.is_active });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.room_number.trim()) return;
    setSaving(true);
    try {
      const selectedRT = roomTypes.find(rt => rt.id === form.room_type_id);
      const payload = {
        organization_id: selectedOrg.id,
        room_number: form.room_number.trim(),
        floor: form.floor.trim() || null,
        room_type_id: form.room_type_id || null,
        room_type: selectedRT ? selectedRT.name.toLowerCase() : 'standard',
        bed_formation_id: form.bed_formation_id || null,
        description: form.description.trim() || null,
        is_active: form.is_active
      };
      if (editing) {
        const { error } = await supabase.from('rooms').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data: newRoom, error } = await supabase.from('rooms').insert(payload).select().single();
        if (error) throw error;

        // Auto-create warehouse for new room
        if (newRoom) {
          const whCode = 'RM-' + (selectedOrg.code || '') + '-' + form.room_number.trim();
          const whName = 'Room ' + form.room_number.trim();
          const { data: wh, error: whErr } = await supabase.from('warehouses').insert({
            organization_id: selectedOrg.id,
            code: whCode,
            name: whName,
            warehouse_type: 'room',
            is_active: true
          }).select().single();
          if (whErr) throw whErr;

          // Update room with warehouse_id
          const { error: rmErr } = await supabase.from('rooms').update({ warehouse_id: wh.id }).eq('id', newRoom.id);
          if (rmErr) throw rmErr;

          showNotification('Room created with warehouse ' + whCode);
        }
      }
      showNotification(t('room.successSave'));
      setShowModal(false);
      loadRooms();
    } catch (err) { showNotification(t('room.errorSave') + ': ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDelete(room) {
    // Check dependencies before delete
    const [rcsRes, muRes] = await Promise.all([
      supabase.from('room_category_standards').select('id', { count: 'exact', head: true }).eq('room_id', room.id),
      supabase.from('room_makeups').select('id', { count: 'exact', head: true }).eq('room_id', room.id),
    ]);
    const deps = [];
    if (rcsRes.count > 0) deps.push(`${rcsRes.count} category standard(s)`);
    if (muRes.count > 0) deps.push(`${muRes.count} room makeup(s)`);
    if (deps.length > 0) {
      const msg = `Cannot delete Room "${room.room_number}" — it has linked data: ${deps.join(', ')}. Deactivate instead?`;
      if (await showConfirm(msg, { variant: 'warning' })) {
        await supabase.from('rooms').update({ is_active: false }).eq('id', room.id);
        loadRooms();
      }
      return;
    }
    if (!(await showConfirm(t('room.confirmDelete'), { variant: 'danger' }))) return;
    try {
      if (room.warehouse_id) {
        await supabase.from('warehouses').update({ is_active: false }).eq('id', room.warehouse_id);
      }
      const { error } = await supabase.from('rooms').delete().eq('id', room.id);
      if (error) throw error;
      showNotification(t('room.successDelete'));
      loadRooms();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  async function toggleWarehouse(room) {
    try {
      if (room.warehouse_id) {
        // Disable warehouse: delete warehouse record, clear warehouse_id
        await supabase.from('warehouses').update({ is_active: false }).eq('id', room.warehouse_id);
        await supabase.from('rooms').update({ warehouse_id: null }).eq('id', room.id);
        showNotification(t('room.warehouseDisabled'));
      } else {
        // Enable warehouse: create warehouse record, set warehouse_id
        const whCode = 'RM-' + (selectedOrg.code || '') + '-' + room.room_number;
        const whName = 'Room ' + room.room_number;
        const { data: wh, error: whErr } = await supabase.from('warehouses').insert({
          organization_id: selectedOrg.id, code: whCode, name: whName,
          warehouse_type: 'room', description: 'Warehouse for room ' + room.room_number, is_active: true
        }).select().single();
        if (whErr) throw whErr;
        const { error: rmErr } = await supabase.from('rooms').update({ warehouse_id: wh.id }).eq('id', room.id);
        if (rmErr) throw rmErr;
        showNotification(t('room.warehouseEnabled'));
      }
      loadRooms();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
  }

  const typeColors = { STD: 'gray', SUP: 'blue', DLX: 'purple', STE: 'amber', CON: 'teal' };

  const floors = [...new Set(rooms.map(r => r.floor).filter(Boolean))].sort();

  const filtered = rooms.filter(r => {
    const matchSearch = !search || r.room_number.toLowerCase().includes(search.toLowerCase()) ||
      (r.room_types?.name || r.room_type || '').toLowerCase().includes(search.toLowerCase()) ||
      (r.floor && r.floor.toLowerCase().includes(search.toLowerCase()));
    const matchFloor = !filterFloor || r.floor === filterFloor;
    const matchType = !filterRoomType || r.room_type_id === filterRoomType;
    return matchSearch && matchFloor && matchType;
  });

  return (
    <div>
      <PageHeader title={t('room.title')} subtitle={`${rooms.length} ${t('menu.rooms')}`}
        actions={<Button onClick={openAdd}><Icons.Plus /> {t('room.addNew')}</Button>} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Icons.Search />
              <input type="text" placeholder={t('items.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
                className="w-full sm:w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" style={{paddingLeft: '2.5rem'}} />
            </div>
            <select value={filterFloor} onChange={e => setFilterFloor(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">All Floor</option>
              {floors.map(f => <option key={f} value={f}>Floor {f}</option>)}
            </select>
            <select value={filterRoomType} onChange={e => setFilterRoomType(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">All Room Type</option>
              {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
            </select>
            {(filterFloor || filterRoomType) && (
              <button onClick={() => { setFilterFloor(''); setFilterRoomType(''); }} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                Clear Filters
              </button>
            )}
          </div>
        </div>
        <DataTable
          loading={loading}
          columns={[
            { header: t('room.roomNumber'), key: 'room_number', render: r => <span className="font-mono text-sm font-bold">{r.room_number}</span> },
            { header: t('room.floor'), render: r => r.floor || '-' },
            { header: t('room.roomType'), render: r => r.room_types ? <Badge color={typeColors[r.room_types.code] || 'gray'}>{r.room_types.name}</Badge> : <span className="text-gray-400">{r.room_type || '-'}</span> },
            { header: t('room.bedFormation'), render: r => r.bed_formations ? <span className="text-sm">{r.bed_formations.name}</span> : <span className="text-gray-400">-</span> },
            { header: t('room.warehouse'), render: r => r.warehouse_id
              ? <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full"><Icons.Link /> {r.warehouses?.code || 'RM-' + r.room_number}</span>
              : <span className="text-gray-400 text-xs">{t('room.warehouseInactive')}</span>
            },
            { header: t('common.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={filtered}
          actions={(row) => (
            <div className="flex items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); setItemsRoom(row); }}
                className="p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100" title="Guest Amenities">
                <Icons.Package />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setLinenRoom(row); }}
                className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100" title="Linen">
                <Icons.Linen />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setFixedAssetRoom(row); }}
                className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100" title="Fixed Asset">
                <Icons.Wrench />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setRoomEquipmentRoom(row); }}
                className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100" title="Room Equipment">
                <Icons.Monitor />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setChecklistRoom(row); }}
                className="p-1.5 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-100" title={t('roomChecklist.title')}>
                <Icons.CheckSquare />
              </button>
              <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit /></button>
              <button onClick={(e) => { e.stopPropagation(); handleDelete(row); }} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Icons.Trash /></button>
            </div>
          )}
        />
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? t('room.editTitle') : t('room.addNew')} size="md">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('room.roomNumber')} required>
            <Input value={form.room_number} onChange={e => setForm({...form, room_number: e.target.value})} placeholder="101" />
          </FormField>
          <FormField label={t('room.floor')}>
            <Input value={form.floor} onChange={e => setForm({...form, floor: e.target.value})} placeholder="1" />
          </FormField>
          <FormField label={t('room.roomType')}>
            <Select value={form.room_type_id} onChange={e => setForm({...form, room_type_id: e.target.value})}>
              <option value="">-- Select Room Type --</option>
              {roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name} ({rt.code})</option>)}
            </Select>
          </FormField>
          <FormField label={t('room.bedFormation')}>
            <Select value={form.bed_formation_id} onChange={e => setForm({...form, bed_formation_id: e.target.value})}>
              <option value="">-- Select Bed Formation --</option>
              {bedFormations.map(bf => <option key={bf.id} value={bf.id}>{bf.name} ({bf.code})</option>)}
            </Select>
          </FormField>
          <FormField label={t('common.status')}>
            <Select value={form.is_active} onChange={e => setForm({...form, is_active: e.target.value === 'true'})}>
              <option value="true">{t('common.active')}</option>
              <option value="false">{t('common.inactive')}</option>
            </Select>
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('common.description')}>
              <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder={t('common.description')} />
            </FormField>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>{editing ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>

      <RoomCategoryStandardsModal room={itemsRoom} open={!!itemsRoom} onClose={() => setItemsRoom(null)}
        standardType="guest_amenities" parentCategoryCode="AMN" title="Guest Amenities"
        colorScheme={{ bg: 'purple-50', header: 'purple-100', text: 'purple-800', border: 'purple-200', dot: 'purple-500' }} allRooms={rooms} />
      <RoomCategoryStandardsModal room={linenRoom} open={!!linenRoom} onClose={() => setLinenRoom(null)}
        standardType="linen" parentCategoryCode="LIN" title="Linen"
        colorScheme={{ bg: 'blue-50', header: 'blue-100', text: 'blue-800', border: 'blue-200', dot: 'blue-500' }} allRooms={rooms} />
      <RoomCategoryStandardsModal room={fixedAssetRoom} open={!!fixedAssetRoom} onClose={() => setFixedAssetRoom(null)}
        standardType="fixed_assets" parentCategoryCode="FAI" title="Fixed Assets"
        colorScheme={{ bg: 'amber-50', header: 'amber-100', text: 'amber-800', border: 'amber-200', dot: 'amber-500' }} allRooms={rooms} />
      <RoomCategoryStandardsModal room={roomEquipmentRoom} open={!!roomEquipmentRoom} onClose={() => setRoomEquipmentRoom(null)}
        standardType="room_equipment" parentCategoryCode="EQP" title="Room Equipment"
        colorScheme={{ bg: 'indigo-50', header: 'indigo-100', text: 'indigo-800', border: 'indigo-200', dot: 'indigo-500' }} allRooms={rooms} />
      <RoomActivityChecklistModal room={checklistRoom} open={!!checklistRoom} onClose={() => setChecklistRoom(null)} allRooms={rooms} />
    </div>
  );
}

export default RoomsPage;
