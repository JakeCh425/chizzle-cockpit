process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import fs from "fs";
import path from "path";

// In Node test environment, mock localStorage and window if not present
const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, val: string) => storageMap.set(key, String(val)),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
  get length() {
    return storageMap.size;
  },
  key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
};

if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = mockLocalStorage;
}
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import {
  CARD_THEMES,
  CARD_THEME_STORAGE_KEY,
  DEFAULT_CARD_THEME,
  cardThemeStore,
  type CardThemePreset,
} from "../../client/src/lib/cardTheme";
import { marketDataStore } from "../../client/src/lib/useMarketDataStore";

const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const switcherPath = path.resolve(__dirname, "../../client/src/components/swing/CardThemeSwitcher.tsx");
const smaPanelPath = path.resolve(__dirname, "../../client/src/components/swing/MechanicalSMAPanel.tsx");

describe("Card Color Preset Switcher & High-Contrast Button Refactor", () => {
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const switcherSrc = fs.readFileSync(switcherPath, "utf-8").replace(/\r\n/g, "\n");
  const smaPanelSrc = fs.readFileSync(smaPanelPath, "utf-8").replace(/\r\n/g, "\n");

  beforeEach(() => {
    storageMap.clear();
    cardThemeStore.setTheme(DEFAULT_CARD_THEME);
  });

  describe("1. Card Theme Presets & Definitions", () => {
    it("defines the exact required card themes", () => {
      const themes = Object.keys(CARD_THEMES);
      expect(themes).toContain("emerald-edge");
      expect(themes).toContain("high-contrast-slate");
      expect(themes).toContain("cyber-amber");
      expect(themes).toContain("classic-bloomberg");
      expect(DEFAULT_CARD_THEME).toBe("emerald-edge");
    });

    it("Emerald Edge (Default) has high-visibility emerald borders and headers", () => {
      const cfg = CARD_THEMES["emerald-edge"];
      expect(cfg.cardBorder).toContain("border-emerald-500/60");
      expect(cfg.headerText).toContain("text-emerald-400");
      expect(cfg.primaryButton).toContain("bg-emerald-600");
      expect(cfg.primaryButton).toContain("text-black");
      expect(cfg.primaryButton).toContain("font-bold");
      expect(cfg.chipLabel).toBe("Emerald");
      expect(cfg.chipEmoji).toBe("🟢");
    });

    it("High-Contrast Slate has crisp slate-300 borders and slate-900 background", () => {
      const cfg = CARD_THEMES["high-contrast-slate"];
      expect(cfg.cardBorder).toContain("border-slate-300");
      expect(cfg.cardBg).toContain("bg-slate-900");
      expect(cfg.headerText).toContain("text-slate-100");
      expect(cfg.primaryButton).toContain("bg-white");
      expect(cfg.primaryButton).toContain("text-black");
      expect(cfg.primaryButton).toContain("font-black");
      expect(cfg.chipLabel).toBe("Slate");
      expect(cfg.chipEmoji).toBe("⚪");
    });

    it("Cyber Amber has amber borders and high-energy accents", () => {
      const cfg = CARD_THEMES["cyber-amber"];
      expect(cfg.cardBorder).toContain("border-amber-400/80");
      expect(cfg.headerText).toContain("text-amber-300");
      expect(cfg.primaryButton).toContain("bg-amber-400");
      expect(cfg.primaryButton).toContain("text-black");
      expect(cfg.primaryButton).toContain("font-extrabold");
      expect(cfg.chipLabel).toBe("Amber");
      expect(cfg.chipEmoji).toBe("🟡");
    });

    it("Classic Bloomberg has orange-500 borders and monospace emphasis", () => {
      const cfg = CARD_THEMES["classic-bloomberg"];
      expect(cfg.cardBorder).toContain("border-orange-500");
      expect(cfg.headerText).toContain("text-orange-400");
      expect(cfg.primaryButton).toContain("bg-orange-500");
      expect(cfg.primaryButton).toContain("text-black");
      expect(cfg.fontClass).toContain("font-mono");
      expect(cfg.chipLabel).toBe("Bloomberg");
      expect(cfg.chipEmoji).toBe("🟠");
    });
  });

  describe("2. State Management & localStorage Persistence", () => {
    it("persists theme preference to localStorage under 'chizzle_card_theme_pref'", () => {
      expect(CARD_THEME_STORAGE_KEY).toBe("chizzle_card_theme_pref");

      cardThemeStore.setTheme("cyber-amber");
      expect(cardThemeStore.getTheme()).toBe("cyber-amber");
      expect(storageMap.get("chizzle_card_theme_pref")).toBe("cyber-amber");

      cardThemeStore.setTheme("high-contrast-slate");
      expect(cardThemeStore.getTheme()).toBe("high-contrast-slate");
      expect(storageMap.get("chizzle_card_theme_pref")).toBe("high-contrast-slate");
    });

    it("notifies subscribers synchronously on theme change", () => {
      let notifiedTheme: CardThemePreset | null = null;
      const unsubscribe = cardThemeStore.subscribe(() => {
        notifiedTheme = cardThemeStore.getTheme();
      });

      cardThemeStore.setTheme("classic-bloomberg");
      expect(notifiedTheme).toBe("classic-bloomberg");

      unsubscribe();
      cardThemeStore.setTheme("emerald-edge");
      expect(notifiedTheme).toBe("classic-bloomberg"); // Not updated after unsubscribe
    });

    it("syncs with marketDataStore slice", () => {
      marketDataStore.setCardTheme("high-contrast-slate");
      expect(marketDataStore.getCardTheme()).toBe("high-contrast-slate");
      expect(marketDataStore.getState().cardTheme).toBe("high-contrast-slate");
      expect(storageMap.get("chizzle_card_theme_pref")).toBe("high-contrast-slate");
    });
  });

  describe("3. UI Component Integration: CardThemeSwitcher & ActionCenter Toolbar", () => {
    it("renders CardThemeSwitcher with all 4 preset chips", () => {
      expect(switcherSrc).toContain('data-testid="card-theme-switcher"');
      expect(switcherSrc).toContain('data-testid={`card-theme-${key}`}');
      expect(switcherSrc).toContain("useCardTheme");
      expect(switcherSrc).toContain("CARD_THEMES");
    });

    it("mounts CardThemeSwitcher directly inside cockpit grid toolbar alongside grid size toggle", () => {
      expect(actionCenterSrc).toContain("import { CardThemeSwitcher } from \"./CardThemeSwitcher\"");
      expect(actionCenterSrc).toContain("<CardThemeSwitcher />");
      expect(actionCenterSrc).toContain('data-testid="cockpit-grid-toolbar"');
      expect(actionCenterSrc).toContain('data-testid="grid-size-toggle"');
    });

    it("applies cardThemeCfg to InlineTradingCard and CompactCard", () => {
      expect(tradingCardSrc).toContain("const { config: cardThemeCfg } = useCardTheme();");
      expect(tradingCardSrc).toContain("${cardThemeCfg.cardBg}");
      expect(tradingCardSrc).toContain("${cardThemeCfg.fontClass}");
      expect(tradingCardSrc).toContain("${cardThemeCfg.headerText}");
      expect(tradingCardSrc).toContain("cardThemeCfg.primaryButton");
    });

    it("applies cardThemeCfg to MechanicalSMAPanel", () => {
      expect(smaPanelSrc).toContain("const { config: cardThemeCfg } = useCardTheme();");
      expect(smaPanelSrc).toContain("cardThemeCfg.cardBorder");
      expect(smaPanelSrc).toContain("cardThemeCfg.headerText");
    });
  });

  describe("4. High-Contrast WCAG AA Badges and Action Buttons", () => {
    it("verifies ceiling/standby and floor/support color styling in MechanicalSMAPanel", () => {
      expect(smaPanelSrc).toContain("bg-emerald-950/80 text-emerald-300 border-emerald-500/70");
      expect(smaPanelSrc).toContain("bg-rose-950/80 text-rose-300 border-rose-500/70");
    });

    it("verifies interactive action buttons use solid high-contrast backgrounds", () => {
      // Adjust Plan button has solid bg-gray-100 text-gray-950 hover:bg-white
      expect(tradingCardSrc).toContain("bg-gray-100 text-gray-950 hover:bg-white border border-gray-300");
      // Expand Details button has solid bg-slate-100 hover:bg-white text-slate-900
      expect(tradingCardSrc).toContain("border-slate-300 bg-slate-100 hover:bg-white");
      // Open Card button has solid high-contrast styling
      expect(tradingCardSrc).toContain("border-slate-300 bg-slate-100 hover:bg-white px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-900");
    });
  });
});
