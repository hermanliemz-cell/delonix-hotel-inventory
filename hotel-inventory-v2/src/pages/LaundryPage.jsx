import React, {useState, useEffect, useMemo, useRef} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatNumber, formatDate, formatDateSys } from '../utils/format';
import { checkPeriodLock } from '../utils/stock.js';
import { recordBatchTransfer } from '../services/stockService.js';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
import { Button } from '../components/FormElements';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

function LaundryPage() {
  const { t } = useTranslation();
  const { selectedOrg, currentUser, showNotification, showConfirm } = useApp();
  const [activeTab, setActiveTab] = useState('send');
  const [dirtyItems, setDirtyItems] = useState([]);
  const [laundryItems, setLaundryItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = React.useRef(false); // Synchronous guard against double-click
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [selectedItems, setSelectedItems] = useState({});
  const [history, setHistory] = useState([]);
  const [dirtyWarehouse, setDirtyWarehouse] = useState(null);
  const [laundryWarehouse, setLaundryWarehouse] = useState(null);
  const [storeWarehouse, setStoreWarehouse] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');

  useEffect(() => {
    if (selectedOrg) loadAll();
  }, [selectedOrg]);

  async function loadAll() {
    setLoading(true);
    try {
      // Load warehouses
      const { data: whData } = await supabase.from('warehouses')
        .select('*')
        .eq('organization_id', selectedOrg.id)
        .eq('is_active', true);

      setWarehouses(whData || []);

      if (whData && whData.length > 0) {
        const dirty = whData.find(w => w.warehouse_type === 'dirty');
        const laundry = whData.find(w => w.warehouse_type === 'laundry');
        const store = whData.find(w => w.warehouse_type === 'store' && w.code?.startsWith('HK'));

        setDirtyWarehouse(dirty);
        setLaundryWarehouse(laundry);
        setStoreWarehouse(store);

        // Load items in dirty warehouse
        if (dirty) {
          const { data: dirtyData } = await supabase.from('stock_balance')
            .select('*, items:item_id(id, code, name, brand, category_id, item_categories:category_id(id, name))')
            .eq('warehouse_id', dirty.id)
            .gt('quantity', 0);
          setDirtyItems(dirtyData || []);
        }

        // Load items in laundry warehouse
        if (laundry) {
          const { data: laundryData } = await supabase.from('stock_balance')
            .select('*, items:item_id(id, code, name, brand, category_id, item_categories:category_id(id, name))')
            .eq('warehouse_id', laundry.id)
            .gt('quantity', 0);
          setLaundryItems(laundryData || []);
        }
      }

      // Load categories
      const { data: catData } = await supabase.from('item_categories')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setCategories(catData || []);

      // Load vendors for laundry
      const { data: vendorData } = await supabase.from('vendors')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      setVendors(vendorData || []);

      // Load history — only OUT movements to avoid duplicate rows (each send/receive creates OUT + IN pair)
      const { data: histData } = await supabase.from('stock_movements')
        .select('*, items:item_id(code, name, category_id, item_categories:category_id(id, name)), warehouses:warehouse_id(code, name), vendors:vendor_id(id, code, name), users:created_by(id, full_name, department_id, departments:department_id(name))')
        .eq('organization_id', selectedOrg.id)
        .in('reference_type', ['LAUNDRY_SEND', 'LAUNDRY_RECEIVE'])
        .eq('movement_type', 'OUT')
        .order('created_at', { ascending: false })
        .limit(2000);
      // Group history by reference_number: 1 row per document
      const grouped = {};
      (histData || []).forEach(rec => {
        const key = rec.reference_number;
        if (!grouped[key]) {
          grouped[key] = { reference_number: key, reference_type: rec.reference_type, created_at: rec.created_at, total_qty: 0, item_count: 0, vendors: rec.vendors, users: rec.users };
        }
        grouped[key].total_qty += parseFloat(rec.quantity) || 0;
        grouped[key].item_count += 1;
      });
      setHistory(Object.values(grouped));
    } catch (e) {
      showNotification('Error loading laundry data: ' + e.message, 'error');
    }
    setLoading(false);
  }

  async function generateSendNumber() {
    const code = selectedOrg.code || 'ORG';
    const prefix = `LS-${code}-`;
    const { data } = await supabase.from('stock_movements')
      .select('reference_number')
      .eq('organization_id', selectedOrg.id)
      .eq('reference_type', 'LAUNDRY_SEND')
      .eq('movement_type', 'OUT')
      .like('reference_number', `${prefix}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    let maxNum = 0;
    if (data && data.length > 0) {
      const seen = new Set();
      data.forEach(d => {
        if (!seen.has(d.reference_number)) {
          seen.add(d.reference_number);
          const num = parseInt(d.reference_number.split('-').pop()) || 0;
          if (num > maxNum) maxNum = num;
        }
      });
    }
    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
  }

  async function generateReceiveNumber() {
    const code = selectedOrg.code || 'ORG';
    const prefix = `LR-${code}-`;
    const { data } = await supabase.from('stock_movements')
      .select('reference_number')
      .eq('organization_id', selectedOrg.id)
      .eq('reference_type', 'LAUNDRY_RECEIVE')
      .eq('movement_type', 'OUT')
      .like('reference_number', `${prefix}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    let maxNum = 0;
    if (data && data.length > 0) {
      const seen = new Set();
      data.forEach(d => {
        if (!seen.has(d.reference_number)) {
          seen.add(d.reference_number);
          const num = parseInt(d.reference_number.split('-').pop()) || 0;
          if (num > maxNum) maxNum = num;
        }
      });
    }
    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
  }

  async function handleSendToLaundry() {
    if (savingRef.current) { showNotification('Proses sedang berjalan, harap tunggu...', 'warning'); return; }
    // Validate vendor selection
    if (!selectedVendor) {
      showNotification('Pilih vendor laundry terlebih dahulu!', 'error');
      return;
    }

    const itemsToSend = Object.entries(selectedItems)
      .filter(([_, val]) => val && parseFloat(val.qty) > 0)
      .map(([itemId, val]) => ({ item_id: itemId, qty: parseFloat(val.qty), notes: val.notes || '' }));

    if (itemsToSend.length === 0) {
      showNotification(t('common.selectAtLeastOne') || 'Please select at least one item', 'error');
      return;
    }

    // === VALIDASI QTY: cek apakah qty melebihi stok yang tersedia ===
    const overStockItems = [];
    for (const item of itemsToSend) {
      const stockItem = dirtyItems.find(di => di.item_id === item.item_id);
      if (!stockItem) {
        overStockItems.push({ code: item.item_id, requested: item.qty, available: 0 });
        continue;
      }
      if (item.qty > stockItem.quantity) {
        overStockItems.push({
          code: stockItem.items?.code || item.item_id,
          requested: item.qty,
          available: stockItem.quantity,
        });
      }
    }
    if (overStockItems.length > 0) {
      const detail = overStockItems.map(o => `${o.code}: minta ${o.requested}, tersedia ${o.available}`).join('\n');
      showNotification('Qty melebihi stok tersedia:\n' + detail, 'error');
      return;
    }

    // === KONFIRMASI DETAIL sebelum proses ===
    const summaryLines = itemsToSend.map(item => {
      const si = dirtyItems.find(di => di.item_id === item.item_id);
      return `${si?.items?.code || '?'} — ${si?.items?.name || '?'}: ${item.qty}`;
    });
    if (!(await showConfirm(
      'Kirim ' + itemsToSend.length + ' item ke laundry?\n\n' + summaryLines.join('\n'),
      { variant: 'warning' }
    ))) return;

    savingRef.current = true;
    setSaving(true);
    try {
      // Check period lock
      const lockCheck = await checkPeriodLock(selectedOrg.id, new Date().toISOString());
      if (lockCheck.locked) {
        showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
        savingRef.current = false;
        setSaving(false);
        return;
      }

      const deptId = currentUser?.department_id || null;
      const refNumber = await generateSendNumber();

      // === BATCH TRANSFER: semua items dalam 1 transaksi ===
      // Jika 1 item gagal (misal stok tidak cukup), SEMUA rollback — tidak ada partial commit.
      const { error: batchErr } = await recordBatchTransfer({
        organizationId: selectedOrg.id,
        sourceWarehouseId: dirtyWarehouse.id,
        destWarehouseId: laundryWarehouse.id,
        referenceType: 'LAUNDRY_SEND',
        referenceNumber: refNumber,
        departmentId: deptId,
        vendorId: selectedVendor,
        items: itemsToSend.map(item => ({
          item_id: item.item_id,
          quantity: item.qty,
          notes: item.notes,
        })),
      });
      if (batchErr) throw batchErr;

      showNotification('Items sent to laundry successfully (Ref: ' + refNumber + ')', 'success');

      // === ANTI-DUPLIKAT: clear selection DAN disable saving sampai loadAll selesai ===
      setSelectedItems({});
      await loadAll();
    } catch (e) {
      // Batch transfer atomic: jika gagal, tidak ada yang tersimpan.
      showNotification('Gagal kirim ke laundry: ' + e.message, 'error');
    }
    savingRef.current = false;
    setSaving(false);
  }

  async function handleReceiveFromLaundry() {
    if (savingRef.current) { showNotification('Proses sedang berjalan, harap tunggu...', 'warning'); return; }
    // Validate vendor selection
    if (!selectedVendor) {
      showNotification('Pilih vendor laundry terlebih dahulu!', 'error');
      return;
    }

    // Gunakan vendorLaundryItems untuk receive (sudah difilter per vendor)
    const sourceItems = vendorLaundryItems.length > 0 ? vendorLaundryItems : laundryItems;

    const itemsToReceive = Object.entries(selectedItems)
      .filter(([_, val]) => val && parseFloat(val.qty) > 0)
      .map(([itemId, val]) => ({ item_id: itemId, qty: parseFloat(val.qty), notes: val.notes || '' }));

    if (itemsToReceive.length === 0) {
      showNotification(t('common.selectAtLeastOne') || 'Please select at least one item', 'error');
      return;
    }

    // === VALIDASI QTY: cek apakah qty melebihi stok yang tersedia di laundry ===
    const overStockItems = [];
    for (const item of itemsToReceive) {
      const stockItem = sourceItems.find(li => li.item_id === item.item_id);
      if (!stockItem) {
        overStockItems.push({ code: item.item_id, requested: item.qty, available: 0 });
        continue;
      }
      if (item.qty > stockItem.quantity) {
        overStockItems.push({
          code: stockItem.items?.code || item.item_id,
          requested: item.qty,
          available: stockItem.quantity,
        });
      }
    }
    if (overStockItems.length > 0) {
      const detail = overStockItems.map(o => `${o.code}: minta ${o.requested}, tersedia ${o.available}`).join('\n');
      showNotification('Qty melebihi stok tersedia di laundry:\n' + detail, 'error');
      return;
    }

    // === KONFIRMASI DETAIL sebelum proses ===
    const summaryLines = itemsToReceive.map(item => {
      const si = sourceItems.find(li => li.item_id === item.item_id);
      return `${si?.items?.code || '?'} — ${si?.items?.name || '?'}: ${item.qty}`;
    });
    if (!(await showConfirm(
      'Terima ' + itemsToReceive.length + ' item dari laundry?\n\n' + summaryLines.join('\n'),
      { variant: 'warning' }
    ))) return;

    savingRef.current = true;
    setSaving(true);
    try {
      // Check period lock
      const lockCheck = await checkPeriodLock(selectedOrg.id, new Date().toISOString());
      if (lockCheck.locked) {
        showNotification('Period is locked (' + lockCheck.month + '/' + lockCheck.year + ')', 'error');
        savingRef.current = false;
        setSaving(false);
        return;
      }

      const deptId = currentUser?.department_id || null;
      const refNumber = await generateReceiveNumber();

      // === BATCH TRANSFER: semua items dalam 1 transaksi ===
      // Jika 1 item gagal, SEMUA rollback — tidak ada partial commit.
      const { error: batchErr } = await recordBatchTransfer({
        organizationId: selectedOrg.id,
        sourceWarehouseId: laundryWarehouse.id,
        destWarehouseId: storeWarehouse.id,
        referenceType: 'LAUNDRY_RECEIVE',
        referenceNumber: refNumber,
        departmentId: deptId,
        vendorId: selectedVendor,
        items: itemsToReceive.map(item => ({
          item_id: item.item_id,
          quantity: item.qty,
          notes: item.notes,
        })),
      });
      if (batchErr) throw batchErr;

      showNotification('Items received from laundry successfully (Ref: ' + refNumber + ')', 'success');

      // === ANTI-DUPLIKAT: clear selection DAN disable saving sampai loadAll selesai ===
      setSelectedItems({});
      await loadAll();
    } catch (e) {
      // Batch transfer atomic: jika gagal, tidak ada yang tersimpan.
      showNotification('Gagal terima dari laundry: ' + e.message, 'error');
    }
    savingRef.current = false;
    setSaving(false);
  }

  // For receive tab: load vendor-specific laundry items
  const [vendorLaundryItems, setVendorLaundryItems] = React.useState([]);
  const [loadingVendorItems, setLoadingVendorItems] = React.useState(false);

  React.useEffect(() => {
    if (activeTab === 'receive' && selectedVendor && laundryWarehouse) {
      loadVendorLaundryItems();
    } else if (activeTab === 'receive' && !selectedVendor) {
      setVendorLaundryItems([]);
    }
  }, [activeTab, selectedVendor, laundryWarehouse?.id]);

  // Default vendor for legacy (untracked) laundry items
  const BONVIVO_VENDOR_ID = '27a3bed2-7ff6-48f6-b579-e999def3dcfc';

  async function loadVendorLaundryItems() {
    setLoadingVendorItems(true);
    try {
      // 1. Get ALL items currently in laundry warehouse
      const { data: allLaundryItems } = await supabase.from('stock_balance')
        .select('*, items:item_id(id, code, name, brand, category_id, item_categories:category_id(id, name))')
        .eq('warehouse_id', laundryWarehouse.id)
        .gt('quantity', 0);

      if (!allLaundryItems || allLaundryItems.length === 0) {
        setVendorLaundryItems([]);
        setLoadingVendorItems(false);
        return;
      }

      // 2. Get vendor-specific SEND movements (items sent TO laundry for selected vendor)
      const { data: vendorSends } = await supabase.from('stock_movements')
        .select('item_id, quantity')
        .eq('organization_id', selectedOrg.id)
        .eq('reference_type', 'LAUNDRY_SEND')
        .eq('movement_type', 'IN')
        .eq('vendor_id', selectedVendor)
        .eq('warehouse_id', laundryWarehouse.id);

      // 3. Get vendor-specific RECEIVE movements (items received FROM laundry for selected vendor)
      const { data: vendorReceives } = await supabase.from('stock_movements')
        .select('item_id, quantity')
        .eq('organization_id', selectedOrg.id)
        .eq('reference_type', 'LAUNDRY_RECEIVE')
        .eq('movement_type', 'OUT')
        .eq('vendor_id', selectedVendor)
        .eq('warehouse_id', laundryWarehouse.id);

      // 4. Calculate vendor-specific net qty per item
      const vendorNetQty = {};
      (vendorSends || []).forEach(m => {
        vendorNetQty[m.item_id] = (vendorNetQty[m.item_id] || 0) + (parseFloat(m.quantity) || 0);
      });
      (vendorReceives || []).forEach(m => {
        vendorNetQty[m.item_id] = (vendorNetQty[m.item_id] || 0) - (parseFloat(m.quantity) || 0);
      });

      // 5. Get ALL vendor-tracked movements (all vendors combined) to find "tracked" totals
      const { data: allTrackedSends } = await supabase.from('stock_movements')
        .select('item_id, quantity')
        .eq('organization_id', selectedOrg.id)
        .eq('reference_type', 'LAUNDRY_SEND')
        .eq('movement_type', 'IN')
        .not('vendor_id', 'is', null)
        .eq('warehouse_id', laundryWarehouse.id);

      const { data: allTrackedReceives } = await supabase.from('stock_movements')
        .select('item_id, quantity')
        .eq('organization_id', selectedOrg.id)
        .eq('reference_type', 'LAUNDRY_RECEIVE')
        .eq('movement_type', 'OUT')
        .not('vendor_id', 'is', null)
        .eq('warehouse_id', laundryWarehouse.id);

      // 6. Calculate total tracked qty per item (across all vendors)
      const totalTracked = {};
      (allTrackedSends || []).forEach(m => {
        totalTracked[m.item_id] = (totalTracked[m.item_id] || 0) + (parseFloat(m.quantity) || 0);
      });
      (allTrackedReceives || []).forEach(m => {
        totalTracked[m.item_id] = (totalTracked[m.item_id] || 0) - (parseFloat(m.quantity) || 0);
      });

      // 7. Build final items list
      // For each laundry item: vendor_qty = vendor_net + (if BonVivo: untracked legacy qty)
      const vendorItems = allLaundryItems.map(item => {
        let qty = vendorNetQty[item.item_id] || 0;

        // Legacy/untracked items (stock_balance qty not covered by any vendor movements)
        // are attributed to BonVivo as the default vendor
        if (selectedVendor === BONVIVO_VENDOR_ID) {
          const tracked = totalTracked[item.item_id] || 0;
          const untracked = Math.max(0, item.quantity - tracked);
          qty += untracked;
        }

        return { ...item, quantity: qty };
      }).filter(item => item.quantity > 0);

      setVendorLaundryItems(vendorItems);
    } catch (e) {
      showNotification('Error loading vendor laundry items: ' + e.message, 'error');
    }
    setLoadingVendorItems(false);
  }

  const itemsToDisplay = activeTab === 'send' ? dirtyItems : (selectedVendor ? vendorLaundryItems : []);
  const filtered = useMemo(() => itemsToDisplay.filter(item => {
    const txt = search.toLowerCase();
    const matchSearch = !txt ||
      item.items?.name?.toLowerCase().includes(txt) ||
      item.items?.code?.toLowerCase().includes(txt) ||
      item.items?.brand?.toLowerCase().includes(txt);
    const matchCat = !filterCategory || item.items?.category_id === filterCategory;
    return matchSearch && matchCat;
  }), [itemsToDisplay, search, filterCategory]);

  const totalItemsSelected = useMemo(() => Object.values(selectedItems).filter(v => v && parseFloat(v.qty) > 0).length, [selectedItems]);

  // Group filtered items by category (level 2) for subtotal rows
  const [expandedLaundryCats, setExpandedLaundryCats] = React.useState({});

  const groupedFiltered = React.useMemo(() => {
    const groups = {};
    filtered.forEach(item => {
      const catId = item.items?.category_id || 'uncategorized';
      const catName = item.items?.item_categories?.name || 'Uncategorized';
      if (!groups[catId]) groups[catId] = { catId, catName, items: [] };
      groups[catId].items.push(item);
    });
    return Object.values(groups).sort((a, b) => a.catName.localeCompare(b.catName));
  }, [filtered]);

  // Default all categories to collapsed
  React.useEffect(() => {
    const expanded = {};
    groupedFiltered.forEach(g => { expanded[g.catId] = false; });
    setExpandedLaundryCats(expanded);
  }, [groupedFiltered.length]);

  function toggleLaundryCat(catId) {
    setExpandedLaundryCats(prev => ({ ...prev, [catId]: !prev[catId] }));
  }

  // ===== PDF Export: Berita Acara Laundry (Send & Receive) =====
  async function exportLaundryPdf(refNumber, refType) {
    try {
      // Fetch all items for this reference (works for both SEND and RECEIVE)
      const { data: lsItems } = await supabase.from('stock_movements')
        .select('*, items:item_id(code, name, category_id, item_categories:category_id(id, name)), vendors:vendor_id(id, code, name), users:created_by(id, full_name, department_id, departments:department_id(name))')
        .eq('organization_id', selectedOrg.id)
        .eq('reference_number', refNumber)
        .eq('reference_type', refType || 'LAUNDRY_SEND')
        .eq('movement_type', 'OUT')
        .order('created_at');

      if (!lsItems || lsItems.length === 0) {
        showNotification('Data tidak ditemukan untuk ' + refNumber, 'error');
        return;
      }
      const isSend = refType === 'LAUNDRY_SEND';

      const firstItem = lsItems[0];
      const vendorName = firstItem.vendors?.name || '-';
      const userName = firstItem.users?.full_name || '-';
      const deptName = firstItem.users?.departments?.name || '-';
      const createdAt = firstItem.created_at;
      const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
      const dateStr = new Date(createdAt).toLocaleString('id-ID', { timeZone: tz, dateStyle: 'long', timeStyle: 'short' });

      // Group by category
      const groups = {};
      lsItems.forEach(item => {
        const catName = item.items?.item_categories?.name || 'Uncategorized';
        if (!groups[catName]) groups[catName] = [];
        groups[catName].push(item);
      });

      // jsPDF imported at top of file
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pw = doc.internal.pageSize.getWidth();
      const margin = 15;
      let y = 15;

      // Title
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.text(isSend ? 'BERITA ACARA SERAH TERIMA LAUNDRY' : 'BERITA ACARA PENERIMAAN LAUNDRY', pw / 2, y, { align: 'center' });
      y += 6;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('No: ' + refNumber, pw / 2, y, { align: 'center' });
      y += 8;

      // Header info
      doc.setFontSize(9);
      const col1 = margin;
      const col2 = margin + 35;
      const lh = 5;

      doc.setFont('helvetica', 'bold');
      doc.text('Tanggal', col1, y);
      doc.setFont('helvetica', 'normal');
      doc.text(': ' + dateStr, col2, y);
      y += lh;

      doc.setFont('helvetica', 'bold');
      doc.text('Vendor', col1, y);
      doc.setFont('helvetica', 'normal');
      doc.text(': ' + vendorName, col2, y);
      y += lh;

      doc.setFont('helvetica', 'bold');
      doc.text('User', col1, y);
      doc.setFont('helvetica', 'normal');
      doc.text(': ' + userName, col2, y);
      y += lh;

      doc.setFont('helvetica', 'bold');
      doc.text('Department', col1, y);
      doc.setFont('helvetica', 'normal');
      doc.text(': ' + deptName, col2, y);
      y += 8;

      // Detail table grouped by category
      const sortedCats = Object.keys(groups).sort();
      const tableBody = [];
      let no = 1;
      sortedCats.forEach(catName => {
        // Category header row
        tableBody.push([{ content: catName, colSpan: 4, styles: { fontStyle: 'bold', fillColor: [235, 245, 255], textColor: [30, 64, 120], fontSize: 8 } }]);
        groups[catName].forEach(item => {
          tableBody.push([
            { content: String(no++), styles: { halign: 'center' } },
            item.items?.code || '-',
            item.items?.name || '-',
            { content: String(item.quantity), styles: { halign: 'center' } }
          ]);
        });
      });

      // Grand total row
      const grandTotal = lsItems.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0), 0);
      tableBody.push([
        { content: 'TOTAL', colSpan: 3, styles: { fontStyle: 'bold', halign: 'right', fillColor: [41, 65, 122], textColor: 255, fontSize: 9 } },
        { content: String(grandTotal), styles: { fontStyle: 'bold', halign: 'center', fillColor: [41, 65, 122], textColor: 255, fontSize: 9 } }
      ]);

      doc.autoTable({
        startY: y,
        head: [['No', 'Kode Item', 'Nama Item', 'Qty']],
        body: tableBody,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.3 },
        headStyles: { fillColor: [41, 65, 122], textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 25 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 18, halign: 'center' }
        },
        margin: { left: margin, right: margin },
        didDrawPage: function(data) {
          // Footer
          doc.setFontSize(7);
          doc.setTextColor(150);
          doc.text(selectedOrg?.name + ' - ' + refNumber, margin, doc.internal.pageSize.getHeight() - 8);
          doc.text('Halaman ' + doc.internal.getNumberOfPages(), pw - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
          doc.setTextColor(0);
        }
      });

      y = doc.lastAutoTable.finalY + 12;

      // Check if signature section fits, otherwise new page
      if (y + 55 > doc.internal.pageSize.getHeight() - 15) {
        doc.addPage();
        y = 20;
      }

      // Signature section
      const sigW = (pw - margin * 2 - 20) / 2;
      const sigX1 = margin;
      const sigX2 = margin + sigW + 20;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(isSend ? 'Yang Menyerahkan,' : 'Yang Menerima,', sigX1, y);
      doc.text(isSend ? 'Yang Menerima (Pihak Vendor Laundry),' : 'Yang Menyerahkan (Pihak Vendor Laundry),', sigX2, y);
      y += 30;

      // Signature lines
      doc.setDrawColor(150);
      doc.setLineWidth(0.3);
      doc.line(sigX1, y, sigX1 + sigW, y);
      doc.line(sigX2, y, sigX2 + sigW, y);
      y += 5;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('Nama Jelas: ................................', sigX1, y);
      doc.text('Nama Jelas: ................................', sigX2, y);
      y += 5;
      doc.text('Tanggal: ....................................', sigX1, y);
      doc.text('Tanggal: ....................................', sigX2, y);

      doc.save(refNumber + '.pdf');
      showNotification('PDF berhasil di-export: ' + refNumber + '.pdf', 'success');
    } catch (e) {
      showNotification('Gagal export PDF: ' + e.message, 'error');
    }
  }

  // ===== PDF Export: Check List Penerimaan Laundry =====
  function exportReceiveChecklistPdf() {
    if (!selectedVendor) {
      showNotification('Pilih vendor terlebih dahulu!', 'error');
      return;
    }
    if (vendorLaundryItems.length === 0) {
      showNotification('Tidak ada item untuk di-export', 'error');
      return;
    }

    const vendorObj = vendors.find(v => v.id === selectedVendor);
    const vendorName = vendorObj ? vendorObj.code + ' - ' + vendorObj.name : '-';
    const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
    const dateStr = new Date().toLocaleString('id-ID', { timeZone: tz, dateStyle: 'long', timeStyle: 'short' });

    // Group items by category
    const groups = {};
    vendorLaundryItems.forEach(item => {
      const catName = item.items?.item_categories?.name || 'Uncategorized';
      if (!groups[catName]) groups[catName] = [];
      groups[catName].push(item);
    });

    // jsPDF imported at top of file
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 15;

    // Title
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('CHECK LIST PENERIMAAN LAUNDRY', pw / 2, y, { align: 'center' });
    y += 8;

    // Header info
    doc.setFontSize(9);
    const col1 = margin;
    const col2 = margin + 35;
    const lh = 5;

    doc.setFont('helvetica', 'bold');
    doc.text('Tanggal', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(': ' + dateStr, col2, y);
    y += lh;

    doc.setFont('helvetica', 'bold');
    doc.text('Vendor', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(': ' + vendorName, col2, y);
    y += lh;

    doc.setFont('helvetica', 'bold');
    doc.text('Hotel', col1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(': ' + (selectedOrg?.name || '-'), col2, y);
    y += 8;

    // Detail table grouped by category
    const sortedCats = Object.keys(groups).sort();
    const tableBody = [];
    let no = 1;
    sortedCats.forEach(catName => {
      tableBody.push([{ content: catName, colSpan: 7, styles: { fontStyle: 'bold', fillColor: [235, 245, 255], textColor: [30, 64, 120], fontSize: 8 } }]);
      groups[catName].forEach(item => {
        tableBody.push([
          { content: String(no++), styles: { halign: 'center' } },
          item.items?.code || '-',
          item.items?.name || '-',
          { content: String(item.quantity), styles: { halign: 'center' } },
          '',  // Qty Terima (empty for manual fill)
          '',  // Selisih (empty for manual fill)
          ''   // Notes (empty for manual fill)
        ]);
      });
    });

    doc.autoTable({
      startY: y,
      head: [['No', 'Kode Item', 'Nama Item', 'Qty\nVendor', 'Qty\nTerima', 'Selisih\n(+/-)', 'Notes']],
      body: tableBody,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.3 },
      headStyles: { fillColor: [41, 65, 122], textColor: 255, fontStyle: 'bold', fontSize: 7.5, halign: 'center', valign: 'middle' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 20 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 14, halign: 'center' },
        4: { cellWidth: 14, halign: 'center' },
        5: { cellWidth: 14, halign: 'center' },
        6: { cellWidth: 28 }
      },
      margin: { left: margin, right: margin },
      didDrawPage: function(data) {
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(selectedOrg?.name + ' - Check List Penerimaan Laundry', margin, doc.internal.pageSize.getHeight() - 8);
        doc.text('Halaman ' + doc.internal.getNumberOfPages(), pw - margin, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
        doc.setTextColor(0);
      }
    });

    y = doc.lastAutoTable.finalY + 12;

    // Check if signature section fits
    if (y + 55 > doc.internal.pageSize.getHeight() - 15) {
      doc.addPage();
      y = 20;
    }

    // Signature section
    const sigW = (pw - margin * 2 - 20) / 2;
    const sigX1 = margin;
    const sigX2 = margin + sigW + 20;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Yang Menyerahkan', sigX1, y);
    doc.text('Yang Menerima,', sigX2, y);
    y += 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('(Pihak Vendor Laundry)', sigX1, y);
    y += 26;

    // Signature lines
    doc.setDrawColor(150);
    doc.setLineWidth(0.3);
    doc.line(sigX1, y, sigX1 + sigW, y);
    doc.line(sigX2, y, sigX2 + sigW, y);
    y += 5;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Nama Jelas: ................................', sigX1, y);
    doc.text('Nama Jelas: ................................', sigX2, y);
    y += 5;
    doc.text('Tanggal: ....................................', sigX1, y);
    doc.text('Tanggal: ....................................', sigX2, y);

    const filename = 'Checklist-Terima-Laundry-' + (vendorObj?.code || 'vendor') + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
    doc.save(filename);
    showNotification('PDF berhasil di-export: ' + filename, 'success');
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('laundry.title') || 'Laundry Management'}
        subtitle={`${t('laundry.subtitle') || 'Manage linen laundry cycle for'} ${selectedOrg?.name || ''}`}
      />

      {/* Tab Navigation */}
      <div className="mb-6 flex gap-4 border-b border-gray-200">
        <button
          onClick={() => { setActiveTab('send'); setSearch(''); setFilterCategory(''); setSelectedVendor(''); setSelectedItems({}); }}
          className={`px-4 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'send'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          {t('laundry.sendTab') || 'Kirim ke Laundry'}
        </button>
        <button
          onClick={() => { setActiveTab('receive'); setSearch(''); setFilterCategory(''); setSelectedVendor(''); setSelectedItems({}); }}
          className={`px-4 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'receive'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-800'
          }`}
        >
          {t('laundry.receiveTab') || 'Terima dari Laundry'}
        </button>
      </div>

      {/* Vendor Selection */}
      <div className="mb-4 bg-white border border-gray-200 rounded-xl p-3 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700">
            <span className="inline-flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              Vendor Laundry
            </span>
          </label>
          <select
            value={selectedVendor}
            onChange={e => { setSelectedVendor(e.target.value); setSelectedItems({}); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            style={{maxWidth: '100%'}}
          >
            <option value="">-- Pilih Vendor Laundry --</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.code} - {v.name}</option>)}
          </select>
          {activeTab === 'receive' && selectedVendor && vendorLaundryItems.length > 0 && (
            <button
              onClick={exportReceiveChecklistPdf}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors w-full"
              title="Export Check List PDF"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              Export Check List PDF
            </button>
          )}
        </div>
        {!selectedVendor && activeTab === 'receive' && (
          <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            Pilih vendor terlebih dahulu untuk melihat item yang ada di laundry vendor tersebut.
          </p>
        )}
        {!selectedVendor && activeTab === 'send' && (
          <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            Anda bisa mengisi data tanpa vendor, tetapi wajib pilih vendor sebelum menyimpan.
          </p>
        )}
      </div>

      {/* Search bar removed per user request */}

      {/* Items Table */}
      {loading || loadingVendorItems ? (
        <PageLoader />
      ) : !dirtyWarehouse && activeTab === 'send' ? (
        <div className="text-center py-12 text-gray-500">
          {t('laundry.noDirtyWarehouse') || 'No dirty warehouse configured for this hotel.'}
        </div>
      ) : !laundryWarehouse && activeTab === 'receive' ? (
        <div className="text-center py-12 text-gray-500">
          {t('laundry.noLaundryWarehouse') || 'No laundry warehouse configured for this hotel.'}
        </div>
      ) : activeTab === 'receive' && !selectedVendor ? (
        <div className="text-center py-12 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          <p className="text-sm">Pilih vendor laundry terlebih dahulu untuk melihat item.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {activeTab === 'send'
            ? (t('laundry.noDirtyItems') || 'No items in dirty warehouse.')
            : 'Tidak ada item di laundry vendor ini.'
          }
        </div>
      ) : (
        <React.Fragment>
        {/* ===== DESKTOP ACCORDION (hidden on mobile) ===== */}
        <div className="hidden sm:block mb-6 space-y-3">
          {groupedFiltered.map(group => {
            const isExpanded = expandedLaundryCats[group.catId];
            const catTotalQty = group.items.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
            const catTransferQty = group.items.reduce((s, i) => s + (parseFloat(selectedItems[i.item_id]?.qty) || 0), 0);
            return (
              <div key={'lc-'+group.catId} className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                {/* Accordion Header */}
                <button onClick={() => toggleLaundryCat(group.catId)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors min-h-[48px]">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="font-semibold text-blue-900 text-sm">{group.catName}</span>
                    <span className="text-xs text-blue-600">({group.items.length})</span>
                    <span className="text-xs text-gray-500 ml-2">Qty: <span className="font-bold text-gray-700">{catTotalQty}</span></span>
                    {catTransferQty > 0 && <span className="text-xs text-blue-600 ml-1">| Transfer: <span className="font-bold">{catTransferQty}</span></span>}
                  </div>
                  <span className="text-blue-400 text-lg">{isExpanded ? '−' : '+'}</span>
                </button>
                {/* Accordion Content */}
                {isExpanded && (
                  <div className="border-t border-blue-100">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.itemCode') || 'Kode'}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.itemName') || 'Nama Item'}</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{t('laundry.availableQty') || 'Qty Tersedia'}</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">{t('laundry.transferQty') || 'Qty Transfer'}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.notes') || 'Catatan'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {group.items.map(item => (
                          <tr key={item.item_id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium">{item.items?.code}</td>
                            <td className="px-4 py-3 text-sm">
                              <div className="font-medium">{item.items?.name}</div>
                              {item.items?.brand && <div className="text-gray-500 text-xs">{item.items.brand}</div>}
                            </td>
                            <td className="px-4 py-3 text-center text-sm font-medium">{item.quantity}</td>
                            <td className="px-4 py-3 text-center">
                              <input
                                {...intQtyInputProps}
                                max={item.quantity}
                                placeholder="0"
                                value={selectedItems[item.item_id]?.qty || ''}
                                onChange={e => {
                                  const intVal = toIntQty(e.target.value);
                                  const newSel = { ...selectedItems };
                                  newSel[item.item_id] = {
                                    ...newSel[item.item_id],
                                    qty: intVal,
                                    selected: intVal > 0
                                  };
                                  setSelectedItems(newSel);
                                }}
                                className="w-20 px-2 py-1 text-center border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="text"
                                placeholder="Catatan (opsional)..."
                                value={selectedItems[item.item_id]?.notes || ''}
                                onChange={e => {
                                  const newSel = { ...selectedItems };
                                  newSel[item.item_id] = { ...newSel[item.item_id], notes: e.target.value };
                                  setSelectedItems(newSel);
                                }}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ===== MOBILE CARD LIST (hidden on desktop) ===== */}
        <div className="sm:hidden mb-6 space-y-3 pb-20">
          {groupedFiltered.map(group => {
            const isExpanded = expandedLaundryCats[group.catId];
            const catTotalQty = group.items.reduce((s, i) => s + (parseFloat(i.quantity) || 0), 0);
            const catTransferQty = group.items.reduce((s, i) => s + (parseFloat(selectedItems[i.item_id]?.qty) || 0), 0);
            return (
              <div key={'mlc-'+group.catId} className="bg-white border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                {/* Accordion Header */}
                <button onClick={() => toggleLaundryCat(group.catId)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors min-h-[48px]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></div>
                    <span className="font-semibold text-blue-900 text-sm">{group.catName}</span>
                    <span className="text-xs text-blue-600">({group.items.length})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Qty: <span className="font-bold text-gray-700">{catTotalQty}</span></span>
                    {catTransferQty > 0 && <span className="text-xs font-bold text-blue-600">{catTransferQty}</span>}
                    <span className="text-blue-400 text-lg">{isExpanded ? '−' : '+'}</span>
                  </div>
                </button>
                {/* Accordion Content - Item Cards */}
                {isExpanded && (
                  <div className="p-2 space-y-2 border-t border-blue-100">
                    {group.items.map(item => {
                      const sel = selectedItems[item.item_id] || {};
                      const qtyVal = parseInt(sel.qty) || 0;
                      return (
                        <div key={item.item_id} className="rounded-lg border p-3 border-gray-200 bg-white">
                          <div className="flex items-start gap-3 mb-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-bold text-primary-600 bg-primary-50 px-2 py-0.5 rounded">{item.items?.code}</span>
                              </div>
                              <div className="text-sm font-semibold text-gray-800 leading-tight">{item.items?.name}</div>
                              {item.items?.brand && <div className="text-xs text-gray-400 mt-0.5">{item.items.brand}</div>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-xs text-gray-400">Tersedia</div>
                              <div className="text-lg font-bold text-gray-700">{item.quantity}</div>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-600">Transfer Qty</span>
                            <div className="inline-flex items-center border rounded-lg overflow-hidden border-gray-300">
                              <button type="button"
                                onClick={() => {
                                  const nv = Math.max(0, qtyVal - 1);
                                  const newSel = { ...selectedItems };
                                  newSel[item.item_id] = { ...newSel[item.item_id], qty: nv || '', selected: nv > 0 };
                                  if (nv === 0) { delete newSel[item.item_id]; }
                                  setSelectedItems(newSel);
                                }}
                                className="w-12 h-12 flex items-center justify-center text-xl font-bold bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-700 transition-colors select-none">−</button>
                              <span className="w-14 h-12 flex items-center justify-center text-base font-bold bg-white border-l border-r border-gray-300">{qtyVal}</span>
                              <button type="button"
                                onClick={() => {
                                  const nv = Math.min(item.quantity, qtyVal + 1);
                                  const newSel = { ...selectedItems };
                                  newSel[item.item_id] = { ...newSel[item.item_id], qty: nv, selected: true };
                                  setSelectedItems(newSel);
                                }}
                                className="w-12 h-12 flex items-center justify-center text-xl font-bold bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-700 transition-colors select-none">+</button>
                            </div>
                          </div>
                          <input
                            type="text"
                            placeholder="Catatan (opsional)..."
                            value={sel.notes || ''}
                            onChange={e => {
                              const newSel = { ...selectedItems };
                              newSel[item.item_id] = { ...newSel[item.item_id], notes: e.target.value };
                              setSelectedItems(newSel);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </React.Fragment>
      )}

      {/* Submit Button - Desktop */}
      {!loading && filtered.length > 0 && (
        <div className="mb-6 hidden sm:flex justify-end">
          <Button
            onClick={activeTab === 'send' ? handleSendToLaundry : handleReceiveFromLaundry}
            disabled={saving || totalItemsSelected === 0}
            variant="primary"
          >
            {saving ? (t('common.saving') || 'Saving...') : (activeTab === 'send' ? (t('laundry.sendButton') || 'Send to Laundry') : (t('laundry.receiveButton') || 'Receive from Laundry'))}
          </Button>
        </div>
      )}

      {/* Submit Button - Mobile Sticky Bottom */}
      {!loading && filtered.length > 0 && (
        <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 shadow-lg z-50">
          <button
            onClick={activeTab === 'send' ? handleSendToLaundry : handleReceiveFromLaundry}
            disabled={saving || totalItemsSelected === 0}
            className={`w-full py-3.5 rounded-xl text-sm font-bold text-white transition-colors ${
              saving || totalItemsSelected === 0
                ? 'bg-gray-300 cursor-not-allowed'
                : activeTab === 'send'
                  ? 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700'
                  : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700'
            }`}
          >
            {saving ? 'Memproses...' : (
              activeTab === 'send'
                ? `Kirim ke Laundry${totalItemsSelected > 0 ? ` (${totalItemsSelected} item)` : ''}`
                : `Terima dari Laundry${totalItemsSelected > 0 ? ` (${totalItemsSelected} item)` : ''}`
            )}
          </button>
        </div>
      )}

      {/* History Section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold mb-4">{t('laundry.history') || 'Riwayat Laundry'}</h3>
        {history.length === 0 ? (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
            {t('laundry.noHistory') || 'Belum ada riwayat laundry.'}
          </div>
        ) : (
          <React.Fragment>
            {/* Desktop history table */}
            <div className="hidden sm:block bg-white rounded-lg shadow overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.refNumber') || 'Reference'}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.type') || 'Type'}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total Items</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('laundry.date') || 'Date'}</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {history.map((rec, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{rec.reference_number}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          rec.reference_type === 'LAUNDRY_SEND'
                            ? 'bg-orange-100 text-orange-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {rec.reference_type === 'LAUNDRY_SEND' ? (t('laundry.typeSend') || 'Send') : (t('laundry.typeReceive') || 'Receive')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm">{rec.item_count} item</td>
                      <td className="px-4 py-3 text-center text-sm font-semibold">{formatNumber(rec.total_qty)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {rec.created_at ? formatDateSys(rec.created_at) : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => exportLaundryPdf(rec.reference_number, rec.reference_type)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                          title="Export PDF"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile history cards */}
            <div className="sm:hidden space-y-2">
              {history.map((rec, idx) => (
                <div key={idx} className="bg-white rounded-lg shadow-sm border border-gray-200 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-gray-700">{rec.reference_number}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      rec.reference_type === 'LAUNDRY_SEND'
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {rec.reference_type === 'LAUNDRY_SEND' ? 'Kirim' : 'Terima'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">{rec.item_count} item</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-bold text-gray-700">Total Qty: {formatNumber(rec.total_qty)}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{rec.created_at ? formatDateSys(rec.created_at) : '-'}</span>
                      <button
                        onClick={() => exportLaundryPdf(rec.reference_number, rec.reference_type)}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        PDF
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default LaundryPage;
