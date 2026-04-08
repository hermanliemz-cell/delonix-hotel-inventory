import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { formatCurrency, formatNumber, formatDate } from '../utils/format';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';

function AmenitiesCostReportPage() {
  const { selectedOrg } = useApp();
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [periodPreset, setPeriodPreset] = useState('mtd');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState('summary'); // summary | detail
  const [sortBy, setSortBy] = useState('cost'); // cost | qty | name

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
  }, [selectedOrg, periodPreset, dateFrom, dateTo]);

  async function loadData() {
    setLoading(true);
    try {
      const range = getDateRange(periodPreset);

      // Get Guest Amenities parent category first
      const { data: amnCat } = await supabase
        .from('item_categories')
        .select('id')
        .eq('code', 'AMN')
        .maybeSingle();

      if (!amnCat) { setMovements([]); setLoading(false); return; }

      // Get subcategories
      const { data: childCats } = await supabase
        .from('item_categories')
        .select('id')
        .eq('parent_id', amnCat.id);

      const catIds = [amnCat.id, ...(childCats || []).map(c => c.id)];

      // Get items in these categories
      const { data: items } = await supabase
        .from('items')
        .select('id, code, name, brand, category_id, avg_cost, item_categories(code, name), units:unit_id(abbreviation)')
        .eq('organization_id', selectedOrg.id)
        .in('category_id', catIds);

      const itemMap = {};
      (items || []).forEach(i => { itemMap[i.id] = i; });
      const itemIds = Object.keys(itemMap);

      if (itemIds.length === 0) { setMovements([]); setLoading(false); return; }

      // Get OUT movements (consumption) for these items in date range
      let q = supabase
        .from('stock_movements')
        .select('id, item_id, quantity, unit_cost, reference_type, reference_number, notes, created_at, departments!left(code, name), warehouses!left(code, name)')
        .eq('organization_id', selectedOrg.id)
        .eq('movement_type', 'OUT')
        .in('item_id', itemIds)
        .order('created_at', { ascending: false });

      if (range.from) q = q.gte('created_at', range.from + 'T00:00:00');
      if (range.to) q = q.lte('created_at', range.to + 'T23:59:59');

      const { data: mvs, error: mvErr } = await q.limit(5000);
      if (mvErr) console.error('Movement query error:', mvErr);

      // Attach item info
      const enriched = (mvs || []).map(m => ({
        ...m,
        item: itemMap[m.item_id] || {},
        _cost: (m.quantity || 0) * (m.unit_cost || 0),
      }));

      setMovements(enriched);
    } catch (err) {
      console.error('Error loading amenities cost report:', err);
    } finally {
      setLoading(false);
    }
  }

  // Summary: group by item
  const summary = useMemo(() => {
    const map = {};
    movements.forEach(m => {
      const key = m.item_id;
      if (!map[key]) {
        map[key] = {
          item_id: key,
          code: m.item?.code || '',
          name: m.item?.name || '',
          brand: m.item?.brand || '',
          category: m.item?.item_categories?.name || '',
          unit: m.item?.units?.abbreviation || '',
          avg_cost: m.item?.avg_cost || 0,
          total_qty: 0,
          total_cost: 0,
          movement_count: 0,
        };
      }
      map[key].total_qty += (m.quantity || 0);
      map[key].total_cost += m._cost;
      map[key].movement_count += 1;
    });

    let arr = Object.values(map);
    if (sortBy === 'cost') arr.sort((a, b) => b.total_cost - a.total_cost);
    else if (sortBy === 'qty') arr.sort((a, b) => b.total_qty - a.total_qty);
    else arr.sort((a, b) => a.code.localeCompare(b.code));
    return arr;
  }, [movements, sortBy]);

  const totals = useMemo(() => {
    return {
      totalCost: movements.reduce((s, m) => s + m._cost, 0),
      totalQty: movements.reduce((s, m) => s + (m.quantity || 0), 0),
      totalMovements: movements.length,
      uniqueItems: new Set(movements.map(m => m.item_id)).size,
    };
  }, [movements]);

  const range = getDateRange(periodPreset);

  if (loading) return <PageLoader />;

  return (
    <div className="p-2 sm:p-4 md:p-6 max-w-full">
      <PageHeader
        title="Amenities Consumption Cost"
        subtitle="Laporan biaya konsumsi Guest Amenities per periode"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 mb-4">
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Total Biaya</div>
          <div className="text-lg font-bold text-red-600">{formatCurrency(totals.totalCost)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Total Qty Konsumsi</div>
          <div className="text-lg font-bold text-gray-800">{formatNumber(totals.totalQty)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Jumlah Transaksi</div>
          <div className="text-lg font-bold text-gray-800">{totals.totalMovements}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <div className="text-xs text-gray-500">Jenis Item</div>
          <div className="text-lg font-bold text-gray-800">{totals.uniqueItems}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Periode</label>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={periodPreset}
              onChange={e => setPeriodPreset(e.target.value)}>
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
          <div className="min-w-[100px]">
            <label className="block text-xs text-gray-500 mb-1">Tampilan</label>
            <select className="w-full border rounded px-2 py-1.5 text-sm" value={viewMode}
              onChange={e => setViewMode(e.target.value)}>
              <option value="summary">Ringkasan per Item</option>
              <option value="detail">Detail Transaksi</option>
            </select>
          </div>
          {viewMode === 'summary' && (
            <div className="min-w-[100px]">
              <label className="block text-xs text-gray-500 mb-1">Urutkan</label>
              <select className="w-full border rounded px-2 py-1.5 text-sm" value={sortBy}
                onChange={e => setSortBy(e.target.value)}>
                <option value="cost">Biaya Terbesar</option>
                <option value="qty">Qty Terbanyak</option>
                <option value="name">Nama Item</option>
              </select>
            </div>
          )}
        </div>
        {range.from && range.to && (
          <div className="mt-2 text-xs text-gray-400">
            Periode: {range.from} s/d {range.to}
          </div>
        )}
      </div>

      {/* Summary View */}
      {viewMode === 'summary' && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          {summary.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Tidak ada data konsumsi amenities di periode ini.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">No</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-center">Unit</th>
                  <th className="px-3 py-2 text-right">AVG Cost</th>
                  <th className="px-3 py-2 text-right">Total Qty</th>
                  <th className="px-3 py-2 text-right">Total Biaya</th>
                  <th className="px-3 py-2 text-right">% dari Total</th>
                  <th className="px-3 py-2 text-center">Transaksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.map((s, idx) => {
                  const pct = totals.totalCost > 0 ? (s.total_cost / totals.totalCost * 100) : 0;
                  return (
                    <tr key={s.item_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{s.code} - {s.name}</div>
                        {s.brand && <div className="text-xs text-gray-400">{s.brand}</div>}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500">{s.unit}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(s.avg_cost)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatNumber(s.total_qty)}</td>
                      <td className="px-3 py-2 text-right font-bold text-red-600">{formatCurrency(s.total_cost)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-16 bg-gray-100 rounded-full h-1.5">
                            <div className="bg-red-400 h-1.5 rounded-full" style={{ width: Math.min(pct, 100) + '%' }}></div>
                          </div>
                          <span className="text-xs text-gray-500 w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500">{s.movement_count}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan="4">TOTAL</td>
                  <td className="px-3 py-2 text-right">{formatNumber(totals.totalQty)}</td>
                  <td className="px-3 py-2 text-right text-red-700">{formatCurrency(totals.totalCost)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">100%</td>
                  <td className="px-3 py-2 text-center text-gray-500">{totals.totalMovements}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Detail View */}
      {viewMode === 'detail' && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          {movements.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Tidak ada data konsumsi amenities di periode ini.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Tanggal</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Ref</th>
                  <th className="px-3 py-2 text-left">Warehouse</th>
                  <th className="px-3 py-2 text-center">Unit</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit Cost</th>
                  <th className="px-3 py-2 text-right">Total Cost</th>
                  <th className="px-3 py-2 text-left">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {movements.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(m.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{m.item?.code}</div>
                      <div className="text-xs text-gray-400">{m.item?.name}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        m.reference_type === 'CONSUMPTION' ? 'bg-orange-100 text-orange-700' :
                        m.reference_type === 'USAGE' ? 'bg-red-100 text-red-700' :
                        m.reference_type === 'WRITEOFF' ? 'bg-gray-100 text-gray-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {m.reference_type}
                      </span>
                      {m.reference_number && <div className="text-xs text-gray-400 mt-0.5">{m.reference_number}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{m.warehouses?.code || '-'}</td>
                    <td className="px-3 py-2 text-center text-gray-500">{m.item?.units?.abbreviation || '-'}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(m.quantity)}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(m.unit_cost)}</td>
                    <td className="px-3 py-2 text-right font-medium text-red-600">{formatCurrency(m._cost)}</td>
                    <td className="px-3 py-2 text-xs text-gray-400 max-w-[200px] truncate">{m.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-bold">
                <tr>
                  <td className="px-3 py-2" colSpan="5">TOTAL</td>
                  <td className="px-3 py-2 text-right">{formatNumber(totals.totalQty)}</td>
                  <td className="px-3 py-2 text-right"></td>
                  <td className="px-3 py-2 text-right text-red-700">{formatCurrency(totals.totalCost)}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default AmenitiesCostReportPage;
