"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type SiteTheme = "dark" | "light";

const STORAGE_KEY = "seethrough-theme";

type ThemeContextValue = {
  theme: SiteTheme;
  setTheme: (theme: SiteTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): SiteTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore */
  }
  return "light";
}

function applyThemeClass(theme: SiteTheme) {
  const root = document.documentElement;
  root.classList.toggle("marketing-theme-light", theme === "light");
  root.classList.toggle("marketing-theme-dark", theme === "dark");
  root.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<SiteTheme>("light");

  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyThemeClass(initial);
  }, []);

  const setTheme = useCallback((next: SiteTheme) => {
    setThemeState(next);
    applyThemeClass(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

/** Safe outside ThemeProvider — defaults to light marketing look. */
export function useOptionalTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      theme: "light",
      setTheme: () => undefined,
      toggleTheme: () => undefined,
    }
  );
}
