import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatCurrency, formatNumber, formatDate, formatDateSys } from '../utils/format.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Tab } from '../components/Tab';
import { Button, Badge } from '../components/FormElements';
import { StatCard } from '../components/StatCard';
import { ReportStockInRooms } from '../components/ReportStockInRooms';
import { PageLoader } from '../components/PageLoader';
import { Modal } from '../components/Modal';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

function ReportsPage() {
  const { selectedOrg } = useApp();
  const { t } = useTranslation();
  const [activeReport, setActiveReport] = useState(null);
  const [roomPopup, setRoomPopup] = useState(null); // { item, roomDetails }

  // Legacy states (kept for existing report types)
  const [reportType, setReportType] = useState('valuation');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterLinenStatus, setFilterLinenStatus] = useState('active');
  const [linenSubCat, setLinenSubCat] = useState('ALL');
  const [linenCategories, setLinenCategories] = useState([]);

  useEffect(() => {
    if (selectedOrg) {
      Promise.all([
        supabase.from('item_categories').select('id, code, name').order('code'),
        supabase.from('departments').select('id, code, name').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      ]).then(([catRes, deptRes]) => {
        setCategories(catRes.data || []);
        setDepartments(deptRes.data || []);
        setLinenCategories((catRes.data || []).filter(c => c.code.startsWith('LIN') && c.code !== 'LIN'));
      });
    }
  }, [selectedOrg]);

  useEffect(() => {
    setData(reportType === 'purchase' ? { pos: [], pis: [] } : []);
    if (selectedOrg) generateReport();
  }, [selectedOrg, reportType]);

  async function generateReport() {
    if (!selectedOrg) return;
    setLoading(true);
    setData(reportType === 'purchase' ? { pos: [], pis: [] } : []);
    try {
      if (reportType === 'valuation') {
        let q = supabase.from('stock_balance').select('*, items(code, name, brand, size, category_id, avg_cost, item_categories(name, code)), departments(name, code)').eq('organization_id', selectedOrg.id);
        if (filterDept) q = q.eq('department_id', filterDept);
        const { data: res } = await q.order('total_value', { ascending: false });
        let filtered = res || [];
        if (filterCat) filtered = filtered.filter(r => r.items?.category_id === filterCat);
        setData(filtered);
      } else if (reportType === 'movement') {
        let q = supabase.from('stock_movements').select('*, items(code, name), departments(name, code)').eq('organization_id', selectedOrg.id);
        if (filterDept) q = q.eq('department_id', filterDept);
        if (dateFrom) q = q.gte('created_at', dateFrom);
        if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59');
        const { data: res } = await q.order('created_at', { ascending: true }).limit(500);
        setData(res || []);
      } else if (reportType === 'purchase') {
        const [poRes, piRes] = await Promise.all([
          supabase.from('purchase_orders').select('*, vendors(name, code)').eq('organization_id', selectedOrg.id).order('order_date', { ascending: false }),
          supabase.from('purchase_invoices').select('*, vendors(name, code), purchase_orders(po_number)').eq('organization_id', selectedOrg.id).order('invoice_date', { ascending: false }),
        ]);
        let poData = poRes.data || [];
        let piData = piRes.data || [];
        if (dateFrom) { poData = poData.filter(r => r.order_date >= dateFrom); piData = piData.filter(r => r.invoice_date >= dateFrom); }
        if (dateTo) { poData = poData.filter(r => r.order_date <= dateTo); piData = piData.filter(r => r.invoice_date <= dateTo); }
        setData({ pos: poData, pis: piData });
      } else if (reportType === 'lowstock') {
        const { data: balances } = await supabase.from('stock_balance').select('*, items(code, name, min_stock, brand, category_id, item_categories(name, code)), departments(name, code)').eq('organization_id', selectedOrg.id);
        let filtered = (balances || []).filter(b => b.items?.min_stock > 0 && b.quantity <= b.items.min_stock);
        if (filterCat) filtered = filtered.filter(r => r.items?.category_id === filterCat);
        setData(filtered);
      } else if (reportType === 'opname') {
        let q = supabase.from('stock_opname').select('*, departments(name, code)').eq('organization_id', selectedOrg.id);
        if (filterDept) q = q.eq('department_id', filterDept);
        if (dateFrom) q = q.gte('opname_date', dateFrom);
        if (dateTo) q = q.lte('opname_date', dateTo);
        const { data: res } = await q.order('opname_date', { ascending: false });
        setData(res || []);
      } else if (reportType === 'linen') {
        // Step 1: Get all linen item IDs (filter at DB level, not client-side)
        let linenQuery = supabase.from('items')
          .select('id, is_active, item_categories!inner(code)')
          .eq('organization_id', selectedOrg.id)
          .like('item_categories.code', 'LIN%');
        if (filterLinenStatus === 'active') linenQuery = linenQuery.eq('is_active', true);
        else if (filterLinenStatus === 'inactive') linenQuery = linenQuery.eq('is_active', false);
        const { data: linenItems } = await linenQuery;
        const linenItemIds = (linenItems || []).map(i => i.id);
        if (linenItemIds.length === 0) { setData([]); setLoading(false); return; }
        // Step 2: Fetch stock_balance only for linen items, paginated
        let linenBalances = [];
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data: batch } = await supabase.from('stock_balance')
            .select('*, items(id, code, name, brand, min_stock, category_id, item_categories(code, name)), warehouses(id, code, name, warehouse_type)')
            .eq('organization_id', selectedOrg.id)
            .in('item_id', linenItemIds)
            .gt('quantity', 0)
            .range(from, from + pageSize - 1);
          if (!batch || batch.length === 0) break;
          linenBalances = linenBalances.concat(batch);
          if (batch.length < pageSize) break;
          from += pageSize;
        }
        // Group by item: { item_id: { item, store, room, dirty, laundry, damage, total } }
        const itemMap = {};
        for (const b of linenBalances) {
          if (!itemMap[b.item_id]) {
            itemMap[b.item_id] = { item: b.items, store: 0, room: 0, dirty: 0, laundry: 0, damage: 0, total: 0, minStock: b.items?.min_stock || 0, roomDetails: [] };
          }
          const whType = b.warehouses?.warehouse_type || 'general';
          const qty = parseFloat(b.quantity) || 0;
          if (whType === 'store') itemMap[b.item_id].store += qty;
          else if (whType === 'room') { itemMap[b.item_id].room += qty; itemMap[b.item_id].roomDetails.push({ warehouse: b.warehouses, qty }); }
          else if (whType === 'dirty') itemMap[b.item_id].dirty += qty;
          else if (whType === 'laundry') itemMap[b.item_id].laundry += qty;
          else if (whType === 'damage') itemMap[b.item_id].damage += qty;
          itemMap[b.item_id].total += qty;
        }
        // Calculate insufficient qty
        const result = Object.values(itemMap).map(r => ({ ...r, insufficient: r.minStock > 0 ? Math.max(0, r.minStock - r.total) : 0 }));
        setData(result);
      }
    } catch (err) { }
    setLoading(false);
  }

  function getExportHeaders() {
    if (reportType === 'valuation') return ['Item Code', 'Item Name', 'Brand', 'Category', 'Department', 'Qty', 'Avg Cost', 'Total Value'];
    if (reportType === 'movement') return ['Date', 'Item', 'Type', 'Qty', 'Unit Cost', 'Total Cost', 'Department', 'Reference', 'Notes'];
    if (reportType === 'lowstock') return ['Item Code', 'Item Name', 'Category', 'Department', 'Min Stock', 'Current Stock', 'Shortage'];
    if (reportType === 'opname') return ['Opname No.', 'Date', 'Department', 'Type', 'Status', 'Variance Value'];
    if (reportType === 'linen') return ['Item Code', 'Item Name', 'Brand', 'HK Store', 'In Room', 'Dirty', 'In Laundry', 'Damaged', 'Total', 'Min Stock', 'Insufficient Qty'];
    return [];
  }

  function getExportRows() {
    const arr = Array.isArray(data) ? data : [];
    if (reportType === 'valuation') return arr.map(r => [r.items?.code, r.items?.name, r.items?.brand||'', r.items?.item_categories?.name||'', r.departments?.code||'', r.quantity, r.items?.avg_cost || r.avg_cost, (r.quantity || 0) * (r.items?.avg_cost || r.avg_cost || 0)]);
    if (reportType === 'movement') return arr.map(r => [formatDateSys(r.created_at), r.items?.code+' - '+r.items?.name, r.movement_type, r.quantity, r.unit_cost, r.total_cost, r.departments?.code||'', r.reference_number||'', r.notes||'']);
    if (reportType === 'lowstock') return arr.map(r => [r.items?.code, r.items?.name, r.items?.item_categories?.name||'', r.departments?.code||'', r.items?.min_stock, r.quantity, r.items?.min_stock - r.quantity]);
    if (reportType === 'opname') return arr.map(r => [r.opname_number, formatDateSys(r.opname_date), r.departments?.code||'', r.opname_type, r.status, r.total_variance_value]);
    if (reportType === 'linen') return arr.map(r => [r.item?.code, r.item?.name, r.item?.brand||'', r.store, r.room, r.dirty, r.laundry, r.damage, r.total, r.minStock || '', r.insufficient || '']);
    return [];
  }

  function exportExcel() {
    const headers = getExportHeaders();
    const rows = getExportRows();
    if (reportType === 'purchase') {
      const wb = XLSX.utils.book_new();
      const poHeaders = ['PO No.', 'Date', 'Vendor', 'Status', 'Total Amount'];
      const poRows = (data.pos||[]).map(r => [r.po_number, r.order_date, r.vendors?.name||'', r.status, r.total_amount]);
      const ws1 = XLSX.utils.aoa_to_sheet([poHeaders, ...poRows]);
      XLSX.utils.book_append_sheet(wb, ws1, 'Purchase Orders');
      const piHeaders = ['PI No.', 'Date', 'Vendor', 'From PO', 'Status', 'Payment', 'Total Amount'];
      const piRows = (data.pis||[]).map(r => [r.pi_number, r.invoice_date, r.vendors?.name||'', r.purchase_orders?.po_number||'', r.status, r.payment_status, r.total_amount]);
      const ws2 = XLSX.utils.aoa_to_sheet([piHeaders, ...piRows]);
      XLSX.utils.book_append_sheet(wb, ws2, 'Purchase Invoices');
      XLSX.writeFile(wb, `purchase_summary_${selectedOrg.code}.xlsx`);
    } else {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');
      XLSX.writeFile(wb, `${reportType}_report_${selectedOrg.code}.xlsx`);
    }
  }

  function exportPDF() {
    // jsPDF imported at top of file
    const doc = new jsPDF({ orientation: 'landscape' });
    const reportNames = { valuation: t('reports.stockValuation'), movement: t('reports.stockMovement'), purchase: t('reports.purchaseSummary'), lowstock: t('reports.lowStock'), opname: t('reports.opnameSummary'), linen: 'Linen Position' };
    doc.setFontSize(16);
    doc.text(reportNames[reportType] || 'Report', 14, 15);
    doc.setFontSize(10);
    doc.text(`${selectedOrg?.name} | ${formatDateSys(new Date().toISOString())}`, 14, 22);

    if (reportType === 'purchase') {
      doc.setFontSize(12);
      doc.text('Purchase Orders', 14, 32);
      const poHeaders = ['PO No.', 'Date', 'Vendor', 'Status', 'Total'];
      const poRows = (data.pos||[]).map(r => [r.po_number, r.order_date, r.vendors?.name||'', r.status, formatCurrency(r.total_amount)]);
      doc.autoTable({ head: [poHeaders], body: poRows, startY: 35, styles: { fontSize: 8 } });
      doc.text('Purchase Invoices', 14, doc.lastAutoTable.finalY + 10);
      const piHeaders = ['PI No.', 'Date', 'Vendor', 'PO', 'Status', 'Payment', 'Total'];
      const piRows = (data.pis||[]).map(r => [r.pi_number, r.invoice_date, r.vendors?.name||'', r.purchase_orders?.po_number||'', r.status, r.payment_status, formatCurrency(r.total_amount)]);
      doc.autoTable({ head: [piHeaders], body: piRows, startY: doc.lastAutoTable.finalY + 13, styles: { fontSize: 8 } });
    } else {
      const headers = getExportHeaders();
      const rows = getExportRows().map(row => row.map(cell => typeof cell === 'number' ? formatNumber(cell) : (cell||'')));
      doc.autoTable({ head: [headers], body: rows, startY: 28, styles: { fontSize: 8 } });
    }
    doc.save(`${reportType}_report_${selectedOrg.code}.pdf`);
  }

  const reportTypes = [
    { id: 'valuation', label: t('reports.stockValuation') },
    { id: 'movement', label: t('reports.stockMovement') },
    { id: 'purchase', label: t('reports.purchaseSummary') },
    { id: 'lowstock', label: t('reports.lowStock') },
    { id: 'opname', label: t('reports.opnameSummary') },
    { id: 'linen', label: 'Linen Position' },
  ];

  const showCatFilter = ['valuation', 'lowstock'].includes(reportType);
  const showDeptFilter = ['valuation', 'movement', 'opname'].includes(reportType);
  const showDateFilter = ['movement', 'purchase', 'opname'].includes(reportType);
  const showLinenStatusFilter = reportType === 'linen';

  const arrData = Array.isArray(data) ? data : [];

  const { totalValue, totalItems } = useMemo(() => {
    if (reportType === 'valuation') {
      return {
        totalValue: arrData.reduce((s, r) => s + (r.total_value || 0), 0),
        totalItems: arrData.length
      };
    } else if (reportType === 'lowstock') {
      return {
        totalValue: 0,
        totalItems: arrData.length
      };
    }
    return { totalValue: 0, totalItems: 0 };
  }, [reportType, arrData]);

  // Purchase summary totals (computed unconditionally to follow hooks rules)
  const purchaseTotals = useMemo(() => {
    if (reportType !== 'purchase' || Array.isArray(data) || !data || !data.pos) {
      return { totalPOValue: 0, totalPIValue: 0, posLen: 0, pisLen: 0 };
    }
    return {
      totalPOValue: data.pos.reduce((s, r) => s + (r.total_amount || 0), 0),
      totalPIValue: (data.pis || []).reduce((s, r) => s + (r.total_amount || 0), 0),
      posLen: data.pos.length,
      pisLen: (data.pis || []).length,
    };
  }, [reportType, data]);

  // Filter linen data by subcategory tab
  const linenFiltered = useMemo(() => {
    if (reportType !== 'linen' || linenSubCat === 'ALL') return arrData;
    return arrData.filter(r => r.item?.item_categories?.code === linenSubCat);
  }, [reportType, arrData, linenSubCat]);

  // Linen summary totals (computed unconditionally to follow hooks rules)
  const linenTotals = useMemo(() => {
    if (reportType !== 'linen') {
      return { totalStore: 0, totalRoom: 0, totalDirty: 0, totalLaundry: 0, totalDamage: 0, totalGrand: 0 };
    }
    return {
      totalStore: linenFiltered.reduce((s, r) => s + (r.store || 0), 0),
      totalRoom: linenFiltered.reduce((s, r) => s + (r.room || 0), 0),
      totalDirty: linenFiltered.reduce((s, r) => s + (r.dirty || 0), 0),
      totalLaundry: linenFiltered.reduce((s, r) => s + (r.laundry || 0), 0),
      totalDamage: linenFiltered.reduce((s, r) => s + (r.damage || 0), 0),
      totalGrand: linenFiltered.reduce((s, r) => s + (r.total || 0), 0),
    };
  }, [reportType, arrData]);

  // Report menu items
  const reportMenuItems = [
    { id: 'stock-in-rooms', label: 'Linen Stock in Room', desc: 'Laporan stok linen di setiap kamar, perbandingan qty aktual vs setup', icon: Icons.Building, color: 'purple' },
    { id: 'valuation', label: t('reports.stockValuation'), desc: 'Valuasi stok berdasarkan harga rata-rata', icon: Icons.Database, color: 'blue' },
    { id: 'movement', label: t('reports.stockMovement'), desc: 'Pergerakan stok masuk dan keluar', icon: Icons.Truck, color: 'green' },
    { id: 'purchase', label: t('reports.purchaseSummary'), desc: 'Ringkasan Purchase Order dan Invoice', icon: Icons.ShoppingCart, color: 'orange' },
    { id: 'lowstock', label: t('reports.lowStock'), desc: 'Item dengan stok di bawah minimum', icon: Icons.AlertTriangle, color: 'red' },
    { id: 'opname', label: t('reports.opnameSummary'), desc: 'Ringkasan hasil stock opname', icon: Icons.ClipboardList, color: 'cyan' },
    { id: 'linen', label: 'Linen Position', desc: 'Posisi linen di semua lokasi', icon: Icons.Package, color: 'pink' },
  ];

  // Render sub-report if active
  if (activeReport === 'stock-in-rooms') {
    return <ReportStockInRooms onBack={() => setActiveReport(null)} />;
  }

  // For legacy reports, use the old reportType flow
  const isLegacyReport = activeReport && activeReport !== 'stock-in-rooms';
  if (isLegacyReport && reportType !== activeReport) {
    setReportType(activeReport);
  }

  // Show hub if no report selected
  if (!activeReport) {
    return (
      <div>
        <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reportMenuItems.map(item => {
            const Icon = item.icon;
            const colorMap = {
              purple: 'border-purple-200 hover:border-purple-400 hover:bg-purple-50',
              blue: 'border-blue-200 hover:border-blue-400 hover:bg-blue-50',
              green: 'border-green-200 hover:border-green-400 hover:bg-green-50',
              orange: 'border-orange-200 hover:border-orange-400 hover:bg-orange-50',
              red: 'border-red-200 hover:border-red-400 hover:bg-red-50',
              cyan: 'border-cyan-200 hover:border-cyan-400 hover:bg-cyan-50',
              pink: 'border-pink-200 hover:border-pink-400 hover:bg-pink-50',
            };
            const iconColorMap = {
              purple: 'text-purple-600 bg-purple-100',
              blue: 'text-blue-600 bg-blue-100',
              green: 'text-green-600 bg-green-100',
              orange: 'text-orange-600 bg-orange-100',
              red: 'text-red-600 bg-red-100',
              cyan: 'text-cyan-600 bg-cyan-100',
              pink: 'text-pink-600 bg-pink-100',
            };
            return (
              <div
                key={item.id}
                onClick={() => { setActiveReport(item.id); if (item.id !== 'stock-in-rooms') setReportType(item.id); }}
                className={`bg-white rounded-xl border-2 p-5 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md ${colorMap[item.color] || ''}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColorMap[item.color] || ''}`}>
                    <Icon />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 text-sm mb-1">{item.label}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                  </div>
                  <Icons.ChevronRight />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')}
        actions={<Button variant="secondary" onClick={() => setActiveReport(null)}><Icons.ArrowLeft /> Kembali</Button>}
      />

      {/* Report selector & filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('reports.selectReport')}</label>
            <select value={reportType} onChange={e => setReportType(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              {reportTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
            </select>
          </div>
          {showCatFilter && (
            <div className="min-w-[150px]">
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('reports.filterCategory')}</label>
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">{t('reports.allCategories')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
              </select>
            </div>
          )}
          {showDeptFilter && (
            <div className="min-w-[150px]">
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('reports.filterDept')}</label>
              <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">{t('reports.allDepts')}</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.code} - {d.name}</option>)}
              </select>
            </div>
          )}
          {showLinenStatusFilter && (
            <div className="min-w-[120px]">
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('common.status')}</label>
              <select value={filterLinenStatus} onChange={e => setFilterLinenStatus(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="active">{t('common.active')}</option>
                <option value="inactive">{t('common.inactive')}</option>
                <option value="">{t('reports.allCategories')}</option>
              </select>
            </div>
          )}
          {showDateFilter && (
            <>
              <div className="min-w-[140px]">
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('reports.filterDateFrom')}</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div className="min-w-[140px]">
                <label className="text-xs font-medium text-gray-500 mb-1 block">{t('reports.filterDateTo')}</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
            </>
          )}
          <Button onClick={generateReport}><Icons.BarChart /> {t('reports.generate')}</Button>
          <Button variant="secondary" onClick={exportPDF}>{t('reports.exportPDF')}</Button>
          <Button variant="secondary" onClick={exportExcel}>{t('reports.exportExcel')}</Button>
        </div>
      </div>

      {/* Summary cards for valuation */}
      {reportType === 'valuation' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatCard title={t('reports.totalStockValue')} value={formatCurrency(totalValue)} icon={Icons.Database} color="blue" />
          <StatCard title={t('reports.totalSKU')} value={formatNumber(totalItems)} icon={Icons.Package} color="green" />
          <StatCard title={t('reports.hotel')} value={selectedOrg?.name} icon={Icons.Building} color="purple" />
        </div>
      )}

      {/* Low stock summary */}
      {reportType === 'lowstock' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <StatCard title={t('reports.lowStock')} value={formatNumber(arrData.length)} icon={Icons.AlertTriangle} color="red" />
          <StatCard title={t('reports.hotel')} value={selectedOrg?.name} icon={Icons.Building} color="purple" />
        </div>
      )}

      {/* Purchase summary cards */}
      {reportType === 'purchase' && !Array.isArray(data) && data.pos && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <StatCard title={t('reports.totalPO')} value={formatNumber(purchaseTotals.posLen)} icon={Icons.ShoppingCart} color="blue" />
          <StatCard title={t('reports.totalPOValue')} value={formatCurrency(purchaseTotals.totalPOValue)} icon={Icons.Database} color="green" />
          <StatCard title={t('reports.totalPI')} value={formatNumber(purchaseTotals.pisLen)} icon={Icons.ClipboardList} color="purple" />
          <StatCard title={t('reports.totalPIValue')} value={formatCurrency(purchaseTotals.totalPIValue)} icon={Icons.Database} color="orange" />
        </div>
      )}

      {/* Report data tables */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{reportTypes.find(r=>r.id===reportType)?.label}</h3>
        </div>

        {reportType === 'valuation' && (
          <DataTable loading={loading} columns={[
            { header: t('dashboard.item'), render: r => <div><span className="font-medium">{r.items?.name}</span>{r.items?.brand ? <span className="text-xs text-gray-400 ml-1">({r.items.brand})</span> : ''}<br/><span className="text-xs text-gray-400">{r.items?.code}</span></div> },
            { header: t('items.category'), render: r => <Badge color="purple">{r.items?.item_categories?.code}</Badge> },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: t('dashboard.qty'), render: r => formatNumber(r.quantity) },
            { header: t('stock.avgCost'), align: 'right', render: r => formatCurrency(r.items?.avg_cost || r.avg_cost) },
            { header: t('stock.totalValue'), align: 'right', render: r => <span className="font-semibold">{formatCurrency((r.quantity || 0) * (r.items?.avg_cost || r.avg_cost || 0))}</span> },
          ]} data={arrData} />
        )}

        {reportType === 'movement' && (
          <DataTable loading={loading} columns={[
            { header: t('common.date'), render: r => formatDateSys(r.created_at) },
            { header: t('dashboard.item'), render: r => <span className="text-xs">{r.items?.code} - {r.items?.name}</span> },
            { header: t('reports.movementType'), render: r => <Badge color={r.movement_type==='IN'?'green':r.movement_type==='OUT'?'red':'yellow'}>{r.movement_type}</Badge> },
            { header: t('reports.movementQty'), render: r => <span className={r.movement_type==='IN'?'text-green-600':r.movement_type==='OUT'?'text-red-600':''}>{r.movement_type==='OUT'?'-':r.movement_type==='IN'?'+':''}{formatNumber(r.quantity)}</span> },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: t('reports.reference'), render: r => <span className="font-mono text-xs">{r.reference_number||'-'}</span> },
          ]} data={arrData} />
        )}

        {reportType === 'purchase' && !Array.isArray(data) && data.pos && (
          <div>
            <div className="p-3 bg-gray-50 border-b"><span className="font-semibold text-sm">Purchase Orders ({data.pos.length})</span></div>
            <DataTable loading={loading} columns={[
              { header: t('reports.poNumber'), render: r => <span className="font-mono text-xs font-semibold text-primary-700">{r.po_number}</span> },
              { header: t('common.date'), render: r => formatDateSys(r.order_date) },
              { header: t('reports.vendorName'), render: r => r.vendors?.name || '-' },
              { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
              { header: t('po.totalAmount'), align: 'right', render: r => <span className="font-semibold">{formatCurrency(r.total_amount)}</span> },
            ]} data={data.pos} />
            <div className="p-3 bg-gray-50 border-b border-t"><span className="font-semibold text-sm">Purchase Invoices ({data.pis.length})</span></div>
            <DataTable loading={false} columns={[
              { header: t('reports.piNumber'), render: r => <span className="font-mono text-xs font-semibold text-primary-700">{r.pi_number}</span> },
              { header: t('common.date'), render: r => formatDateSys(r.invoice_date) },
              { header: t('reports.vendorName'), render: r => r.vendors?.name || '-' },
              { header: t('pi.fromPO'), render: r => r.purchase_orders?.po_number ? <Badge color="blue">{r.purchase_orders.po_number}</Badge> : '-' },
              { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
              { header: t('pi.paymentStatus'), render: r => <Badge color={r.payment_status==='PAID'?'green':r.payment_status==='PARTIAL'?'yellow':'red'}>{r.payment_status}</Badge> },
              { header: t('pi.totalAmount'), align: 'right', render: r => <span className="font-semibold">{formatCurrency(r.total_amount)}</span> },
            ]} data={data.pis} />
          </div>
        )}

        {reportType === 'lowstock' && (
          <DataTable loading={loading} columns={[
            { header: t('dashboard.item'), render: r => <div><span className="font-medium">{r.items?.name}</span><br/><span className="text-xs text-gray-400">{r.items?.code}</span></div> },
            { header: t('items.category'), render: r => <Badge color="purple">{r.items?.item_categories?.code}</Badge> },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: t('reports.minStock'), render: r => formatNumber(r.items?.min_stock) },
            { header: t('reports.currentStock'), render: r => <span className="text-red-600 font-semibold">{formatNumber(r.quantity)}</span> },
            { header: t('reports.shortage'), render: r => <span className="text-red-700 font-bold">-{formatNumber(r.items?.min_stock - r.quantity)}</span> },
          ]} data={arrData} />
        )}

        {reportType === 'opname' && (
          <DataTable loading={loading} columns={[
            { header: t('reports.opnameNumber'), render: r => <span className="font-mono text-xs font-semibold text-primary-700">{r.opname_number}</span> },
            { header: t('common.date'), render: r => formatDateSys(r.opname_date) },
            { header: t('stock.dept'), render: r => <Badge color="blue">{r.departments?.code}</Badge> },
            { header: t('opname.type'), render: r => <Badge color={r.opname_type==='annual'?'purple':r.opname_type==='spot'?'orange':'gray'}>{r.opname_type}</Badge> },
            { header: t('common.status'), render: r => <StatusBadge status={r.status}/> },
            { header: t('reports.varianceValue'), align: 'right', render: r => <span className={r.total_variance_value < 0 ? 'text-red-600 font-semibold' : r.total_variance_value > 0 ? 'text-green-600 font-semibold' : ''}>{formatCurrency(r.total_variance_value)}</span> },
          ]} data={arrData} />
        )}

        {reportType === 'linen' && (
          <div>
            {/* Linen Subcategory Tabs */}
            <div className="flex flex-wrap gap-1 p-3 border-b border-gray-100 bg-gray-50/50">
              <button onClick={() => setLinenSubCat('ALL')} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${linenSubCat === 'ALL' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>All</button>
              {linenCategories.map(c => (
                <button key={c.code} onClick={() => setLinenSubCat(c.code)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${linenSubCat === c.code ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'}`}>{c.name}</button>
              ))}
            </div>
            {/* Linen Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 p-4 border-b border-gray-100">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xs text-green-600 font-medium">HK Store (Bersih)</div>
                <div className="text-lg font-bold text-green-700">{linenTotals.totalStore}</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <div className="text-xs text-purple-600 font-medium">In Room</div>
                <div className="text-lg font-bold text-purple-700">{linenTotals.totalRoom}</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-3 text-center">
                <div className="text-xs text-orange-600 font-medium">Dirty</div>
                <div className="text-lg font-bold text-orange-700">{linenTotals.totalDirty}</div>
              </div>
              <div className="bg-cyan-50 rounded-lg p-3 text-center">
                <div className="text-xs text-cyan-600 font-medium">In Laundry</div>
                <div className="text-lg font-bold text-cyan-700">{linenTotals.totalLaundry}</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-xs text-red-600 font-medium">Damaged</div>
                <div className="text-lg font-bold text-red-700">{linenTotals.totalDamage}</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xs text-blue-600 font-medium">Grand Total</div>
                <div className="text-lg font-bold text-blue-700">{linenTotals.totalGrand}</div>
              </div>
            </div>
            {/* Linen Table */}
            {loading ? (
              <PageLoader />
            ) : linenFiltered.length === 0 ? (
              <div className="p-8 text-center text-gray-500">Tidak ada data linen.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kode</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Item</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-green-600 uppercase bg-green-50">HK Store</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-purple-600 uppercase bg-purple-50">In Room</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-orange-600 uppercase bg-orange-50">Dirty</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-cyan-600 uppercase bg-cyan-50">In Laundry</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-red-600 uppercase bg-red-50">Damaged</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-blue-600 uppercase bg-blue-50 font-bold">Total</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Min Stock</th>
                      <th className="px-3 py-3 text-center text-xs font-medium text-amber-600 uppercase bg-amber-50">Insufficient</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {linenFiltered.map((r, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2"><span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.item?.code}</span></td>
                        <td className="px-4 py-2"><span className="font-medium text-sm">{r.item?.name}</span>{r.item?.brand ? <span className="text-xs text-gray-400 ml-1">({r.item.brand})</span> : ''}</td>
                        <td className="px-3 py-2 text-center bg-green-50/30"><span className={`text-sm font-semibold ${r.store > 0 ? 'text-green-700' : 'text-gray-300'}`}>{r.store || '-'}</span></td>
                        <td className="px-3 py-2 text-center bg-purple-50/30">{r.room > 0 ? <button onClick={() => setRoomPopup({ item: r.item, roomDetails: r.roomDetails })} className="text-sm font-semibold text-purple-700 underline decoration-dotted hover:text-purple-900 cursor-pointer">{r.room}</button> : <span className="text-sm font-semibold text-gray-300">-</span>}</td>
                        <td className="px-3 py-2 text-center bg-orange-50/30"><span className={`text-sm font-semibold ${r.dirty > 0 ? 'text-orange-700' : 'text-gray-300'}`}>{r.dirty || '-'}</span></td>
                        <td className="px-3 py-2 text-center bg-cyan-50/30"><span className={`text-sm font-semibold ${r.laundry > 0 ? 'text-cyan-700' : 'text-gray-300'}`}>{r.laundry || '-'}</span></td>
                        <td className="px-3 py-2 text-center bg-red-50/30"><span className={`text-sm font-semibold ${r.damage > 0 ? 'text-red-700' : 'text-gray-300'}`}>{r.damage || '-'}</span></td>
                        <td className="px-3 py-2 text-center bg-blue-50/30"><span className="text-sm font-bold text-blue-700">{r.total}</span></td>
                        <td className="px-3 py-2 text-center"><span className={`text-sm ${r.minStock > 0 ? 'font-medium text-gray-700' : 'text-gray-300'}`}>{r.minStock || '-'}</span></td>
                        <td className="px-3 py-2 text-center bg-amber-50/30"><span className={`text-sm font-semibold ${r.insufficient > 0 ? 'text-red-600' : 'text-gray-300'}`}>{r.insufficient > 0 ? r.insufficient : '-'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 border-t-2 border-gray-200 font-bold">
                      <td colSpan={2} className="px-4 py-3 text-sm text-gray-700">TOTAL</td>
                      <td className="px-3 py-3 text-center text-sm text-green-700 bg-green-50">{linenTotals.totalStore}</td>
                      <td className="px-3 py-3 text-center text-sm text-purple-700 bg-purple-50">{linenTotals.totalRoom}</td>
                      <td className="px-3 py-3 text-center text-sm text-orange-700 bg-orange-50">{linenTotals.totalDirty}</td>
                      <td className="px-3 py-3 text-center text-sm text-cyan-700 bg-cyan-50">{linenTotals.totalLaundry}</td>
                      <td className="px-3 py-3 text-center text-sm text-red-700 bg-red-50">{linenTotals.totalDamage}</td>
                      <td className="px-3 py-3 text-center text-sm text-blue-700 bg-blue-50">{linenTotals.totalGrand}</td>
                      <td className="px-3 py-3 text-center text-sm text-gray-500">-</td>
                      <td className="px-3 py-3 text-center text-sm text-red-600 bg-amber-50 font-bold">{linenFiltered.reduce((s,r) => s + (r.insufficient || 0), 0) || '-'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {!loading && ((Array.isArray(data) && data.length === 0) || (!Array.isArray(data) && data.pos && data.pos.length === 0 && data.pis && data.pis.length === 0)) && reportType !== 'linen' && (
          <div className="p-8 text-center text-gray-500">{t('reports.noData')}</div>
        )}
      </div>

      {/* Room Detail Popup for Linen Position */}
      <Modal open={!!roomPopup} onClose={() => setRoomPopup(null)} title={`In Room — ${roomPopup?.item?.code} ${roomPopup?.item?.name}`}>
        {roomPopup && (
          <div>
            <div className="text-xs text-gray-500 mb-3">Total In Room: <span className="font-bold text-purple-700">{roomPopup.roomDetails.reduce((s, d) => s + d.qty, 0)}</span> | Rooms: {roomPopup.roomDetails.filter(d => d.qty > 0).length}</div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full">
                <thead><tr className="bg-gray-50 border-b"><th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Room</th><th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {roomPopup.roomDetails.filter(d => d.qty > 0).sort((a, b) => (a.warehouse?.code || '').localeCompare(b.warehouse?.code || '')).map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-sm">{d.warehouse?.name || d.warehouse?.code || '-'}</td>
                      <td className="px-3 py-1.5 text-sm text-right font-semibold">{d.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ReportsPage;
