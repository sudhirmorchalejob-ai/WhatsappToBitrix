import { useEffect, useState } from 'react';

const THEME_KEY = 'theme';

function getInitialTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function initTheme() {
  const theme = getInitialTheme();
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState(initTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore storage errors (private mode, etc.)
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
