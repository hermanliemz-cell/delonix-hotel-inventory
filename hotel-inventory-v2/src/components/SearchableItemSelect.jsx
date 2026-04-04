import React, { useState, useEffect, useRef } from 'react';

export function SearchableItemSelect({ items, value, onChange, placeholder }) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = items.filter(i =>
    (i.code + ' ' + i.name).toLowerCase().includes(search.toLowerCase())
  );

  const selectedItem = items.find(i => i.id === value);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={isOpen ? search : (selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : '')}
        onChange={e => { setSearch(e.target.value); if (!isOpen) setIsOpen(true); }}
        onFocus={() => { setIsOpen(true); setSearch(''); }}
        placeholder={placeholder || 'Search item...'}
        className="w-full px-2 py-1 border rounded text-sm"
      />
      {value && !isOpen && (
        <button onClick={() => { onChange(''); setSearch(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs">✕</button>
      )}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">No items found</div>
          ) : filtered.map(i => (
            <div key={i.id}
              onClick={() => { onChange(i.id); setIsOpen(false); setSearch(''); }}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${i.id === value ? 'bg-blue-50 font-medium' : ''}`}>
              <span className="font-mono text-xs text-gray-500">{i.code}</span> — {i.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
