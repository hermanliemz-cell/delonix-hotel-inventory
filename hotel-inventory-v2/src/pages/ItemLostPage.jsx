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

function ItemLostPage() {
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
    const { data } = await supabase.from('item_lost_in_room')
      .select('*, rooms(room_number, floor)')
      .eq('organization_id', selectedOrg.id)
      .order('created_at', { ascending: false });
    setRecords(data || []);
    setLoading(false);
  }

  async function viewRecord(rec) {
    setViewItem(rec);
    const { data } = await supabase.from('item_lost_in_room_details')
      .select('*, items(code, name, brand, units:unit_id(abbreviation))')
      .eq('lost_id', rec.id);
    setViewDetails(data || []);
  }

  const filtered = records.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.lost_number?.toLowerCase().includes(s) || r.rooms?.room_number?.toLowerCase().includes(s);
  });

  return (
    <div>
      <PageHeader title="Item Lost in Room" subtitle={`History - ${selectedOrg?.name || ''}`} />
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100">
          <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="hidden sm:block">
          <DataTable loading={loading} columns={[
            { header: 'Number', render: r => <button onClick={() => viewRecord(r)} className="font-mono text-xs font-semibold text-red-700 hover:underline cursor-pointer">{r.lost_number}</button> },
            { header: 'Date', render: r => formatDateSys(r.lost_date) },
            { header: 'Room', render: r => r.rooms?.room_number || '-' },
            { header: 'Notes', render: r => <span className="text-xs text-gray-500 truncate max-w-[200px] block">{r.notes || '-'}</span> },
          ]} data={filtered} />
        </div>
        <div className="sm:hidden divide-y divide-gray-100">
          {loading ? <PageLoader /> :
           filtered.length === 0 ? <div className="p-6 text-center text-gray-400 text-sm">No data</div> :
           filtered.map(r => (
            <div key={r.id} className="p-4 cursor-pointer hover:bg-gray-50" onClick={() => viewRecord(r)}>
              <div className="flex justify-between mb-1">
                <span className="font-semibold text-red-700 text-sm">{r.lost_number}</span>
                <span className="text-xs text-gray-500">{formatDateSys(r.lost_date)}</span>
              </div>
              <span className="text-xs text-gray-500">Room: {r.rooms?.room_number || '-'}</span>
            </div>
          ))}
        </div>
      </div>

      <Modal open={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?.lost_number || ''} size="lg">
        {viewItem && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-4 bg-red-50 rounded-lg p-3 text-sm">
              <div><p className="text-xs text-red-400">Date</p><p className="font-medium">{formatDateSys(viewItem.lost_date)}</p></div>
              <div><p className="text-xs text-red-400">Room</p><p className="font-medium">{viewItem.rooms?.room_number}</p></div>
            </div>
            {viewItem.notes && <p className="text-sm mb-3 text-gray-600">{viewItem.notes}</p>}
            <h4 className="text-sm font-semibold mb-2">Lost Items</h4>
            <div className="border border-red-200 rounded-lg divide-y">
              {viewDetails.map(d => (
                <div key={d.id} className="p-3 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm">{d.items?.name}</p>
                    <p className="text-xs text-gray-400">{d.items?.code}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-red-700">{formatNumber(d.quantity)} {d.items?.units?.abbreviation || ''}</p>
                    {d.total_cost > 0 && <p className="text-xs text-gray-400">Loss: {formatNumber(d.total_cost)}</p>}
                  </div>
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

export default ItemLostPage;