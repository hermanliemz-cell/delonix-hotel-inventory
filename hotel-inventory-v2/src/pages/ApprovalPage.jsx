import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatDateSys } from '../utils/format';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { PageLoader } from '../components/PageLoader';

// Helper function to check period lock
async function checkPeriodLock(orgId, docDate) {
  const date = new Date(docDate);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  const { data } = await supabase.from('period_locks')
    .select('id')
    .eq('organization_id', orgId)
    .eq('month', month)
    .eq('year', year)
    .single();
  return { locked: !!data, month, year };
}

function ApprovalPage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [tab, setTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [pendingItems, setPendingItems] = useState([]);
  const [approvedItems, setApprovedItems] = useState([]);
  const [historyItems, setHistoryItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [detailModal, setDetailModal] = useState(null);
  const [detailItems, setDetailItems] = useState([]);

  const userRole = currentUser?.role?.code || '';

  function getUserName(userId) {
    const u = users.find(u => u.id === userId);
    return u ? u.full_name || u.username : '-';
  }

  async function loadAll() {
    if (!selectedOrg) return;
    setLoading(true);
    const [prRes, poRes, piRes, woRes, opnRes, dpRes, prAppRes, poAppRes, piAppRes, dpAppRes, woAppRes, usersRes, logRes] = await Promise.all([
      supabase.from('purchase_requests').select('*').eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      supabase.from('purchase_orders').select('*, created_by, vendors(name)').eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      supabase.from('purchase_invoices').select('*, created_by, vendors(name)').eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      supabase.from('write_offs').select('*, requested_by, departments(name)').eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      supabase.from('stock_opname').select('*, created_by').eq('organization_id', selectedOrg.id).eq('status', 'SUBMITTED'),
      supabase.from('direct_purchases').select('*, created_by').eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      // Query APPROVED documents for revoke
      supabase.from('purchase_requests').select('*').eq('organization_id', selectedOrg.id).eq('status', 'APPROVED'),
      supabase.from('purchase_orders').select('*, created_by, vendors(name)').eq('organization_id', selectedOrg.id).eq('status', 'APPROVED'),
      supabase.from('purchase_invoices').select('*, created_by, vendors(name)').eq('organization_id', selectedOrg.id).eq('status', 'APPROVED'),
      supabase.from('direct_purchases').select('*, created_by').eq('organization_id', selectedOrg.id).in('status', ['APPROVED', 'CONFIRMED']),
      supabase.from('write_offs').select('*, requested_by, departments(name)').eq('organization_id', selectedOrg.id).eq('status', 'APPROVED'),
      supabase.from('users').select('id, username, full_name, role_id, roles:role_id(code)').eq('is_active', true),
      supabase.from('approval_logs').select('*, users:action_by(full_name)').eq('organization_id', selectedOrg.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const pending = [];
    (prRes.data || []).forEach(r => pending.push({ ...r, created_by: r.requested_by, _type: 'PR', _number: r.pr_number, _date: r.request_date, _desc: r.notes || '-' }));
    (poRes.data || []).forEach(r => pending.push({ ...r, _type: 'PO', _number: r.po_number, _date: r.order_date, _desc: r.vendors?.name || '-' }));
    (piRes.data || []).forEach(r => pending.push({ ...r, _type: 'PI', _number: r.pi_number, _date: r.invoice_date, _desc: r.vendors?.name || '-' }));
    (woRes.data || []).forEach(r => pending.push({ ...r, _type: 'WRITEOFF', _number: r.wo_number, _date: r.write_off_date, _desc: r.departments?.name || r.reason || '-' }));
    (opnRes.data || []).forEach(r => pending.push({ ...r, _type: 'STOCK_OPNAME', _number: r.opname_number, _date: r.opname_date, _desc: 'Stock Opname' }));
    (dpRes.data || []).forEach(r => pending.push({ ...r, _type: 'DIRECT_PURCHASE', _number: r.purchase_number, _date: r.purchase_date, _desc: r.purchase_location || '-' }));
    pending.sort((a, b) => new Date(b._date) - new Date(a._date));
    setPendingItems(pending);
    // Approved items for revoke
    const allUsrs = usersRes.data || [];
    const getApproverName = (id) => { const u = allUsrs.find(x => x.id === id); return u ? (u.full_name || u.username) : '-'; };
    const approved = [];
    (prAppRes.data || []).forEach(r => approved.push({ ...r, created_by: r.requested_by, _type: 'PR', _number: r.pr_number, _date: r.request_date, _desc: r.notes || '-', _approver: getApproverName(r.approved_by) }));
    (poAppRes.data || []).forEach(r => approved.push({ ...r, _type: 'PO', _number: r.po_number, _date: r.order_date, _desc: r.vendors?.name || '-', _approver: getApproverName(r.approved_by) }));
    (piAppRes.data || []).forEach(r => approved.push({ ...r, _type: 'PI', _number: r.pi_number, _date: r.invoice_date, _desc: r.vendors?.name || '-', _approver: getApproverName(r.approved_by) }));
    (dpAppRes.data || []).forEach(r => approved.push({ ...r, _type: 'DIRECT_PURCHASE', _number: r.purchase_number, _date: r.purchase_date, _desc: r.purchase_location || '-', _approver: getApproverName(r.approved_by) }));
    (woAppRes.data || []).forEach(r => approved.push({ ...r, _type: 'WRITEOFF', _number: r.wo_number, _date: r.write_off_date, _desc: r.departments?.name || '-', _approver: getApproverName(r.approved_by) }));
    approved.sort((a, b) => new Date(b.approved_at || b._date) - new Date(a.approved_at || a._date));
    setApprovedItems(approved);
    setUsers(usersRes.data || []);
    setHistoryItems(logRes.data || []);
    setLoading(false);
  }

  React.useEffect(() => { loadAll(); }, [selectedOrg?.id]);

  function canApprove(item) {
    if (userRole === 'superadmin' || userRole === 'gm') return true;
    if (userRole === 'findir' && (item._type === 'WRITEOFF' || item._type === 'STOCK_OPNAME')) return true;
    return false;
  }

  function canRevoke(item) {
    // Only GM and Superadmin can revoke
    if (userRole !== 'superadmin' && userRole !== 'gm') return false;
    // Superadmin dan GM boleh revoke dokumen sendiri
    // Can revoke PR, PO, PI, DIRECT_PURCHASE, Write-Off, and Stock Opname
    if (['PR', 'PO', 'PI', 'DIRECT_PURCHASE', 'WRITEOFF', 'STOCK_OPNAME'].includes(item._type)) return true;
    return false;
  }

  async function handleApprove(item) {
    if (!(await showConfirm(t('approval.confirmApprove'), { variant: 'warning' }))) return;

    // Check period lock based on document date
    const docDate = item._date || new Date().toISOString();
    const lockCheck = await checkPeriodLock(selectedOrg.id, docDate);
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot approve document in locked period.', 'error');
      return;
    }

    const now = new Date().toISOString();
    let tableName, upd;

    if (item._type === 'STOCK_OPNAME') {
      // Dual approval for stock opname only
      tableName = 'stock_opname';
      if (userRole === 'superadmin') {
        if (!item.gm_approved_by && !item.findir_approved_by) {
          upd = { gm_approved_by: currentUser?.id, gm_approved_at: now };
        } else if (item.gm_approved_by && !item.findir_approved_by) {
          upd = { status: 'APPROVED', findir_approved_by: currentUser?.id, findir_approved_at: now };
        } else if (!item.gm_approved_by && item.findir_approved_by) {
          upd = { status: 'APPROVED', gm_approved_by: currentUser?.id, gm_approved_at: now };
        }
      } else if (userRole === 'gm') {
        if (item.findir_approved_by) {
          upd = { status: 'APPROVED', gm_approved_by: currentUser?.id, gm_approved_at: now };
        } else {
          upd = { gm_approved_by: currentUser?.id, gm_approved_at: now };
        }
      } else if (userRole === 'findir') {
        if (item.gm_approved_by) {
          upd = { status: 'APPROVED', findir_approved_by: currentUser?.id, findir_approved_at: now };
        } else {
          upd = { findir_approved_by: currentUser?.id, findir_approved_at: now };
        }
      }
    } else if (item._type === 'WRITEOFF') {
      // Single approval for write-off — approve & deduct stock
      tableName = 'write_offs';
      upd = { status: 'APPROVED', approved_by: currentUser?.id, approved_at: now };
      const { error: woErr } = await supabase.from(tableName).update(upd).eq('id', item.id);
      if (woErr) { showNotification('Error: ' + woErr.message, 'error'); return; }
      // Deduct stock
      try {
        const { data: woItems } = await supabase.from('write_off_items').select('*').eq('wo_id', item.id);
        for (const wi of (woItems || [])) {
          const qty = parseFloat(wi.quantity);
          if (qty <= 0) continue;
          // Find stock balance for this item (any warehouse with stock)
          const { data: sbData } = await supabase.from('stock_balance')
            .select('id, quantity, total_value, warehouse_id')
            .eq('item_id', wi.item_id).eq('organization_id', selectedOrg.id)
            .gt('quantity', 0).order('quantity', { ascending: false }).limit(1);
          if (sbData && sbData.length > 0) {
            const sb = sbData[0];
            const newQty = parseFloat(sb.quantity) - qty;
            const avgCost = parseFloat(sb.total_value) / parseFloat(sb.quantity) || 0;
            const newTotalValue = newQty > 0 ? newQty * avgCost : 0;
            await supabase.from('stock_balance').update({
              quantity: newQty, total_value: newTotalValue,
              avg_cost: newQty > 0 ? avgCost : 0,
              updated_at: now,
            }).eq('id', sb.id);
            // Create stock movement
            await supabase.from('stock_movements').insert({
              organization_id: selectedOrg.id, item_id: wi.item_id,
              warehouse_id: sb.warehouse_id, movement_type: 'OUT',
              quantity: qty, unit_cost: avgCost, total_cost: qty * avgCost,
              reference_type: 'WRITEOFF', reference_number: item._number,
              department_id: item.department_id || null,
              notes: wi.notes || 'Write-off',
              created_by: currentUser?.id,
            });
          }
        }
      } catch (e) { }
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
        document_number: item._number, action: 'APPROVED', action_by: currentUser?.id,
      });
      showNotification(item._number + ' approved — stock dikurangi', 'success');
      loadAll();
      return;
    } else {
      // Single approval for PR, PO, PI, DIRECT_PURCHASE (GM only)
      tableName = item._type === 'PR' ? 'purchase_requests' : item._type === 'PO' ? 'purchase_orders' : item._type === 'DIRECT_PURCHASE' ? 'direct_purchases' : 'purchase_invoices';
      upd = { status: 'APPROVED', approved_by: currentUser?.id, approved_at: now };
    }

    const { error } = await supabase.from(tableName).update(upd).eq('id', item.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); return; }

    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
      document_number: item._number, action: 'APPROVED', action_by: currentUser?.id,
      approval_level: (item._type === 'WRITEOFF' && userRole === 'findir') ? 2 : 1,
    });
    showNotification(item._number + ' approved', 'success');
    loadAll();
  }

  async function handleReject(item) {
    setRejectModal(item);
    setRejectNotes('');
  }

  async function confirmReject() {
    const item = rejectModal;
    if (!item) return;
    const now = new Date().toISOString();
    const tableName = item._type === 'PR' ? 'purchase_requests' : item._type === 'PO' ? 'purchase_orders' : item._type === 'PI' ? 'purchase_invoices' : item._type === 'DIRECT_PURCHASE' ? 'direct_purchases' : item._type === 'STOCK_OPNAME' ? 'stock_opname' : 'write_offs';
    const upd = { status: 'REJECTED', rejected_by: currentUser?.id, rejected_at: now, rejection_notes: rejectNotes || null };
    const { error } = await supabase.from(tableName).update(upd).eq('id', item.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); return; }

    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
      document_number: item._number, action: 'REJECTED', action_by: currentUser?.id,
      notes: rejectNotes || null,
    });
    showNotification(item._number + ' rejected', 'error');
    setRejectModal(null);
    loadAll();
  }

  async function handleRevertToDraft(item) {
    // Check period lock based on document date
    const docDate = item._date || new Date().toISOString();
    const lockCheck = await checkPeriodLock(selectedOrg.id, docDate);
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot revert in locked period.', 'error');
      return;
    }

    // Proteksi: PI tidak bisa di-revert jika masih ada GR CONFIRMED terkait
    if (item._type === 'PI') {
      const { data: activeGRs } = await supabase.from('purchase_received')
        .select('id, gr_number, status')
        .eq('pi_id', item.id)
        .in('status', ['CONFIRMED', 'DRAFT']);
      const confirmedGRs = (activeGRs || []).filter(g => g.status === 'CONFIRMED');
      if (confirmedGRs.length > 0) {
        const grNumbers = confirmedGRs.map(g => g.gr_number).join(', ');
        showNotification(`Tidak bisa revert ${item._number}. Masih ada ${confirmedGRs.length} GR yang CONFIRMED: ${grNumbers}. Revoke semua GR terlebih dahulu.`, 'error');
        return;
      }
    }

    if (!(await showConfirm(`Revert ${item._number} to draft?`, { variant: 'warning' }))) return;
    const now = new Date().toISOString();
    const tableName = item._type === 'PR' ? 'purchase_requests' : item._type === 'PO' ? 'purchase_orders' : item._type === 'PI' ? 'purchase_invoices' : item._type === 'DIRECT_PURCHASE' ? 'direct_purchases' : item._type === 'STOCK_OPNAME' ? 'stock_opname' : 'write_offs';
    const upd = { status: 'DRAFT' };

    const { error } = await supabase.from(tableName).update(upd).eq('id', item.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); return; }

    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
      document_number: item._number, action: 'REVERTED_TO_DRAFT', action_by: currentUser?.id,
    });
    showNotification(item._number + ' reverted to draft', 'success');
    loadAll();
  }

  async function handleRevokeApproval(item) {
    // Check period lock based on document date
    const docDate = item._date || new Date().toISOString();
    const lockCheck = await checkPeriodLock(selectedOrg.id, docDate);
    if (lockCheck.locked) {
      showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + '). Cannot revoke in locked period.', 'error');
      return;
    }

    // Proteksi: PI tidak bisa di-revoke jika masih ada GR CONFIRMED terkait
    if (item._type === 'PI') {
      const { data: activeGRs } = await supabase.from('purchase_received')
        .select('id, gr_number, status')
        .eq('pi_id', item.id)
        .in('status', ['CONFIRMED', 'DRAFT']);
      const confirmedGRs = (activeGRs || []).filter(g => g.status === 'CONFIRMED');
      if (confirmedGRs.length > 0) {
        const grNumbers = confirmedGRs.map(g => g.gr_number).join(', ');
        showNotification(`Tidak bisa revoke ${item._number}. Masih ada ${confirmedGRs.length} GR yang CONFIRMED: ${grNumbers}. Revoke semua GR terlebih dahulu.`, 'error');
        return;
      }
    }

    // DIRECT_PURCHASE CONFIRMED → reverse stock then revert to APPROVED
    if (item._type === 'DIRECT_PURCHASE' && item.status === 'CONFIRMED') {
      if (!(await showConfirm(`Revoke ${item._number}? Stok akan dikembalikan.`, { variant: 'danger' }))) return;
      try {
        // Load DP items
        const { data: dpItems } = await supabase.from('direct_purchase_items').select('*').eq('direct_purchase_id', item.id);
        for (const di of (dpItems || [])) {
          const qty = parseFloat(di.quantity);
          if (qty <= 0) continue;
          const { data: stockData } = await supabase.from('stock_balance')
            .select('id, quantity, total_value')
            .eq('item_id', di.item_id).eq('warehouse_id', di.warehouse_id).single();
          if (stockData) {
            const newQty = parseFloat(stockData.quantity) - qty;
            const unitPrice = parseFloat(di.unit_price) || 0;
            const newTotalValue = parseFloat(stockData.total_value) - (qty * unitPrice);
            await supabase.from('stock_balance').update({
              quantity: newQty, total_value: newTotalValue,
              avg_cost: newQty > 0 ? newTotalValue / newQty : 0,
              updated_at: new Date().toISOString(),
            }).eq('id', stockData.id);
          }
          await supabase.from('stock_movements').delete()
            .eq('reference_type', 'DIRECT_PURCHASE')
            .eq('reference_number', item._number)
            .eq('item_id', di.item_id);
        }
        await supabase.from('direct_purchases').update({
          status: 'APPROVED', confirmed_by: null, confirmed_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', item.id);
        await supabase.from('approval_logs').insert({
          organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
          document_number: item._number, action: 'REVOKE_CONFIRMED', action_by: currentUser?.id,
        });
        showNotification(item._number + ' revoked — stok dikembalikan', 'success');
        loadAll();
        return;
      } catch (e) { showNotification('Error: ' + e.message, 'error'); return; }
    }

    // DIRECT_PURCHASE APPROVED → revert to PENDING
    if (item._type === 'DIRECT_PURCHASE' && item.status === 'APPROVED') {
      if (!(await showConfirm(`Revoke approval for ${item._number}? Dokumen kembali ke PENDING.`, { variant: 'danger' }))) return;
      const { error } = await supabase.from('direct_purchases').update({
        status: 'PENDING', approved_by: null, approved_at: null, updated_at: new Date().toISOString(),
      }).eq('id', item.id);
      if (error) { showNotification('Error: ' + error.message, 'error'); return; }
      await supabase.from('approval_logs').insert({
        organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
        document_number: item._number, action: 'REVOKE_APPROVAL', action_by: currentUser?.id,
      });
      showNotification(item._number + ' approval revoked', 'success');
      loadAll();
      return;
    }

    // WRITEOFF APPROVED → reverse stock & revert to PENDING
    if (item._type === 'WRITEOFF' && item.status === 'APPROVED') {
      if (!(await showConfirm(`Revoke ${item._number}? Stok akan dikembalikan.`, { variant: 'danger' }))) return;
      try {
        const { data: woItems } = await supabase.from('write_off_items').select('*').eq('wo_id', item.id);
        for (const wi of (woItems || [])) {
          const qty = parseFloat(wi.quantity);
          if (qty <= 0) continue;
          // Find stock movement to get warehouse_id
          const { data: mvData } = await supabase.from('stock_movements')
            .select('warehouse_id, unit_cost')
            .eq('reference_type', 'WRITEOFF').eq('reference_number', item._number)
            .eq('item_id', wi.item_id).limit(1);
          const warehouseId = mvData?.[0]?.warehouse_id;
          const unitCost = mvData?.[0]?.unit_cost || 0;
          if (warehouseId) {
            const { data: sbData } = await supabase.from('stock_balance')
              .select('id, quantity, total_value')
              .eq('item_id', wi.item_id).eq('warehouse_id', warehouseId).single();
            if (sbData) {
              const newQty = parseFloat(sbData.quantity) + qty;
              const newTotalValue = parseFloat(sbData.total_value) + (qty * unitCost);
              await supabase.from('stock_balance').update({
                quantity: newQty, total_value: newTotalValue,
                avg_cost: newQty > 0 ? newTotalValue / newQty : 0,
                updated_at: new Date().toISOString(),
              }).eq('id', sbData.id);
            }
          }
          await supabase.from('stock_movements').delete()
            .eq('reference_type', 'WRITEOFF').eq('reference_number', item._number)
            .eq('item_id', wi.item_id);
        }
        await supabase.from('write_offs').update({
          status: 'PENDING', approved_by: null, approved_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', item.id);
        await supabase.from('approval_logs').insert({
          organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
          document_number: item._number, action: 'REVOKE_APPROVAL', action_by: currentUser?.id,
        });
        showNotification(item._number + ' revoked — stok dikembalikan', 'success');
        loadAll();
        return;
      } catch (e) { showNotification('Error: ' + e.message, 'error'); return; }
    }

    // PR, PO, PI standard revoke
    if (!(await showConfirm(`Revoke approval for ${item._number}? Document will return to pending status.`, { variant: 'danger' }))) return;
    const now = new Date().toISOString();
    const tableName = item._type === 'PR' ? 'purchase_requests' : item._type === 'PO' ? 'purchase_orders' : 'purchase_invoices';
    const upd = { status: 'PENDING', approved_by: null, approved_at: null };

    const { error } = await supabase.from(tableName).update(upd).eq('id', item.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); return; }

    await supabase.from('approval_logs').insert({
      organization_id: selectedOrg.id, document_type: item._type, document_id: item.id,
      document_number: item._number, action: 'REVOKE_APPROVAL', action_by: currentUser?.id,
    });
    showNotification(item._number + ' approval revoked', 'success');
    loadAll();
  }

  async function handleViewDetail(item) {
    setDetailModal(item);
    // Load detail items based on type
    const typeMap = {
      'PR': { table: 'purchase_request_items', fk: 'pr_id' },
      'PO': { table: 'purchase_order_items', fk: 'po_id' },
      'PI': { table: 'purchase_invoice_items', fk: 'pi_id' },
      'DIRECT_PURCHASE': { table: 'direct_purchase_items', fk: 'direct_purchase_id' },
      'WRITEOFF': { table: 'write_off_items', fk: 'wo_id' },
      'STOCK_OPNAME': { table: 'stock_opname_items', fk: 'opname_id' },
    };
    const cfg = typeMap[item._type];
    if (!cfg) { setDetailItems([]); return; }
    const { data, error } = await supabase.from(cfg.table).select('*').eq(cfg.fk, item.id);
    if (error) { setDetailItems([]); return; }
    // Enrich with master_items data
    const items = data || [];
    if (items.length > 0) {
      const itemIds = items.map(i => i.item_id).filter(Boolean);
      if (itemIds.length > 0) {
        const { data: masterData } = await supabase.from('items').select('id, code, name, unit_id, units:units!items_unit_id_fkey(abbreviation)').in('id', itemIds);
        const masterMap = {};
        (masterData || []).forEach(m => { masterMap[m.id] = { ...m, sku: m.code, unit: m.units?.abbreviation || '-' }; });
        items.forEach(i => { i.master_items = masterMap[i.item_id] || null; });
      }
    }
    setDetailItems(items);
  }

  const typeColors = { PR: 'blue', PO: 'purple', PI: 'orange', DIRECT_PURCHASE: 'green', WRITEOFF: 'red', STOCK_OPNAME: 'green' };

  return (
    <div>
      <PageHeader title={t('approval.pageTitle')} subtitle={t('approval.pageSubtitle')} />

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('pending')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'pending' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {t('approval.pending')} {pendingItems.length > 0 && <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{pendingItems.length}</span>}
        </button>
        <button onClick={() => setTab('approved')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'approved' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          Approved {approvedItems.length > 0 && <span className="ml-1 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5">{approvedItems.length}</span>}
        </button>
        <button onClick={() => setTab('history')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'history' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          {t('approval.history')}
        </button>
      </div>

      {tab === 'pending' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          {loading ? <PageLoader /> : pendingItems.length === 0 ? (
            <div className="p-12 text-center text-gray-400"><Icons.Shield /><p className="mt-2">{t('approval.noPending')}</p></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendingItems.map(item => (
                <div key={item._type + '-' + item.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge color={typeColors[item._type]}>{item._type}</Badge>
                      <span className="font-mono text-sm font-semibold text-gray-900">{item._number}</span>
                      <span className="text-sm text-gray-500">{formatDateSys(item._date)}</span>
                      <span className="text-sm text-gray-400">{item._desc}</span>
                      {(item._type === 'WRITEOFF' || item._type === 'STOCK_OPNAME') && (
                        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                          {item.gm_approved_by && !item.findir_approved_by ? t('approval.waitingFinDir') :
                           !item.gm_approved_by && item.findir_approved_by ? t('approval.waitingGM') :
                           t('approval.waitingBoth')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {item.submitted_by && <span className="text-xs text-gray-400">{t('approval.submittedBy')}: {getUserName(item.submitted_by)}</span>}
                      <button onClick={() => handleViewDetail(item)} className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
                          <Icons.Eye /> Detail
                        </button>
                      {canRevoke(item) && (
                        <button onClick={() => handleRevertToDraft(item)} className="px-3 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition-colors">
                          <Icons.RotateCcw /> Revert to Draft
                        </button>
                      )}
                      {canApprove(item) && (
                        <>
                          <button onClick={() => handleApprove(item)} className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors">
                            <Icons.Check /> {t('approval.approve')}
                          </button>
                          <button onClick={() => handleReject(item)} className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors">
                            <Icons.X /> {t('approval.reject')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'approved' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          {loading ? <PageLoader /> : approvedItems.length === 0 ? (
            <div className="p-12 text-center text-gray-400"><Icons.Check /><p className="mt-2">No approved documents</p></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {approvedItems.map(item => (
                <div key={item._type + '-' + item.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge color={typeColors[item._type]}>{item._type}</Badge>
                      <span className="font-mono text-sm font-semibold text-gray-900">{item._number}</span>
                      <span className="text-sm text-gray-500">{formatDateSys(item._date)}</span>
                      <span className="text-sm text-gray-400">{item._desc}</span>
                      <Badge color={item.status === 'CONFIRMED' ? 'blue' : 'green'}>{item.status === 'CONFIRMED' ? (item._type === 'DIRECT_PURCHASE' ? 'Received' : 'Confirmed') : 'Approved'}</Badge>
                      {item._approver && <span className="text-xs text-gray-400">by {item._approver}</span>}
                      {item.approved_at && <span className="text-xs text-gray-400">{formatDateSys(item.approved_at)}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleViewDetail(item)} className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
                        <Icons.Eye /> Detail
                      </button>
                      {canRevoke(item) && (
                        <button onClick={() => handleRevokeApproval(item)} className={"px-3 py-1.5 text-xs font-medium rounded-lg transition-colors " + (item.status === 'CONFIRMED' ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-orange-50 text-orange-700 hover:bg-orange-100')}>
                          <Icons.RotateCcw /> {item.status === 'CONFIRMED' ? (item._type === 'DIRECT_PURCHASE' ? 'Revoke Received' : 'Revoke Confirm') : 'Revoke Approval'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          {loading ? <PageLoader /> : historyItems.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No approval history</div>
          ) : (
            <DataTable loading={false}
              columns={[
                { header: 'Type', render: r => <Badge color={typeColors[r.document_type] || 'gray'}>{r.document_type}</Badge> },
                { header: 'Document', render: r => <span className="font-mono text-xs font-semibold">{r.document_number}</span> },
                { header: 'Action', render: r => (
                  <Badge color={r.action === 'APPROVED' ? 'green' : r.action === 'REJECTED' ? 'red' : r.action === 'REVOKE_APPROVAL' ? 'orange' : 'blue'}>{r.action}</Badge>
                )},
                { header: 'By', render: r => r.users?.full_name || '-' },
                { header: 'Date', render: r => formatDateSys(r.action_at, { includeTime: true }) },
                { header: 'Notes', render: r => r.notes || '-' },
                { header: 'Level', render: r => r.approval_level > 1 ? `Level ${r.approval_level}` : '-' },
              ]}
              data={historyItems}
            />
          )}
        </div>
      )}

      <Modal open={!!rejectModal} onClose={() => setRejectModal(null)} title={t('approval.reject') + ' ' + (rejectModal?._number || '')} size="sm">
        <FormField label={t('approval.rejectReason')}>
          <textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)} rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent" />
        </FormField>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={() => setRejectModal(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={confirmReject} className="bg-red-600 hover:bg-red-700">{t('approval.reject')}</Button>
        </div>
      </Modal>

      <Modal open={!!detailModal} onClose={() => { setDetailModal(null); setDetailItems([]); }} title={`Detail ${detailModal?._type || ''} - ${detailModal?._number || ''}`} size="lg">
        {detailModal && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div><span className="text-xs text-gray-500">Document No:</span><div className="font-mono font-semibold">{detailModal._number}</div></div>
              <div><span className="text-xs text-gray-500">Date:</span><div>{formatDateSys(detailModal._date)}</div></div>
              <div><span className="text-xs text-gray-500">Status:</span><div><Badge color={detailModal.status === 'APPROVED' ? 'green' : detailModal.status === 'PENDING' ? 'yellow' : 'gray'}>{detailModal.status}</Badge></div></div>
              {detailModal._type === 'PO' && detailModal.vendors && <div><span className="text-xs text-gray-500">Vendor:</span><div>{detailModal.vendors?.name || detailModal._desc}</div></div>}
              {detailModal._type === 'PI' && detailModal.vendors && <div><span className="text-xs text-gray-500">Vendor:</span><div>{detailModal.vendors?.name || detailModal._desc}</div></div>}
              {detailModal._type === 'PR' && <div><span className="text-xs text-gray-500">Notes:</span><div>{detailModal.notes || '-'}</div></div>}
              {detailModal._type === 'DIRECT_PURCHASE' && <div><span className="text-xs text-gray-500">Purchase Location:</span><div>{detailModal.purchase_location || '-'}</div></div>}
              {detailModal._type === 'DIRECT_PURCHASE' && <div><span className="text-xs text-gray-500">Grand Total:</span><div className="font-semibold">Rp {(detailModal.total_amount || 0).toLocaleString('id-ID')}</div></div>}
              {detailModal._type === 'WRITEOFF' && <div><span className="text-xs text-gray-500">Reason:</span><div>{detailModal.reason || detailModal.notes || '-'}</div></div>}
              {detailModal._type === 'STOCK_OPNAME' && <div><span className="text-xs text-gray-500">Warehouse:</span><div>{detailModal._desc || '-'}</div></div>}
              {detailModal.approved_by && <div><span className="text-xs text-gray-500">Approved by:</span><div>{getUserName(detailModal.approved_by)}</div></div>}
            </div>
            <div className="border-t pt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Items</h4>
              {detailItems.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-4">Loading items...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Item</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">SKU</th>
                    {detailModal._type === 'STOCK_OPNAME' ? (
                      <>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">System Qty</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Actual Qty</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Difference</th>
                      </>
                    ) : (
                      <>
                        <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Qty</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Unit</th>
                        {!['PR','WRITEOFF'].includes(detailModal._type) && <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Price</th>}
                        {!['PR','WRITEOFF'].includes(detailModal._type) && <th className="text-right px-3 py-2 text-xs font-medium text-gray-500">Total</th>}
                        {detailModal._type === 'WRITEOFF' && <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Notes</th>}
                      </>
                    )}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {detailItems.map((di, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{di.master_items?.name || di.item_name || '-'}</td>
                        <td className="px-3 py-2 text-gray-400">{di.master_items?.sku || '-'}</td>
                        {detailModal._type === 'STOCK_OPNAME' ? (
                          <>
                            <td className="px-3 py-2 text-right">{di.system_qty ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{di.actual_qty ?? '-'}</td>
                            <td className="px-3 py-2 text-right font-medium">{di.difference ?? ((di.actual_qty || 0) - (di.system_qty || 0))}</td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right">{di.quantity}</td>
                            <td className="px-3 py-2">{di.unit || di.master_items?.unit || '-'}</td>
                            {!['PR','WRITEOFF'].includes(detailModal._type) && <td className="px-3 py-2 text-right">{(di.unit_price || 0).toLocaleString('id-ID')}</td>}
                            {!['PR','WRITEOFF'].includes(detailModal._type) && <td className="px-3 py-2 text-right font-medium">{((di.quantity || 0) * (di.unit_price || 0)).toLocaleString('id-ID')}</td>}
                            {detailModal._type === 'WRITEOFF' && <td className="px-3 py-2 text-gray-400">{di.notes || '-'}</td>}
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ApprovalPage;
