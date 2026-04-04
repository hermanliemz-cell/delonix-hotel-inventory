import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatCurrency, formatDate, formatDateSys } from '../utils/format';
import { Modal } from '../components/Modal';
import { Button, Input, Badge, Select } from '../components/FormElements';
import { Checkbox } from '../components/Checkbox';
import { FormField } from '../components/FormField';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Tab } from '../components/Tab';
import { DataTable } from '../components/DataTable';

function VendorsPage() {
  const { t } = useTranslation();
  const { showNotification } = useApp();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editVendor, setEditVendor] = useState(null);
  const [form, setForm] = useState({ code:'', name:'', contact_person:'', phone:'', email:'', address:'', city:'', payment_terms:30 });

  useEffect(() => { loadVendors(); }, []);

  async function loadVendors() {
    setLoading(true);
    const { data } = await supabase.from('vendors').select('*').order('name');
    setVendors(data || []);
    setLoading(false);
  }

  function openCreate() {
    setEditVendor(null);
    setForm({ code:'', name:'', contact_person:'', phone:'', email:'', address:'', city:'', payment_terms:30 });
    setShowModal(true);
  }

  function openEdit(v) {
    setEditVendor(v);
    setForm({ code:v.code, name:v.name, contact_person:v.contact_person||'', phone:v.phone||'', email:v.email||'', address:v.address||'', city:v.city||'', payment_terms:v.payment_terms||30 });
    setShowModal(true);
  }

  async function handleSave() {
    try {
      if (editVendor) {
        const { error } = await supabase.from('vendors').update(form).eq('id', editVendor.id);
        if (error) throw error;
        showNotification(t('vendors.successUpdate'));
      } else {
        const { error } = await supabase.from('vendors').insert(form);
        if (error) throw error;
        showNotification(t('vendors.successAdd'));
      }
      setShowModal(false);
      loadVendors();
    } catch(err) { showNotification('Error: '+err.message,'error'); }
  }

  return (
    <div>
      <PageHeader title={t('vendors.title')} subtitle={`${vendors.length} ${t('vendors.registered')}`}
        actions={<Button onClick={openCreate}><Icons.Plus /> {t('vendors.addVendor')}</Button>} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable loading={loading}
          columns={[
            { header: t('common.code'), render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('common.name'), render: r => <span className="font-medium">{r.name}</span> },
            { header: t('vendors.contactPerson'), key:'contact_person' },
            { header: t('vendors.phone'), key:'phone' },
            { header: t('vendors.city'), key:'city' },
            { header: t('vendors.terms'), render: r => `${r.payment_terms} ${t('vendors.days')}` },
            { header: t('common.status'), render: r => <Badge color={r.is_active?'green':'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={vendors}
          actions={row => <button onClick={e=>{e.stopPropagation();openEdit(row)}} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit/></button>}
        />
      </div>
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editVendor ? t('vendors.editVendor') : t('vendors.addNew')} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('common.code')} required><Input value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="VND-006"/></FormField>
          <FormField label={t('common.name')} required><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></FormField>
          <FormField label={t('vendors.contactPerson')}><Input value={form.contact_person} onChange={e=>setForm({...form,contact_person:e.target.value})}/></FormField>
          <FormField label={t('vendors.phone')}><Input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></FormField>
          <FormField label={t('vendors.email')}><Input value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></FormField>
          <FormField label={t('vendors.city')}><Input value={form.city} onChange={e=>setForm({...form,city:e.target.value})}/></FormField>
          <FormField label={t('vendors.address')}><Input value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></FormField>
          <FormField label={t('vendors.paymentTerms')}><Input type="number" value={form.payment_terms} onChange={e=>setForm({...form,payment_terms:parseInt(e.target.value)||30})}/></FormField>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={()=>setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave}>{editVendor ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}

export default VendorsPage;