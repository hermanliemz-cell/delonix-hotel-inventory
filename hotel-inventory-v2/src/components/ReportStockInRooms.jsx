import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { supabase } from '../services/supabase';
import { formatDateSys } from '../utils/format';
import { Icons } from './Icons';
import { PageHeader } from './PageHeader';
import { Button } from './FormElements';

export function ReportStockInRooms({ onBack }) {
  const { selectedOrg } = useApp();
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [categories, setCategories] = useState([]);
  const [filterLinenCat, setFilterLinenCat] = useState('');
  const [rooms, setRooms] = useState([]);
  const [data, setData] = useState([]);
  const [expandedFloors, setExpandedFloors] = useState({});
  const [expandedCats, setExpandedCats] = useState({});
  const [filterActive, setFilterActive] = useState('active');
  const [linenCatIds, setLinenCatIds] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [filterRoomType, setFilterRoomType] = useState('');

  // Load categories & determine linen category IDs
  useEffect(() => {
    if (selectedOrg) {
      supabase.from('item_categories').select('id, code, name, parent_id').order('code')
        .then(({ data: cats }) => {
          setCategories(cats || []);
          // Find LIN parent and all its children
          const linParent = (cats || []).find(c => c.code === 'LIN' && !c.parent_id);
          if (linParent) {
            const linIds = [linParent.id, ...(cats || []).filter(c => c.parent_id === linParent.id).map(c => c.id)];
            setLinenCatIds(linIds);
          }
        });
    }
  }, [selectedOrg]);

  // Load room types
  useEffect(() => {
    if (selectedOrg) {
      supabase.from('rooms').select('room_type_id, room_types(id, name)')
        .eq('organization_id', selectedOrg.id).eq('is_active', true)
        .then(({ data: roomData }) => {
          const seen = {};
          const types = [];
          (roomData || []).forEach(r => {
            if (r.room_types && !seen[r.room_types.id]) {
              seen[r.room_types.id] = true;
              types.push(r.room_types);
            }
          });
          types.sort((a, b) => a.name.localeCompare(b.name));
          setRoomTypes(types);
        });
    }
  }, [selectedOrg]);

  // Compute level-2 linen categories (children of LIN parent)
  const linenLevel2Cats = React.useMemo(() => {
    const linParent = categories.find(c => c.code === 'LIN' && !c.parent_id);
    if (!linParent) return [];
    return categories.filter(c => c.parent_id === linParent.id).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [categories]);

  async function generateReport() {
    if (!selectedOrg || linenCatIds.length === 0) return;
    setLoading(true);
    try {
      // 1. Get all active rooms with warehouse_id
      let roomQ = supabase.from('rooms')
        .select('id, room_number, floor, warehouse_id, room_type_id, room_types(name)')
        .eq('organization_id', selectedOrg.id)
        .eq('is_active', true)
        .not('warehouse_id', 'is', null);
      if (filterRoomType) roomQ = roomQ.eq('room_type_id', filterRoomType);
      const { data: roomList } = await roomQ.order('room_number');
      setRooms(roomList || []);

      // 2. Get linen items only (filtered by level-2 category if selected)
      const activeCatIds = filterLinenCat ? [filterLinenCat] : linenCatIds;
      let itemQ = supabase.from('items')
        .select('id, code, name, brand, category_id, is_active, item_categories(id, code, name, parent_id)')
        .eq('organization_id', selectedOrg.id)
        .in('category_id', activeCatIds)
        .order('code');
      if (filterActive === 'active') itemQ = itemQ.eq('is_active', true);
      else if (filterActive === 'inactive') itemQ = itemQ.eq('is_active', false);
      const { data: allItems } = await itemQ;

      // 3. Get stock balances for room warehouses (only qty > 0)
      //    Paginate to bypass Supabase 1000-row default limit (critical for DCI
      //    which can have 1000+ room stock rows across many rooms & linen items).
      const whIds = (roomList || []).map(r => r.warehouse_id).filter(Boolean);
      let balances = [];
      if (whIds.length > 0) {
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data: batch } = await supabase.from('stock_balance')
            .select('item_id, warehouse_id, quantity')
            .eq('organization_id', selectedOrg.id)
            .in('warehouse_id', whIds)
            .gt('quantity', 0)
            .range(from, from + pageSize - 1);
          if (!batch || batch.length === 0) break;
          balances = balances.concat(batch);
          if (batch.length < pageSize) break;
          from += pageSize;
        }
      }

      // 4. Build balance lookup
      const balMap = {};
      for (const b of balances) {
        if (!balMap[b.item_id]) balMap[b.item_id] = {};
        balMap[b.item_id][b.warehouse_id] = (balMap[b.item_id][b.warehouse_id] || 0) + (parseFloat(b.quantity) || 0);
      }

      // 6. Build result
      const result = (allItems || []).map(item => {
        const roomQty = balMap[item.id] || {};
        const total = Object.values(roomQty).reduce((s, q) => s + q, 0);
        return { item, roomQty, total };
      });

      setData(result);

      // Auto-expand all floors
      const floors = {};
      (roomList || []).forEach(r => { if (r.floor) floors[r.floor] = true; });
      setExpandedFloors(floors);

      // Auto-expand all category groups
      const catGroups = {};
      result.forEach(r => {
        const catId = r.item?.category_id;
        if (catId) catGroups[catId] = true;
      });
      setExpandedCats(catGroups);
    } catch (err) { }
    setLoading(false);
  }

  // Group rooms by floor
  const floorMap = {};
  rooms.forEach(r => {
    const fl = r.floor || '?';
    if (!floorMap[fl]) floorMap[fl] = [];
    floorMap[fl].push(r);
  });
  const sortedFloors = Object.keys(floorMap).sort((a, b) => parseInt(a) - parseInt(b));

  function toggleFloor(fl) {
    setExpandedFloors(prev => ({ ...prev, [fl]: !prev[fl] }));
  }

  // Group data by level-2 category (child category)
  const groupedData = React.useMemo(() => {
    const groups = {};
    data.forEach(row => {
      const cat = row.item?.item_categories;
      const catId = cat?.id || 'uncategorized';
      const catName = cat?.name || 'Uncategorized';
      const catCode = cat?.code || '';
      const parentId = cat?.parent_id || null;
      if (!groups[catId]) {
        groups[catId] = { catId, catName, catCode, parentId, items: [] };
      }
      groups[catId].items.push(row);
    });
    return Object.values(groups).sort((a, b) => (a.catCode || '').localeCompare(b.catCode || ''));
  }, [data]);

  const totalItems = data.length;

  return (
    <div>
      <PageHeader
        title="Linen Stock in Room"
        subtitle={`Laporan stok linen di kamar - ${selectedOrg?.name || ''}`}
        actions={<Button variant="secondary" onClick={onBack}><Icons.ArrowLeft /> Kembali</Button>}
      />

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-gray-500 mb-1 block">As of Date</label>
            <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>

          {/* Category Linen Level 2 Filter */}
          <div className="min-w-[220px]">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Kategori Linen</label>
            <select value={filterLinenCat} onChange={e => setFilterLinenCat(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">Semua Kategori Linen</option>
              {linenLevel2Cats.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.code} - {cat.name}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Room Type</label>
            <select value={filterRoomType} onChange={e => setFilterRoomType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">Semua Room Type</option>
              {roomTypes.map(rt => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
          </div>

          <div className="min-w-[140px]">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Status Item</label>
            <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="active">Active</option>
              <option value="inactive">Non-Active</option>
              <option value="all">Semua</option>
            </select>
          </div>

          <Button onClick={generateReport}><Icons.BarChart /> Generate</Button>
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Linen Stock in Room {asOfDate ? `(per ${formatDateSys(asOfDate)})` : ''}</h3>
          {totalItems > 0 && <span className="text-xs text-gray-400">{totalItems} item linen</span>}
        </div>

        {loading ? (
          <div className="p-8 flex justify-center"><div className="spinner"></div></div>
        ) : data.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Icons.Package />
            <p className="mt-2">Klik "Generate" untuk menampilkan laporan linen di kamar.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{lineHeight:'1.2',tableLayout:'fixed'}}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-1.5 py-1 text-left text-xs font-semibold text-gray-600 uppercase sticky left-0 bg-gray-50 z-10" style={{width:'80px',minWidth:'80px',maxWidth:'80px'}}>Kode</th>
                  <th className="px-1.5 py-1 text-left text-xs font-semibold text-gray-600 uppercase sticky bg-gray-50 z-10" style={{width:'300px',minWidth:'300px',maxWidth:'300px',left:'80px'}}>Nama Item</th>
                  <th className="px-1 py-1 text-center text-xs font-bold text-blue-700 uppercase bg-blue-50 cursor-pointer hover:bg-blue-100 select-none" style={{width:'50px',minWidth:'50px'}}
                    onClick={() => {
                      const allExpanded = sortedFloors.every(fl => expandedFloors[fl]);
                      const newState = {};
                      sortedFloors.forEach(fl => { newState[fl] = !allExpanded; });
                      setExpandedFloors(newState);
                    }}
                    title={sortedFloors.every(fl => expandedFloors[fl]) ? 'Collapse all floors' : 'Expand all floors'}
                  >
                    <span className="inline-flex items-center gap-1">
                      {sortedFloors.every(fl => expandedFloors[fl]) ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                      Total
                    </span>
                  </th>
                  {sortedFloors.map(fl => (
                    <React.Fragment key={'fh-'+fl}>
                      <th
                        className="px-1 py-1 text-center text-xs font-bold text-white uppercase bg-green-600 cursor-pointer hover:bg-green-700 select-none" style={{width:'45px',minWidth:'45px'}}
                        onClick={() => toggleFloor(fl)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {expandedFloors[fl] ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                          {fl}F
                        </span>
                      </th>
                      {expandedFloors[fl] && floorMap[fl].map(room => (
                        <th key={'rh-'+room.id} className="px-0.5 py-1 text-center text-xs font-medium text-gray-500 bg-gray-50 whitespace-nowrap" style={{width:'42px',minWidth:'42px'}}>
                          {room.room_number}
                        </th>
                      ))}
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedData.map(group => {
                  return (
                    <React.Fragment key={'cg-'+group.catId}>
                      {group.items.map((row, idx) => (
                        <tr key={row.item?.id || idx} className="hover:bg-gray-50 border-b border-gray-50">
                          <td className="px-1.5 py-0.5 sticky left-0 bg-white z-10" style={{width:'80px',minWidth:'80px',maxWidth:'80px'}}>
                            <span className="font-mono text-xs bg-gray-100 px-1 rounded">{row.item?.code}</span>
                          </td>
                          <td className="px-1.5 py-0.5 sticky bg-white z-10" style={{width:'300px',minWidth:'300px',maxWidth:'300px',left:'80px'}}>
                            <div className="font-medium text-gray-800 text-xs leading-tight truncate" title={row.item?.name}>{row.item?.name}</div>
                          </td>
                          <td className="px-1 py-0.5 text-center bg-blue-50/40">
                            <span className="font-bold text-blue-700 text-xs">{row.total}</span>
                          </td>
                          {sortedFloors.map(fl => {
                            const floorRooms = floorMap[fl];
                            const floorTotal = floorRooms.reduce((s, r) => s + (row.roomQty[r.warehouse_id] || 0), 0);
                            return (
                              <React.Fragment key={'fd-'+fl+'-'+row.item?.id}>
                                <td className="px-1 py-0.5 text-center bg-green-50/60">
                                  <span className={`text-xs font-semibold ${floorTotal > 0 ? 'text-green-800' : 'text-gray-300'}`}>{floorTotal || '-'}</span>
                                </td>
                                {expandedFloors[fl] && floorRooms.map(room => {
                                  const qty = row.roomQty[room.warehouse_id] || 0;
                                  return (
                                    <td key={'rd-'+room.id} className="px-0.5 py-0.5 text-center">
                                      <span className={`text-xs ${qty > 0 ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>{qty || '-'}</span>
                                    </td>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                  <td colSpan={2} className="px-1.5 py-1 text-xs text-gray-700 uppercase sticky left-0 bg-gray-100 z-10">Grand Total</td>
                  <td className="px-1 py-1 text-center text-blue-700 bg-blue-100 text-xs">{data.reduce((s, r) => s + r.total, 0)}</td>
                  {sortedFloors.map(fl => {
                    const floorRooms = floorMap[fl];
                    const floorGrandTotal = data.reduce((s, row) => s + floorRooms.reduce((s2, r) => s2 + (row.roomQty[r.warehouse_id] || 0), 0), 0);
                    return (
                      <React.Fragment key={'ft-'+fl}>
                        <td className="px-1 py-1 text-center bg-green-100 text-green-800 text-xs">{floorGrandTotal || '-'}</td>
                        {expandedFloors[fl] && floorRooms.map(room => {
                          const roomTotal = data.reduce((s, row) => s + (row.roomQty[room.warehouse_id] || 0), 0);
                          return <td key={'rt-'+room.id} className="px-0.5 py-1 text-center text-xs bg-gray-50">{roomTotal || '-'}</td>;
                        })}
                      </React.Fragment>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
