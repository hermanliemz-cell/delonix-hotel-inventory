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

function ChangePasswordPage() {
  const { showNotification, currentUser } = useApp();
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleChangePassword() {
    if (!currentUser?.id) return;
    if (newPassword.length < 6) { showNotification(t('pwd.errorShort'), 'error'); return; }
    if (newPassword !== confirmPassword) { showNotification(t('pwd.errorMismatch'), 'error'); return; }

    setLoading(true);
    // Verify current password
    const { data: user } = await supabase.from('users').select('password_hash').eq('id', currentUser.id).single();
    const currentHash = await hashPassword(currentPassword);
    if (user?.password_hash && user.password_hash !== currentHash) {
      showNotification(t('pwd.errorCurrent'), 'error');
      setLoading(false);
      return;
    }

    // Update password
    const newHash = await hashPassword(newPassword);
    const { error } = await supabase.from('users').update({ password_hash: newHash, must_change_password: false, updated_at: new Date().toISOString() }).eq('id', currentUser.id);
    if (error) { showNotification('Error: ' + error.message, 'error'); setLoading(false); return; }
    showNotification(t('pwd.success'), 'success');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setLoading(false);
  }

  return (
    <div>
      <PageHeader title={t('pwd.title')} subtitle={t('pwd.subtitle')} />

      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b">
            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
              <Icons.Lock />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">{t('pwd.title')}</h3>
              <p className="text-sm text-gray-500">{currentUser?.full_name} ({currentUser?.username})</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('pwd.currentPassword')} *</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Enter current password" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('pwd.newPassword')} *</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Min 6 characters" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t('pwd.confirmPassword')} *</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Re-enter new password" />
            </div>

            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <div className="text-red-500 text-xs flex items-center gap-1"><Icons.AlertTriangle /> {t('pwd.errorMismatch')}</div>
            )}

            <div className="pt-3">
              <Button onClick={handleChangePassword} disabled={!currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || loading} className="w-full">
                <Icons.Lock /> {loading ? '...' : t('pwd.change')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChangePasswordPage;