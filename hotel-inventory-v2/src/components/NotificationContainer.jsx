import React from 'react';

export function NotificationContainer({ notification, onClose }) {
  if (!notification) return null;

  return (
    <div className={`fixed top-4 right-4 z-[9999] max-w-md p-4 rounded-lg text-sm font-medium shadow-lg fade-in ${
      notification.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
      notification.type === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-200' :
      'bg-green-50 text-green-800 border border-green-200'
    }`}>
      {notification.message}
    </div>
  );
}
