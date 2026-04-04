import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { formatNumber } from '../utils/format.js';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { PageLoader } from '../components/PageLoader';

function DashboardPage() {
  const { t } = useTranslation();
  const { selectedOrg } = useApp();
  const [stats, setStats] = useState({ items: 0, vendors: 0, lowStock: 0, pendingPR: 0 });
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
    } catch (err) {
      // silently handled
    } finally {
      setLoading(false);
    }
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

    </div>
  );
}

export default DashboardPage;
