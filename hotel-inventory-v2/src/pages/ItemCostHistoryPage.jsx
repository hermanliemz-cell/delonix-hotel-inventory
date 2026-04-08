import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDate } from '../utils/format';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';

function ItemCostHistoryPage() {
  const { selectedOrg } = useApp();
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterItem, setFilterItem] = useState('');
  const [filterRefType, setFilterRefType] = useState('');
  const [periodPreset, setPeriodPreset] = useState('ytd');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [itemDropOpen, setItemDropOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const itemDropRef = useRef(null);

  function getDateRange(preset) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = yyyy + '-' + mm + '-' + dd;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
    const lastMonthEnd = new Date(yyyy, today.getMonth(), 0);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    const lmsStr = lastMonthStart.getFullYear() + '-' + String(lastMonthStart.getMonth() + 1).padStart(2, '0') + '-01';
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
      case 'custom': return { from: dateFrom, to: dateTo };
      default: return { from: '', to: '' };
    }
  }

  useEffect(() => {
    if (!selectedOrg) return;
    loadData();
  }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    try {
      // Load items
      const { data: items } = await supabase
        .from('items')
        .select('id, code, name, brand, avg_cost')
        .eq('organization_id', selectedOrg.id)
        .order('code');

      setAllItems(items || []);

      // Load cost history
      const { data: hist } = await supabase
        .from('item_cost_history')
        .select('*, items(code, name, brand)')
        .eq('organization_id', selectedOrg.id)
        .order('created_at', { ascending: false })
        .limit(500);

      setHistory(hist || []);
    } catch (err) {
      console.error('Error loading cost history:', err);
    } finally {
      setLoading(false);
    }
  }

  // Click outside to close item dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (itemDropRef.current && !itemDropRef.current.contains(e.target)) {
        setItemDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    let data = history;
    const range = getDateRange(periodPreset);

    if (filterItem) {
      data = data.filter(h => h.item_id === filterItem);
    }
    if (filterRefType) {
      data = data.filter(h => h.reference_type === filterRefType);
    }
    if (range.from) {
      data = data.filter(h => h.created_at >= range.from + 'T00:00:00');
    }
    if (range.to) {
      data = data.filter(h => h.created_at <= range.to + 'T23:59:59');
    }
    return data;
  }, [history, filterItem, filterRefType, periodPreset, dateFrom, dateTo]);

  const itemOptions = useMemo(() => {
    const search = itemSearch.toLowerCase();
    return allItems.filter(i =>
      !search || i.code?.toLowerCase().includes(search) || i.name?.toLowerCase().includes(search)
    );
  }, [allItems, itemSearch]);

  const selectedItemLabel = useMemo(() => {
    if (!filterItem) return 'Semua Item';
    const item = allItems.find(i => i.id === filterItem);
    return item ? `${item.code} - ${item.name}` : 'Semua Item';
  }, [filterItem, allItems]);

  const refTypes = [...new Set(history.map(h => h.reference_type).filter(Boolean))];

  if (loading) return <PageLoader />;

  return (
    <div className="p-2 sm:p-4 md:p-6 max-w-full">
      <PageHeader title="Item Cost History" subtitle="Riwayat perubahan harga rata-rata (AVG Cost) per item" />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4">
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Total Perubahan</div>
          <div className="text-lg font-bold text-gray-800">{filtered.length}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Items Terdampak</div>
          <div className="text-lg font-bold text-gray-800">
            {new Set(filtered.map(h => h.item_id)).size}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Items dengan Cost</div>
          <div className="text-lg font-bold text-gray-800">
            {allItems.filter(i => i.avg_cost > 0).length}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Total Items</div>
          <div className="text-lg font-bold text-gray-800">{allItems.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-end">
          {/* Period */}
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={periodPreset}
              onChange={e => setPeriodPreset(e.target.value)}>
              <option value="all">Semua</option>
              <option value="today">Hari Ini</option>
              <option value="yesterday">Kemarin</option>
              <option value="lastweek">7 Hari Terakhir</option>
              <option value="mtd">Bulan Ini</option>
              <option value="lastmonth">Bulan Lalu</option>
              <option value="ytd">Tahun Ini</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {periodPreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Dari</label>
                <input type="date" className="border rounded px-2 py-1.5 text-sm" value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Sampai</label>
                <input type="date" className="border rounded px-2 py-1.5 text-sm" value={dateTo}
                  onChange={e => setDateTo(e.target.value)} />
              </div>
            </>
          )}

          {/* Item filter with search dropdown */}
          <div className="min-w-[200px] relative" ref={itemDropRef}>
            <label className="block text-xs text-gray-500 mb-1">Item</label>
            <button
              className="w-full border rounded px-2 py-1.5 text-sm text-left bg-white truncate"
              onClick={() => setItemDropOpen(!itemDropOpen)}
            >
              {selectedItemLabel}
            </button>
            {itemDropOpen && (
              <div className="absolute z-50 mt-1 w-72 bg-white border rounded shadow-lg max-h-64 overflow-auto">
                <div className="sticky top-0 bg-white p-1 border-b">
                  <input
                    type="text"
                    className="w-full border rounded px-2 py-1 text-sm"
                    placeholder="Cari item..."
                    value={itemSearch}
                    onChange={e => setItemSearch(e.target.value)}
                    autoFocus
                  />
                </div>
                <div
                  className="px-3 py-1.5 text-sm hover:bg-blue-50 cursor-pointer"
                  onClick={() => { setFilterItem(''); setItemDropOpen(false); }}
                >
                  Semua Item
                </div>
                {itemOptions.map(item => (
                  <div
                    key={item.id}
                    className={`px-3 py-1.5 text-sm hover:bg-blue-50 cursor-pointer ${filterItem === item.id ? 'bg-blue-100' : ''}`}
                    onClick={() => { setFilterItem(item.id); setItemDropOpen(false); setItemSearch(''); }}
                  >
                    <span className="font-medium">{item.code}</span> - {item.name}
                    {item.avg_cost > 0 && <span className="text-xs text-gray-400 ml-2">({formatCurrency(item.avg_cost)})</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reference type */}
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Tipe Referensi</label>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={filterRefType}
              onChange={e => setFilterRefType(e.target.value)}>
              <option value="">Semua</option>
              {refTypes.map(rt => <option key={rt} value={rt}>{rt}</option>)}
            </select>
          </div>

          <button onClick={loadData} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Refresh
          </button>
        </div>
      </div>

      {/* Current AVG Cost per Item (jika filter item aktif) */}
      {filterItem && (() => {
        const item = allItems.find(i => i.id === filterItem);
        if (!item) return null;
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium text-blue-800">{item.code} - {item.name}</span>
                {item.brand && <span className="text-blue-600 text-sm ml-2">({item.brand})</span>}
              </div>
              <div className="text-right">
                <div className="text-xs text-blue-500">Current AVG Cost</div>
                <div className="text-lg font-bold text-blue-800">{formatCurrency(item.avg_cost)}</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {history.length === 0
              ? 'Belum ada riwayat perubahan harga. Riwayat akan tercatat otomatis saat ada GR, Direct Purchase, atau Opening Balance baru.'
              : 'Tidak ada data yang sesuai filter.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Tanggal</th>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Ref</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit Cost</th>
                <th className="px-3 py-2 text-right">Old AVG</th>
                <th className="px-3 py-2 text-right">New AVG</th>
                <th className="px-3 py-2 text-right">Selisih</th>
                <th className="px-3 py-2 text-right">Total Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(h => {
                const diff = (h.new_avg_cost || 0) - (h.old_avg_cost || 0);
                const diffPct = h.old_avg_cost > 0 ? (diff / h.old_avg_cost * 100) : 0;
                return (
                  <tr key={h.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(h.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{h.items?.code}</div>
                      <div className="text-xs text-gray-400">{h.items?.name}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        h.reference_type === 'GR' ? 'bg-green-100 text-green-700' :
                        h.reference_type === 'DIRECT_PURCHASE' ? 'bg-blue-100 text-blue-700' :
                        h.reference_type === 'OPENING_BALANCE' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {h.reference_type}
                      </span>
                      {h.reference_number && (
                        <div className="text-xs text-gray-400 mt-0.5">{h.reference_number}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(h.movement_qty)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(h.movement_unit_cost)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(h.old_avg_cost)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(h.new_avg_cost)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                      {h.old_avg_cost > 0 && (
                        <div className="text-xs">({diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%)</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(h.total_qty_after)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default ItemCostHistoryPage;
