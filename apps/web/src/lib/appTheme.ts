import { useEffect, useState } from "react";

/**
 * Light or dark interface (the reader has its own page themes). Kept per device, like the
 * layout: a phone in daylight and a desktop at night may want different ones.
 */
export type AppTheme = "system" | "dark" | "light";

const KEY = "readsync.appTheme";
const THEME_COLOR = { dark: "#0a0c0d", light: "#f5f6f5" };
const prefersLight = () => window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;

export function getAppTheme(): AppTheme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme: AppTheme) {
  const resolved = theme === "system" ? (prefersLight() ? "light" : "dark") : theme;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[resolved]);
}

/** Applies the saved theme now (call before the first render) and follows the system while on "system". */
export function initAppTheme() {
  apply(getAppTheme());
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (getAppTheme() === "system") apply("system");
  });
}

export function useAppTheme() {
  const [theme, setTheme] = useState(getAppTheme);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}
