import { useContext } from 'react';
import { LanguageContext } from '../contexts/LanguageContext.jsx';

/**
 * Hook to access translation and language functionality
 * Provides: t (translate function), lang, toggleLanguage
 */
export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within LanguageProvider');
  }
  return context;
}
