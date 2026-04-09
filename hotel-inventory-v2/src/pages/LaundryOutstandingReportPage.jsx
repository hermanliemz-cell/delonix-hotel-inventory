import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { formatNumber, formatDate } from '../utils/format';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';
import { Button } from '../components/FormElements';
import { Icons } from '../components/Icons';

// ============================================================
// LAUNDRY OUTSTANDING & HISTORY REPORT
// ============================================================
// Calculates daily outstanding per item per vendor:
//   Beginning Outstanding = cumulative (send - receive) BEFORE the date
//   Send = LAUNDRY_SEND qty on the date
//   Received = LAUNDRY_RECEIVE qty on the date
//   Ending Outstanding = Beginning + Send - Received
//
// Data source: stock_movements (reference_type LAUNDRY_SEND / LAUNDRY_RECEIVE)
// No new tables needed — 100% derived from existing movements.
// ============================================================

function LaundryOutstandingReportPage() {
  const { selectedOrg } = useApp();

  // --- filters ---
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [periodPreset, setPeriodPreset] = useState('currentweek');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // --- data ---
  const [movements, setMovements] = useState([]);
  const [priorMovements, setPriorMovements] = useState([]);
  const [loading, setLoading] = useState(false);

  // ============================================================
  // DATE HELPERS
  // ============================================================
  function getDateRange(preset) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - today.getDay()); // Sunday
    const wsStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

    const lastMonthEnd = new Date(yyyy, today.getMonth(), 0);
    const lmsStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-01`;
    const lmeStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(lastMonthEnd.getDate()).padStart(2, '0')}`;

    switch (preset) {
      case 'today': return { from: todayStr, to: todayStr };
      case 'yesterday': return { from: ydStr, to: ydStr };
      case 'currentweek': return { from: wsStr, to: todayStr };
      case 'currentmonth': return { from: `${yyyy}-${mm}-01`, to: todayStr };
      case 'lastmonth': return { from: lmsStr, to: lmeStr };
      case 'custom': return { from: dateFrom, to: dateTo };
      default: return { from: todayStr, to: todayStr };
    }
  }

  // Generate array of date strings between from..to
  function getDatesBetween(from, to) {
    const dates = [];
    const d = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  // ============================================================
  // LOAD VENDORS on mount
  // ============================================================
  useEffect(() => {
    if (!selectedOrg) return;
    (async () => {
      const { data } = await supabase.from('vendors')
        .select('id, code, name')
        .eq('is_active', true)
        .order('name');
      setVendors(data || []);
    })();
  }, [selectedOrg]);

  // ============================================================
  // LOAD DATA when filters change
  // ============================================================
  useEffect(() => {
    if (!selectedOrg) return;
    loadData();
  }, [selectedOrg, selectedVendor, periodPreset, dateFrom, dateTo]);

  async function loadData() {
    const range = getDateRange(periodPreset);
    if (!range.from || !range.to) return;

    setLoading(true);
    try {
      // --- Build base filter ---
      const baseFilter = (q) => {
        q = q.eq('organization_id', selectedOrg.id)
          .in('reference_type', ['LAUNDRY_SEND', 'LAUNDRY_RECEIVE'])
          .eq('movement_type', 'OUT'); // Each batch creates OUT+IN pair; use OUT to avoid double count
        if (selectedVendor) q = q.eq('vendor_id', selectedVendor);
        return q;
      };

      // 1) Movements WITHIN the date range (for daily send/receive)
      let q1 = supabase.from('stock_movements')
        .select('item_id, quantity, reference_type, vendor_id, created_at, items:item_id(code, name), vendors:vendor_id(code, name)')
        .gte('created_at', range.from + 'T00:00:00')
        .lte('created_at', range.to + 'T23:59:59')
        .order('created_at', { ascending: true });
      q1 = baseFilter(q1);
      const { data: inRange } = await q1.limit(5000);

      // 2) Movements BEFORE range.from (to calculate beginning outstanding)
      let q2 = supabase.from('stock_movements')
        .select('item_id, quantity, reference_type, vendor_id')
        .lt('created_at', range.from + 'T00:00:00');
      q2 = baseFilter(q2);
      const { data: prior } = await q2.limit(10000);

      setMovements(inRange || []);
      setPriorMovements(prior || []);
    } catch (e) {
      console.error('LaundryOutstandingReport load error:', e);
    }
    setLoading(false);
  }

  // ============================================================
  // COMPUTE REPORT DATA
  // ============================================================
  const reportData = useMemo(() => {
    const range = getDateRange(periodPreset);
    if (!range.from || !range.to) return { dates: [], rows: [] };
    const dates = getDatesBetween(range.from, range.to);

    // --- Build prior outstanding per (item_id, vendor_id) ---
    const priorMap = {}; // key: `${item_id}|${vendor_id}` -> net qty
    (priorMovements || []).forEach(m => {
      const key = `${m.item_id}|${m.vendor_id || 'none'}`;
      if (!priorMap[key]) priorMap[key] = 0;
      if (m.reference_type === 'LAUNDRY_SEND') priorMap[key] += parseFloat(m.quantity) || 0;
      else if (m.reference_type === 'LAUNDRY_RECEIVE') priorMap[key] -= parseFloat(m.quantity) || 0;
    });

    // --- Build daily send/receive per (item_id, vendor_id, date) ---
    const dailyMap = {}; // key: `${item_id}|${vendor_id}|${date}` -> { send, receive }
    const itemMeta = {}; // item_id -> { code, name }
    (movements || []).forEach(m => {
      const dateStr = (m.created_at || '').slice(0, 10);
      const vId = m.vendor_id || 'none';
      const key = `${m.item_id}|${vId}|${dateStr}`;
      if (!dailyMap[key]) dailyMap[key] = { send: 0, receive: 0 };
      if (m.reference_type === 'LAUNDRY_SEND') dailyMap[key].send += parseFloat(m.quantity) || 0;
      else if (m.reference_type === 'LAUNDRY_RECEIVE') dailyMap[key].receive += parseFloat(m.quantity) || 0;

      // meta
      if (m.items) itemMeta[m.item_id] = { code: m.items.code, name: m.items.name };
    });

    // --- Collect all unique (item_id, vendor_id) combos ---
    const comboSet = new Set();
    Object.keys(priorMap).forEach(k => comboSet.add(k));
    (movements || []).forEach(m => comboSet.add(`${m.item_id}|${m.vendor_id || 'none'}`));

    // --- Build rows ---
    const rows = [];
    comboSet.forEach(comboKey => {
      const [itemId, vendorId] = comboKey.split('|');
      const item = itemMeta[itemId];
      if (!item && !priorMap[comboKey]) return; // skip if no data

      const dailyCols = [];
      let running = priorMap[comboKey] || 0;

      for (const date of dates) {
        const dk = `${itemId}|${vendorId}|${date}`;
        const day = dailyMap[dk] || { send: 0, receive: 0 };
        const beginning = running;
        const ending = beginning + day.send - day.receive;
        dailyCols.push({ date, beginning, send: day.send, receive: day.receive, ending });
        running = ending;
      }

      // Only include if there's any activity or outstanding
      const hasActivity = dailyCols.some(d => d.send > 0 || d.receive > 0 || d.beginning > 0 || d.ending > 0);
      if (!hasActivity) return;

      // find vendor name from movements
      let vendorName = '-';
      if (vendorId !== 'none') {
        const mv = (movements || []).find(m => m.vendor_id === vendorId && m.vendors);
        if (mv && mv.vendors) vendorName = mv.vendors.name;
      }

      rows.push({
        itemId,
        vendorId,
        code: item?.code || '-',
        name: item?.name || '-',
        vendorName,
        daily: dailyCols,
      });
    });

    // Sort by item code
    rows.sort((a, b) => a.code.localeCompare(b.code));

    // --- Summary totals ---
    const totals = dates.map((date, di) => {
      let beginning = 0, send = 0, receive = 0, ending = 0;
      rows.forEach(r => {
        beginning += r.daily[di].beginning;
        send += r.daily[di].send;
        receive += r.daily[di].receive;
        ending += r.daily[di].ending;
      });
      return { date, beginning, send, receive, ending };
    });

    return { dates, rows, totals };
  }, [movements, priorMovements, periodPreset, dateFrom, dateTo]);

  // ============================================================
  // FORMAT HELPERS
  // ============================================================
  function fmtDateShort(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtNum(n) {
    if (!n || n === 0) return '-';
    return formatNumber(n);
  }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Laundry Outstanding & History"
        subtitle="Track laundry items outstanding at vendors"
      />

      <div className="p-4 space-y-4 flex-1 overflow-auto">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 bg-white rounded-lg border p-4">
          {/* Vendor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm min-w-[200px]"
              value={selectedVendor}
              onChange={e => setSelectedVendor(e.target.value)}
            >
              <option value="">-- All Vendors --</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>

          {/* Date Range Preset */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date Range</label>
            <select
              className="border rounded-lg px-3 py-2 text-sm"
              value={periodPreset}
              onChange={e => setPeriodPreset(e.target.value)}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="currentweek">Current Week</option>
              <option value="currentmonth">Current Month</option>
              <option value="lastmonth">Last Month</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {periodPreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="date" className="border rounded-lg px-3 py-2 text-sm"
                  value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="date" className="border rounded-lg px-3 py-2 text-sm"
                  value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </>
          )}

          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <Icons.RotateCcw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        {!loading && reportData.rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(() => {
              const lastDay = reportData.totals[reportData.totals.length - 1];
              const totalSend = reportData.totals.reduce((s, t) => s + t.send, 0);
              const totalReceive = reportData.totals.reduce((s, t) => s + t.receive, 0);
              return (
                <>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Current Outstanding</div>
                    <div className="text-2xl font-bold text-orange-600">{formatNumber(lastDay?.ending || 0)}</div>
                    <div className="text-xs text-gray-400">pcs at vendors</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Sent</div>
                    <div className="text-2xl font-bold text-blue-600">{formatNumber(totalSend)}</div>
                    <div className="text-xs text-gray-400">in period</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Received</div>
                    <div className="text-2xl font-bold text-green-600">{formatNumber(totalReceive)}</div>
                    <div className="text-xs text-gray-400">in period</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Unique Items</div>
                    <div className="text-2xl font-bold text-gray-700">{reportData.rows.length}</div>
                    <div className="text-xs text-gray-400">items tracked</div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Report Table */}
        {loading ? (
          <PageLoader />
        ) : reportData.rows.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Icons.Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No laundry movements found for this period.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th rowSpan={2} className="sticky left-0 bg-gray-50 z-10 px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">
                    Item Code
                  </th>
                  <th rowSpan={2} className="sticky left-[100px] bg-gray-50 z-10 px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">
                    Item Name
                  </th>
                  {!selectedVendor && (
                    <th rowSpan={2} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">
                      Vendor
                    </th>
                  )}
                  {reportData.dates.map(date => (
                    <th key={date} colSpan={4} className="px-1 py-2 text-center font-semibold text-gray-700 border-b border-r bg-gray-100">
                      {fmtDateShort(date)}
                    </th>
                  ))}
                </tr>
                <tr className="bg-gray-50">
                  {reportData.dates.map(date => (
                    <React.Fragment key={date}>
                      <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-orange-50">Beg. O/S</th>
                      <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-green-50">Received</th>
                      <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-blue-50">Send</th>
                      <th className="px-2 py-1 text-center text-gray-500 border-b border-r font-medium whitespace-nowrap bg-orange-50">End O/S</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="sticky left-0 bg-inherit z-10 px-3 py-1.5 font-mono text-gray-700 border-r whitespace-nowrap">
                      {row.code}
                    </td>
                    <td className="sticky left-[100px] bg-inherit z-10 px-3 py-1.5 text-gray-800 border-r whitespace-nowrap">
                      {row.name}
                    </td>
                    {!selectedVendor && (
                      <td className="px-3 py-1.5 text-gray-600 border-r whitespace-nowrap">{row.vendorName}</td>
                    )}
                    {row.daily.map((d, di) => (
                      <React.Fragment key={di}>
                        <td className="px-2 py-1.5 text-center text-orange-700 bg-orange-50/30">{fmtNum(d.beginning)}</td>
                        <td className="px-2 py-1.5 text-center text-green-700 bg-green-50/30">{fmtNum(d.receive)}</td>
                        <td className="px-2 py-1.5 text-center text-blue-700 bg-blue-50/30">{fmtNum(d.send)}</td>
                        <td className="px-2 py-1.5 text-center font-semibold text-orange-800 bg-orange-50/30 border-r">{fmtNum(d.ending)}</td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
                {/* Totals Row */}
                <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                  <td className="sticky left-0 bg-gray-100 z-10 px-3 py-2 border-r" colSpan={1}>TOTAL</td>
                  <td className="sticky left-[100px] bg-gray-100 z-10 px-3 py-2 border-r"></td>
                  {!selectedVendor && <td className="border-r"></td>}
                  {reportData.totals.map((t, ti) => (
                    <React.Fragment key={ti}>
                      <td className="px-2 py-2 text-center text-orange-800 bg-orange-100/50">{fmtNum(t.beginning)}</td>
                      <td className="px-2 py-2 text-center text-green-800 bg-green-100/50">{fmtNum(t.receive)}</td>
                      <td className="px-2 py-2 text-center text-blue-800 bg-blue-100/50">{fmtNum(t.send)}</td>
                      <td className="px-2 py-2 text-center text-orange-900 bg-orange-100/50 border-r">{fmtNum(t.ending)}</td>
                    </React.Fragment>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default LaundryOutstandingReportPage;
