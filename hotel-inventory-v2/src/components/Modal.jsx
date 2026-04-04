import React, { useRef, useCallback } from 'react';
import { Icons } from './Icons';

export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  const contentRef = useRef(null);

  const handleBackdropMouseDown = useCallback((e) => {
    // Only close if clicking the backdrop itself (not propagated from portaled elements)
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" onMouseDown={handleBackdropMouseDown}>
      <div className="fixed inset-0 bg-black bg-opacity-50 pointer-events-none" />
      <div
        ref={contentRef}
        className={`relative bg-white rounded-lg sm:rounded-xl shadow-xl w-full ${sizes[size]} max-h-[95vh] sm:max-h-[90vh] flex flex-col fade-in`}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between rounded-t-lg sm:rounded-t-xl gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 flex-1 truncate">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg flex-shrink-0"><Icons.X /></button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
