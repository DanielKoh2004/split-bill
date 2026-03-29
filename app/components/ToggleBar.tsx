"use client";

import { Moon, Sun, Languages } from "lucide-react";
import { useAppContext } from "@/src/ThemeContext";

/**
 * Floating toggle bar for dark/light mode and language.
 * Rendered in bottom-right corner. Works on both host and guest pages.
 */
export default function ToggleBar() {
  const { theme, toggleTheme, locale, toggleLocale } = useAppContext();

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 bg-card-themed border border-themed rounded-2xl p-1.5 shadow-elevated-themed">
      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-secondary-themed hover:bg-elevated-themed transition-all active:scale-95"
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      >
        {theme === "light" ? (
          <Moon className="w-4.5 h-4.5" />
        ) : (
          <Sun className="w-4.5 h-4.5 text-amber-400" />
        )}
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-themed" />

      {/* Language Toggle */}
      <button
        onClick={toggleLocale}
        className="h-9 px-2.5 rounded-xl flex items-center justify-center gap-1 text-secondary-themed hover:bg-elevated-themed transition-all active:scale-95"
        aria-label={locale === "en" ? "Switch to Chinese" : "Switch to English"}
      >
        <Languages className="w-4 h-4" />
        <span className="text-xs font-bold tracking-wider">
          {locale === "en" ? "中文" : "EN"}
        </span>
      </button>
    </div>
  );
}
