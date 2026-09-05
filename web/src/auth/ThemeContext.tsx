import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const ThemeCtx = createContext<{ theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored as 'light' | 'dark');
    }
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setThemeCb = useCallback((theme: 'light' | 'dark') => {
    setTheme(theme);
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme: setThemeCb }), [theme, setThemeCb]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): { theme: 'light' | 'dark'; setTheme: (theme: 'light' | 'dark') => void } {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

export function ThemeHeader(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const icon = theme === 'dark' ? '☀' : '🌙';
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {icon}
    </button>
  );
}