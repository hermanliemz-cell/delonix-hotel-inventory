import React from 'react';

/**
 * Standarized loading component used across the entire application.
 * Used as Suspense fallback for lazy-loaded pages and within pages for data loading.
 */
export function PageLoader({ message, size = 'md' }) {
  const sizeClasses = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-3',
    lg: 'w-14 h-14 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 w-full">
      <div
        className={`${sizeClasses[size] || sizeClasses.md} border-blue-200 border-t-blue-600 rounded-full animate-spin`}
        style={{ borderStyle: 'solid' }}
      />
      {message && (
        <p className="mt-4 text-sm text-gray-500">{message}</p>
      )}
    </div>
  );
}

/**
 * Full-page loader used as Suspense fallback when navigating between pages.
 */
export function FullPageLoader() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] w-full">
      <div
        className="w-10 h-10 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"
        style={{ borderStyle: 'solid' }}
      />
      <p className="mt-4 text-sm text-gray-400">Loading...</p>
    </div>
  );
}

export default PageLoader;
