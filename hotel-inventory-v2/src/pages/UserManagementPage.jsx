import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { Checkbox } from '../components/Checkbox';

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '_inventory_salt_2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function UserManagementPage() {
  const { showNotification, showConfirm, currentUser } = useApp();
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [orgs, setOrgs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [userHotelMap, setUserHotelMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ full_name: '', username: '', email: '', phone: '', role_id: '', hotel_ids: [], department_id: '', is_active: true, password: '' });

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [usersRes, rolesRes, orgsRes, deptRes, accessRes] = await Promise.all([
      supabase.from('users').select('*, roles(name, code), organizations(name, code), departments(name, code)').order('full_name'),
      supabase.from('roles').select('id, name, code').order('name'),
      supabase.from('organizations').select('id, name, code').order('name'),
      supabase.from('departments').select('id, name, code, organization_id').eq('is_active', true).order('name'),
      supabase.from('user_hotel_access').select('user_id, organization_id, organizations(code, name)'),
    ]);
    setRoles(rolesRes.data || []);
    setOrgs(orgsRes.data || []);
    setDepartments(deptRes.data || []);
    // Build map: userId -> [{ organization_id, code, name }]
    const map = {};
    (accessRes.data || []).forEach(a => {
      if (!map[a.user_id]) map[a.user_id] = [];
      map[a.user_id].push({ organization_id: a.organization_id, code: a.organizations?.code, name: a.organizations?.name });
    });
    setUserHotelMap(map);
    // Filter users: non-superadmin only sees users who share at least one hotel
    // Read from localStorage to avoid stale closure issues
    const activeUser = JSON.parse(localStorage.getItem('inventory_user') || 'null');
    let allUsers = usersRes.data || [];
    if (activeUser?.role?.code !== 'superadmin' && activeUser?.hotel_access?.length > 0) {
      const myHotels = new Set(activeUser.hotel_access);
      allUsers = allUsers.filter(u => {
        const userHotels = (map[u.id] || []).map(h => h.organization_id);
        // Show user if they share at least one hotel with current user
        return userHotels.some(h => myHotels.has(h));
      });
    }
    setUsers(allUsers);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({ full_name: '', username: '', email: '', phone: '', role_id: '', hotel_ids: [], department_id: '', is_active: true, password: '' });
    setShowForm(true);
  }

  async function openEdit(user) {
    setEditing(user);
    // Load user's hotel_access
    const existingAccess = userHotelMap[user.id] || [];
    const hotelIds = existingAccess.map(a => a.organization_id);
    setForm({ full_name: user.full_name || '', username: user.username || '', email: user.email || '', phone: user.phone || '', role_id: user.role_id || '', hotel_ids: hotelIds, department_id: user.department_id || '', is_active: user.is_active !== false, password: '' });
    setShowForm(true);
  }

  async function handleSave() {
    // Validate password required for new user
    if (!editing && (!form.password || form.password.length < 6)) {
      showNotification(t('users.passwordRequired') || 'Password is required (min 6 characters) for new user', 'error');
      return;
    }
    // Role and hotel are mandatory. A user saved without either ends up with a
    // null role_id or organization_id, which leaves them outside every
    // permission and hotel-scoping check in the app.
    if (!form.role_id) {
      showNotification(t('users.roleRequired') || 'Role is required', 'error');
      return;
    }
    if (!form.hotel_ids.length) {
      showNotification(t('users.hotelRequired') || 'At least one hotel is required', 'error');
      return;
    }
    // organization_id mirrors the first selected hotel (kept for backward compatibility)
    const primaryOrg = form.hotel_ids[0];
    const payload = { full_name: form.full_name, username: form.username || null, email: form.email || null, phone: form.phone || null, role_id: form.role_id || null, organization_id: primaryOrg, department_id: form.department_id || null, is_active: form.is_active };
    if (form.password && form.password.length >= 6) {
      payload.password_hash = await hashPassword(form.password);
    }
    let userId;
    if (editing) {
      const { error } = await supabase.from('users').update(payload).eq('id', editing.id);
      if (error) { showNotification(error.message, 'error'); return; }
      userId = editing.id;
    } else {
      const { data: newUser, error } = await supabase.from('users').insert(payload).select('id').single();
      if (error) { showNotification(error.message, 'error'); return; }
      userId = newUser?.id;
    }
    // Upsert user_hotel_access
    if (userId) {
      // Delete existing access entries
      const { error: delErr } = await supabase.from('user_hotel_access').delete().eq('user_id', userId);
      if (delErr) { showNotification(delErr.message, 'error'); return; }
      // Insert new access entries
      if (form.hotel_ids.length > 0) {
        const accessRows = form.hotel_ids.map(orgId => ({ user_id: userId, organization_id: orgId }));
        const { error: insErr } = await supabase.from('user_hotel_access').insert(accessRows);
        if (insErr) { showNotification(insErr.message, 'error'); return; }
      }
    }
    showNotification(t('users.successSave'), 'success');
    setShowForm(false);
    loadData();
  }

  async function handleDelete(user) {
    // Check dependencies
    const [smRes, acRes, iuRes] = await Promise.all([
      supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('created_by', user.id),
      supabase.from('makeup_activity_checks').select('id', { count: 'exact', head: true }).eq('checked_by', user.id),
      supabase.from('makeup_inuse_checks').select('id', { count: 'exact', head: true }).eq('checked_by', user.id),
    ]);
    const deps = [];
    if (smRes.count > 0) deps.push(`${smRes.count} stock movement(s)`);
    if (acRes.count > 0) deps.push(`${acRes.count} activity check(s)`);
    if (iuRes.count > 0) deps.push(`${iuRes.count} in-use check(s)`);
    if (deps.length > 0) {
      const msg = `Cannot delete user "${user.full_name}" — linked data: ${deps.join(', ')}. Deactivate instead?`;
      if (await showConfirm(msg, { variant: 'warning' })) {
        await supabase.from('users').update({ is_active: false }).eq('id', user.id);
        loadData();
      }
      return;
    }
    if (!(await showConfirm(t('users.confirmDelete'), { variant: 'danger' }))) return;
    await supabase.from('users').delete().eq('id', user.id);
    showNotification(t('users.successDelete'), 'success');
    loadData();
  }

  // Filter orgs: superadmin sees all, others only see hotels they have access to
  const isSuperadmin = currentUser?.role?.code === 'superadmin';
  const availableOrgs = isSuperadmin ? orgs : orgs.filter(o => (currentUser?.hotel_access || []).includes(o.id));

  // Departments are shared/global master - show all departments regardless of organization
  const filteredDepts = departments;

  return (
    <div>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} actions={<Button onClick={openCreate}><Icons.Plus /> {t('users.createUser')}</Button>} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('users.fullName'), render: r => <div><span className="font-medium">{r.full_name}</span>{r.username ? <span className="text-xs text-gray-400 ml-1">@{r.username}</span> : ''}</div> },
            { header: t('users.email'), render: r => <span className="text-sm">{r.email}</span> },
            { header: t('users.role'), render: r => <Badge color="purple">{r.roles?.name || '-'}</Badge> },
            { header: t('users.hotel'), render: r => {
              const hotels = userHotelMap[r.id] || [];
              if (hotels.length === 0) return <Badge color="gray">{t('users.allHotels')}</Badge>;
              return <div className="flex flex-wrap gap-1">{hotels.map(h => <Badge key={h.organization_id} color="blue">{h.code}</Badge>)}</div>;
            }},
            { header: t('users.department'), render: r => r.departments ? <Badge color="green">{r.departments.code}</Badge> : <span className="text-gray-400">-</span> },
            { header: t('users.lastActivity'), render: r => {
              if (!r.last_activity_at) return <span className="text-gray-400">-</span>;
              const days = Math.floor((Date.now() - new Date(r.last_activity_at).getTime()) / 86400000);
              // Warn once an account is within a week of the 30-day default.
              const color = days >= 30 ? 'text-red-600 font-semibold' : days >= 23 ? 'text-amber-600' : 'text-gray-600';
              return <span className={`text-sm ${color}`}>{days === 0 ? t('users.today') : t('users.daysAgo').replace('{n}', days)}</span>;
            }},
            { header: t('common.status'), render: r => <Badge color={r.is_active?'green':'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={users}
          actions={row => {
            const myRole = currentUser?.role?.code;
            const targetRole = row.roles?.code;
            // Non-superadmin cannot edit/delete superadmin users
            const canModify = myRole === 'superadmin' || targetRole !== 'superadmin';
            // Cannot delete yourself
            const canDelete = canModify && row.id !== currentUser?.id;
            return (
            <div className="flex gap-1 justify-end">
              {canModify && <button onClick={() => openEdit(row)} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Icons.Edit /></button>}
              {canDelete && <button onClick={() => handleDelete(row)} className="p-1 text-red-600 hover:bg-red-50 rounded"><Icons.Trash /></button>}
            </div>
          );}}
        />
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? t('users.editUser') : t('users.createUser')}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.fullName')} *</label>
              <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.username')}</label>
              <input value={form.username} onChange={e => setForm({...form, username: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="optional" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.email')}</label>
              <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.phone')}</label>
              <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.password')}</label>
            <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder={t('users.passwordHint')} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.role')}</label>
              <select value={form.role_id} onChange={e => setForm({...form, role_id: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">{t('users.selectRole')}</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.hotel')}</label>
              <div className="border border-gray-200 rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto bg-white">
                {availableOrgs.map(o => (
                  <label key={o.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                    <input type="checkbox" checked={form.hotel_ids.includes(o.id)} onChange={e => {
                      const newIds = e.target.checked ? [...form.hotel_ids, o.id] : form.hotel_ids.filter(id => id !== o.id);
                      setForm({...form, hotel_ids: newIds});
                    }} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                    <span className="text-sm">{o.code} - {o.name}</span>
                  </label>
                ))}
                {availableOrgs.length === 0 && <span className="text-xs text-gray-400 px-2">No hotels available</span>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('users.department')}</label>
              <select value={form.department_id} onChange={e => setForm({...form, department_id: e.target.value})} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                <option value="">{t('users.selectDept')}</option>
                {filteredDepts.map(d => <option key={d.id} value={d.id}>{d.code} - {d.name}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} className="w-4 h-4 rounded border-gray-300" />
                <span className="text-sm font-medium text-gray-700">{t('common.active')}</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="secondary" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={!form.full_name}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default UserManagementPage;