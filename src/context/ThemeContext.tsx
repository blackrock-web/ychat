import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { ThemeMode } from '../types/settings';

export type { ThemeMode };
export type ResolvedTheme = 'ychat' | 'dark' | 'light';

export interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = 'ychat_theme';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (saved === 'ychat' || saved === 'light' || saved === 'system' || saved === 'dark') {
      return saved;
    }
    // Also check legacy ychat_settings
    const savedSettings = localStorage.getItem('ychat_settings');
    if (savedSettings) {
      const parsed = JSON.parse(savedSettings);
      if (parsed.theme === 'ychat' || parsed.theme === 'light' || parsed.theme === 'system' || parsed.theme === 'dark') {
        return parsed.theme;
      }
    }
  } catch {}
  return 'ychat';
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'ychat' : 'light';
  }
  return 'ychat';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(resolveSystemTheme);

  // Listen to OS system color scheme changes
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemResolved(e.matches ? 'ychat' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (theme === 'system') {
      return systemResolved;
    }
    return theme;
  }, [theme, systemResolved]);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
      // Keep legacy settings object synchronized
      const savedSettings = localStorage.getItem('ychat_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        parsed.theme = newTheme;
        localStorage.setItem('ychat_settings', JSON.stringify(parsed));
      }
    } catch {}
  }, []);

  // Immediate DOM synchronization to both <html> and #root
  useEffect(() => {
    const root = document.documentElement;
    const rootContainer = document.getElementById('root');

    // 1. Data attributes
    root.setAttribute('data-theme', resolvedTheme);
    root.setAttribute('data-theme-mode', theme);
    if (rootContainer) {
      rootContainer.setAttribute('data-theme', resolvedTheme);
      rootContainer.setAttribute('data-theme-mode', theme);
    }

    // 2. Class lists for Tailwind / CSS variants
    if (resolvedTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      rootContainer?.classList.remove('dark');
      rootContainer?.classList.add('light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      rootContainer?.classList.remove('light');
      rootContainer?.classList.add('dark');
    }
  }, [theme, resolvedTheme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme
    }),
    [theme, resolvedTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
