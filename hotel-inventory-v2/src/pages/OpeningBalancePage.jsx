import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDateSys, getLocalDateString } from '../utils/format';
import { checkPeriodLock, getBalanceAfter } from '../utils/stock.js';
import { getCategoryConfig, LINEN_STATUS_WAREHOUSE_MAP } from '../utils/categoryConfig';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { TreeSelect } from '../components/TreeSelect';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/StatusBadge';
import { PageLoader } from '../components/PageLoader';

function OpeningBalancePage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [locks, setLocks] = useState({});
  const [details, setDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [defaultDepartment, setDefaultDepartment] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [roomAssignments, setRoomAssignments] = useState({});
  const [showRoomPopup, setShowRoomPopup] = useState(false);
  const [roomPopupItemId, setRoomPopupItemId] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [obDate, setObDate] = useState('');
  const [selectedSubTab, setSelectedSubTab] = useState('all');
  const [showPrintMenu, setShowPrintMenu] = useState(false);

  // Helper to get warehouse by type for linen auto-mapping
  function getWarehouseByType(type) {
    if (type === 'store') return warehouses.find(w => w.warehouse_type === 'store' && w.code?.startsWith('HK'));
    if (type === 'dirty') return warehouses.find(w => w.warehouse_type === 'dirty');
    if (type === 'laundry') return warehouses.find(w => w.warehouse_type === 'laundry');
    if (type === 'damage') return warehouses.find(w => w.warehouse_type === 'damage');
    return null;
  }

  useEffect(() => {
    if (selectedOrg) loadOverview();
  }, [selectedOrg]);

  // Load category overview data
  async function loadOverview() {
    setLoading(true);
    try {
      const [catsRes, itemsRes, locksRes, detailsRes, deptRes, unitsRes, whRes, roomsRes] = await Promise.all([
        supabase.from('item_categories').select('*').order('name'),
        supabase.from('items').select('*').eq('organization_id', selectedOrg?.id).eq('is_active', true).order('code'),
        supabase.from('opening_balance_locks').select('*').eq('organization_id', selectedOrg.id),
        supabase.from('opening_balance_details').select('*').eq('organization_id', selectedOrg.id),
        supabase.from('departments').select('*').eq('organization_id', selectedOrg.id).order('name'),
        supabase.from('units').select('*').order('name'),
        supabase.from('warehouses').select('*').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
        supabase.from('rooms').select('id, room_number, floor, warehouse_id, room_types(name)').eq('organization_id', selectedOrg.id).eq('is_active', true).order('room_number')
      ]);
      setCategories(catsRes.data || []);
      setItems(itemsRes.data || []);
      setUnits(unitsRes.data || []);
      const whList = whRes.data || [];
      setWarehouses(whList);
      if (whList.length > 0 && !selectedWarehouse) setSelectedWarehouse(whList[0].id);
      const depts = deptRes.data || [];
      setDefaultDepartment(depts.find(d => d.name === 'General Store') || depts[0]);
      setRooms(roomsRes.data || []);

      // Map locks by category_id
      const lockMap = {};
      (locksRes.data || []).forEach(l => { lockMap[l.category_id] = l; });
      setLocks(lockMap);

      // Map details by item_id+status_type and reconstruct purchase_cost
      const itemMap = {};
      (itemsRes.data || []).forEach(i => { itemMap[i.id] = i; });
      const detMap = {};
      (detailsRes.data || []).forEach(d => {
        if (!detMap[d.item_id]) detMap[d.item_id] = {};
        detMap[d.item_id][d.status_type] = { quantity: d.quantity || 0, unit_cost: d.unit_cost || 0 };
        // Reconstruct purchase_cost from unit_cost * conversion_rate
        if ((d.unit_cost || 0) > 0 && !detMap[d.item_id]._purchase_cost) {
          const convRate = parseFloat(itemMap[d.item_id]?.conversion_rate) || 1;
          detMap[d.item_id]._purchase_cost = Math.round((d.unit_cost || 0) * convRate);
        }
        // Also store cost per usage unit directly (for non-Linen categories)
        if ((d.unit_cost || 0) > 0 && !detMap[d.item_id]._cost_per_usage) {
          detMap[d.item_id]._cost_per_usage = d.unit_cost || 0;
        }
      });
      setDetails(detMap);

      // Reconstruct room assignments from OPENING_BALANCE stock_movements only
      // (NOT from stock_balance, which includes transfers and other documents)
      const roomsList = roomsRes.data || [];
      const roomWhIds = roomsList.map(r => r.warehouse_id).filter(Boolean);
      if (roomWhIds.length > 0) {
        const { data: obRoomMovements } = await supabase.from('stock_movements')
          .select('item_id, warehouse_id, quantity')
          .eq('organization_id', selectedOrg.id)
          .eq('reference_type', 'OPENING_BALANCE')
          .in('warehouse_id', roomWhIds)
          .gt('quantity', 0);

        // Build warehouse_id -> room_id reverse map
        const whToRoom = {};
        roomsList.forEach(r => { if (r.warehouse_id) whToRoom[r.warehouse_id] = r.id; });

        // Rebuild roomAssignments: { itemId: { roomId: qty } }
        const rAssign = {};
        (obRoomMovements || []).forEach(rb => {
          const roomId = whToRoom[rb.warehouse_id];
          if (roomId) {
            if (!rAssign[rb.item_id]) rAssign[rb.item_id] = {};
            rAssign[rb.item_id][roomId] = parseFloat(rb.quantity) || 0;
          }
        });
        setRoomAssignments(rAssign);
      } else {
        setRoomAssignments({});
      }
    } catch (err) {
      // silently handled
    }
    setLoading(false);
  }

  function getItemsForCategory(catId) {
    // Include items from child categories too
    const childCatIds = categories.filter(c => c.parent_id === catId).map(c => c.id);
    const allIds = [catId, ...childCatIds];
    return items.filter(i => allIds.includes(i.category_id));
  }

  function getCategoryStats(cat) {
    const catItems = getItemsForCategory(cat.id);
    const lock = locks[cat.id];
    const counted = catItems.filter(i => {
      const d = details[i.id];
      if (!d) return false;
      return Object.values(d).some(v => v.quantity > 0);
    }).length;
    const totalValue = catItems.reduce((sum, i) => {
      const d = details[i.id];
      if (!d) return sum;
      const convRate = parseFloat(i.conversion_rate) || 1;
      const purchaseCost = parseFloat(d._purchase_cost) || 0;
      const costPerUsage = convRate > 0 ? purchaseCost / convRate : 0;
      const qty = Object.entries(d).filter(([k]) => k !== '_purchase_cost').reduce((s, [, v]) => s + (parseFloat(v.quantity) || 0), 0);
      return sum + (qty * costPerUsage);
    }, 0);
    const status = lock?.is_locked ? 'locked' : counted > 0 ? 'in_progress' : 'draft';
    return { total: catItems.length, counted, totalValue, status, lock };
  }

  function getUnitName(unitId) {
    const unit = units.find(u => u.id === unitId);
    return unit ? unit.abbreviation || unit.name : '-';
  }

  // ---- CATEGORY DETAIL (OPNAME) VIEW ----
  function updateDetail(itemId, statusType, field, value) {
    setDetails(prev => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [statusType]: {
          ...(prev[itemId]?.[statusType] || { quantity: 0, unit_cost: 0 }),
          [field]: value
        }
      }
    }));
  }

  // Helper: fetch ALL rows from Supabase query with pagination (bypasses default 1000-row limit)
  async function fetchAllRows(queryBuilder) {
    const PAGE_SIZE = 1000;
    let allData = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await queryBuilder.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        allData = allData.concat(data);
        offset += data.length;
        hasMore = data.length === PAGE_SIZE; // If we got a full page, there might be more
      } else {
        hasMore = false;
      }
    }
    return allData;
  }

  async function handleSaveCategory() {
    if (!selectedCategory || !defaultDepartment) return;

    // Validate opening balance date is set
    if (!obDate) {
      showNotification('Tanggal Opening Balance belum diisi! Silakan isi tanggal terlebih dahulu.', 'error');
      return;
    }

    // Check period lock based on OB date
    const lockCheck = await checkPeriodLock(selectedOrg.id, obDate);
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Tidak bisa input Opening Balance di period ini.', 'error');
      return;
    }

    const isLinen = selectedCategory.code === 'LIN';

    // For non-linen, require warehouse selection
    if (!isLinen && !selectedWarehouse) {
      showNotification('Pilih gudang terlebih dahulu sebelum menyimpan!', 'error');
      return;
    }

    // For linen: validate all in-use qty is fully assigned to rooms
    if (isLinen) {
      const catItemsCheck = getItemsForCategory(selectedCategory.id);
      const unassigned = [];
      for (const item of catItemsCheck) {
        const itemD = details[item.id] || {};
        const inUseQty = parseFloat(itemD.in_use?.quantity) || 0;
        if (inUseQty > 0) {
          const assignments = roomAssignments[item.id] || {};
          const assignedTotal = Object.values(assignments).reduce((s, q) => s + (parseFloat(q) || 0), 0);
          if (assignedTotal !== inUseQty) {
            unassigned.push(`${item.code} - ${item.name}: In-Use ${inUseQty}, Assigned ${assignedTotal}`);
          }
        }
      }
      if (unassigned.length > 0) {
        showNotification(`Qty In-Use belum di-assign semua ke room! (${unassigned.length} item: ${unassigned.map(u => u.split(':')[0]).join(', ')})`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const catItems = getItemsForCategory(selectedCategory.id);
      const config = getCategoryConfig(selectedCategory.code);
      const detailUpserts = [];
      const balanceUpserts = [];
      const fifoEntries = [];

      for (const item of catItems) {
        const itemDetails = details[item.id] || {};
        let totalQty = 0;

        const convRate = parseFloat(item.conversion_rate) || 1;
        const purchaseCost = parseFloat(itemDetails._purchase_cost) || 0;
        // For Linen: unitCost = purchaseCost / convRate; For others: use direct cost per usage unit
        const unitCost = isLinen
          ? (convRate > 0 ? purchaseCost / convRate : 0)
          : (parseFloat(itemDetails._cost_per_usage) || (convRate > 0 ? purchaseCost / convRate : 0));

        for (const st of config.statuses) {
          const d = itemDetails[st] || { quantity: 0, unit_cost: 0 };
          const qty = parseFloat(d.quantity) || 0;
          totalQty += qty;

          // Always upsert detail (including qty=0) so edits to zero are persisted
          detailUpserts.push({
            organization_id: selectedOrg.id,
            item_id: item.id,
            status_type: st,
            quantity: qty,
            unit_cost: unitCost,
            updated_at: new Date().toISOString()
          });

          // For linen: create separate balance per status/warehouse (including qty=0)
          if (isLinen) {
            const whType = LINEN_STATUS_WAREHOUSE_MAP[st];

            if (st === 'in_use') {
              if (qty > 0) {
                // In-use: create balance per room from roomAssignments
                const itemAssignments = roomAssignments[item.id] || {};
                for (const [roomId, roomQty] of Object.entries(itemAssignments)) {
                  const rQty = parseFloat(roomQty) || 0;
                  if (rQty <= 0) continue;
                  const room = rooms.find(r => r.id === roomId);
                  if (!room?.warehouse_id) continue;
                  balanceUpserts.push({
                    organization_id: selectedOrg.id,
                    department_id: defaultDepartment.id,
                    item_id: item.id,
                    warehouse_id: room.warehouse_id,
                    quantity: rQty,
                    avg_cost: unitCost,
                    total_value: rQty * unitCost,
                    last_movement_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    _status: st,
                    _is_room: true
                  });
                }
              }
              // When in_use qty=0: old room balances will be zeroed out via _zeroLinenItems below
            } else {
              // Other statuses: always upsert to warehouse (including qty=0)
              const wh = getWarehouseByType(whType);
              if (wh) {
                balanceUpserts.push({
                  organization_id: selectedOrg.id,
                  department_id: defaultDepartment.id,
                  item_id: item.id,
                  warehouse_id: wh.id,
                  quantity: qty,
                  avg_cost: unitCost,
                  total_value: qty * unitCost,
                  last_movement_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  _status: st
                });
              }
            }
          }
        }

        // For non-linen: single balance — always upsert so qty=0 edits are persisted
        if (!isLinen) {
          const totalValue = totalQty * unitCost;
          balanceUpserts.push({
            organization_id: selectedOrg.id,
            department_id: defaultDepartment.id,
            item_id: item.id,
            warehouse_id: selectedWarehouse,
            quantity: totalQty,
            avg_cost: unitCost,
            total_value: totalValue,
            last_movement_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        }

        if (totalQty > 0) {
          fifoEntries.push({
            organization_id: selectedOrg.id,
            department_id: defaultDepartment.id,
            item_id: item.id,
            reference_type: 'OPENING_BALANCE',
            reference_id: selectedOrg.id,
            quantity_received: totalQty,
            quantity_remaining: totalQty,
            unit_cost: unitCost,
            received_date: new Date().toISOString()
          });
        }
      }

      // Upsert details
      if (detailUpserts.length > 0) {
        const { error } = await supabase.from('opening_balance_details')
          .upsert(detailUpserts, { onConflict: 'organization_id,item_id,status_type' });
        if (error) throw error;
      }

      // For linen items where all qty became 0: zero out old OB room balances
      if (isLinen) {
        const zeroLinenItemIds = catItems
          .filter(item => {
            const itemDetails = details[item.id] || {};
            const totalQ = Object.entries(itemDetails)
              .filter(([k]) => k !== '_purchase_cost')
              .reduce((s, [, v]) => s + (parseFloat(v.quantity) || 0), 0);
            return totalQ === 0;
          })
          .map(item => item.id);

        if (zeroLinenItemIds.length > 0) {
          // Find existing OB movements in room warehouses for these items and zero their balances
          const roomWhIds = rooms.map(r => r.warehouse_id).filter(Boolean);
          if (roomWhIds.length > 0) {
            // Get all warehouses (room + status warehouses) that had OB for these items
            const { data: oldOBMov } = await supabase.from('stock_movements')
              .select('item_id, warehouse_id')
              .eq('organization_id', selectedOrg.id)
              .eq('reference_type', 'OPENING_BALANCE')
              .in('item_id', zeroLinenItemIds);

            if (oldOBMov && oldOBMov.length > 0) {
              // Zero out stock_balance for each old OB item+warehouse combo
              for (const mov of oldOBMov) {
                await supabase.from('stock_balance')
                  .update({ quantity: 0, total_value: 0, updated_at: new Date().toISOString() })
                  .eq('organization_id', selectedOrg.id)
                  .eq('item_id', mov.item_id)
                  .eq('warehouse_id', mov.warehouse_id);
              }
            }

            // Delete old OB stock_movements for these zero-qty items
            await supabase.from('stock_movements')
              .delete()
              .eq('organization_id', selectedOrg.id)
              .eq('reference_type', 'OPENING_BALANCE')
              .in('item_id', zeroLinenItemIds);
          }
        }
      }

      // Upsert stock_balance - for linen, use warehouse constraint
      // IMPORTANT: When editing OB, we must preserve non-OB movement effects on stock_balance
      if (balanceUpserts.length > 0) {
        // Fetch non-OB movements for affected items to adjust stock_balance correctly
        const affectedItemIds = [...new Set(balanceUpserts.map(b => b.item_id))];
        // Use pagination to avoid Supabase default 1000-row limit (total linen movements can exceed 1000)
        const nonOBMovements = await fetchAllRows(
          supabase.from('stock_movements')
            .select('item_id, warehouse_id, movement_type, quantity')
            .eq('organization_id', selectedOrg.id)
            .neq('reference_type', 'OPENING_BALANCE')
            .in('item_id', affectedItemIds)
        );

        // Build net non-OB movement per item+warehouse
        const nonOBNet = {};
        (nonOBMovements || []).forEach(m => {
          const key = m.item_id + '|' + m.warehouse_id;
          if (!nonOBNet[key]) nonOBNet[key] = 0;
          nonOBNet[key] += m.movement_type === 'IN' ? parseFloat(m.quantity) : -parseFloat(m.quantity);
        });

        // Clean up internal props and adjust quantity to include non-OB movements
        const cleanUpserts = balanceUpserts.map(b => {
          const { _status, _is_room, ...rest } = b;
          const key = b.item_id + '|' + b.warehouse_id;
          const adjustment = nonOBNet[key] || 0;
          return {
            ...rest,
            quantity: b.quantity + adjustment,
            total_value: (b.quantity + adjustment) * (b.avg_cost || 0)
          };
        });

        // Use org+item+warehouse as the unique constraint for all items
        const { error } = await supabase.from('stock_balance')
          .upsert(cleanUpserts, { onConflict: 'organization_id,item_id,warehouse_id' });
        if (error) throw error;
      }

      // Insert/replace stock_movements for opening balance
      if (balanceUpserts.length > 0) {
        const movItemIds = [...new Set(balanceUpserts.map(b => b.item_id))];
        // Delete old OB movements for all affected items (including those now qty=0)
        await supabase.from('stock_movements')
          .delete()
          .eq('organization_id', selectedOrg.id)
          .eq('reference_type', 'OPENING_BALANCE')
          .in('item_id', movItemIds);

        // Use obDate as created_at so OB always sorts first chronologically
        const obTimestamp = obDate ? new Date(obDate + 'T00:00:00').toISOString() : new Date().toISOString();
        // Only insert movements for items with qty > 0 (skip zero qty)
        const movementInserts = balanceUpserts.filter(b => b.quantity > 0).map(b => ({
          organization_id: b.organization_id,
          item_id: b.item_id,
          movement_type: 'IN',
          quantity: b.quantity,
          unit_cost: b.avg_cost,
          total_cost: b.total_value,
          balance_after: b.quantity,
          reference_type: 'OPENING_BALANCE',
          reference_number: 'OB-' + (selectedCategory?.code || 'OB'),
          notes: 'Opening Balance - ' + (selectedCategory?.name || '') + (b._status ? ' [' + b._status + ']' : ''),
          warehouse_id: b.warehouse_id || null,
          department_id: b.department_id || null,
          created_by: currentUser?.id || null,
          created_at: obTimestamp,
        }));
        if (movementInserts.length > 0) {
          const { error: smErr } = await supabase.from('stock_movements').insert(movementInserts);
          // stock movements warning handled silently
        }
      }

      // POST-SAVE RECONCILIATION: Verify stock_balance matches sum of all movements
      // This catches any edge cases where the upsert above didn't properly update
      if (balanceUpserts.length > 0) {
        const reconItemIds = [...new Set(balanceUpserts.map(b => b.item_id))];
        // Get all movements (including new OB movements just inserted) per item+warehouse
        // Use pagination to avoid Supabase default 1000-row limit (v1.0.21 fix: was truncating >1000 movements, v1.0.22 fix: race condition on stock_balance - moved to DB trigger)
        const allMovements = await fetchAllRows(
          supabase.from('stock_movements')
            .select('item_id, warehouse_id, movement_type, quantity')
            .eq('organization_id', selectedOrg.id)
            .in('item_id', reconItemIds)
        );

        // Build expected balance per item+warehouse from movements
        const expectedBal = {};
        (allMovements || []).forEach(m => {
          const key = m.item_id + '|' + m.warehouse_id;
          if (!expectedBal[key]) expectedBal[key] = { item_id: m.item_id, warehouse_id: m.warehouse_id, qty: 0 };
          expectedBal[key].qty += m.movement_type === 'IN' ? parseFloat(m.quantity) : -parseFloat(m.quantity);
        });

        // Also include zero-qty balanceUpserts (warehouses that should be 0 even if no movements)
        balanceUpserts.forEach(b => {
          const key = b.item_id + '|' + b.warehouse_id;
          if (!expectedBal[key]) expectedBal[key] = { item_id: b.item_id, warehouse_id: b.warehouse_id, qty: 0 };
        });

        // Read current stock_balance for these items (also paginated for safety)
        const currentBalances = await fetchAllRows(
          supabase.from('stock_balance')
            .select('id, item_id, warehouse_id, quantity, avg_cost')
            .eq('organization_id', selectedOrg.id)
            .in('item_id', reconItemIds)
        );

        // Fix any mismatches
        for (const [key, expected] of Object.entries(expectedBal)) {
          const current = (currentBalances || []).find(
            cb => cb.item_id === expected.item_id && cb.warehouse_id === expected.warehouse_id
          );
          const expectedQty = Math.max(0, expected.qty);
          if (current && Math.abs(parseFloat(current.quantity) - expectedQty) > 0.001) {
            await supabase.from('stock_balance').update({
              quantity: expectedQty,
              total_value: expectedQty * (current.avg_cost || 0),
              updated_at: new Date().toISOString()
            }).eq('id', current.id);
          }
        }
      }

      // FIFO entries (same as before)
      const itemIds = fifoEntries.map(f => f.item_id);
      if (itemIds.length > 0) {
        await supabase.from('stock_fifo_queue')
          .delete()
          .eq('organization_id', selectedOrg.id)
          .eq('reference_type', 'OPENING_BALANCE')
          .in('item_id', itemIds);
        const { error: fifoErr } = await supabase.from('stock_fifo_queue').insert(fifoEntries);
        // FIFO warning handled silently
      }

      // Update lock record
      const counted = catItems.filter(i => {
        const d = details[i.id];
        return d && Object.values(d).some(v => (parseFloat(v.quantity) || 0) > 0);
      }).length;
      const totalVal = balanceUpserts.reduce((s, b) => s + (b.total_value || 0), 0);

      await supabase.from('opening_balance_locks').upsert({
        organization_id: selectedOrg.id,
        category_id: selectedCategory.id,
        items_counted: counted,
        total_items: catItems.length,
        total_value: totalVal,
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id,category_id' });

      showNotification(t('ob.successSave'));
      await loadOverview();
    } catch (err) {
      showNotification(t('ob.errorSave') + ': ' + err.message, 'error');
    }
    setSaving(false);
  }

  async function handleLockCategory() {
    if (!selectedCategory) return;
    if (!(await showConfirm(t('ob.lockConfirm'), { variant: 'warning' }))) return;
    try {
      await supabase.from('opening_balance_locks').upsert({
        organization_id: selectedOrg.id,
        category_id: selectedCategory.id,
        is_locked: true,
        locked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id,category_id' });
      showNotification(t('ob.locked'));
      await loadOverview();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  function canUnlockOB() {
    const perms = currentUser?.role?.permissions;
    if (!perms) return false;
    if (perms.all === true) return true;
    return !!perms.special_actions?.unlock_opening_balance;
  }

  async function handleUnlockCategory(cat) {
    const targetCat = cat || selectedCategory;
    if (!targetCat) return;
    if (!canUnlockOB()) {
      showNotification('Anda tidak memiliki hak akses untuk membuka kunci Opening Balance.', 'error');
      return;
    }
    if (!(await showConfirm('Apakah Anda yakin ingin membuka kunci Opening Balance untuk kategori "' + targetCat.name + '"? Data dapat diedit kembali setelah di-unlock.', { variant: 'warning' }))) return;
    try {
      await supabase.from('opening_balance_locks').upsert({
        organization_id: selectedOrg.id,
        category_id: targetCat.id,
        is_locked: false,
        unlocked_at: new Date().toISOString(),
        unlocked_by: currentUser?.id || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'organization_id,category_id' });
      showNotification('Opening Balance berhasil di-unlock untuk kategori ' + targetCat.name);
      await loadOverview();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  // Print Counting Form handler
  async function handlePrintForm(format) {
    if (!selectedCategory) return;
    showNotification('Generating counting form...', 'info');

    const isLinen = selectedCategory.code === 'LIN';
    const childCats = categories.filter(c => c.parent_id === selectedCategory.id);
    const allCatIds = [selectedCategory.id, ...childCats.map(c => c.id)];
    const catItems = items.filter(i => allCatIds.includes(i.category_id));
    const config = getCategoryConfig(selectedCategory.code);

    if (isLinen) {
      // Linen form: rows = rooms, columns = item names (grouped by sub-category)
      const sortedRooms = [...rooms].sort((a, b) => (a.room_number || '').localeCompare(b.room_number || '', undefined, {numeric: true}));

      // Build sub-groups: child categories + items directly under parent
      const buildLinenSubGroups = () => {
        const groups = [];
        if (childCats.length > 0) {
          childCats.forEach(sub => {
            const subItems = catItems.filter(i => i.category_id === sub.id);
            if (subItems.length > 0) groups.push({ name: sub.name, items: subItems });
          });
          // Items directly under parent (not yet assigned to sub-category)
          const directItems = catItems.filter(i => i.category_id === selectedCategory.id);
          if (directItems.length > 0) groups.push({ name: 'Lainnya', items: directItems });
        }
        // If no groups from children, put all items in one group
        if (groups.length === 0) groups.push({ name: selectedCategory.name, items: catItems });
        return groups;
      };
      const subGroups = buildLinenSubGroups();

      if (format === 'excel') {
        // Build Excel using SheetJS
        const XLSX = window.XLSX || await loadSheetJS();
        const wb = XLSX.utils.book_new();

        subGroups.forEach(group => {
          // Header row: Room No | Item1 | Item2 | ...
          const headers = ['No', 'Room Number', ...group.items.map(i => i.name)];
          const data = [headers];
          sortedRooms.forEach((room, idx) => {
            const row = [idx + 1, room.room_number, ...group.items.map(() => '')];
            data.push(row);
          });

          const ws = XLSX.utils.aoa_to_sheet(data);
          // Set column widths
          ws['!cols'] = [{ wch: 4 }, { wch: 12 }, ...group.items.map(() => ({ wch: 10 }))];
          XLSX.utils.book_append_sheet(wb, ws, group.name.substring(0, 31));
        });

        XLSX.writeFile(wb, `Counting_Form_${selectedCategory.code}_Linen.xlsx`);
        showNotification('Excel counting form downloaded!');
      } else {
        // PDF: generate via hidden HTML -> print
        let html = `<!DOCTYPE html><html><head><title>Counting Form - ${selectedCategory.name}</title>
        <style>
          @page { size: landscape; margin: 10mm; }
          body { font-family: Arial, sans-serif; font-size: 9px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #333; padding: 3px 5px; text-align: center; }
          th { background: #e8e8e8; font-weight: bold; font-size: 8px; }
          td { height: 20px; }
          .room-col { text-align: left; font-weight: bold; }
          h2 { margin: 10px 0 5px; font-size: 14px; }
          h3 { margin: 8px 0 4px; font-size: 11px; color: #333; }
          .header-info { margin-bottom: 10px; font-size: 10px; }
          .page-break { page-break-before: always; }
        </style></head><body>`;

        subGroups.forEach((group, gIdx) => {
          if (gIdx > 0) html += '<div class="page-break"></div>';
          html += `<h2>Counting Form: ${selectedCategory.name}</h2>`;
          html += `<h3>Sub-kategori: ${group.name}</h3>`;
          html += `<div class="header-info">Hotel: ${selectedOrg?.name || '-'} | Tanggal: ${obDate} | Petugas: _______________</div>`;
          html += '<table><thead><tr><th style="width:30px">No</th><th style="width:80px">Room</th>';
          group.items.forEach(i => { html += `<th>${i.name}</th>`; });
          html += '</tr></thead><tbody>';
          sortedRooms.forEach((room, idx) => {
            html += `<tr><td>${idx+1}</td><td class="room-col">${room.room_number}</td>`;
            group.items.forEach(() => { html += '<td></td>'; });
            html += '</tr>';
          });
          html += '</tbody></table>';
        });

        html += '</body></html>';
        const printWin = window.open('', '_blank');
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => printWin.print(), 500);
        showNotification('Print form opened!');
      }
    } else {
      // Non-linen form: rows = items, columns = Code, Name, Unit, Qty (empty for filling)
      if (format === 'excel') {
        const XLSX = window.XLSX || await loadSheetJS();
        const wb = XLSX.utils.book_new();

        const headers = ['No', 'Item Code', 'Item Name', 'Unit', 'Qty', 'Notes'];
        const data = [headers];
        catItems.forEach((item, idx) => {
          data.push([idx + 1, item.code, item.name, getUnitName(item.usage_unit_id || item.unit_id), '', '']);
        });
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 35 }, { wch: 8 }, { wch: 10 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, ws, selectedCategory.name.substring(0, 31));
        XLSX.writeFile(wb, `Counting_Form_${selectedCategory.code}.xlsx`);
        showNotification('Excel counting form downloaded!');
      } else {
        let html = `<!DOCTYPE html><html><head><title>Counting Form - ${selectedCategory.name}</title>
        <style>
          @page { size: portrait; margin: 15mm; }
          body { font-family: Arial, sans-serif; font-size: 11px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #333; padding: 4px 8px; }
          th { background: #e8e8e8; font-weight: bold; text-align: center; }
          td { height: 24px; }
          h2 { margin: 10px 0 5px; font-size: 16px; }
          .header-info { margin-bottom: 15px; font-size: 11px; }
        </style></head><body>`;
        html += `<h2>Counting Form: ${selectedCategory.name}</h2>`;
        html += `<div class="header-info">Hotel: ${selectedOrg?.name || '-'} | Tanggal: ${obDate} | Petugas: _______________</div>`;
        html += '<table><thead><tr><th style="width:30px">No</th><th style="width:80px">Code</th><th>Item Name</th><th style="width:50px">Unit</th><th style="width:60px">Qty</th><th style="width:120px">Notes</th></tr></thead><tbody>';
        catItems.forEach((item, idx) => {
          html += `<tr><td style="text-align:center">${idx+1}</td><td>${item.code}</td><td>${item.name}</td><td style="text-align:center">${getUnitName(item.usage_unit_id || item.unit_id)}</td><td></td><td></td></tr>`;
        });
        html += '</tbody></table></body></html>';
        const printWin = window.open('', '_blank');
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => printWin.print(), 500);
        showNotification('Print form opened!');
      }
    }
  }

  // Load SheetJS dynamically for Excel export
  async function loadSheetJS() {
    if (window.XLSX) return window.XLSX;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.onload = () => resolve(window.XLSX);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ---- MEMOIZED VALUES (must be before any early return to follow Rules of Hooks) ----
  const childCatsOfSelected = useMemo(
    () => selectedCategory ? categories.filter(c => c.parent_id === selectedCategory.id) : [],
    [categories, selectedCategory]
  );

  const allCatIds = useMemo(
    () => selectedCategory ? [selectedCategory.id, ...childCatsOfSelected.map(c => c.id)] : [],
    [selectedCategory, childCatsOfSelected]
  );

  const catItems = useMemo(
    () => allCatIds.length > 0 ? items.filter(i => allCatIds.includes(i.category_id)) : [],
    [items, allCatIds]
  );

  const hasSubTabs = childCatsOfSelected.length > 0;

  const tabFilteredItems = useMemo(
    () => hasSubTabs && selectedSubTab !== 'all'
      ? catItems.filter(i => i.category_id === selectedSubTab)
      : catItems,
    [catItems, hasSubTabs, selectedSubTab]
  );

  const filteredItems = useMemo(
    () => tabFilteredItems.filter(item =>
      !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.code.toLowerCase().includes(search.toLowerCase())
    ),
    [tabFilteredItems, search]
  );

  const catTotalValue = useMemo(() => {
    return catItems.reduce((sum, i) => {
      const d = details[i.id] || {};
      const convRate = parseFloat(i.conversion_rate) || 1;
      const purchaseCost = parseFloat(d._purchase_cost) || 0;
      const costPerUsage = convRate > 0 ? purchaseCost / convRate : 0;
      const qty = Object.entries(d).filter(([k]) => k !== '_purchase_cost').reduce((s, [, v]) => s + (parseFloat(v.quantity) || 0), 0);
      return sum + (qty * costPerUsage);
    }, 0);
  }, [catItems, details]);

  const catCounted = useMemo(() => {
    return catItems.filter(i => {
      const d = details[i.id];
      return d && Object.values(d).some(v => (parseFloat(v.quantity) || 0) > 0);
    }).length;
  }, [catItems, details]);

  // LEVEL 1 memoized values
  const parentCats = useMemo(
    () => categories.filter(c => !c.parent_id),
    [categories]
  );

  const totalCats = useMemo(
    () => parentCats.filter(c => {
      const childCats = categories.filter(cc => cc.parent_id === c.id);
      const catIds = [c.id, ...childCats.map(cc => cc.id)];
      return items.filter(i => catIds.includes(i.category_id)).length > 0;
    }).length,
    [parentCats, categories, items]
  );

  const lockedCats = useMemo(
    () => Object.values(locks).filter(l => l.is_locked).length,
    [locks]
  );

  const grandTotal = useMemo(() => {
    return items.reduce((sum, i) => {
      const d = details[i.id] || {};
      return sum + Object.values(d).reduce((s, v) => s + (parseFloat(v.quantity) || 0) * (parseFloat(v.unit_cost) || 0), 0);
    }, 0);
  }, [items, details]);

  // ---- RENDER ----
  if (loading) return <PageLoader />;

  // LEVEL 2: Category detail (opname form)
  if (selectedCategory) {
    const config = getCategoryConfig(selectedCategory.code);
    const isMultiStatus = config.statuses.length > 1;
    const lock = locks[selectedCategory.id];
    const isLocked = lock?.is_locked || false;
    const isLinenCategory = selectedCategory?.code === 'LIN';

    return (
      <div>
        <PageHeader
          title={selectedCategory.name}
          subtitle={`${t('ob.title')} — ${catItems.length} ${t('ob.items')}`}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => { setSelectedCategory(null); setSearch(''); setSelectedSubTab('all'); setShowPrintMenu(false); }}>
                <Icons.ArrowLeft /> {t('ob.backToCategories')}
              </Button>
              {/* Print Counting Form dropdown */}
              <div className="relative">
                <Button variant="secondary" onClick={() => setShowPrintMenu(!showPrintMenu)}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                  Print Form
                </Button>
                {showPrintMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]">
                    <button onClick={() => { handlePrintForm('pdf'); setShowPrintMenu(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 rounded-t-lg">
                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zm-3 9.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5.67-1.5 1.5-1.5 1.5.67 1.5 1.5zm4 0c0 .83-.67 1.5-1.5 1.5S11 14.33 11 13.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5z"/></svg>
                      Export PDF
                    </button>
                    <button onClick={() => { handlePrintForm('excel'); setShowPrintMenu(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 rounded-b-lg border-t border-gray-100">
                      <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM7 17v-2h2v2H7zm0-4v-2h2v2H7zm4 4v-2h2v2h-2zm0-4v-2h2v2h-2zm4 4v-2h2v2h-2zm0-4v-2h2v2h-2z"/></svg>
                      Export Excel
                    </button>
                  </div>
                )}
              </div>
              {isLocked ? (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium">
                    <Icons.Lock /> {t('ob.lockedStatus')}
                  </span>
                  {canUnlockOB() && (
                    <Button variant="secondary" onClick={() => handleUnlockCategory(selectedCategory)} className="text-amber-700 border-amber-300 hover:bg-amber-50">
                      <Icons.Unlock /> Unlock
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Button variant="secondary" onClick={handleLockCategory} disabled={catCounted === 0}>
                    <Icons.Lock /> {t('ob.lockBtn')}
                  </Button>
                  <Button onClick={handleSaveCategory} disabled={saving || (!isLinenCategory && !selectedWarehouse)}>
                    {saving ? t('ob.saving') : t('ob.save')}
                  </Button>
                </>
              )}
            </div>
          }
        />

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatCard title={t('ob.totalItems')} value={catItems.length} icon={Icons.Package} color="blue" />
          <StatCard title={t('ob.itemsCounted')} value={catCounted} icon={Icons.Check} color="green" />
          <StatCard title={t('ob.totalStockValue')} value={`Rp ${catTotalValue.toLocaleString('id-ID')}`} icon={Icons.Database} color="purple" />
        </div>

        {/* Lock Warning */}
        {!isLocked && catCounted > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <Icons.AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-700">{t('ob.lockWarning')}</p>
          </div>
        )}

        {/* Opening Balance Date */}
        {!isLocked && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/><line x1="16" y1="2" x2="16" y2="6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/><line x1="8" y1="2" x2="8" y2="6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/><line x1="3" y1="10" x2="21" y2="10" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}/></svg>
            <label className="text-sm font-medium text-blue-800 whitespace-nowrap">Tanggal Opening Balance:</label>
            <input type="date" value={obDate} onChange={e => setObDate(e.target.value)}
              className="px-3 py-1.5 border border-blue-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <span className="text-xs text-blue-600">Tanggal ini akan digunakan sebagai timestamp mutasi opening balance</span>
          </div>
        )}

        {/* Warehouse & Search */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4">
          <div className="p-4 flex flex-col md:flex-row gap-3">
            {isLinenCategory ? (
              <div className="flex items-center gap-2 md:w-auto">
                <Icons.Info className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <span className="text-sm text-blue-700">Linen: warehouse otomatis per status (HK Store, Room, Dirty, Laundry, Damaged)</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 md:w-80">
                <span className="text-xs text-gray-500 italic">Silahkan pilih gudang untuk penempatan opening balance ini</span>
                <div className="flex items-center gap-2">
                  <Icons.Warehouse className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value)}
                    disabled={isLocked}
                    className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-primary-500 ${isLocked ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-200'} ${selectedWarehouse ? 'border-blue-300 bg-blue-50' : ''}`}>
                    <option value="">-- Pilih Gudang --</option>
                    {warehouses.filter(w => !['dirty','laundry','room'].includes(w.warehouse_type)).map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          {!isLinenCategory && !selectedWarehouse && !isLocked && (
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                <Icons.AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="text-xs text-amber-700">Pilih gudang terlebih dahulu sebelum menyimpan data counting.</span>
              </div>
            </div>
          )}
        </div>

        {/* Sub-category Tabs (for parents with children like Linen, Amenities) */}
        {hasSubTabs && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4">
            <div className="flex flex-wrap gap-0 border-b border-gray-100 px-2 pt-2">
              <button
                onClick={() => setSelectedSubTab('all')}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  selectedSubTab === 'all' ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                Semua ({catItems.length})
              </button>
              {childCatsOfSelected.map(sub => {
                const subItems = items.filter(i => i.category_id === sub.id);
                return (
                  <button key={sub.id}
                    onClick={() => setSelectedSubTab(sub.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      selectedSubTab === sub.id ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}>
                    {sub.name} ({subItems.length})
                  </button>
                );
              })}
              {/* Items directly under parent (no sub-category) */}
              {(() => {
                const directItems = items.filter(i => i.category_id === selectedCategory.id);
                if (directItems.length === 0) return null;
                return (
                  <button
                    onClick={() => setSelectedSubTab(selectedCategory.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      selectedSubTab === selectedCategory.id ? 'border-primary-500 text-primary-700 bg-primary-50' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}>
                    Lainnya ({directItems.length})
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {/* Items Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {catItems.length === 0 ? (
            <div className="p-12 text-center text-gray-500">{t('ob.noItems')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 w-24">{t('ob.itemCode')}</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">{t('ob.itemName')}</th>
                    {isLinenCategory ? (
                      <React.Fragment>
                        {config.statuses.map(st => (
                          <th key={st} className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-24">
                            {t(config.labels[st])}
                          </th>
                        ))}
                        {isMultiStatus && (
                          <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20 bg-blue-50">Total Usage Unit Qty</th>
                        )}
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Purchase Unit</th>
                        <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-32">Cost/Usage Unit</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Usage Unit</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Conversion</th>
                        <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-32">Cost/Usage Unit</th>
                      </React.Fragment>
                    ) : (
                      <React.Fragment>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Purchase Unit</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Usage Unit</th>
                        <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-20">Conversion</th>
                        {config.statuses.map(st => (
                          <th key={st} className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-28">
                            Usage Unit Qty on Hand
                          </th>
                        ))}
                        <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-2 py-3 w-32">Cost per Usage Unit</th>
                      </React.Fragment>
                    )}
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3 w-36">{t('ob.totalValue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredItems.map(item => {
                    const itemD = details[item.id] || {};
                    let totalQty = 0;
                    config.statuses.forEach(st => {
                      const d = itemD[st] || {};
                      totalQty += parseFloat(d.quantity) || 0;
                    });

                    const purchaseUnitName = getUnitName(item.purchase_unit_id || item.unit_id);
                    const usageUnitName = getUnitName(item.usage_unit_id || item.unit_id);
                    const conversionRate = parseFloat(item.conversion_rate) || 1;

                    // Cost calculation differs: Linen uses purchase_cost/convRate, others use direct cost per usage
                    const purchaseCost = parseFloat(itemD._purchase_cost) || 0;
                    const directCostPerUsage = parseFloat(itemD._cost_per_usage) || 0;
                    const costPerUsage = isLinenCategory
                      ? (conversionRate > 0 ? purchaseCost / conversionRate : 0)
                      : directCostPerUsage;
                    const totalValue = totalQty * costPerUsage;
                    const hasData = totalQty > 0;

                    return (
                      <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${hasData ? 'bg-green-50/30' : ''}`}>
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{item.code}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-medium text-sm text-gray-800">{item.name}</span>
                        </td>
                        {isLinenCategory ? (
                          <React.Fragment>
                            {config.statuses.map(st => {
                              const d = itemD[st] || {};
                              const isInUseLinenCol = st === 'in_use';
                              return (
                                <td key={st} className="px-2 py-2">
                                  <div className={isInUseLinenCol ? 'flex items-center gap-1' : ''}>
                                    <input type="number" min="0" step="1"
                                      value={d.quantity || ''}
                                      onChange={e => updateDetail(item.id, st, 'quantity', e.target.value)}
                                      disabled={isLocked} placeholder="0"
                                      className={`w-full text-center text-sm border rounded-lg px-1 py-1.5 focus:ring-2 focus:ring-primary-500
                                        ${isLocked ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-200'}
                                        ${(parseFloat(d.quantity) || 0) > 0 ? 'border-green-300 bg-green-50' : ''}`}
                                    />
                                    {isInUseLinenCol && (parseFloat(d.quantity) || 0) > 0 && !isLocked && (
                                      <button onClick={() => { setRoomPopupItemId(item.id); setShowRoomPopup(true); }}
                                        title="Assign ke kamar"
                                        className="flex-shrink-0 p-1 text-blue-600 hover:bg-blue-50 rounded">
                                        <Icons.MapPin className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                            {isMultiStatus && (
                              <td className="px-2 py-2 text-center bg-blue-50/50">
                                <span className={`text-sm font-bold ${totalQty > 0 ? 'text-blue-700' : 'text-gray-400'}`}>{totalQty || '-'}</span>
                              </td>
                            )}
                            <td className="px-2 py-2 text-center text-sm text-gray-600">{purchaseUnitName}</td>
                            <td className="px-2 py-2">
                              <input type="number" min="0" step="1"
                                value={purchaseCost || ''}
                                onChange={e => {
                                  const val = e.target.value;
                                  setDetails(prev => ({
                                    ...prev,
                                    [item.id]: {
                                      ...(prev[item.id] || {}),
                                      _purchase_cost: val
                                    }
                                  }));
                                  const cpuu = conversionRate > 0 ? (parseFloat(val) || 0) / conversionRate : 0;
                                  config.statuses.forEach(st => updateDetail(item.id, st, 'unit_cost', cpuu));
                                }}
                                disabled={isLocked} placeholder="0"
                                className={`w-full text-center text-sm border rounded-lg px-1 py-1.5 focus:ring-2 focus:ring-primary-500
                                  ${isLocked ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-200'}
                                  ${purchaseCost > 0 ? 'border-green-300 bg-green-50' : ''}`}
                              />
                            </td>
                            <td className="px-2 py-2 text-center text-sm text-gray-600">{usageUnitName}</td>
                            <td className="px-2 py-2 text-center">
                              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{conversionRate}</span>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <span className={`text-sm font-medium ${costPerUsage > 0 ? 'text-primary-700' : 'text-gray-400'}`}>
                                {costPerUsage > 0 ? formatCurrency(Math.round(costPerUsage)) : '-'}
                              </span>
                            </td>
                          </React.Fragment>
                        ) : (
                          <React.Fragment>
                            <td className="px-2 py-2 text-center text-sm text-gray-600">{purchaseUnitName}</td>
                            <td className="px-2 py-2 text-center text-sm text-gray-600">{usageUnitName}</td>
                            <td className="px-2 py-2 text-center">
                              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{conversionRate}</span>
                            </td>
                            {config.statuses.map(st => {
                              const d = itemD[st] || {};
                              return (
                                <td key={st} className="px-2 py-2">
                                  <input type="number" min="0" step="1"
                                    value={d.quantity || ''}
                                    onChange={e => updateDetail(item.id, st, 'quantity', e.target.value)}
                                    disabled={isLocked} placeholder="0"
                                    className={`w-full text-center text-sm border rounded-lg px-1 py-1.5 focus:ring-2 focus:ring-primary-500
                                      ${isLocked ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-200'}
                                      ${(parseFloat(d.quantity) || 0) > 0 ? 'border-green-300 bg-green-50' : ''}`}
                                  />
                                </td>
                              );
                            })}
                            <td className="px-2 py-2">
                              <input type="number" min="0" step="1"
                                value={directCostPerUsage || ''}
                                onChange={e => {
                                  const val = e.target.value;
                                  const cpuu = parseFloat(val) || 0;
                                  setDetails(prev => ({
                                    ...prev,
                                    [item.id]: {
                                      ...(prev[item.id] || {}),
                                      _cost_per_usage: val,
                                      _purchase_cost: Math.round(cpuu * conversionRate)
                                    }
                                  }));
                                  config.statuses.forEach(st => updateDetail(item.id, st, 'unit_cost', cpuu));
                                }}
                                disabled={isLocked} placeholder="0"
                                className={`w-full text-right text-sm border rounded-lg px-1 py-1.5 focus:ring-2 focus:ring-primary-500
                                  ${isLocked ? 'bg-gray-100 cursor-not-allowed' : 'border-gray-200'}
                                  ${directCostPerUsage > 0 ? 'border-green-300 bg-green-50' : ''}`}
                              />
                            </td>
                          </React.Fragment>
                        )}
                        <td className="px-4 py-2 text-right">
                          <span className={`text-sm font-medium ${totalValue > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                            {totalValue > 0 ? formatCurrency(Math.round(totalValue)) : '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    // Compute totals for all columns
                    const statusTotals = {};
                    config.statuses.forEach(st => { statusTotals[st] = 0; });
                    let grandTotalQty = 0;
                    let grandTotalValue = 0;
                    filteredItems.forEach(item => {
                      const itemD = details[item.id] || {};
                      let rowTotalQty = 0;
                      config.statuses.forEach(st => {
                        const q = parseFloat((itemD[st] || {}).quantity) || 0;
                        statusTotals[st] += q;
                        rowTotalQty += q;
                      });
                      grandTotalQty += rowTotalQty;
                      const convRate = parseFloat(item.conversion_rate) || 1;
                      const purchaseCost = parseFloat(itemD._purchase_cost) || 0;
                      const costPerUsage = convRate > 0 ? purchaseCost / convRate : 0;
                      grandTotalValue += rowTotalQty * costPerUsage;
                    });
                    return (
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td colSpan={2} className="px-4 py-3 text-right font-semibold text-sm text-gray-700">
                          {t('common.total')}:
                        </td>
                        {config.statuses.map(st => (
                          <td key={'ft-'+st} className="px-2 py-3 text-center font-bold text-sm text-gray-700">
                            {statusTotals[st] > 0 ? statusTotals[st].toLocaleString('id-ID') : '-'}
                          </td>
                        ))}
                        {isMultiStatus && (
                          <td className="px-2 py-3 text-center font-bold text-sm text-blue-700 bg-blue-50/50">
                            {grandTotalQty > 0 ? grandTotalQty.toLocaleString('id-ID') : '-'}
                          </td>
                        )}
                        <td className="px-2 py-3"></td>
                        <td className="px-2 py-3"></td>
                        <td className="px-2 py-3"></td>
                        <td className="px-2 py-3"></td>
                        <td className="px-2 py-3"></td>
                        <td className="px-4 py-3 text-right font-bold text-sm text-green-700">
                          Rp {Math.round(grandTotalValue).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          )}
        </div>


        {/* Room Assignment Popup for Linen In-Use */}
        {showRoomPopup && roomPopupItemId && (() => {
          const popupItem = items.find(i => i.id === roomPopupItemId);
          const itemD = details[roomPopupItemId] || {};
          const inUseQty = parseFloat(itemD.in_use?.quantity) || 0;
          const assignments = roomAssignments[roomPopupItemId] || {};
          const assignedTotal = Object.values(assignments).reduce((s, q) => s + (parseFloat(q) || 0), 0);
          const remaining = inUseQty - assignedTotal;

          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRoomPopup(false)}>
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-gray-900">Assign In-Use ke Kamar</h3>
                    <p className="text-sm text-gray-500">{popupItem?.code} - {popupItem?.name}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">Total In-Use: <strong className="text-blue-600">{inUseQty}</strong></div>
                    <div className={`text-xs ${remaining === 0 ? 'text-green-600' : remaining < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {remaining === 0 ? '✓ Semua terassign' : remaining > 0 ? `Sisa belum diassign: ${remaining}` : `Melebihi: ${Math.abs(remaining)}`}
                    </div>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-[55vh] p-4">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left">Room</th>
                        <th className="px-3 py-2 text-left">Type</th>
                        <th className="px-3 py-2 text-left">Floor</th>
                        <th className="px-3 py-2 text-center w-24">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rooms.map(room => (
                        <tr key={room.id} className={`hover:bg-gray-50 ${(parseFloat(assignments[room.id]) || 0) > 0 ? 'bg-green-50/50' : ''}`}>
                          <td className="px-3 py-2 text-sm font-medium">{room.room_number}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{room.room_types?.name || '-'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{room.floor || '-'}</td>
                          <td className="px-3 py-2">
                            <input type="number" min="0" step="1"
                              value={assignments[room.id] || ''}
                              onChange={e => {
                                const val = e.target.value;
                                setRoomAssignments(prev => ({
                                  ...prev,
                                  [roomPopupItemId]: { ...(prev[roomPopupItemId] || {}), [room.id]: val }
                                }));
                              }}
                              placeholder="0"
                              className="w-full text-center text-sm border border-gray-200 rounded-lg px-2 py-1 focus:ring-2 focus:ring-primary-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-4 border-t border-gray-200 flex justify-between items-center">
                  <div className="text-sm text-gray-500">
                    Assigned: <strong>{assignedTotal}</strong> / {inUseQty}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setShowRoomPopup(false)}>Tutup</Button>
                    <Button onClick={() => setShowRoomPopup(false)} disabled={remaining !== 0}>
                      Simpan Assignment
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // LEVEL 1: Category overview — only show parent (level 1) categories
  // (parentCats, totalCats, lockedCats, grandTotal already memoized above)

  // For parent categories with children, aggregate items from all children too
  function getItemsForParentCategory(parentCat) {
    const childCats = categories.filter(c => c.parent_id === parentCat.id);
    const catIds = [parentCat.id, ...childCats.map(c => c.id)];
    return items.filter(i => catIds.includes(i.category_id));
  }

  function getParentCategoryStats(cat) {
    const catItemsForStat = getItemsForParentCategory(cat);
    const lock = locks[cat.id];
    const counted = catItemsForStat.filter(i => {
      const d = details[i.id];
      if (!d) return false;
      return Object.values(d).some(v => v.quantity > 0);
    }).length;
    const totalValue = catItemsForStat.reduce((sum, i) => {
      const d = details[i.id];
      if (!d) return sum;
      const convRate = parseFloat(i.conversion_rate) || 1;
      const purchaseCost = parseFloat(d._purchase_cost) || 0;
      const costPerUsage = convRate > 0 ? purchaseCost / convRate : 0;
      const qty = Object.entries(d).filter(([k]) => k !== '_purchase_cost').reduce((s, [, v]) => s + (parseFloat(v.quantity) || 0), 0);
      return sum + (qty * costPerUsage);
    }, 0);
    const status = lock?.is_locked ? 'locked' : counted > 0 ? 'in_progress' : 'draft';
    return { total: catItemsForStat.length, counted, totalValue, status, lock };
  }

  return (
    <div>
      <PageHeader title={t('ob.title')} subtitle={t('ob.subtitle')} />

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title={t('ob.allCategories')} value={`${lockedCats} / ${totalCats}`} icon={Icons.Check} color="blue" />
        <StatCard title={t('ob.categoriesLocked')} value={lockedCats} icon={Icons.Lock} color="green" />
        <StatCard title={t('ob.totalStockValue')} value={`Rp ${grandTotal.toLocaleString('id-ID')}`} icon={Icons.Database} color="purple" />
      </div>

      <p className="text-sm text-gray-500 mb-4">{t('ob.selectCategory')}</p>

      {/* Category Cards — only parent (level 1) categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {parentCats.map(cat => {
          const stats = getParentCategoryStats(cat);
          if (stats.total === 0) return null; // Skip empty categories
          const config = getCategoryConfig(cat.code);
          const isMulti = config.statuses.length > 1;
          const childCats = categories.filter(c => c.parent_id === cat.id);

          const statusColor = stats.status === 'locked' ? 'bg-green-100 text-green-800' :
            stats.status === 'in_progress' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600';
          const statusLabel = stats.status === 'locked' ? t('ob.locked') :
            stats.status === 'in_progress' ? `${stats.counted}/${stats.total}` : t('ob.draft');
          const borderColor = stats.status === 'locked' ? 'border-green-200' :
            stats.status === 'in_progress' ? 'border-amber-200' : 'border-gray-100';

          return (
            <div key={cat.id} className={`bg-white rounded-xl shadow-sm border-2 ${borderColor} p-5 hover:shadow-md transition-all cursor-pointer group`}
              onClick={() => setSelectedCategory(cat)}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{cat.name}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">{cat.code} — {stats.total} {t('ob.items')}</p>
                  {childCats.length > 0 && (
                    <p className="text-xs text-blue-500 mt-0.5">{childCats.length} sub-kategori</p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor}`}>
                  {stats.status === 'locked' && <span className="mr-1">&#x1f512;</span>}
                  {statusLabel}
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div className={`h-2 rounded-full transition-all ${stats.status === 'locked' ? 'bg-green-500' : 'bg-primary-500'}`}
                  style={{ width: `${stats.total > 0 ? (stats.counted / stats.total) * 100 : 0}%` }} />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  {stats.totalValue > 0 ? `Rp ${stats.totalValue.toLocaleString('id-ID')}` : '-'}
                </span>
                {isMulti && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                    {config.statuses.length} status
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {stats.status === 'locked' && canUnlockOB() && (
                    <button onClick={(e) => { e.stopPropagation(); handleUnlockCategory(cat); }}
                      className="flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 px-2 py-1 rounded-lg border border-orange-200 transition-colors"
                      title="Unlock Opening Balance">
                      <Icons.Unlock /> Unlock
                    </button>
                  )}
                  <span className="text-xs font-medium text-primary-600 group-hover:text-primary-700">
                    {stats.status === 'locked' ? t('ob.view') : stats.status === 'in_progress' ? t('ob.continue') : t('ob.startCounting')} →
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// ROOM MAKE UP PAGE NEW (Mobile-Friendly Version)
// ============================================================

export default OpeningBalancePage;
