import { describe, it, expect } from "vitest";
import { is10SmaMomentumSetup, rollingSMA, computeSMAs } from "@/lib/sma";
import { DEFAULT_SMA_SETTINGS, loadSmaSettings, saveSmaSettings, type SmaSettings } from "@/lib/smaSettings";
import { DEFAULT_SPARK_SMA_COLORS } from "@/components/swing/TradingCard";
import fs from "fs";
import path from "path";

const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
const popoverPath = path.resolve(__dirname, "../../client/src/components/SmaSettingsPopover.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const aiTipsOverlayPath = path.resolve(__dirname, "../../client/src/components/AITipsOverlay.tsx");
const scannerHookPath = path.resolve(__dirname, "../../client/src/hooks/useSetupScanner.ts");

describe("Feature Addition - SMA 10 Integration, Momentum Logic, & AI Tips Sync", () => {
  const swingChartSrc = fs.readFileSync(swingChartPath, "utf-8");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8");
  const popoverSrc = fs.readFileSync(popoverPath, "utf-8");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8");
  const aiTipsOverlaySrc = fs.readFileSync(aiTipsOverlayPath, "utf-8");
  const scannerHookSrc = fs.readFileSync(scannerHookPath, "utf-8");

  describe("1. Integrate SMA 10 into the Chart Module", () => {
    it("computes 10-period rolling SMA in computeSMAs", () => {
      const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
      const smas = computeSMAs(closes);
      expect(smas.sma10).toBeDefined();
      expect(smas.sma10[8]).toBeNull();
      // First 10 items avg: (10..19)/10 = 14.5
      expect(smas.sma10[9]).toBeCloseTo(14.5, 4);
      // 11th item avg: (11..20)/10 = 15.5
      expect(smas.sma10[10]).toBeCloseTo(15.5, 4);
    });

    it("calculates and plots 10-period SMA in MiniChart and Multi-Timeframe Learning Chart", () => {
      expect(tradingCardSrc).toContain("export const MiniChart = SparklineChart;");
      expect(tradingCardSrc).toContain("computeSMA([...(barsData?.warmupBars || []), ...bars], 10)");
      expect(tradingCardSrc).toContain("DEFAULT_SPARK_SMA_COLORS");
      expect(DEFAULT_SPARK_SMA_COLORS.sma10).toBe("#FFFFFF");

      expect(swingChartSrc).toContain('key: "sma10" as const, n: 10, label: "SMA 10"');
      expect(swingChartSrc).toContain('sma10: "SMA 10"');
      expect(swingChartSrc).toContain('sma10: "#FFFFFF"');
    });

    it("renders toggle button [ - SMA 10 ] on indicator toolbar", () => {
      expect(swingChartSrc).toContain('data-testid={`toggle-overlay-${k}`}');
      expect(swingChartSrc).toContain('isSma && <span className="inline-block w-2.5 h-0.5 rounded-full transition-colors"');
      expect(swingChartSrc).toContain('OVERLAY_LABEL[k]');
      expect(swingChartSrc).toContain('sma10: "SMA 10"');
    });

    it("allows customizing color and lineWidth of SMA 10 in SmaSettingsPopover", () => {
      expect(popoverSrc).toContain('data-testid="sma-toggle-10"');
      expect(popoverSrc).toContain('data-testid="sma-color-10"');
      expect(popoverSrc).toContain('data-testid="sma-width-10"');
      expect(popoverSrc).toContain("10-SMA (Momentum)");

      expect(DEFAULT_SMA_SETTINGS.sma10).toBeDefined();
      expect(DEFAULT_SMA_SETTINGS.sma10.color).toBe("#FFFFFF");
      expect(DEFAULT_SMA_SETTINGS.sma10.lineWidth).toBe(1);
      expect(DEFAULT_SMA_SETTINGS.sma10.visible).toBe(true);
    });
  });

  describe("2. Scanner & Action Center Logic (Momentum Trigger: Price > 3% above 20-SMA)", () => {
    it("detects 10-SMA momentum setup when price > 3% above 20-SMA, touches 10-SMA, and closes green", () => {
      // 20 ascending prices, with final bar > 3% above 20-SMA
      const closes = [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
        110, 111, 112, 113, 114, 115, 116, 117, 118, 125
      ];
      const sma10 = rollingSMA(closes, 10);
      const sma10Val = sma10[19]!;
      const lows = closes.map((c) => c - 0.5);
      lows[19] = sma10Val; // touches 10-SMA
      const opens = closes.map((c) => c - 0.2);
      opens[19] = sma10Val + 0.5; // close (125) >= open (sma10Val + 0.5) -> green

      const isSetup = is10SmaMomentumSetup(closes, undefined, lows, opens);
      expect(isSetup).toBe(true);
    });

    it("rejects 10-SMA momentum setup if price is not > 3% above 20-SMA", () => {
      // Flat prices around 100
      const closes = new Array(25).fill(100);
      const isSetup = is10SmaMomentumSetup(closes);
      expect(isSetup).toBe(false);
    });

    it("renders [ MOMENTUM SETUP: 10-SMA ] badge on Setup Card and Action Center", () => {
      expect(tradingCardSrc).toContain('data-testid="badge-momentum-10sma"');
      expect(tradingCardSrc).toContain("[ MOMENTUM SETUP: 10-SMA ]");
      expect(actionCenterSrc).toContain('data-testid="badge-momentum-10sma"');
      expect(actionCenterSrc).toContain("[ MOMENTUM SETUP: 10-SMA ]");
      expect(dashboardSrc).toContain('data-testid="badge-momentum-10sma"');
      expect(dashboardSrc).toContain("[ MOMENTUM SETUP: 10-SMA ]");
      expect(scannerHookSrc).toContain("is10SmaMomentum");
    });
  });

  describe("3. Dynamic 'AI Tips' Integration (Contextual Instructions)", () => {
    it("swaps AI Tips text to runaway trend 10-SMA instructions when 10-SMA momentum is active", () => {
      const runawayTips = [
        "Holding tight 10-SMA momentum support. This is a runaway trend trade.",
        "Await 1H candle close above the 10-SMA line to confirm shallow bounce.",
        "Keep stops tight directly below the 10-SMA wick (-1R). Scale 50% at 1.5R.",
      ];

      for (const tip of runawayTips) {
        expect(swingChartSrc).toContain(tip);
        expect(dashboardSrc).toContain(tip);
        expect(aiTipsOverlaySrc).toContain(tip);
      }
    });

    it("retains structural 20-SMA tips when not in 10-SMA momentum state", () => {
      expect(swingChartSrc).toContain("Holding structural 20-SMA support");
      expect(dashboardSrc).toContain("Holding structural 20-SMA support");
      expect(aiTipsOverlaySrc).toContain("Holding structural 20-SMA support");
    });
  });
});
