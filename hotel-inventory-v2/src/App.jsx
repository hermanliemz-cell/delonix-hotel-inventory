import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './hooks/useApp';
import { useTranslation } from './hooks/useTranslation';
import { canAccessPage } from './utils/roles.js';
import { Icons } from './components/Icons.jsx';
import { NotificationContainer } from './components/NotificationContainer.jsx';
import { ConfirmDialog } from './components/ConfirmDialog.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { initVersionCheck, checkVersionBeforeLogin, APP_VERSION } from './utils/versionCheck.js';
import { FullPageLoader } from './components/PageLoader.jsx';

// Lazy-loaded page imports — each page is only downloaded when the user navigates to it
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const HotelsPage = lazy(() => import('./pages/HotelsPage.jsx'));
const ItemsPage = lazy(() => import('./pages/ItemsPage.jsx'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage.jsx'));
const VendorsPage = lazy(() => import('./pages/VendorsPage.jsx'));
const DepartmentsPage = lazy(() => import('./pages/DepartmentsPage.jsx'));
const WarehousesPage = lazy(() => import('./pages/WarehousesPage.jsx'));
const RoomTypesPage = lazy(() => import('./pages/RoomTypesPage.jsx'));
const BedFormationsPage = lazy(() => import('./pages/BedFormationsPage.jsx'));
const RoomsPage = lazy(() => import('./pages/RoomsPage.jsx'));
const RoomMakeUpPageNew = lazy(() => import('./pages/RoomMakeUpPageNew.jsx'));
const OpeningBalancePage = lazy(() => import('./pages/OpeningBalancePage.jsx'));
const StockBalancePage = lazy(() => import('./pages/StockBalancePage.jsx'));
const BinCardPage = lazy(() => import('./pages/BinCardPage.jsx'));
const PurchaseRequestPage = lazy(() => import('./pages/PurchaseRequestPage.jsx'));
const PurchaseOrderPage = lazy(() => import('./pages/PurchaseOrderPage.jsx'));
const StockOpnamePage = lazy(() => import('./pages/StockOpnamePage.jsx'));
const WriteOffPage = lazy(() => import('./pages/WriteOffPage.jsx'));
const PurchaseInvoicePage = lazy(() => import('./pages/PurchaseInvoicePage.jsx'));
const PurchaseReceivedPage = lazy(() => import('./pages/PurchaseReceivedPage.jsx'));
const TransferPage = lazy(() => import('./pages/TransferPage.jsx'));
const DirectPurchasePage = lazy(() => import('./pages/DirectPurchasePage.jsx'));
const SingleItemUsagePage = lazy(() => import('./pages/SingleItemUsagePage.jsx'));
const AdjustmentPage = lazy(() => import('./pages/AdjustmentPage.jsx'));
const InUseWarehousePage = lazy(() => import('./pages/InUseWarehousePage.jsx'));
const LaundryPage = lazy(() => import('./pages/LaundryPage.jsx'));
const RoomConsumptionPage = lazy(() => import('./pages/RoomConsumptionPage.jsx'));
const ItemLostPage = lazy(() => import('./pages/ItemLostPage.jsx'));
const RMUActivityHistoryPage = lazy(() => import('./pages/RMUActivityHistoryPage.jsx'));
const RoomAdditionalRequestPage = lazy(() => import('./pages/RoomAdditionalRequestPage.jsx'));
const ApprovalPage = lazy(() => import('./pages/ApprovalPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage.jsx'));
const RoleManagementPage = lazy(() => import('./pages/RoleManagementPage.jsx'));
const SystemSettingsPage = lazy(() => import('./pages/SystemSettingsPage.jsx'));
const CronJobsPage = lazy(() => import('./pages/CronJobsPage.jsx'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.jsx'));
const WorksheetPage = lazy(() => import('./pages/WorksheetPage.jsx'));
const ItemCostHistoryPage = lazy(() => import('./pages/ItemCostHistoryPage.jsx'));
const AmenitiesCostReportPage = lazy(() => import('./pages/AmenitiesCostReportPage.jsx'));
const LaundryOutstandingReportPage = lazy(() => import('./pages/LaundryOutstandingReportPage.jsx'));

// Route-to-pageId mapping for access control
const ROUTE_PAGE_MAP = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/hotels': 'hotels',
  '/items': 'items',
  '/categories': 'categories',
  '/vendors': 'vendors',
  '/departments': 'departments',
  '/warehouses': 'warehouses',
  '/room-types': 'room-types',
  '/bed-formations': 'bed-formations',
  '/rooms': 'rooms',
  '/room-makeup-new': 'room-makeup-new',
  '/opening-balance': 'opening-balance',
  '/stock': 'stock',
  '/movements': 'movements',
  '/pr': 'pr',
  '/po': 'po',
  '/pi': 'pi',
  '/gr': 'gr',
  '/transfer': 'transfer',
  '/direct-purchase': 'direct-purchase',
  '/single-usage': 'single-usage',
  '/adjustment': 'adjustment',
  '/opname': 'opname',
  '/in-use-warehouse': 'in-use-warehouse',
  '/laundry': 'laundry',
  '/room-consumption': 'room-consumption',
  '/item-lost-in-room': 'item-lost-in-room',
  '/rmu-activity-history': 'rmu-activity-history',
  '/room-additional-request': 'room-additional-request',
  '/approval': 'approval',
  '/reports': 'reports',
  '/writeoff': 'writeoff',
  '/user-mgmt': 'user-mgmt',
  '/role-mgmt': 'role-mgmt',
  '/system-settings': 'system-settings',
  '/cron-jobs': 'cron-jobs',
  '/change-password': 'change-password',
  '/worksheet': 'worksheet',
  '/item-cost-history': 'item-cost-history',
  '/amenities-cost': 'amenities-cost',
  '/laundry-outstanding': 'laundry-outstanding',
};

// ============================================================
// LOGIN PAGE
// ============================================================
function LoginPage() {
  const { t } = useTranslation();
  const { handleLogin } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showMaintenanceBlock, setShowMaintenanceBlock] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setShowMaintenanceBlock(false);
    setLoading(true);
    try {
      // Check if running latest version before allowing login
      const versionOk = await checkVersionBeforeLogin();
      if (!versionOk) return; // page is reloading to get latest version

      const success = await handleLogin(username, password);
      if (success) {
        navigate('/dashboard');
      } else {
        setError(t('login.error'));
      }
    } catch (err) {
      if (err.message === 'maintenance') {
        setShowMaintenanceBlock(true);
      } else {
        setError(err.message);
      }
    }
    setLoading(false);
  }

  if (showMaintenanceBlock) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-900 via-amber-900 to-gray-900 p-4">
        <div className="w-full max-w-lg text-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 sm:p-12">
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{t('app.maintenance.title')}</h1>
            <p className="text-gray-600 mb-6">{t('app.maintenance.message')}</p>
            <p className="text-sm text-gray-500 mb-8">{t('app.maintenance.contact')}</p>
            <button onClick={() => setShowMaintenanceBlock(false)} className="px-6 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors text-sm">
              {t('login.backToLogin') || 'Back to Login'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl sm:text-5xl mb-4">📦</div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('login.title')}</h1>
          <p className="text-blue-200 mt-1 text-sm sm:text-base">{t('login.subtitle')}</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-lg sm:rounded-xl shadow-2xl p-6 sm:p-8 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.username')}</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" placeholder={t('login.username')} autoFocus required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.password')}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" placeholder={t('login.password')} required />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors text-sm">
            {loading ? t('login.signingIn') : t('login.signIn')}
          </button>
        </form>
        <p className="text-center text-blue-300 text-xs mt-4">{APP_VERSION} &copy; 2026 Delonix Group</p>
      </div>
    </div>
  );
}

// ============================================================
// FORCE CHANGE PASSWORD PAGE
// ============================================================
function ForceChangePasswordPage() {
  const { t } = useTranslation();
  const { handleForceChangePassword, handleLogout } = useApp();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) return setError(t('login.passwordShort'));
    if (newPassword !== confirmPassword) return setError(t('login.passwordMismatch'));
    setLoading(true);
    try {
      await handleForceChangePassword(newPassword);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-900 via-orange-900 to-gray-900 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl sm:text-5xl mb-4">🔐</div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('login.forceChange')}</h1>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-lg sm:rounded-xl shadow-2xl p-6 sm:p-8 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.newPassword')}</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" placeholder={t('login.newPassword')} autoFocus required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.confirmNewPassword')}</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm" placeholder={t('login.confirmNewPassword')} required />
          </div>
          <button type="submit" disabled={loading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors text-sm">
            {loading ? t('common.saving') : t('login.changeAndContinue')}
          </button>
          <button type="button" onClick={handleLogout} className="w-full py-2 text-gray-500 hover:text-gray-700 text-sm">
            {t('login.logout')}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// PROTECTED ROUTE WRAPPER
// ============================================================
function ProtectedRoute({ pageId, children }) {
  const { currentUser } = useApp();
  const navigate = useNavigate();
  const roleCode = currentUser?.role?.code;
  const rolePermissions = currentUser?.role?.permissions;

  if (!canAccessPage(roleCode, pageId, rolePermissions)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <Icons.Shield />
        <h3 className="mt-4 text-lg font-semibold text-gray-700">Access Denied</h3>
        <p className="mt-1 text-sm">You do not have permission to access this page.</p>
        <button onClick={() => navigate('/dashboard')} className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
          Dashboard
        </button>
      </div>
    );
  }

  return children;
}

// ============================================================
// VERSION UPDATE BANNER
// ============================================================
function VersionBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    function onNewVersion() { setShowBanner(true); }
    window.addEventListener('app-update-available', onNewVersion);
    initVersionCheck();
    return () => window.removeEventListener('app-update-available', onNewVersion);
  }, []);

  if (!showBanner) return null;

  return (
    <div className="bg-blue-600 text-white text-center py-2 px-4 text-sm flex items-center justify-center gap-3">
      <span>Versi baru tersedia!</span>
      <button onClick={() => window.location.reload()} className="bg-white text-blue-600 px-3 py-1 rounded text-xs font-medium hover:bg-blue-50">
        Update Sekarang
      </button>
    </div>
  );
}

// ============================================================
// MAIN LAYOUT (Sidebar + Header + Content)
// ============================================================
function MainLayout() {
  const { t, language, toggleLanguage } = useTranslation();
  const {
    currentUser, handleLogout, selectedOrg, setSelectedOrg, organizations,
    sidebarOpen, setSidebarOpen, notification, confirmDialog, setConfirmDialog,
    showForceChangePassword, loadPendingApprovalCount
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState([]);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);

  // Get current pageId from route
  const currentPageId = ROUTE_PAGE_MAP[location.pathname] || 'dashboard';

  const userRoleCode = currentUser?.role?.code;
  const userRolePermissions = currentUser?.role?.permissions;

  // Load pending approval count
  useEffect(() => {
    if (selectedOrg) {
      loadPendingApprovalCount().then(c => setPendingApprovalCount(c));
    }
  }, [selectedOrg?.id, loadPendingApprovalCount]);

  // Auto-expand menu group containing current page
  useEffect(() => {
    const menuGroups = getMenuGroups();
    for (const g of menuGroups) {
      if (g.type === 'group' && g.children.some(c => c.id === currentPageId)) {
        setExpandedGroups(prev => prev.includes(g.label) ? prev : [...prev, g.label]);
      }
    }
  }, [currentPageId]);

  function getMenuGroups() {
    return [
      { type: 'item', id: 'dashboard', label: t('menu.dashboard'), icon: Icons.Dashboard },
      { type: 'group', label: t('menu.group.globalMaster'), icon: Icons.Package, children: [
        { id: 'hotels', label: t('menu.hotels'), icon: Icons.Building },
        { id: 'departments', label: t('menu.departments'), icon: Icons.Building },
        { id: 'vendors', label: t('menu.vendors'), icon: Icons.Truck },
        { id: 'categories', label: t('menu.categories'), icon: Icons.Tag },
        { id: 'room-types', label: t('menu.roomTypes'), icon: Icons.Tag },
        { id: 'bed-formations', label: t('menu.bedFormations'), icon: Icons.Bed },
      ]},
      { type: 'group', label: t('menu.group.hotelMaster'), icon: Icons.Building, children: [
        { id: 'items', label: t('menu.items'), icon: Icons.Package },
        { id: 'warehouses', label: t('menu.warehouses'), icon: Icons.Warehouse },
        { id: 'rooms', label: t('menu.rooms'), icon: Icons.Door },
      ]},
      { type: 'group', label: t('menu.group.purchase'), icon: Icons.ShoppingCart, children: [
        { id: 'pr', label: t('menu.pr'), icon: Icons.ShoppingCart },
        { id: 'po', label: t('menu.po'), icon: Icons.ShoppingCart },
        { id: 'pi', label: t('menu.pi'), icon: Icons.ClipboardList },
        { id: 'gr', label: t('menu.gr'), icon: Icons.Truck },
        { id: 'direct-purchase', label: t('menu.directPurchase'), icon: Icons.ShoppingCart },
        { id: 'approval', label: t('menu.approval'), icon: Icons.Shield, badge: pendingApprovalCount },
      ]},
      { type: 'group', label: 'HOUSEKEEPING', icon: Icons.ClipboardList, children: [
        { id: 'room-makeup-new', label: t('menu.roomMakeupNew'), icon: Icons.ClipboardList },
        { id: 'worksheet', label: 'Worksheet', icon: Icons.ClipboardList },
        { id: 'laundry', label: 'Laundry', icon: Icons.Truck },
        { id: 'room-consumption', label: 'Room Consumption', icon: Icons.Package },
        { id: 'item-lost-in-room', label: 'Item Lost in Room', icon: Icons.Trash },
        { id: 'rmu-activity-history', label: 'Activity History', icon: Icons.ClipboardList },
        { id: 'room-additional-request', label: 'Room Additional Request', icon: Icons.ClipboardList },
      ]},
      { type: 'group', label: t('menu.group.stock'), icon: Icons.Database, children: [
        { id: 'opening-balance', label: t('ob.menu'), icon: Icons.Scale },
        { id: 'stock', label: t('menu.stock'), icon: Icons.Database },
        { id: 'movements', label: t('menu.movements'), icon: Icons.ClipboardList },
        { id: 'item-cost-history', label: 'Cost History', icon: Icons.ClipboardList },
        { id: 'transfer', label: t('menu.transfer'), icon: Icons.Truck },
        { id: 'opname', label: t('menu.opname'), icon: Icons.ClipboardList },
        { id: 'in-use-warehouse', label: t('menu.inUseWarehouse'), icon: Icons.Warehouse },
        { id: 'adjustment', label: 'Adjustment', icon: Icons.Scale },
      ]},
      { type: 'group', label: t('menu.group.stockOut'), icon: Icons.Package, children: [
        { id: 'single-usage', label: t('menu.singleUsage'), icon: Icons.Package },
        { id: 'writeoff', label: t('menu.writeoff'), icon: Icons.Trash },
      ]},
      { type: 'group', label: t('menu.reports'), icon: Icons.BarChart, children: [
        { id: 'reports', label: t('menu.reports'), icon: Icons.BarChart },
        { id: 'amenities-cost', label: 'Amenities Cost', icon: Icons.ClipboardList },
        { id: 'laundry-outstanding', label: 'Laundry Outstanding', icon: Icons.Truck },
      ]},
      { type: 'group', label: t('menu.group.settings'), icon: Icons.Settings, children: [
        { id: 'user-mgmt', label: t('menu.userMgmt'), icon: Icons.Users },
        { id: 'role-mgmt', label: t('menu.roleMgmt'), icon: Icons.Shield },
        { id: 'change-password', label: t('menu.changePassword'), icon: Icons.Lock },
        { id: 'system-settings', label: t('menu.systemSettings'), icon: Icons.Settings },
        { id: 'cron-jobs', label: t('menu.cronJobs'), icon: Icons.Clock },
      ]},
    ];
  }

  const menuGroups = getMenuGroups();

  // Filter menu by role access
  const filteredMenuGroups = menuGroups.map(g => {
    if (g.type === 'group') {
      const filteredChildren = g.children.filter(c => canAccessPage(userRoleCode, c.id, userRolePermissions));
      return filteredChildren.length > 0 ? { ...g, children: filteredChildren } : null;
    }
    return canAccessPage(userRoleCode, g.id, userRolePermissions) ? g : null;
  }).filter(Boolean);

  function toggleGroup(label) {
    setExpandedGroups(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);
  }

  function navigateTo(pageId) {
    navigate('/' + (pageId === 'dashboard' ? '' : pageId));
    setMobileSidebar(false);
  }

  // Org color helper
  const orgColors = [
    { bg: 'bg-blue-100', text: 'text-blue-700' },
    { bg: 'bg-emerald-100', text: 'text-emerald-700' },
    { bg: 'bg-purple-100', text: 'text-purple-700' },
    { bg: 'bg-amber-100', text: 'text-amber-700' },
    { bg: 'bg-rose-100', text: 'text-rose-700' },
    { bg: 'bg-cyan-100', text: 'text-cyan-700' },
    { bg: 'bg-orange-100', text: 'text-orange-700' },
    { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <VersionBanner />
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile sidebar overlay */}
        {mobileSidebar && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden" onClick={() => setMobileSidebar(false)} />
        )}

        {/* Sidebar */}
        <aside className={`
          ${mobileSidebar ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-50
          ${sidebarOpen ? 'w-64' : 'w-20'}
          bg-gray-900 text-white transition-all duration-200 flex flex-col
        `}>
          {/* Logo */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            {sidebarOpen && (
              <div className="flex items-center gap-2">
                <span className="text-2xl">📦</span>
                <div>
                  <h1 className="text-sm font-bold leading-tight">{t('app.title')}</h1>
                  <p className="text-xs text-gray-400">{t('app.subtitle')}</p>
                </div>
              </div>
            )}
            <button onClick={() => { setSidebarOpen(!sidebarOpen); setMobileSidebar(false); }} className="p-1 hover:bg-gray-700 rounded lg:block hidden">
              <Icons.Menu />
            </button>
            <button onClick={() => setMobileSidebar(false)} className="p-1 hover:bg-gray-700 rounded lg:hidden">
              <Icons.X />
            </button>
          </div>

          {/* Organization Selector */}
          {sidebarOpen && (
            <div className="p-3 border-b border-gray-700">
              {organizations.length <= 1 ? (
                <div className="w-full bg-gray-800 text-sm text-white border border-gray-600 rounded-lg px-3 py-2 opacity-75">
                  {selectedOrg?.name || 'No Hotel'}
                </div>
              ) : (
                <select
                  value={selectedOrg?.id || ''}
                  onChange={(e) => setSelectedOrg(organizations.find(o => o.id === e.target.value))}
                  className="w-full bg-gray-800 text-sm text-white border border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Menu */}
          <nav className="flex-1 overflow-y-auto py-2">
            {filteredMenuGroups.map((group, gi) => {
              if (group.type === 'item') {
                const Icon = group.icon;
                const isActive = currentPageId === group.id;
                return (
                  <button key={group.id}
                    onClick={() => navigateTo(group.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                      ${isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                      ${!sidebarOpen ? 'justify-center px-2' : ''}
                    `}
                    title={!sidebarOpen ? group.label : ''}
                  >
                    <Icon />
                    {sidebarOpen && <span className="flex-1 text-left">{group.label}</span>}
                    {sidebarOpen && group.badge > 0 && <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{group.badge}</span>}
                  </button>
                );
              }
              const GroupIcon = group.icon;
              const isExpanded = expandedGroups.includes(group.label);
              const hasActive = group.children.some(c => c.id === currentPageId);
              return (
                <div key={gi}>
                  {sidebarOpen ? (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className={`w-full flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors
                        ${hasActive ? 'text-primary-400' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      <span className="flex items-center gap-2"><GroupIcon /> {group.label}</span>
                      <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                    </button>
                  ) : (
                    <div className="flex justify-center py-2 text-gray-600"><GroupIcon /></div>
                  )}
                  {(isExpanded || !sidebarOpen) && group.children.map(item => {
                    const Icon = item.icon;
                    const isActive = currentPageId === item.id;
                    return (
                      <button key={item.id}
                        onClick={() => navigateTo(item.id)}
                        className={`w-full flex items-center gap-3 text-sm transition-colors
                          ${isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}
                          ${sidebarOpen ? 'pl-8 pr-4 py-2' : 'justify-center px-2 py-2.5'}
                        `}
                        title={!sidebarOpen ? item.label : ''}
                      >
                        <Icon />
                        {sidebarOpen && <span>{item.label}</span>}
                        {sidebarOpen && item.badge > 0 && <span className="bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{item.badge}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          {sidebarOpen && (
            <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
              <p>Delonix Group</p>
              <p>{t('app.version')}</p>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="bg-white shadow-sm border-b border-gray-200 px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-1 sm:gap-2" style={{minHeight: '48px'}}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 overflow-hidden">
              <button onClick={() => setMobileSidebar(true)} className="lg:hidden p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg flex-shrink-0">
                <Icons.Menu />
              </button>
              {selectedOrg && (() => {
                const orgIdx = organizations.findIndex(o => o.id === selectedOrg.id);
                const c = orgColors[orgIdx >= 0 ? orgIdx % orgColors.length : 0];
                return (
                  <div className="min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <h2 className="text-xs sm:text-lg font-semibold text-gray-800 truncate">{selectedOrg.name}</h2>
                      <span className={`text-xs ${c.bg} ${c.text} px-1.5 sm:px-2 py-0.5 rounded-full font-medium flex-shrink-0 whitespace-nowrap`}>
                        {selectedOrg.code}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-none hidden sm:block">{APP_VERSION}</p>
                  </div>
                );
              })()}
            </div>
            <div className="flex items-center gap-0.5 sm:gap-2 flex-shrink-0">
              <button onClick={toggleLanguage} className="hidden sm:block p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg relative text-xs sm:text-sm font-medium text-gray-700">
                {language === 'en' ? '中文' : 'EN'}
              </button>
              <button className="p-1 sm:p-2 hover:bg-gray-100 rounded-lg relative">
                <Icons.Bell />
              </button>
              <div className="flex items-center gap-0.5 sm:gap-2 ml-0.5 sm:ml-2">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-gray-700">{currentUser?.full_name}</div>
                  <div className="text-xs text-gray-500">{currentUser?.role?.name}</div>
                </div>
                <div className="w-7 h-7 sm:w-8 sm:h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-medium flex-shrink-0">
                  {(currentUser?.full_name || 'U')[0].toUpperCase()}
                </div>
                <button onClick={handleLogout} className="p-1 sm:p-2 hover:bg-red-50 rounded-lg text-gray-500 hover:text-red-600 flex-shrink-0" title={t('login.logout')}>
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                </button>
              </div>
            </div>
          </header>

          {/* Notification Toast */}
          <NotificationContainer notification={notification} />

          {/* Confirm Dialog */}
          {confirmDialog && (
            <ConfirmDialog
              open={true}
              message={confirmDialog.message}
              title={confirmDialog.title}
              variant={confirmDialog.variant}
              onConfirm={() => { confirmDialog.resolve(true); setConfirmDialog(null); }}
              onClose={() => { confirmDialog.resolve(false); setConfirmDialog(null); }}
            />
          )}

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="fade-in">
              <ErrorBoundary>
                <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<ProtectedRoute pageId="dashboard"><DashboardPage /></ProtectedRoute>} />
                  <Route path="/hotels" element={<ProtectedRoute pageId="hotels"><HotelsPage /></ProtectedRoute>} />
                  <Route path="/items" element={<ProtectedRoute pageId="items"><ItemsPage /></ProtectedRoute>} />
                  <Route path="/categories" element={<ProtectedRoute pageId="categories"><CategoriesPage /></ProtectedRoute>} />
                  <Route path="/vendors" element={<ProtectedRoute pageId="vendors"><VendorsPage /></ProtectedRoute>} />
                  <Route path="/departments" element={<ProtectedRoute pageId="departments"><DepartmentsPage /></ProtectedRoute>} />
                  <Route path="/warehouses" element={<ProtectedRoute pageId="warehouses"><WarehousesPage /></ProtectedRoute>} />
                  <Route path="/room-types" element={<ProtectedRoute pageId="room-types"><RoomTypesPage /></ProtectedRoute>} />
                  <Route path="/bed-formations" element={<ProtectedRoute pageId="bed-formations"><BedFormationsPage /></ProtectedRoute>} />
                  <Route path="/rooms" element={<ProtectedRoute pageId="rooms"><RoomsPage /></ProtectedRoute>} />
                  <Route path="/room-makeup-new" element={<ProtectedRoute pageId="room-makeup-new"><RoomMakeUpPageNew /></ProtectedRoute>} />
                  <Route path="/worksheet" element={<ProtectedRoute pageId="worksheet"><WorksheetPage /></ProtectedRoute>} />
                  <Route path="/opening-balance" element={<ProtectedRoute pageId="opening-balance"><OpeningBalancePage /></ProtectedRoute>} />
                  <Route path="/stock" element={<ProtectedRoute pageId="stock"><StockBalancePage /></ProtectedRoute>} />
                  <Route path="/movements" element={<ProtectedRoute pageId="movements"><BinCardPage /></ProtectedRoute>} />
                  <Route path="/item-cost-history" element={<ProtectedRoute pageId="item-cost-history"><ItemCostHistoryPage /></ProtectedRoute>} />
                  <Route path="/amenities-cost" element={<ProtectedRoute pageId="amenities-cost"><AmenitiesCostReportPage /></ProtectedRoute>} />
                  <Route path="/laundry-outstanding" element={<ProtectedRoute pageId="laundry-outstanding"><LaundryOutstandingReportPage /></ProtectedRoute>} />
                  <Route path="/pr" element={<ProtectedRoute pageId="pr"><PurchaseRequestPage /></ProtectedRoute>} />
                  <Route path="/po" element={<ProtectedRoute pageId="po"><PurchaseOrderPage /></ProtectedRoute>} />
                  <Route path="/pi" element={<ProtectedRoute pageId="pi"><PurchaseInvoicePage /></ProtectedRoute>} />
                  <Route path="/gr" element={<ProtectedRoute pageId="gr"><PurchaseReceivedPage /></ProtectedRoute>} />
                  <Route path="/transfer" element={<ProtectedRoute pageId="transfer"><TransferPage /></ProtectedRoute>} />
                  <Route path="/direct-purchase" element={<ProtectedRoute pageId="direct-purchase"><DirectPurchasePage /></ProtectedRoute>} />
                  <Route path="/single-usage" element={<ProtectedRoute pageId="single-usage"><SingleItemUsagePage /></ProtectedRoute>} />
                  <Route path="/adjustment" element={<ProtectedRoute pageId="adjustment"><AdjustmentPage /></ProtectedRoute>} />
                  <Route path="/opname" element={<ProtectedRoute pageId="opname"><StockOpnamePage /></ProtectedRoute>} />
                  <Route path="/in-use-warehouse" element={<ProtectedRoute pageId="in-use-warehouse"><InUseWarehousePage /></ProtectedRoute>} />
                  <Route path="/laundry" element={<ProtectedRoute pageId="laundry"><LaundryPage /></ProtectedRoute>} />
                  <Route path="/room-consumption" element={<ProtectedRoute pageId="room-consumption"><RoomConsumptionPage /></ProtectedRoute>} />
                  <Route path="/item-lost-in-room" element={<ProtectedRoute pageId="item-lost-in-room"><ItemLostPage /></ProtectedRoute>} />
                  <Route path="/rmu-activity-history" element={<ProtectedRoute pageId="rmu-activity-history"><RMUActivityHistoryPage /></ProtectedRoute>} />
                  <Route path="/room-additional-request" element={<ProtectedRoute pageId="room-additional-request"><RoomAdditionalRequestPage /></ProtectedRoute>} />
                  <Route path="/approval" element={<ProtectedRoute pageId="approval"><ApprovalPage /></ProtectedRoute>} />
                  <Route path="/reports" element={<ProtectedRoute pageId="reports"><ReportsPage /></ProtectedRoute>} />
                  <Route path="/writeoff" element={<ProtectedRoute pageId="writeoff"><WriteOffPage /></ProtectedRoute>} />
                  <Route path="/user-mgmt" element={<ProtectedRoute pageId="user-mgmt"><UserManagementPage /></ProtectedRoute>} />
                  <Route path="/role-mgmt" element={<ProtectedRoute pageId="role-mgmt"><RoleManagementPage /></ProtectedRoute>} />
                  <Route path="/system-settings" element={<ProtectedRoute pageId="system-settings"><SystemSettingsPage /></ProtectedRoute>} />
                  <Route path="/cron-jobs" element={<ProtectedRoute pageId="cron-jobs"><CronJobsPage /></ProtectedRoute>} />
                  <Route path="/change-password" element={<ProtectedRoute pageId="change-password"><ChangePasswordPage /></ProtectedRoute>} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================
export default function App() {
  const { currentUser, loading, showForceChangePassword } = useApp();

  if (loading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="spinner mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPage />;
  }

  if (showForceChangePassword) {
    return <ForceChangePasswordPage />;
  }

  return <MainLayout />;
}
