import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatNumber } from '../utils/format.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { PageLoader } from '../components/PageLoader';

// A document left in draft means the stock never moved in the books even though
// the physical work was almost certainly done. Nothing else in the app surfaces
// these, which is how transfers from April were still sitting unconfirmed.
const STALE_AFTER_DAYS = 2;

// Listing the document numbers is the point: a count alone sends someone to a
// page of hundreds of rows with no way to tell which ones need attention.
const MAX_LISTED = 12;

// Status casing is inconsistent across tables — room_additional_requests stores
// lowercase, the others uppercase — so every lookup matches both.
const PENDING_DOCS = [
  {
    key: 'makeup', table: 'room_makeups', route: '/room-makeup-new',
    numberCol: 'makeup_number', dateCol: 'makeup_date',
    select: 'makeup_number, makeup_date, rooms(room_number)',
    labelKey: 'menu.roomMakeupNew',
  },
  {
    key: 'transfer', table: 'transfers', route: '/transfer',
    numberCol: 'transfer_number', dateCol: 'transfer_date',
    select: 'transfer_number, transfer_date, warehouses!transfers_to_warehouse_id_fkey(name)',
    labelKey: 'menu.transfer',
  },
  {
    key: 'request', table: 'room_additional_requests', route: '/room-additional-request',
    numberCol: 'request_number', dateCol: 'request_date',
    select: 'request_number, request_date, rooms(room_number)',
    labelKey: 'dashboard.docAdditionalRequest',
  },
];

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr + 'T00:00:00');
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
}

function DashboardPage() {
  const { t } = useTranslation();
  const { selectedOrg } = useApp();
  const navigate = useNavigate();
  const [stats, setStats] = useState({ items: 0, vendors: 0, lowStock: 0, pendingPR: 0 });
  const [stale, setStale] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (selectedOrg) loadDashboard();
  }, [selectedOrg]);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [itemsRes, vendorsRes, stockRes, prRes] = await Promise.all([
        supabase.from('items').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('is_active', true),
        supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('stock_balance').select('quantity, warehouses!inner(warehouse_type)').eq('organization_id', selectedOrg.id),
        supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'SUBMITTED'),
      ]);

      const stockData = stockRes.data || [];
      // Only count out-of-stock in 'store' warehouses (main stock, not room/dirty/laundry/damage)
      const lowStockCount = stockData.filter(s => {
        return s.quantity <= 0 && s.warehouses?.warehouse_type === 'store';
      }).length;

      setStats({
        items: itemsRes.count || 0,
        vendors: vendorsRes.count || 0,
        lowStock: lowStockCount,
        pendingPR: prRes.count || 0,
      });

      await loadStaleDocs();
    } catch (err) {
      // silently handled
    } finally {
      setLoading(false);
    }
  }

  async function loadStaleDocs() {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000)
      .toISOString().slice(0, 10);

    // One query per document type. `count` returns the full total while the row
    // limit caps the payload — this runs on a Nano instance whose disk IO budget
    // is the system's bottleneck.
    const results = await Promise.all(PENDING_DOCS.map(async (doc) => {
      const { data, count, error } = await supabase
        .from(doc.table)
        .select(doc.select, { count: 'exact' })
        .eq('organization_id', selectedOrg.id)
        .in('status', ['DRAFT', 'draft'])
        .lte(doc.dateCol, cutoff)
        .order(doc.dateCol, { ascending: true })
        .limit(MAX_LISTED);
      if (error) return null;

      const rows = (data || []).map(r => ({
        number: r[doc.numberCol],
        date: r[doc.dateCol],
        days: daysSince(r[doc.dateCol]),
        // Rooms for makeups and requests, destination warehouse for transfers.
        context: r.rooms?.room_number
          ? t('dashboard.staleRoom').replace('{n}', r.rooms.room_number)
          : (r.warehouses?.name || ''),
      }));

      return { ...doc, count: count || 0, rows, oldestDays: rows[0]?.days || 0 };
    }));

    setStale(results.filter(r => r && r.count > 0));
  }

  if (loading) return <PageLoader />;

  const totalStale = stale.reduce((s, d) => s + d.count, 0);

  return (
    <div>
      <PageHeader title={t('menu.dashboard')} subtitle={`${t('dashboard.overview')} ${selectedOrg?.name || ''}`} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title={t('dashboard.totalActiveItems')} value={formatNumber(stats.items)} icon={Icons.Package} color="blue" />
        <StatCard title={t('dashboard.activeVendors')} value={formatNumber(stats.vendors)} icon={Icons.Truck} color="green" />
        <StatCard title={t('dashboard.outOfStock')} value={formatNumber(stats.lowStock)} icon={Icons.AlertTriangle} color="red" />
        <StatCard title={t('dashboard.pendingPR')} value={formatNumber(stats.pendingPR)} icon={Icons.ShoppingCart} color="orange" />
      </div>

      {stale.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-amber-200 mb-8 overflow-hidden">
          <div className="flex items-start gap-3 px-5 py-4 bg-amber-50 border-b border-amber-200">
            <Icons.AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {t('dashboard.staleDocsTitle').replace('{n}', formatNumber(totalStale))}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">{t('dashboard.staleDocsDesc')}</p>
            </div>
          </div>

          <div className="divide-y divide-gray-100">
            {stale.map(doc => {
              const isOpen = expanded === doc.key;
              return (
                <div key={doc.key}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : doc.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{t(doc.labelKey)}</p>
                      <p className={`text-xs mt-0.5 ${doc.oldestDays >= 7 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {t('dashboard.staleOldest').replace('{n}', doc.oldestDays)}
                        {' · '}
                        {isOpen ? t('dashboard.staleHide') : t('dashboard.staleShow')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-lg font-bold tabular-nums ${doc.oldestDays >= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                        {formatNumber(doc.count)}
                      </span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="bg-gray-50 border-t border-gray-100 px-5 py-3">
                      <ul className="divide-y divide-gray-200">
                        {doc.rows.map(row => (
                          <li key={row.number} className="flex items-baseline justify-between gap-3 py-2">
                            <div className="min-w-0">
                              <span className="font-mono text-xs font-semibold text-gray-900">{row.number}</span>
                              {row.context && <span className="text-xs text-gray-500 ml-2">{row.context}</span>}
                            </div>
                            <span className={`text-xs whitespace-nowrap tabular-nums ${row.days >= 7 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                              {row.date} · {t('dashboard.staleDays').replace('{n}', row.days)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {doc.count > doc.rows.length && (
                        <p className="text-xs text-gray-400 pt-2">
                          {t('dashboard.staleMore').replace('{n}', doc.count - doc.rows.length)}
                        </p>
                      )}
                      <button
                        onClick={() => navigate(doc.route)}
                        className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 focus:outline-none focus:underline"
                      >
                        {t('dashboard.staleOpenPage')} &rarr;
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

export default DashboardPage;
