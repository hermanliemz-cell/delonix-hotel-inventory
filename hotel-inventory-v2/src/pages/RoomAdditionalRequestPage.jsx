import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatDate, formatDateSys, formatNumber, getLocalDateString } from '../utils/format';
import { checkPeriodLock } from '../utils/stock.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
import { PageLoader } from '../components/PageLoader';

function RoomAdditionalRequestPage() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();

  // List state
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewItems, setViewItems] = useState([]);

  // Form state
  const [selectedRoom, setSelectedRoom] = useState('');
  const [activeTab, setActiveTab] = useState('linen');
  const [linenItems, setLinenItems] = useState([]);
  const [amenityItems, setAmenityItems] = useState([]);

  // Master data
  const [rooms, setRooms] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [userDept, setUserDept] = useState(null);

  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  // ==================== LOAD ALL DATA ====================
  async function loadAll() {
    setLoading(true);
    try {
      const [recRes, roomRes, itemRes, whRes] = await Promise.all([
        supabase.from('room_additional_requests')
          .select('*, rooms(room_number, floor), created_by_user:created_by(full_name, username), departments(code, name)')
          .eq('organization_id', selectedOrg.id)
          .order('created_at', { ascending: false }),
        supabase.from('rooms').select('id, room_number, floor, warehouse_id, room_types(name)')
          .eq('organization_id', selectedOrg.id).order('room_number'),
        supabase.from('items').select('id, code, name, brand, category_id, unit_id, default_warehouse_id, item_categories(id, code, name, parent_id), units:unit_id(abbreviation)')
          .eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
        supabase.from('warehouses').select('id, code, name, warehouse_type')
          .eq('organization_id', selectedOrg.id).eq('is_active', true).order('code'),
      ]);
      setRecords(recRes.data || []);
      setRooms(roomRes.data || []);
      setAllItems(itemRes.data || []);
      setWarehouses(whRes.data || []);

      // Load user department
      if (currentUser?.id) {
        const { data: userData } = await supabase.from('users')
          .select('department_id, departments(id, code, name)')
          .eq('id', currentUser.id).single();
        if (userData?.departments) setUserDept(userData.departments);
      }
    } catch (err) {
      showNotification('Error loading data: ' + err.message, 'error');
    }
    setLoading(false);
  }

  // ==================== GENERATE REQUEST NUMBER ====================
  async function generateRequestNumber() {
    const code = selectedOrg.code || 'ORG';
    const pattern = `AR-${code}-%`;
    const { data } = await supabase.from('room_additional_requests').select('request_number')
      .eq('organization_id', selectedOrg.id).like('request_number', pattern)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const last = parseInt(data[0].request_number.split('-').pop()) || 0;
      next = last + 1;
    }
    return `AR-${code}-${String(next).padStart(4, '0')}`;
  }

  // ==================== FORM FUNCTIONS ====================
  function openCreate() {
    setEditingId(null);
    setSelectedRoom('');
    setActiveTab('linen');
    setLinenItems([]);
    setAmenityItems([]);
    setViewRecord(null);
    setShowModal(true);
  }

  async function openEdit(record) {
    setEditingId(record.id);
    setSelectedRoom(record.room_id);
    setViewRecord(null);
    setActiveTab('linen');

    // Load existing items
    try {
      const { data: items } = await supabase.from('room_additional_request_items')
        .select('*').eq('request_id', record.id);

      const linen = (items || []).filter(i => i.item_type === 'linen');
      const amenity = (items || []).filter(i => i.item_type === 'amenity');

      setLinenItems(linen.map(i => ({ item_id: i.item_id, quantity: i.quantity })));
      setAmenityItems(amenity.map(i => ({ item_id: i.item_id, quantity: i.quantity })));
    } catch (err) {
      showNotification('Error loading items: ' + err.message, 'error');
    }
    setShowModal(true);
  }

  function addItem(type) {
    if (type === 'linen') {
      setLinenItems(prev => [...prev, { item_id: '', quantity: 1 }]);
    } else {
      setAmenityItems(prev => [...prev, { item_id: '', quantity: 1 }]);
    }
  }

  function removeItem(type, idx) {
    if (type === 'linen') {
      setLinenItems(prev => prev.filter((_, i) => i !== idx));
    } else {
      setAmenityItems(prev => prev.filter((_, i) => i !== idx));
    }
  }

  function updateItem(type, idx, field, value) {
    if (type === 'linen') {
      setLinenItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    } else {
      setAmenityItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    }
  }

  // ==================== SAVE DRAFT ====================
  async function handleSaveDraft() {
    if (saving) return; // Prevent double-click
    if (!selectedRoom) {
      showNotification('Please select a room', 'error');
      return;
    }

    const allRequestItems = [
      ...linenItems.filter(i => i.item_id && i.quantity > 0).map(i => ({ ...i, item_type: 'linen' })),
      ...amenityItems.filter(i => i.item_id && i.quantity > 0).map(i => ({ ...i, item_type: 'amenity' }))
    ];

    if (allRequestItems.length === 0) {
      showNotification('Please add at least one item', 'error');
      return;
    }

    setSaving(true);
    try {
      let requestId = editingId;

      if (!requestId) {
        // Create new request
        const requestNumber = await generateRequestNumber();
        const { data: newReq } = await supabase.from('room_additional_requests')
          .insert({
            organization_id: selectedOrg.id,
            room_id: selectedRoom,
            request_number: requestNumber,
            request_date: getLocalDateString(),
            created_by: currentUser?.id,
            department_id: currentUser?.department_id || null,
            status: 'draft',
          })
          .select()
          .single();
        requestId = newReq.id;
      } else {
        // Update existing request
        await supabase.from('room_additional_requests')
          .update({ room_id: selectedRoom, request_date: getLocalDateString() })
          .eq('id', requestId);

        // Delete old items
        await supabase.from('room_additional_request_items').delete().eq('request_id', requestId);
      }

      // Insert new items
      for (const item of allRequestItems) {
        await supabase.from('room_additional_request_items').insert({
          request_id: requestId,
          item_id: item.item_id,
          item_type: item.item_type,
          quantity: item.quantity,
        });
      }

      showNotification('Request saved successfully', 'success');
      await loadAll();
      setShowModal(false);
    } catch (err) {
      showNotification('Error saving request: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ==================== CONFIRM REQUEST (via atomic RPC) ====================
  async function handleConfirm(record) {
    if (saving) return; // Prevent double-click
    if (!(await showConfirm(`Confirm request ${record.request_number}? Transfer and/or consumption documents will be created.`, { variant: 'warning' }))) return;

    setSaving(true);
    try {
      // Single atomic server-side RPC: lock → validate stock → create transfer + items +
      // movements → create consumption + items + movements → confirm status.
      // PostgreSQL transaction ensures all-or-nothing: if anything fails (including
      // network drop mid-operation), the whole transaction rolls back cleanly — no
      // orphaned docs, no partial movements, no stuck 'processing' state.
      const { data, error } = await supabase.rpc('fn_confirm_room_additional_request', {
        p_request_id: record.id,
        p_user_id: currentUser?.id || null,
        p_department_id: currentUser?.department_id || null,
        p_transfer_date: getLocalDateString(),
      });
      if (error) throw error;
      const parts = [];
      if (data?.transfer_number) parts.push(`Transfer: ${data.transfer_number}`);
      if (data?.consumption_number) parts.push(`Consumption: ${data.consumption_number}`);
      showNotification(`Request confirmed. ${parts.join(' | ')}`, 'success');
      await loadAll();
    } catch (err) {
      showNotification('Error confirming request: ' + (err.message || err), 'error');
    } finally {
      setSaving(false);
    }
  }

  // ==================== VIEW RECORD ====================
  async function viewRecordDetail(record) {
    setViewRecord(record);
    try {
      const { data: items } = await supabase.from('room_additional_request_items')
        .select('*, items(code, name, brand, units:unit_id(abbreviation))')
        .eq('request_id', record.id);
      setViewItems(items || []);
    } catch (err) {
      showNotification('Error loading items: ' + err.message, 'error');
    }
  }

  // ==================== DELETE REQUEST ====================
  async function handleDelete(record) {
    if (record.status !== 'draft') {
      showNotification('Hanya dokumen DRAFT yang bisa dihapus', 'error');
      return;
    }
    if (!(await showConfirm(`Delete request ${record.request_number}? This cannot be undone.`, { variant: 'danger' }))) return;

    try {
      const { error: itemErr } = await supabase.from('room_additional_request_items').delete().eq('request_id', record.id);
      if (itemErr) throw itemErr;
      const { error: reqErr } = await supabase.from('room_additional_requests').delete().eq('id', record.id);
      if (reqErr) throw reqErr;
      showNotification('Request deleted successfully', 'success');
      await loadAll();
    } catch (err) {
      showNotification('Error deleting request: ' + err.message, 'error');
    }
  }

  // ==================== FILTER ====================
  const filtered = records.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      return r.request_number?.toLowerCase().includes(s) || r.rooms?.room_number?.toLowerCase().includes(s);
    }
    return true;
  });

  // ==================== ITEM FILTERS BY CATEGORY ====================
  function getLinenItems() {
    return allItems.filter(item => {
      const cat = item.item_categories;
      return cat && (
        cat.code?.toUpperCase().startsWith('LIN') ||
        cat.name?.toLowerCase().includes('linen')
      );
    });
  }

  function getAmenityItems() {
    return allItems.filter(item => {
      const cat = item.item_categories;
      return cat && (
        cat.code?.toUpperCase().startsWith('AMN') ||
        cat.code?.toUpperCase().startsWith('GA') ||
        cat.name?.toLowerCase().includes('amenity') ||
        cat.name?.toLowerCase().includes('amenities') ||
        cat.name?.toLowerCase().includes('guest')
      );
    });
  }

  return (
    <div>
      <PageHeader title="Room Additional Request" subtitle={`Requests - ${selectedOrg?.name || ''}`} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 sm:flex-initial px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
          </select>

          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            New Request
          </Button>
        </div>

        <div className="hidden sm:block">
          <DataTable loading={loading} columns={[
            { header: 'Number', render: r => <button onClick={() => viewRecordDetail(r)} className="font-mono text-xs font-semibold text-blue-700 hover:underline cursor-pointer">{r.request_number}</button> },
            { header: 'Date', render: r => <div><div>{formatDateSys(r.request_date)}</div>{r.confirmed_at && <div className="text-xs text-gray-400">{formatDateSys(r.confirmed_at, { includeTime: true })}</div>}</div> },
            { header: 'Room', render: r => r.rooms?.room_number || '-' },
            { header: 'User', render: r => <span className="text-xs">{r.created_by_user?.full_name || r.created_by_user?.username || '-'}</span> },
            { header: 'Dept', render: r => r.departments ? <Badge color="blue">{r.departments.code}</Badge> : <span className="text-gray-300">-</span> },
            { header: 'Status', render: r => <StatusBadge status={r.status} /> },
            { header: 'Actions', render: r => (
              <div className="flex gap-2">
                {r.status === 'draft' && (
                  <>
                    <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Edit</button>
                    <button onClick={() => handleConfirm(r)} disabled={saving} className="text-green-600 hover:text-green-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">Confirm</button>
                    <button onClick={() => handleDelete(r)} disabled={saving} className="text-red-600 hover:text-red-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">Delete</button>
                  </>
                )}
              </div>
            ) },
          ]} data={filtered} />
        </div>

        <div className="sm:hidden divide-y divide-gray-100">
          {loading ? <PageLoader /> :
           filtered.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">No data</div> :
           filtered.map(r => (
            <div key={r.id} className="p-4 cursor-pointer hover:bg-gray-50" onClick={() => viewRecordDetail(r)}>
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-blue-700 text-sm">{r.request_number}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Room: {r.rooms?.room_number || '-'}</span>
                <span>{formatDateSys(r.request_date)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CREATE/EDIT MODAL */}
      <Modal open={showModal && !viewRecord} onClose={() => { setShowModal(false); setEditingId(null); }} title={editingId ? 'Edit Request' : 'New Request'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 bg-blue-50 rounded-lg p-3">
            <div>
              <label className="text-xs text-blue-400 font-medium">Department</label>
              <p className="text-sm font-medium">{userDept?.name || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-blue-400 font-medium">User</label>
              <p className="text-sm font-medium">{currentUser?.full_name || currentUser?.username || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-blue-400 font-medium">Date</label>
              <p className="text-sm font-medium">{getLocalDateString()}</p>
            </div>
            <div>
              <label className="text-xs text-blue-400 font-medium block mb-1">Room</label>
              <select value={selectedRoom} onChange={e => setSelectedRoom(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Select Room...</option>
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>{r.room_number}</option>
                ))}
              </select>
            </div>
          </div>

          {/* TABS */}
          <div className="flex gap-2 border-b border-gray-200">
            <button onClick={() => setActiveTab('linen')}
              className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'linen' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
              Linen
            </button>
            <button onClick={() => setActiveTab('amenity')}
              className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'amenity' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
              Amenities
            </button>
          </div>

          {/* LINEN TAB */}
          {activeTab === 'linen' && (
            <div className="space-y-3">
              <button type="button" onClick={() => addItem('linen')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ Add Linen</button>

              <div className="border border-gray-200 rounded-lg overflow-visible">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700 w-20">Qty</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700 w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linenItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <SearchableItemSelect
                            items={getLinenItems()}
                            value={item.item_id}
                            onChange={v => updateItem('linen', idx, 'item_id', v)}
                            placeholder="Search linen..."
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input {...intQtyInputProps} min={1} value={item.quantity}
                            onChange={e => updateItem('linen', idx, 'quantity', Math.max(1, toIntQty(e.target.value)))}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs text-right" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeItem('linen', idx)} className="text-red-600 hover:text-red-700 text-xs">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* AMENITY TAB */}
          {activeTab === 'amenity' && (
            <div className="space-y-3">
              <button type="button" onClick={() => addItem('amenity')} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ Add Amenity</button>

              <div className="border border-gray-200 rounded-lg overflow-visible">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-700">Item</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-700 w-20">Qty</th>
                      <th className="px-3 py-2 text-center font-medium text-gray-700 w-12">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amenityItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <SearchableItemSelect
                            items={getAmenityItems()}
                            value={item.item_id}
                            onChange={v => updateItem('amenity', idx, 'item_id', v)}
                            placeholder="Search amenity..."
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input {...intQtyInputProps} min={1} value={item.quantity}
                            onChange={e => updateItem('amenity', idx, 'quantity', Math.max(1, toIntQty(e.target.value)))}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-xs text-right" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeItem('amenity', idx)} className="text-red-600 hover:text-red-700 text-xs">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button variant="secondary" onClick={() => { setShowModal(false); setEditingId(null); }}>Cancel</Button>
          <Button onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving...' : 'Save Draft'}</Button>
        </div>
      </Modal>

      {/* VIEW MODAL */}
      <Modal open={!!viewRecord} onClose={() => setViewRecord(null)} title={viewRecord?.request_number || ''} size="lg">
        {viewRecord && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4 bg-blue-50 rounded-lg p-3 text-sm">
              <div><p className="text-xs text-blue-400">Number</p><p className="font-medium">{viewRecord.request_number}</p></div>
              <div><p className="text-xs text-blue-400">Date</p><p className="font-medium">{formatDateSys(viewRecord.request_date)}</p></div>
              <div><p className="text-xs text-blue-400">Room</p><p className="font-medium">{viewRecord.rooms?.room_number}</p></div>
              <div><p className="text-xs text-blue-400">Status</p><p className="font-medium"><StatusBadge status={viewRecord.status} /></p></div>
            </div>

            {viewItems.filter(i => i.item_type === 'linen').length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Linen Items</h4>
                <div className="border border-blue-200 rounded-lg divide-y">
                  {viewItems.filter(i => i.item_type === 'linen').map(d => (
                    <div key={d.id} className="p-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">{d.items?.name}</p>
                        <p className="text-xs text-gray-400">{d.items?.code}</p>
                      </div>
                      <p className="font-semibold text-sm text-blue-700">{formatNumber(d.quantity)} {d.items?.units?.abbreviation || ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewItems.filter(i => i.item_type === 'amenity').length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2">Amenity Items</h4>
                <div className="border border-blue-200 rounded-lg divide-y">
                  {viewItems.filter(i => i.item_type === 'amenity').map(d => (
                    <div key={d.id} className="p-3 flex justify-between items-center">
                      <div>
                        <p className="font-medium text-sm">{d.items?.name}</p>
                        <p className="text-xs text-gray-400">{d.items?.code}</p>
                      </div>
                      <p className="font-semibold text-sm text-blue-700">{formatNumber(d.quantity)} {d.items?.units?.abbreviation || ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          {viewRecord && viewRecord.status === 'draft' && (
            <>
              <button type="button" onClick={() => { setViewRecord(null); openEdit(viewRecord); }} className="px-3 py-1.5 border border-blue-600 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50">Edit</button>
              <button type="button" onClick={() => { setViewRecord(null); handleConfirm(viewRecord); }} disabled={saving} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">Confirm</button>
              <button type="button" onClick={() => { setViewRecord(null); handleDelete(viewRecord); }} className="px-3 py-1.5 border border-red-600 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">Delete</button>
            </>
          )}
          <Button variant="secondary" onClick={() => setViewRecord(null)}>Close</Button>
        </div>
      </Modal>
    </div>
  );
}

export default RoomAdditionalRequestPage;
