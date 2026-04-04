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
  const [filterItemIds, setFilterItemIds] = useState([]);
  const [allItemsList, setAllItemsList] = useState([]);
  const [itemDropOpen, setItemDropOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [expandedItemCats, setExpandedItemCats] = useState({});
  const [rooms, setRooms] = useState([]);
  const [data, setData] = useState([]);
  const [expandedFloors, setExpandedFloors] = useState({});
  const [expandedCats, setExpandedCats] = useState({});
  const [filterActive, setFilterActive] = useState('active');
  const [linenCatIds, setLinenCatIds] = useState([]);

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

  // Load linen items for item filter dropdown
  React.useEffect(() => {
    if (selectedOrg && linenCatIds.length > 0) {
      let q = supabase.from('items')
        .select('id, code, name, category_id, is_active, item_categories(id, code, name, parent_id)')
        .eq('organization_id', selectedOrg.id)
        .in('category_id', linenCatIds)
        .order('code');
      if (filterActive === 'active') q = q.eq('is_active', true);
      else if (filterActive === 'inactive') q = q.eq('is_active', false);
      q.then(({ data: items }) => setAllItemsList(items || []));
    }
  }, [selectedOrg, filterActive, linenCatIds]);

  // Item filter dropdown ref
  const itemDropRef = React.useRef(null);
  React.useEffect(() => {
    const handler = (e) => { if (itemDropRef.current && !itemDropRef.current.contains(e.target)) setItemDropOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Build TreeSelect data: group items by child category
  const itemTreeData = React.useMemo(() => {
    const tree = [];
    const parentMap = {};
    allItemsList.forEach(item => {
      const cat = item.item_categories;
      const parentId = cat?.parent_id || cat?.id || 'uncategorized';
      const childId = cat?.parent_id ? cat.id : null;
      if (!parentMap[parentId]) {
        const pCat = categories.find(c => c.id === parentId);
        parentMap[parentId] = { id: parentId, code: pCat?.code || '', name: pCat?.name || 'Uncategorized', children: {} };
      }
      const pNode = parentMap[parentId];
      if (childId) {
        if (!pNode.children[childId]) {
          pNode.children[childId] = { id: childId, code: cat.code, name: cat.name, items: [] };
        }
        pNode.children[childId].items.push(item);
      } else {
        if (!pNode.children['_direct']) {
          pNode.children['_direct'] = { id: '_direct', code: '', name: '', items: [] };
        }
        pNode.children['_direct'].items.push(item);
      }
    });
    Object.values(parentMap).sort((a, b) => (a.code || '').localeCompare(b.code || '')).forEach(p => {
      tree.push(p);
    });
    return tree;
  }, [allItemsList, categories]);

  // Filtered items for search
  const filteredItemTree = React.useMemo(() => {
    if (!itemSearch.trim()) return itemTreeData;
    const q = itemSearch.toLowerCase();
    return itemTreeData.map(parent => {
      const newChildren = {};
      Object.entries(parent.children).forEach(([key, child]) => {
        const matchItems = child.items.filter(i => i.code.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
        if (matchItems.length > 0) newChildren[key] = { ...child, items: matchItems };
      });
      if (Object.keys(newChildren).length > 0) return { ...parent, children: newChildren };
      return null;
    }).filter(Boolean);
  }, [itemTreeData, itemSearch]);

  function toggleFilterItem(itemId) {
    setFilterItemIds(prev => prev.includes(itemId) ? prev.filter(i => i !== itemId) : [...prev, itemId]);
  }

  function toggleAllItemsInCat(catItems) {
    const ids = catItems.map(i => i.id);
    const allSelected = ids.every(id => filterItemIds.includes(id));
    if (allSelected) {
      setFilterItemIds(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setFilterItemIds(prev => [...new Set([...prev, ...ids])]);
    }
  }

  async function generateReport() {
    if (!selectedOrg || linenCatIds.length === 0) return;
    setLoading(true);
    try {
      // 1. Get all active rooms with warehouse_id
      const { data: roomList } = await supabase.from('rooms')
        .select('id, room_number, floor, warehouse_id, room_types(name)')
        .eq('organization_id', selectedOrg.id)
        .eq('is_active', true)
        .not('warehouse_id', 'is', null)
        .order('room_number');
      setRooms(roomList || []);

      // 2. Get linen items only
      let itemQ = supabase.from('items')
        .select('id, code, name, brand, category_id, is_active, item_categories(id, code, name, parent_id)')
        .eq('organization_id', selectedOrg.id)
        .in('category_id', linenCatIds)
        .order('code');
      if (filterActive === 'active') itemQ = itemQ.eq('is_active', true);
      else if (filterActive === 'inactive') itemQ = itemQ.eq('is_active', false);
      if (filterItemIds.length > 0) {
        itemQ = itemQ.in('id', filterItemIds);
      }
      const { data: allItems } = await itemQ;

      // 3. Get stock balances for room warehouses (only qty > 0)
      const whIds = (roomList || []).map(r => r.warehouse_id).filter(Boolean);
      let balances = [];
      if (whIds.length > 0) {
        const { data: bal } = await supabase.from('stock_balance')
          .select('item_id, warehouse_id, quantity')
          .eq('organization_id', selectedOrg.id)
          .in('warehouse_id', whIds)
          .gt('quantity', 0);
        balances = bal || [];
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

          {/* Item Filter TreeSelect (linen items only) */}
          <div className="min-w-[300px] relative" ref={itemDropRef}>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Item Linen</label>
            <button type="button" onClick={() => { setItemDropOpen(!itemDropOpen); setItemSearch(''); }}
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:border-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent">
              <span className={filterItemIds.length > 0 ? 'text-gray-800 truncate' : 'text-gray-400'}>
                {filterItemIds.length === 0 ? 'Semua Item Linen' : filterItemIds.length <= 2
                  ? allItemsList.filter(i => filterItemIds.includes(i.id)).map(i => i.name).join(', ')
                  : `${filterItemIds.length} item dipilih`}
              </span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${itemDropOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {itemDropOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden" style={{ minWidth: '350px' }}>
                <div className="p-2 border-b border-gray-100">
                  <input type="text" value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                    placeholder="Cari kode atau nama linen..."
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    autoFocus />
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: '350px' }}>
                  {filteredItemTree.length === 0 && (
                    <div className="px-3 py-4 text-sm text-gray-400 text-center">Tidak ada item ditemukan</div>
                  )}
                  {filteredItemTree.map(parent => {
                    const allParentItems = Object.values(parent.children).flatMap(c => c.items);
                    const allParentSelected = allParentItems.length > 0 && allParentItems.every(i => filterItemIds.includes(i.id));
                    const someParentSelected = allParentItems.some(i => filterItemIds.includes(i.id));
                    const isExpanded = expandedItemCats[parent.id];
                    return (
                      <div key={parent.id}>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 cursor-pointer select-none hover:bg-gray-100"
                          onClick={() => setExpandedItemCats(prev => ({ ...prev, [parent.id]: !prev[parent.id] }))}>
                          <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                          <input type="checkbox" checked={allParentSelected} ref={el => { if (el) el.indeterminate = someParentSelected && !allParentSelected; }}
                            onChange={(e) => { e.stopPropagation(); toggleAllItemsInCat(allParentItems); }}
                            onClick={e => e.stopPropagation()}
                            className="w-3.5 h-3.5 rounded text-primary-600 focus:ring-primary-500 flex-shrink-0" />
                          <span className="font-semibold text-xs text-gray-700 uppercase">{parent.code}</span>
                          <span className="text-xs text-gray-600">{parent.name}</span>
                          <span className="text-xs text-gray-400 ml-auto">({allParentItems.length})</span>
                        </div>
                        {isExpanded && Object.values(parent.children).sort((a, b) => (a.code || '').localeCompare(b.code || '')).map(child => (
                          <div key={child.id}>
                            {child.id !== '_direct' && (
                              <div className="flex items-center gap-2 px-5 py-1 bg-gray-50/50 cursor-pointer select-none hover:bg-gray-50"
                                onClick={() => toggleAllItemsInCat(child.items)}>
                                <input type="checkbox" checked={child.items.every(i => filterItemIds.includes(i.id))}
                                  ref={el => { if (el) el.indeterminate = child.items.some(i => filterItemIds.includes(i.id)) && !child.items.every(i => filterItemIds.includes(i.id)); }}
                                  onChange={() => toggleAllItemsInCat(child.items)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-3.5 h-3.5 rounded text-primary-600 focus:ring-primary-500 flex-shrink-0" />
                                <span className="text-xs font-medium text-gray-600">{child.code} {child.name}</span>
                                <span className="text-xs text-gray-400 ml-auto">({child.items.length})</span>
                              </div>
                            )}
                            {child.items.map(item => (
                              <label key={item.id} className="flex items-center gap-2 px-7 py-1 text-sm cursor-pointer select-none hover:bg-blue-50 transition-colors">
                                <input type="checkbox" checked={filterItemIds.includes(item.id)} onChange={() => toggleFilterItem(item.id)}
                                  className="w-3.5 h-3.5 rounded text-primary-600 focus:ring-primary-500 flex-shrink-0" />
                                <span className="font-mono text-xs text-gray-500">{item.code}</span>
                                <span className={`text-xs ${filterItemIds.includes(item.id) ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>{item.name}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                {filterItemIds.length > 0 && (
                  <div className="p-2 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs text-gray-500">{filterItemIds.length} item dipilih</span>
                    <button onClick={() => setFilterItemIds([])} className="text-xs text-red-500 hover:text-red-700 font-medium">Hapus Semua</button>
                  </div>
                )}
              </div>
            )}
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
