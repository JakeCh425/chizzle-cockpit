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
    it("sets deep low-contrast slate/navy terminal background colors (#0B1220, #0E1726)", () => {
      expect(dashboardContent).toContain('backgroundColor: "#0B1220"');
      expect(dashboardContent).toContain('backgroundColor: "#0E1726"');
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

    it("uses institutional crisp borderless candlesticks with modern green and red accents", () => {
      expect(dashboardContent).toContain('"#00E676"');
      expect(dashboardContent).toContain('"#FF5252"');
    });
  });

  describe("3. SMA Clarity & Dynamic 20-SMA Pullback Buy Zone", () => {
    it("configures high-contrast terminal colors for SMAs (Blue #22D3EE, Red/Magenta #F43F5E, Gold #FFD700)", () => {
      expect(DEFAULT_SMA_SETTINGS.sma20.color).toBe("#22D3EE");
      expect(DEFAULT_SMA_SETTINGS.sma50.color).toBe("#F43F5E");
      expect(DEFAULT_SMA_SETTINGS.sma200.color).toBe("#FFD700");

      expect(DEFAULT_SMA_COLORS.sma20).toBe("#22D3EE");
      expect(DEFAULT_SMA_COLORS.sma50).toBe("#F43F5E");
      expect(DEFAULT_SMA_COLORS.sma200).toBe("#FFD700");

      expect(DEFAULT_SPARK_SMA_COLORS.sma20).toBe("#22D3EE");
      expect(DEFAULT_SPARK_SMA_COLORS.sma50).toBe("#F43F5E");
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

  describe("4. Minimalist Execution Markers & Floating HUD", () => {
    it("renders minimalist geometric chevrons and micro-dots rather than large HTML/SVG boxes", () => {
      expect(dashboardContent).toContain('d={`M ${bar.x + candleWidth / 2 - 4} ${arrowY');
      expect(dashboardContent).toContain('d={`M ${currentBar.x + candleWidth / 2 - 4} ${arrowY');
    });

    it("renders floating HUD with 4H Trend, Day Classification, and Setup Status pills", () => {
      expect(dashboardContent).toContain('data-testid="hud-4h-trend-pill"');
      expect(dashboardContent).toContain('data-testid="hud-day-classification-pill"');
      expect(dashboardContent).toContain('data-testid="hud-setup-status-pill"');
    });

    it("preserves actionable signal titles and testids for verification", () => {
      expect(dashboardContent).toContain("[ BUY SIGNAL - EXECUTE ]");
      expect(dashboardContent).toContain("[ SELL - TARGET HIT ]");
      expect(dashboardContent).toContain("[ SELL - STOP HIT ]");
    });
  });
});

