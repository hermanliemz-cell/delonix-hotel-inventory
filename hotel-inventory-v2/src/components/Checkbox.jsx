import React from 'react';

export function Checkbox({ ...props }) {
  return <input type="checkbox" {...props} className={`w-4 h-4 border border-gray-300 rounded cursor-pointer ${props.className || ''}`} />;
}
