import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_SMA_SETTINGS, loadSmaSettings } from "../../client/src/lib/smaSettings";
import { DEFAULT_SMA_COLORS, SMA_META } from "../../client/src/components/swing/SwingChart";
import { DEFAULT_SPARK_SMA_COLORS } from "../../client/src/components/swing/TradingCard";

describe("Institutional UI Overhaul — Bloomberg Aesthetic, SMA Logic & Collision Avoidance", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const swingChartContent = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Y-Axis Overlap, State Clearing & Cross-Ticker Sanitization", () => {
    it("forces chart unmount/remount on ticker or timeframe switch with dynamic React key", () => {
      expect(dashboardContent).toContain('key={`${activeTicker}-${activeTf}`}');
    });

    it("sanitizes entry, stop loss, and target props to prevent cross-ticker stale price contamination", () => {
      expect(dashboardContent).toContain(
        'entryPrice={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? activeItem?.buyTarget) : activeItem?.buyTarget}'
      );
      expect(dashboardContent).toContain(
        'stopLoss={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? activeItem?.stopLoss) : activeItem?.stopLoss}'
      );
      expect(dashboardContent).toContain(
        'primaryTarget={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? activeItem?.primaryTarget) : activeItem?.primaryTarget}'
      );
    });

    it("validates incoming price targets with isTargetSafe rejecting >40% deviations from livePrice", () => {
      expect(dashboardContent).toContain("isTargetSafe");
      expect(dashboardContent).toContain("Math.abs(val - livePrice) / livePrice < 0.4");
    });

    it("implements a collision avoidance pass on right-hand Y-axis tags guaranteeing minimum 18px separation", () => {
      expect(dashboardContent).toContain("yAxisPillPositions");
      expect(dashboardContent).toContain("const minGap = 18;");
      expect(dashboardContent).toContain("items[i].idealY < items[i - 1].idealY + minGap");
      expect(dashboardContent).toContain("items[i].idealY = items[i - 1].idealY + minGap;");
      expect(dashboardContent).toContain('yAxisPillPositions.live');
      expect(dashboardContent).toContain('yAxisPillPositions.buy');
      expect(dashboardContent).toContain('yAxisPillPositions.stop');
      expect(dashboardContent).toContain('yAxisPillPositions.t1');
      expect(dashboardContent).toContain('yAxisPillPositions.t2');
      expect(dashboardContent).toContain('yAxisPillPositions.t3');
    });

    it("enables native price lines with axisLabelVisible in Lightweight Charts", () => {
      expect(swingChartContent).toContain("axisLabelVisible: true");
    });
  });

  describe("2. Bloomberg Terminal Chart Aesthetic", () => {
    it("sets ultra-dark Bloomberg terminal background colors (#0B0E14, #05080E, #080C12)", () => {
      expect(dashboardContent).toContain('backgroundColor: "#0B0E14"');
      expect(dashboardContent).toContain('backgroundColor: "#05080E"');
      expect(dashboardContent).toContain('backgroundColor: "#080C12"');
      expect(swingChartContent).toContain('background: { color: "#0B0E14" }');
    });

    it("renders subtle thin dotted grid lines with 5% white opacity (strokeDasharray 2 4)", () => {
      expect(dashboardContent).toContain('stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4"');
      expect(swingChartContent).toContain('color: "rgba(255, 255, 255, 0.05)", style: LineStyle.Dotted');
    });

    it("uses monospace font family across scales, crosshairs, and time axes", () => {
      expect(dashboardContent).toContain('font-mono');
      expect(dashboardContent).toContain('fontFamily="monospace"');
      expect(swingChartContent).toContain(
        "fontFamily: \"'Roboto Mono', 'Fira Code', 'Courier New', monospace\""
      );
    });

    it("uses institutional crisp borderless candlesticks with neon green and neon red", () => {
      expect(swingChartContent).toContain('upColor: hollow ? "rgba(0,0,0,0)" : "#26a69a"');
      expect(swingChartContent).toContain('downColor: "#ef5350"');
      expect(swingChartContent).toContain("borderVisible: false");
    });
  });

  describe("3. SMA Clarity & Dynamic 20-SMA Pullback Buy Zone", () => {
    it("configures high-contrast terminal colors for SMAs (Cyan, Magenta, Gold)", () => {
      expect(DEFAULT_SMA_SETTINGS.sma20.color).toBe("#00FFFF");
      expect(DEFAULT_SMA_SETTINGS.sma50.color).toBe("#FF00FF");
      expect(DEFAULT_SMA_SETTINGS.sma200.color).toBe("#FFD700");

      expect(DEFAULT_SMA_COLORS.sma20).toBe("#00FFFF");
      expect(DEFAULT_SMA_COLORS.sma50).toBe("#FF00FF");
      expect(DEFAULT_SMA_COLORS.sma200).toBe("#FFD700");

      expect(DEFAULT_SPARK_SMA_COLORS.sma20).toBe("#00FFFF");
      expect(DEFAULT_SPARK_SMA_COLORS.sma50).toBe("#FF00FF");
      expect(DEFAULT_SPARK_SMA_COLORS.sma200).toBe("#FFD700");
    });

    it("evaluates live price within 0.5% pullback of 20-SMA", () => {
      expect(dashboardContent).toContain("isPullbackTo20Sma");
      expect(dashboardContent).toContain("Math.abs(livePrice - latestSma20) / latestSma20 <= 0.005");
      expect(swingChartContent).toContain("Math.abs(rawPrice - s20) / s20 <= 0.005");
    });

    it("renders radial gradient background highlight when pullback is active", () => {
      expect(dashboardContent).toContain('id="buyZoneGlow"');
      expect(dashboardContent).toContain('data-testid="chart-buy-zone-highlight"');
      expect(swingChartContent).toContain('data-testid="chart-buy-zone-highlight"');
    });

    it("displays prominent [ READY TO BUY · 20-SMA ZONE ] header badge", () => {
      expect(dashboardContent).toContain('data-testid="badge-ready-to-buy-zone"');
      expect(dashboardContent).toContain("[ READY TO BUY · 20-SMA ZONE ]");
      expect(swingChartContent).toContain('data-testid="badge-ready-to-buy-zone"');
    });
  });

  describe("4. Minimalist Execution Markers", () => {
    it("renders compact arrow polygons on candle wicks rather than large HTML boxes", () => {
      expect(dashboardContent).toContain('points={`${currentBar.x + candleWidth / 2},${arrowY}');
      expect(dashboardContent).toContain('points={`${bar.x + candleWidth / 2},${arrowY}');
    });

    it("preserves actionable signal titles and testids for verification", () => {
      expect(dashboardContent).toContain("[ BUY SIGNAL - EXECUTE ]");
      expect(dashboardContent).toContain("[ SELL - TARGET HIT ]");
      expect(dashboardContent).toContain("[ SELL - STOP HIT ]");
    });
  });
});

