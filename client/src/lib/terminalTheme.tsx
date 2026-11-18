import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";

export type AppBgId =
  | "ice-blue-pro"
  | "neon-cyber"
  | "bloomberg-classic"
  | "daylight-trader"
  | "solarized-dark"
  | "crimson-forge"
  | "emerald-core"
  | "ultraviolet"
  | "high-contrast-terminal";

export interface AppBgOption {
  id: AppBgId;
  label: string;
}

export const APP_BACKGROUNDS: readonly AppBgOption[] = [
  { id: "ice-blue-pro", label: "Ice Blue Pro" },
  { id: "neon-cyber", label: "Neon Cyber" },
  { id: "bloomberg-classic", label: "Bloomberg Classic" },
  { id: "daylight-trader", label: "Daylight Trader (Light)" },
  { id: "solarized-dark", label: "Solarized Dark" },
  { id: "crimson-forge", label: "Crimson Forge" },
  { id: "emerald-core", label: "Emerald Core" },
  { id: "ultraviolet", label: "Ultraviolet" },
  { id: "high-contrast-terminal", label: "High-Contrast Terminal" },
] as const;

export type CardSurfaceId = "solid" | "glass" | "oled" | "neon";

export interface CardSurfaceOption {
  id: CardSurfaceId;
  label: string;
}

export const CARD_SURFACES: readonly CardSurfaceOption[] = [
  { id: "solid", label: "Solid (Default)" },
  { id: "glass", label: "Glassmorphism" },
  { id: "oled", label: "High-Contrast OLED" },
  { id: "neon", label: "Neon Outline" },
] as const;

export type FontFamilyOption = "Inter" | "Roboto" | "Arial" | "Segoe UI";

export const FONT_FAMILY_CSS: Record<FontFamilyOption, string> = {
  Inter: "'Inter', system-ui, -apple-system, sans-serif",
  Roboto: "'Roboto', system-ui, -apple-system, sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  "Segoe UI": "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
};

export type TextScaleOption = "compact" | "standard" | "large";

export const TEXT_SCALE_PX: Record<TextScaleOption, string> = {
  compact: "0.875rem",
  standard: "1rem",
  large: "1.125rem",
};

export type EngineBgOption = "inherit" | "contrast-dark" | "ice-blue-pro" | "bloomberg-classic" | "emerald-core" | "ultraviolet";

export const ENGINE_BG_CLASSES: Record<EngineBgOption, string> = {
  inherit: "bg-transparent",
  "contrast-dark": "bg-[#050811] border border-slate-800 rounded-xl p-4",
  "ice-blue-pro": "bg-[#060d1f] border border-cyan-500/40 rounded-xl p-4",
  "bloomberg-classic": "bg-[#1e1e1e] border border-amber-500/40 rounded-xl p-4",
  "emerald-core": "bg-[#03120b] border border-emerald-500/40 rounded-xl p-4",
  ultraviolet: "bg-[#0e0821] border border-purple-500/40 rounded-xl p-4",
};

function readStorage<T extends string>(key: string, fallback: T, valid?: readonly string[]): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = window.localStorage.getItem(key);
    if (!val) return fallback;
    if (valid && !valid.includes(val)) return fallback;
    return val as T;
  } catch {
    return fallback;
  }
}

/** Mutates <html> data attributes & CSS variables directly — zero React tree re-renders. */
export function applyDomTheme(
  appBg: AppBgId,
  cardTheme: CardSurfaceId,
  fontFamily: FontFamilyOption,
  textScale: TextScaleOption
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", appBg);
  root.setAttribute("data-card-surface", cardTheme);
  root.setAttribute("data-font-family", fontFamily);
  root.setAttribute("data-text-scale", textScale);
  root.style.setProperty("--term-font-family", FONT_FAMILY_CSS[fontFamily] ?? FONT_FAMILY_CSS.Inter);
  root.style.setProperty("--term-font-size", TEXT_SCALE_PX[textScale] ?? TEXT_SCALE_PX.standard);
}

interface TerminalThemeContextValue {
  appBg: AppBgId;
  setAppBg: (bg: AppBgId) => void;
  cardTheme: CardSurfaceId;
  setCardTheme: (t: CardSurfaceId) => void;
  fontFamily: FontFamilyOption;
  setFontFamily: (f: FontFamilyOption) => void;
  textScale: TextScaleOption;
  setTextScale: (s: TextScaleOption) => void;
  engineBg: EngineBgOption;
  setEngineBg: (e: EngineBgOption) => void;
}

const VALID_BG_IDS = APP_BACKGROUNDS.map((b) => b.id);
const VALID_CARD_IDS = CARD_SURFACES.map((c) => c.id);

const TerminalThemeContext = createContext<TerminalThemeContextValue>({
  appBg: "ice-blue-pro",
  setAppBg: () => {},
  cardTheme: "solid",
  setCardTheme: () => {},
  fontFamily: "Inter",
  setFontFamily: () => {},
  textScale: "standard",
  setTextScale: () => {},
  engineBg: "contrast-dark",
  setEngineBg: () => {},
});

export function TerminalThemeProvider({ children }: { children: React.ReactNode }) {
  const [appBg, setAppBgState] = useState<AppBgId>(() =>
    readStorage("chizzle.terminal.appBg", "ice-blue-pro", VALID_BG_IDS)
  );
  const [cardTheme, setCardThemeState] = useState<CardSurfaceId>(() =>
    readStorage("chizzle.terminal.cardTheme", "solid", VALID_CARD_IDS)
  );
  const [fontFamily, setFontFamilyState] = useState<FontFamilyOption>(() =>
    readStorage("chizzle.terminal.fontFamily", "Inter")
  );
  const [textScale, setTextScaleState] = useState<TextScaleOption>(() =>
    readStorage("chizzle.terminal.textScale", "standard")
  );
  const [engineBg, setEngineBgState] = useState<EngineBgOption>(() =>
    readStorage("chizzle.terminal.engineBg", "contrast-dark")
  );

  // Sync directly to <html> on mount and on change so native CSS handles color/font swaps instantaneously
  useEffect(() => {
    applyDomTheme(appBg, cardTheme, fontFamily, textScale);
  }, [appBg, cardTheme, fontFamily, textScale]);

  const setAppBg = useCallback((bg: AppBgId) => {
    setAppBgState(bg);
    try { window.localStorage.setItem("chizzle.terminal.appBg", bg); } catch {}
  }, []);

  const setCardTheme = useCallback((t: CardSurfaceId) => {
    setCardThemeState(t);
    try { window.localStorage.setItem("chizzle.terminal.cardTheme", t); } catch {}
  }, []);

  const setFontFamily = useCallback((f: FontFamilyOption) => {
    setFontFamilyState(f);
    try { window.localStorage.setItem("chizzle.terminal.fontFamily", f); } catch {}
  }, []);

  const setTextScale = useCallback((s: TextScaleOption) => {
    setTextScaleState(s);
    try { window.localStorage.setItem("chizzle.terminal.textScale", s); } catch {}
  }, []);

  const setEngineBg = useCallback((e: EngineBgOption) => {
    setEngineBgState(e);
    try { window.localStorage.setItem("chizzle.terminal.engineBg", e); } catch {}
  }, []);

  const value = useMemo<TerminalThemeContextValue>(
    () => ({
      appBg,
      setAppBg,
      cardTheme,
      setCardTheme,
      fontFamily,
      setFontFamily,
      textScale,
      setTextScale,
      engineBg,
      setEngineBg,
    }),
    [appBg, setAppBg, cardTheme, setCardTheme, fontFamily, setFontFamily, textScale, setTextScale, engineBg, setEngineBg]
  );

  return (
    <TerminalThemeContext.Provider value={value}>
      {children}
    </TerminalThemeContext.Provider>
  );
}

export function useTerminalTheme() {
  return useContext(TerminalThemeContext);
}
