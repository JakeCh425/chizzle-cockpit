import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rollingEMA, computeEMAs, is10EmaMomentumSetup } from "@/lib/sma";
import { DEFAULT_SPARK_SMA_COLORS, computeEMA } from "@/components/swing/TradingCard";
import fs from "fs";
import path from "path";

describe("Practice Sandbox Mode & 10-EMA Momentum Setup Engine", () => {
  describe("10-EMA Mathematical Formula & Momentum Detector", () => {
    it("computes 10-period EMA with correct multiplier 2 / (10 + 1) = 2/11", () => {
      // 10 initial prices, then an 11th price
      const closes = [100, 102, 101, 103, 102, 104, 103, 105, 104, 106, 110];
      const ema = rollingEMA(closes, 10);
      expect(ema.length).toBe(closes.length);
      // First 9 items must be null
      for (let i = 0; i < 9; i++) {
        expect(ema[i]).toBeNull();
      }
      // 10th item (index 9) is the SMA of first 10 items
      const sum10 = closes.slice(0, 10).reduce((a, b) => a + b, 0);
      const sma10 = sum10 / 10;
      expect(ema[9]).toBeCloseTo(sma10, 4);

      // 11th item (index 10) = (110 - ema[9]) * (2 / 11) + ema[9]
      const multiplier = 2 / 11;
      const expectedEma11 = (110 - sma10) * multiplier + sma10;
      expect(ema[10]).toBeCloseTo(expectedEma11, 4);
    });

    it("computeEMAs returns ema10 and ema20 series", () => {
      const closes = new Array(25).fill(0).map((_, i) => 100 + i * 2);
      const res = computeEMAs(closes);
      expect(res.ema10).toBeDefined();
      expect(res.ema20).toBeDefined();
      expect(res.ema10[9]).not.toBeNull();
      expect(res.ema20[19]).not.toBeNull();
    });

    it("TradingCard computeEMA generates timestamped line series data", () => {
      const bars = [
        { t: 1000, c: 100 },
        { t: 2000, c: 102 },
        { t: 3000, c: 101 },
        { t: 4000, c: 103 },
        { t: 5000, c: 102 },
        { t: 6000, c: 104 },
        { t: 7000, c: 103 },
        { t: 8000, c: 105 },
        { t: 9000, c: 104 },
        { t: 10000, c: 106 },
        { t: 11000, c: 108 },
      ];
      const result = computeEMA(bars, 10);
      expect(result.length).toBe(2);
      expect(result[0].time).toBe(10000);
      expect(result[1].time).toBe(11000);
      expect(result[0].value).toBeGreaterThan(100);
    });

    it("detects 10-EMA momentum setup when runaway trend pullback touches and holds 10-EMA and closes green", () => {
      // 20 bars in an uptrend, with bar 20 closing >= 1.5% above 20-SMA, touching 10-EMA and closing green
      const closes = [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
        110, 111, 112, 113, 114, 115, 116, 117, 118, 120
      ];
      const ema = rollingEMA(closes, 10);
      const emaAt19 = ema[19]!;
      const lows = closes.map((c) => c - 1);
      lows[19] = emaAt19; // touches 10-EMA
      const opens = closes.map((c) => c - 0.5);
      opens[19] = emaAt19 + 1; // close (120) >= open (emaAt19 + 1) -> green

      const isSetup = is10EmaMomentumSetup(closes, undefined, lows, opens);
      expect(isSetup).toBe(true);
    });

    it("rejects 10-EMA setup if price is not at least 1.5% above 20-SMA", () => {
      // Flat prices around 100
      const closes = new Array(25).fill(100);
      const isSetup = is10EmaMomentumSetup(closes);
      expect(isSetup).toBe(false);
    });

    it("styles 10-EMA in charts as thin bright white/silver line #E2E8F0", () => {
      expect(DEFAULT_SPARK_SMA_COLORS.ema10).toBe("#E2E8F0");
    });
  });

  describe("Practice Sandbox Mode UI & Isolated Storage Contract", () => {
    it("contains Practice Mode toggle with data-testid='button-toggle-practice-mode'", () => {
      const dashSrc = fs.readFileSync(path.join(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx"), "utf8");
      expect(dashSrc).toContain('data-testid="button-toggle-practice-mode"');
      expect(dashSrc).toContain("[ 🧪 PRACTICE MODE: ON ]");
      expect(dashSrc).toContain("[ 🧪 PRACTICE MODE: OFF ]");

      const acSrc = fs.readFileSync(path.join(__dirname, "../../client/src/components/swing/ActionCenter.tsx"), "utf8");
      expect(acSrc).toContain('data-testid="button-toggle-practice-mode"');
      expect(acSrc).toContain("[ 🧪 PRACTICE MODE: ON ]");
      expect(acSrc).toContain("[ 🧪 PRACTICE MODE: OFF ]");
    });

    it("isolates practice trades in chizzle-practice-trades without executing live backend trades", () => {
      const gsSrc = fs.readFileSync(path.join(__dirname, "../../client/src/lib/globalState.tsx"), "utf8");
      expect(gsSrc).toContain('const STORAGE_KEY_PRACTICE_MODE = "chizzle-practice-mode"');
      expect(gsSrc).toContain('const STORAGE_KEY_PRACTICE_TRADES = "chizzle-practice-trades"');
      expect(gsSrc).toContain("logPracticeTrade");
      expect(gsSrc).toContain("clearPracticeTrades");
    });

    it("TradingCard changes Arm button to [ LOG PRACTICE TRADE ] and disables Fidelity Ticket in Practice Mode", () => {
      const tcSrc = fs.readFileSync(path.join(__dirname, "../../client/src/components/swing/TradingCard.tsx"), "utf8");
      expect(tcSrc).toContain("[ LOG PRACTICE TRADE ]");
      expect(tcSrc).toContain("[ FIDELITY TICKET DISABLED IN PRACTICE MODE ]");
      expect(tcSrc).toContain('data-testid="badge-momentum-10ema"');
      expect(tcSrc).toContain("[ MOMENTUM SETUP: 10-EMA ]");
    });

    it("ActionCenter Active Execution Zone applies amber styling and relaxes system gates in Practice Mode", () => {
      const acSrc = fs.readFileSync(path.join(__dirname, "../../client/src/components/swing/ActionCenter.tsx"), "utf8");
      expect(acSrc).toContain("border-amber-500 bg-amber-950/40");
      expect(acSrc).toContain("[ 🧪 LOG PRACTICE TRADE ]");
      expect(acSrc).toContain("🧪 PRACTICE TRADE SETUP READY — SANDBOX MODE");
      expect(acSrc).toContain("global?.isPracticeMode");
    });
  });
});
