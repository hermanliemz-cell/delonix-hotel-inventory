import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { formatNumber } from '../utils/format';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';
import { Button } from '../components/FormElements';
import { Icons } from '../components/Icons';

// ============================================================
// LAUNDRY OUTSTANDING & HISTORY REPORT V2
// ============================================================
// Per-date columns:
//   Beg O/S      = outstanding at start of the date
//   Send (H-1)   = LAUNDRY_SEND qty on the PREVIOUS day
//   Received     = LAUNDRY_RECEIVE qty on the date itself
//   End O/S      = Beg O/S + Send(H-1) - Received
//
// Data source: stock_movements (reference_type LAUNDRY_SEND / LAUNDRY_RECEIVE)
// ============================================================

function LaundryOutstandingReport2Page() {
  const { selectedOrg } = useApp();

  const [vendors, setVendors] = useState([]);
  const BONVIVO_VENDOR_ID = '27a3bed2-7ff6-48f6-b579-e999def3dcfc';
  const [selectedVendor, setSelectedVendor] = useState(BONVIVO_VENDOR_ID);
  const [periodPreset, setPeriodPreset] = useState('last2months');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [movements, setMovements] = useState([]);
  const [priorMovements, setPriorMovements] = useState([]);
  const [openingBalances, setOpeningBalances] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(false);

  // ============================================================
  // DATE / TZ HELPERS
  // ============================================================
  const TZ_OFFSETS = { 'Asia/Bangkok': '+07:00', 'Asia/Singapore': '+08:00', 'Asia/Jayapura': '+09:00' };
  function getSystemTz() { return window.__systemSettings?.timezone || 'Asia/Bangkok'; }

  function nowInTz() {
    const tz = getSystemTz();
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const y = p.find(x => x.type === 'year').value;
    const m = p.find(x => x.type === 'month').value;
    const d = p.find(x => x.type === 'day').value;
    return { y, m, d, str: `${y}-${m}-${d}` };
  }

  function fmtDateStr(date) {
    const tz = getSystemTz();
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}-${p.find(x => x.type === 'day').value}`;
  }

  function getDateRange(preset) {
    const now = new Date();
    const { y: yyyy, m: mm, str: todayStr } = nowInTz();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = fmtDateStr(yesterday);
    const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - now.getDay());
    const wsStr = fmtDateStr(weekStart);
    const lastMonthEnd = new Date(parseInt(yyyy), parseInt(mm) - 1, 0);
    const lmsStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, '0')}-01`;
    const lmeStr = fmtDateStr(lastMonthEnd);

    switch (preset) {
      case 'all': return { from: '2020-01-01', to: todayStr };
      case 'today': return { from: todayStr, to: todayStr };
      case 'yesterday': return { from: ydStr, to: ydStr };
      case 'currentweek': return { from: wsStr, to: todayStr };
      case 'currentmonth': return { from: `${yyyy}-${mm}-01`, to: todayStr };
      case 'lastmonth': return { from: lmsStr, to: lmeStr };
      case 'last2months': {
        const d2m = new Date(parseInt(yyyy), parseInt(mm) - 3, 1);
        const d2mStr = `${d2m.getFullYear()}-${String(d2m.getMonth() + 1).padStart(2, '0')}-01`;
        return { from: d2mStr, to: todayStr };
      }
      case 'custom': return { from: dateFrom, to: dateTo };
      default: return { from: todayStr, to: todayStr };
    }
  }

  function toUtcStart(localDate) { return `${localDate}T00:00:00${TZ_OFFSETS[getSystemTz()] || '+07:00'}`; }
  function toUtcEnd(localDate) { return `${localDate}T23:59:59${TZ_OFFSETS[getSystemTz()] || '+07:00'}`; }

  // Subtract 1 day from a YYYY-MM-DD string
  function prevDay(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function getDatesBetween(from, to) {
    const dates = [];
    const [fy, fm, fd] = from.split('-').map(Number);
    const d = new Date(fy, fm - 1, fd);
    const [ty, tm, td] = to.split('-').map(Number);
    const end = new Date(ty, tm - 1, td);
    while (d <= end) {
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  // ============================================================
  // LOAD VENDORS
  // ============================================================
  useEffect(() => {
    if (!selectedOrg) return;
    (async () => {
      const { data } = await supabase.from('vendors').select('id, code, name').eq('is_active', true).order('name');
      setVendors(data || []);
    })();
  }, [selectedOrg]);

  // ============================================================
  // LOAD DATA — extend range to include H-1 for Send column
  // ============================================================
  useEffect(() => { if (selectedOrg) loadData(); }, [selectedOrg, selectedVendor, periodPreset, dateFrom, dateTo]);

  async function loadData() {
    const range = getDateRange(periodPreset);
    if (!range.from || !range.to) return;

    // We need Send data from the day BEFORE range.from (H-1 of first date)
    const extendedFrom = prevDay(range.from);

    setLoading(true);
    try {
      const baseFilter = (q) => {
        q = q.eq('organization_id', selectedOrg.id)
          .in('reference_type', ['LAUNDRY_SEND', 'LAUNDRY_RECEIVE'])
          .eq('movement_type', 'OUT');
        if (selectedVendor) q = q.eq('vendor_id', selectedVendor);
        return q;
      };

      // 1) Movements from extendedFrom..to (includes H-1 send data)
      let q1 = supabase.from('stock_movements')
        .select('item_id, quantity, reference_type, vendor_id, created_at, items:item_id(code, name), vendors:vendor_id(code, name)')
        .gte('created_at', toUtcStart(extendedFrom))
        .lte('created_at', toUtcEnd(range.to))
        .order('created_at', { ascending: true });
      q1 = baseFilter(q1);
      const { data: inRange } = await q1.limit(5000);

      // 2) Movements BEFORE extendedFrom (for beginning outstanding)
      let q2 = supabase.from('stock_movements')
        .select('item_id, quantity, reference_type, vendor_id')
        .lt('created_at', toUtcStart(extendedFrom));
      q2 = baseFilter(q2);
      const { data: prior } = await q2.limit(10000);

      // 3) Opening balance for laundry warehouse (vendor_id is null, attribute to BonVivo)
      const { data: laundryWh } = await supabase.from('warehouses')
        .select('id').eq('organization_id', selectedOrg.id).eq('warehouse_type', 'laundry').limit(1);
      let obData = [];
      if (laundryWh && laundryWh.length > 0) {
        const { data: ob } = await supabase.from('stock_movements')
          .select('item_id, quantity, created_at, items:item_id(code, name)')
          .eq('organization_id', selectedOrg.id)
          .eq('warehouse_id', laundryWh[0].id)
          .eq('reference_type', 'OPENING_BALANCE')
          .eq('movement_type', 'IN');
        obData = ob || [];
      }

      // 4) TRANSFER movements in laundry warehouse (corrections, vendor_id null → attribute to BonVivo)
      let transferData = [];
      if (laundryWh && laundryWh.length > 0) {
        const { data: tr } = await supabase.from('stock_movements')
          .select('item_id, quantity, movement_type, created_at, items:item_id(code, name)')
          .eq('organization_id', selectedOrg.id)
          .eq('warehouse_id', laundryWh[0].id)
          .eq('reference_type', 'TRANSFER');
        transferData = tr || [];
      }

      setMovements(inRange || []);
      setPriorMovements(prior || []);
      setOpeningBalances(obData);
      setTransfers(transferData);
    } catch (e) {
      console.error('LaundryOutstandingReport2 load error:', e);
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
    // Extended dates includes H-1 of first date (for send data)
    const extendedFrom = prevDay(range.from);
    const allDates = [extendedFrom, ...dates];

    // --- Prior outstanding (before extendedFrom) ---
    const priorMap = {};
    const tz = getSystemTz();

    // Include opening balance of laundry warehouse (attribute to BonVivo)
    (openingBalances || []).forEach(ob => {
      const obDate = ob.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ob.created_at))
        : '2020-01-01';
      if (obDate < extendedFrom) {
        const key = `${ob.item_id}|${BONVIVO_VENDOR_ID}`;
        if (!priorMap[key]) priorMap[key] = 0;
        priorMap[key] += parseFloat(ob.quantity) || 0;
      }
    });

    (priorMovements || []).forEach(m => {
      const key = `${m.item_id}|${m.vendor_id || 'none'}`;
      if (!priorMap[key]) priorMap[key] = 0;
      if (m.reference_type === 'LAUNDRY_SEND') priorMap[key] += parseFloat(m.quantity) || 0;
      else if (m.reference_type === 'LAUNDRY_RECEIVE') priorMap[key] -= parseFloat(m.quantity) || 0;
    });

    // Include TRANSFER movements in laundry warehouse before extendedFrom (attribute to BonVivo)
    (transfers || []).forEach(tr => {
      const trDate = tr.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tr.created_at))
        : '2020-01-01';
      if (trDate < extendedFrom) {
        const key = `${tr.item_id}|${BONVIVO_VENDOR_ID}`;
        if (!priorMap[key]) priorMap[key] = 0;
        const qty = parseFloat(tr.quantity) || 0;
        priorMap[key] += tr.movement_type === 'IN' ? qty : -qty;
      }
    });

    // --- Build daily send/receive for ALL dates (including extended) ---
    const dailyMap = {};
    const itemMeta = {};
    (movements || []).forEach(m => {
      const dateStr = m.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(m.created_at))
        : '';
      const vId = m.vendor_id || 'none';
      const key = `${m.item_id}|${vId}|${dateStr}`;
      if (!dailyMap[key]) dailyMap[key] = { send: 0, receive: 0, ob: 0, adj: 0 };
      if (m.reference_type === 'LAUNDRY_SEND') dailyMap[key].send += parseFloat(m.quantity) || 0;
      else if (m.reference_type === 'LAUNDRY_RECEIVE') dailyMap[key].receive += parseFloat(m.quantity) || 0;
      if (m.items) itemMeta[m.item_id] = { code: m.items.code, name: m.items.name };
    });

    // Include opening balance items within range
    (openingBalances || []).forEach(ob => {
      const obDate = ob.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ob.created_at))
        : '';
      if (obDate >= extendedFrom && obDate <= range.to) {
        const key = `${ob.item_id}|${BONVIVO_VENDOR_ID}|${obDate}`;
        if (!dailyMap[key]) dailyMap[key] = { send: 0, receive: 0, ob: 0, adj: 0 };
        dailyMap[key].ob += parseFloat(ob.quantity) || 0;
      }
      if (ob.items) itemMeta[ob.item_id] = { code: ob.items.code, name: ob.items.name };
    });

    // Include TRANSFER movements within range in dailyMap (attribute to BonVivo)
    (transfers || []).forEach(tr => {
      const trDate = tr.created_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(tr.created_at))
        : '';
      if (trDate >= extendedFrom && trDate <= range.to) {
        const key = `${tr.item_id}|${BONVIVO_VENDOR_ID}|${trDate}`;
        if (!dailyMap[key]) dailyMap[key] = { send: 0, receive: 0, ob: 0, adj: 0 };
        const qty = parseFloat(tr.quantity) || 0;
        dailyMap[key].adj += tr.movement_type === 'IN' ? qty : -qty;
      }
      if (tr.items) itemMeta[tr.item_id] = { code: tr.items.code, name: tr.items.name };
    });

    // --- Collect combos ---
    const comboSet = new Set();
    Object.keys(priorMap).forEach(k => comboSet.add(k));
    (movements || []).forEach(m => comboSet.add(`${m.item_id}|${m.vendor_id || 'none'}`));
    (openingBalances || []).forEach(ob => comboSet.add(`${ob.item_id}|${BONVIVO_VENDOR_ID}`));
    (transfers || []).forEach(tr => comboSet.add(`${tr.item_id}|${BONVIVO_VENDOR_ID}`));

    // --- Build rows ---
    const rows = [];
    comboSet.forEach(comboKey => {
      const [itemId, vendorId] = comboKey.split('|');
      const item = itemMeta[itemId];
      if (!item && !priorMap[comboKey]) return;

      // First, compute raw daily data for ALL dates (extended + range)
      const rawDaily = {};
      let running = priorMap[comboKey] || 0;
      for (const date of allDates) {
        const dk = `${itemId}|${vendorId}|${date}`;
        const day = dailyMap[dk] || { send: 0, receive: 0, ob: 0, adj: 0 };
        const beginning = Math.max(0, running) + day.ob; // cap negative, then add OB
        rawDaily[date] = { beginning, send: day.send, receive: day.receive, adj: day.adj, ending: beginning + day.send - day.receive + day.adj };
        running = rawDaily[date].ending;
      }

      // Now build display columns with V2's own running balance:
      // End OS = Beg OS + Send(H-1) - Received(today), then next day's Beg OS = prev End OS
      let v2Running = rawDaily[dates[0]]?.beginning || 0;
      const dailyCols = dates.map(date => {
        const hMinus1 = prevDay(date);
        const cur = rawDaily[date] || { beginning: 0, send: 0, receive: 0, adj: 0, ending: 0 };
        const prev = rawDaily[hMinus1] || { send: 0 };
        const sendH1 = prev.send;
        const begOS = v2Running;
        const received = cur.receive;
        const adj = cur.adj;
        const endOS = begOS + sendH1 - received + adj;
        v2Running = endOS;
        return { date, beginning: begOS, sendH1, sendDate: hMinus1, receive: received, ending: endOS };
      });

      const hasActivity = dailyCols.some(d => d.sendH1 > 0 || d.receive > 0 || d.beginning > 0 || d.ending > 0);
      if (!hasActivity) return;

      let vendorName = '-';
      if (vendorId !== 'none') {
        const mv = (movements || []).find(m => m.vendor_id === vendorId && m.vendors);
        if (mv && mv.vendors) vendorName = mv.vendors.name;
      }

      rows.push({ itemId, vendorId, code: item?.code || '-', name: item?.name || '-', vendorName, daily: dailyCols });
    });

    rows.sort((a, b) => a.code.localeCompare(b.code));

    const totals = dates.map((date, di) => {
      let beginning = 0, sendH1 = 0, receive = 0, ending = 0;
      rows.forEach(r => {
        beginning += r.daily[di].beginning;
        sendH1 += r.daily[di].sendH1;
        receive += r.daily[di].receive;
        ending += r.daily[di].ending;
      });
      return { date, beginning, sendH1, sendDate: prevDay(date), receive, ending };
    });

    return { dates, rows, totals };
  }, [movements, priorMovements, openingBalances, transfers, periodPreset, dateFrom, dateTo]);

  // ============================================================
  // FORMAT HELPERS
  // ============================================================
  function fmtDateShort(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
  }
  function fmtNum(n) { return (!n || n === 0) ? '-' : formatNumber(n); }

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Laundry Outstanding V2" subtitle="Outstanding with Send H-1 view" />

      <div className="p-4 space-y-4 flex-1 overflow-auto">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 bg-white rounded-lg border p-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
            <select className="border rounded-lg px-3 py-2 text-sm min-w-[200px]" value={selectedVendor} onChange={e => setSelectedVendor(e.target.value)}>
              <option value="">-- All Vendors --</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date Range</label>
            <select className="border rounded-lg px-3 py-2 text-sm" value={periodPreset} onChange={e => setPeriodPreset(e.target.value)}>
              <option value="all">All</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="currentweek">Current Week</option>
              <option value="currentmonth">Current Month</option>
              <option value="lastmonth">Last Month</option>
              <option value="last2months">Last 2 Months</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          {periodPreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
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
              const totalSend = reportData.totals.reduce((s, t) => s + t.sendH1, 0);
              const totalReceive = reportData.totals.reduce((s, t) => s + t.receive, 0);
              return (
                <>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Current Outstanding</div>
                    <div className="text-2xl font-bold text-orange-600">{formatNumber(lastDay?.ending || 0)}</div>
                    <div className="text-xs text-gray-400">pcs at vendors</div>
                  </div>
                  <div className="bg-white rounded-lg border p-4">
                    <div className="text-xs text-gray-500">Total Sent (H-1)</div>
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
                {/* Row 1: Date headers */}
                <tr className="bg-gray-50">
                  <th rowSpan={2} className="sticky left-0 bg-gray-50 z-10 px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">Item Code</th>
                  <th rowSpan={2} className="sticky left-[100px] bg-gray-50 z-10 px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">Item Name</th>
                  {!selectedVendor && (
                    <th rowSpan={2} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-r whitespace-nowrap">Vendor</th>
                  )}
                  {reportData.dates.map(date => (
                    <th key={date} colSpan={4} className="px-1 py-2 text-center font-semibold text-gray-700 border-b border-r bg-gray-100">
                      {fmtDateShort(date)}
                    </th>
                  ))}
                </tr>
                {/* Row 2: Sub-headers with H-1 date labels */}
                <tr className="bg-gray-50">
                  {reportData.dates.map((date, di) => {
                    const sendDate = prevDay(date);
                    return (
                      <React.Fragment key={date}>
                        <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-orange-50">
                          Beg O/S
                        </th>
                        <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-blue-50">
                          <div>Send</div>
                          <div className="text-[9px] text-blue-400 font-normal">({fmtDateShort(sendDate)})</div>
                        </th>
                        <th className="px-2 py-1 text-center text-gray-500 border-b font-medium whitespace-nowrap bg-green-50">
                          <div>Received</div>
                          <div className="text-[9px] text-green-400 font-normal">({fmtDateShort(date)})</div>
                        </th>
                        <th className="px-2 py-1 text-center text-gray-500 border-b border-r font-medium whitespace-nowrap bg-orange-50">
                          End O/S
                        </th>
                      </React.Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="sticky left-0 bg-inherit z-10 px-3 py-1.5 font-mono text-gray-700 border-r whitespace-nowrap">{row.code}</td>
                    <td className="sticky left-[100px] bg-inherit z-10 px-3 py-1.5 text-gray-800 border-r whitespace-nowrap">{row.name}</td>
                    {!selectedVendor && (
                      <td className="px-3 py-1.5 text-gray-600 border-r whitespace-nowrap">{row.vendorName}</td>
                    )}
                    {row.daily.map((d, di) => (
                      <React.Fragment key={di}>
                        <td className="px-2 py-1.5 text-center text-orange-700 bg-orange-50/30">{fmtNum(d.beginning)}</td>
                        <td className="px-2 py-1.5 text-center text-blue-700 bg-blue-50/30">{fmtNum(d.sendH1)}</td>
                        <td className="px-2 py-1.5 text-center text-green-700 bg-green-50/30">{fmtNum(d.receive)}</td>
                        <td className="px-2 py-1.5 text-center font-semibold text-orange-800 bg-orange-50/30 border-r">{fmtNum(d.ending)}</td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
                {/* Totals */}
                <tr className="bg-gray-100 font-semibold border-t-2 border-gray-300">
                  <td className="sticky left-0 bg-gray-100 z-10 px-3 py-2 border-r">TOTAL</td>
                  <td className="sticky left-[100px] bg-gray-100 z-10 px-3 py-2 border-r"></td>
                  {!selectedVendor && <td className="border-r"></td>}
                  {reportData.totals.map((t, ti) => (
                    <React.Fragment key={ti}>
                      <td className="px-2 py-2 text-center text-orange-800 bg-orange-100/50">{fmtNum(t.beginning)}</td>
                      <td className="px-2 py-2 text-center text-blue-800 bg-blue-100/50">{fmtNum(t.sendH1)}</td>
                      <td className="px-2 py-2 text-center text-green-800 bg-green-100/50">{fmtNum(t.receive)}</td>
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

export default LaundryOutstandingReport2Page;
