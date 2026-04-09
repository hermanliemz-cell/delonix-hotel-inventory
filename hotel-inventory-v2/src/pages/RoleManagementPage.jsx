import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Badge } from '../components/FormElements';
import { Icons } from '../components/Icons';
import { canAccessPage } from '../utils/roles.js';

// ============================================================
// MENU AND ACTION DEFINITIONS
// ============================================================
const ALL_MENU_GROUPS = [
  { group: 'Dashboard', items: [
    { id: 'dashboard', label: 'Dashboard' },
  ]},
  { group: 'Global Master', items: [
    { id: 'hotels', label: 'Hotels' },
    { id: 'departments', label: 'Departments' },
    { id: 'vendors', label: 'Vendors' },
    { id: 'categories', label: 'Categories' },
    { id: 'room-types', label: 'Room Types' },
    { id: 'bed-formations', label: 'Bed Formations' },
  ]},
  { group: 'Hotel Master', items: [
    { id: 'items', label: 'Items' },
    { id: 'warehouses', label: 'Warehouses' },
    { id: 'rooms', label: 'Rooms' },
  ]},
  { group: 'Purchasing', items: [
    { id: 'purchase-request', label: 'Purchase Request' },
    { id: 'purchase-order', label: 'Purchase Order' },
    { id: 'purchase-invoice', label: 'Purchase Invoice' },
    { id: 'direct-purchase', label: 'Direct Purchase' },
    { id: 'approval', label: 'Approval' },
  ]},
  { group: 'Housekeeping', items: [
    { id: 'room-makeup-new', label: 'Room Make Up' },
    { id: 'worksheet', label: 'Worksheet' },
    { id: 'laundry', label: 'Laundry' },
    { id: 'room-consumption', label: 'Room Consumption History' },
    { id: 'item-lost-in-room', label: 'Item Lost in Room' },
    { id: 'rmu-activity-history', label: 'RMU Activity History' },
    { id: 'room-additional-request', label: 'Room Additional Request' },
  ]},
  { group: 'Stock Management', items: [
    { id: 'opening-balance', label: 'Opening Balance' },
    { id: 'stock', label: 'Stock Balance' },
    { id: 'movements', label: 'Bin Card' },
    { id: 'transfer', label: 'Transfer' },
    { id: 'opname', label: 'Stock Opname' },
    { id: 'in-use-warehouse', label: 'In-Use Warehouse' },
    { id: 'adjustment', label: 'Adjustment' },
  ]},
  { group: 'Stock Out', items: [
    { id: 'single-usage', label: 'Single Item Usage' },
    { id: 'writeoff', label: 'Write-Off' },
  ]},
  { group: null, items: [
    { id: 'reports', label: 'Reports' },
    { id: 'amenities-cost', label: 'Amenities Cost Report' },
    { id: 'laundry-outstanding', label: 'Laundry Outstanding Report' },
  ]},
  { group: 'Settings', items: [
    { id: 'user-mgmt', label: 'User Management' },
    { id: 'role-mgmt', label: 'Role Management' },
    { id: 'change-password', label: 'Change Password' },
    { id: 'system-settings', label: 'System Settings' },
  ]},
];

const ALL_MENUS = ALL_MENU_GROUPS.flatMap(g => g.items);

const ALL_ACTIONS = [
  { id: 'approve_pr', label: 'roles.action.approve_pr' },
  { id: 'approve_po', label: 'roles.action.approve_po' },
  { id: 'approve_pi', label: 'roles.action.approve_pi' },
  { id: 'approve_wo', label: 'roles.action.approve_wo' },
  { id: 'approve_opname', label: 'roles.action.approve_opname' },
  { id: 'revoke_approval', label: 'roles.action.revoke_approval' },
  { id: 'revert_to_draft', label: 'roles.action.revert_to_draft' },
  { id: 'export_reports', label: 'roles.action.export_reports' },
  { id: 'manage_users', label: 'roles.action.manage_users' },
  { id: 'manage_roles', label: 'roles.action.manage_roles' },
  { id: 'unlock_opening_balance', label: 'roles.action.unlock_opening_balance' },
  { id: 'view_all_room_makeups', label: 'roles.action.view_all_room_makeups' },
];

// ============================================================
// ROLE MANAGEMENT PAGE COMPONENT
// ============================================================
function RoleManagementPage() {
  const navigate = useNavigate();
  const { showNotification, showConfirm } = useApp();
  const { t } = useTranslation();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    menus: {},
    actions: {},
    allow_maintenance_access: false,
  });

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadRoles() {
    setLoading(true);
    const { data } = await supabase.from('roles').select('*').order('name');
    setRoles(data || []);
    setLoading(false);
  }

  function parsePermissions(perms) {
    if (!perms) return { menus: {}, actions: {} };
    if (perms.all === true) {
      const menus = {};
      ALL_MENUS.forEach(m => (menus[m.id] = true));
      const actions = {};
      ALL_ACTIONS.forEach(a => (actions[a.id] = true));
      return { menus, actions };
    }
    const menus = {};
    const actions = {};
    if (perms.menu_access) {
      Object.keys(perms.menu_access).forEach(k => (menus[k] = !!perms.menu_access[k]));
    }
    if (perms.special_actions) {
      Object.keys(perms.special_actions).forEach(k => (actions[k] = !!perms.special_actions[k]));
    }
    return { menus, actions };
  }

  function buildPermissions(menus, actions) {
    const allMenus = ALL_MENUS.every(m => menus[m.id]);
    const allActions = ALL_ACTIONS.every(a => actions[a.id]);
    if (allMenus && allActions) return { all: true };
    return { menu_access: { ...menus }, special_actions: { ...actions } };
  }

  function openCreate() {
    setEditing(null);
    setForm({
      name: '',
      description: '',
      menus: {},
      actions: {},
      allow_maintenance_access: false,
    });
    setShowForm(true);
  }

  function openEdit(role) {
    setEditing(role);
    const parsed = parsePermissions(role.permissions);
    setForm({
      name: role.name,
      description: role.description || '',
      menus: parsed.menus,
      actions: parsed.actions,
      allow_maintenance_access: !!role.allow_maintenance_access,
    });
    setShowForm(true);
  }

  function toggleMenu(menuId) {
    setForm(f => ({ ...f, menus: { ...f.menus, [menuId]: !f.menus[menuId] } }));
  }

  function toggleAction(actionId) {
    setForm(f => ({ ...f, actions: { ...f.actions, [actionId]: !f.actions[actionId] } }));
  }

  function toggleAllMenus() {
    const allOn = ALL_MENUS.every(m => form.menus[m.id]);
    const menus = {};
    ALL_MENUS.forEach(m => (menus[m.id] = !allOn));
    setForm(f => ({ ...f, menus }));
  }

  function toggleAllActions() {
    const allOn = ALL_ACTIONS.every(a => form.actions[a.id]);
    const actions = {};
    ALL_ACTIONS.forEach(a => (actions[a.id] = !allOn));
    setForm(f => ({ ...f, actions }));
  }

  async function handleSave() {
    const permissions = buildPermissions(form.menus, form.actions);
    const payload = {
      name: form.name,
      description: form.description,
      permissions,
      allow_maintenance_access: form.allow_maintenance_access,
    };
    if (editing) {
      await supabase.from('roles').update(payload).eq('id', editing.id);
    } else {
      payload.is_system = false;
      await supabase.from('roles').insert(payload);
    }
    showNotification(t('roles.successSave'), 'success');
    setShowForm(false);
    loadRoles();
  }

  async function handleDelete(role) {
    if (role.is_system) {
      showNotification(t('roles.cannotDeleteSystem'), 'error');
      return;
    }
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role_id', role.id);
    if (count > 0) {
      showNotification(
        `Cannot delete role "${role.name}" — ${count} user(s) assigned to this role.`,
        'error'
      );
      return;
    }
    if (!(await showConfirm(t('roles.confirmDelete'), { variant: 'danger' }))) return;
    await supabase.from('roles').delete().eq('id', role.id);
    showNotification(t('roles.successDelete'), 'success');
    loadRoles();
  }

  function getPermSummary(role) {
    const p = role.permissions || {};
    if (p.all) return 'Full Access';
    const ma = p.menu_access || {};
    const menuCount = Object.values(ma).filter(Boolean).length;
    const sa = p.special_actions || {};
    const actCount = Object.values(sa).filter(Boolean).length;
    return `${menuCount} menu, ${actCount} action`;
  }

  return (
    <div>
      <PageHeader
        title={t('roles.title')}
        subtitle={t('roles.subtitle')}
        actions={
          <Button onClick={openCreate}>
            <Icons.Plus /> {t('roles.createRole')}
          </Button>
        }
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable
          loading={loading}
          columns={[
            {
              header: t('roles.roleName'),
              render: r => <span className="font-semibold">{r.name}</span>,
            },
            {
              header: t('roles.description'),
              render: r => <span className="text-sm text-gray-600">{r.description || '-'}</span>,
            },
            {
              header: t('roles.permissions'),
              render: r => (
                <Badge color={r.permissions?.all ? 'green' : 'blue'}>
                  {getPermSummary(r)}
                </Badge>
              ),
            },
            {
              header: t('common.status'),
              render: r =>
                r.is_system ? (
                  <Badge color="purple">{t('roles.system')}</Badge>
                ) : (
                  <Badge color="gray">Custom</Badge>
                ),
            },
          ]}
          data={roles}
          actions={row => (
            <div className="flex gap-1 justify-end">
              <button
                onClick={() => openEdit(row)}
                className="p-1 text-blue-600 hover:bg-blue-50 rounded"
              >
                <Icons.Edit />
              </button>
              {!row.is_system && (
                <button
                  onClick={() => handleDelete(row)}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                >
                  <Icons.Trash />
                </button>
              )}
            </div>
          )}
        />
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? t('roles.editRole') : t('roles.createRole')}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">
                {t('roles.roleName')} *
              </label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">
                {t('roles.description')}
              </label>
              <input
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* Menu Access */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">{t('roles.menuAccess')}</h4>
              <button
                onClick={toggleAllMenus}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                {ALL_MENUS.every(m => form.menus[m.id]) ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg max-h-64 overflow-y-auto space-y-3">
              {ALL_MENU_GROUPS.map((grp, gi) => (
                <div key={gi}>
                  {grp.group && (
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 px-2 border-b border-gray-200 pb-1">
                      {grp.group}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0.5">
                    {grp.items.map(menu => (
                      <label
                        key={menu.id}
                        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white cursor-pointer text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={!!form.menus[menu.id]}
                          onChange={() => toggleMenu(menu.id)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600"
                        />
                        <span className="text-gray-700">{menu.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Special Actions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-700">{t('roles.specialActions')}</h4>
              <button
                onClick={toggleAllActions}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                {ALL_ACTIONS.every(a => form.actions[a.id]) ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 bg-gray-50 p-3 rounded-lg">
              {ALL_ACTIONS.map(action => (
                <label
                  key={action.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={!!form.actions[action.id]}
                    onChange={() => toggleAction(action.id)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-primary-600"
                  />
                  <span className="text-gray-700">{t(action.label)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Maintenance Access */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.allow_maintenance_access}
                onChange={e =>
                  setForm({ ...form, allow_maintenance_access: e.target.checked })
                }
                className="w-4 h-4 mt-0.5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <div>
                <span className="text-sm font-semibold text-amber-800">
                  {t('roles.allowMaintenanceAccess')}
                </span>
                <p className="text-xs text-amber-600 mt-0.5">
                  {t('roles.allowMaintenanceAccessDesc')}
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!form.name}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default RoleManagementPage;
