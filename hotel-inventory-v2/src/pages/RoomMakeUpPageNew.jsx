import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDate, formatDateSys, getLocalDateString } from '../utils/format';
import { checkPeriodLock } from '../utils/stock.js';
import { recordMovement } from '../services/stockService.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader } from '../components/PageLoader';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function RoomMakeUpPageNew() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();

  // List state
  const [makeups, setMakeups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterHousekeeper, setFilterHousekeeper] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterRoomSearch, setFilterRoomSearch] = useState('');
  const [filterRoomOpen, setFilterRoomOpen] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState('today');
  const [filterCount, setFilterCount] = useState('');
  const filterRoomRef = React.useRef(null);

  // Form state
  const [showModal, setShowModal] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [makeupDate, setMakeupDate] = useState(getLocalDateString());
  const [activeTab, setActiveTab] = useState('linen');
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');

  // Master data
  const [rooms, setRooms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [allItems, setAllItems] = useState([]);

  // Tab 1: Linen
  const [linenCategories, setLinenCategories] = useState([]);
  const [linenRoomStock, setLinenRoomStock] = useState([]);
  const [linenActions, setLinenActions] = useState({});
  const [replaceRows, setReplaceRows] = useState({});
  const [collapsedSections, setCollapsedSections] = useState({});
  const [userDept, setUserDept] = useState(null);

  // Tab 2: Guest Amenities
  const [amenityCategories, setAmenityCategories] = useState([]);
  const [amenityAvailableItems, setAmenityAvailableItems] = useState([]);
  const [amenityQty, setAmenityQty] = useState({});

  // Tab 3: Activity List
  const [activityList, setActivityList] = useState([]);
  const [activityChecks, setActivityChecks] = useState({});

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // ==================== LOAD DATA ====================
  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  // Determine if current user can view all room makeups (not just own).
  // Superadmin and GM always can; other roles can only if their role has
  // special_actions.view_all_room_makeups = true or permissions.all = true.
  const canViewAllMakeups = React.useMemo(() => {
    const roleCode = currentUser?.role?.code;
    if (roleCode === 'superadmin' || roleCode === 'gm') return true;
    const perms = currentUser?.role?.permissions;
    if (perms?.all === true) return true;
    if (perms?.special_actions?.view_all_room_makeups === true) return true;
    return false;
  }, [currentUser?.role?.code, currentUser?.role?.permissions]);

  async function loadAll() {
    setLoading(true);
    try {
      let muQuery = supabase.from('room_makeups')
        .select('*, rooms!left(room_number, floor), users:created_by(full_name, username), departments:department_id(code, name)')
        .eq('organization_id', selectedOrg.id);
      if (!canViewAllMakeups && currentUser?.id) {
        muQuery = muQuery.eq('created_by', currentUser.id);
      }
      muQuery = muQuery.order('created_at', { ascending: false });
      const [muRes, roomRes, whRes, itemRes] = await Promise.all([
        muQuery,
        supabase.from('rooms').select('id, room_number, floor, warehouse_id, room_types(name)')
          .eq('organization_id', selectedOrg.id).order('room_number'),
        supabase.from('warehouses').select('id, code, name, warehouse_type')
          .eq('organization_id', selectedOrg.id).eq('is_active', true).order('code'),
        supabase.from('items').select('id, code, name, brand, category_id, unit_id, default_warehouse_id, item_categories(id, code, name, parent_id), units:unit_id(abbreviation)')
          .eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      ]);
      setMakeups(muRes.data || []);
      setRooms(roomRes.data || []);
      setWarehouses(whRes.data || []);
      setAllItems(itemRes.data || []);

      if (currentUser?.id) {
        const { data: userData } = await supabase.from('users')
          .select('department_id, departments(id, code, name)')
          .eq('id', currentUser.id).single();
        if (userData?.departments) setUserDept(userData.departments);
      }

      // === AUTO-RECOVERY: Reset stuck PROCESSING (>5 menit) ke DRAFT ===
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const stuckDocs = (muRes.data || []).filter(m =>
        m.status === 'PROCESSING' && m.created_at && m.created_at < fiveMinAgo
      );
      if (stuckDocs.length > 0) {
        for (const doc of stuckDocs) {
          await supabase.from('room_makeups')
            .update({ status: 'DRAFT' })
            .eq('id', doc.id)
            .eq('status', 'PROCESSING');
        }
        showNotification(`${stuckDocs.length} dokumen stuck (PROCESSING > 5 menit) telah dikembalikan ke DRAFT.`, 'warning');
        // Reload to reflect updated status
        let refreshQuery = supabase.from('room_makeups')
          .select('*, rooms!left(room_number, floor), users:created_by(full_name, username), departments:department_id(code, name)')
          .eq('organization_id', selectedOrg.id);
        if (!canViewAllMakeups && currentUser?.id) {
          refreshQuery = refreshQuery.eq('created_by', currentUser.id);
        }
        const { data: refreshed } = await refreshQuery.order('created_at', { ascending: false });
        setMakeups(refreshed || []);
      }
    } catch (err) {
      showNotification('Error loading data: ' + err.message, 'error');
    }
    setLoading(false);
  }

  // ==================== NUMBER GENERATORS ====================
  async function generateNumber(table, field, prefix) {
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

  // ==================== ROOM SELECT ====================
  async function handleRoomSelect(roomId) {
    setLinenActions({});
    setReplaceRows({});
    setAmenityQty({});
    setActivityChecks({});
    setCollapsedSections({});

    if (!roomId) {
      setSelectedRoom('');
      setLinenCategories([]);
      setLinenRoomStock([]);
      setAmenityCategories([]);
      setAmenityAvailableItems([]);
      setActivityList([]);
      return;
    }

    setSelectedRoom(roomId);
    const room = rooms.find(r => r.id === roomId);

    try {
      const { data: standards } = await supabase.from('room_category_standards')
        .select('*, item_categories(id, code, name)')
        .eq('room_id', roomId).order('sort_order');

      const linenStds = (standards || []).filter(s => s.standard_type === 'linen');
      const amenityStds = (standards || []).filter(s => s.standard_type === 'guest_amenities');

      setLinenCategories(linenStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));
      setAmenityCategories(amenityStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));

      if (room?.warehouse_id) {
        const { data: roomStock } = await supabase.from('stock_balance')
          .select('id, item_id, quantity, avg_cost, items(id, code, name, brand, category_id, units:unit_id(abbreviation))')
          .eq('organization_id', selectedOrg.id)
          .eq('warehouse_id', room.warehouse_id)
          .gt('quantity', 0);
        setLinenRoomStock(roomStock || []);
      } else {
        setLinenRoomStock([]);
      }

      const amenityCatIds = amenityStds.map(s => s.category_id).filter(Boolean);
      if (amenityCatIds.length > 0) {
        setAmenityAvailableItems((allItems || []).filter(item => amenityCatIds.includes(item.category_id)));
      } else {
        setAmenityAvailableItems([]);
      }

      const { data: activities } = await supabase.from('room_activity_checklist')
        .select('*').eq('room_id', roomId).eq('is_active', true).order('sort_order');
      setActivityList(activities || []);

      const checks = {};
      (activities || []).forEach(a => { checks[a.id] = { isDone: false, notes: '' }; });
      setActivityChecks(checks);

      // Mobile: default all sections collapsed except first
      if (isMobile && linenStds.length > 1) {
        const collapsed = {};
        linenStds.forEach((s, idx) => { if (idx > 0) collapsed['linen_' + s.item_categories?.id] = true; });
        setCollapsedSections(collapsed);
      }

    } catch (err) {
      showNotification('Error loading room data: ' + err.message, 'error');
    }
  }

  // ==================== FORM OPEN/CLOSE ====================
  function openNew() {
    setViewing(null);
    setIsEditing(false);
    setSelectedRoom('');
    setMakeupDate(getLocalDateString());
    setActiveTab('linen');
    setLinenActions({});
    setReplaceRows({});
    setAmenityQty({});
    setActivityChecks({});
    setNotes('');
    setShowModal(true);
  }

  async function openView(mu) {
    setViewing(mu);
    setIsEditing(false);
    setSelectedRoom(mu.room_id);
    setMakeupDate(mu.makeup_date);
    setNotes(mu.notes || '');
    setActiveTab('linen');
    setShowModal(true);

    const room = rooms.find(r => r.id === mu.room_id);

    try {
      const { data: standards } = await supabase.from('room_category_standards')
        .select('*, item_categories(id, code, name)')
        .eq('room_id', mu.room_id).order('sort_order');
      const linenStds = (standards || []).filter(s => s.standard_type === 'linen');
      const amenityStds = (standards || []).filter(s => s.standard_type === 'guest_amenities');
      setLinenCategories(linenStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));
      setAmenityCategories(amenityStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));

      if (room?.warehouse_id) {
        const { data: roomStock } = await supabase.from('stock_balance')
          .select('id, item_id, quantity, avg_cost, items(id, code, name, brand, category_id, units:unit_id(abbreviation))')
          .eq('organization_id', selectedOrg.id).eq('warehouse_id', room.warehouse_id).gt('quantity', 0);
        setLinenRoomStock(roomStock || []);
      }

      const amenityCatIds = amenityStds.map(s => s.category_id).filter(Boolean);
      setAmenityAvailableItems((allItems || []).filter(item => amenityCatIds.includes(item.category_id)));

      const { data: muItems } = await supabase.from('room_makeup_items')
        .select('*, items(id, code, name, brand, units:unit_id(abbreviation))').eq('makeup_id', mu.id);
      const actions = {};
      const rRows = {};
      (muItems || []).forEach(mi => {
        if (mi.type === 'replace') {
          const item = allItems.find(i => i.id === mi.item_id);
          const catId = item?.category_id || 'unknown';
          if (!rRows[catId]) rRows[catId] = [];
          rRows[catId].push({ id: mi.id || Date.now() + Math.random(), itemId: mi.item_id, qty: mi.actual_qty });
        } else {
          if (!actions[mi.item_id]) actions[mi.item_id] = { dirtyQty: 0, damageQty: 0, lostQty: 0, toHkQty: 0 };
          if (mi.type === 'move_to_dirty') actions[mi.item_id].dirtyQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'damage') actions[mi.item_id].damageQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'lost') actions[mi.item_id].lostQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'to_hk_store') actions[mi.item_id].toHkQty = parseFloat(mi.actual_qty) || 0;
        }
      });
      setLinenActions(actions);
      setReplaceRows(rRows);

      const { data: consumption } = await supabase.from('room_consumption')
        .select('*, room_consumption_items(*)').eq('makeup_id', mu.id);
      const aqty = {};
      if (consumption && consumption.length > 0) {
        (consumption[0].room_consumption_items || []).forEach(ci => {
          const catId = ci.category_id || (allItems.find(i => i.id === ci.item_id)?.category_id);
          if (catId) aqty[catId] = { itemId: ci.item_id, qty: ci.quantity };
        });
      }
      setAmenityQty(aqty);

      const { data: actHistory } = await supabase.from('rmu_activity_history')
        .select('*, rmu_activity_history_items(*)').eq('makeup_id', mu.id);
      const { data: activities } = await supabase.from('room_activity_checklist')
        .select('*').eq('room_id', mu.room_id).eq('is_active', true).order('sort_order');
      setActivityList(activities || []);

      const checks = {};
      if (actHistory && actHistory.length > 0) {
        (actHistory[0].rmu_activity_history_items || []).forEach(hi => {
          const matchAct = (activities || []).find(a => a.name === hi.activity_name);
          if (matchAct) checks[matchAct.id] = { isDone: hi.is_done, notes: hi.notes || '' };
        });
      }
      (activities || []).forEach(a => { if (!checks[a.id]) checks[a.id] = { isDone: false, notes: '' }; });
      setActivityChecks(checks);

      // Mobile: collapse all except first
      if (isMobile) {
        const collapsed = {};
        linenStds.forEach((s, idx) => { if (idx > 0) collapsed['linen_' + s.item_categories?.id] = true; });
        setCollapsedSections(collapsed);
      }
    } catch (err) {
      showNotification('Error loading makeup details: ' + err.message, 'error');
    }
  }

  // ==================== OPEN EDIT (Draft) ====================
  async function openEdit(mu) {
    setViewing(mu);
    setIsEditing(true);
    setSelectedRoom(mu.room_id);
    setMakeupDate(mu.makeup_date);
    setNotes(mu.notes || '');
    setActiveTab('linen');
    setShowModal(true);

    const room = rooms.find(r => r.id === mu.room_id);
    try {
      const { data: standards } = await supabase.from('room_category_standards')
        .select('*, item_categories(id, code, name)')
        .eq('room_id', mu.room_id).order('sort_order');
      const linenStds = (standards || []).filter(s => s.standard_type === 'linen');
      const amenityStds = (standards || []).filter(s => s.standard_type === 'guest_amenities');
      setLinenCategories(linenStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));
      setAmenityCategories(amenityStds.map(s => ({ ...s.item_categories, maxQty: s.quantity || 1 })).filter(c => c.id));

      if (room?.warehouse_id) {
        const { data: roomStock } = await supabase.from('stock_balance')
          .select('id, item_id, quantity, avg_cost, items(id, code, name, brand, category_id, units:unit_id(abbreviation))')
          .eq('organization_id', selectedOrg.id).eq('warehouse_id', room.warehouse_id).gt('quantity', 0);
        setLinenRoomStock(roomStock || []);
      }

      const amenityCatIds = amenityStds.map(s => s.category_id).filter(Boolean);
      setAmenityAvailableItems((allItems || []).filter(item => amenityCatIds.includes(item.category_id)));

      const { data: muItems } = await supabase.from('room_makeup_items')
        .select('*, items(id, code, name, brand, units:unit_id(abbreviation))').eq('makeup_id', mu.id);
      const actions = {};
      const rRows = {};
      (muItems || []).forEach(mi => {
        if (mi.type === 'replace') {
          const item = allItems.find(i => i.id === mi.item_id);
          const catId = item?.category_id || 'unknown';
          if (!rRows[catId]) rRows[catId] = [];
          rRows[catId].push({ id: Date.now() + Math.random(), itemId: mi.item_id, qty: mi.actual_qty });
        } else {
          if (!actions[mi.item_id]) actions[mi.item_id] = { dirtyQty: 0, damageQty: 0, lostQty: 0, toHkQty: 0 };
          if (mi.type === 'move_to_dirty') actions[mi.item_id].dirtyQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'damage') actions[mi.item_id].damageQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'lost') actions[mi.item_id].lostQty = parseFloat(mi.actual_qty) || 0;
          else if (mi.type === 'to_hk_store') actions[mi.item_id].toHkQty = parseFloat(mi.actual_qty) || 0;
        }
      });
      setLinenActions(actions);
      setReplaceRows(rRows);

      const { data: consumption } = await supabase.from('room_consumption')
        .select('*, room_consumption_items(*)').eq('makeup_id', mu.id);
      const aqty = {};
      if (consumption && consumption.length > 0) {
        (consumption[0].room_consumption_items || []).forEach(ci => {
          const catId = ci.category_id || (allItems.find(i => i.id === ci.item_id)?.category_id);
          if (catId) aqty[catId] = { itemId: ci.item_id, qty: ci.quantity };
        });
      }
      setAmenityQty(aqty);

      const { data: actHistory } = await supabase.from('rmu_activity_history')
        .select('*, rmu_activity_history_items(*)').eq('makeup_id', mu.id);
      const { data: activities } = await supabase.from('room_activity_checklist')
        .select('*').eq('room_id', mu.room_id).eq('is_active', true).order('sort_order');
      setActivityList(activities || []);

      const checks = {};
      if (actHistory && actHistory.length > 0) {
        (actHistory[0].rmu_activity_history_items || []).forEach(hi => {
          const matchAct = (activities || []).find(a => a.name === hi.activity_name);
          if (matchAct) checks[matchAct.id] = { isDone: hi.is_done, notes: hi.notes || '' };
        });
      }
      (activities || []).forEach(a => { if (!checks[a.id]) checks[a.id] = { isDone: false, notes: '' }; });
      setActivityChecks(checks);

      // Mobile: collapse all except first
      if (isMobile) {
        const collapsed = {};
        linenStds.forEach((s, idx) => { if (idx > 0) collapsed['linen_' + s.item_categories?.id] = true; });
        setCollapsedSections(collapsed);
      }
    } catch (err) {
      showNotification('Error loading makeup for edit: ' + err.message, 'error');
    }
  }

  // ==================== SAVE DRAFT ====================
  async function handleSaveDraft() {
    if (!currentUser?.id) { showNotification('Session expired. Silakan login ulang.', 'error'); return; }
    if (!selectedRoom) { showNotification('Please select a room', 'error'); return; }

    // === KONTROL: Cek room makeup tanggal sebelumnya yang belum CONFIRMED ===
    if (!isEditing) {
      const { data: prevUnconfirmed } = await supabase.from('room_makeups')
        .select('id, makeup_number, makeup_date, status')
        .eq('organization_id', selectedOrg.id)
        .eq('room_id', selectedRoom)
        .lt('makeup_date', makeupDate)
        .in('status', ['DRAFT', 'PROCESSING'])
        .order('makeup_date', { ascending: false })
        .limit(1);
      if (prevUnconfirmed && prevUnconfirmed.length > 0) {
        const roomNum = rooms.find(r => r.id === selectedRoom)?.room_number || '';
        const prev = prevUnconfirmed[0];
        showNotification(`Room ${roomNum} masih memiliki dokumen ${prev.makeup_number} (tanggal ${prev.makeup_date}) yang belum dikonfirmasi. Silakan konfirmasi terlebih dahulu agar urutan stock movement tidak berantakan.`, 'error');
        return;
      }
    }


    const hasLinenActions = Object.values(linenActions).some(a => (a.dirtyQty > 0 || a.damageQty > 0 || a.lostQty > 0 || a.toHkQty > 0));
    const hasReplaceRows = Object.values(replaceRows).some(rows => rows.some(r => r.itemId && r.qty > 0));
    const hasAmenities = Object.values(amenityQty).some(a => a.itemId && a.qty > 0);
    const hasActivities = activityList.length > 0;

    if (!hasLinenActions && !hasReplaceRows && !hasAmenities && !hasActivities) {
      showNotification('No actions to save', 'error');
      return;
    }

    // Replacement qty is now free — no longer required to equal dirty+damage+lost per category

    const lockCheck = await checkPeriodLock(selectedOrg.id, makeupDate);
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
      return;
    }

    setSaving(true);
    try {
      const room = rooms.find(r => r.id === selectedRoom);
      const hkStore = warehouses.find(w => w.warehouse_type === 'store' && w.code === 'HK') || warehouses.find(w => w.warehouse_type === 'store' && w.name?.toLowerCase().includes('housekeeping'));

      let muId;
      let makeupNumber;

      if (isEditing && viewing) {
        muId = viewing.id;
        makeupNumber = viewing.makeup_number;
        const { error: upErr } = await supabase.from('room_makeups').update({ notes, makeup_date: makeupDate, created_by: currentUser?.id || null, department_id: userDept?.id || null }).eq('id', muId);
        if (upErr) throw upErr;
        await supabase.from('room_makeup_items').delete().eq('makeup_id', muId);
        const { data: oldCon } = await supabase.from('room_consumption').select('id').eq('makeup_id', muId);
        if (oldCon && oldCon.length > 0) {
          for (const con of oldCon) { await supabase.from('room_consumption_items').delete().eq('consumption_id', con.id); }
          await supabase.from('room_consumption').delete().eq('makeup_id', muId);
        }
        const { data: oldAh } = await supabase.from('rmu_activity_history').select('id').eq('makeup_id', muId);
        if (oldAh && oldAh.length > 0) {
          for (const ah of oldAh) { await supabase.from('rmu_activity_history_items').delete().eq('history_id', ah.id); }
          await supabase.from('rmu_activity_history').delete().eq('makeup_id', muId);
        }
      } else {
        makeupNumber = await generateNumber('room_makeups', 'makeup_number', 'MU');
        const { data: mu, error: muErr } = await supabase.from('room_makeups').insert({
          organization_id: selectedOrg.id, room_id: selectedRoom, makeup_number: makeupNumber,
          makeup_date: makeupDate, status: 'DRAFT', notes,
          created_by: currentUser?.id || null, department_id: userDept?.id || null,
        }).select().single();
        if (muErr) throw muErr;
        muId = mu.id;
      }

      // SAVE LINEN ITEMS
      const linenMuItems = [];
      for (const [catId, rows] of Object.entries(replaceRows)) {
        for (const row of rows) {
          if (!row.itemId || row.qty <= 0) continue;
          const stockItem = linenRoomStock.find(s => s.item_id === row.itemId);
          linenMuItems.push({ makeup_id: muId, item_id: row.itemId, type: 'replace', default_qty: stockItem?.quantity || 0, actual_qty: parseFloat(row.qty), dirty_qty: 0, warehouse_id: hkStore?.id, notes: 'Replace - HK Store to Room' });
        }
      }
      for (const [itemId, actionData] of Object.entries(linenActions)) {
        if (!actionData) continue;
        const stockItem = linenRoomStock.find(s => s.item_id === itemId);
        const defaultQty = stockItem?.quantity || 0;
        if (actionData.dirtyQty > 0) {
          linenMuItems.push({
            makeup_id: muId, item_id: itemId, type: 'move_to_dirty',
            default_qty: defaultQty, actual_qty: parseFloat(actionData.dirtyQty),
            dirty_qty: parseFloat(actionData.dirtyQty),
            warehouse_id: room?.warehouse_id, notes: 'MOVE_TO_DIRTY',
          });
        }
        if (actionData.damageQty > 0) {
          linenMuItems.push({
            makeup_id: muId, item_id: itemId, type: 'damage',
            default_qty: defaultQty, actual_qty: parseFloat(actionData.damageQty),
            dirty_qty: 0,
            warehouse_id: room?.warehouse_id, notes: 'DAMAGE',
          });
        }
        if (actionData.lostQty > 0) {
          linenMuItems.push({
            makeup_id: muId, item_id: itemId, type: 'lost',
            default_qty: defaultQty, actual_qty: parseFloat(actionData.lostQty),
            dirty_qty: 0,
            warehouse_id: room?.warehouse_id, notes: 'LOST',
          });
        }
        if (actionData.toHkQty > 0) {
          linenMuItems.push({
            makeup_id: muId, item_id: itemId, type: 'to_hk_store',
            default_qty: defaultQty, actual_qty: parseFloat(actionData.toHkQty),
            dirty_qty: 0,
            warehouse_id: room?.warehouse_id, notes: 'TO_HK_STORE',
          });
        }
      }
      if (linenMuItems.length > 0) {
        const { error: miErr } = await supabase.from('room_makeup_items').insert(linenMuItems);
        if (miErr) throw miErr;
      }

      // SAVE GUEST AMENITIES
      const amenityEntries = Object.entries(amenityQty).filter(([_, a]) => a.itemId && a.qty > 0);
      if (amenityEntries.length > 0 && hkStore) {
        const consumptionNumber = await generateNumber('room_consumption', 'consumption_number', 'RC');
        const { data: conDoc, error: conErr } = await supabase.from('room_consumption').insert({
          organization_id: selectedOrg.id, room_id: selectedRoom, makeup_id: muId,
          consumption_number: consumptionNumber, consumption_date: makeupDate,
          warehouse_id: hkStore.id, notes: '', created_by: currentUser?.id,
        }).select().single();
        if (conErr) throw conErr;
        for (const [catId, entry] of amenityEntries) {
          const itemId = entry.itemId;
          const numQty = parseFloat(entry.qty);
          const item = allItems.find(i => i.id === itemId);
          const itemWarehouseId = item?.default_warehouse_id || hkStore.id;
          const { data: sb } = await supabase.from('stock_balance')
            .select('avg_cost').eq('item_id', itemId).eq('warehouse_id', itemWarehouseId)
            .eq('organization_id', selectedOrg.id).maybeSingle();
          const unitCost = sb ? parseFloat(sb.avg_cost) || 0 : 0;
          await supabase.from('room_consumption_items').insert({
            consumption_id: conDoc.id, item_id: itemId, category_id: item?.category_id,
            quantity: numQty, unit_cost: unitCost, total_cost: unitCost * numQty, notes: '',
          });
        }
      }

      // SAVE ACTIVITY CHECKLIST
      if (activityList.length > 0) {
        const historyNumber = await generateNumber('rmu_activity_history', 'history_number', 'AH');
        const { data: ahDoc, error: ahErr } = await supabase.from('rmu_activity_history').insert({
          organization_id: selectedOrg.id, room_id: selectedRoom, makeup_id: muId,
          history_number: historyNumber, history_date: makeupDate, created_by: currentUser?.id,
        }).select().single();
        if (ahErr) throw ahErr;
        const ahItems = activityList.map((act, i) => {
          const check = activityChecks[act.id] || { isDone: false, notes: '' };
          return { history_id: ahDoc.id, activity_name: act.name, is_done: check.isDone, notes: check.notes || '', sort_order: act.sort_order || i };
        });
        const { error: ahiErr } = await supabase.from('rmu_activity_history_items').insert(ahItems);
        if (ahiErr) throw ahiErr;
      }

      showNotification(isEditing ? 'Draft updated successfully!' : 'Room makeup saved as draft!');
      setShowModal(false);
      setIsEditing(false);
      loadAll();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
    setSaving(false);
  }

  // ==================== DELETE DRAFT MAKEUP ====================
  async function handleDeleteMakeup(mu) {
    if (saving) return;
    if (mu.status !== 'DRAFT') { showNotification('Hanya dokumen DRAFT yang bisa dihapus.', 'error'); return; }
    if (!(await showConfirm(`Hapus draft ${mu.makeup_number}?\n\nSemua data terkait (linen items, consumption, activity history) akan ikut terhapus.\n\nLanjutkan?`, { variant: 'danger' }))) return;
    setSaving(true);
    try {
      // Delete room_makeup_items
      await supabase.from('room_makeup_items').delete().eq('makeup_id', mu.id);

      // Delete room_consumption_items & room_consumption
      const { data: consumptions } = await supabase.from('room_consumption').select('id').eq('makeup_id', mu.id);
      if (consumptions && consumptions.length > 0) {
        for (const con of consumptions) {
          await supabase.from('room_consumption_items').delete().eq('consumption_id', con.id);
        }
        await supabase.from('room_consumption').delete().eq('makeup_id', mu.id);
      }

      // Delete rmu_activity_history_items & rmu_activity_history
      const { data: histories } = await supabase.from('rmu_activity_history').select('id').eq('makeup_id', mu.id);
      if (histories && histories.length > 0) {
        for (const hist of histories) {
          await supabase.from('rmu_activity_history_items').delete().eq('history_id', hist.id);
        }
        await supabase.from('rmu_activity_history').delete().eq('makeup_id', mu.id);
      }

      // Delete parent record
      const { error } = await supabase.from('room_makeups').delete().eq('id', mu.id);
      if (error) throw error;

      showNotification(`${mu.makeup_number} berhasil dihapus.`, 'success');
      loadAll();
    } catch (err) {
      showNotification('Gagal menghapus: ' + err.message, 'error');
    }
    setSaving(false);
  }

  // ==================== CONFIRM MAKEUP ====================
  async function handleConfirmMakeup(mu) {
    if (saving) { showNotification('Proses confirm sedang berjalan, harap tunggu...', 'error'); return; }
    if (mu.status === 'CONFIRMED') { showNotification('Room Makeup ini sudah dikonfirmasi.', 'error'); return; }
    if (mu.status === 'PROCESSING') { showNotification('Room Makeup sedang diproses, harap tunggu hingga selesai.', 'error'); return; }

    if (!(await showConfirm('PERHATIAN!\n\nProses confirm akan memproses stock movements.\nJANGAN REFRESH atau TUTUP HALAMAN sampai selesai.\n\nLanjutkan confirm?', { variant: 'warning' }))) return;

    const lockCheck = await checkPeriodLock(selectedOrg.id, mu.makeup_date);
    if (lockCheck.locked) { showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error'); return; }

    setSaving(true);
    try {
      const { data: freshMu } = await supabase.from('room_makeups').select('status').eq('id', mu.id).single();
      if (freshMu?.status === 'CONFIRMED') { showNotification('Sudah dikonfirmasi.', 'error'); setSaving(false); loadAll(); return; }
      if (freshMu?.status === 'PROCESSING') { showNotification('Sedang diproses oleh sesi lain.', 'error'); setSaving(false); loadAll(); return; }

      // Strict optimistic lock: transition DRAFT -> PROCESSING ATOMICALLY.
      // `.select()` forces PostgREST to return the affected rows; if length === 0
      // it means a concurrent request already grabbed the lock (or status changed),
      // so we MUST abort and NOT run stock movements. Prior implementation had only
      // `.eq('status','DRAFT')` tanpa `.select()` → tidak bisa membedakan "0 rows affected"
      // dari "success", menyebabkan double-confirm & duplicate stock movements
      // (root cause insiden MU-DAS-0400 duplicates di 2026-04-06).
      const { data: lockRows, error: procErr } = await supabase
        .from('room_makeups')
        .update({ status: 'PROCESSING' })
        .eq('id', mu.id)
        .eq('status', 'DRAFT')
        .select('id');
      if (procErr) throw procErr;
      if (!lockRows || lockRows.length === 0) {
        showNotification('Gagal mengunci dokumen — sedang diproses oleh sesi lain atau status sudah berubah. Refresh halaman.', 'error');
        setSaving(false);
        loadAll();
        return;
      }

      // Idempotency watermark: record attempt start so the catch block can
      // delete only the stock_movements inserted by THIS attempt. Penting —
      // tanpa ini, partial-fail (mis. stock dirty tidak cukup di tengah loop)
      // akan meninggalkan movements yg sudah ter-insert, dan retry berikutnya
      // akan menambah duplikat (root cause 221 extra rows insiden 2026-04-04).
      const attemptStartedAt = new Date().toISOString();

      const room = rooms.find(r => r.id === mu.room_id);
      const hkStore = warehouses.find(w => w.warehouse_type === 'store' && w.code === 'HK') || warehouses.find(w => w.warehouse_type === 'store' && w.name?.toLowerCase().includes('housekeeping'));
      const dirtyWh = warehouses.find(w => w.warehouse_type === 'dirty');
      const damageWh = warehouses.find(w => w.warehouse_type === 'damage');
      const dept = currentUser?.department_id || null;
      const makeupNumber = mu.makeup_number;

      let roomStock = [];
      if (room?.warehouse_id) {
        const { data: rs } = await supabase.from('stock_balance')
          .select('id, item_id, quantity, avg_cost, items(id, code, name, brand, category_id)')
          .eq('organization_id', selectedOrg.id).eq('warehouse_id', room.warehouse_id);
        roomStock = rs || [];
      }

      // Helper: get avg_cost from a specific warehouse for an item
      const getWhAvgCost = (itemId, whId) => {
        if (!whId) return 0;
        const sb = roomStock.find(s => s.item_id === itemId);
        return sb ? parseFloat(sb.avg_cost) || 0 : 0;
      };

      // Pre-fetch HK store stock for replace items cost lookup
      let hkStoreStock = [];
      if (hkStore?.id) {
        const { data: hkSb } = await supabase.from('stock_balance')
          .select('item_id, avg_cost').eq('organization_id', selectedOrg.id).eq('warehouse_id', hkStore.id);
        hkStoreStock = hkSb || [];
      }
      const getHkAvgCost = (itemId) => {
        const sb = hkStoreStock.find(s => s.item_id === itemId);
        return sb ? parseFloat(sb.avg_cost) || 0 : 0;
      };

      const { data: muItems } = await supabase.from('room_makeup_items').select('*').eq('makeup_id', mu.id);

      // ====== PRE-VALIDATION: cek semua stok SEBELUM create movement apapun ======
      // Kumpulkan semua OUT yang dibutuhkan, lalu cek saldo per warehouse+item.
      // Jika ada yang kurang, tampilkan SEMUA item yang gagal dan ABORT.
      const outRequirements = {}; // key: `${warehouseId}|${itemId}` → { warehouseId, itemId, totalQty, itemLabel, whLabel }

      const addOutReq = (itemId, warehouseId, qty) => {
        if (!warehouseId || qty <= 0) return;
        const key = `${warehouseId}|${itemId}`;
        if (!outRequirements[key]) {
          const item = allItems.find(i => i.id === itemId);
          const wh = warehouses.find(w => w.id === warehouseId);
          outRequirements[key] = {
            warehouseId, itemId, totalQty: 0,
            itemLabel: item ? `${item.code} - ${item.name}` : itemId,
            whLabel: wh ? `${wh.code} - ${wh.name}` : warehouseId,
          };
        }
        outRequirements[key].totalQty += qty;
      };

      // Collect OUT requirements from linen items
      for (const mi of (muItems || [])) {
        const numQty = parseFloat(mi.actual_qty);
        if (numQty <= 0) continue;
        if (mi.type === 'replace') {
          const linenItem = allItems.find(i => i.id === mi.item_id);
          const linenOutWh = linenItem?.default_warehouse_id || hkStore?.id;
          addOutReq(mi.item_id, linenOutWh, numQty);
        } else if (mi.type === 'move_to_dirty') {
          addOutReq(mi.item_id, room?.warehouse_id, numQty);
        } else if (mi.type === 'damage') {
          addOutReq(mi.item_id, room?.warehouse_id, numQty);
        } else if (mi.type === 'lost') {
          addOutReq(mi.item_id, room?.warehouse_id, numQty);
        } else if (mi.type === 'to_hk_store') {
          addOutReq(mi.item_id, room?.warehouse_id, numQty);
        }
      }

      // Collect OUT requirements from consumption items
      const { data: consumption } = await supabase.from('room_consumption')
        .select('*, room_consumption_items(*)').eq('makeup_id', mu.id);
      if (consumption && consumption.length > 0) {
        const con = consumption[0];
        for (const ci of (con.room_consumption_items || [])) {
          const item = allItems.find(i => i.id === ci.item_id);
          const itemWarehouseId = item?.default_warehouse_id || hkStore?.id;
          addOutReq(ci.item_id, itemWarehouseId, parseFloat(ci.quantity));
        }
      }

      // Fetch actual stock balances for all required warehouse+item combos
      const insufficientItems = [];
      for (const req of Object.values(outRequirements)) {
        const { data: sb } = await supabase.from('stock_balance')
          .select('quantity')
          .eq('organization_id', selectedOrg.id)
          .eq('item_id', req.itemId)
          .eq('warehouse_id', req.warehouseId)
          .maybeSingle();
        const currentQty = sb ? parseFloat(sb.quantity) || 0 : 0;
        if (currentQty < req.totalQty) {
          insufficientItems.push(`${req.itemLabel} di [${req.whLabel}]: saldo=${currentQty}, diminta=${req.totalQty}`);
        }
      }

      if (insufficientItems.length > 0) {
        // ABORT — jangan buat movement apapun
        try { await supabase.from('room_makeups').update({ status: 'DRAFT' }).eq('id', mu.id).eq('status', 'PROCESSING'); } catch (e) {}
        showNotification('Stok tidak cukup:\n' + insufficientItems.join('\n'), 'error');
        setSaving(false);
        loadAll();
        return;
      }

      // ====== SEMUA STOK CUKUP — Proses movements ======
      for (const mi of (muItems || [])) {
        const numQty = parseFloat(mi.actual_qty);
        if (numQty <= 0) continue;
        if (mi.type === 'replace') {
          const linenItem = allItems.find(i => i.id === mi.item_id);
          const linenOutWh = linenItem?.default_warehouse_id || hkStore?.id;
          const srcCost = linenOutWh === hkStore?.id ? getHkAvgCost(mi.item_id) : 0;
          if (linenOutWh) await doStockMovement(mi.item_id, 'OUT', numQty, linenOutWh, 'MAKEUP-LINEN REPLACE', makeupNumber, 'OUT from Store', dept, mu.id);
          if (room?.warehouse_id) await doStockMovement(mi.item_id, 'IN', numQty, room.warehouse_id, 'MAKEUP-LINEN REPLACE', makeupNumber, 'IN to Room ' + (room.room_number || ''), dept, mu.id, srcCost);
        } else if (mi.type === 'move_to_dirty') {
          const srcCost = getWhAvgCost(mi.item_id, room?.warehouse_id);
          if (room?.warehouse_id) await doStockMovement(mi.item_id, 'OUT', numQty, room.warehouse_id, 'MAKEUP-DIRTY', makeupNumber, 'OUT from Room', dept, mu.id);
          if (dirtyWh) await doStockMovement(mi.item_id, 'IN', numQty, dirtyWh.id, 'MAKEUP-DIRTY', makeupNumber, 'IN to Dirty', dept, mu.id, srcCost);
        } else if (mi.type === 'damage') {
          const srcCost = getWhAvgCost(mi.item_id, room?.warehouse_id);
          if (room?.warehouse_id) await doStockMovement(mi.item_id, 'OUT', numQty, room.warehouse_id, 'DAMAGE', makeupNumber, 'Damage OUT', dept, mu.id);
          if (damageWh) await doStockMovement(mi.item_id, 'IN', numQty, damageWh.id, 'DAMAGE', makeupNumber, 'Damage IN', dept, mu.id, srcCost);
        } else if (mi.type === 'lost') {
          if (room?.warehouse_id) await doStockMovement(mi.item_id, 'OUT', numQty, room.warehouse_id, 'ITEM_LOST', makeupNumber, 'Lost OUT', dept, mu.id);
          const stockItem = roomStock.find(s => s.item_id === mi.item_id);
          const unitCost = stockItem ? parseFloat(stockItem.avg_cost) || 0 : 0;
          const lostNumber = await generateNumber('item_lost_in_room', 'lost_number', 'IL');
          const { data: lostDoc, error: lostErr } = await supabase.from('item_lost_in_room').insert({
            organization_id: selectedOrg.id, room_id: mu.room_id, makeup_id: mu.id,
            lost_number: lostNumber, lost_date: mu.makeup_date, notes: 'Item lost during room makeup',
            created_by: currentUser?.id, created_at: new Date().toISOString(),
          }).select().single();
          if (lostErr) throw lostErr;
          await supabase.from('item_lost_in_room_details').insert({
            lost_id: lostDoc.id, item_id: mi.item_id, quantity: numQty,
            unit_cost: unitCost, total_cost: unitCost * numQty, notes: '',
          });
          showNotification('Laporkan ke Front Office: ' + (stockItem?.items?.name || 'Item') + ' hilang ' + numQty + ' pcs!', 'error');
        } else if (mi.type === 'to_hk_store') {
          const srcCost = getWhAvgCost(mi.item_id, room?.warehouse_id);
          if (room?.warehouse_id) await doStockMovement(mi.item_id, 'OUT', numQty, room.warehouse_id, 'MAKEUP-TO-HK', makeupNumber, 'OUT from Room to HK Store', dept, mu.id);
          if (hkStore) await doStockMovement(mi.item_id, 'IN', numQty, hkStore.id, 'MAKEUP-TO-HK', makeupNumber, 'IN to HK Store from Room', dept, mu.id, srcCost);
        }
      }

      // Process consumption movements (already pre-validated above)
      if (consumption && consumption.length > 0) {
        const con = consumption[0];
        for (const ci of (con.room_consumption_items || [])) {
          const item = allItems.find(i => i.id === ci.item_id);
          const itemWarehouseId = item?.default_warehouse_id || hkStore?.id;
          if (itemWarehouseId) await doStockMovement(ci.item_id, 'OUT', parseFloat(ci.quantity), itemWarehouseId, 'CONSUMPTION', con.consumption_number, 'Guest amenity consumed', dept, con.id);
        }
      }

      const { error: statusErr } = await supabase.from('room_makeups').update({ status: 'CONFIRMED' }).eq('id', mu.id);
      if (statusErr) throw statusErr;
      showNotification('Room makeup confirmed! Stock movements processed.');
      loadAll();
    } catch (err) {
      // Rollback stock_movements yang sudah ter-insert di attempt ini.
      // DELETE akan men-trigger trg_revert_stock_movement → stock_balance
      // ter-revert otomatis di dalam transaksi DB yang sama per-row.
      // Cakupan: semua movements dengan reference_number = makeupNumber dan
      // created_at >= attemptStartedAt (watermark awal attempt).
      // CATATAN: referenceType cover MAKEUP-LINEN REPLACE, MAKEUP-DIRTY,
      // DAMAGE, ITEM_LOST, MAKEUP-TO-HK, dan CONSUMPTION (untuk amenities).
      try {
        // Rollback linen/damage/lost/toHk movements (reference_number = makeup_number)
        const { data: orphaned1 } = await supabase.from('stock_movements')
          .select('id')
          .eq('reference_number', mu.makeup_number)
          .gte('created_at', attemptStartedAt);
        // Rollback consumption movements (reference_number = consumption_number)
        const { data: conDocs } = await supabase.from('room_consumption')
          .select('consumption_number').eq('makeup_id', mu.id);
        let orphaned2 = [];
        if (conDocs && conDocs.length > 0) {
          for (const cd of conDocs) {
            const { data: o2 } = await supabase.from('stock_movements')
              .select('id')
              .eq('reference_number', cd.consumption_number)
              .gte('created_at', attemptStartedAt);
            if (o2) orphaned2 = orphaned2.concat(o2);
          }
        }
        const allOrphaned = [...(orphaned1 || []), ...orphaned2];
        if (allOrphaned.length > 0) {
          const ids = allOrphaned.map(o => o.id);
          await supabase.from('stock_movements').delete().in('id', ids);
        }
      } catch (cleanupErr) {
        console.error('[confirm rollback] cleanup movements failed:', cleanupErr);
      }
      try { await supabase.from('room_makeups').update({ status: 'DRAFT' }).eq('id', mu.id).eq('status', 'PROCESSING'); } catch (e) {}
      showNotification('Error: ' + err.message + '. Status dikembalikan ke DRAFT (stock movements attempt ini sudah di-rollback).', 'error');
      loadAll();
    }
    setSaving(false);
  }

  // ==================== STOCK MOVEMENT HELPER ====================
  async function doStockMovement(itemId, movementType, qty, warehouseId, refType, refNumber, notesText, dept, refId, overrideUnitCost) {
    // Unit cost resolution rules:
    //   1. IN with overrideUnitCost (srcCost dari source warehouse) → pakai itu.
    //      Ini preservasi weighted-average saat memindahkan stok antar warehouse.
    //   2. OUT → fetch avg_cost dari warehouse itu sendiri (COGS basis).
    //   3. IN tanpa override → fetch avg_cost DESTINATION yang sedang berjalan.
    //      Cara ini membuat trigger WAC tidak mengubah avg (new_avg = old_avg).
    //      Sebelumnya kode mengirim unitCost=0 yang BUG karena trigger pakai
    //      `COALESCE(NEW.unit_cost, v_old_avg)`; karena record_movement RPC
    //      melakukan `COALESCE(p_unit_cost, 0)`, trigger TIDAK PERNAH menerima
    //      NULL → fallback ke v_old_avg mati → 0 dipakai langsung → dilusi avg
    //      destination ke 0. Ini menyumbang corruption unit_cost di masa lalu.
    //   Trigger DB auto-reject jika stock tidak cukup untuk OUT.
    let unitCost = null;
    if (overrideUnitCost !== undefined && overrideUnitCost !== null) {
      unitCost = overrideUnitCost;
    } else {
      // Fetch current avg_cost dari warehouse target (destination untuk IN, self untuk OUT)
      const { data: sb } = await supabase.from('stock_balance')
        .select('avg_cost')
        .eq('organization_id', selectedOrg.id).eq('item_id', itemId).eq('warehouse_id', warehouseId).maybeSingle();
      unitCost = sb ? parseFloat(sb.avg_cost) || 0 : 0;
    }
    const { error } = await recordMovement({
      organizationId: selectedOrg.id,
      itemId,
      warehouseId,
      movementType,
      quantity: qty,
      referenceType: refType,
      referenceNumber: refNumber,
      referenceId: refId || null,
      unitCost,
      departmentId: dept || null,
      notes: notesText,
    });
    if (error) {
      // Enrich error message with item code & name and warehouse name instead of UUIDs
      const item = allItems.find(i => i.id === itemId);
      const itemLabel = item ? `${item.code} - ${item.name}` : itemId;
      const wh = warehouses.find(w => w.id === warehouseId);
      const whLabel = wh ? `${wh.code} - ${wh.name}` : warehouseId;
      const enriched = new Error(`Stok tidak cukup untuk ${movementType}: item [${itemLabel}], warehouse [${whLabel}], qty diminta=${qty}`);
      throw enriched;
    }
  }

  function toggleSection(key) { setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] })); }

  // Close room dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (filterRoomRef.current && !filterRoomRef.current.contains(e.target)) setFilterRoomOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Date range helper
  function getDateRangeFilter() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (filterDateRange) {
      case 'today': return today;
      case 'yesterday': return new Date(today.getTime() - 86400000);
      case 'last_week': return new Date(today.getTime() - 7 * 86400000);
      case 'last_month': return new Date(today.getTime() - 30 * 86400000);
      default: return null;
    }
  }

  // Unique housekeepers for filter dropdown
  const uniqueHousekeepers = React.useMemo(() => {
    const map = {};
    makeups.forEach(mu => {
      const name = mu.users?.full_name || mu.users?.username;
      const id = mu.created_by;
      if (id && name && !map[id]) map[id] = name;
    });
    return Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]));
  }, [makeups]);

  // Count how many times each room is made up per date (only CONFIRMED status counts)
  const roomDateCountMap = React.useMemo(() => {
    const map = {};
    makeups.forEach(mu => {
      if (!mu.room_id) return;
      const d = (mu.makeup_date || mu.created_at || '').substring(0, 10);
      const key = mu.room_id + '|' + d;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [makeups]);

  function getRoomDateCount(mu) {
    if (!mu.room_id) return 0;
    const d = (mu.makeup_date || mu.created_at || '').substring(0, 10);
    return roomDateCountMap[mu.room_id + '|' + d] || 0;
  }

  // Nth occurrence of this room on that date (for display: is this the 1st, 2nd, 3rd time?)
  function getRoomDateNth(mu, list) {
    if (!mu.room_id) return 0;
    const d = (mu.makeup_date || mu.created_at || '').substring(0, 10);
    const sameGroup = list.filter(m => m.room_id === mu.room_id && (m.makeup_date || m.created_at || '').substring(0, 10) === d);
    sameGroup.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return sameGroup.findIndex(m => m.id === mu.id) + 1;
  }

  function getCountChipStyle(count) {
    const styles = {
      1: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
      2: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
      3: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
      4: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
      5: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
      6: { bg: '#ccfbf1', text: '#115e59', border: '#5eead4' },
    };
    return styles[count] || { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' };
  }

  // Unique count values for filter dropdown
  const uniqueCounts = React.useMemo(() => {
    const countSet = new Set();
    makeups.forEach(mu => {
      const c = getRoomDateCount(mu);
      if (c > 0) countSet.add(c);
    });
    return Array.from(countSet).sort((a, b) => a - b);
  }, [makeups, roomDateCountMap]);

  const filtered = makeups.filter(mu => {
    if (filterStatus && mu.status !== filterStatus) return false;
    if (filterHousekeeper && mu.created_by !== filterHousekeeper) return false;
    if (filterRoom && mu.room_id !== filterRoom) return false;
    if (filterCount) {
      const cnt = getRoomDateCount(mu);
      if (cnt !== parseInt(filterCount)) return false;
    }
    if (filterDateRange) {
      const startDate = getDateRangeFilter();
      if (startDate) {
        const muDate = new Date(mu.makeup_date || mu.created_at);
        if (muDate < startDate) return false;
      }
    }
    if (search) { const s = search.toLowerCase(); return mu.makeup_number?.toLowerCase().includes(s) || mu.rooms?.room_number?.toLowerCase().includes(s); }
    return true;
  });

  const isView = !!viewing && !isEditing;
  const isEditMode = !!viewing && isEditing;
  const room = rooms.find(r => r.id === selectedRoom);

  function getLinenItemsForCategory(catId) { return linenRoomStock.filter(s => s.items && s.items.category_id === catId); }
  function getAmenityItemsForCategory(catId) { return amenityAvailableItems.filter(i => i.category_id === catId); }

  const replaceRowCount = useMemo(() => Object.values(replaceRows).reduce((sum, rows) => sum + rows.filter(r => r.itemId && r.qty > 0).length, 0), [replaceRows]);
  const linenActionCount = useMemo(() => Object.values(linenActions).filter(a => (a.dirtyQty > 0 || a.damageQty > 0 || a.lostQty > 0 || a.toHkQty > 0)).length + replaceRowCount, [linenActions, replaceRowCount]);
  const amenityCount = useMemo(() => Object.values(amenityQty).filter(a => a.itemId && a.qty > 0).length, [amenityQty]);
  const activityDoneCount = useMemo(() => Object.values(activityChecks).filter(c => c.isDone).length, [activityChecks]);

  // ==================== STEPPER COMPONENT ====================
  function QtyStepper({ value, min, max, onChange, color = 'gray' }) {
    const colors = {
      gray: { btn: 'bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-700', ring: 'border-gray-300' },
      blue: { btn: 'bg-blue-100 hover:bg-blue-200 active:bg-blue-300 text-blue-700', ring: 'border-blue-300' },
      green: { btn: 'bg-green-100 hover:bg-green-200 active:bg-green-300 text-green-700', ring: 'border-green-300' },
    };
    const c = colors[color] || colors.gray;
    return (
      <div className="inline-flex items-center border rounded-lg overflow-hidden" style={{borderColor: color === 'blue' ? '#93c5fd' : color === 'green' ? '#86efac' : '#d1d5db'}}>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
          className={`w-11 h-11 flex items-center justify-center text-lg font-bold ${c.btn} transition-colors select-none`}>−</button>
        <span className="w-12 h-11 flex items-center justify-center text-sm font-bold bg-white border-l border-r" style={{borderColor: color === 'blue' ? '#93c5fd' : color === 'green' ? '#86efac' : '#d1d5db'}}>{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
          className={`w-11 h-11 flex items-center justify-center text-lg font-bold ${c.btn} transition-colors select-none`}>+</button>
      </div>
    );
  }

  // ==================== ACTION BUTTON GROUP (Mobile) ====================
  function ActionButtonGroup({ value, onChange }) {
    const actions = [
      { id: 'MOVE_TO_DIRTY', label: 'Dirty', color: 'bg-yellow-100 border-yellow-400 text-yellow-800', activeColor: 'bg-yellow-400 border-yellow-500 text-yellow-900' },
      { id: 'DAMAGE', label: 'Damage', color: 'bg-orange-100 border-orange-400 text-orange-800', activeColor: 'bg-orange-400 border-orange-500 text-orange-900' },
      { id: 'LOST', label: 'Lost', color: 'bg-red-100 border-red-400 text-red-800', activeColor: 'bg-red-400 border-red-500 text-red-900' },
      { id: 'TO_HK_STORE', label: 'To HK', color: 'bg-teal-100 border-teal-400 text-teal-800', activeColor: 'bg-teal-400 border-teal-500 text-teal-900' },
    ];
    return (
      <div className="flex gap-1.5">
        {actions.map(a => (
          <button key={a.id} type="button"
            onClick={() => onChange(value === a.id ? '' : a.id)}
            className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-bold transition-all min-h-[40px] ${value === a.id ? a.activeColor + ' shadow-sm' : a.color + ' opacity-60'}`}>
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div>
      <PageHeader title="Room Make Up" subtitle={`Housekeeping - ${selectedOrg?.name || ''}`}
        actions={<Button onClick={openNew}>+ New Makeup</Button>} />

      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Total Room Make Up</p>
            <p className="text-xl font-bold text-gray-800">{filtered.length}</p>
          </div>
        </div>
      </div>

      {/* LIST VIEW */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <input type="text" placeholder="Search number..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-48 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">{t('common.all')} Status</option>
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PROCESSING">Processing</option>
          </select>
          {/* Housekeeper filter */}
          <select value={filterHousekeeper} onChange={e => setFilterHousekeeper(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All Housekeeper</option>
            {uniqueHousekeepers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          {/* Room filter - searchable dropdown */}
          <div className="relative" ref={filterRoomRef}>
            <div className="px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer bg-white min-w-[140px] flex items-center justify-between"
              onClick={() => setFilterRoomOpen(!filterRoomOpen)}>
              <span className={filterRoom ? 'text-gray-800' : 'text-gray-400'}>
                {filterRoom ? (rooms.find(r => r.id === filterRoom)?.room_number || 'Room') : 'All Room'}
              </span>
              <svg className="w-4 h-4 text-gray-400 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
            {filterRoomOpen && (
              <div className="absolute z-50 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-hidden">
                <div className="p-2 border-b border-gray-100">
                  <input type="text" placeholder="Search room..." value={filterRoomSearch} onChange={e => setFilterRoomSearch(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-primary-500"
                    autoFocus onClick={e => e.stopPropagation()} />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <div className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer font-medium text-gray-500"
                    onClick={() => { setFilterRoom(''); setFilterRoomSearch(''); setFilterRoomOpen(false); }}>
                    All Room
                  </div>
                  {rooms.filter(r => !filterRoomSearch || r.room_number?.toLowerCase().includes(filterRoomSearch.toLowerCase()))
                    .map(r => (
                      <div key={r.id} className={`px-3 py-2 text-sm hover:bg-primary-50 cursor-pointer ${filterRoom === r.id ? 'bg-primary-50 font-semibold text-primary-700' : ''}`}
                        onClick={() => { setFilterRoom(r.id); setFilterRoomSearch(''); setFilterRoomOpen(false); }}>
                        {r.room_number} {r.room_types?.name ? <span className="text-gray-400 text-xs ml-1">({r.room_types.name})</span> : ''}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          {/* Date range filter */}
          <select value={filterDateRange} onChange={e => setFilterDateRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_week">Last Week</option>
            <option value="last_month">Last Month</option>
            <option value="">All Date</option>
          </select>
          {/* Count filter */}
          <select value={filterCount} onChange={e => setFilterCount(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All Count</option>
            {uniqueCounts.map(c => (
              <option key={c} value={c}>{c}X</option>
            ))}
          </select>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block">
          <DataTable loading={loading} columns={[
            { header: 'Number', render: r => <button onClick={() => r.status === 'DRAFT' ? openEdit(r) : openView(r)} className="font-mono text-xs font-semibold text-primary-700 hover:underline cursor-pointer">{r.makeup_number}</button> },
            { header: t('common.date'), render: r => formatDateSys(r.created_at, { includeTime: true }) },
            { header: 'Room', render: r => {
              const cnt = getRoomDateCount(r);
              const cs = getCountChipStyle(cnt);
              return <span className="font-medium flex items-center gap-1.5">{r.rooms?.room_number || '-'}
                {cnt > 0 && <span style={{background: cs.bg, color: cs.text, border: '1px solid ' + cs.border, borderRadius: '9999px', padding: '1px 8px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap'}}>{cnt}X</span>}
              </span>;
            }},
            { header: 'User', render: r => <span className="text-xs">{r.users?.full_name || r.users?.username || '-'}</span> },
            { header: 'Department', render: r => <span className="text-xs">{r.departments?.name || '-'}</span> },
            { header: t('common.status'), render: r => <StatusBadge status={r.status} /> },
            { header: t('common.actions'), render: r => (
              <div className="flex gap-1">
                {r.status === 'DRAFT' ? (
                  <React.Fragment>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)} disabled={saving}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-green-600 hover:text-green-800" onClick={() => handleConfirmMakeup(r)} disabled={saving}>
                      {saving ? <span className="flex items-center gap-1"><span className="spinner-sm"></span>Processing...</span> : 'Confirm'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => handleDeleteMakeup(r)} disabled={saving}>Delete</Button>
                  </React.Fragment>
                ) : r.status === 'PROCESSING' ? (
                  <span className="flex items-center gap-1 text-xs text-orange-600 font-medium"><span className="spinner-sm"></span>Sedang diproses...</span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => openView(r)}>View</Button>
                )}
              </div>
            )},
          ]} data={filtered} />
        </div>

        {/* Mobile card list */}
        <div className="sm:hidden">
          {loading ? <PageLoader /> :
           filtered.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">No data</div> :
           <div className="divide-y divide-gray-100">
            {filtered.map(r => (
              <div key={r.id} className="p-4 hover:bg-gray-50 active:bg-gray-100 cursor-pointer" onClick={() => r.status === 'DRAFT' ? openEdit(r) : openView(r)}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-primary-700 text-sm">{r.makeup_number}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1">Room: <span className="font-medium text-gray-700">{r.rooms?.room_number || '-'}</span>{(() => { const cnt = getRoomDateCount(r); const cs = getCountChipStyle(cnt); return cnt > 0 ? <span style={{background: cs.bg, color: cs.text, border: '1px solid ' + cs.border, borderRadius: '9999px', padding: '0px 6px', fontSize: '10px', fontWeight: 700}}>{cnt}X</span> : null; })()}</span>
                  <span>{formatDateSys(r.created_at, { includeTime: true })}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400 mt-0.5">
                  <span>{r.users?.full_name || r.users?.username || '-'}</span>
                  <span>{r.departments?.name || '-'}</span>
                </div>
                {r.status === 'DRAFT' && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); openEdit(r); }} disabled={saving}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-green-600" onClick={e => { e.stopPropagation(); handleConfirmMakeup(r); }} disabled={saving}>
                      {saving ? 'Processing...' : 'Confirm'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={e => { e.stopPropagation(); handleDeleteMakeup(r); }} disabled={saving}>Delete</Button>
                  </div>
                )}
                {r.status === 'PROCESSING' && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-orange-600 font-medium">
                    <span className="spinner-sm"></span>Sedang diproses...
                  </div>
                )}
              </div>
            ))}
           </div>}
        </div>
      </div>

      {/* ==================== FORM MODAL ==================== */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setIsEditing(false); }} title={isView ? `${viewing?.makeup_number}` : (isEditMode ? `Edit ${viewing?.makeup_number}` : 'New Room Makeup')} size="xl">
        <div className="pb-20 sm:pb-0">
        {/* Room, Date, User & Department */}
        {!isView && (
          <div className="mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Room" required>
                {isEditMode ? (
                  <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                    {rooms.find(r => r.id === selectedRoom)?.room_number || '-'} {rooms.find(r => r.id === selectedRoom)?.room_types?.name ? `(${rooms.find(r => r.id === selectedRoom).room_types.name})` : ''}
                  </div>
                ) : (
                  <Select value={selectedRoom} onChange={e => handleRoomSelect(e.target.value)}>
                    <option value="">Select Room</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.room_number} {r.room_types?.name ? `(${r.room_types.name})` : ''}</option>)}
                  </Select>
                )}
              </FormField>
              <FormField label="Date">
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                  {formatDateSys(makeupDate)}
                </div>
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="User">
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                  {currentUser?.full_name || currentUser?.username || '-'}
                </div>
              </FormField>
              <FormField label="Department">
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 min-h-[42px] flex items-center">
                  {userDept ? `${userDept.code} - ${userDept.name}` : '-'}
                </div>
              </FormField>
            </div>
            <div className="mt-2 p-3 bg-red-50 border border-red-300 rounded-lg">
              <p className="text-red-600 text-xs font-semibold leading-relaxed">Dilarang menggunakan akun pengguna lain saat Make Up Room, dan dilarang memberikan username dan password login kepada pengguna lain, pelanggar akan dikenakan sanksi dari management.</p>
            </div>
          </div>
        )}
        {isView && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 bg-gray-50 rounded-lg p-3 text-sm">
            <div><p className="text-xs text-gray-500">Date</p><p className="font-medium">{formatDateSys(viewing?.makeup_date)}</p></div>
            <div><p className="text-xs text-gray-500">Room</p><p className="font-medium">{viewing?.rooms?.room_number}</p></div>
            <div><p className="text-xs text-gray-500">User</p><p className="font-medium">{currentUser?.full_name || '-'}</p></div>
            <div><p className="text-xs text-gray-500">Status</p><StatusBadge status={viewing?.status} /></div>
          </div>
        )}

        {/* TAB NAVIGATION - sticky, snap scroll */}
        {selectedRoom && (
          <div className="sticky top-0 z-10 bg-white -mx-6 px-6 border-b border-gray-200 mb-4">
            <div className="flex overflow-x-auto no-scrollbar" style={{scrollSnapType: 'x mandatory'}}>
              {[
                { id: 'linen', label: 'Linen', color: 'blue', count: linenActionCount },
                { id: 'amenities', label: 'Amenities', color: 'green', count: amenityCount },
                { id: 'activity', label: 'Activity', color: 'purple', count: `${activityDoneCount}/${activityList.length}` },
              ].map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{scrollSnapAlign: 'start'}}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors min-h-[48px] ${
                    activeTab === tab.id
                      ? `border-${tab.color}-500 text-${tab.color}-700`
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {tab.label}
                  {tab.count !== 0 && tab.count !== '0/0' && (
                    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold ${
                      activeTab === tab.id ? `bg-${tab.color}-100 text-${tab.color}-700` : 'bg-gray-100 text-gray-600'
                    }`}>{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ========== TAB 1: LINEN ========== */}
        {selectedRoom && activeTab === 'linen' && (
          <div className="space-y-4">
            {linenCategories.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No linen categories assigned to this room.<br/>
                <span className="text-xs">Configure in Room Master - Category Standards</span>
              </div>
            )}
            {linenCategories.map(cat => {
              const roomItems = getLinenItemsForCategory(cat.id);
              const catReplaceRows = replaceRows[cat.id] || [];
              const selectableItems = allItems.filter(i => i.category_id === cat.id);
              // Compute total dirty+damage+lost for this sub-category
              const catDDL = roomItems.reduce((sum, stock) => {
                const act = linenActions[stock.item_id] || {};
                return sum + (act.dirtyQty || 0) + (act.damageQty || 0) + (act.lostQty || 0);
              }, 0);
              // Compute total replacement qty already entered for this sub-category
              const catReplaceTotal = catReplaceRows.reduce((sum, r) => sum + (r.itemId ? (parseFloat(r.qty) || 0) : 0), 0);
              // Check if category has any in-room stock (if not, replacement is unconstrained by DDL)
              const catHasStock = roomItems.some(stock => stock.quantity > 0);
              const isCollapsed = collapsedSections['linen_' + cat.id];
              return (
                <div key={cat.id} className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                  <button onClick={() => toggleSection('linen_' + cat.id)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors min-h-[48px]">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="font-semibold text-blue-900 text-sm">{cat.name}</span>
                      <span className="text-xs text-blue-600">({roomItems.length} in room)</span>
                    </div>
                    <span className="text-blue-400 text-lg">{isCollapsed ? '+' : '−'}</span>
                  </button>
                  {!isCollapsed && (
                    <div>
                      {/* Current Room Stock */}
                      {roomItems.length > 0 && (
                        <div className="px-4 pt-3 pb-1">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Current in Room</p>

                          {/* DESKTOP TABLE */}
                          <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-gray-100 text-gray-600">
                                  <th className="text-left px-3 py-2 font-semibold text-xs">Item Name</th>
                                  <th className="text-center px-2 py-2 font-semibold text-xs w-16">Stock</th>
                                  <th className="text-center px-2 py-2 font-semibold text-xs w-20"><span className="text-yellow-700">Dirty</span></th>
                                  <th className="text-center px-2 py-2 font-semibold text-xs w-20"><span className="text-orange-700">Damage</span></th>
                                  <th className="text-center px-2 py-2 font-semibold text-xs w-20"><span className="text-red-700">Lost</span></th>
                                  <th className="text-center px-2 py-2 font-semibold text-xs w-20"><span className="text-teal-700">To HK</span></th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {roomItems.map(stock => {
                                  const act = linenActions[stock.item_id] || { dirtyQty: 0, damageQty: 0, lostQty: 0, toHkQty: 0 };
                                  const total = act.dirtyQty + act.damageQty + act.lostQty + (act.toHkQty || 0);
                                  const hasAction = total > 0;
                                  const rowBg = hasAction ? 'bg-gray-50' : 'bg-white';
                                  const maxStock = stock.quantity;
                                  const updateAction = (field, val) => {
                                    const newAct = { ...act, [field]: val };
                                    const newTotal = newAct.dirtyQty + newAct.damageQty + newAct.lostQty + (newAct.toHkQty || 0);
                                    if (newTotal > maxStock) return;
                                    if (newTotal === 0) { const na = { ...linenActions }; delete na[stock.item_id]; setLinenActions(na); }
                                    else { setLinenActions(prev => ({ ...prev, [stock.item_id]: newAct })); }
                                  };
                                  return (
                                    <tr key={stock.id} className={rowBg}>
                                      <td className="px-3 py-2">
                                        <p className="font-medium text-gray-900 truncate">{stock.items?.code} - {stock.items?.name}</p>
                                        {stock.items?.brand && <p className="text-xs text-gray-400">{stock.items.brand}</p>}
                                      </td>
                                      <td className="text-center px-2 py-2">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">{formatNumber(stock.quantity)}</span>
                                      </td>
                                      {!isView ? (
                                        <>
                                          <td className="text-center px-2 py-2">
                                            <input {...intQtyInputProps} max={maxStock - act.damageQty - act.lostQty - (act.toHkQty || 0)} value={act.dirtyQty || ''}
                                              onChange={e => updateAction('dirtyQty', toIntQty(e.target.value))}
                                              placeholder="0"
                                              className={`w-full px-2 py-1.5 border rounded-lg text-xs text-center font-semibold min-h-[36px] ${act.dirtyQty > 0 ? 'border-yellow-400 bg-yellow-50 text-yellow-800' : 'border-gray-300'}`} />
                                          </td>
                                          <td className="text-center px-2 py-2">
                                            <input {...intQtyInputProps} max={maxStock - act.dirtyQty - act.lostQty - (act.toHkQty || 0)} value={act.damageQty || ''}
                                              onChange={e => updateAction('damageQty', toIntQty(e.target.value))}
                                              placeholder="0"
                                              className={`w-full px-2 py-1.5 border rounded-lg text-xs text-center font-semibold min-h-[36px] ${act.damageQty > 0 ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-gray-300'}`} />
                                          </td>
                                          <td className="text-center px-2 py-2">
                                            <input {...intQtyInputProps} max={maxStock - act.dirtyQty - act.damageQty - (act.toHkQty || 0)} value={act.lostQty || ''}
                                              onChange={e => updateAction('lostQty', toIntQty(e.target.value))}
                                              placeholder="0"
                                              className={`w-full px-2 py-1.5 border rounded-lg text-xs text-center font-semibold min-h-[36px] ${act.lostQty > 0 ? 'border-red-400 bg-red-50 text-red-800' : 'border-gray-300'}`} />
                                          </td>
                                          <td className="text-center px-2 py-2">
                                            <input {...intQtyInputProps} max={maxStock - act.dirtyQty - act.damageQty - act.lostQty} value={act.toHkQty || ''}
                                              onChange={e => updateAction('toHkQty', toIntQty(e.target.value))}
                                              placeholder="0"
                                              className={`w-full px-2 py-1.5 border rounded-lg text-xs text-center font-semibold min-h-[36px] ${act.toHkQty > 0 ? 'border-teal-400 bg-teal-50 text-teal-800' : 'border-gray-300'}`} />
                                          </td>
                                        </>
                                      ) : (
                                        <>
                                          <td className="text-center px-2 py-2 text-xs font-semibold">{act.dirtyQty > 0 ? <span className="text-yellow-700">{act.dirtyQty}</span> : <span className="text-gray-300">-</span>}</td>
                                          <td className="text-center px-2 py-2 text-xs font-semibold">{act.damageQty > 0 ? <span className="text-orange-700">{act.damageQty}</span> : <span className="text-gray-300">-</span>}</td>
                                          <td className="text-center px-2 py-2 text-xs font-semibold">{act.lostQty > 0 ? <span className="text-red-700">{act.lostQty}</span> : <span className="text-gray-300">-</span>}</td>
                                          <td className="text-center px-2 py-2 text-xs font-semibold">{act.toHkQty > 0 ? <span className="text-teal-700">{act.toHkQty}</span> : <span className="text-gray-300">-</span>}</td>
                                        </>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* MOBILE CARD LIST */}
                          <div className="sm:hidden space-y-2">
                            {roomItems.map(stock => {
                              const act = linenActions[stock.item_id] || { dirtyQty: 0, damageQty: 0, lostQty: 0, toHkQty: 0 };
                              const total = act.dirtyQty + act.damageQty + act.lostQty + (act.toHkQty || 0);
                              const hasAction = total > 0;
                              const maxStock = stock.quantity;
                              const borderColor = hasAction ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white';
                              const updateAction = (field, val) => {
                                const newAct = { ...act, [field]: val };
                                const newTotal = newAct.dirtyQty + newAct.damageQty + newAct.lostQty + (newAct.toHkQty || 0);
                                if (newTotal > maxStock) return;
                                if (newTotal === 0) { const na = { ...linenActions }; delete na[stock.item_id]; setLinenActions(na); }
                                else { setLinenActions(prev => ({ ...prev, [stock.item_id]: newAct })); }
                              };
                              return (
                                <div key={stock.id} className={`border-2 rounded-xl p-3 space-y-2.5 ${borderColor}`}>
                                  {/* Item name + stock qty */}
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0 mr-2">
                                      <p className="font-semibold text-gray-900 text-sm leading-tight">{stock.items?.code} - {stock.items?.name}</p>
                                      {stock.items?.brand && <p className="text-xs text-gray-400 mt-0.5">{stock.items.brand}</p>}
                                    </div>
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 shrink-0">
                                      {formatNumber(stock.quantity)}
                                    </span>
                                  </div>
                                  {/* 3 qty steppers for each action */}
                                  {!isView && (
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-yellow-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"></span>Dirty</span>
                                        <QtyStepper value={act.dirtyQty} min={0} max={maxStock - act.damageQty - act.lostQty - (act.toHkQty || 0)}
                                          onChange={val => updateAction('dirtyQty', val)} color="gray" />
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-orange-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span>Damage</span>
                                        <QtyStepper value={act.damageQty} min={0} max={maxStock - act.dirtyQty - act.lostQty - (act.toHkQty || 0)}
                                          onChange={val => updateAction('damageQty', val)} color="gray" />
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-red-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span>Lost</span>
                                        <QtyStepper value={act.lostQty} min={0} max={maxStock - act.dirtyQty - act.damageQty - (act.toHkQty || 0)}
                                          onChange={val => updateAction('lostQty', val)} color="gray" />
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-teal-700 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-400 inline-block"></span>To HK</span>
                                        <QtyStepper value={act.toHkQty || 0} min={0} max={maxStock - act.dirtyQty - act.damageQty - act.lostQty}
                                          onChange={val => updateAction('toHkQty', val)} color="gray" />
                                      </div>
                                      {hasAction && (
                                        <p className="text-xs text-gray-500 text-right">Total: {total} / {maxStock}</p>
                                      )}
                                    </div>
                                  )}
                                  {/* View mode */}
                                  {isView && hasAction && (
                                    <div className="space-y-1">
                                      {act.dirtyQty > 0 && <div className="flex justify-between text-xs"><span className="font-medium text-yellow-700">Dirty</span><span className="font-bold">{act.dirtyQty}</span></div>}
                                      {act.damageQty > 0 && <div className="flex justify-between text-xs"><span className="font-medium text-orange-700">Damage</span><span className="font-bold">{act.damageQty}</span></div>}
                                      {act.lostQty > 0 && <div className="flex justify-between text-xs"><span className="font-medium text-red-700">Lost</span><span className="font-bold">{act.lostQty}</span></div>}
                                      {act.toHkQty > 0 && <div className="flex justify-between text-xs"><span className="font-medium text-teal-700">To HK</span><span className="font-bold">{act.toHkQty}</span></div>}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {roomItems.length === 0 && (
                        <div className="px-4 pt-3 pb-1">
                          <p className="text-xs text-gray-400 italic">No items in room for this category</p>
                        </div>
                      )}

                      {/* REPLACE SECTION */}
                      <div className="px-4 pt-3 pb-4 border-t border-blue-100 mt-2">
                        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Replacement (Item Move to this Room)</p>
                        <p className="text-xs text-blue-500 mb-3">Housekeeping Store - Room</p>
                        {catReplaceRows.length > 0 && (
                          <div className="space-y-2 mb-3">
                            {catReplaceRows.map((row, idx) => (
                              <div key={row.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs font-semibold text-blue-600 shrink-0">#{idx + 1}</span>
                                  {!isView && (
                                    <button onClick={() => setReplaceRows(prev => ({ ...prev, [cat.id]: (prev[cat.id] || []).filter(r => r.id !== row.id) }))}
                                      className="ml-auto text-red-400 hover:text-red-600 text-lg font-bold min-w-[32px] min-h-[32px] flex items-center justify-center">x</button>
                                  )}
                                </div>
                                {!isView ? (
                                  <div className="space-y-2">
                                    <select value={row.itemId}
                                      onChange={e => setReplaceRows(prev => ({ ...prev, [cat.id]: (prev[cat.id] || []).map(r => r.id === row.id ? { ...r, itemId: e.target.value } : r) }))}
                                      className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white min-h-[44px]">
                                      <option value="">-- Select Item --</option>
                                      {selectableItems.map(it => (
                                        <option key={it.id} value={it.id}>{it.code} - {it.name}{it.brand ? ` (${it.brand})` : ''}</option>
                                      ))}
                                    </select>
                                    <div className="flex items-center justify-between">
                                      <label className="text-xs font-medium text-blue-700 shrink-0">Qty:</label>
                                      <QtyStepper value={row.qty} min={1} max={99} color="blue"
                                        onChange={val => setReplaceRows(prev => ({ ...prev, [cat.id]: (prev[cat.id] || []).map(r => r.id === row.id ? { ...r, qty: val } : r) }))}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{(() => { const it = allItems.find(i => i.id === row.itemId); return it ? `${it.code} - ${it.name}` : '-'; })()}</span>
                                    <span className="text-sm font-semibold text-blue-700">{row.qty} pcs</span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {!isView && (
                          <button onClick={() => setReplaceRows(prev => ({ ...prev, [cat.id]: [...(prev[cat.id] || []), { id: Date.now() + Math.random(), itemId: '', qty: 1 }] }))}
                            className="w-full py-2.5 px-4 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 text-sm font-semibold hover:bg-blue-50 hover:border-blue-400 transition-colors min-h-[44px]">
                            + Add Replace Item
                          </button>
                        )}
                        {catReplaceRows.length === 0 && isView && (
                          <p className="text-xs text-gray-400 italic">No replacements</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ========== TAB 2: GUEST AMENITIES ========== */}
        {selectedRoom && activeTab === 'amenities' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              Silahkan input Amenities yang anda Refill di kamar ini.
            </div>
            {amenityCategories.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No amenity categories assigned to this room.<br/>
                <span className="text-xs">Configure in Room Master - Category Standards</span>
              </div>
            )}
            {amenityCategories.map(cat => {
              const items = getAmenityItemsForCategory(cat.id);
              const entry = amenityQty[cat.id] || { itemId: '', qty: 0 };
              const selectedItem = entry.itemId ? allItems.find(i => i.id === entry.itemId) : null;
              return (
                <div key={cat.id} className="bg-white border border-green-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-4 py-3 bg-green-50 border-b border-green-200">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="font-semibold text-green-900 text-sm">{cat.name}</span>
                      <span className="text-xs text-green-600">(max {cat.maxQty || 1})</span>
                      {entry.itemId && entry.qty > 0 && (
                        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          {entry.qty} selected
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    {!isView ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Select Item</label>
                          <select value={entry.itemId}
                            onChange={e => setAmenityQty(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], itemId: e.target.value, qty: e.target.value ? (prev[cat.id]?.qty || 1) : 0 } }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white min-h-[40px]">
                            <option value="">-- Select Item --</option>
                            {items.map(it => (
                              <option key={it.id} value={it.id}>{it.code} - {it.name}{it.brand ? ` (${it.brand})` : ''}</option>
                            ))}
                          </select>
                        </div>
                        {entry.itemId && (
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-gray-600 shrink-0">Qty:</label>
                            <QtyStepper value={entry.qty || 1} min={1} max={cat.maxQty || 1} color="green"
                              onChange={val => setAmenityQty(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], qty: val } }))}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      entry.itemId && entry.qty > 0 ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm text-gray-900">{selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : '-'}</p>
                            {selectedItem?.brand && <p className="text-xs text-gray-400">{selectedItem.brand}</p>}
                          </div>
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">{entry.qty}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">No amenity selected for this category</p>
                      )
                    )}
                  </div>
                </div>
              );
            })}
            {amenityCount > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                <strong>{amenityCount}</strong> amenity categories filled. Stock will be deducted on confirm.
              </div>
            )}
          </div>
        )}

        {/* ========== TAB 3: ACTIVITY LIST ========== */}
        {selectedRoom && activeTab === 'activity' && (
          <div className="space-y-3">
            {activityList.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">
                No activities assigned to this room.<br/>
                <span className="text-xs">Configure in Room Master - Activity Checklist</span>
              </div>
            )}
            {activityList.map(act => {
              const check = activityChecks[act.id] || { isDone: false, notes: '' };
              return (
                <div key={act.id} className={`bg-white border rounded-xl p-4 transition-colors ${
                  check.isDone ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {!isView ? (
                      <button onClick={() => setActivityChecks(prev => ({ ...prev, [act.id]: { ...prev[act.id], isDone: !check.isDone } }))}
                        className={`shrink-0 w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-colors mt-0.5 ${
                          check.isDone ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-green-400'
                        }`}>
                        {check.isDone && <span className="text-sm font-bold">✓</span>}
                      </button>
                    ) : (
                      <div className={`shrink-0 w-8 h-8 rounded-lg border-2 flex items-center justify-center mt-0.5 ${
                        check.isDone ? 'bg-green-500 border-green-500 text-white' : 'bg-red-50 border-red-300 text-red-500'
                      }`}>
                        <span className="text-sm font-bold">{check.isDone ? '✓' : '✕'}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm ${check.isDone ? 'text-green-800 line-through' : 'text-gray-900'}`}>{act.name}</p>
                      {act.description && <p className="text-xs text-gray-500 mt-0.5">{act.description}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
            {activityList.length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
                <strong>{activityDoneCount}</strong> of <strong>{activityList.length}</strong> activities completed.
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {selectedRoom && !isView && (
          <div className="mt-4">
            <FormField label="Notes">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Additional notes..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm min-h-[60px]" rows="2" />
            </FormField>
          </div>
        )}
        {isView && viewing?.notes && (
          <div className="mt-4 bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm">{viewing.notes}</p>
          </div>
        )}

        {/* DESKTOP ACTIONS (non-sticky) */}
        <div className="hidden sm:flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <Button variant="secondary" onClick={() => { setShowModal(false); setIsEditing(false); }}>
            {isView ? 'Close' : 'Cancel'}
          </Button>
          {!isView && selectedRoom && (
            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving ? 'Saving...' : (isEditMode ? 'Update Draft' : 'Save Draft')}
            </Button>
          )}
        </div>
        </div>

        {/* MOBILE STICKY FOOTER */}
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-3 z-50 shadow-lg" style={{backdropFilter: 'blur(8px)', background: 'rgba(255,255,255,0.95)'}}>
          <Button variant="secondary" className="flex-1" onClick={() => { setShowModal(false); setIsEditing(false); }}>
            {isView ? 'Close' : 'Cancel'}
          </Button>
          {!isView && selectedRoom && (
            <Button className="flex-1" onClick={handleSaveDraft} disabled={saving}>
              {saving ? 'Saving...' : (isEditMode ? 'Update Draft' : 'Save Draft')}
            </Button>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default RoomMakeUpPageNew;
