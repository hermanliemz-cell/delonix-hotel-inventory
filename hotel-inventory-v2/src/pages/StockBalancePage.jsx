import React, {useState, useEffect, useMemo} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDate, formatDateSys } from '../utils/format';
import { Badge } from '../components/FormElements';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { SearchableItemSelect } from '../components/SearchableItemSelect';
import { TreeSelect } from '../components/TreeSelect';
import { DocDetailModal } from '../components/DocDetailModal';
import { PageLoader } from '../components/PageLoader';

function StockBalancePage() {
  const { selectedOrg, showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [stock, setStock] = useState([]);
  const [categories, setCategories] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allItems, setAllItems] = useState([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [filterItem, setFilterItem] = useState('');
  const [filterItemStatus, setFilterItemStatus] = useState('active');
  const [reconciling, setReconciling] = useState(false);
  // Location modal state
  const [locationItem, setLocationItem] = useState(null);
  const [locationExpandRooms, setLocationExpandRooms] = useState(false);
  const [docDetailMovement, setDocDetailMovement] = useState(null);

  function openLocationModal(row) {
    setLocationItem(row);
    setLocationExpandRooms(false);
  }

  // Bincard modal state
  const [bincardItem, setBincardItem] = useState(null);
  const [bincardMovements, setBincardMovements] = useState([]);
  const [bincardLoading, setBincardLoading] = useState(false);
  const [bincardWarehouses, setBincardWarehouses] = useState([]);
  const [bincardFilterWh, setBincardFilterWh] = useState('');
  const [bincardFilterType, setBincardFilterType] = useState('');
  const [bincardPeriod, setBincardPeriod] = useState('ytd');
  const [bincardDateFrom, setBincardDateFrom] = useState('');
  const [bincardDateTo, setBincardDateTo] = useState('');

  function getBincardDateRange(preset) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = yyyy + '-' + mm + '-' + dd;
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
    const lastMonthEnd = new Date(yyyy, today.getMonth(), 0);
    const lmsStr = lastMonthEnd.getFullYear() + '-' + String(lastMonthEnd.getMonth() + 1).padStart(2, '0') + '-01';
    const lmeStr = lastMonthEnd.getFullYear() + '-' + String(lastMonthEnd.getMonth() + 1).padStart(2, '0') + '-' + String(lastMonthEnd.getDate()).padStart(2, '0');
    const lastWeekStart = new Date(today); lastWeekStart.setDate(lastWeekStart.getDate() - 6);
    const lwStr = lastWeekStart.getFullYear() + '-' + String(lastWeekStart.getMonth() + 1).padStart(2, '0') + '-' + String(lastWeekStart.getDate()).padStart(2, '0');
    switch (preset) {
      case 'today': return { from: todayStr, to: todayStr };
      case 'yesterday': return { from: ydStr, to: ydStr };
      case 'lastweek': return { from: lwStr, to: todayStr };
      case 'mtd': return { from: yyyy + '-' + mm + '-01', to: todayStr };
      case 'lastmonth': return { from: lmsStr, to: lmeStr };
      case 'ytd': return { from: yyyy + '-01-01', to: todayStr };
      case 'custom': return { from: bincardDateFrom, to: bincardDateTo };
      default: return { from: '', to: '' };
    }
  }

  async function openBincard(row) {
    const itemId = row.item_id;
    const itemInfo = row.items;
    setBincardItem({ id: itemId, code: itemInfo?.code, name: itemInfo?.name });
    setBincardLoading(true);
    setBincardFilterWh('');
    setBincardFilterType('');
    setBincardPeriod('ytd');
    const range = getBincardDateRange('ytd');
    setBincardDateFrom(range.from);
    setBincardDateTo(range.to);
    // Load warehouses
    const { data: whData } = await supabase.from('warehouses').select('id, code, name').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name');
    setBincardWarehouses(whData || []);
    // Load movements — paginate untuk lewati cap 1000 rows default Supabase
    const allMovs = await fetchAllBincardMovements(selectedOrg.id, itemId, null);
    setBincardMovements(allMovs);
    setBincardLoading(false);
  }

  // Helper: paginate fetch untuk bypass limit 1000 rows per-request Supabase
  async function fetchAllBincardMovements(orgId, itemId, whId) {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = supabase.from('stock_movements')
        .select('*, items(code, name, category_id, units:unit_id(abbreviation)), departments!left(code), users:created_by(username, full_name)')
        .eq('organization_id', orgId).eq('item_id', itemId);
      if (whId) q = q.eq('warehouse_id', whId);
      const { data, error } = await q.order('created_at', { ascending: true }).range(from, from + PAGE - 1);
      if (error || !data) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
      if (from >= 50000) break; // safety guard
    }
    return all;
  }

  async function reloadBincardMovements(whId) {
    if (!bincardItem) return;
    setBincardLoading(true);
    const allMovs = await fetchAllBincardMovements(selectedOrg.id, bincardItem.id, whId || null);
    setBincardMovements(allMovs);
    setBincardLoading(false);
  }

  useEffect(() => { if(selectedOrg) loadStock(); }, [selectedOrg]);

  async function loadStock() {
    setLoading(true);
    const [stockRes, catRes, whRes, itemRes] = await Promise.all([
      supabase.from('stock_balance')
        .select('*, items(code, name, brand, size, min_stock, reorder_point, category_id, is_active, units:unit_id(abbreviation), item_categories(id, code, name)), departments!left(name, code), warehouses!left(id, code, name, warehouse_type)')
        .eq('organization_id', selectedOrg.id)
        .order('updated_at', { ascending: false }),
      supabase.from('item_categories').select('id, code, name, parent_id').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('id, code, name').eq('organization_id', selectedOrg.id).eq('is_active', true).order('code'),
      supabase.from('items').select('id, code, name, is_active').eq('organization_id', selectedOrg?.id).order('name'),
    ]);
    setStock(stockRes.data || []);
    setCategories(catRes.data || []);
    setWarehouses(whRes.data || []);
    setAllItems(itemRes.data || []);
    setLoading(false);
  }

  async function handleReconcile() {
    if (!(await showConfirm('Reconcile akan menghitung ulang semua saldo stok dari data mutasi (stock movements) dan memperbaiki selisih. Lanjutkan?', { variant: 'warning' }))) return;
    setReconciling(true);
    try {
      // Fase 6: delegasi ke DB RPC inventory.run_reconciliation (server-side, aman dari race condition).
      const { data, error } = await supabase.rpc('run_reconciliation', {
        p_organization_id: selectedOrg.id,
      });
      if (error) throw error;
      const count = Array.isArray(data) ? data.length : (typeof data === 'number' ? data : 0);
      if (count > 0) {
        showNotification(`Reconcile selesai! ${count} item dikoreksi.`, 'success');
      } else {
        showNotification('Semua saldo sudah sinkron, tidak ada koreksi diperlukan.', 'info');
      }
      await loadStock();
    } catch (err) {
      showNotification('Gagal reconcile: ' + (err.message || err), 'error');
    } finally {
      setReconciling(false);
    }
  }

  // Build set of matching category IDs (selected + all its children)
  const matchingCatIds = useMemo(() => {
    if (!filterCategory) return null;
    const ids = new Set([filterCategory]);
    // Add all children of selected category
    categories.forEach(c => { if (c.parent_id === filterCategory) ids.add(c.id); });
    return ids;
  }, [filterCategory, categories]);

  const filtered = stock.filter(s => {
    const term = search.toLowerCase();
    const matchSearch = !term || (s.items?.name?.toLowerCase().includes(term) || s.items?.code?.toLowerCase().includes(term) || s.departments?.name?.toLowerCase().includes(term) || s.items?.brand?.toLowerCase().includes(term));
    const matchCat = !matchingCatIds || matchingCatIds.has(s.items?.item_categories?.id);
    const matchWh = !filterWarehouse || s.warehouse_id === filterWarehouse;
    const matchItem = !filterItem || s.item_id === filterItem;
    const matchStatus = filterItemStatus === '' ? true : filterItemStatus === 'active' ? s.items?.is_active === true : s.items?.is_active === false;
    return matchSearch && matchCat && matchWh && matchItem && matchStatus;
  });

  // Group by item_id: aggregate qty and total_value, weighted avg cost, keep warehouse breakdown
  const groupedMap = {};
  filtered.forEach(s => {
    const key = s.item_id;
    if (!groupedMap[key]) {
      groupedMap[key] = { ...s, quantity: 0, total_value: 0, _totalCostQty: 0, _whBreakdown: [] };
    }
    groupedMap[key].quantity += (s.quantity || 0);
    groupedMap[key].total_value += (s.total_value || 0);
    groupedMap[key]._totalCostQty += (s.avg_cost || 0) * (s.quantity || 0);
    if (s.quantity > 0 || s.total_value > 0) {
      groupedMap[key]._whBreakdown.push({
        warehouse_code: s.warehouses?.code || '-',
        warehouse_name: s.warehouses?.name || '-',
        warehouse_type: s.warehouses?.warehouse_type || 'general',
        quantity: s.quantity || 0,
        avg_cost: s.avg_cost || 0,
        total_value: s.total_value || 0,
        unit: s.items?.units?.abbreviation || '',
      });
    }
  });
  const grouped = Object.values(groupedMap).map(g => {
    const itemAvgCost = g.quantity > 0 ? g._totalCostQty / g.quantity : 0;
    // Apply the item-level weighted avg cost to each warehouse breakdown row
    g._whBreakdown.forEach(wh => {
      wh.avg_cost = itemAvgCost;
      wh.total_value = wh.quantity * itemAvgCost;
    });
    return { ...g, avg_cost: itemAvgCost };
  });

  const { totalValue, totalItems, lowStockItems } = useMemo(() => {
    const tv = grouped.reduce((sum, s) => sum + (s.total_value || 0), 0);
    const ti = grouped.length;
    const lsi = grouped.filter(s => s.items?.reorder_point && s.quantity <= s.items.reorder_point).length;
    return { totalValue: tv, totalItems: ti, lowStockItems: lsi };
  }, [grouped]);

  return (
    <div>
      <PageHeader title={t('stock.title')} subtitle={`${t('stock.subtitle')} ${selectedOrg?.name}`} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('stock.totalItems')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatNumber(totalItems)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('stock.totalValue')}</p>
          <p className="text-2xl font-bold text-primary-700 mt-1">{formatCurrency(totalValue)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('stock.lowStock')}</p>
          <p className={`text-2xl font-bold mt-1 ${lowStockItems > 0 ? 'text-red-600' : 'text-green-600'}`}>{lowStockItems}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <div className="w-full sm:w-64">
            <SearchableItemSelect items={allItems} value={filterItem} onChange={setFilterItem} placeholder="Filter by Item..." />
          </div>
          <div className="w-full sm:w-56">
            <TreeSelect value={filterCategory} onChange={setFilterCategory} categories={categories} placeholder={t('stock.allCategories')} />
          </div>
          <select value={filterWarehouse} onChange={e=>setFilterWarehouse(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500">
            <option value="">{t('stock.allWarehouses') || 'Semua Gudang'}</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
          </select>
          <select value={filterItemStatus} onChange={e=>setFilterItemStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500">
            <option value="">Semua Status</option>
            <option value="active">Active</option>
            <option value="inactive">Non-Active</option>
          </select>
          {(filterCategory || filterWarehouse || filterItem || filterItemStatus !== 'active') && (
            <button onClick={() => { setFilterCategory(''); setFilterWarehouse(''); setFilterItem(''); setFilterItemStatus('active'); }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
              {t('common.clearFilters')}
            </button>
          )}
          <div className="ml-auto">
            <button onClick={handleReconcile} disabled={reconciling}
              className="px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50 flex items-center gap-1.5"
              title="Hitung ulang saldo stok dari data mutasi untuk memastikan akurasi">
              {reconciling ? (
                <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Reconciling...</>
              ) : (
                <><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Reconcile</>
              )}
            </button>
          </div>
        </div>
        {loading ? (
          <PageLoader />
        ) : grouped.length === 0 ? (
          <div className="text-center py-12 text-gray-500">{t('common.noData')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">Item Code</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">{t('dashboard.item')}</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">Unit</th>
                  <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">{t('dashboard.qty')}</th>
                  <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">{t('stock.avgCost')}</th>
                  <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap">{t('stock.totalValue')}</th>
                  <th className="text-center px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">View</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((r, i) => {
                  const isLow = r.items?.reorder_point && r.quantity <= r.items.reorder_point;
                  return (
                    <tr key={r.item_id || i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap"><span className="text-xs text-gray-500">{r.items?.code || '-'}</span></td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap"><span className="font-medium">{r.items?.name}{r.items?.brand ? ` (${r.items.brand})` : ''}{r.items?.size ? ` [${r.items.size}]` : ''}</span></td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-gray-500">{r.items?.units?.abbreviation || '-'}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-right"><span className={`font-semibold ${isLow ? 'text-red-600' : ''}`}>{formatNumber(r.quantity)}</span></td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-right">{formatCurrency(r.avg_cost)}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-right">{formatCurrency(r.total_value)}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r._whBreakdown && r._whBreakdown.length > 0 && (
                            <button onClick={() => openLocationModal(r)}
                              className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 transition-colors whitespace-nowrap flex items-center gap-1">
                              <Icons.MapPin /> Location
                            </button>
                          )}
                          <button onClick={() => openBincard(r)}
                            className="px-2 py-1 text-xs font-medium text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-lg border border-primary-200 transition-colors whitespace-nowrap flex items-center gap-1">
                            <Icons.ClipboardList /> Bincard
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Location Modal */}
      {locationItem && (() => {
        const breakdown = locationItem._whBreakdown || [];
        const roomRows = breakdown.filter(wh => wh.warehouse_type === 'room');
        const nonRoomRows = breakdown.filter(wh => wh.warehouse_type !== 'room');
        // NOTE: jangan pakai useMemo di sini — ini IIFE conditional, hook akan bikin
        // "Rendered more hooks than during the previous render" saat modal dibuka/ditutup.
        const roomTotalQty = roomRows.reduce((s, wh) => s + wh.quantity, 0);
        const roomTotalValue = roomRows.reduce((s, wh) => s + wh.total_value, 0);
        const roomAvgCost = roomTotalQty > 0 ? roomTotalValue / roomTotalQty : 0;
        const grandTotalQty = breakdown.reduce((s, wh) => s + wh.quantity, 0);
        const grandTotalValue = breakdown.reduce((s, wh) => s + wh.total_value, 0);
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-8" onClick={() => setLocationItem(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[700px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <div>
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2"><Icons.Warehouse /> Location Breakdown</h3>
                  <p className="text-xs text-gray-500">{locationItem.items?.code} - {locationItem.items?.name}{locationItem.items?.brand ? ` (${locationItem.items.brand})` : ''}</p>
                </div>
                <button onClick={() => setLocationItem(null)} className="text-gray-400 hover:text-gray-600 text-xl font-bold">×</button>
              </div>
              {/* Table */}
              <div className="flex-1 overflow-auto px-5 py-3">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-3 py-2 font-semibold text-gray-600 w-8"></th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-600">Warehouse</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600">Qty</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600">Avg Cost</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-600">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Room group row */}
                    {roomRows.length > 0 && (
                      <React.Fragment>
                        <tr className="border-b border-gray-100 hover:bg-blue-50/30 cursor-pointer"
                            onClick={() => setLocationExpandRooms(prev => !prev)}>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-block transition-transform text-gray-400 ${locationExpandRooms ? 'rotate-90' : ''}`}>▶</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="font-semibold text-blue-700 flex items-center gap-1"><Icons.Door /> Total In Room ({roomRows.length})</span>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-blue-700">{formatNumber(roomTotalQty)}</td>
                          <td className="px-3 py-2 text-right text-blue-600">{formatCurrency(roomAvgCost)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-blue-700">{formatCurrency(roomTotalValue)}</td>
                        </tr>
                        {locationExpandRooms && roomRows.map((wh, wi) => (
                          <tr key={`room-${wi}`} className="bg-blue-50/40 border-b border-blue-100/50">
                            <td className="px-3 py-1.5"></td>
                            <td className="px-3 py-1.5 whitespace-nowrap pl-8">
                              <span className="text-xs text-blue-500">{wh.warehouse_name}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right text-xs text-gray-600">{formatNumber(wh.quantity)}</td>
                            <td className="px-3 py-1.5 text-right text-xs text-gray-500">{formatCurrency(wh.avg_cost)}</td>
                            <td className="px-3 py-1.5 text-right text-xs text-gray-600">{formatCurrency(wh.total_value)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )}
                    {/* Non-room warehouse rows */}
                    {nonRoomRows.map((wh, wi) => (
                      <tr key={`wh-${wi}`} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="text-gray-700 flex items-center gap-1"><Icons.Warehouse /> {wh.warehouse_name}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{formatNumber(wh.quantity)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(wh.avg_cost)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(wh.total_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-gray-800">Grand Total</td>
                      <td className="px-3 py-2 text-right text-gray-800">{formatNumber(grandTotalQty)}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(locationItem.avg_cost)}</td>
                      <td className="px-3 py-2 text-right text-gray-800">{formatCurrency(grandTotalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bincard Modal */}
      {bincardItem && (() => {
        const bcDateRange = bincardPeriod === 'custom' ? { from: bincardDateFrom, to: bincardDateTo } : getBincardDateRange(bincardPeriod);
        function bcToLocalDateStr(utcStr) {
          const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
          return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcStr));
        }
        // Identify transfer-like pairs and merge (1:1 pairing, extras treated as normal)
        const bcIsTransferLike = (refType) => ['TRANSFER', 'MAKEUP-LINEN REPLACE', 'MAKEUP-DIRTY', 'DAMAGE'].includes(refType);
        // Collect ALL outs and ins per key (not just last one)
        const bcTransferGroups = {};
        bincardMovements.forEach(m => {
          if (bcIsTransferLike(m.reference_type)) {
            const key = m.reference_number + '|' + m.item_id + '|' + m.reference_type;
            if (!bcTransferGroups[key]) bcTransferGroups[key] = { outs: [], ins: [] };
            if (m.movement_type === 'OUT') bcTransferGroups[key].outs.push(m);
            else if (m.movement_type === 'IN') bcTransferGroups[key].ins.push(m);
          }
        });
        // Build 1:1 pairs; extra unpaired OUTs/INs stay as normal movements
        const bcPairedIds = new Set();
        const bcSkipIds = new Set();
        Object.values(bcTransferGroups).forEach(group => {
          const pairCount = Math.min(group.outs.length, group.ins.length);
          for (let i = 0; i < pairCount; i++) {
            bcPairedIds.add(group.outs[i].id);
            bcPairedIds.add(group.ins[i].id);
            bcSkipIds.add(group.ins[i].id); // IN side merged into OUT row
          }
        });
        const bcMerged = [];
        bincardMovements.forEach(m => {
          if (bcSkipIds.has(m.id)) return;
          if (bcIsTransferLike(m.reference_type)) {
            if (bcPairedIds.has(m.id)) {
              // OUT side of a paired transfer — merge with its IN counterpart
              const key = m.reference_number + '|' + m.item_id + '|' + m.reference_type;
              const group = bcTransferGroups[key];
              const pairIdx = group.outs.indexOf(m);
              const pairedIn = group.ins[pairIdx];
              bcMerged.push({ ...m, _is_transfer: true, _transfer_qty: m.quantity || 0,
                _from_wh: m.warehouse_id,
                _to_wh: pairedIn ? pairedIn.warehouse_id : m.warehouse_id,
              });
            } else {
              // Unpaired extra (duplicate or incomplete) — treat as normal movement
              bcMerged.push({ ...m, _is_transfer: false, _transfer_qty: 0 });
            }
          } else {
            bcMerged.push({ ...m, _is_transfer: false, _transfer_qty: 0 });
          }
        });
        // Running balance — transfers don't affect balance
        const balanceMap = {};
        const withBalance = bcMerged.map(m => {
          const key = m.item_id || '';
          if (!(key in balanceMap)) balanceMap[key] = { qty: 0, avg_cost: 0 };
          const b = balanceMap[key];
          if (m._is_transfer) {
            return { ...m, _bal: b.qty, _avg: b.avg_cost, _val: b.qty * b.avg_cost };
          }
          const qty = m.quantity || 0;
          const unitCost = m.unit_cost || 0;
          if (m.movement_type === 'IN') {
            const newTotal = b.qty * b.avg_cost + qty * unitCost;
            b.qty += qty;
            b.avg_cost = b.qty > 0 ? newTotal / b.qty : 0;
          } else if (m.movement_type === 'OUT') {
            b.qty -= qty;
            if (b.qty <= 0) { b.qty = 0; }
          }
          return { ...m, _bal: b.qty, _avg: b.avg_cost, _val: b.qty * b.avg_cost };
        });
        // Filter
        const bcFiltered = withBalance.filter(m => {
          if (bincardFilterType && m.movement_type !== bincardFilterType) return false;
          const ld = bcToLocalDateStr(m.created_at);
          if (bcDateRange.from && ld < bcDateRange.from) return false;
          if (bcDateRange.to && ld > bcDateRange.to) return false;
          return true;
        });
        // NOTE: jangan pakai useMemo di sini — ini IIFE conditional, hook akan bikin
        // "Rendered more hooks than during the previous render" saat modal dibuka/ditutup.
        const bcTotalIn = bcFiltered.filter(m => m.movement_type === 'IN' && !m._is_transfer).reduce((s, m) => s + (m.quantity || 0), 0);
        const bcTotalOut = bcFiltered.filter(m => m.movement_type === 'OUT' && !m._is_transfer).reduce((s, m) => s + (m.quantity || 0), 0);
        // Beginning = balance of last row before filtered range
        const bcBeginning = (() => {
          if (!bcDateRange.from) return 0;
          const before = withBalance.filter(m => {
            const ld = bcToLocalDateStr(m.created_at);
            return ld < bcDateRange.from;
          });
          return before.length > 0 ? before[before.length - 1]._bal : 0;
        })();
        const bcEndBalance = bcFiltered.length > 0 ? bcFiltered[bcFiltered.length - 1]._bal : bcBeginning;
        const bcEndValue = bcFiltered.length > 0 ? bcFiltered[bcFiltered.length - 1]._val : 0;
        const bcGetWhName = (whId) => { const w = bincardWarehouses.find(x => x.id === whId); return w ? w.code : '-'; };
        const bcPeriodOptions = [
          { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' },
          { value: 'lastweek', label: 'Last Week' },
          { value: 'mtd', label: 'MTD' }, { value: 'lastmonth', label: 'Last Month' },
          { value: 'ytd', label: 'YTD' }, { value: 'custom', label: 'Custom' },
        ];
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-8" onClick={() => setBincardItem(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[85vw] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Bin Card</h3>
                  <p className="text-xs text-gray-500">{bincardItem.code} - {bincardItem.name}</p>
                </div>
                <button onClick={() => setBincardItem(null)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.X /></button>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-gray-100">
                <div className="bg-blue-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">Beginning</p><p className="text-base font-bold text-blue-700">{formatNumber(bcBeginning)}</p></div>
                <div className="bg-green-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">Total IN</p><p className="text-base font-bold text-green-600">+{formatNumber(bcTotalIn)}</p></div>
                <div className="bg-red-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">Total OUT</p><p className="text-base font-bold text-red-600">-{formatNumber(bcTotalOut)}</p></div>
                <div className="bg-gray-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">Balance</p><p className="text-base font-bold text-gray-800">{formatNumber(bcEndBalance)}</p></div>
                <div className="bg-purple-50 rounded-lg p-2"><p className="text-[10px] text-gray-500">Value</p><p className="text-base font-bold text-purple-700">{formatCurrency(bcEndValue)}</p></div>
              </div>
              {/* Filters */}
              <div className="px-4 py-1.5 border-b border-gray-100 flex flex-wrap gap-2 items-center">
                <select value={bincardFilterWh} onChange={e => { setBincardFilterWh(e.target.value); reloadBincardMovements(e.target.value); }}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                  <option value="">All Warehouses</option>
                  {bincardWarehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
                </select>
                <select value={bincardFilterType} onChange={e => setBincardFilterType(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                  <option value="">All Types</option>
                  <option value="IN">IN</option><option value="OUT">OUT</option><option value="ADJ">ADJ</option>
                </select>
                <select value={bincardPeriod} onChange={e => {
                  setBincardPeriod(e.target.value);
                  if (e.target.value !== 'custom') { const r = getBincardDateRange(e.target.value); setBincardDateFrom(r.from); setBincardDateTo(r.to); }
                }} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                  {bcPeriodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {bincardPeriod === 'custom' && (
                  <div className="flex items-center gap-1">
                    <input type="date" value={bincardDateFrom} onChange={e => setBincardDateFrom(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                    <span className="text-gray-400">—</span>
                    <input type="date" value={bincardDateTo} onChange={e => setBincardDateTo(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs" />
                  </div>
                )}
              </div>
              {/* Table */}
              <div className="flex-1 overflow-auto px-4">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200">
                      <th className="px-1.5 py-1 text-left font-semibold text-gray-600 uppercase">Date</th>
                      <th className="px-1.5 py-1 text-left font-semibold text-gray-600 uppercase">Warehouse</th>
                      <th className="px-1.5 py-1 text-center font-semibold text-gray-600 uppercase">Type</th>
                      <th className="px-1.5 py-1 text-center font-semibold text-gray-600 uppercase">Unit</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">Transfer Qty</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">IN/OUT Qty</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">Cost</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">Balance</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">Avg Cost</th>
                      <th className="px-1.5 py-1 text-right font-semibold text-gray-600 uppercase">Total Value</th>
                      <th className="px-1.5 py-1 text-center font-semibold text-gray-600 uppercase">Dept</th>
                      <th className="px-1.5 py-1 text-left font-semibold text-gray-600 uppercase">User</th>
                      <th className="px-1.5 py-1 text-left font-semibold text-gray-600 uppercase">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bincardLoading ? (
                      <tr><td colSpan="13"><PageLoader /></td></tr>
                    ) : bcFiltered.length === 0 ? (
                      <tr><td colSpan="13" className="px-2 py-8 text-center text-gray-400">No movements found</td></tr>
                    ) : bcFiltered.map((r, idx) => (
                      <tr key={r.id || idx} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-1.5 py-0.5 whitespace-nowrap text-gray-600">{formatDateSys(r.created_at, { includeTime: true })}</td>
                        <td className="px-1.5 py-0.5 whitespace-nowrap">{r._is_transfer ? <span className="text-gray-600">{bcGetWhName(r._from_wh)} → {bcGetWhName(r._to_wh)}</span> : r.movement_type === 'IN' && r.reference_type === 'OPENING_BALANCE' ? <span className="font-bold text-blue-600">Opening Balance</span> : r.movement_type === 'IN' && r.reference_type === 'GR' ? <span className="font-bold text-green-600">Purchase Received</span> : r.movement_type === 'IN' && r.reference_type === 'DIRECT_PURCHASE' ? <span className="font-bold text-green-600">Direct Purchased</span> : r.movement_type === 'OUT' && r.reference_type === 'USAGE' ? <span className="font-bold text-red-600">Single Item Usage</span> : r.movement_type === 'OUT' && r.reference_type === 'WRITEOFF' ? <span className="font-bold text-red-600">Write Off</span> : r.movement_type === 'OUT' && (r.reference_type === 'DEPLETED' || r.reference_type === 'CONSUMPTION') ? <span className="font-bold text-red-600">Makeup Consumption</span> : <span className="text-gray-600">{bcGetWhName(r.warehouse_id)}</span>}</td>
                        <td className="px-1.5 py-0.5 text-center">{r._is_transfer ? <Badge color="blue">TRANSFER</Badge> : <Badge color={r.movement_type==='IN'?'green':r.movement_type==='OUT'?'red':'blue'}>{r.movement_type}</Badge>}</td>
                        <td className="px-1.5 py-0.5 text-center text-gray-500">{r.items?.units?.abbreviation || '-'}</td>
                        <td className={'px-1.5 py-0.5 text-right font-semibold ' + (r._is_transfer ? 'text-blue-600' : 'text-gray-400')}>{r._is_transfer ? formatNumber(r._transfer_qty) : '0'}</td>
                        <td className={'px-1.5 py-0.5 text-right font-semibold ' + (r._is_transfer ? 'text-gray-400' : r.movement_type==='IN' ? 'text-green-600' : 'text-red-600')}>{r._is_transfer ? '0' : (r.movement_type==='IN'?'+':'-') + formatNumber(r.quantity)}</td>
                        <td className="px-1.5 py-0.5 text-right text-gray-600">{formatCurrency(r._is_transfer && !r.unit_cost ? r._avg : r.unit_cost)}</td>
                        <td className="px-1.5 py-0.5 text-right font-semibold text-gray-800">{formatNumber(r._bal)}</td>
                        <td className="px-1.5 py-0.5 text-right text-gray-600">{formatCurrency(r._avg)}</td>
                        <td className="px-1.5 py-0.5 text-right text-gray-600">{formatCurrency(r._val)}</td>
                        <td className="px-1.5 py-0.5 text-center">{r.departments?.code ? <Badge color="blue">{r.departments.code}</Badge> : '-'}</td>
                        <td className="px-1.5 py-0.5 text-gray-500 whitespace-nowrap">{r.users?.full_name || r.users?.username || '-'}</td>
                        <td className="px-1.5 py-0.5 whitespace-nowrap">
                          {r.reference_number ? (
                            <button onClick={(e) => { e.stopPropagation(); setDocDetailMovement(r); }} className="text-primary-600 hover:text-primary-800 hover:underline font-medium">
                              {r.reference_number}
                            </button>
                          ) : '-'}{' '}
                          <span className="text-gray-400">{r.reference_type || ''}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
      {docDetailMovement && <DocDetailModal movement={docDetailMovement} onClose={() => setDocDetailMovement(null)} />}
    </div>
  );
}

export default StockBalancePage;
