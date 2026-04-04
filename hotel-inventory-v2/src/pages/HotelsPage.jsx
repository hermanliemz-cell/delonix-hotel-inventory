import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp, useTranslation } from '../hooks/index.js';
import { Icons } from '../components/Icons';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { Button, Input } from '../components/FormElements';
import PeriodLocksManagement from '../components/PeriodLocksManagement';
import { PageLoader } from '../components/PageLoader';

function HotelsPage() {
  const { selectedOrg, showNotification, currentUser } = useApp();
  const { t } = useTranslation();
  const [hotels, setHotels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isView, setIsView] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [logoPreview, setLogoPreview] = useState(null);

  const userRoleCode = currentUser?.role?.code || '';
  const canEdit = ['superadmin','gm','findir'].includes(userRoleCode);

  async function loadHotels() {
    setLoading(true);
    const { data, error } = await supabase.from('organizations')
      .select('*').order('name');
    if (!error) setHotels(data || []);
    setLoading(false);
  }

  React.useEffect(() => { loadHotels(); }, []);

  function populateForm(hotel) {
    return {
      name: hotel.name || '', code: hotel.code || '', company_name: hotel.company_name || '',
      npwp: hotel.npwp || '', address: hotel.address || '',
      shipping_address: hotel.shipping_address || '', phone: hotel.phone || '',
      email: hotel.email || '', city: hotel.city || '', postal_code: hotel.postal_code || '',
      website: hotel.website || '', contact_person: hotel.contact_person || '',
      contact_phone: hotel.contact_phone || '',
      max_backdate_days: hotel.max_backdate_days !== null ? hotel.max_backdate_days : 3,
      grace_period_days: hotel.grace_period_days !== null ? hotel.grace_period_days : 3,
    };
  }

  function openEdit(hotel) {
    setEditing(hotel); setForm(populateForm(hotel)); setLogoPreview(hotel.logo_url || null);
    setIsView(false); setShowModal(true);
  }

  function openAdd() {
    setEditing(null); setForm({ name:'', code:'', company_name:'', npwp:'', address:'',
      shipping_address:'', phone:'', email:'', city:'', postal_code:'',
      website:'', contact_person:'', contact_phone:'', max_backdate_days: 3, grace_period_days: 3 });
    setLogoPreview(null); setIsView(false); setShowModal(true);
  }

  function openView(hotel) {
    setEditing(hotel); setForm(populateForm(hotel)); setLogoPreview(hotel.logo_url || null);
    setIsView(true); setShowModal(true);
  }

  function handleLogoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500 * 1024) { showNotification('Logo file must be under 500KB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { setLogoPreview(ev.target.result); };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!form.name || !form.code) { showNotification('Hotel name and code are required', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name, code: form.code, company_name: form.company_name || null,
        npwp: form.npwp || null, address: form.address || null,
        shipping_address: form.shipping_address || null, phone: form.phone || null,
        email: form.email || null, city: form.city || null, postal_code: form.postal_code || null,
        website: form.website || null, contact_person: form.contact_person || null,
        contact_phone: form.contact_phone || null, logo_url: logoPreview || null,
        max_backdate_days: form.max_backdate_days || 3,
        grace_period_days: form.grace_period_days || 3,
        updated_at: new Date().toISOString(),
      };
      if (editing) {
        const { error } = await supabase.from('organizations').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        payload.is_active = true; payload.created_at = new Date().toISOString();
        const { data: newOrg, error } = await supabase.from('organizations').insert(payload).select().single();
        if (error) throw error;
        // Auto-create default warehouses for new hotel
        if (newOrg) {
          const code = newOrg.code || '';
          const defaultWarehouses = [
            { code: 'HK-' + code, name: 'Housekeeping Store', warehouse_type: 'store' },
            { code: 'DMG-' + code, name: 'Damaged Warehouse ' + code, warehouse_type: 'damage' },
            { code: 'IU-' + code, name: 'In-Use Warehouse ' + code, warehouse_type: 'in_use' },
            { code: 'DRT-' + code, name: 'Dirty Linen Staging ' + code, warehouse_type: 'dirty' },
            { code: 'LDR-' + code, name: 'Laundry Vendor ' + code, warehouse_type: 'laundry' },
          ];
          for (const wh of defaultWarehouses) {
            await supabase.from('warehouses').insert({
              organization_id: newOrg.id, ...wh, is_active: true
            });
          }
        }
      }
      showNotification(t('hotels.saveSuccess'), 'success');
      setShowModal(false); loadHotels();
    } catch (err) {
      showNotification(t('hotels.saveFailed') + ': ' + err.message, 'error');
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">{t('hotels.title')}</h2>
        {canEdit && <Button variant="primary" onClick={openAdd}><Icons.Plus /> {t('hotels.addHotel')}</Button>}
      </div>

      {loading ? <PageLoader /> : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{}}>
          {hotels.map(hotel => (
            <div key={hotel.id} onClick={() => canEdit ? openEdit(hotel) : openView(hotel)}
              className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 cursor-pointer hover:shadow-lg transition-shadow relative">
              <div className="flex gap-4 items-start">
                {hotel.logo_url ? (
                  <img src={hotel.logo_url} alt="Logo" className="w-16 h-16 object-contain rounded-lg border border-gray-200" />
                ) : (
                  <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-2xl"><Icons.Building /></div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base text-gray-900">{hotel.name}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{hotel.code}</div>
                  {hotel.company_name && <div className="text-sm text-gray-600 mt-1">{hotel.company_name}</div>}
                  {hotel.city && <div className="text-xs text-gray-400 mt-0.5">{hotel.city}</div>}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {hotel.phone && <div className="text-xs text-gray-500 truncate">Tel: {hotel.phone}</div>}
                {hotel.email && <div className="text-xs text-gray-500 truncate">@: {hotel.email}</div>}
                {hotel.npwp && <div className="text-xs text-gray-500 truncate">NPWP: {hotel.npwp}</div>}
                {hotel.website && <div className="text-xs text-gray-500 truncate">Web: {hotel.website}</div>}
              </div>
              {!canEdit && <div className="absolute top-2 right-2 bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded">{t('hotels.viewOnly')}</div>}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} size="xl"
        title={isView ? (editing?.name || t('hotels.title')) : (editing ? t('hotels.editHotel') : t('hotels.addHotel'))}>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center mb-6">
          {logoPreview ? (
            <div className="relative">
              <img src={logoPreview} alt="Logo" className="w-20 h-20 object-contain rounded-lg border border-gray-200" />
              {!isView && <button onClick={() => setLogoPreview(null)}
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white border-none cursor-pointer text-xs flex items-center justify-center">×</button>}
            </div>
          ) : (
            <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-3xl"><Icons.Building /></div>
          )}
          {!isView && (
            <div>
              <label className="inline-block px-3 py-1.5 bg-blue-500 text-white rounded-md cursor-pointer text-sm">
                {t('hotels.uploadLogo')}
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </label>
              <div className="text-xs text-gray-400 mt-1">Max 500KB, stored as Base64</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('hotels.hotelName')} required>
            <Input value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.hotelCode')} required>
            <Input value={form.code || ''} onChange={e => setForm({...form, code: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.companyName')}>
            <Input value={form.company_name || ''} onChange={e => setForm({...form, company_name: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.npwp')}>
            <Input value={form.npwp || ''} onChange={e => setForm({...form, npwp: e.target.value})} disabled={isView} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label={t('hotels.address')}>
              <textarea value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} disabled={isView} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y" />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField label={t('hotels.shippingAddress')}>
              <textarea value={form.shipping_address || ''} onChange={e => setForm({...form, shipping_address: e.target.value})} disabled={isView} rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y" />
            </FormField>
          </div>
          <FormField label={t('hotels.phone')}>
            <Input value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.email')}>
            <Input type="email" value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.city')}>
            <Input value={form.city || ''} onChange={e => setForm({...form, city: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.postalCode')}>
            <Input value={form.postal_code || ''} onChange={e => setForm({...form, postal_code: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.website')}>
            <Input value={form.website || ''} onChange={e => setForm({...form, website: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.contactPerson')}>
            <Input value={form.contact_person || ''} onChange={e => setForm({...form, contact_person: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('hotels.contactPhone')}>
            <Input value={form.contact_phone || ''} onChange={e => setForm({...form, contact_phone: e.target.value})} disabled={isView} />
          </FormField>
          <FormField label={t('backdate.maxBackdateDays')}>
            <Input type="number" min="0" value={form.max_backdate_days || 3} onChange={e => setForm({...form, max_backdate_days: parseInt(e.target.value) || 3})} disabled={isView} />
          </FormField>
          <FormField label={t('backdate.gracePeriodDays')}>
            <Input type="number" min="0" value={form.grace_period_days || 3} onChange={e => setForm({...form, grace_period_days: parseInt(e.target.value) || 3})} disabled={isView} />
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          {!isView && canEdit && <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : t('common.save')}</Button>}
        </div>
      </Modal>

      {/* Period Locks Section */}
      <div className="mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4">{t('backdate.periodLocks')}</h3>
        <PeriodLocksManagement hotels={hotels} canEdit={canEdit} currentUser={currentUser} />
      </div>
    </div>
  );
}

export default HotelsPage;
