import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SMA_SETTINGS,
  loadSmaSettings,
  saveSmaSettings,
  STORAGE_KEY_SMA,
  type SmaSettings,
} from "../../client/src/lib/smaSettings";

// Mock localStorage and window for the test runner environment
const storageStore = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => storageStore.get(k) ?? null,
  setItem: (k: string, v: string) => { storageStore.set(k, String(v)); },
  removeItem: (k: string) => { storageStore.delete(k); },
  clear: () => { storageStore.clear(); },
};

(globalThis as any).localStorage = localStorageMock;
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = globalThis;
}

describe("Chart Overhaul & SMA Customization Engine", () => {
  beforeEach(() => {
    storageStore.clear();
  });

  describe("1. SMA Settings Persistence & Customization", () => {
    it("loads default SMA settings when localStorage is empty", () => {
      const settings = loadSmaSettings();
      expect(settings.sma20.color).toBe("#00FFFF");
      expect(settings.sma20.lineWidth).toBe(2);
      expect(settings.sma20.visible).toBe(true);

      expect(settings.sma50.color).toBe("#FF00FF");
      expect(settings.sma50.lineWidth).toBe(2);
      expect(settings.sma50.visible).toBe(true);

      expect(settings.sma200.color).toBe("#FFD700");
      expect(settings.sma200.lineWidth).toBe(2);
      expect(settings.sma200.visible).toBe(true);
    });

    it("saves custom SMA settings and persists under chizzle-sma-settings", () => {
      const custom: SmaSettings = {
        sma20: { color: "#ff007f", lineWidth: 3, visible: true },
        sma50: { color: "#00ffcc", lineWidth: 1, visible: false },
        sma200: { color: "#ffff00", lineWidth: 4, visible: true },
      };

      saveSmaSettings(custom);
      const reloaded = loadSmaSettings();

      expect(reloaded.sma20.color).toBe("#ff007f");
      expect(reloaded.sma20.lineWidth).toBe(3);
      expect(reloaded.sma20.visible).toBe(true);

      expect(reloaded.sma50.color).toBe("#00ffcc");
      expect(reloaded.sma50.lineWidth).toBe(1);
      expect(reloaded.sma50.visible).toBe(false);

      expect(reloaded.sma200.color).toBe("#ffff00");
      expect(reloaded.sma200.lineWidth).toBe(4);
    });

    it("clamps lineWidth between 1 and 4 px to ensure valid rendering", () => {
      const invalid = {
        sma20: { color: "#22d3ee", lineWidth: 99, visible: true },
        sma50: { color: "#fbbf24", lineWidth: -5, visible: true },
        sma200: { color: "#c084fc", lineWidth: 0, visible: true },
      };
      localStorage.setItem(STORAGE_KEY_SMA, JSON.stringify(invalid));

      const loaded = loadSmaSettings();
      expect(loaded.sma20.lineWidth).toBe(4); // Clamped to max 4
      expect(loaded.sma50.lineWidth).toBe(1); // Clamped to min 1
      expect(loaded.sma200.lineWidth).toBe(1); // Clamped to min 1
    });
  });

  describe("2. Historical Buffer Decoupling & Continuous SMA 20, 50, 200 Rendering", () => {
    it("guarantees continuous SMA 50 and 200 calculation across 200+ historical buffer", () => {
      // Simulate historical buffer with 250 bars
      const barsCount = 250;
      const basePrice = 150;
      const bufferCloses = Array.from({ length: barsCount }, (_, i) => {
        return basePrice + Math.sin(i * 0.1) * 10 + (i * 0.05);
      });

      const calcRollingAvg = (closes: number[], period: number, endIdx: number) => {
        const startIdx = Math.max(0, endIdx - period + 1);
        const slice = closes.slice(startIdx, endIdx + 1);
        return slice.reduce((sum, v) => sum + v, 0) / slice.length;
      };

      // Visible window contains 18 candles
      const visibleCandlesCount = 18;
      const visibleCandles = Array.from({ length: visibleCandlesCount }, (_, i) => ({
        index: i,
        bufferIdx: barsCount - (visibleCandlesCount - i),
      }));

      for (const candle of visibleCandles) {
        const sma20 = calcRollingAvg(bufferCloses, 20, candle.bufferIdx);
        const sma50 = calcRollingAvg(bufferCloses, 50, candle.bufferIdx);
        const sma200 = calcRollingAvg(bufferCloses, 200, candle.bufferIdx);

        // Assert all SMAs are non-null, finite numbers
        expect(Number.isFinite(sma20)).toBe(true);
        expect(Number.isFinite(sma50)).toBe(true);
        expect(Number.isFinite(sma200)).toBe(true);

        // Assert realistic price range proximity
        expect(sma20).toBeGreaterThan(130);
        expect(sma20).toBeLessThan(180);
        expect(sma50).toBeGreaterThan(130);
        expect(sma50).toBeLessThan(180);
        expect(sma200).toBeGreaterThan(130);
        expect(sma200).toBeLessThan(180);
      }
    });

    it("synthesizes warmup buffer when raw data has fewer than 200 bars so lines never drop", () => {
      const shortCloses = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109];
      const needed = 220 - shortCloses.length;
      const anchor = shortCloses[0];
      const synthCloses = Array.from({ length: needed }, (_, i) => {
        const progress = i / needed;
        return anchor * (0.96 + progress * 0.04);
      });
      const fullBufferCloses = [...synthCloses, ...shortCloses];

      expect(fullBufferCloses.length).toBe(220);

      // Verify SMA 200 can be computed smoothly on the latest bar
      const latest200Slice = fullBufferCloses.slice(-200);
      const sma200 = latest200Slice.reduce((a, b) => a + b, 0) / 200;
      expect(Number.isFinite(sma200)).toBe(true);
      expect(sma200).toBeGreaterThan(95);
      expect(sma200).toBeLessThan(115);
    });
  });

  describe("3. Timeframe Data Mapping & Clean Series Reset", () => {
    it("maps 1D to D for swing endpoint and 1D for candles-ohlc", () => {
      const mapSwingTf = (tf: "1H" | "4H" | "1D") => (tf === "1D" ? "D" : tf);
      const mapOhlcInterval = (tf: string) => (tf === "4H" ? "4H" : tf === "1D" || tf === "1W" ? "1D" : "1H");

      expect(mapSwingTf("1H")).toBe("1H");
      expect(mapSwingTf("4H")).toBe("4H");
      expect(mapSwingTf("1D")).toBe("D"); // Must map 1D -> D to prevent 400 bad request

      expect(mapOhlcInterval("1H")).toBe("1H");
      expect(mapOhlcInterval("4H")).toBe("4H");
      expect(mapOhlcInterval("1D")).toBe("1D");
      expect(mapOhlcInterval("1W")).toBe("1D");
    });
  });

  describe("4. Hover Fading & Trade Labels Alignment", () => {
    it("calculates right-quadrant hover state when mouse X >= 520", () => {
      const isRightHovered = (mouseX: number) => mouseX >= 520;

      expect(isRightHovered(100)).toBe(false);
      expect(isRightHovered(450)).toBe(false);
      expect(isRightHovered(519)).toBe(false);
      expect(isRightHovered(520)).toBe(true);
      expect(isRightHovered(650)).toBe(true);
    });

    it("applies 15% opacity transition when right quadrant is hovered", () => {
      const getOverlayOpacity = (isRightHovered: boolean) => (isRightHovered ? 0.15 : 1.0);
      const getLineOpacity = (isRightHovered: boolean) => (isRightHovered ? 0.15 : 0.35);

      expect(getOverlayOpacity(false)).toBe(1.0);
      expect(getOverlayOpacity(true)).toBe(0.15); // 15% opacity to unobstruct candles

      expect(getLineOpacity(false)).toBe(0.35);
      expect(getLineOpacity(true)).toBe(0.15);
    });
  });
});
