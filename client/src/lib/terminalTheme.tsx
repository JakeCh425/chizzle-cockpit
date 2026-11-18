import React, { createContext, useContext, useState, useEffect, useMemo } from "react";

export type AppBgId =
  | "bg-obsidian"
  | "bg-matrix"
  | "bg-quantum"
  | "bg-void"
  | "bg-slate"
  | "bg-emerald"
  | "bg-hologram"
  | "bg-crimson"
  | "bg-neon-grid";

export interface AppBgOption {
  id: AppBgId;
  label: string;
  classes: string;
}

export const APP_BACKGROUNDS: readonly AppBgOption[] = [
  {
    id: "bg-obsidian",
    label: "Cyber Obsidian",
    classes:
      "bg-[#050505] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))]",
  },
  {
    id: "bg-matrix",
    label: "Midnight Matrix",
    classes:
      "bg-[#0B1220] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]",
  },
  {
    id: "bg-quantum",
    label: "Quantum Navy",
    classes:
      "bg-slate-950 bg-[radial-gradient(ellipse_60%_60%_at_50%_0%,#1e3a8a_0,transparent_100%)]",
  },
  {
    id: "bg-void",
    label: "Deep Space Void",
    classes: "bg-black",
  },
  {
    id: "bg-slate",
    label: "Terminal Slate",
    classes: "bg-[#1e1e1e]",
  },
  {
    id: "bg-emerald",
    label: "Emerald Eclipse",
    classes:
      "bg-[#020617] bg-[radial-gradient(ellipse_40%_40%_at_50%_0%,rgba(6,78,59,0.3),transparent_100%)]",
  },
  {
    id: "bg-hologram",
    label: "Hologram Glass",
    classes: "bg-[#082f49] bg-gradient-to-br from-slate-950 to-cyan-950",
  },
  {
    id: "bg-crimson",
    label: "Crimson Shadow",
    classes:
      "bg-[#0B1220] bg-[radial-gradient(circle_at_center,rgba(153,27,27,0.1)_0,transparent_100%)]",
  },
  {
    id: "bg-neon-grid",
    label: "Neon Grid",
    classes:
      "bg-black bg-[linear-gradient(to_right,#4f4f4f2e_1px,transparent_1px),linear-gradient(to_bottom,#4f4f4f2e_1px,transparent_1px)] bg-[size:32px_32px]",
  },
] as const;

export type CardSurfaceId = "solid" | "glass" | "oled" | "neon";

export interface CardSurfaceOption {
  id: CardSurfaceId;
  label: string;
  classes: string;
}

export const CARD_SURFACES: readonly CardSurfaceOption[] = [
  {
    id: "solid",
    label: "Solid (Default)",
    classes: "bg-[#151E2E] border border-slate-800",
  },
  {
    id: "glass",
    label: "Glassmorphism",
    classes: "bg-slate-900/40 backdrop-blur-md border border-slate-700/50",
  },
  {
    id: "oled",
    label: "High-Contrast OLED",
    classes: "bg-black border border-slate-700",
  },
  {
    id: "neon",
    label: "Neon Outline",
    classes:
      "bg-[#0B1220] border border-cyan-900 shadow-[0_0_15px_rgba(8,145,178,0.1)]",
  },
] as const;

export type FontFamilyOption = "Inter" | "Roboto" | "Arial" | "Segoe UI";

export const FONT_FAMILY_CSS: Record<FontFamilyOption, string> = {
  Inter: "'Inter', system-ui, -apple-system, sans-serif",
  Roboto: "'Roboto', system-ui, -apple-system, sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  "Segoe UI": "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
};

export type TextScaleOption = "compact" | "standard" | "large";

export const TEXT_SCALE_CLASSES: Record<TextScaleOption, string> = {
  compact: "text-sm",
  standard: "text-base",
  large: "text-lg",
};

interface TerminalThemeContextValue {
  appBg: AppBgId;
  setAppBg: (bg: AppBgId) => void;
  appBgClasses: string;
  cardTheme: CardSurfaceId;
  setCardTheme: (t: CardSurfaceId) => void;
  cardThemeClasses: string;
  fontFamily: FontFamilyOption;
  setFontFamily: (f: FontFamilyOption) => void;
  fontFamilyCss: string;
  textScale: TextScaleOption;
  setTextScale: (s: TextScaleOption) => void;
  textScaleClass: string;
}

const DEFAULT_VALUE: TerminalThemeContextValue = {
  appBg: "bg-obsidian",
  setAppBg: () => {},
  appBgClasses: APP_BACKGROUNDS[0].classes,
  cardTheme: "solid",
  setCardTheme: () => {},
  cardThemeClasses: CARD_SURFACES[0].classes,
  fontFamily: "Inter",
  setFontFamily: () => {},
  fontFamilyCss: FONT_FAMILY_CSS.Inter,
  textScale: "standard",
  setTextScale: () => {},
  textScaleClass: TEXT_SCALE_CLASSES.standard,
};

const TerminalThemeContext = createContext<TerminalThemeContextValue>(DEFAULT_VALUE);

function readStorage<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = window.localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

export function TerminalThemeProvider({ children }: { children: React.ReactNode }) {
  const [appBg, setAppBg] = useState<AppBgId>(() => readStorage("chizzle.terminal.appBg", "bg-obsidian"));
  const [cardTheme, setCardTheme] = useState<CardSurfaceId>(() => readStorage("chizzle.terminal.cardTheme", "solid"));
  const [fontFamily, setFontFamily] = useState<FontFamilyOption>(() => readStorage("chizzle.terminal.fontFamily", "Inter"));
  const [textScale, setTextScale] = useState<TextScaleOption>(() => readStorage("chizzle.terminal.textScale", "standard"));

  useEffect(() => {
    try {
      window.localStorage.setItem("chizzle.terminal.appBg", appBg);
    } catch {}
  }, [appBg]);

  useEffect(() => {
    try {
      window.localStorage.setItem("chizzle.terminal.cardTheme", cardTheme);
    } catch {}
  }, [cardTheme]);

  useEffect(() => {
    try {
      window.localStorage.setItem("chizzle.terminal.fontFamily", fontFamily);
    } catch {}
  }, [fontFamily]);

  useEffect(() => {
    try {
      window.localStorage.setItem("chizzle.terminal.textScale", textScale);
    } catch {}
  }, [textScale]);

  const value = useMemo<TerminalThemeContextValue>(() => {
    const bgObj = APP_BACKGROUNDS.find((b) => b.id === appBg) ?? APP_BACKGROUNDS[0];
    const cardObj = CARD_SURFACES.find((c) => c.id === cardTheme) ?? CARD_SURFACES[0];
    const fontCss = FONT_FAMILY_CSS[fontFamily] ?? FONT_FAMILY_CSS.Inter;
    const scaleCls = TEXT_SCALE_CLASSES[textScale] ?? TEXT_SCALE_CLASSES.standard;
    return {
      appBg,
      setAppBg,
      appBgClasses: bgObj.classes,
      cardTheme,
      setCardTheme,
      cardThemeClasses: cardObj.classes,
      fontFamily,
      setFontFamily,
      fontFamilyCss: fontCss,
      textScale,
      setTextScale,
      textScaleClass: scaleCls,
    };
  }, [appBg, cardTheme, fontFamily, textScale]);

  return (
    <TerminalThemeContext.Provider value={value}>
      {children}
    </TerminalThemeContext.Provider>
  );
}

export function useTerminalTheme() {
  return useContext(TerminalThemeContext);
}
