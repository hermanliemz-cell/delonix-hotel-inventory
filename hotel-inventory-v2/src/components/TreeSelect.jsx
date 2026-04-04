import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

export function TreeSelect({ value, onChange, categories, placeholder = 'Select Category', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  const parents = categories.filter(c => !c.parent_id);
  const getChildren = (parentId) => categories.filter(c => c.parent_id === parentId);
  const selected = categories.find(c => c.id === value);

  // Position dropdown below the button
  const updatePosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // Close on outside click — use native mousedown to avoid stacking/portal issues
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open]);

  // Update position when opening
  useEffect(() => {
    if (open) {
      updatePosition();
      // Also update on scroll/resize
      const handleScroll = () => updatePosition();
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [open, updatePosition]);

  // Auto-expand parent of selected item on mount
  useEffect(() => {
    if (selected && selected.parent_id) {
      setExpanded(prev => ({ ...prev, [selected.parent_id]: true }));
    }
  }, [value]);

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectCategory = (cat) => {
    onChange(cat.id);
    setOpen(false);
    setSearch('');
  };

  const matchesSearch = (cat) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return cat.name.toLowerCase().includes(s) || (cat.code && cat.code.toLowerCase().includes(s));
  };

  const parentMatchesOrHasChildMatch = (parent) => {
    if (matchesSearch(parent)) return true;
    return getChildren(parent.id).some(c => matchesSearch(c));
  };

  const dropdown = open ? ReactDOM.createPortal(
    <div
      ref={dropdownRef}
      className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
      style={{
        position: 'fixed',
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
        maxHeight: '300px',
        zIndex: 9999,
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="p-2 border-b border-gray-100">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search category..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent" autoFocus />
        </div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: '240px' }}>
        {parents.filter(p => parentMatchesOrHasChildMatch(p)).map(parent => {
          const children = getChildren(parent.id).filter(c => matchesSearch(c) || matchesSearch(parent));
          const isExpanded = expanded[parent.id] || (search && children.length > 0);
          const hasChildren = children.length > 0;
          return (
            <div key={parent.id}>
              <div className="flex items-center group">
                {hasChildren ? (
                  <button type="button" onClick={(e) => toggleExpand(parent.id, e)}
                    className="p-1.5 ml-1 hover:bg-gray-100 rounded transition-colors flex-shrink-0">
                    <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ) : <div className="w-7 flex-shrink-0" />}
                <button type="button" onClick={() => selectCategory(parent)}
                  className={`flex-1 flex items-center gap-2 px-2 py-2 text-sm text-left hover:bg-blue-50 transition-colors ${value === parent.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700'}`}>
                  <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" style={{ opacity: hasChildren ? 1 : 0.3 }}></span>
                  <span>{parent.name}</span>
                  {parent.code && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded ml-auto">{parent.code}</span>}
                  {value === parent.id && (
                    <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>
              {isExpanded && children.map(child => (
                <button type="button" key={child.id} onClick={() => selectCategory(child)}
                  className={`w-full flex items-center gap-2 pl-10 pr-3 py-1.5 text-sm text-left hover:bg-blue-50 transition-colors ${value === child.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600'}`}>
                  <span className="w-1 h-1 rounded-full bg-gray-400 flex-shrink-0"></span>
                  <span>{child.name}</span>
                  {child.code && <span className="text-xs bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded ml-auto">{child.code}</span>}
                  {value === child.id && (
                    <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          );
        })}
        {parents.filter(p => parentMatchesOrHasChildMatch(p)).length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-400 text-center">No categories found</div>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className="relative">
      <button type="button" onClick={() => { if (!disabled) { updatePosition(); setOpen(!open); } }}
        className={`w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-sm transition-colors ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-60' : 'bg-white hover:border-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent'}`}>
        <span className={selected ? 'text-gray-800 truncate' : 'text-gray-400'}>
          {selected ? (
            <span className="flex items-center gap-1.5">
              {selected.parent_id && <span className="text-gray-400 text-xs">{categories.find(c => c.id === selected.parent_id)?.name} /</span>}
              <span className="font-medium">{selected.name}</span>
              {selected.code && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{selected.code}</span>}
            </span>
          ) : placeholder}
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}
