// ─── Card Theme Presets & Persistence (Independent from Global Theme) ────────
// Presets: 'emerald-edge' | 'high-contrast-slate' | 'cyber-amber' | 'classic-bloomberg'
// Persisted in localStorage key: 'chizzle_card_theme_pref'

import { useEffect, useState, useSyncExternalStore } from "react";

export type CardThemePreset =
  | "emerald-edge"
  | "high-contrast-slate"
  | "cyber-amber"
  | "classic-bloomberg";

export const CARD_THEME_STORAGE_KEY = "chizzle_card_theme_pref";
export const DEFAULT_CARD_THEME: CardThemePreset = "emerald-edge";

export interface CardThemeConfig {
  id: CardThemePreset;
  name: string;
  chipLabel: string;
  chipEmoji: string;
  chipBorder: string;
  cardBorder: string;
  cardBg: string;
  headerText: string;
  bodyText: string;
  primaryButton: string;
  secondaryButton: string;
  fontClass: string;
}

export const CARD_THEMES: Record<CardThemePreset, CardThemeConfig> = {
  "emerald-edge": {
    id: "emerald-edge",
    name: "Emerald Edge",
    chipLabel: "Emerald",
    chipEmoji: "🟢",
    chipBorder: "border-emerald-500",
    cardBorder: "border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.18)] ring-1 ring-emerald-500/30",
    cardBg: "bg-[#0B0E14]",
    headerText: "text-emerald-400",
    bodyText: "text-gray-100",
    primaryButton: "bg-emerald-600 text-black font-bold hover:bg-emerald-400 shadow-md",
    secondaryButton: "bg-gray-100 text-gray-900 font-bold hover:bg-white border border-gray-300",
    fontClass: "font-sans",
  },
  "high-contrast-slate": {
    id: "high-contrast-slate",
    name: "High-Contrast Slate",
    chipLabel: "Slate",
    chipEmoji: "⚪",
    chipBorder: "border-slate-300",
    cardBorder: "border-slate-300 shadow-[0_0_15px_rgba(255,255,255,0.12)] ring-1 ring-slate-300/40",
    cardBg: "bg-slate-900",
    headerText: "text-slate-100",
    bodyText: "text-slate-100",
    primaryButton: "bg-white text-black font-black hover:bg-slate-200 shadow-md",
    secondaryButton: "bg-slate-200 text-slate-950 font-black hover:bg-white border border-slate-300",
    fontClass: "font-sans",
  },
  "cyber-amber": {
    id: "cyber-amber",
    name: "Cyber Amber",
    chipLabel: "Amber",
    chipEmoji: "🟡",
    chipBorder: "border-amber-400",
    cardBorder: "border-amber-400/80 shadow-[0_0_18px_rgba(251,191,36,0.22)] ring-1 ring-amber-400/50",
    cardBg: "bg-[#120E06]",
    headerText: "text-amber-300",
    bodyText: "text-amber-100",
    primaryButton: "bg-amber-400 text-black font-extrabold hover:bg-amber-300 shadow-md",
    secondaryButton: "bg-gray-100 text-gray-900 font-bold hover:bg-white border border-amber-300/40",
    fontClass: "font-sans",
  },
  "classic-bloomberg": {
    id: "classic-bloomberg",
    name: "Classic Bloomberg",
    chipLabel: "Bloomberg",
    chipEmoji: "🟠",
    chipBorder: "border-orange-500",
    cardBorder: "border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.25)] ring-1 ring-orange-500/50",
    cardBg: "bg-[#000000]",
    headerText: "text-orange-400",
    bodyText: "text-orange-200",
    primaryButton: "bg-orange-500 text-black font-bold hover:bg-orange-400 shadow-md",
    secondaryButton: "bg-gray-100 text-gray-900 font-bold hover:bg-white border border-orange-500/50",
    fontClass: "font-mono",
  },
};

function readStoredCardTheme(): CardThemePreset {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_CARD_THEME;
  }
  try {
    const raw = window.localStorage.getItem(CARD_THEME_STORAGE_KEY) as CardThemePreset;
    if (raw && CARD_THEMES[raw]) {
      return raw;
    }
  } catch {
    // Ignore storage errors
  }
  return DEFAULT_CARD_THEME;
}

// ── Event-Driven Reactive Singleton Store ──
class CardThemeStore {
  private current: CardThemePreset = DEFAULT_CARD_THEME;
  private listeners = new Set<() => void>();

  constructor() {
    this.current = readStoredCardTheme();
  }

  public getTheme(): CardThemePreset {
    return this.current;
  }

  public getConfig(): CardThemeConfig {
    return CARD_THEMES[this.current] || CARD_THEMES[DEFAULT_CARD_THEME];
  }

  public setTheme(theme: CardThemePreset): void {
    if (!CARD_THEMES[theme] || this.current === theme) return;
    this.current = theme;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(CARD_THEME_STORAGE_KEY, theme);
        window.dispatchEvent(
          new CustomEvent("chizzle:card-theme-change", { detail: { theme } })
        );
      }
    } catch {}
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch (err) {
        console.error("[CardThemeStore] Listener error:", err);
      }
    }
  }
}

export const cardThemeStore = new CardThemeStore();

/**
 * React hook to consume and update Card Theme across cards without full-page re-renders
 */
export function useCardTheme() {
  const currentTheme = useSyncExternalStore(
    (onStoreChange) => cardThemeStore.subscribe(onStoreChange),
    () => cardThemeStore.getTheme(),
    () => DEFAULT_CARD_THEME
  );

  return {
    theme: currentTheme,
    config: CARD_THEMES[currentTheme] || CARD_THEMES[DEFAULT_CARD_THEME],
    setCardTheme: (next: CardThemePreset) => cardThemeStore.setTheme(next),
    availableThemes: (Object.keys(CARD_THEMES) as CardThemePreset[]).map(
      (k) => CARD_THEMES[k]
    ),
  };
}
