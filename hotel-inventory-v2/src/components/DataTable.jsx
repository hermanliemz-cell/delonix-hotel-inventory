import React from 'react';
import { useTranslation } from '../hooks/useTranslation';

export function DataTable({ columns, data, loading: isLoading, onRowClick, actions, mobileCard }) {
  const { t } = useTranslation();
  const safeData = Array.isArray(data) ? data : [];
  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="spinner"></div></div>;
  }
  if (!safeData || safeData.length === 0) {
    return <div className="text-center py-12 text-gray-500">{t('common.noData')}</div>;
  }
  return (
    <>
      {/* Mobile card layout */}
      <div className="sm:hidden divide-y divide-gray-100">
        {safeData.map((row, i) => {
          // If custom mobileCard renderer is provided, use it
          if (mobileCard) return <div key={row.id || i}>{mobileCard(row)}</div>;
          // Auto-generate card from columns
          const titleCol = columns[0];
          const detailCols = columns.slice(1);
          return (
            <div key={row.id || i}
              className={`p-3 hover:bg-gray-50 active:bg-gray-100 ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={() => onRowClick && onRowClick(row)}>
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-sm text-primary-700 min-w-0 flex-1">
                  {titleCol.render ? titleCol.render(row) : row[titleCol.key]}
                </div>
                {actions && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {actions(row)}
                  </div>
                )}
              </div>
              {detailCols.length > 0 && (
                <div className={`mt-1.5 grid gap-x-3 gap-y-1 text-xs ${detailCols.length <= 2 ? 'grid-cols-2' : detailCols.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {detailCols.map((col, j) => (
                    <div key={j} className="min-w-0">
                      <span className="text-gray-400">{col.header}: </span>
                      <span className="text-gray-700">{col.render ? col.render(row) : row[col.key]}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Desktop table layout */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map((col, i) => (
                <th key={i} className={`${col.align === 'right' ? 'text-right' : 'text-left'} px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 whitespace-nowrap`}>{col.header}</th>
              ))}
              {actions && <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {safeData.map((row, i) => (
              <tr key={row.id || i}
                  className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick && onRowClick(row)}>
                {columns.map((col, j) => (
                  <td key={j} className={`px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
                {actions && (
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">
                    <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                      {actions(row)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
