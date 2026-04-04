import { useContext } from 'react';
import { AppContext } from '../contexts/AppContext.jsx';

/**
 * Hook to access AppContext
 * Provides auth, organization, UI state, and notification functions
 */
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
