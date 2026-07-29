import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from '../components/FormElements';
import { Icons } from '../components/Icons';
import { PageLoader } from '../components/PageLoader';

function SystemSettingsPage() {
  const { selectedOrg, showNotification, currentUser } = useApp();
  const { t } = useTranslation();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('regional');

  const TIMEZONE_OPTIONS = [
    { value: 'Asia/Bangkok', label: 'WIB - Asia/Bangkok (UTC+7)' },
    { value: 'Asia/Singapore', label: 'WITA - Asia/Singapore (UTC+8)' },
    { value: 'Asia/Jayapura', label: 'WIT - Asia/Jayapura (UTC+9)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
    { value: 'UTC', label: 'UTC (UTC+0)' },
  ];

  const CURRENCY_OPTIONS = [
    { value: 'IDR', label: 'IDR - Indonesian Rupiah' },
    { value: 'USD', label: 'USD - US Dollar' },
    { value: 'SGD', label: 'SGD - Singapore Dollar' },
    { value: 'MYR', label: 'MYR - Malaysian Ringgit' },
    { value: 'CNY', label: 'CNY - Chinese Yuan' },
    { value: 'THB', label: 'THB - Thai Baht' },
  ];

  const DATE_FORMAT_OPTIONS = [
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-12-31)' },
    { value: 'DD-MMM-YYYY', label: 'DD-MMM-YYYY (31-Dec-2026)' },
  ];

  const LANGUAGE_OPTIONS = [
    { value: 'id', label: 'Bahasa Indonesia' },
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文 (Chinese)' },
  ];

  const MONTH_OPTIONS = [
    { value: '01', label: 'January' }, { value: '02', label: 'February' },
    { value: '03', label: 'March' }, { value: '04', label: 'April' },
    { value: '05', label: 'May' }, { value: '06', label: 'June' },
    { value: '07', label: 'July' }, { value: '08', label: 'August' },
    { value: '09', label: 'September' }, { value: '10', label: 'October' },
    { value: '11', label: 'November' }, { value: '12', label: 'December' },
  ];

  useEffect(() => { if (selectedOrg) loadSettings(); }, [selectedOrg]);

  async function loadSettings() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('setting_key, setting_value')
        .eq('organization_id', selectedOrg.id);
      if (error) throw error;
      const map = {};
      (data || []).forEach(r => { map[r.setting_key] = r.setting_value; });
      // maintenance_mode is system-wide, not per-organization — it lives in
      // app_settings so a single switch covers every hotel, including new ones.
      const { data: globalRow, error: globalError } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('setting_key', 'maintenance_mode')
        .maybeSingle();
      if (globalError) throw globalError;
      map.maintenance_mode = globalRow?.setting_value === 'true' ? 'true' : 'false';
      // Apply defaults for any missing settings
      const defaults = {
        timezone: 'Asia/Bangkok', currency: 'IDR', date_format: 'DD/MM/YYYY',
        language: 'id', low_stock_threshold: '10', auto_generate_code: 'true', fiscal_year_start: '01'
      };
      Object.keys(defaults).forEach(k => { if (!map[k]) map[k] = defaults[k]; });
      setSettings(map);
    } catch (err) {
      showNotification('Error loading settings: ' + err.message, 'error');
    }
    setLoading(false);
  }

  function updateSetting(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      // maintenance_mode is stored globally, so keep it out of the per-org upsert.
      const upserts = Object.entries(settings)
        .filter(([key]) => key !== 'maintenance_mode')
        .map(([key, val]) => ({
          organization_id: selectedOrg.id,
          setting_key: key,
          setting_value: val,
          updated_at: new Date().toISOString(),
        }));
      const { error } = await supabase
        .from('system_settings')
        .upsert(upserts, { onConflict: 'organization_id,setting_key' });
      if (error) throw error;

      const { error: globalError } = await supabase
        .from('app_settings')
        .upsert({
          setting_key: 'maintenance_mode',
          setting_value: settings.maintenance_mode === 'true' ? 'true' : 'false',
          updated_at: new Date().toISOString(),
          updated_by: currentUser?.id || null,
        }, { onConflict: 'setting_key' });
      if (globalError) throw globalError;
      showNotification(t('settings.saved'));
      // Update the global settings cache
      if (window.__systemSettings) {
        Object.assign(window.__systemSettings, settings);
      } else {
        window.__systemSettings = { ...settings };
      }
    } catch (err) {
      showNotification(t('settings.saveError') + ': ' + err.message, 'error');
    }
    setSaving(false);
  }

  function SettingRow({ label, desc, children }) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-gray-100 last:border-0 gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        <div className="sm:w-72 flex-shrink-0">{children}</div>
      </div>
    );
  }

  if (loading) return <PageLoader />;

  const tabs = [
    { id: 'regional', label: t('settings.regional'), icon: Icons.Globe || Icons.Settings },
    { id: 'inventory', label: t('settings.inventory'), icon: Icons.Package },
    { id: 'general', label: t('settings.general'), icon: Icons.Settings },
    { id: 'maintenance', label: t('settings.maintenance'), icon: Icons.Lock },
  ];

  const selectClass = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white";
  const inputClass = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500";

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t('settings.title')}</h2>
          <p className="text-gray-500 text-sm mt-1">{t('settings.subtitle')}</p>
        </div>
        <Button onClick={saveSettings} disabled={saving}>
          {saving ? <><div className="spinner mr-2" style={{width:16,height:16,borderWidth:2}} /> {t('settings.saving')}</> : <><Icons.Save /> {t('settings.save')}</>}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <tab.icon /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {activeTab === 'regional' && (
          <div>
            <SettingRow label={t('settings.timezone')} desc={t('settings.timezoneDesc')}>
              <select className={selectClass} value={settings.timezone || 'Asia/Bangkok'} onChange={e => updateSetting('timezone', e.target.value)}>
                {TIMEZONE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </SettingRow>
            <SettingRow label={t('settings.currency')} desc={t('settings.currencyDesc')}>
              <select className={selectClass} value={settings.currency || 'IDR'} onChange={e => updateSetting('currency', e.target.value)}>
                {CURRENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </SettingRow>
            <SettingRow label={t('settings.dateFormat')} desc={t('settings.dateFormatDesc')}>
              <select className={selectClass} value={settings.date_format || 'DD/MM/YYYY'} onChange={e => updateSetting('date_format', e.target.value)}>
                {DATE_FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </SettingRow>
            <SettingRow label={t('settings.language')} desc={t('settings.languageDesc')}>
              <select className={selectClass} value={settings.language || 'id'} onChange={e => updateSetting('language', e.target.value)}>
                {LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </SettingRow>
          </div>
        )}

        {activeTab === 'inventory' && (
          <div>
            <SettingRow label={t('settings.lowStockThreshold')} desc={t('settings.lowStockThresholdDesc')}>
              <input type="number" className={inputClass} min="0" value={settings.low_stock_threshold || '10'} onChange={e => updateSetting('low_stock_threshold', e.target.value)} />
            </SettingRow>
            <SettingRow label={t('settings.autoGenerateCode')} desc={t('settings.autoGenerateCodeDesc')}>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={settings.auto_generate_code === 'true'} onChange={e => updateSetting('auto_generate_code', e.target.checked ? 'true' : 'false')} />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                <span className="ml-3 text-sm text-gray-700">{settings.auto_generate_code === 'true' ? 'Enabled' : 'Disabled'}</span>
              </label>
            </SettingRow>
          </div>
        )}

        {activeTab === 'general' && (
          <div>
            <SettingRow label={t('settings.fiscalYearStart')} desc={t('settings.fiscalYearStartDesc')}>
              <select className={selectClass} value={settings.fiscal_year_start || '01'} onChange={e => updateSetting('fiscal_year_start', e.target.value)}>
                {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </SettingRow>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div>
            {settings.maintenance_mode === 'true' && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <Icons.AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">{t('settings.maintenanceActive')}</p>
                </div>
              </div>
            )}
            <SettingRow label={t('settings.maintenanceMode')} desc={t('settings.maintenanceModeDesc')}>
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={settings.maintenance_mode === 'true'} onChange={e => updateSetting('maintenance_mode', e.target.checked ? 'true' : 'false')} />
                  <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-red-600"></div>
                </label>
                <span className={`text-sm font-bold ${settings.maintenance_mode === 'true' ? 'text-red-600' : 'text-green-600'}`}>
                  {settings.maintenance_mode === 'true' ? t('settings.maintenanceOn') : t('settings.maintenanceOff')}
                </span>
              </div>
            </SettingRow>
            {settings.maintenance_mode !== 'true' && (
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                <Icons.AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">{t('settings.maintenanceWarning')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SystemSettingsPage;