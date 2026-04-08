import React, {useState, useEffect, useMemo, useRef} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatNumber, formatDate, formatDateSys } from '../utils/format';
import { Badge } from '../components/FormElements';
import { PageHeader } from '../components/PageHeader';
import { DocDetailModal } from '../components/DocDetailModal';
import { PageLoader } from '../components/PageLoader';

function BinCardPage() {
  const { selectedOrg } = useApp();
  const { t } = useTranslation();
  const [movements, setMovements] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterItem, setFilterItem] = useState('');
  const [filterType, setFilterType] = useState('');
  const [docDetailMovement, setDocDetailMovement] = useState(null);
  const [periodPreset, setPeriodPreset] = useState('ytd');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [itemDropOpen, setItemDropOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const itemDropRef = React.useRef(null);

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

  function handlePeriodChange(val) {
    setPeriodPreset(val);
    if (val !== 'custom') {
      const range = getDateRange(val);
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }

  // Initialize YTD dates on mount
  useEffect(() => {
    const range = getDateRange('ytd');
    setDateFrom(range.from);
    setDateTo(range.to);
  }, []);

  // Close item dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (itemDropRef.current && !itemDropRef.current.contains(e.target)) {
        setItemDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => { if(selectedOrg) loadMasterData(); }, [selectedOrg]);

  // Load master data (items, warehouses, categories) - once
  async function loadMasterData() {
    const [itemRes, whRes, catRes] = await Promise.all([
      supabase.from('items').select('id, code, name, category_id, default_warehouse_id, is_active').eq('organization_id', selectedOrg?.id).order('code'),
      supabase.from('warehouses').select('id, code, name').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name'),
      supabase.from('item_categories').select('id, code, name').eq('is_active', true).order('name'),
    ]);
    setAllItems(itemRes.data || []);
    setWarehouses(whRes.data || []);
    const uniqueCats = [];
    const seenNames = new Set();
    (catRes.data || []).forEach(c => {
      if (!seenNames.has(c.name)) { seenNames.add(c.name); uniqueCats.push(c); }
    });
    setCategories(uniqueCats);
  }

  // Load movements - filtered at DB level for efficiency
  async function loadMovements(itemId, warehouseId) {
    setLoading(true);
    // Paginate — Supabase cap 1000 rows per-request secara default, jadi pakai range()
    // untuk fetch semua. Tanpa ini, item dengan >1000 movements akan terpotong dan
    // running balance jadi salah (LIN-012 punya 1083 movements → hilang 83 terakhir).
    const PAGE = 1000;
    const buildQuery = () => {
      let q = supabase.from('stock_movements')
        .select('*, items(code, name, category_id, units:unit_id(abbreviation)), departments!left(code), users:created_by(username, full_name)')
        .eq('organization_id', selectedOrg.id);
      if (itemId) q = q.eq('item_id', itemId);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      return q.order('created_at', { ascending: true });
    };
    let data = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: page, error } = await buildQuery().range(from, from + PAGE - 1);
      if (error || !page) break;
      data = data.concat(page);
      if (page.length < PAGE) break;
      from += PAGE;
      if (from >= 50000) break; // safety guard
    }

    // Resolve from/to warehouse by finding counterpart movements
    // Each movement is paired with its counterpart (opposite direction, same ref+item, closest created_at)
    const movs = data || [];
    const refNumbers = [...new Set(movs.filter(m => m.reference_number).map(m => m.reference_number))];
    let allCounterparts = []; // all movements sharing same reference_numbers
    if (refNumbers.length > 0) {
      for (let i = 0; i < refNumbers.length; i += 50) {
        const batch = refNumbers.slice(i, i + 50);
        const { data: counterparts } = await supabase.from('stock_movements')
          .select('id, reference_number, item_id, warehouse_id, movement_type, created_at')
          .eq('organization_id', selectedOrg.id)
          .in('reference_number', batch);
        allCounterparts = allCounterparts.concat(counterparts || []);
      }
    }
    // Build lookup: reference_number|item_id -> array of movements
    const refItemMap = {};
    allCounterparts.forEach(c => {
      const key = c.reference_number + '|' + c.item_id;
      if (!refItemMap[key]) refItemMap[key] = [];
      refItemMap[key].push(c);
    });
    // Enrich each movement with _from_warehouse_id and _to_warehouse_id
    // Logic: for OUT movement, from=self warehouse, to=nearest IN counterpart's warehouse
    //        for IN movement, to=self warehouse, from=nearest OUT counterpart's warehouse
    movs.forEach(m => {
      if (!m.reference_number) {
        m._from_warehouse_id = null;
        m._to_warehouse_id = null;
        return;
      }
      const key = m.reference_number + '|' + m.item_id;
      const siblings = refItemMap[key] || [];
      const mTime = new Date(m.created_at).getTime();
      if (m.movement_type === 'OUT') {
        m._from_warehouse_id = m.warehouse_id; // FROM = this warehouse (stock leaves here)
        // Find closest IN counterpart by created_at
        const inSiblings = siblings.filter(s => s.movement_type === 'IN' && s.id !== m.id);
        if (inSiblings.length > 0) {
          inSiblings.sort((a, b) => Math.abs(new Date(a.created_at).getTime() - mTime) - Math.abs(new Date(b.created_at).getTime() - mTime));
          m._to_warehouse_id = inSiblings[0].warehouse_id; // TO = where the paired IN goes
        } else {
          m._to_warehouse_id = null; // No counterpart (e.g. WRITEOFF, USAGE — stock disappears)
        }
      } else if (m.movement_type === 'IN') {
        m._to_warehouse_id = m.warehouse_id; // TO = this warehouse (stock arrives here)
        // Find closest OUT counterpart by created_at
        const outSiblings = siblings.filter(s => s.movement_type === 'OUT' && s.id !== m.id);
        if (outSiblings.length > 0) {
          outSiblings.sort((a, b) => Math.abs(new Date(a.created_at).getTime() - mTime) - Math.abs(new Date(b.created_at).getTime() - mTime));
          m._from_warehouse_id = outSiblings[0].warehouse_id; // FROM = where the paired OUT was
        } else {
          m._from_warehouse_id = null; // No counterpart (e.g. OB, GR — stock appears)
        }
      }
    });

    setMovements(movs);
    setLoading(false);
  }

  // Re-fetch movements when item or warehouse filter changes — only if item is selected
  useEffect(() => {
    if (selectedOrg && filterItem) {
      loadMovements(filterItem, filterWarehouse || null);
    } else {
      setMovements([]);
    }
  }, [filterItem, filterWarehouse]);

  // Cascading: filter items by selected category
  const filteredItems = useMemo(() => allItems.filter(i => {
    if (filterCategory && i.category_id !== filterCategory) return false;
    return true;
  }), [allItems, filterCategory]);

  // Reset item filter when warehouse or category changes
  useEffect(() => {
    if (filterCategory && filterItem) {
      const itemStillValid = filteredItems.some(i => i.id === filterItem);
      if (!itemStillValid) setFilterItem('');
    }
  }, [filterCategory]);

  const dateRange = periodPreset === 'custom' ? { from: dateFrom, to: dateTo } : getDateRange(periodPreset);

  // Step 1: Calculate running balance AND running avg_cost from ALL movements (sorted ascending)
  // Single-item Bin Card: key = item_id only, running balance is cumulative across all warehouses
  // OB should have earliest created_at so it sorts first, then all other movements accumulate on top
  // Helper: reference types that create paired OUT+IN movements (treated as transfers)
  const isTransferLike = (refType) => ['TRANSFER', 'MAKEUP-LINEN REPLACE', 'MAKEUP-DIRTY', 'DAMAGE'].includes(refType);

  // Helper: Doc Type chip color mapping
  const getDocTypeChip = (refType) => {
    const rt = (refType || '').toUpperCase();
    const map = {
      'OPENING_BALANCE': { label: 'Opening Balance', bg: 'bg-gray-100', text: 'text-gray-700' },
      'GR': { label: 'Goods Received', bg: 'bg-emerald-100', text: 'text-emerald-700' },
      'DIRECT_PURCHASE': { label: 'Direct Purchase', bg: 'bg-teal-100', text: 'text-teal-700' },
      'WRITEOFF': { label: 'Write Off', bg: 'bg-red-100', text: 'text-red-700' },
      'USAGE': { label: 'Single Item Usage', bg: 'bg-orange-100', text: 'text-orange-700' },
      'TRANSFER': { label: 'Transfer', bg: 'bg-blue-100', text: 'text-blue-700' },
      'LAUNDRY_SEND': { label: 'Laundry Send', bg: 'bg-indigo-100', text: 'text-indigo-700' },
      'LAUNDRY_RECEIVE': { label: 'Laundry Receive', bg: 'bg-violet-100', text: 'text-violet-700' },
      'MAKEUP-LINEN REPLACE': { label: 'Makeup Linen Replace', bg: 'bg-pink-100', text: 'text-pink-700' },
      'MAKEUP-DIRTY': { label: 'Makeup Linen Dirty', bg: 'bg-rose-100', text: 'text-rose-700' },
      'DAMAGE': { label: 'Damage', bg: 'bg-red-100', text: 'text-red-700' },
      'ITEM_LOST': { label: 'Item Lost', bg: 'bg-red-100', text: 'text-red-800' },
      'DEPLETED': { label: 'Makeup Consumption', bg: 'bg-lime-100', text: 'text-lime-700' },
      'CONSUMPTION': { label: 'Makeup Consumption', bg: 'bg-lime-100', text: 'text-lime-700' },
      'REPLACEMENT': { label: 'Replacement', bg: 'bg-cyan-100', text: 'text-cyan-700' },
      'LOST_BREAKAGE': { label: 'Lost & Breakage', bg: 'bg-red-100', text: 'text-red-700' },
      'MAKEUP': { label: 'Makeup', bg: 'bg-pink-100', text: 'text-pink-700' },
    };
    const chip = map[rt];
    if (chip) return chip;
    // Fallback: use the reference_type text directly
    return { label: rt.replace(/_/g, ' '), bg: 'bg-gray-100', text: 'text-gray-600' };
  };

  const movementsWithBalance = React.useMemo(() => {
    // Step A: Identify transfer-like groups (1:1 pairing, extras treated as normal)
    const transferGroups = {}; // key -> { outs: [], ins: [] }
    movements.forEach(m => {
      if (isTransferLike(m.reference_type)) {
        const key = m.reference_number + '|' + m.item_id + '|' + m.reference_type;
        if (!transferGroups[key]) transferGroups[key] = { outs: [], ins: [] };
        if (m.movement_type === 'OUT') transferGroups[key].outs.push(m);
        else if (m.movement_type === 'IN') transferGroups[key].ins.push(m);
      }
    });
    // Build 1:1 pairs; extra unpaired OUTs/INs stay as normal movements
    const pairedIds = new Set();
    const skipIds = new Set();
    Object.values(transferGroups).forEach(group => {
      const pairCount = Math.min(group.outs.length, group.ins.length);
      for (let i = 0; i < pairCount; i++) {
        pairedIds.add(group.outs[i].id);
        pairedIds.add(group.ins[i].id);
        skipIds.add(group.ins[i].id); // IN side merged into OUT row
      }
    });

    // Step B: Build merged movement list
    const merged = [];
    movements.forEach(m => {
      if (skipIds.has(m.id)) return; // skip transfer IN (merged into OUT row)
      if (isTransferLike(m.reference_type)) {
        if (pairedIds.has(m.id)) {
          // OUT side of a paired transfer — merge with its IN counterpart
          const key = m.reference_number + '|' + m.item_id + '|' + m.reference_type;
          const group = transferGroups[key];
          const pairIdx = group.outs.indexOf(m);
          const pairedIn = group.ins[pairIdx];
          merged.push({
            ...m,
            _is_transfer: true,
            _transfer_qty: m.quantity || 0,
            _from_warehouse_id: m.warehouse_id,
            _to_warehouse_id: pairedIn ? pairedIn.warehouse_id : m.warehouse_id,
          });
        } else {
          // Unpaired extra (duplicate or incomplete) — treat as normal movement
          merged.push({ ...m, _is_transfer: false, _transfer_qty: 0 });
        }
      } else {
        merged.push({ ...m, _is_transfer: false, _transfer_qty: 0 });
      }
    });

    // Step C: Calculate running balance — transfers do NOT affect balance
    const balanceMap = {}; // key → { qty, avg_cost, total_value }
    return merged.map(m => {
      const key = (m.item_id || '');
      if (!(key in balanceMap)) balanceMap[key] = { qty: 0, avg_cost: 0, total_value: 0 };
      const b = balanceMap[key];
      if (m._is_transfer) {
        // Transfer: balance unchanged
        return { ...m, _running_balance: b.qty, _running_avg_cost: b.avg_cost, _running_total_value: b.total_value };
      }
      const qty = m.quantity || 0;
      const unitCost = m.unit_cost || 0;
      if (m.movement_type === 'IN') {
        const newTotal = b.qty * b.avg_cost + qty * unitCost;
        b.qty += qty;
        b.avg_cost = b.qty > 0 ? newTotal / b.qty : 0;
        b.total_value = b.qty * b.avg_cost;
      } else if (m.movement_type === 'OUT') {
        b.qty -= qty;
        if (b.qty > 0) {
          b.total_value = b.qty * b.avg_cost;
        } else {
          b.qty = 0;
          b.total_value = 0;
        }
      }
      return { ...m, _running_balance: b.qty, _running_avg_cost: b.avg_cost, _running_total_value: b.total_value };
    });
  }, [movements]);

  // Step 2: Apply display filters (period, type, category) — balance already calculated
  // Helper: convert UTC timestamp to local date string (YYYY-MM-DD) for accurate date comparison
  function toLocalDateStr(utcStr) {
    const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
    const d = new Date(utcStr);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return parts; // returns YYYY-MM-DD format
  }
  const filtered = useMemo(() => movementsWithBalance.filter(m => {
    if (filterCategory && m.items?.category_id !== filterCategory) return false;
    if (filterType && m.movement_type !== filterType) return false;
    const localDate = toLocalDateStr(m.created_at);
    if (dateRange.from && localDate < dateRange.from) return false;
    if (dateRange.to && localDate > dateRange.to) return false;
    return true;
  }), [movementsWithBalance, filterCategory, filterType, dateRange.from, dateRange.to]);

  // Display oldest to newest (chronological order, same as running balance)
  const filteredWithBalance = filtered;

  const { totalIn, totalOut } = useMemo(() => {
    let tIn = 0, tOut = 0;
    filtered.forEach(m => {
      if (m._is_transfer) return;
      if (m.movement_type === 'IN') tIn += (m.quantity || 0);
      else if (m.movement_type === 'OUT') tOut += (m.quantity || 0);
    });
    return { totalIn: tIn, totalOut: tOut };
  }, [filtered]);

  const periodOptions = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'lastweek', label: 'Last Week' },
    { value: 'mtd', label: 'Current Month (MTD)' },
    { value: 'lastmonth', label: 'Last Month' },
    { value: 'ytd', label: 'Current Year (YTD)' },
    { value: 'custom', label: 'Custom Period' },
  ];

  function handleClearFilters() {
    setFilterWarehouse('');
    setFilterCategory('');
    setFilterItem('');
    setFilterType('');
    setPeriodPreset('mtd');
    const range = getDateRange('mtd');
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  const hasActiveFilters = filterWarehouse || filterCategory || filterItem || filterType || periodPreset !== 'mtd';

  // Get warehouse name for display
  const getWarehouseName = (whId) => {
    const wh = warehouses.find(w => w.id === whId);
    return wh ? wh.name : '';
  };

  return (
    <div>
      <PageHeader title={t('bincard.title')} subtitle={t('bincard.subtitle')} />

      {filterItem && (() => {
        const selectedItem = filteredItems.find(i => i.id === filterItem);
        return (
        <div className="mb-6">
          {selectedItem && (
            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-lg font-bold text-primary-700">{selectedItem.code}</span>
              <span className="text-lg text-gray-700">{selectedItem.name}</span>
            </div>
          )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('bincard.totalMovements')}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{formatNumber(filtered.length)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('bincard.totalIn')}</p>
          <p className="text-2xl font-bold text-green-600 mt-1">+{formatNumber(totalIn)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 uppercase">{t('bincard.totalOut')}</p>
          <p className="text-2xl font-bold text-red-600 mt-1">-{formatNumber(totalOut)}</p>
        </div>
      </div>
      </div>
        );
      })()}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          {/* Filters: Item, Warehouse, Category, Type, Period */}
          <div className="flex flex-wrap gap-3 items-center">
            {/* Searchable item dropdown */}
            <div className="relative" ref={itemDropRef} style={{minWidth:'220px', maxWidth:'300px'}}>
              <input
                type="text"
                placeholder={filterItem ? (filteredItems.find(i=>i.id===filterItem)?.code + ' - ' + filteredItems.find(i=>i.id===filterItem)?.name) : t('bincard.allItems')}
                value={itemSearch}
                onFocus={() => { setItemDropOpen(true); setItemSearch(''); }}
                onChange={e => { setItemSearch(e.target.value); setItemDropOpen(true); }}
                className={'px-2 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-primary-500 bg-white w-full ' + (filterItem ? 'border-primary-400 text-primary-700 font-medium' : 'border-gray-300')}
              />
              {filterItem && (
                <button onClick={() => { setFilterItem(''); setItemSearch(''); setItemDropOpen(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs">✕</button>
              )}
              {itemDropOpen && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  <div onClick={() => { setFilterItem(''); setItemSearch(''); setItemDropOpen(false); }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 cursor-pointer">{t('bincard.allItems')}</div>
                  {filteredItems.filter(i => {
                    const s = itemSearch.toLowerCase();
                    return !s || (i.code + ' ' + i.name).toLowerCase().includes(s);
                  }).map(i => (
                    <div key={i.id} onClick={() => { setFilterItem(i.id); setItemSearch(''); setItemDropOpen(false); }}
                      className={'px-3 py-1.5 text-xs hover:bg-primary-50 cursor-pointer ' + (filterItem === i.id ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700') + (i.is_active === false ? ' opacity-60' : '')}>
                      {i.code} - {i.name}{i.is_active === false && <span className="ml-1 text-orange-500 font-medium">(inactive)</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <select value={filterWarehouse} onChange={e => { setFilterWarehouse(e.target.value); }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">All Warehouses</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
            </select>
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); }}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterType} onChange={e=>setFilterType(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">{t('bincard.allTypes')}</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
              <option value="ADJ">ADJ</option>
            </select>
            <select value={periodPreset} onChange={e => handlePeriodChange(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500 bg-white">
              {periodOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            {periodPreset === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500" />
                <span className="text-gray-400">—</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500" />
              </div>
            )}
            {hasActiveFilters && (
              <button onClick={handleClearFilters}
                className="px-2 py-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">{t('common.clearFilters')}</button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">Reference</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">Date & Time</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">Doc Type</th>
                <th className="px-2 py-1.5 text-center font-semibold text-gray-600 uppercase whitespace-nowrap">User Dept</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">User</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">From</th>
                <th className="px-2 py-1.5 text-left font-semibold text-gray-600 uppercase whitespace-nowrap">To</th>
                <th className="px-2 py-1.5 text-center font-semibold text-gray-600 uppercase whitespace-nowrap">Direction</th>
                <th className="px-2 py-1.5 text-center font-semibold text-gray-600 uppercase whitespace-nowrap">Unit</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600 uppercase whitespace-nowrap">Transfer Qty</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600 uppercase whitespace-nowrap">IN/OUT Qty</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600 uppercase whitespace-nowrap">Cost</th>
                <th className="px-2 py-1.5 text-right font-semibold text-gray-600 uppercase whitespace-nowrap">Balance</th>
              </tr>
            </thead>
            <tbody>
              {!filterItem ? (
                <tr><td colSpan="13" className="px-2 py-8 text-center text-gray-400">Pilih item terlebih dahulu untuk melihat Bin Card</td></tr>
              ) : loading ? (
                <tr><td colSpan="13"><PageLoader /></td></tr>
              ) : filteredWithBalance.length === 0 ? (
                <tr><td colSpan="13" className="px-2 py-8 text-center text-gray-400">{t('bincard.empty')}</td></tr>
              ) : filteredWithBalance.map((r, idx) => {
                const docType = (r.reference_type || '').replace(/_/g, ' ');
                return (
                <tr key={r.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.reference_number ? (
                      <button onClick={(e) => { e.stopPropagation(); setDocDetailMovement(r); }} className="text-primary-600 hover:text-primary-800 hover:underline font-medium">
                        {r.reference_number}
                      </button>
                    ) : <span className="text-gray-300">-</span>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-gray-600">{formatDateSys(r.created_at, { includeTime: true })}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{(() => { const chip = getDocTypeChip(r.reference_type); return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${chip.bg} ${chip.text}`}>{chip.label}</span>; })()}</td>
                  <td className="px-2 py-1 text-center">{r.departments?.code ? <Badge color="blue">{r.departments.code}</Badge> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{r.users?.full_name || r.users?.username || '-'}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.movement_type === 'IN' && r.reference_type === 'OPENING_BALANCE' ? <span className="font-bold text-blue-600">Opening Balance</span> : r.movement_type === 'IN' && r.reference_type === 'GR' ? <span className="font-bold text-green-600">Purchase Received</span> : r.movement_type === 'IN' && r.reference_type === 'DIRECT_PURCHASE' ? <span className="font-bold text-green-600">Direct Purchased</span> : r._from_warehouse_id ? <span className="text-gray-500">{getWarehouseName(r._from_warehouse_id)}</span> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.movement_type === 'OUT' && r.reference_type === 'USAGE' ? <span className="font-bold text-red-600">Single Item Usage</span> : r.movement_type === 'OUT' && r.reference_type === 'WRITEOFF' ? <span className="font-bold text-red-600">Write Off</span> : r.movement_type === 'OUT' && (r.reference_type === 'DEPLETED' || r.reference_type === 'CONSUMPTION') ? <span className="font-bold text-red-600">Makeup Consumption</span> : r._to_warehouse_id ? <span className="text-gray-500">{getWarehouseName(r._to_warehouse_id)}</span> : <span className="text-gray-300">-</span>}</td>
                  <td className="px-2 py-1 text-center">{r._is_transfer ? <Badge color="blue">TRANSFER</Badge> : <Badge color={r.movement_type==='IN'?'green':r.movement_type==='OUT'?'red':'blue'}>{r.movement_type}</Badge>}</td>
                  <td className="px-2 py-1 text-center text-gray-500">{r.items?.units?.abbreviation || '-'}</td>
                  <td className={'px-2 py-1 text-right font-semibold ' + (r._is_transfer ? 'text-blue-600' : 'text-gray-400')}>{r._is_transfer ? formatNumber(r._transfer_qty) : '0'}</td>
                  <td className={'px-2 py-1 text-right font-semibold ' + (r._is_transfer ? 'text-gray-400' : r.movement_type==='IN' ? 'text-green-600' : 'text-red-600')}>{r._is_transfer ? '0' : (r.movement_type==='IN'?'+':'-') + formatNumber(r.quantity)}</td>
                  <td className="px-2 py-1 text-right text-gray-600">{formatCurrency(r._is_transfer && !r.unit_cost ? r._running_avg_cost : r.unit_cost)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-gray-800">{formatNumber(r._running_balance)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {docDetailMovement && <DocDetailModal movement={docDetailMovement} onClose={() => setDocDetailMovement(null)} />}
    </div>
  );
}

export default BinCardPage;
