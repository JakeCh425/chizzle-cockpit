import { useSyncExternalStore } from "react";

/**
 * Single Shared Semantic Status Theme Config (`statusTheme.ts`)
 * 4-Tier Dynamic Proximity Color-Shift Engine + Blocked State + Card Typography Store.
 */

export type SetupVisualStage = "READY" | "IMMINENT" | "APPROACHING" | "FORMING" | "BLOCKED";

export interface StageThemeConfig {
  stage: SetupVisualStage;
  label: string;
  badgeClass: string;
  progressBarClass: string;
  dotClass: string;
  borderAccentClass: string;
  cardGlowClass: string;
  textClass: string;
}

export const STATUS_THEME: Record<SetupVisualStage, StageThemeConfig> = {
  READY: {
    stage: "READY",
    label: "⚡ READY TO TRADE",
    badgeClass: "bg-emerald-400 text-slate-950 font-black",
    progressBarClass: "bg-emerald-400 shadow-[0_0_10px_#00F5A0]",
    dotClass: "bg-emerald-400 shadow-[0_0_8px_#00F5A0]",
    borderAccentClass: "border-emerald-400",
    cardGlowClass: "border-l-4 border-l-emerald-400 border-emerald-400/70 shadow-[0_0_20px_rgba(0,245,160,0.15)]",
    textClass: "text-emerald-400",
  },
  IMMINENT: {
    stage: "IMMINENT",
    label: "🔥 IN ZONE • AWAIT 1H CLOSE",
    badgeClass: "bg-orange-500/20 text-orange-300 border border-orange-400 animate-pulse",
    progressBarClass: "bg-orange-500 animate-pulse shadow-[0_0_12px_rgba(255,107,0,0.6)]",
    dotClass: "bg-orange-500 animate-pulse",
    borderAccentClass: "border-orange-500",
    cardGlowClass: "border-l-4 border-l-orange-500 border-orange-500/50 shadow-[0_0_14px_rgba(255,107,0,0.15)]",
    textClass: "text-orange-300",
  },
  APPROACHING: {
    stage: "APPROACHING",
    label: "⏳ APPROACHING ENTRY",
    badgeClass: "bg-amber-500/15 text-amber-300 border border-amber-400/60",
    progressBarClass: "bg-amber-400 shadow-[0_0_10px_rgba(255,184,0,0.45)]",
    dotClass: "bg-amber-400",
    borderAccentClass: "border-amber-400",
    cardGlowClass: "border-l-4 border-l-amber-400 border-amber-400/35",
    textClass: "text-amber-300",
  },
  FORMING: {
    stage: "FORMING",
    label: "📡 FORMING PULLBACK",
    badgeClass: "bg-sky-500/15 text-sky-300 border border-sky-400/50",
    progressBarClass: "bg-sky-400",
    dotClass: "bg-sky-400",
    borderAccentClass: "border-sky-400",
    cardGlowClass: "border-l-4 border-l-sky-400/70 border-slate-800/90",
    textClass: "text-sky-300",
  },
  BLOCKED: {
    stage: "BLOCKED",
    label: "🔒 MACRO STAND-DOWN",
    badgeClass: "bg-rose-500/15 text-rose-300 border border-rose-500/50",
    progressBarClass: "bg-rose-500",
    dotClass: "bg-rose-500",
    borderAccentClass: "border-rose-500",
    cardGlowClass: "border-l-4 border-l-rose-500/80 border-rose-500/30",
    textClass: "text-rose-300",
  },
};

export const PRICE_COLOR_CLASSES = {
  entry: "text-cyan-300 font-mono font-bold",
  stop: "text-rose-400 font-mono",
  profitActive: "text-emerald-400/90 font-mono",
  profitDeepStandby: "text-slate-400 font-mono",
} as const;

// ─── Card Typography Store (localStorage: chizzle_card_typography) ───────────
export type CardFontSize = "compact" | "standard" | "large";
export type CardFontFamily = "jetbrains" | "geometric" | "bloomberg";

export interface CardTypographySettings {
  size: CardFontSize;
  family: CardFontFamily;
}

const CARD_TYPOGRAPHY_KEY = "chizzle_card_typography";
const DEFAULT_CARD_TYPOGRAPHY: CardTypographySettings = {
  size: "standard",
  family: "jetbrains",
};

const FONT_CSS_MAP: Record<CardFontFamily, { sans: string; mono: string }> = {
  jetbrains: {
    sans: "'Inter', system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace",
  },
  geometric: {
    sans: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
    mono: "'Inter', system-ui, sans-serif",
  },
  bloomberg: {
    sans: "'Roboto Condensed', 'Arial Narrow', Arial, sans-serif",
    mono: "'IBM Plex Mono', 'Consolas', 'Courier New', monospace",
  },
};

function applyTypographyCssVars(settings: CardTypographySettings): void {
  if (typeof document === "undefined") return;
  const fonts = FONT_CSS_MAP[settings.family] ?? FONT_CSS_MAP.jetbrains;
  document.documentElement.style.setProperty("--card-font-sans", fonts.sans);
  document.documentElement.style.setProperty("--card-font-mono", fonts.mono);
}

function loadCardTypography(): CardTypographySettings {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return DEFAULT_CARD_TYPOGRAPHY;
  }
  try {
    const raw = localStorage.getItem(CARD_TYPOGRAPHY_KEY);
    if (!raw) return DEFAULT_CARD_TYPOGRAPHY;
    const parsed = JSON.parse(raw);
    const size: CardFontSize =
      parsed?.size === "compact" || parsed?.size === "large" ? parsed.size : "standard";
    const family: CardFontFamily =
      parsed?.family === "geometric" || parsed?.family === "bloomberg" ? parsed.family : "jetbrains";
    return { size, family };
  } catch {
    return DEFAULT_CARD_TYPOGRAPHY;
  }
}

let currentTypography: CardTypographySettings = loadCardTypography();
applyTypographyCssVars(currentTypography);
const typographyListeners = new Set<() => void>();

export function updateCardTypography(patch: Partial<CardTypographySettings>): void {
  currentTypography = { ...currentTypography, ...patch };
  applyTypographyCssVars(currentTypography);
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CARD_TYPOGRAPHY_KEY, JSON.stringify(currentTypography));
    } catch {}
  }
  typographyListeners.forEach((l) => l());
}

export function useCardTypography(): CardTypographySettings & {
  priceClass: string;
  labelClass: string;
  tickerClass: string;
  fontStyle: { fontFamily: string };
} {
  const settings = useSyncExternalStore(
    (cb) => {
      typographyListeners.add(cb);
      return () => typographyListeners.delete(cb);
    },
    () => currentTypography,
    () => DEFAULT_CARD_TYPOGRAPHY
  );

  const priceClass =
    settings.size === "compact"
      ? "text-lg"
      : settings.size === "large"
      ? "text-2xl"
      : "text-xl";
  const labelClass = settings.size === "large" ? "text-sm" : "text-xs";
  const tickerClass = settings.size === "large" ? "text-3xl" : "text-2xl";

  return {
    ...settings,
    priceClass,
    labelClass,
    tickerClass,
    fontStyle: { fontFamily: "var(--card-font-mono, ui-monospace, monospace)" },
  };
}
