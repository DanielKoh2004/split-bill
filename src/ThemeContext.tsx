"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { type Locale, type Translations, translations } from "./i18n";

// ─────────────────────────────────────────────────────────────
// Theme + Language Context
//
// Provides dark/light mode and en/zh language toggles.
// Persisted in localStorage under "splitbill_theme" and
// "splitbill_locale". Applies `dark` class to <html> for CSS.
// ─────────────────────────────────────────────────────────────

type Theme = "light" | "dark";

interface AppContextValue {
  theme: Theme;
  toggleTheme: () => void;
  locale: Locale;
  toggleLocale: () => void;
  t: Translations;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [locale, setLocale] = useState<Locale>("en");
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("splitbill_theme") as Theme | null;
    const savedLocale = localStorage.getItem("splitbill_locale") as Locale | null;

    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }

    if (savedLocale === "en" || savedLocale === "zh") {
      setLocale(savedLocale);
    }

    setMounted(true);
  }, []);

  // Sync <html> class and lang attribute
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.lang = locale;

    localStorage.setItem("splitbill_theme", theme);
    localStorage.setItem("splitbill_locale", locale);
  }, [theme, locale, mounted]);

  const toggleTheme = () => setTheme((prev) => (prev === "light" ? "dark" : "light"));
  const toggleLocale = () => setLocale((prev) => (prev === "en" ? "zh" : "en"));

  const t = translations[locale];

  return (
    <AppContext.Provider value={{ theme, toggleTheme, locale, toggleLocale, t }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
}
