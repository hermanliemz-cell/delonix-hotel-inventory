import React, {useState, useEffect, useMemo} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { recordMovement, recordTransfer } from '../services/stockService.js';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { TreeSelect } from '../components/TreeSelect';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { PageLoader } from '../components/PageLoader';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';

function InUseWarehousePage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  // === Shared state ===
  const [activeTab, setActiveTab] = useState('current');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inUseWarehouse, setInUseWarehouse] = useState(null);
  const [categories, setCategories] = useState([]);
  const [allItems, setAllItems] = useState([]);
  // === Tab 1: Current Items ===
  const [currentItems, setCurrentItems] = useState([]);
  const [searchCurrent, setSearchCurrent] = useState('');
  // === Tab 2: Transfer List ===
  const [transfers, setTransfers] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState(null);
  const [viewingTransfer, setViewingTransfer] = useState(null);
  const [tfForm, setTfForm] = useState({ from_warehouse_id: '', filterCategory: '', items: [{ item_id: '', quantity: '' }], notes: '' });
  const [storeWarehouses, setStoreWarehouses] = useState([]);
  const [userDeptWarehouse, setUserDeptWarehouse] = useState(null);
  // === Tab 3: Deplete List ===
  const [depletes, setDepletes] = useState([]);
  const [showDepleteModal, setShowDepleteModal] = useState(false);
  const [editingDeplete, setEditingDeplete] = useState(null);
  const [viewingDeplete, setViewingDeplete] = useState(null);
  const [dpForm, setDpForm] = useState({ items: [{ item_id: '', quantity: '' }], notes: '' });

  useEffect(() => { if (selectedOrg) loadAll(); }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    try {
      const [whRes, catRes, itemRes, storeRes] = await Promise.all([
        supabase.from('warehouses').select('*').eq('organization_id', selectedOrg.id).eq('warehouse_type', 'in_use').single(),
        supabase.from('item_categories').select('*').eq('is_active', true).order('name'),
        supabase.from('items').select('id, code, name, brand, category_id, max_inuse_qty').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
        supabase.from('warehouses').select('id, code, name, warehouse_type').eq('organization_id', selectedOrg.id).eq('is_active', true).in('warehouse_type', ['store','general']).order('code'),
      ]);
      const iuWh = whRes.data;
      setInUseWarehouse(iuWh);
      setCategories(catRes.data || []);
      setAllItems(itemRes.data || []);
      setStoreWarehouses(storeRes.data || []);

      // Get user department warehouse
      if (currentUser?.department_id) {
        const { data: deptData } = await supabase.from('departments').select('warehouse_id').eq('id', currentUser.department_id).single();
        setUserDeptWarehouse(deptData?.warehouse_id || null);
      }

      if (iuWh) {
        // Load current items (stock balance > 0)
        const { data: stockData } = await supabase.from('stock_balance')
          .select('*, items:item_id(id, code, name, brand, category_id, item_categories:category_id(id, name))')
          .eq('warehouse_id', iuWh.id).gt('quantity', 0);
        setCurrentItems(stockData || []);

        // Load transfers
        const { data: trData } = await supabase.from('in_use_transfers')
          .select('*, in_use_transfer_items(*, items:item_id(id, code, name, brand)), from_wh:from_warehouse_id(code, name), to_wh:to_warehouse_id(code, name), departments:department_id(name), creator:created_by(email)')
          .eq('organization_id', selectedOrg.id).order('created_at', { ascending: false });
        setTransfers(trData || []);

        // Load depletes
        const { data: dpData } = await supabase.from('in_use_depletes')
          .select('*, in_use_deplete_items(*, items:item_id(id, code, name, brand)), warehouses:warehouse_id(code, name), departments:department_id(name), creator:created_by(email)')
          .eq('organization_id', selectedOrg.id).order('created_at', { ascending: false });
        setDepletes(dpData || []);
      }
    } catch (e) { }
    setLoading(false);
  }

  // === Document number generators ===
  async function genTransferNumber() {
    const code = selectedOrg.code || 'ORG';
    const pattern = `IUT-${code}-%`;
    const { data } = await supabase.from('in_use_transfers').select('transfer_number')
      .eq('organization_id', selectedOrg.id).like('transfer_number', pattern)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) { next = (parseInt(data[0].transfer_number.split('-').pop()) || 0) + 1; }
    return `IUT-${code}-${String(next).padStart(4, '0')}`;
  }

  async function genDepleteNumber() {
    const code = selectedOrg.code || 'ORG';
    const pattern = `IUD-${code}-%`;
    const { data } = await supabase.from('in_use_depletes').select('deplete_number')
      .eq('organization_id', selectedOrg.id).like('deplete_number', pattern)
      .order('created_at', { ascending: false }).limit(1);
    let next = 1;
    if (data && data.length > 0) { next = (parseInt(data[0].deplete_number.split('-').pop()) || 0) + 1; }
    return `IUD-${code}-${String(next).padStart(4, '0')}`;
  }

  // ============================================================
  // TRANSFER: Open / Save / Confirm / Revoke / Delete
  // ============================================================
  function openNewTransfer() {
    setEditingTransfer(null); setViewingTransfer(null);
    setTfForm({ from_warehouse_id: userDeptWarehouse || '', filterCategory: '', items: [{ item_id: '', quantity: '' }], notes: '' });
    setShowTransferModal(true);
  }

  function openEditTransfer(tr) {
    if (tr.status !== 'DRAFT') return;
    setEditingTransfer(tr); setViewingTransfer(null);
    setTfForm({
      from_warehouse_id: tr.from_warehouse_id,
      filterCategory: '',
      items: (tr.in_use_transfer_items || []).map(i => ({ item_id: i.item_id, quantity: i.quantity })),
      notes: tr.notes || ''
    });
    setShowTransferModal(true);
  }

  function openViewTransfer(tr) {
    setViewingTransfer(tr); setEditingTransfer(null);
    setShowTransferModal(true);
  }

  async function handleSaveTransfer() {
    const validItems = tfForm.items.filter(i => i.item_id && parseFloat(i.quantity) > 0);
    if (!tfForm.from_warehouse_id || validItems.length === 0) {
      showNotification('Pilih warehouse asal dan minimal 1 item.', 'error'); return;
    }

    // CONTROL: Check max_inuse_qty for each item
    const itemIds = validItems.map(i => i.item_id);
    const { data: existingStock } = await supabase.from('stock_balance')
      .select('item_id, quantity')
      .eq('warehouse_id', inUseWarehouse.id).in('item_id', itemIds);
    const existingMap = {};
    (existingStock || []).forEach(s => { existingMap[s.item_id] = parseFloat(s.quantity) || 0; });

    const overQuotaItems = [];
    for (const row of validItems) {
      const itemInfo = allItems.find(i => i.id === row.item_id);
      const maxQty = parseInt(itemInfo?.max_inuse_qty) || 0;
      if (maxQty > 0) {
        const currentInUse = existingMap[row.item_id] || 0;
        const newQty = parseFloat(row.quantity) || 0;
        if (currentInUse + newQty > maxQty) {
          overQuotaItems.push(`${itemInfo?.name || 'Unknown'} (max: ${maxQty}, saat ini di IU: ${currentInUse}, request: ${newQty})`);
        }
      }
    }
    if (overQuotaItems.length > 0) {
      showNotification(`Qty melebihi Max In-Use Qty:\n${overQuotaItems.join('\n')}`, 'error'); return;
    }

    setSaving(true);
    try {
      if (editingTransfer) {
        // UPDATE existing DRAFT
        await supabase.from('in_use_transfer_items').delete().eq('transfer_id', editingTransfer.id);
        const { error } = await supabase.from('in_use_transfers').update({
          from_warehouse_id: tfForm.from_warehouse_id,
          notes: tfForm.notes, updated_at: new Date().toISOString()
        }).eq('id', editingTransfer.id);
        if (error) throw error;
        await supabase.from('in_use_transfer_items').insert(validItems.map(i => ({
          transfer_id: editingTransfer.id, item_id: i.item_id, quantity: parseFloat(i.quantity)
        })));
        showNotification('Transfer draft berhasil diupdate.', 'success');
      } else {
        // CREATE new DRAFT
        const num = await genTransferNumber();
        const { data: newTr, error } = await supabase.from('in_use_transfers').insert({
          transfer_number: num, organization_id: selectedOrg.id,
          transfer_date: new Date().toISOString().split('T')[0],
          from_warehouse_id: tfForm.from_warehouse_id, to_warehouse_id: inUseWarehouse.id,
          department_id: currentUser?.department_id || null, created_by: currentUser?.id || null,
          status: 'DRAFT', notes: tfForm.notes
        }).select().single();
        if (error) throw error;
        await supabase.from('in_use_transfer_items').insert(validItems.map(i => ({
          transfer_id: newTr.id, item_id: i.item_id, quantity: parseFloat(i.quantity)
        })));
        showNotification(`Draft ${num} berhasil dibuat.`, 'success');
      }
      setShowTransferModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleConfirmTransfer(tr) {
    if (tr.status !== 'DRAFT') return;
    if (!(await showConfirm(`Confirm transfer ${tr.transfer_number}?\n\nStock akan berpindah dari ${tr.from_wh?.code || 'warehouse'} ke In-Use Warehouse.\nAksi ini akan membuat stock movement.`, { variant: 'warning' }))) return;

    // CONTROL: Re-check max_inuse_qty before confirm
    const trItems = tr.in_use_transfer_items || [];
    const itemIds = trItems.map(i => i.item_id);
    const { data: existingStock } = await supabase.from('stock_balance')
      .select('item_id, quantity')
      .eq('warehouse_id', inUseWarehouse.id).in('item_id', itemIds);
    const existingMap = {};
    (existingStock || []).forEach(s => { existingMap[s.item_id] = parseFloat(s.quantity) || 0; });
    const { data: itemsData } = await supabase.from('items').select('id, name, max_inuse_qty').in('id', itemIds);
    const itemInfoMap = {};
    (itemsData || []).forEach(i => { itemInfoMap[i.id] = i; });
    const overQuotaItems = [];
    for (const row of trItems) {
      const info = itemInfoMap[row.item_id];
      const maxQty = parseInt(info?.max_inuse_qty) || 0;
      if (maxQty > 0) {
        const currentInUse = existingMap[row.item_id] || 0;
        const newQty = parseFloat(row.quantity) || 0;
        if (currentInUse + newQty > maxQty) {
          overQuotaItems.push(`${info?.name || 'Unknown'} (max: ${maxQty}, saat ini: ${currentInUse}, request: ${newQty})`);
        }
      }
    }
    if (overQuotaItems.length > 0) {
      showNotification(`Tidak bisa confirm. Qty melebihi Max In-Use Qty:\n${overQuotaItems.join('\n')}`, 'error'); return;
    }

    // CONTROL: Check source warehouse has enough stock
    for (const item of trItems) {
      const qty = parseFloat(item.quantity);
      const { data: srcBal } = await supabase.from('stock_balance')
        .select('quantity').eq('item_id', item.item_id).eq('warehouse_id', tr.from_warehouse_id).maybeSingle();
      if (!srcBal || parseFloat(srcBal.quantity) < qty) {
        const itemName = item.items?.name || 'Unknown';
        showNotification(`Stock tidak cukup untuk ${itemName}. Tersedia: ${srcBal?.quantity || 0}, Dibutuhkan: ${qty}`, 'error'); return;
      }
    }

    setSaving(true);
    try {
      for (const item of trItems) {
        const qty = parseFloat(item.quantity);
        // Get avg_cost from source
        const { data: sb } = await supabase.from('stock_balance')
          .select('id, quantity, avg_cost, total_value')
          .eq('item_id', item.item_id).eq('warehouse_id', tr.from_warehouse_id).maybeSingle();
        const unitCost = sb ? parseFloat(sb.avg_cost) || 0 : 0;
        const totalCost = qty * unitCost;

        // Update unit_cost in transfer items
        await supabase.from('in_use_transfer_items').update({ unit_cost: unitCost, total_cost: totalCost }).eq('transfer_id', tr.id).eq('item_id', item.item_id);

        // Atomic OUT+IN via RPC (Fase 6)
        const { error: trErr } = await recordTransfer({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          sourceWarehouseId: tr.from_warehouse_id,
          destWarehouseId: inUseWarehouse.id,
          quantity: qty,
          referenceType: 'IU-TRANSFER',
          referenceNumber: tr.transfer_number,
          referenceId: tr.id,
          unitCost: unitCost,
          departmentId: currentUser?.department_id || null,
          notes: `Transfer ${tr.from_wh?.code || 'warehouse'} → In-Use`,
        });
        if (trErr) throw trErr;
      }

      await supabase.from('in_use_transfers').update({
        status: 'CONFIRMED', confirmed_at: new Date().toISOString(), confirmed_by: currentUser?.id || null, updated_at: new Date().toISOString()
      }).eq('id', tr.id);

      showNotification(`${tr.transfer_number} berhasil dikonfirmasi.`, 'success');
      setShowTransferModal(false);
      loadAll();
    } catch (err) {
      // Rollback: hapus movements yang sudah ter-insert
      try {
        const { data: orphaned } = await supabase.from('stock_movements')
          .select('id').eq('reference_number', tr.transfer_number).eq('reference_type', 'IU-TRANSFER');
        if (orphaned && orphaned.length > 0) {
          await supabase.from('stock_movements').delete().in('id', orphaned.map(o => o.id));
        }
      } catch (cleanupErr) { console.error('[iu-transfer confirm rollback]', cleanupErr); }
      showNotification('Error: ' + err.message + '. Movements sudah di-rollback.', 'error');
    }
    setSaving(false);
  }

  async function handleRevokeTransfer(tr) {
    if (tr.status !== 'CONFIRMED') return;
    if (!(await showConfirm(`Revoke transfer ${tr.transfer_number}?\n\nStock movement akan dibalik.\nItem akan dikembalikan ke warehouse asal.`, { variant: 'danger' }))) return;

    setSaving(true);
    try {
      const trItems = tr.in_use_transfer_items || [];
      for (const item of trItems) {
        const qty = parseFloat(item.quantity);
        const unitCost = parseFloat(item.unit_cost) || 0;
        const totalCost = qty * unitCost;

        // CONTROL: Check in-use warehouse still has the stock to reverse
        const { data: iuBal } = await supabase.from('stock_balance')
          .select('id, quantity').eq('item_id', item.item_id).eq('warehouse_id', inUseWarehouse.id).maybeSingle();
        if (!iuBal || parseFloat(iuBal.quantity) < qty) {
          const itemName = item.items?.name || 'Unknown';
          showNotification(`Tidak bisa revoke. Stock ${itemName} di In-Use Warehouse tidak cukup (sudah di-deplete?).`, 'error');
          setSaving(false); return;
        }

        // Atomic reverse: OUT dari in-use + IN kembali ke source via RPC (Fase 6)
        const { error: revErr } = await recordTransfer({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          sourceWarehouseId: inUseWarehouse.id,
          destWarehouseId: tr.from_warehouse_id,
          quantity: qty,
          referenceType: 'IU-TRANSFER-REV',
          referenceNumber: tr.transfer_number,
          referenceId: tr.id,
          unitCost: unitCost,
          departmentId: currentUser?.department_id || null,
          notes: `Revoke: return In-Use → ${tr.from_wh?.code || 'warehouse'}`,
        });
        if (revErr) throw revErr;
      }

      await supabase.from('in_use_transfers').update({
        status: 'REVOKED', revoked_at: new Date().toISOString(), revoked_by: currentUser?.id || null, updated_at: new Date().toISOString()
      }).eq('id', tr.id);

      showNotification(`${tr.transfer_number} berhasil di-revoke.`, 'success');
      setShowTransferModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDeleteTransfer(tr) {
    if (tr.status !== 'DRAFT') return;
    if (!(await showConfirm(`Hapus draft ${tr.transfer_number}?\nDokumen akan dihapus permanen.`, { variant: 'danger' }))) return;
    setSaving(true);
    try {
      await supabase.from('in_use_transfer_items').delete().eq('transfer_id', tr.id);
      const { error } = await supabase.from('in_use_transfers').delete().eq('id', tr.id);
      if (error) throw error;
      showNotification(`${tr.transfer_number} berhasil dihapus.`, 'success');
      setShowTransferModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  // ============================================================
  // DEPLETE: Open / Save / Confirm / Revoke / Delete
  // ============================================================
  function openNewDeplete() {
    setEditingDeplete(null); setViewingDeplete(null);
    // Pre-fill with current items in in-use warehouse
    setDpForm({ items: [{ item_id: '', quantity: '' }], notes: '' });
    setShowDepleteModal(true);
  }

  function openEditDeplete(dp) {
    if (dp.status !== 'DRAFT') return;
    setEditingDeplete(dp); setViewingDeplete(null);
    setDpForm({
      items: (dp.in_use_deplete_items || []).map(i => ({ item_id: i.item_id, quantity: i.quantity })),
      notes: dp.notes || ''
    });
    setShowDepleteModal(true);
  }

  function openViewDeplete(dp) {
    setViewingDeplete(dp); setEditingDeplete(null);
    setShowDepleteModal(true);
  }

  // Items available for deplete = items currently in in-use warehouse with qty > 0
  const depleteableItems = currentItems.map(sb => ({
    id: sb.items?.id, code: sb.items?.code, name: sb.items?.name, brand: sb.items?.brand,
    category_id: sb.items?.category_id, maxQty: parseFloat(sb.quantity)
  })).filter(i => i.id && i.maxQty > 0);

  async function handleSaveDeplete() {
    const validItems = dpForm.items.filter(i => i.item_id && parseFloat(i.quantity) > 0);
    if (validItems.length === 0) {
      showNotification('Pilih minimal 1 item untuk di-deplete.', 'error'); return;
    }

    // CONTROL: Check qty doesn't exceed available stock
    for (const vi of validItems) {
      const avail = depleteableItems.find(d => d.id === vi.item_id);
      if (!avail || parseFloat(vi.quantity) > avail.maxQty) {
        showNotification(`Qty untuk ${avail?.name || 'item'} melebihi stock tersedia (${avail?.maxQty || 0}).`, 'error'); return;
      }
    }

    setSaving(true);
    try {
      if (editingDeplete) {
        await supabase.from('in_use_deplete_items').delete().eq('deplete_id', editingDeplete.id);
        const { error } = await supabase.from('in_use_depletes').update({
          notes: dpForm.notes, updated_at: new Date().toISOString()
        }).eq('id', editingDeplete.id);
        if (error) throw error;
        await supabase.from('in_use_deplete_items').insert(validItems.map(i => ({
          deplete_id: editingDeplete.id, item_id: i.item_id, quantity: parseFloat(i.quantity)
        })));
        showNotification('Deplete draft berhasil diupdate.', 'success');
      } else {
        const num = await genDepleteNumber();
        const { data: newDp, error } = await supabase.from('in_use_depletes').insert({
          deplete_number: num, organization_id: selectedOrg.id,
          deplete_date: new Date().toISOString().split('T')[0],
          warehouse_id: inUseWarehouse.id,
          department_id: currentUser?.department_id || null, created_by: currentUser?.id || null,
          status: 'DRAFT', notes: dpForm.notes
        }).select().single();
        if (error) throw error;
        await supabase.from('in_use_deplete_items').insert(validItems.map(i => ({
          deplete_id: newDp.id, item_id: i.item_id, quantity: parseFloat(i.quantity)
        })));
        showNotification(`Draft ${num} berhasil dibuat.`, 'success');
      }
      setShowDepleteModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleConfirmDeplete(dp) {
    if (dp.status !== 'DRAFT') return;
    if (!(await showConfirm(`Confirm deplete ${dp.deplete_number}?\n\nItem akan dihapus dari In-Use Warehouse.\nStock movement OUT akan dibuat.`, { variant: 'warning' }))) return;

    setSaving(true);
    try {
      const dpItems = dp.in_use_deplete_items || [];

      // ====== PRE-VALIDATION: cek SEMUA stok sekaligus SEBELUM create movement ======
      const insufficientItems = [];
      const costMap = {}; // cache avg_cost per item
      for (const item of dpItems) {
        const qty = parseFloat(item.quantity);
        const { data: iuBal } = await supabase.from('stock_balance')
          .select('id, quantity, avg_cost').eq('item_id', item.item_id).eq('warehouse_id', inUseWarehouse.id).maybeSingle();
        const currentQty = iuBal ? parseFloat(iuBal.quantity) || 0 : 0;
        costMap[item.item_id] = iuBal ? parseFloat(iuBal.avg_cost) || 0 : 0;
        if (currentQty < qty) {
          const itemName = item.items?.name || 'Unknown';
          insufficientItems.push(`${itemName}: saldo=${currentQty}, diminta=${qty}`);
        }
      }
      if (insufficientItems.length > 0) {
        showNotification(`Stok tidak cukup di In-Use Warehouse:\n${insufficientItems.join('\n')}`, 'error');
        setSaving(false); return;
      }

      // ====== SEMUA STOK CUKUP — Proses movements ======
      for (const item of dpItems) {
        const qty = parseFloat(item.quantity);
        const unitCost = costMap[item.item_id] || 0;
        const totalCost = qty * unitCost;

        await supabase.from('in_use_deplete_items').update({ unit_cost: unitCost, total_cost: totalCost }).eq('deplete_id', dp.id).eq('item_id', item.item_id);

        const { error: outErr } = await recordMovement({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          warehouseId: inUseWarehouse.id,
          movementType: 'OUT',
          quantity: qty,
          referenceType: 'DEPLETED',
          referenceNumber: dp.deplete_number,
          referenceId: dp.id,
          unitCost: unitCost,
          departmentId: currentUser?.department_id || null,
          notes: 'Depleted from In-Use Warehouse',
        });
        if (outErr) throw outErr;
      }

      await supabase.from('in_use_depletes').update({
        status: 'CONFIRMED', confirmed_at: new Date().toISOString(), confirmed_by: currentUser?.id || null, updated_at: new Date().toISOString()
      }).eq('id', dp.id);

      showNotification(`${dp.deplete_number} berhasil dikonfirmasi.`, 'success');
      setShowDepleteModal(false);
      loadAll();
    } catch (err) {
      // Rollback: hapus movements yang sudah ter-insert
      try {
        const { data: orphaned } = await supabase.from('stock_movements')
          .select('id').eq('reference_number', dp.deplete_number).eq('reference_type', 'DEPLETED');
        if (orphaned && orphaned.length > 0) {
          await supabase.from('stock_movements').delete().in('id', orphaned.map(o => o.id));
        }
      } catch (cleanupErr) { console.error('[deplete confirm rollback]', cleanupErr); }
      showNotification('Error: ' + err.message + '. Movements sudah di-rollback.', 'error');
    }
    setSaving(false);
  }

  async function handleRevokeDeplete(dp) {
    if (dp.status !== 'CONFIRMED') return;
    if (!(await showConfirm(`Revoke deplete ${dp.deplete_number}?\n\nStock akan dikembalikan ke In-Use Warehouse.`, { variant: 'danger' }))) return;

    setSaving(true);
    try {
      const dpItems = dp.in_use_deplete_items || [];
      for (const item of dpItems) {
        const qty = parseFloat(item.quantity);
        const unitCost = parseFloat(item.unit_cost) || 0;
        const totalCost = qty * unitCost;

        // Reverse: IN back to in-use warehouse via RPC (Fase 6)
        const { error: revErr } = await recordMovement({
          organizationId: selectedOrg.id,
          itemId: item.item_id,
          warehouseId: inUseWarehouse.id,
          movementType: 'IN',
          quantity: qty,
          referenceType: 'DEPLETED-REV',
          referenceNumber: dp.deplete_number,
          referenceId: dp.id,
          unitCost: unitCost,
          departmentId: currentUser?.department_id || null,
          notes: 'Revoke deplete: returned to In-Use Warehouse',
        });
        if (revErr) throw revErr;
      }

      await supabase.from('in_use_depletes').update({
        status: 'REVOKED', revoked_at: new Date().toISOString(), revoked_by: currentUser?.id || null, updated_at: new Date().toISOString()
      }).eq('id', dp.id);

      showNotification(`${dp.deplete_number} berhasil di-revoke.`, 'success');
      setShowDepleteModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  async function handleDeleteDeplete(dp) {
    if (dp.status !== 'DRAFT') return;
    if (!(await showConfirm(`Hapus draft ${dp.deplete_number}?`, { variant: 'danger' }))) return;
    setSaving(true);
    try {
      await supabase.from('in_use_deplete_items').delete().eq('deplete_id', dp.id);
      const { error } = await supabase.from('in_use_depletes').delete().eq('id', dp.id);
      if (error) throw error;
      showNotification(`${dp.deplete_number} berhasil dihapus.`, 'success');
      setShowDepleteModal(false);
      loadAll();
    } catch (err) { showNotification('Error: ' + err.message, 'error'); }
    setSaving(false);
  }

  // ============================================================
  // HELPER: Transfer form item rows
  // ============================================================
  function addTfItem() { setTfForm(f => ({ ...f, items: [...f.items, { item_id: '', quantity: '' }] })); }
  function removeTfItem(idx) { setTfForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) })); }
  function updateTfItem(idx, field, val) {
    setTfForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: val } : it) }));
  }
  function addDpItem() { setDpForm(f => ({ ...f, items: [...f.items, { item_id: '', quantity: '' }] })); }
  function removeDpItem(idx) { setDpForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) })); }
  function updateDpItem(idx, field, val) {
    setDpForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [field]: val } : it) }));
  }

  // Items filtered by category for transfer form
  const filteredTfItems = useMemo(() => tfForm.filterCategory ? allItems.filter(i => i.category_id === tfForm.filterCategory) : allItems, [tfForm.filterCategory, allItems]);

  // Current items sorted by category for Tab 1
  const sortedCurrentItems = useMemo(() => [...currentItems].sort((a, b) => {
    const catA = a.items?.item_categories?.name || '';
    const catB = b.items?.item_categories?.name || '';
    if (catA !== catB) return catA.localeCompare(catB);
    return (a.items?.code || '').localeCompare(b.items?.code || '');
  }), [currentItems]);

  const filteredCurrentItems = useMemo(() => sortedCurrentItems.filter(item => {
    if (!searchCurrent) return true;
    const txt = searchCurrent.toLowerCase();
    return item.items?.name?.toLowerCase().includes(txt) || item.items?.code?.toLowerCase().includes(txt);
  }), [sortedCurrentItems, searchCurrent]);

  const statusColor = (s) => s === 'CONFIRMED' ? 'green' : s === 'DRAFT' ? 'yellow' : 'red';

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="fade-in">
      <PageHeader title={t('iu.title')} subtitle={`${t('iu.subtitle')} ${selectedOrg?.name || ''}`} />

      {inUseWarehouse && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          {t('iu.warehouse')}: <strong>{inUseWarehouse.code} - {inUseWarehouse.name}</strong>
        </div>
      )}

      {/* === TABS === */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {[
          { id: 'current', label: 'Current Items', count: currentItems.length },
          { id: 'transfers', label: 'Transfer List', count: transfers.length },
          { id: 'depletes', label: 'Deplete List', count: depletes.length },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.label} <span className="ml-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">{tab.count}</span>
          </button>
        ))}
      </div>

      {loading ? <PageLoader /> :
       !inUseWarehouse ? <div className="text-center py-12 text-gray-500">No In-Use warehouse configured for this hotel.</div> : (
        <>
          {/* ======================== TAB 1: CURRENT ITEMS ======================== */}
          {activeTab === 'current' && (
            <div>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex-1">
                  <Input placeholder="Search items..." value={searchCurrent} onChange={e => setSearchCurrent(e.target.value)} />
                </div>
                <Button onClick={openNewDeplete} className="bg-red-600 hover:bg-red-700 text-white"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4"/></svg> Deplete Items</Button>
                <Button onClick={openNewTransfer}><Icons.Plus /> Transfer Item as In-Use</Button>
              </div>
              {filteredCurrentItems.length === 0 ? <div className="text-center py-12 text-gray-500">{t('iu.empty')}</div> : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item Name</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredCurrentItems.map(item => (
                        <tr key={item.item_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-600">{item.items?.item_categories?.name || '-'}</td>
                          <td className="px-4 py-3 text-sm font-mono">{item.items?.code}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className="font-medium">{item.items?.name}</span>
                            {item.items?.brand && <span className="text-gray-400 text-xs ml-1">({item.items.brand})</span>}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-right">{item.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ======================== TAB 2: TRANSFER LIST ======================== */}
          {activeTab === 'transfers' && (
            <div>
              <div className="mb-4 flex justify-end">
                <Button onClick={openNewTransfer}><Icons.Plus /> New Transfer</Button>
              </div>
              {transfers.length === 0 ? <div className="text-center py-12 text-gray-500">Belum ada dokumen transfer.</div> : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">No. Dokumen</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {transfers.map(tr => (
                        <tr key={tr.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openViewTransfer(tr)}>
                          <td className="px-4 py-3 text-sm font-medium text-blue-600">{tr.transfer_number}</td>
                          <td className="px-4 py-3 text-sm">{tr.transfer_date}</td>
                          <td className="px-4 py-3 text-sm">{tr.from_wh?.code} - {tr.from_wh?.name}</td>
                          <td className="px-4 py-3 text-sm">{(tr.in_use_transfer_items || []).length} items</td>
                          <td className="px-4 py-3"><Badge color={statusColor(tr.status)}>{tr.status}</Badge></td>
                          <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            {tr.status === 'DRAFT' && (
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => openEditTransfer(tr)} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="Edit"><Icons.Edit /></button>
                                <button onClick={() => handleDeleteTransfer(tr)} className="p-1 hover:bg-red-50 rounded text-red-400" title="Delete"><Icons.Trash /></button>
                              </div>
                            )}
                            {tr.status === 'CONFIRMED' && (
                              <button onClick={() => handleRevokeTransfer(tr)} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-orange-50 text-orange-600 rounded hover:bg-orange-100" title="Revoke"><Icons.RotateCcw /> Revoke</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ======================== TAB 3: DEPLETE LIST ======================== */}
          {activeTab === 'depletes' && (
            <div>
              <div className="mb-4 flex justify-end">
                <Button onClick={openNewDeplete} className="bg-red-600 hover:bg-red-700 text-white"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4"/></svg> New Deplete</Button>
              </div>
              {depletes.length === 0 ? <div className="text-center py-12 text-gray-500">Belum ada dokumen deplete.</div> : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">No. Dokumen</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Items</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {depletes.map(dp => (
                        <tr key={dp.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openViewDeplete(dp)}>
                          <td className="px-4 py-3 text-sm font-medium text-blue-600">{dp.deplete_number}</td>
                          <td className="px-4 py-3 text-sm">{dp.deplete_date}</td>
                          <td className="px-4 py-3 text-sm">{(dp.in_use_deplete_items || []).length} items</td>
                          <td className="px-4 py-3"><Badge color={statusColor(dp.status)}>{dp.status}</Badge></td>
                          <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                            {dp.status === 'DRAFT' && (
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => openEditDeplete(dp)} className="p-1 hover:bg-gray-100 rounded text-gray-500" title="Edit"><Icons.Edit /></button>
                                <button onClick={() => handleDeleteDeplete(dp)} className="p-1 hover:bg-red-50 rounded text-red-400" title="Delete"><Icons.Trash /></button>
                              </div>
                            )}
                            {dp.status === 'CONFIRMED' && (
                              <button onClick={() => handleRevokeDeplete(dp)} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-orange-50 text-orange-600 rounded hover:bg-orange-100" title="Revoke"><Icons.RotateCcw /> Revoke</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ======================== TRANSFER MODAL ======================== */}
      <Modal open={showTransferModal} onClose={() => setShowTransferModal(false)}
        title={viewingTransfer ? `Transfer: ${viewingTransfer.transfer_number}` : (editingTransfer ? `Edit Transfer: ${editingTransfer.transfer_number}` : 'Transfer Item as In-Use')}
        size="lg">
        {viewingTransfer ? (
          /* VIEW MODE */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">No. Dokumen:</span> <strong>{viewingTransfer.transfer_number}</strong></div>
              <div><span className="text-gray-500">Tanggal:</span> <strong>{viewingTransfer.transfer_date}</strong></div>
              <div><span className="text-gray-500">Department:</span> <strong>{viewingTransfer.departments?.name || '-'}</strong></div>
              <div><span className="text-gray-500">User:</span> <strong>{viewingTransfer.creator?.email || '-'}</strong></div>
              <div><span className="text-gray-500">From:</span> <strong>{viewingTransfer.from_wh?.code} - {viewingTransfer.from_wh?.name}</strong></div>
              <div><span className="text-gray-500">To:</span> <strong>{viewingTransfer.to_wh?.code} - {viewingTransfer.to_wh?.name}</strong></div>
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(viewingTransfer.status)}>{viewingTransfer.status}</Badge></div>
              {viewingTransfer.notes && <div className="col-span-2"><span className="text-gray-500">Notes:</span> {viewingTransfer.notes}</div>}
            </div>
            <div className="border-t pt-3">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-gray-500 text-xs uppercase">
                  <th className="pb-2">Item</th><th className="pb-2 text-right">Qty</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(viewingTransfer.in_use_transfer_items || []).map((it, i) => (
                    <tr key={i}><td className="py-2">{it.items?.code} - {it.items?.name}</td><td className="py-2 text-right font-medium">{it.quantity}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              {viewingTransfer.status === 'DRAFT' && (
                <>
                  <Button variant="secondary" onClick={() => handleDeleteTransfer(viewingTransfer)} disabled={saving} className="text-red-600">Delete</Button>
                  <Button variant="secondary" onClick={() => openEditTransfer(viewingTransfer)} disabled={saving}>Edit</Button>
                  <Button onClick={() => handleConfirmTransfer(viewingTransfer)} disabled={saving}>Confirm</Button>
                </>
              )}
              {viewingTransfer.status === 'CONFIRMED' && (
                <Button variant="secondary" onClick={() => handleRevokeTransfer(viewingTransfer)} disabled={saving} className="text-red-600">Revoke</Button>
              )}
              <Button variant="secondary" onClick={() => setShowTransferModal(false)}>Close</Button>
            </div>
          </div>
        ) : (
          /* CREATE / EDIT MODE */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Date">
                <Input value={new Date().toLocaleDateString('id-ID')} disabled />
              </FormField>
              <FormField label="Department">
                <Input value={currentUser?.department?.name || currentUser?.department_id || '-'} disabled />
              </FormField>
              <FormField label="User">
                <Input value={currentUser?.email || '-'} disabled />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="From Warehouse" required>
                <Select value={tfForm.from_warehouse_id} onChange={e => setTfForm(f => ({ ...f, from_warehouse_id: e.target.value }))}>
                  <option value="">-- Pilih Warehouse --</option>
                  {storeWarehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </Select>
              </FormField>
              <FormField label="To Warehouse">
                <Input value={inUseWarehouse ? `${inUseWarehouse.code} - ${inUseWarehouse.name}` : '-'} disabled />
              </FormField>
            </div>
            <FormField label="Filter by Category">
              <TreeSelect value={tfForm.filterCategory} onChange={v => setTfForm(f => ({ ...f, filterCategory: v }))} categories={categories} placeholder="All Categories" />
            </FormField>

            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Qty</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tfForm.items.map((row, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <SearchableItemSelect items={filteredTfItems} value={row.item_id}
                          onChange={v => updateTfItem(idx, 'item_id', v)} placeholder="Pilih item..." />
                      </td>
                      <td className="px-3 py-2">
                        <Input {...intQtyInputProps} value={row.quantity}
                          onChange={e => updateTfItem(idx, 'quantity', toIntQty(e.target.value))} placeholder="Qty" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {tfForm.items.length > 1 && (
                          <button onClick={() => removeTfItem(idx)} className="p-1 text-red-400 hover:text-red-600"><Icons.Trash /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t bg-gray-50">
                <button onClick={addTfItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Item</button>
              </div>
            </div>

            <FormField label="Notes">
              <Input value={tfForm.notes} onChange={e => setTfForm(f => ({ ...f, notes: e.target.value }))} placeholder="Catatan (opsional)" />
            </FormField>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowTransferModal(false)}>Cancel</Button>
              <Button onClick={handleSaveTransfer} disabled={saving}>{saving ? 'Saving...' : (editingTransfer ? 'Update Draft' : 'Save as Draft')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ======================== DEPLETE MODAL ======================== */}
      <Modal open={showDepleteModal} onClose={() => setShowDepleteModal(false)}
        title={viewingDeplete ? `Deplete: ${viewingDeplete.deplete_number}` : (editingDeplete ? `Edit Deplete: ${editingDeplete.deplete_number}` : 'Deplete Items from In-Use')}
        size="lg">
        {viewingDeplete ? (
          /* VIEW MODE */
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">No. Dokumen:</span> <strong>{viewingDeplete.deplete_number}</strong></div>
              <div><span className="text-gray-500">Tanggal:</span> <strong>{viewingDeplete.deplete_date}</strong></div>
              <div><span className="text-gray-500">Department:</span> <strong>{viewingDeplete.departments?.name || '-'}</strong></div>
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(viewingDeplete.status)}>{viewingDeplete.status}</Badge></div>
              {viewingDeplete.notes && <div className="col-span-2"><span className="text-gray-500">Notes:</span> {viewingDeplete.notes}</div>}
            </div>
            <div className="border-t pt-3">
              <table className="min-w-full text-sm">
                <thead><tr className="text-left text-gray-500 text-xs uppercase">
                  <th className="pb-2">Item</th><th className="pb-2 text-right">Qty</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(viewingDeplete.in_use_deplete_items || []).map((it, i) => (
                    <tr key={i}><td className="py-2">{it.items?.code} - {it.items?.name}</td><td className="py-2 text-right font-medium">{it.quantity}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              {viewingDeplete.status === 'DRAFT' && (
                <>
                  <Button variant="secondary" onClick={() => handleDeleteDeplete(viewingDeplete)} disabled={saving} className="text-red-600">Delete</Button>
                  <Button variant="secondary" onClick={() => openEditDeplete(viewingDeplete)} disabled={saving}>Edit</Button>
                  <Button onClick={() => handleConfirmDeplete(viewingDeplete)} disabled={saving} className="bg-red-600 hover:bg-red-700">Confirm Deplete</Button>
                </>
              )}
              {viewingDeplete.status === 'CONFIRMED' && (
                <Button variant="secondary" onClick={() => handleRevokeDeplete(viewingDeplete)} disabled={saving} className="text-red-600">Revoke</Button>
              )}
              <Button variant="secondary" onClick={() => setShowDepleteModal(false)}>Close</Button>
            </div>
          </div>
        ) : (
          /* CREATE / EDIT MODE */
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Date">
                <Input value={new Date().toLocaleDateString('id-ID')} disabled />
              </FormField>
              <FormField label="Department">
                <Input value={currentUser?.department?.name || currentUser?.department_id || '-'} disabled />
              </FormField>
              <FormField label="Warehouse">
                <Input value={inUseWarehouse ? `${inUseWarehouse.code} - ${inUseWarehouse.name}` : '-'} disabled />
              </FormField>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item (In-Use)</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Available</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Qty</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dpForm.items.map((row, idx) => {
                    const avail = depleteableItems.find(d => d.id === row.item_id);
                    return (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-2">
                          <SearchableItemSelect items={depleteableItems} value={row.item_id}
                            onChange={v => updateDpItem(idx, 'item_id', v)} placeholder="Pilih item..." />
                        </td>
                        <td className="px-3 py-2 text-center font-medium text-gray-500">{avail ? avail.maxQty : '-'}</td>
                        <td className="px-3 py-2">
                          <Input {...intQtyInputProps} max={avail?.maxQty || 9999} value={row.quantity}
                            onChange={e => updateDpItem(idx, 'quantity', toIntQty(e.target.value))} placeholder="Qty" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          {dpForm.items.length > 1 && (
                            <button onClick={() => removeDpItem(idx)} className="p-1 text-red-400 hover:text-red-600"><Icons.Trash /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t bg-gray-50">
                <button onClick={addDpItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Item</button>
              </div>
            </div>

            <FormField label="Notes">
              <Input value={dpForm.notes} onChange={e => setDpForm(f => ({ ...f, notes: e.target.value }))} placeholder="Catatan (opsional)" />
            </FormField>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowDepleteModal(false)}>Cancel</Button>
              <Button onClick={handleSaveDeplete} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white">{saving ? 'Saving...' : (editingDeplete ? 'Update Draft' : 'Save as Draft')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default InUseWarehousePage;
