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

// Status casing is inconsistent across tables — room_additional_requests stores
// lowercase, the others uppercase — so every lookup matches both.
const PENDING_DOCS = [
  { key: 'makeup',   table: 'room_makeups',              dateCol: 'makeup_date',   route: '/room-makeup-new',           labelKey: 'menu.roomMakeupNew' },
  { key: 'transfer', table: 'transfers',                 dateCol: 'transfer_date', route: '/transfer',                  labelKey: 'menu.transfer' },
  { key: 'request',  table: 'room_additional_requests',  dateCol: 'request_date',  route: '/room-additional-request',   labelKey: 'dashboard.docAdditionalRequest' },
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
    // limit keeps the payload to a single date — this runs on a Nano instance
    // whose disk IO budget is the system's bottleneck.
    const results = await Promise.all(PENDING_DOCS.map(async (doc) => {
      const { data, count, error } = await supabase
        .from(doc.table)
        .select(doc.dateCol, { count: 'exact' })
        .eq('organization_id', selectedOrg.id)
        .in('status', ['DRAFT', 'draft'])
        .lte(doc.dateCol, cutoff)
        .order(doc.dateCol, { ascending: true })
        .limit(1);
      if (error) return null;
      return {
        ...doc,
        count: count || 0,
        oldestDays: daysSince(data?.[0]?.[doc.dateCol]),
      };
    }));

    setStale(results.filter(r => r && r.count > 0));
  }

  if (loading) return <PageLoader />;

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
                {t('dashboard.staleDocsTitle').replace('{n}', formatNumber(stale.reduce((s, d) => s + d.count, 0)))}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">{t('dashboard.staleDocsDesc')}</p>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {stale.map(doc => (
              <button
                key={doc.key}
                onClick={() => navigate(doc.route)}
                className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{t(doc.labelKey)}</p>
                  <p className={`text-xs mt-0.5 ${doc.oldestDays >= 7 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                    {t('dashboard.staleOldest').replace('{n}', doc.oldestDays)}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-lg font-bold tabular-nums ${doc.oldestDays >= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                    {formatNumber(doc.count)}
                  </span>
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export default DashboardPage;
