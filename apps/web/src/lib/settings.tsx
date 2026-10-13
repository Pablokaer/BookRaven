import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "./api";
import { deviceId } from "./device";
import { onServerEvent } from "./events";
import type { FontId } from "./fonts";

export type ThemeId = "light" | "sepia" | "dark" | "black";

export type ReaderSettings = {
  theme: ThemeId;
  font: FontId;
  /** Percent of the book's base size. */
  fontSize: number;
  lineHeight: number;
  /** Side margin as a percentage of the page width. */
  margin: number;
  /** Top and bottom margin, px. */
  marginY: number;
  /** Width of one page, px. The page is centered; the area around it is a shade darker. */
  pageWidth: number;
  /** Extra space between letters, em (0 = the book's own). */
  letterSpacing: number;
  justify: boolean;
  /** Replace the book's own text/background colors with the theme's. */
  overrideColors: boolean;
  /** CSS contrast filter, percent (100 = unchanged). */
  contrast: number;
  /** Max columns on wide screens (two-page spread). */
  columns: 1 | 2;
  pdfFit: "width" | "page";
  /** Books the reader wants to finish this year (dashboard reading goal). */
  readingGoal: number;
  /** Comics: fit the whole page on screen, or fill the width and scroll. */
  comicFit: "page" | "width";
  /** Comics: show two pages side by side on wide screens. */
  comicSpreads: boolean;
  /** Comics: reading direction; "auto" follows the archive's ComicInfo (manga = right to left). */
  comicDirection: "auto" | "ltr" | "rtl";
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "light",
  font: "publisher",
  fontSize: 100,
  lineHeight: 1.5,
  margin: 6,
  marginY: 40,
  pageWidth: 720,
  letterSpacing: 0,
  justify: true,
  overrideColors: true,
  contrast: 100,
  columns: 2,
  pdfFit: "page",
  readingGoal: 12,
  comicFit: "page",
  comicSpreads: true,
  comicDirection: "auto",
};

/** `surround` is the area outside the page: a shade darker than `bg`. */
export const THEMES: Record<ThemeId, { label: string; bg: string; fg: string; link: string; surround: string }> = {
  light: { label: "Light", bg: "#ffffff", fg: "#1c1c1c", link: "#0f5ea8", surround: "#ececec" },
  sepia: { label: "Sepia", bg: "#f4ecd8", fg: "#5b4636", link: "#8a4b0f", surround: "#e6dbc2" },
  dark: { label: "Dark", bg: "#1f1f1f", fg: "#d4d4d4", link: "#7cb7ff", surround: "#141414" },
  // Nothing is darker than black, so here the page is told apart by a faint outline only.
  black: { label: "Inverted", bg: "#000000", fg: "#ffffff", link: "#9cc9ff", surround: "#000000" },
};

const LOCAL_KEY = "readsync.settings";

function loadLocal(): ReaderSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

type Ctx = { settings: ReaderSettings; update: (patch: Partial<ReaderSettings>) => void };
const SettingsContext = createContext<Ctx | null>(null);

/** Reader settings: instant from localStorage, then synced with the server and other devices. */
export function SettingsProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [settings, setSettings] = useState<ReaderSettings>(loadLocal);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const applyLocal = useCallback((s: ReaderSettings) => {
    setSettings(s);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    apiJson<{ settings: Partial<ReaderSettings> }>("/api/settings")
      .then((r) => {
        if (r.settings && Object.keys(r.settings).length) applyLocal({ ...DEFAULT_SETTINGS, ...r.settings });
      })
      .catch(() => {});
    return onServerEvent((event, data) => {
      if (event === "settings.updated" && data.deviceId !== deviceId) {
        applyLocal({ ...DEFAULT_SETTINGS, ...data.settings });
      }
    });
  }, [enabled, applyLocal]);

  const update = useCallback(
    (patch: Partial<ReaderSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          apiJson("/api/settings", {
            method: "PUT",
            body: JSON.stringify({ settings: next, deviceId }),
          }).catch(() => {});
        }, 800);
        return next;
      });
    },
    [],
  );

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
