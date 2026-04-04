import React from 'react';

export function Tabs({ activeTab, onChange, tabs, children }) {
  return (
    <div>
      <div className="border-b border-gray-200 flex gap-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {children}
      </div>
    </div>
  );
}

export function Tab({ children }) {
  return <div>{children}</div>;
}
