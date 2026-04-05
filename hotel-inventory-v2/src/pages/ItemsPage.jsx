import React, {useState, useEffect, useMemo} from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { formatNumber } from '../utils/format';
import { toIntQty, intQtyInputProps } from '../utils/qtyInput';
import { Icons } from '../components/Icons';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';
import { Button, Input, Select, Badge } from '../components/FormElements';
import { FormField } from '../components/FormField';
import { TreeSelect } from '../components/TreeSelect';
import { PageLoader } from '../components/PageLoader';

function ItemsPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirm, selectedOrg } = useApp();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [form, setForm] = useState({ code: '', name: '', description: '', category_id: '', unit_id: '', purchase_unit_id: '', usage_unit_id: '', conversion_rate: 1, brand: '', size: '', min_stock: 0, max_stock: 0, reorder_point: 0, default_warehouse_id: '', allow_single_usage: false, allow_direct_purchase: false, allow_inuse_warehouse: false, max_inuse_qty: 0, is_active: true });
  const [filterStatus, setFilterStatus] = useState('all');

  // Import from hotel states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importOrgs, setImportOrgs] = useState([]);
  const [importSelectedOrg, setImportSelectedOrg] = useState('');
  const [importCategories, setImportCategories] = useState([]);
  const [importFilterCat, setImportFilterCat] = useState('');
  const [importFilterSubCat, setImportFilterSubCat] = useState('');
  const [importItems, setImportItems] = useState([]);
  const [importChecked, setImportChecked] = useState({});
  const [importLoading, setImportLoading] = useState(false);
  const [importSaving, setImportSaving] = useState(false);

  // Duplicate checker states
  const [showDupModal, setShowDupModal] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupResults, setDupResults] = useState({ exact: [], likely: [] });

  function normalizeStr(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function similarity(a, b) {
    const na = normalizeStr(a);
    const nb = normalizeStr(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    // Simple Levenshtein-based similarity
    const len = Math.max(na.length, nb.length);
    if (len === 0) return 1;
    const matrix = Array.from({ length: na.length + 1 }, (_, i) => {
      const row = Array(nb.length + 1).fill(0);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= nb.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= na.length; i++) {
      for (let j = 1; j <= nb.length; j++) {
        const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
    return 1 - matrix[na.length][nb.length] / len;
  }

  async function checkDuplicates() {
    setDupLoading(true);
    setShowDupModal(true);
    setDupResults({ exact: [], likely: [] });

    try {
      const allItems = items;
      const exactGroups = {};
      const likelyPairs = [];
      const exactKeySet = new Set();

      // Exact duplicates: same name, category, unit, brand, size (case-insensitive, trimmed)
      allItems.forEach(item => {
        const key = [
          (item.name || '').trim().toLowerCase(),
          item.category_id || '',
          item.unit_id || '',
          (item.brand || '').trim().toLowerCase(),
          (item.size || '').trim().toLowerCase(),
        ].join('|');
        if (!exactGroups[key]) exactGroups[key] = [];
        exactGroups[key].push(item);
      });

      const exactDups = Object.values(exactGroups).filter(g => g.length > 1);
      // Track items in exact groups for exclusion from likely
      exactDups.forEach(group => {
        group.forEach(item => exactKeySet.add(item.id));
      });

      // Likely duplicates: similar name (>= 0.8 similarity) + same category
      for (let i = 0; i < allItems.length; i++) {
        if (exactKeySet.has(allItems[i].id)) continue;
        for (let j = i + 1; j < allItems.length; j++) {
          if (exactKeySet.has(allItems[j].id)) continue;
          const a = allItems[i];
          const b = allItems[j];
          // Same category
          if (a.category_id !== b.category_id) continue;
          const sim = similarity(a.name, b.name);
          if (sim >= 0.8 && sim < 1) {
            likelyPairs.push({ items: [a, b], similarity: Math.round(sim * 100) });
          }
        }
      }

      setDupResults({ exact: exactDups, likely: likelyPairs });
    } catch (err) {
      showNotification('Error checking duplicates: ' + err.message, 'error');
    }
    setDupLoading(false);
  }

  async function openImportModal() {
    setShowImportModal(true);
    setImportSelectedOrg('');
    setImportCategories([]);
    setImportFilterCat('');
    setImportFilterSubCat('');
    setImportItems([]);
    setImportChecked({});
    // Load other hotels
    const { data: orgs } = await supabase.from('organizations').select('id, code, name').neq('id', selectedOrg?.id).order('name');
    setImportOrgs(orgs || []);
  }

  async function handleImportOrgChange(orgId) {
    setImportSelectedOrg(orgId);
    setImportFilterCat('');
    setImportFilterSubCat('');
    setImportItems([]);
    setImportChecked({});
    if (!orgId) { setImportCategories([]); return; }
    setImportLoading(true);
    const { data: cats } = await supabase.from('item_categories').select('*').order('name');
    setImportCategories(cats || []);
    setImportLoading(false);
  }

  async function handleImportCatFilter(catId) {
    setImportFilterCat(catId);
    setImportFilterSubCat('');
    setImportItems([]);
    setImportChecked({});
  }

  async function handleImportSubCatFilter(subCatId) {
    setImportFilterSubCat(subCatId);
    setImportChecked({});
    if (!subCatId && !importFilterCat) { setImportItems([]); return; }
    setImportLoading(true);
    let query = supabase.from('items').select('*, item_categories(name), units:units!items_unit_id_fkey(abbreviation)').eq('organization_id', importSelectedOrg).eq('is_active', true);
    if (subCatId) {
      query = query.eq('category_id', subCatId);
    } else if (importFilterCat) {
      // Get all sub-category IDs under this parent + the parent itself
      const subCatIds = importCategories.filter(c => c.parent_id === importFilterCat).map(c => c.id);
      query = query.in('category_id', [importFilterCat, ...subCatIds]);
    }
    const { data } = await query.order('code');
    // Filter out items already existing in current hotel (by code)
    const existingCodes = new Set(items.map(i => i.code));
    const available = (data || []).filter(i => !existingCodes.has(i.code));
    setImportItems(available);
    setImportLoading(false);
  }

  // When parent cat changes, auto-load items
  useEffect(() => {
    if (importFilterCat && !importFilterSubCat) {
      handleImportSubCatFilter('');
    }
  }, [importFilterCat]);

  function toggleImportCheck(itemId) {
    setImportChecked(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  function toggleImportAll() {
    const allChecked = importItems.length > 0 && importItems.every(i => importChecked[i.id]);
    if (allChecked) {
      setImportChecked({});
    } else {
      const newChecked = {};
      importItems.forEach(i => { newChecked[i.id] = true; });
      setImportChecked(newChecked);
    }
  }

  async function handleImportItems() {
    const selectedItems = importItems.filter(i => importChecked[i.id]);
    if (selectedItems.length === 0) return;
    setImportSaving(true);
    try {
      // First ensure categories exist in current hotel
      const catIdsNeeded = [...new Set(selectedItems.map(i => i.category_id).filter(Boolean))];
      const sourceCats = importCategories.filter(c => catIdsNeeded.includes(c.id));
      // Also get parent categories needed
      const parentIdsNeeded = [...new Set(sourceCats.map(c => c.parent_id).filter(Boolean))];
      const parentCats = importCategories.filter(c => parentIdsNeeded.includes(c.id));
      const allCatsToImport = [...parentCats, ...sourceCats];

      // Check which categories already exist in current hotel by code
      const { data: existingCats } = await supabase.from('item_categories').select('id, code');
      const existingCatCodes = new Map((existingCats || []).map(c => [c.code, c.id]));

      // Create missing categories and build mapping (source_id -> new_id)
      const catIdMap = {};
      // First pass: parents
      for (const cat of parentCats) {
        if (existingCatCodes.has(cat.code)) {
          catIdMap[cat.id] = existingCatCodes.get(cat.code);
        } else {
          const { data: newCat } = await supabase.from('item_categories').insert({
            code: cat.code, name: cat.name, description: cat.description,
            parent_id: null, is_active: true
          }).select('id').single();
          if (newCat) { catIdMap[cat.id] = newCat.id; existingCatCodes.set(cat.code, newCat.id); }
        }
      }
      // Second pass: children
      for (const cat of sourceCats) {
        if (existingCatCodes.has(cat.code)) {
          catIdMap[cat.id] = existingCatCodes.get(cat.code);
        } else {
          const newParentId = cat.parent_id ? (catIdMap[cat.parent_id] || null) : null;
          const { data: newCat } = await supabase.from('item_categories').insert({
            code: cat.code, name: cat.name, description: cat.description,
            parent_id: newParentId, is_active: true
          }).select('id').single();
          if (newCat) { catIdMap[cat.id] = newCat.id; existingCatCodes.set(cat.code, newCat.id); }
        }
      }

      // Import items with mapped category IDs
      const itemPayloads = selectedItems.map(item => ({
        code: item.code, name: item.name, description: item.description,
        category_id: catIdMap[item.category_id] || null,
        unit_id: item.unit_id, purchase_unit_id: item.purchase_unit_id,
        usage_unit_id: item.usage_unit_id, conversion_rate: item.conversion_rate,
        brand: item.brand, size: item.size,
        min_stock: item.min_stock, max_stock: item.max_stock, reorder_point: item.reorder_point,
        default_warehouse_id: null, // Don't copy warehouse (different per hotel)
        allow_single_usage: item.allow_single_usage,
        allow_direct_purchase: item.allow_direct_purchase,
        allow_inuse_warehouse: item.allow_inuse_warehouse,
        max_inuse_qty: item.max_inuse_qty || 0,
        is_active: true, organization_id: selectedOrg?.id
      }));
      const { error } = await supabase.from('items').insert(itemPayloads);
      if (error) throw error;
      showNotification(`Successfully imported ${selectedItems.length} items`);
      setShowImportModal(false);
      loadData();
    } catch (err) {
      showNotification('Import error: ' + err.message, 'error');
    }
    setImportSaving(false);
  }

  useEffect(() => { loadData(); }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    const whQuery = selectedOrg
      ? supabase.from('warehouses').select('*').eq('organization_id', selectedOrg.id).eq('is_active', true).order('name')
      : supabase.from('warehouses').select('*').eq('is_active', true).order('name');
    const [itemsRes, catRes, unitRes, whRes] = await Promise.all([
      supabase.from('items').select('*, item_categories(name), units:units!items_unit_id_fkey(abbreviation), purchase_unit:units!items_purchase_unit_id_fkey(abbreviation, name), usage_unit:units!items_usage_unit_id_fkey(abbreviation, name), default_warehouse:warehouses!items_default_warehouse_id_fkey(id, code, name)').eq('organization_id', selectedOrg?.id).order('code'),
      supabase.from('item_categories').select('*').order('name'),
      supabase.from('units').select('*').order('name'),
      whQuery,
    ]);
    setItems(itemsRes.data || []);
    // Deduplicate categories by name (safety measure)
    const uniqueCats = [];
    const seenNames = new Set();
    (catRes.data || []).forEach(c => {
      if (!seenNames.has(c.name)) { seenNames.add(c.name); uniqueCats.push(c); }
    });
    setCategories(uniqueCats);
    setUnits(unitRes.data || []);
    setWarehouses(whRes.data || []);
    // Default filter to Guest Amenities (first parent category with code AMN, or first parent)
    if (!filterCategory) {
      const amenities = uniqueCats.find(c => !c.parent_id && c.code === 'AMN');
      if (amenities) setFilterCategory(amenities.id);
      else {
        const firstParent = uniqueCats.find(c => !c.parent_id);
        if (firstParent) setFilterCategory(firstParent.id);
      }
    }
    setLoading(false);
  }

  async function generateCode(categoryId) {
    if (!categoryId) return '';
    const cat = categories.find(c => c.id === categoryId);
    if (!cat) return '';
    const prefix = cat.code;
    // Find highest existing code number for this prefix
    const { data: existing } = await supabase
      .from('items')
      .select('code')
      .eq('organization_id', selectedOrg?.id)
      .like('code', prefix + '-%')
      .order('code', { ascending: false })
      .limit(1);
    let nextNum = 1;
    if (existing && existing.length > 0) {
      const lastCode = existing[0].code;
      const numPart = parseInt(lastCode.split('-').pop(), 10);
      if (!isNaN(numPart)) nextNum = numPart + 1;
    }
    return prefix + '-' + String(nextNum).padStart(3, '0');
  }

  async function handleCategoryChange(categoryId) {
    if (!editItem) {
      const code = await generateCode(categoryId);
      setForm(f => ({...f, category_id: categoryId, code }));
    } else {
      setForm(f => ({...f, category_id: categoryId }));
    }
  }

  function openCreate() {
    setEditItem(null);
    setForm({ code: '', name: '', description: '', category_id: '', unit_id: '', purchase_unit_id: '', usage_unit_id: '', conversion_rate: 1, brand: '', size: '', min_stock: 0, max_stock: 0, reorder_point: 0, default_warehouse_id: '', allow_single_usage: false, allow_direct_purchase: false, allow_inuse_warehouse: false, max_inuse_qty: 0, is_active: true });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ code: item.code, name: item.name, description: item.description || '', category_id: item.category_id || '', unit_id: item.unit_id || '', purchase_unit_id: item.purchase_unit_id || '', usage_unit_id: item.usage_unit_id || '', conversion_rate: item.conversion_rate || 1, brand: item.brand || '', size: item.size || '', min_stock: item.min_stock, max_stock: item.max_stock, reorder_point: item.reorder_point, default_warehouse_id: item.default_warehouse_id || '', allow_single_usage: item.allow_single_usage || false, allow_direct_purchase: item.allow_direct_purchase || false, allow_inuse_warehouse: item.allow_inuse_warehouse || false, max_inuse_qty: item.max_inuse_qty || 0, is_active: item.is_active !== false });
    setShowModal(true);
  }

  async function handleSave() {
    try {
      const payload = { ...form, default_warehouse_id: form.default_warehouse_id || null };
      if (editItem) {
        const { error } = await supabase.from('items').update(payload).eq('id', editItem.id);
        if (error) throw error;
        showNotification(t('items.successUpdate'));
      } else {
        payload.organization_id = selectedOrg?.id;
        const { error } = await supabase.from('items').insert(payload);
        if (error) throw error;
        showNotification(t('items.successAdd'));
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }


  async function handleDeleteItem(item) {
    try {
      // Check relations before showing confirm dialog
      const reasons = [];

      // Check stock movements
      const { count: smCount } = await supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('item_id', item.id);
      if (smCount > 0) reasons.push(`${smCount} stock movement di bincard`);

      // Check stock balance with quantity > 0
      const { count: sbCount } = await supabase.from('stock_balance').select('id', { count: 'exact', head: true }).eq('item_id', item.id).gt('quantity', 0);
      if (sbCount > 0) reasons.push('masih memiliki stock balance');

      // Check room makeup items
      const { count: rmuCount } = await supabase.from('room_makeup_items').select('id', { count: 'exact', head: true }).eq('item_id', item.id);
      if (rmuCount > 0) reasons.push(`${rmuCount} room makeup items`);

      // Check room consumption items
      const { count: rcCount } = await supabase.from('room_consumption_items').select('id', { count: 'exact', head: true }).eq('item_id', item.id);
      if (rcCount > 0) reasons.push(`${rcCount} room consumption items`);

      // Note: room_category_standards references category_id (not item_id),
      // so deleting a single item cannot orphan a room setup — no check needed here.

      if (reasons.length > 0) {
        showNotification(`Item "${item.name}" (${item.code}) tidak dapat dihapus karena sudah memiliki:\n- ${reasons.join('\n- ')}`, 'error');
        return;
      }

      // No relations — confirm delete
      if (!(await showConfirm(`Hapus item "${item.name}" (${item.code})?`, { variant: 'danger' }))) return;

      // Clean up only orphan zero-balance stock rows via RPC (Fase 6: server-side).
      // Direct DELETE ke stock_balance sudah di-REVOKE di Fase 6b.
      await supabase.rpc('fn_delete_orphan_stock_balance', {
        p_organization_id: selectedOrg?.id,
        p_item_id: item.id,
      });

      const { error } = await supabase.from('items').delete().eq('id', item.id);
      if (error) throw error;
      showNotification(`Item "${item.name}" berhasil dihapus.`);
      loadData();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  async function toggleActive(item) {
    try {
      const newStatus = !item.is_active;
      const { error } = await supabase.from('items').update({ is_active: newStatus }).eq('id', item.id);
      if (error) throw error;
      showNotification(`Item "${item.name}" (${item.code}) ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`);
      loadData();
    } catch (err) {
      showNotification('Error: ' + err.message, 'error');
    }
  }

  const filtered = useMemo(() => items.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.code.toLowerCase().includes(search.toLowerCase()) ||
      (i.brand && i.brand.toLowerCase().includes(search.toLowerCase()));
    let matchCategory = true;
    if (filterSubCategory) {
      matchCategory = i.category_id === filterSubCategory;
    } else if (filterCategory) {
      matchCategory = i.category_id === filterCategory || categories.some(c => c.id === i.category_id && c.parent_id === filterCategory);
    }
    const matchStatus = filterStatus === 'all' || (filterStatus === 'active' && i.is_active) || (filterStatus === 'inactive' && !i.is_active);
    return matchSearch && matchCategory && matchStatus;
  }), [items, search, filterSubCategory, filterCategory, filterStatus, categories]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const safePage = Math.min(currentPage, totalPages || 1);
  const paginatedItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [search, filterCategory, filterSubCategory, filterStatus, pageSize]);

  return (
    <div>
      <PageHeader title={t('items.title')} subtitle={`${items.length} ${t('items.registered')}`}
        actions={<div className="flex gap-2">
          <Button variant="secondary" onClick={checkDuplicates}><Icons.Search /> Check Duplicate Items</Button>
          <Button variant="secondary" onClick={openImportModal}><Icons.Package /> Import from Hotel</Button>
          <Button onClick={openCreate}><Icons.Plus /> {t('items.addItem')}</Button>
        </div>} />

      {/* Filter Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-shrink-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input type="text" placeholder={t('items.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64 pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          </div>
          <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setFilterSubCategory(''); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white">
            <option value="">All Categories</option>
            {categories.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {filterCategory && categories.some(c => c.parent_id === filterCategory) && (
            <select value={filterSubCategory} onChange={e => setFilterSubCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white">
              <option value="">All Sub-Categories</option>
              {categories.filter(c => c.parent_id === filterCategory).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 bg-white">
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Non-Active Only</option>
          </select>
          {(filterCategory || filterSubCategory || filterStatus !== 'all') && (
            <button onClick={() => { setFilterCategory(''); setFilterSubCategory(''); setFilterStatus('all'); }} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <DataTable
          loading={loading}
          columns={[
            { header: t('items.code'), key: 'code', render: r => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.code}</span> },
            { header: t('items.name'), key: 'name', render: r => <span className="font-medium">{r.name}</span> },
            { header: t('items.brand'), render: r => r.brand || '-' },
            { header: t('items.size'), render: r => r.size ? <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{r.size}</span> : '-' },
            { header: t('items.purchaseUnit'), render: r => r.purchase_unit?.abbreviation || r.units?.abbreviation || '-' },
            { header: t('items.usageUnit'), render: r => r.usage_unit?.abbreviation || r.units?.abbreviation || '-' },
            { header: t('items.conversionRate'), render: r => r.conversion_rate && r.conversion_rate !== 1 ? <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded font-medium">1:{r.conversion_rate}</span> : <span className="text-gray-400">1:1</span> },
            { header: t('items.defaultWarehouse'), render: r => r.default_warehouse ? <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">{r.default_warehouse.name}</span> : <span className="text-gray-400">-</span> },
            { header: t('items.minStock'), render: r => formatNumber(r.min_stock) },
            { header: t('items.maxStock'), render: r => formatNumber(r.max_stock) },
            { header: 'ROP', render: r => formatNumber(r.reorder_point) },
            { header: 'SIU', render: r => r.allow_single_usage ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge> },
            { header: 'DP', render: r => r.allow_direct_purchase ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge> },
            { header: 'IUW', render: r => r.allow_inuse_warehouse ? <Badge color="green">Yes</Badge> : <Badge color="gray">No</Badge> },
            { header: 'Max IU', render: r => r.allow_inuse_warehouse && r.max_inuse_qty > 0 ? <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded font-medium">{formatNumber(r.max_inuse_qty)}</span> : <span className="text-gray-400">-</span> },
            { header: t('common.status'), render: r => <Badge color={r.is_active ? 'green' : 'red'}>{r.is_active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
          data={paginatedItems}
          actions={(row) => (
            <>
              <button onClick={(e) => { e.stopPropagation(); toggleActive(row); }}
                className={`p-1.5 rounded-lg ${row.is_active ? 'hover:bg-red-50 text-orange-400' : 'hover:bg-green-50 text-green-500'}`}
                title={row.is_active ? 'Set Non-Active' : 'Set Active'}>
                {row.is_active ? <Icons.Lock /> : <Icons.Unlock />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500"><Icons.Edit /></button>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(row); }} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400" title="Delete"><Icons.Trash /></button>
            </>
          )}
        />
        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
            <div>
              Showing {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} items
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button onClick={() => setCurrentPage(1)} disabled={safePage <= 1}
                  className={`px-2 py-1 rounded ${safePage <= 1 ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}>«</button>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                  className={`px-2 py-1 rounded ${safePage <= 1 ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}>‹</button>
                <span className="px-3 py-1 text-sm font-medium">{safePage} / {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                  className={`px-2 py-1 rounded ${safePage >= totalPages ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}>›</button>
                <button onClick={() => setCurrentPage(totalPages)} disabled={safePage >= totalPages}
                  className={`px-2 py-1 rounded ${safePage >= totalPages ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-100 text-gray-600'}`}>»</button>
              </div>
              <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
                className="px-2 py-1 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-primary-500">
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editItem ? t('items.editItem') : t('items.addNew')} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t('items.category')} required>
            <TreeSelect value={form.category_id} onChange={v => handleCategoryChange(v)} categories={categories} placeholder={t('items.selectCategory')} />
          </FormField>
          <FormField label={t('items.code')} required>
            <Input value={form.code} onChange={e => editItem && setForm({...form, code: e.target.value})} placeholder={editItem ? 'AMN-001' : t('items.codeAutoGenerated')} readOnly={!editItem} className={!editItem ? 'bg-gray-100 cursor-not-allowed' : ''} />
            {!editItem && <p className="text-xs text-gray-400 mt-1">{t('items.codeAutoGenerated')}</p>}
          </FormField>
          <FormField label={t('items.name')} required>
            <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t('items.namePlaceholder')} />
            <p className="text-xs text-gray-400 mt-1">{t('items.nameHint')}</p>
          </FormField>
          <FormField label={t('items.brand')}>
            <Input value={form.brand} onChange={e => setForm({...form, brand: e.target.value})} placeholder={t('items.brandPlaceholder')} />
          </FormField>
          <FormField label={t('items.size')}>
            <Input value={form.size} onChange={e => setForm({...form, size: e.target.value})} placeholder={t('items.sizePlaceholder')} />
          </FormField>
          <FormField label={t('items.purchaseUnit')}>
            <Select value={form.purchase_unit_id} onChange={e => setForm({...form, purchase_unit_id: e.target.value, unit_id: e.target.value})}>
              <option value="">{t('items.selectPurchaseUnit')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </Select>
          </FormField>
          <FormField label={t('items.usageUnit')}>
            <Select value={form.usage_unit_id} onChange={e => setForm({...form, usage_unit_id: e.target.value})}>
              <option value="">{t('items.selectUsageUnit')}</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </Select>
          </FormField>
          <FormField label={t('items.conversionRate')}>
            <Input type="number" min="1" value={form.conversion_rate} onChange={e => setForm({...form, conversion_rate: parseFloat(e.target.value) || 1})} />
            <p className="text-xs text-gray-400 mt-1">{t('items.conversionHint')}</p>
          </FormField>
          <FormField label={t('items.minStock')}>
            <Input {...intQtyInputProps} value={form.min_stock} onChange={e => setForm({...form, min_stock: toIntQty(e.target.value)})} />
          </FormField>
          <FormField label={t('items.maxStock')}>
            <Input {...intQtyInputProps} value={form.max_stock} onChange={e => setForm({...form, max_stock: toIntQty(e.target.value)})} />
          </FormField>
          <FormField label={t('items.reorderPoint')}>
            <Input {...intQtyInputProps} value={form.reorder_point} onChange={e => setForm({...form, reorder_point: toIntQty(e.target.value)})} />
          </FormField>
          <FormField label={t('items.defaultWarehouse')}>
            <Select value={form.default_warehouse_id} onChange={e => setForm({...form, default_warehouse_id: e.target.value})}>
              <option value="">{t('items.selectWarehouse')}</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </Select>
          </FormField>
          <FormField label={t('common.description')}>
            <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder={t('items.optionalDesc')} />
          </FormField>
          <FormField label="Allow Single Item Usage">
            <div className="flex items-center gap-3 mt-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={form.allow_single_usage || false}
                  onChange={e => setForm({...form, allow_single_usage: e.target.checked})}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                <span className="ml-2 text-sm text-gray-600">{form.allow_single_usage ? 'Yes' : 'No'}</span>
              </label>
              <span className="text-xs text-gray-400">Item ini boleh di-move out via Single Item Usage</span>
            </div>
          </FormField>
          <FormField label="Allow Direct Purchase">
            <div className="flex items-center gap-3 mt-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={form.allow_direct_purchase || false}
                  onChange={e => setForm({...form, allow_direct_purchase: e.target.checked})}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                <span className="ml-2 text-sm text-gray-600">{form.allow_direct_purchase ? 'Yes' : 'No'}</span>
              </label>
              <span className="text-xs text-gray-400">Item ini boleh diinput via Direct Purchase</span>
            </div>
          </FormField>
          <FormField label="Allow In-Use Warehouse">
            <div className="flex items-center gap-3 mt-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={form.allow_inuse_warehouse || false}
                  onChange={e => setForm({...form, allow_inuse_warehouse: e.target.checked})}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>
                <span className="ml-2 text-sm text-gray-600">{form.allow_inuse_warehouse ? 'Yes' : 'No'}</span>
              </label>
              <span className="text-xs text-gray-400">Item ini boleh masuk ke In-Use Warehouse (kamar)</span>
            </div>
          </FormField>
          {form.allow_inuse_warehouse && (
            <FormField label="Max In-Use Qty">
              <Input type="number" min="0" step="1" value={form.max_inuse_qty} onChange={e => setForm({...form, max_inuse_qty: parseInt(e.target.value) || 0})} placeholder="0 = unlimited" />
              <span className="text-xs text-gray-400 mt-1">Maksimal qty yang boleh berada di In-Use Warehouse. 0 = tidak dibatasi.</span>
            </FormField>
          )}
          <FormField label="Status Item">
            <div className="flex items-center gap-3 mt-1">
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={form.is_active !== false}
                  onChange={e => setForm({...form, is_active: e.target.checked})}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                <span className={`ml-2 text-sm font-medium ${form.is_active !== false ? 'text-green-600' : 'text-red-500'}`}>{form.is_active !== false ? 'Active' : 'Non-Active'}</span>
              </label>
              <span className="text-xs text-gray-400">Item non-active tidak akan muncul di seluruh dropdown pilihan item</span>
            </div>
          </FormField>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave}>{editItem ? t('common.update') : t('common.save')}</Button>
        </div>
      </Modal>

      {/* Import from Hotel Modal */}
      <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title="Import Items from Another Hotel" size="xl">
        <div className="space-y-4">
          {/* Step 1: Select Hotel */}
          <FormField label="Select Source Hotel" required>
            <Select value={importSelectedOrg} onChange={e => handleImportOrgChange(e.target.value)}>
              <option value="">-- Select Hotel --</option>
              {importOrgs.map(o => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
            </Select>
          </FormField>

          {importSelectedOrg && (
            <div className="flex gap-3">
              {/* Step 2: Filter Category Level 1 */}
              <FormField label="Category (Level 1)" className="flex-1">
                <Select value={importFilterCat} onChange={e => handleImportCatFilter(e.target.value)}>
                  <option value="">-- All Categories --</option>
                  {importCategories.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>

              {/* Step 3: Filter Category Level 2 */}
              {importFilterCat && importCategories.some(c => c.parent_id === importFilterCat) && (
                <FormField label="Sub-Category (Level 2)" className="flex-1">
                  <Select value={importFilterSubCat} onChange={e => handleImportSubCatFilter(e.target.value)}>
                    <option value="">-- All Sub-Categories --</option>
                    {importCategories.filter(c => c.parent_id === importFilterCat).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </FormField>
              )}
            </div>
          )}

          {/* Step 4: Item Checklist */}
          {importItems.length > 0 && (
            <div className="border rounded-lg max-h-80 overflow-y-auto">
              <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={importItems.length > 0 && importItems.every(i => importChecked[i.id])}
                    onChange={toggleImportAll} className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-sm font-medium text-gray-700">Select All ({importItems.length} items available)</span>
                </label>
                <span className="text-xs text-gray-500 ml-auto">{Object.values(importChecked).filter(Boolean).length} selected</span>
              </div>
              <div className="divide-y divide-gray-100">
                {importItems.map(item => (
                  <label key={item.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={!!importChecked[item.id]} onChange={() => toggleImportCheck(item.id)}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{item.code}</span>
                    <span className="text-sm font-medium text-gray-800">{item.name}</span>
                    {item.brand && <span className="text-xs text-gray-500">{item.brand}</span>}
                    <span className="text-xs text-gray-400 ml-auto">{item.item_categories?.name || ''}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {importSelectedOrg && importFilterCat && importItems.length === 0 && !importLoading && (
            <div className="text-center py-6 text-gray-500 text-sm">
              No new items available to import (all items from this category already exist in your hotel)
            </div>
          )}

          {importLoading && <PageLoader />}
        </div>
        <div className="flex justify-between items-center mt-6 pt-4 border-t">
          <span className="text-sm text-gray-500">
            {Object.values(importChecked).filter(Boolean).length > 0
              ? `${Object.values(importChecked).filter(Boolean).length} items will be imported (categories auto-created if needed)`
              : 'Select items to import'}
          </span>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowImportModal(false)}>Cancel</Button>
            <Button onClick={handleImportItems} disabled={importSaving || Object.values(importChecked).filter(Boolean).length === 0}>
              {importSaving ? 'Importing...' : `Import ${Object.values(importChecked).filter(Boolean).length} Items`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Check Duplicate Items Modal */}
      <Modal open={showDupModal} onClose={() => setShowDupModal(false)} title="Check Duplicate Items" size="xl">
        {dupLoading ? (
          <PageLoader message={`Scanning ${items.length} items for duplicates...`} />
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <div className="flex gap-4">
              <div className={`flex-1 p-4 rounded-lg border ${dupResults.exact.length > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <div className={`text-2xl font-bold ${dupResults.exact.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{dupResults.exact.length}</div>
                <div className="text-sm text-gray-600">Exact Duplicates</div>
              </div>
              <div className={`flex-1 p-4 rounded-lg border ${dupResults.likely.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
                <div className={`text-2xl font-bold ${dupResults.likely.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>{dupResults.likely.length}</div>
                <div className="text-sm text-gray-600">Likely Duplicates</div>
              </div>
            </div>

            {dupResults.exact.length === 0 && dupResults.likely.length === 0 && (
              <div className="text-center py-8 text-green-600">
                <Icons.Check />
                <p className="mt-2 font-medium">No duplicate items found!</p>
                <p className="text-sm text-gray-500 mt-1">All {items.length} items are unique.</p>
              </div>
            )}

            {/* Exact Duplicates */}
            {dupResults.exact.length > 0 && (
              <div>
                <h3 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
                  <Icons.AlertTriangle /> Exact Duplicates ({dupResults.exact.length} groups)
                </h3>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {dupResults.exact.map((group, gi) => (
                    <div key={gi} className="border border-red-200 rounded-lg overflow-hidden">
                      <div className="bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
                        Group {gi + 1} — {group.length} identical items
                      </div>
                      <table className="w-full text-sm">
                        <thead><tr className="bg-gray-50 text-left text-xs text-gray-500">
                          <th className="px-3 py-1.5">Code</th><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Brand</th><th className="px-3 py-1.5">Size</th><th className="px-3 py-1.5">Category</th><th className="px-3 py-1.5">Unit</th>
                        </tr></thead>
                        <tbody>
                          {group.map(item => (
                            <tr key={item.id} className="border-t border-gray-100">
                              <td className="px-3 py-1.5 font-mono text-xs">{item.code}</td>
                              <td className="px-3 py-1.5 font-medium">{item.name}</td>
                              <td className="px-3 py-1.5 text-gray-500">{item.brand || '-'}</td>
                              <td className="px-3 py-1.5 text-gray-500">{item.size || '-'}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">{item.item_categories?.name || '-'}</td>
                              <td className="px-3 py-1.5 text-xs">{item.units?.abbreviation || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Likely Duplicates */}
            {dupResults.likely.length > 0 && (
              <div>
                <h3 className="font-semibold text-orange-700 mb-3 flex items-center gap-2">
                  <Icons.AlertTriangle /> Likely Duplicates ({dupResults.likely.length} pairs)
                </h3>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {dupResults.likely.map((pair, pi) => (
                    <div key={pi} className="border border-orange-200 rounded-lg overflow-hidden">
                      <div className="bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700">
                        Pair {pi + 1} — {pair.similarity}% similar
                      </div>
                      <table className="w-full text-sm">
                        <thead><tr className="bg-gray-50 text-left text-xs text-gray-500">
                          <th className="px-3 py-1.5">Code</th><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Brand</th><th className="px-3 py-1.5">Size</th><th className="px-3 py-1.5">Category</th><th className="px-3 py-1.5">Unit</th>
                        </tr></thead>
                        <tbody>
                          {pair.items.map(item => (
                            <tr key={item.id} className="border-t border-gray-100">
                              <td className="px-3 py-1.5 font-mono text-xs">{item.code}</td>
                              <td className="px-3 py-1.5 font-medium">{item.name}</td>
                              <td className="px-3 py-1.5 text-gray-500">{item.brand || '-'}</td>
                              <td className="px-3 py-1.5 text-gray-500">{item.size || '-'}</td>
                              <td className="px-3 py-1.5 text-xs text-gray-500">{item.item_categories?.name || '-'}</td>
                              <td className="px-3 py-1.5 text-xs">{item.units?.abbreviation || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end mt-6 pt-4 border-t">
          <Button variant="secondary" onClick={() => setShowDupModal(false)}>Close</Button>
        </div>
      </Modal>
    </div>
  );
}

export default ItemsPage;
