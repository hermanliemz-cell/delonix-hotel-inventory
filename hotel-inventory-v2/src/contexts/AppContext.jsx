import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase.js';

const AppContext = createContext(null);

export { AppContext };

// Inactivity tracking. Sessions restore from localStorage with no expiry, so
// last_login goes stale on accounts that are in daily use but never log out.
// users.last_activity_at is refreshed while the app is open instead, which is
// what fn_auto_deactivate_inactive_users reads.
//
// Writes are throttled to once an hour per browser: the database runs on a Nano
// instance whose disk IO budget is already tight, and a per-navigation write
// across ~50 users would be pure waste.
const ACTIVITY_PING_KEY = 'inventory_activity_ping';
const ACTIVITY_PING_INTERVAL_MS = 60 * 60 * 1000;   // write at most hourly
const ACTIVITY_CHECK_INTERVAL_MS = 10 * 60 * 1000;  // re-evaluate every 10 min

/**
 * Hash password using SHA-256 with salt
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_inventory_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Role-based page access mapping
 */
const ROLE_PAGE_ACCESS = {
  superadmin: '*', // all pages
  gm: '*',
  warehouse: ['dashboard','items','categories','vendors','warehouses','stock','movements','pr','po','pi','gr','transfer','direct-purchase','opening-balance','writeoff','opname','single-usage','in-use-warehouse','reports','change-password'],
  housekeeping: ['dashboard','items','room-makeup-new','room-consumption','item-lost-in-room','rmu-activity-history','room-additional-request','rooms','room-types','bed-formations','in-use-warehouse','single-usage','movements','change-password'],
  engineering: ['dashboard','items','stock','movements','pr','single-usage','in-use-warehouse','change-password'],
  fnb: ['dashboard','items','stock','movements','pr','single-usage','in-use-warehouse','change-password'],
  frontoffice: ['dashboard','rooms','room-types','stock','movements','change-password'],
  opdir: ['dashboard','items','stock','movements','reports','rooms','room-makeup-new','room-consumption','item-lost-in-room','rmu-activity-history','room-additional-request','pr','po','pi','gr','transfer','opname','hotels','change-password'],
  branddir: ['dashboard','items','stock','movements','reports','hotels','change-password'],
  finhotel: ['dashboard','stock','movements','reports','pi','opname','writeoff','adjustment','hotels','change-password'],
  findir: ['dashboard','stock','movements','reports','pi','hotels','approval','opname','adjustment','change-password'],
  depthead: ['dashboard','items','stock','movements','pr','single-usage','change-password'],
  finstaff: ['dashboard','stock','movements','reports','change-password'],
  viewer: ['dashboard','stock','movements','reports','change-password'],
};

/**
 * Check if user can access a page based on role
 */
export function canAccessPage(roleCode, pageId, rolePermissions) {
  if (!roleCode) return false;
  // change-password is always accessible to any logged-in user
  if (pageId === 'change-password') return true;
  // If role has dynamic permissions from DB, use those
  if (rolePermissions) {
    // { all: true } means full access
    if (rolePermissions.all === true) return true;
    // Check menu_access
    if (rolePermissions.menu_access) {
      return !!rolePermissions.menu_access[pageId];
    }
    // If permissions object exists but no menu_access and not all:true, deny everything
    return false;
  }
  // Fallback to hardcoded ROLE_PAGE_ACCESS for roles without DB permissions
  const access = ROLE_PAGE_ACCESS[roleCode];
  if (!access) return false;
  if (access === '*') return true;
  return access.includes(pageId);
}

/**
 * AppProvider component - wraps app with context state and auth
 */
export function AppProvider({ children }) {
  // Auth state
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('inventory_user');
    return saved ? JSON.parse(saved) : null;
  });

  // UI state
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Notification & dialog state
  const [notification, setNotification] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Maintenance & password change state
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [showForceChangePassword, setShowForceChangePassword] = useState(false);

  // Session tracking
  const lastActivityRef = useRef(Date.now());
  const lastRefreshRef = useRef(Date.now());
  const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  const MIN_REFRESH_INTERVAL_MS = 10 * 1000; // min 10s between auto-refreshes

  /**
   * Track user activity (mouse, keyboard, touch, scroll)
   */
  useEffect(() => {
    function trackActivity() {
      lastActivityRef.current = Date.now();
    }
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, trackActivity, { passive: true }));
    return () => events.forEach(e => window.removeEventListener(e, trackActivity));
  }, []);

  /**
   * Handle visibility changes - timeout or auto-refresh
   */
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible' || !currentUser) return;
      const now = Date.now();
      const inactiveMs = now - lastActivityRef.current;
      // Session timeout: force re-login after 15 min inactivity
      if (inactiveMs >= SESSION_TIMEOUT_MS) {
        showNotification('Sesi Anda telah berakhir karena tidak aktif selama 15 menit. Silakan login kembali.', 'warning');
        handleLogout();
        return;
      }
      // Auto-refresh: force new selectedOrg reference to trigger all pages' useEffect([selectedOrg])
      if (now - lastRefreshRef.current >= MIN_REFRESH_INTERVAL_MS && selectedOrg) {
        lastRefreshRef.current = now;
        lastActivityRef.current = now;
        setSelectedOrg(prev => prev ? Object.assign({}, prev) : prev);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentUser, selectedOrg]);

  /**
   * Refresh role permissions from DB when app loads with saved user
   */
  const refreshRolePermissions = useCallback(async (user) => {
    if (!user?.id) return;
    try {
      // Refresh role permissions
      if (user.role?.id) {
        const { data: role } = await supabase.from('roles').select('permissions, allow_maintenance_access').eq('id', user.role.id).single();
        if (role) {
          user = { ...user, role: { ...user.role, permissions: role.permissions, allow_maintenance_access: role.allow_maintenance_access || false } };
        }
      }
      // Always refresh department_id and department info from DB
      const { data: dbUser } = await supabase.from('users').select('department_id, departments:department_id(id, code, name)').eq('id', user.id).single();
      if (dbUser) {
        user = { ...user, department_id: dbUser.department_id || null, department: dbUser.departments || null };
      }
      setCurrentUser(user);
      localStorage.setItem('inventory_user', JSON.stringify(user));
    } catch (err) {
      // silently handled
    }
  }, []);

  /**
   * Load organizations for current user
   */
  const loadOrganizations = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('organizations').select('*').order('name');
      if (error) throw error;
      // Filter by user's hotel access if not superadmin
      let filteredOrgs = data || [];
      if (currentUser?.role?.code !== 'superadmin') {
        if (currentUser?.hotel_access?.length > 0) {
          filteredOrgs = filteredOrgs.filter(o => currentUser.hotel_access.includes(o.id));
        } else {
          // No hotel_access entries — only show user's primary organization if set
          filteredOrgs = currentUser?.organization_id ? filteredOrgs.filter(o => o.id === currentUser.organization_id) : [];
        }
      }
      setOrganizations(filteredOrgs);
      if (filteredOrgs.length > 0) setSelectedOrg(filteredOrgs[0]);
    } catch (err) {
      showNotification('Error loading organizations: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role?.code, currentUser?.hotel_access, currentUser?.organization_id]);

  /**
   * Load user data on mount or when currentUser changes
   */
  useEffect(() => {
    if (currentUser) {
      loadOrganizations();
      refreshRolePermissions(currentUser);
      if (currentUser.must_change_password) setShowForceChangePassword(true);
    } else {
      setLoading(false);
    }
  }, [currentUser?.id, loadOrganizations, refreshRolePermissions]);

  /**
   * Keep users.last_activity_at fresh while the app is open, so that a session
   * in continuous use is never mistaken for an abandoned account.
   */
  useEffect(() => {
    if (!currentUser?.id) return;

    let cancelled = false;
    async function ping() {
      const last = Number(localStorage.getItem(ACTIVITY_PING_KEY) || 0);
      if (Date.now() - last < ACTIVITY_PING_INTERVAL_MS) return;
      // Stamp before awaiting so two tabs waking together do not both write.
      localStorage.setItem(ACTIVITY_PING_KEY, String(Date.now()));
      const { error } = await supabase
        .from('users')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', currentUser.id);
      // On failure, clear the stamp so the next check retries rather than
      // waiting out a full hour on a transient network error.
      if (error && !cancelled) localStorage.removeItem(ACTIVITY_PING_KEY);
    }

    ping();
    const timer = setInterval(ping, ACTIVITY_CHECK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [currentUser?.id]);

  /**
   * Handle user login
   */
  const handleLogin = useCallback(async (username, password) => {
    // Try default password check first
    const defaultCheck = 'default_' + password;
    const hashedPassword = await hashPassword(password);

    const { data: user, error } = await supabase.from('users').select('*, roles:role_id(id, code, name, permissions, allow_maintenance_access), departments:department_id(id, code, name)').eq('username', username).eq('is_active', true).single();
    if (error || !user) return false;

    // Check password: either default format or hashed
    if (user.password_hash !== defaultCheck && user.password_hash !== hashedPassword) return false;

    // Update last_login. last_activity_at is reset too so a fresh login always
    // restarts the inactivity clock used by fn_auto_deactivate_inactive_users.
    const nowIso = new Date().toISOString();
    await supabase.from('users').update({ last_login: nowIso, last_activity_at: nowIso }).eq('id', user.id);
    localStorage.setItem(ACTIVITY_PING_KEY, String(Date.now()));

    // Load user's hotel access
    const { data: accessData } = await supabase.from('user_hotel_access').select('organization_id').eq('user_id', user.id);
    user.hotel_access = (accessData || []).map(a => a.organization_id);

    const userData = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: {
        ...user.roles,
        permissions: user.roles?.permissions || null,
        allow_maintenance_access: user.roles?.allow_maintenance_access || false
      },
      must_change_password: user.must_change_password,
      hotel_access: user.hotel_access,
      organization_id: user.organization_id,
      department_id: user.department_id || null,
      department: user.departments || null
    };

    // Check maintenance mode BEFORE allowing login.
    // The switch is system-wide (inventory.app_settings), not per-organization,
    // so a user's organization_id is irrelevant here — including when it is null.
    const roleCode = user.roles?.code;
    const roleHasAccess = user.roles?.allow_maintenance_access === true;
    if (roleCode !== 'superadmin' && !roleHasAccess) {
      const { data: maint, error: maintError } = await supabase.from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'maintenance_mode')
        .maybeSingle();
      // Fail closed: if the flag cannot be read, assume maintenance is on rather
      // than letting everyone through on a network hiccup or a missing row.
      if (maintError || maint?.setting_value !== 'false') {
        throw new Error('maintenance');
      }
    }

    setCurrentUser(userData);
    localStorage.setItem('inventory_user', JSON.stringify(userData));
    if (user.must_change_password) setShowForceChangePassword(true);
    return true;
  }, []);

  /**
   * Handle user logout
   */
  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    localStorage.removeItem('inventory_user');
    setCurrentPage('dashboard');
    setShowForceChangePassword(false);
    setLoading(false);
  }, []);

  /**
   * Handle force change password
   */
  const handleForceChangePassword = useCallback(async (newPassword) => {
    const hashed = await hashPassword(newPassword);
    const { error } = await supabase.from('users').update({ password_hash: hashed, must_change_password: false }).eq('id', currentUser.id);
    if (error) throw error;
    const updated = { ...currentUser, must_change_password: false };
    setCurrentUser(updated);
    localStorage.setItem('inventory_user', JSON.stringify(updated));
    setShowForceChangePassword(false);
  }, [currentUser?.id]);

  /**
   * Show notification toast
   */
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), type === 'error' ? 10000 : 4000);
  }, []);

  /**
   * Show confirm dialog
   */
  const showConfirm = useCallback((message, { title, variant } = {}) => {
    return new Promise((resolve) => {
      setConfirmDialog({
        message,
        title: title || 'Konfirmasi',
        variant: variant || 'warning',
        resolve
      });
    });
  }, []);

  /**
   * Load pending approval count
   */
  const loadPendingApprovalCount = useCallback(async () => {
    if (!selectedOrg) return 0;
    const userRole = currentUser?.role?.code;
    if (!['superadmin','gm','findir'].includes(userRole)) {
      return 0;
    }
    try {
      const [prRes, poRes, piRes, woRes, opnRes, dpRes] = await Promise.all([
        supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
        supabase.from('purchase_invoices').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
        supabase.from('write_offs').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
        supabase.from('stock_opname').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'SUBMITTED'),
        supabase.from('direct_purchases').select('id', { count: 'exact', head: true }).eq('organization_id', selectedOrg.id).eq('status', 'PENDING'),
      ]);
      return (prRes.count||0) + (poRes.count||0) + (piRes.count||0) + (woRes.count||0) + (opnRes.count||0) + (dpRes.count||0);
    } catch(e) {
      return 0;
    }
  }, [selectedOrg?.id, currentUser?.role?.code]);

  /**
   * Auto-lock previous period if past grace period
   */
  useEffect(() => {
    if (!selectedOrg) return;
    const gracePeriodDays = selectedOrg.grace_period_days || 3;
    const autoLock = async () => {
      const today = new Date();
      const dayOfMonth = today.getDate();
      if (dayOfMonth > gracePeriodDays) {
        const prevDate = new Date(today);
        prevDate.setDate(1); // Set to 1st to avoid month rollover
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevMonth = prevDate.getMonth() + 1;
        const prevYear = prevDate.getFullYear();
        try {
          const { data: existing } = await supabase.from('period_locks')
            .select('id')
            .eq('organization_id', selectedOrg.id)
            .eq('period_month', prevMonth)
            .eq('period_year', prevYear)
            .single();
          if (!existing) {
            await supabase.from('period_locks').insert({
              organization_id: selectedOrg.id,
              period_month: prevMonth,
              period_year: prevYear,
              lock_type: 'AUTO',
              is_locked: true,
              locked_at: new Date().toISOString(),
              created_at: new Date().toISOString()
            });
          }
        } catch (err) {
          // silently handled
        }
      }
    };
    autoLock();
  }, [selectedOrg?.id, selectedOrg?.grace_period_days]);

  /**
   * Load system settings into global cache when org changes
   */
  useEffect(() => {
    if (!selectedOrg) return;
    (async () => {
      try {
        const { data } = await supabase.from('system_settings').select('setting_key, setting_value').eq('organization_id', selectedOrg.id);
        const map = {};
        (data || []).forEach(r => { map[r.setting_key] = r.setting_value; });
        // Apply defaults
        if (!map.timezone) map.timezone = 'Asia/Bangkok';
        if (!map.currency) map.currency = 'IDR';
        if (!map.date_format) map.date_format = 'DD/MM/YYYY';
        window.__systemSettings = map;
      } catch (e) {
        window.__systemSettings = { timezone: 'Asia/Bangkok', currency: 'IDR', date_format: 'DD/MM/YYYY' };
      }
    })();
  }, [selectedOrg?.id]);

  /**
   * Maintenance mode polling — check every 30 seconds
   */
  useEffect(() => {
    if (!selectedOrg || !currentUser) return;
    let intervalId;
    async function checkMaintenance() {
      try {
        const { data } = await supabase.from('system_settings')
          .select('setting_value')
          .eq('organization_id', selectedOrg.id)
          .eq('setting_key', 'maintenance_mode')
          .single();
        const isOn = data?.setting_value === 'true';
        setMaintenanceMode(isOn);
        // If maintenance is ON and user is NOT authorized → force logout
        if (isOn) {
          const roleCode = currentUser?.role?.code;
          const roleHasAccess = currentUser?.role?.allow_maintenance_access === true;
          if (roleCode !== 'superadmin' && !roleHasAccess) {
            // Kick user
            handleLogout();
          }
        }
      } catch (e) {
        // If no record found, maintenance is off
        setMaintenanceMode(false);
      }
    }
    checkMaintenance();
    intervalId = setInterval(checkMaintenance, 30000);
    return () => clearInterval(intervalId);
  }, [selectedOrg?.id, currentUser?.id, handleLogout]);

  const contextValue = {
    // Auth
    currentUser,
    handleLogin,
    handleLogout,
    handleForceChangePassword,
    showForceChangePassword,

    // Organization
    selectedOrg,
    setSelectedOrg,
    organizations,
    loading,

    // Navigation
    currentPage,
    setCurrentPage,
    sidebarOpen,
    setSidebarOpen,

    // Notifications & Dialogs
    notification,
    showNotification,
    confirmDialog,
    setConfirmDialog,
    showConfirm,

    // System
    supabase,
    maintenanceMode,
    loadPendingApprovalCount,
  };

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}
