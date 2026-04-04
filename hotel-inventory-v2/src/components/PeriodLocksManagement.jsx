import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useTranslation } from '../hooks/useTranslation';
import { useApp } from '../hooks/useApp';
import { Badge } from './Badge';

function PeriodLocksManagement({ hotels, canEdit, currentUser }) {
  const { t } = useTranslation();
  const { showNotification, showConfirm } = useApp();
  const [locks, setLocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedHotel, setSelectedHotel] = useState(hotels.length > 0 ? hotels[0].id : null);

  const canReopen = ['superadmin', 'findir'].includes(currentUser?.role?.code);

  useEffect(() => {
    if (!selectedHotel && hotels.length > 0) {
      setSelectedHotel(hotels[0].id);
    }
  }, [hotels]);

  useEffect(() => {
    if (selectedHotel) loadLocks();
  }, [selectedHotel]);

  async function loadLocks() {
    setLoading(true);
    try {
      const { data } = await supabase.from('period_locks')
        .select('*')
        .eq('organization_id', selectedHotel)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false });
      setLocks(data || []);
    } catch (err) {
      showNotification('Error loading period locks: ' + err.message, 'error');
    }
    setLoading(false);
  }

  async function handleReopen(lock) {
    if (!(await showConfirm('Reopen this period?', { variant: 'warning' }))) return;
    try {
      const { error } = await supabase.from('period_locks')
        .update({ is_locked: false, reopened_at: new Date().toISOString(), reopened_by: currentUser.id })
        .eq('id', lock.id);
      if (error) throw error;
      showNotification('Period reopened', 'success');
      loadLocks();
    } catch (err) {
      showNotification('Error reopening period: ' + err.message, 'error');
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      {hotels.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('hotels.title')}</label>
          <select
            value={selectedHotel}
            onChange={(e) => setSelectedHotel(e.target.value)}
            className="w-full max-w-xs bg-white text-sm text-gray-900 border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {hotels.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="text-center py-4 text-gray-500">Loading...</div>
      ) : locks.length === 0 ? (
        <div className="text-center py-4 text-gray-500">No locked periods</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 font-semibold">Month/Year</th>
                <th className="text-left py-2 px-3 font-semibold">{t('backdate.lockPeriod')}</th>
                <th className="text-left py-2 px-3 font-semibold">Locked At</th>
                <th className="text-left py-2 px-3 font-semibold">{canReopen ? 'Action' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {locks.map(lock => (
                <tr key={lock.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3">{lock.period_month}/{lock.period_year}</td>
                  <td className="py-2 px-3">
                    <Badge color={lock.lock_type === 'AUTO' ? 'blue' : 'orange'}>
                      {lock.lock_type === 'AUTO' ? t('backdate.autoLocked') : t('backdate.manualLocked')}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {lock.locked_at ? new Date(lock.locked_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2 px-3">
                    {canReopen && lock.is_locked && (
                      <button
                        onClick={() => handleReopen(lock)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        {t('backdate.reopenPeriod')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default PeriodLocksManagement;
