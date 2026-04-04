import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatDateSys, formatNumber } from '../utils/format';
import { Modal } from '../components/Modal';
import { Button } from '../components/FormElements';
import { DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';

function RMUActivityHistoryPage() {
  const { t } = useTranslation();
  const { selectedOrg } = useApp();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewItem, setViewItem] = useState(null);
  const [viewDetails, setViewDetails] = useState([]);

  useEffect(() => { if (selectedOrg) loadData(); }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    const { data } = await supabase.from('rmu_activity_history')
      .select('*, rooms(room_number, floor)')
      .eq('organization_id', selectedOrg.id)
      .order('created_at', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }

  async function viewRecord(rec) {
    setViewItem(rec);
    const { data } = await supabase.from('rmu_activity_history_items')
      .select('*').eq('history_id', rec.id).order('sort_order');
    setViewDetails(data || []);
  }

  const filtered = records.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.history_number?.toLowerCase().includes(s) || r.rooms?.room_number?.toLowerCase().includes(s);
  });

  return (
    <div>
      <PageHeader title="Activity Checklist History" subtitle={`History - ${selectedOrg?.name || ''}`} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="hidden sm:block">
          <DataTable loading={loading} columns={[
            { header: 'Number', render: r => <button onClick={() => viewRecord(r)} className="font-mono text-xs font-semibold text-purple-700 hover:underline cursor-pointer">{r.history_number}</button> },
            { header: 'Date', render: r => formatDateSys(r.history_date) },
            { header: 'Room', render: r => r.rooms?.room_number || '-' },
          ]} data={filtered} />
        </div>
        <div className="sm:hidden divide-y divide-gray-100">
          {loading ? <PageLoader /> :
           filtered.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">No data</div> :
           filtered.map(r => (
            <div key={r.id} className="p-4 cursor-pointer hover:bg-gray-50" onClick={() => viewRecord(r)}>
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-purple-700 text-sm">{r.history_number}</span>
                <span className="text-xs text-gray-500">{formatDateSys(r.history_date)}</span>
              </div>
              <span className="text-xs text-gray-500">Room: {r.rooms?.room_number || '-'}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?.history_number || ''} size="lg">
        {viewItem && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4 bg-purple-50 rounded-lg p-3 text-sm">
              <div><p className="text-xs text-purple-400">Date</p><p className="font-medium">{formatDateSys(viewItem.history_date)}</p></div>
              <div><p className="text-xs text-purple-400">Room</p><p className="font-medium">{viewItem.rooms?.room_number}</p></div>
            </div>
            <h4 className="text-sm font-semibold mb-2">Activity Checklist</h4>
            <div className="space-y-2">
              {viewDetails.map(d => (
                <div key={d.id} className={`p-3 rounded-lg border ${d.is_done ? 'border-green-200 bg-green-50/30' : 'border-red-200 bg-red-50/30'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 ${
                      d.is_done ? 'bg-green-500 border-green-500 text-white' : 'bg-red-50 border-red-300 text-red-500'
                    }`}>
                      <span className="text-xs font-bold">{d.is_done ? '✓' : '✕'}</span>
                    </div>
                    <span className={`text-sm font-medium ${d.is_done ? 'text-green-800' : 'text-red-800'}`}>{d.activity_name}</span>
                  </div>
                  {d.notes && <p className="text-xs text-gray-600 mt-1 ml-8">{d.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end mt-4 pt-4 border-t"><Button variant="secondary" onClick={() => setViewItem(null)}>Close</Button></div>
      </Modal>
    </div>
  );
}

export default RMUActivityHistoryPage;