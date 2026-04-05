import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { getLocalDateString } from '../utils/format';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { PageLoader } from '../components/PageLoader';
import { Button, Select } from '../components/FormElements';

export default function WorksheetPage() {
  const { t } = useTranslation();
  const { selectedOrg, showNotification } = useApp();

  const [filterDate, setFilterDate] = useState(getLocalDateString());
  const [housekeepers, setHousekeepers] = useState([]);
  const [filterHousekeeper, setFilterHousekeeper] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHK, setLoadingHK] = useState(false);

  // Worksheet data
  const [worksheetData, setWorksheetData] = useState(null);
  const tableRef = useRef(null);

  // ==================== LOAD HOUSEKEEPERS FOR SELECTED DATE ====================
  useEffect(() => {
    if (!selectedOrg || !filterDate) return;
    loadHousekeepers();
  }, [selectedOrg, filterDate]);

  async function loadHousekeepers() {
    setLoadingHK(true);
    setFilterHousekeeper('');
    setWorksheetData(null);
    try {
      const { data: makeups } = await supabase.from('room_makeups')
        .select('created_by, users:created_by(id, full_name, username)')
        .eq('organization_id', selectedOrg.id)
        .eq('makeup_date', filterDate)
        .not('created_by', 'is', null);

      // Unique housekeepers
      const map = {};
      (makeups || []).forEach(m => {
        if (m.created_by && m.users && !map[m.created_by]) {
          map[m.created_by] = { id: m.created_by, name: m.users.full_name || m.users.username || '-' };
        }
      });
      const list = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
      setHousekeepers(list);
      if (list.length === 1) setFilterHousekeeper(list[0].id);
    } catch (err) {
      showNotification('Error loading housekeepers: ' + err.message, 'error');
    }
    setLoadingHK(false);
  }

  // ==================== LOAD WORKSHEET DATA ====================
  useEffect(() => {
    if (!selectedOrg || !filterDate || !filterHousekeeper) {
      setWorksheetData(null);
      return;
    }
    loadWorksheet();
  }, [selectedOrg, filterDate, filterHousekeeper]);

  async function loadWorksheet() {
    setLoading(true);
    try {
      // 1. Get all makeups for this date + housekeeper
      const { data: makeups, error: muErr } = await supabase.from('room_makeups')
        .select('id, makeup_number, room_id, rooms!left(room_number, floor)')
        .eq('organization_id', selectedOrg.id)
        .eq('makeup_date', filterDate)
        .eq('created_by', filterHousekeeper)
        .order('created_at', { ascending: true });
      if (muErr) throw muErr;
      if (!makeups || makeups.length === 0) {
        setWorksheetData({ rooms: [], linenItems: [], amenityItems: [], activities: [], dataMap: {} });
        setLoading(false);
        return;
      }

      const makeupIds = makeups.map(m => m.id);

      // 2. Get rooms sorted by room_number
      const rooms = makeups.map(m => ({
        makeupId: m.id,
        makeupNumber: m.makeup_number,
        roomNumber: m.rooms?.room_number || '-',
        roomId: m.room_id,
      })).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));

      // 3. Get all makeup items
      const { data: muItems } = await supabase.from('room_makeup_items')
        .select('*, items(id, code, name, brand, category_id, item_categories(id, code, name, parent_id), units:unit_id(abbreviation))')
        .in('makeup_id', makeupIds);

      // 4. Get all consumption items
      const { data: consumptions } = await supabase.from('room_consumption')
        .select('id, makeup_id, room_consumption_items(item_id, quantity, items:item_id(id, code, name, brand, category_id, item_categories:category_id(id, code, name, parent_id), units:unit_id(abbreviation)))')
        .in('makeup_id', makeupIds);

      // 5. Get all activity history items
      const { data: histories } = await supabase.from('rmu_activity_history')
        .select('id, makeup_id, rmu_activity_history_items(activity_name, is_done, sort_order)')
        .in('makeup_id', makeupIds);

      // ==================== BUILD WORKSHEET STRUCTURE ====================

      // -- Linen items (type: replace, move_to_dirty, damage, lost, to_hk_store) --
      const linenItemMap = {};
      (muItems || []).forEach(mi => {
        if (!mi.items) return;
        const key = mi.item_id;
        if (!linenItemMap[key]) {
          const cat = mi.items.item_categories;
          linenItemMap[key] = {
            id: key,
            name: mi.items.name,
            code: mi.items.code,
            brand: mi.items.brand,
            unit: mi.items.units?.abbreviation || '',
            categoryName: cat?.name || '',
            categoryCode: cat?.code || '',
            parentId: cat?.parent_id || null,
          };
        }
      });
      const linenItems = Object.values(linenItemMap).sort((a, b) => a.name.localeCompare(b.name));

      // -- Amenity items (from consumption) --
      const amenityItemMap = {};
      (consumptions || []).forEach(con => {
        (con.room_consumption_items || []).forEach(ci => {
          if (!ci.items) return;
          const key = ci.item_id;
          if (!amenityItemMap[key]) {
            const cat = ci.items.item_categories;
            amenityItemMap[key] = {
              id: key,
              name: ci.items.name,
              code: ci.items.code,
              brand: ci.items.brand,
              unit: ci.items.units?.abbreviation || '',
              categoryName: cat?.name || '',
            };
          }
        });
      });
      const amenityItems = Object.values(amenityItemMap).sort((a, b) => a.name.localeCompare(b.name));

      // -- Activity items --
      const activityMap = {};
      (histories || []).forEach(h => {
        (h.rmu_activity_history_items || []).forEach(ai => {
          if (!activityMap[ai.activity_name]) {
            activityMap[ai.activity_name] = { name: ai.activity_name, sortOrder: ai.sort_order };
          }
        });
      });
      const activities = Object.values(activityMap).sort((a, b) => a.sortOrder - b.sortOrder);

      // ==================== BUILD DATA MAP ====================
      // dataMap[makeupId] = { linen: { itemId: { ori, dir, dmg, lost, rep } }, amenity: { itemId: qty }, activity: { actName: bool } }
      const dataMap = {};
      makeupIds.forEach(mid => {
        dataMap[mid] = { linen: {}, amenity: {}, activity: {} };
      });

      // Linen data
      (muItems || []).forEach(mi => {
        const d = dataMap[mi.makeup_id];
        if (!d) return;
        if (!d.linen[mi.item_id]) d.linen[mi.item_id] = { ori: 0, dir: 0, dmg: 0, lost: 0, rep: 0 };
        const entry = d.linen[mi.item_id];
        // default_qty = original qty in room (same across types for same item in same makeup)
        if (mi.default_qty && mi.default_qty > entry.ori) entry.ori = parseFloat(mi.default_qty) || 0;
        switch (mi.type) {
          case 'move_to_dirty': entry.dir += parseFloat(mi.actual_qty) || 0; break;
          case 'damage': entry.dmg += parseFloat(mi.actual_qty) || 0; break;
          case 'lost': entry.lost += parseFloat(mi.actual_qty) || 0; break;
          case 'replace': entry.rep += parseFloat(mi.actual_qty) || 0; break;
          case 'to_hk_store': break; // not displayed in worksheet
        }
      });

      // Amenity data
      (consumptions || []).forEach(con => {
        const d = dataMap[con.makeup_id];
        if (!d) return;
        (con.room_consumption_items || []).forEach(ci => {
          d.amenity[ci.item_id] = (d.amenity[ci.item_id] || 0) + (parseFloat(ci.quantity) || 0);
        });
      });

      // Activity data
      (histories || []).forEach(h => {
        const d = dataMap[h.makeup_id];
        if (!d) return;
        (h.rmu_activity_history_items || []).forEach(ai => {
          d.activity[ai.activity_name] = ai.is_done;
        });
      });

      setWorksheetData({ rooms, linenItems, amenityItems, activities, dataMap });
    } catch (err) {
      showNotification('Error loading worksheet: ' + err.message, 'error');
    }
    setLoading(false);
  }

  // ==================== RENDER ====================
  const hkName = housekeepers.find(h => h.id === filterHousekeeper)?.name || '';

  return (
    <div>
      <PageHeader title="Worksheet" subtitle="Room Make Up worksheet per housekeeper" />

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Housekeeper</label>
            {loadingHK ? (
              <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>
            ) : (
              <select value={filterHousekeeper} onChange={e => setFilterHousekeeper(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">-- Select Housekeeper --</option>
                {housekeepers.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            )}
          </div>
          {housekeepers.length === 0 && !loadingHK && filterDate && (
            <div className="text-xs text-gray-400 self-center">Tidak ada room make up di tanggal ini.</div>
          )}
        </div>
      </div>

      {/* Worksheet Table */}
      {loading ? <PageLoader /> : worksheetData && filterHousekeeper ? (
        worksheetData.rooms.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400">
            Tidak ada data room make up untuk housekeeper ini di tanggal {filterDate}.
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-800">
                Worksheet — {hkName} — {filterDate}
              </div>
              <div className="text-xs text-gray-400">{worksheetData.rooms.length} room(s)</div>
            </div>
            <div className="overflow-x-auto" ref={tableRef}>
              <WorksheetTable data={worksheetData} />
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

// ==================== WORKSHEET TABLE COMPONENT ====================
function WorksheetTable({ data }) {
  const { rooms, linenItems, amenityItems, activities, dataMap } = data;
  const hasLinen = linenItems.length > 0;
  const hasAmenity = amenityItems.length > 0;
  const hasActivity = activities.length > 0;

  const linenSubCols = ['ORI', 'DIR', 'DMG', 'LOST', 'REP'];
  const amenitySubCols = ['CONS'];

  // Cell value helper
  const getLinenVal = (makeupId, itemId, col) => {
    const d = dataMap[makeupId]?.linen?.[itemId];
    if (!d) return '';
    switch (col) {
      case 'ORI': return d.ori || '';
      case 'DIR': return d.dir || '';
      case 'DMG': return d.dmg || '';
      case 'LOST': return d.lost || '';
      case 'REP': return d.rep || '';
      default: return '';
    }
  };

  const getAmenityVal = (makeupId, itemId) => {
    const val = dataMap[makeupId]?.amenity?.[itemId];
    return val || '';
  };

  const getActivityVal = (makeupId, actName) => {
    return dataMap[makeupId]?.activity?.[actName];
  };

  const colW = 36; // fixed width per sub-column in px
  const firstColW = 320; // widened Item/Activity column
  const totalCols = 1 + rooms.length * linenSubCols.length;

  // Modern flat styling: subtle borders, lighter typography, clean hover.
  // Unified palette with app primary (blue) + soft neutrals.
  const thBase = 'py-2.5 text-[11px] font-semibold text-center whitespace-nowrap';
  const tdBase = 'py-1.5 text-[11px] text-center whitespace-nowrap border-b border-b-gray-100 border-l border-l-gray-100';
  const tdLeft = 'px-3 py-1.5 text-[11px] text-left whitespace-nowrap border-b border-b-gray-100';

  // Sticky segment/sub-segment label helper. The <td> spans all columns and
  // carries the background color so the band fully stretches from the first
  // column to the rightmost room column. An inner sticky div keeps the label
  // pinned to the left during horizontal scroll.
  //
  // Two levels:
  //   level 1 (top-level: Linen & Amenities, Activity Check List) → darker band
  //   level 2 (sub-level: Linen, Guest Amenities) → lighter band
  const StickyBand = ({ children, level = 1 }) => {
    const styles = level === 1
      ? { td: 'bg-gray-200', text: 'text-gray-800 font-bold', border: 'border-gray-300' }
      : { td: 'bg-gray-50', text: 'text-gray-500 font-semibold', border: 'border-gray-200' };
    return (
      <tr>
        <td colSpan={totalCols} className={`p-0 border-y ${styles.border} ${styles.td}`}>
          <div className={`${styles.td} ${styles.text} sticky left-0 px-3 py-2 text-[11px] tracking-wider uppercase`}
            style={{ width: firstColW, minWidth: firstColW }}>
            {children}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <table className="border-collapse text-[11px] bg-white" style={{ tableLayout: 'fixed', width: firstColW + rooms.length * linenSubCols.length * colW }}>
      <colgroup>
        <col style={{ width: firstColW }} />
        {rooms.map(r => linenSubCols.map(col => (
          <col key={`${r.makeupId}-${col}`} style={{ width: colW }} />
        )))}
      </colgroup>
      <thead>
        {/* Row 1: Room Numbers */}
        <tr>
          <th className={`${thBase} sticky left-0 z-20 bg-gray-100 text-gray-700 text-left px-3 border-b border-b-gray-400 border-r border-r-gray-400`} rowSpan={2}>
            Item / Activity
          </th>
          {rooms.map(r => (
            <th key={r.makeupId} className={`${thBase} bg-gray-100 text-gray-700 border-b border-b-gray-400 border-l border-l-gray-400`}
              colSpan={linenSubCols.length}>
              {r.roomNumber}
            </th>
          ))}
        </tr>
        {/* Row 2: Sub-columns (ORI|DIR|DMG|LOST|REP repeated per room) */}
        <tr>
          {rooms.map(r => (
            linenSubCols.map((col, idx) => (
              <th key={`${r.makeupId}-${col}`}
                className={`py-1.5 text-[9px] font-semibold tracking-wider text-center whitespace-nowrap bg-gray-50 text-gray-500 border-b border-b-gray-400 border-l ${idx === 0 ? 'border-l-gray-400' : 'border-l-gray-200'}`}>
                {col}
              </th>
            ))
          ))}
        </tr>
      </thead>
      <tbody>
        {/* ==================== SEGMENT 1: LINEN & AMENITIES ==================== */}
        {(hasLinen || hasAmenity) && (
          <StickyBand level={1}>Linen &amp; Amenities</StickyBand>
        )}

        {/* Sub-segment: Linen */}
        {hasLinen && (
          <>
            <StickyBand level={2}>Linen</StickyBand>
            {linenItems.map(item => (
              <tr key={item.id} className="hover:bg-amber-50/60 transition-colors">
                <td className={`${tdLeft} sticky left-0 bg-white z-[5] font-medium text-gray-800 truncate border-r border-r-gray-400`}>
                  {item.name}
                </td>
                {rooms.map(r => (
                  linenSubCols.map((col, idx) => {
                    const val = getLinenVal(r.makeupId, item.id, col);
                    let cellClass = tdBase + (idx === 0 ? ' !border-l-gray-400' : '');
                    if (col === 'DMG' && val) cellClass += ' bg-orange-50 text-orange-700 font-semibold';
                    else if (col === 'LOST' && val) cellClass += ' bg-red-50 text-red-700 font-semibold';
                    else if (col === 'REP' && val) cellClass += ' bg-emerald-50 text-emerald-700 font-semibold';
                    else if (col === 'DIR' && val) cellClass += ' bg-sky-50 text-sky-700';
                    else cellClass += ' text-gray-700';
                    return (
                      <td key={`${r.makeupId}-${item.id}-${col}`} className={cellClass}>
                        {val || ''}
                      </td>
                    );
                  })
                ))}
              </tr>
            ))}
          </>
        )}

        {/* Sub-segment: Guest Amenities */}
        {hasAmenity && (
          <>
            <StickyBand level={2}>Guest Amenities</StickyBand>
            {amenityItems.map(item => (
              <tr key={item.id} className="hover:bg-amber-50/60 transition-colors">
                <td className={`${tdLeft} sticky left-0 bg-white z-[5] font-medium text-gray-800 truncate border-r border-r-gray-400`}>
                  {item.name}
                </td>
                {rooms.map(r => {
                  const val = getAmenityVal(r.makeupId, item.id);
                  return (
                    <td key={`${r.makeupId}-${item.id}-cons`}
                      className={`${tdBase} !border-l-gray-400 ${val ? 'bg-violet-50 text-violet-700 font-semibold' : 'text-gray-700'}`}
                      colSpan={linenSubCols.length}>
                      {val || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </>
        )}

        {/* ==================== SEGMENT 2: ACTIVITY CHECK LIST ==================== */}
        {hasActivity && (
          <>
            <StickyBand level={1}>Activity Check List</StickyBand>
            {activities.map(act => (
              <tr key={act.name} className="hover:bg-amber-50/60 transition-colors">
                <td className={`${tdLeft} sticky left-0 bg-white z-[5] font-medium text-gray-800 truncate border-r border-r-gray-400`}>
                  {act.name}
                </td>
                {rooms.map(r => {
                  const isDone = getActivityVal(r.makeupId, act.name);
                  return (
                    <td key={`${r.makeupId}-${act.name}`}
                      className={`${tdBase} !border-l-gray-400 ${isDone === true ? 'bg-emerald-50' : isDone === false ? 'bg-red-50' : ''}`}
                      colSpan={linenSubCols.length}>
                      {isDone === true ? (
                        <span className="text-emerald-600 font-bold">&#10003;</span>
                      ) : isDone === false ? (
                        <span className="text-red-400">&#10007;</span>
                      ) : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </>
        )}

        {/* Empty state */}
        {!hasLinen && !hasAmenity && !hasActivity && (
          <tr>
            <td className="text-[11px] text-gray-400 py-8 text-center" colSpan={totalCols}>
              Tidak ada data item atau activity.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
