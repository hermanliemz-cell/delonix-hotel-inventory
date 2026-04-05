import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatDate, formatDateSys, formatNumber, getLocalDateString } from '../utils/format';
import { checkPeriodLock, getBalanceAfter } from '../utils/stock.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
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
          .select('*, rooms(room_number, floor)')
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

  // ==================== STOCK MOVEMENT HELPER ====================
  async function doStockMovement(itemId, movementType, qty, warehouseId, refType, refNumber, notesText, dept, refId, overrideUnitCost) {
    const { data: sb } = await supabase.from('stock_balance')
      .select('id, quantity, avg_cost, total_value')
      .eq('organization_id', selectedOrg.id)
      .eq('item_id', itemId)
      .eq('warehouse_id', warehouseId)
      .maybeSingle();

    // Validate: OUT movements must have sufficient stock (except ADJUSTMENT which is manual correction)
    if (movementType === 'OUT' && refType !== 'ADJUSTMENT') {
      const currentQty = sb ? parseFloat(sb.quantity) || 0 : 0;
      if (currentQty < qty) {
        throw new Error(`Stock tidak cukup di warehouse untuk item ini. Tersedia: ${currentQty}, diminta: ${qty}. Pastikan item yang dipilih sudah benar.`);
      }
    }

    const unitCost = (overrideUnitCost !== undefined && overrideUnitCost !== null) ? overrideUnitCost : (sb ? parseFloat(sb.avg_cost) || 0 : 0);
    const totalCost = qty * unitCost;
    const balAfter = await getBalanceAfter(selectedOrg.id, itemId, movementType, qty, warehouseId);

    const { error: mvErr } = await supabase.from('stock_movements').insert({
      organization_id: selectedOrg.id, item_id: itemId,
      movement_type: movementType, quantity: qty,
      unit_cost: unitCost, total_cost: totalCost,
      balance_after: balAfter, reference_type: refType,
      reference_number: refNumber, reference_id: refId || null,
      warehouse_id: warehouseId,
      notes: notesText, created_by: currentUser?.id,
      department_id: dept || null,
    });
    if (mvErr) throw new Error('Stock movement insert failed: ' + mvErr.message);
    // stock_balance is now updated atomically by DB trigger: trg_sync_stock_balance
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

  // ==================== CONFIRM REQUEST ====================
  // Generates sequential document numbers for Transfer and Consumption docs
  async function generateDocNumber(table, field, prefix) {
    const code = selectedOrg.code || 'ORG';
    const pattern = `${prefix}-${code}-%`;
    const { data } = await supabase.from(table).select(field)
      .eq('organization_id', selectedOrg.id).like(field, pattern)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) {
      const last = parseInt(data[0][field].split('-').pop()) || 0;
      next = last + 1;
    }
    return `${prefix}-${code}-${String(next).padStart(4, '0')}`;
  }

  async function handleConfirm(record) {
    if (saving) return; // Prevent double-click
    if (!(await showConfirm(`Confirm request ${record.request_number}? Transfer and/or consumption documents will be created.`, { variant: 'warning' }))) return;

    setSaving(true);
    try {
      // Re-verify AR status from DB to prevent double confirm
      const { data: freshAR } = await supabase.from('room_additional_requests')
        .select('status').eq('id', record.id).single();
      if (!freshAR || freshAR.status !== 'draft') {
        showNotification('Request has already been confirmed or is no longer in draft status.', 'warning');
        return;
      }

      // Load items with category info
      const { data: items } = await supabase.from('room_additional_request_items')
        .select('*, items(id, code, name, category_id)')
        .eq('request_id', record.id);

      const room = rooms.find(r => r.id === record.room_id);
      if (!room) throw new Error('Room not found');

      // Find HK store warehouse
      const hkStore = warehouses.find(w =>
        (w.warehouse_type === 'store' && (w.code.includes('HK') || w.name.includes('housekeeping'))) ||
        (w.code === 'HK' || w.code.includes('HK'))
      );
      if (!hkStore) throw new Error('HK Store warehouse not found');

      const linenList = (items || []).filter(i => i.item_type === 'linen');
      const amenityList = (items || []).filter(i => i.item_type === 'amenity');

      // ==================== LINEN → Transfer Document ====================
      if (linenList.length > 0) {
        const trNumber = await generateDocNumber('transfers', 'transfer_number', 'TR');

        // Create transfer doc (auto-confirmed)
        const { data: tr, error: trErr } = await supabase.from('transfers').insert({
          organization_id: selectedOrg.id,
          transfer_number: trNumber,
          transfer_date: getLocalDateString(),
          from_warehouse_id: hkStore.id,
          to_warehouse_id: room.warehouse_id,
          status: 'CONFIRMED',
          notes: `Auto-generated from ${record.request_number}`,
        }).select().single();
        if (trErr) throw new Error('Failed to create transfer: ' + trErr.message);

        // Insert transfer_items
        for (const li of linenList) {
          await supabase.from('transfer_items').insert({
            transfer_id: tr.id,
            item_id: li.item_id,
            quantity: parseFloat(li.quantity),
            notes: `From ${record.request_number}`,
          });
        }

        // Stock movements per linen item (OUT from HK + IN to Room)
        for (const li of linenList) {
          const qty = parseFloat(li.quantity);
          await doStockMovement(li.item_id, 'OUT', qty, hkStore.id, 'TRANSFER', trNumber,
            `Transfer to ${room.room_number || 'Room'}`, userDept?.id, null);
          await doStockMovement(li.item_id, 'IN', qty, room.warehouse_id, 'TRANSFER', trNumber,
            `Transfer from ${hkStore.code || 'HK'}`, userDept?.id, null);
        }
      }

      // ==================== AMENITY → Room Consumption Document ====================
      if (amenityList.length > 0) {
        const rcNumber = await generateDocNumber('room_consumption', 'consumption_number', 'RC');

        // Create room_consumption doc (makeup_id = null since from AR, not from Room Makeup)
        const { data: con, error: conErr } = await supabase.from('room_consumption').insert({
          organization_id: selectedOrg.id,
          room_id: record.room_id,
          consumption_number: rcNumber,
          consumption_date: getLocalDateString(),
          warehouse_id: hkStore.id,
          notes: `Auto-generated from ${record.request_number}`,
          created_by: currentUser?.id,
        }).select().single();
        if (conErr) throw new Error('Failed to create consumption: ' + conErr.message);

        // Insert room_consumption_items + stock movements
        for (const ai of amenityList) {
          const qty = parseFloat(ai.quantity);
          // Get unit cost from stock_balance
          const { data: sb } = await supabase.from('stock_balance')
            .select('avg_cost')
            .eq('organization_id', selectedOrg.id)
            .eq('item_id', ai.item_id)
            .eq('warehouse_id', hkStore.id)
            .maybeSingle();
          const unitCost = sb ? parseFloat(sb.avg_cost) || 0 : 0;

          await supabase.from('room_consumption_items').insert({
            consumption_id: con.id,
            item_id: ai.item_id,
            category_id: ai.items?.category_id || null,
            quantity: qty,
            unit_cost: unitCost,
            total_cost: unitCost * qty,
            notes: `From ${record.request_number}`,
          });

          // OUT from HK Store (consume)
          await doStockMovement(ai.item_id, 'OUT', qty, hkStore.id, 'CONSUMPTION', rcNumber,
            'Guest amenity consumed', userDept?.id, con.id);
        }
      }

      // Update AR status
      await supabase.from('room_additional_requests')
        .update({
          status: 'confirmed',
          confirmed_by: currentUser?.id,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', record.id);

      showNotification('Request confirmed successfully', 'success');
      await loadAll();
    } catch (err) {
      showNotification('Error confirming request: ' + err.message, 'error');
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
    if (!(await showConfirm(`Delete request ${record.request_number}? This cannot be undone.`, { variant: 'danger' }))) return;

    try {
      await supabase.from('room_additional_requests').delete().eq('id', record.id);
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
            { header: 'Date', render: r => formatDateSys(r.request_date) },
            { header: 'Room', render: r => r.rooms?.room_number || '-' },
            { header: 'Status', render: r => <StatusBadge status={r.status} /> },
            { header: 'Actions', render: r => (
              <div className="flex gap-2">
                {r.status === 'draft' && (
                  <>
                    <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-700 text-xs font-medium">Edit</button>
                    <button onClick={() => handleConfirm(r)} disabled={saving} className="text-green-600 hover:text-green-700 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">Confirm</button>
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
                          <input type="number" min="1" value={item.quantity}
                            onChange={e => updateItem('linen', idx, 'quantity', parseInt(e.target.value) || 1)}
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
                          <input type="number" min="1" value={item.quantity}
                            onChange={e => updateItem('amenity', idx, 'quantity', parseInt(e.target.value) || 1)}
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
