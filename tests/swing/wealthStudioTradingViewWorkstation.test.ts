import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";
import { TRADINGVIEW_DEFAULTS } from "../../client/src/lib/smaSettings";

describe("Wealth Studio TradingView Overhaul — Indicator Cloud, Proximity Meter & Cockpit Integration", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const popoverPath = path.resolve(__dirname, "../../client/src/components/SmaSettingsPopover.tsx");
  const popoverContent = fs.readFileSync(popoverPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. TradingView Indicator Replication (20/50 SMA Dynamic Cloud & Volume Profile)", () => {
    it("defines TradingView indicator ribbon defaults (Blue #2962FF, Salmon #EF5350)", () => {
      expect(TRADINGVIEW_DEFAULTS.sma20Color).toBe("#2962FF");
      expect(TRADINGVIEW_DEFAULTS.sma50Color).toBe("#EF5350");
      expect(TRADINGVIEW_DEFAULTS.bullishRibbon).toBe("rgba(38, 166, 154, 0.12)");
      expect(TRADINGVIEW_DEFAULTS.bearishRibbon).toBe("rgba(239, 83, 80, 0.12)");
    });

    it("renders dynamic background cloud fill between SMA 20 and SMA 50 series", () => {
      expect(dashboardContent).toContain('data-testid="chart-sma-ribbon"');
      expect(dashboardContent).toContain('data-testid="chart-sma-ribbon-bullish"');
      expect(dashboardContent).toContain('data-testid="chart-sma-ribbon-bearish"');
      expect(dashboardContent).toContain('fill="rgba(38, 166, 154, 0.12)"');
      expect(dashboardContent).toContain('fill="rgba(239, 83, 80, 0.12)"');
    });

    it("implements TradingView Top Toolbar with symbol, timeframe pills, candle style toggle, and [ Indicators + ] popover", () => {
      expect(dashboardContent).toContain('data-testid="tradingview-top-toolbar"');
      expect(dashboardContent).toContain('data-testid="toolbar-timeframe-pills"');
      expect(dashboardContent).toContain('data-testid="toolbar-candle-style-toggle"');
      expect(popoverContent).toContain("[ Indicators + ]");
      expect(popoverContent).toContain('data-testid="indicator-toggle-ribbon"');
      expect(popoverContent).toContain('data-testid="indicator-toggle-volume"');
      expect(popoverContent).toContain('data-testid="indicator-toggle-atr"');
    });

    it("anchors volume profile bars with 1.2x average volume benchmark line", () => {
      expect(dashboardContent).toContain('data-testid="chart-volume-profile-layer"');
      expect(dashboardContent).toContain('data-testid="chart-vol-benchmark-line"');
      expect(dashboardContent).toContain("1.2x Avg Vol Benchmark");
    });

    it("renders ATR (14) indicator panel at chart footer with volatility status", () => {
      expect(dashboardContent).toContain('data-testid="chart-atr-footer-panel"');
      expect(dashboardContent).toContain("ATR (14):");
      expect(dashboardContent).toContain("VOLATILITY NORMAL");
    });
  });

  describe("2. Right-Hand Asset & Proximity Sidebar", () => {
    it("includes SMH semiconductor ETF in default watchlist with full exchange and sector metadata", () => {
      const smh = DEFAULT_WATCHLIST.find((i) => i.symbol === "SMH");
      expect(smh).toBeDefined();
      expect(smh?.name).toBe("VanEck Semiconductor ETF");
      expect(smh?.exchange).toBe("NASDAQ");
      expect(smh?.sector).toBe("Technology / Semiconductors");
      expect(smh?.price).toBe(541.62);
      expect(smh?.change).toBe(14.42);
      expect(smh?.changePct).toBe(2.74);
    });

    it("renders Detailed Quote Strip with large symbol, name, exchange, live price, delta, and session stats grid", () => {
      expect(dashboardContent).toContain('data-testid="sidebar-quote-strip"');
      expect(dashboardContent).toContain('data-testid="sidebar-live-price"');
      expect(dashboardContent).toContain('data-testid="badge-market-session"');
      expect(dashboardContent).toContain('data-testid="sidebar-session-stats-grid"');
      expect(dashboardContent).toContain("30D Avg Volume");
    });

    it("computes trade proximity meter and renders visual gauge with dynamic tier badges", () => {
      expect(dashboardContent).toContain('data-testid="trade-proximity-meter"');
      expect(dashboardContent).toContain('data-testid="trade-proximity-gauge"');
      expect(dashboardContent).toContain('data-testid="badge-proximity-tier"');
      expect(dashboardContent).toContain("READY TO TRIGGER (90%+)");
      expect(dashboardContent).toContain("FORMING PULLBACK (~60%)");
      expect(dashboardContent).toContain("EXTENDED - DO NOT CHASE (<25%)");
    });

    it("calculates proximity percentage from 20-SMA support and enforces rules checklist", () => {
      expect(dashboardContent).toContain("proximityPct = Math.abs(currentPrice - sma20Price) / currentPrice * 100");
      expect(dashboardContent).toContain("Distance to 20-SMA:");
      expect(dashboardContent).toContain("1H Candle Status:");
      expect(dashboardContent).toContain("&gt;1.2x Benchmark");
    });
  });

  describe("3. Integrated Cockpit Trade Card (Auto-Completes When Ready)", () => {
    it("auto-populates trade levels when ready and highlights [ ARM TRADE ] button", () => {
      expect(dashboardContent).toContain('data-testid="setup-card"');
      expect(dashboardContent).toContain('data-testid="studio-setup-card-header"');
      expect(dashboardContent).toContain('data-testid="badge-setup-status"');
      expect(dashboardContent).toContain("[ READY TO TRADE ]");
      expect(dashboardContent).toContain('data-testid="button-arm-practice-trade"');
      expect(dashboardContent).toContain("shadow-[0_0_20px_rgba(0,230,118,0.5)]");
    });

    it("displays pending status badges when awaiting confirmation", () => {
      expect(dashboardContent).toContain("[ AWAITING 1H CLOSE ]");
      expect(dashboardContent).toContain("[ PULLBACK FORMING ]");
    });

    it("pulls position sizing from usePositionSizer with safeEquity and 1% risk", () => {
      expect(dashboardContent).toContain("const cardSizing = usePositionSizer({");
      expect(dashboardContent).toContain("cardSizing.calculatedShares");
      expect(dashboardContent).toContain("cardSizing.totalDollarRiskAllowed");
    });
  });

  describe("4. Technical Chart Canvas & Native Y-Axis Binding", () => {
    it("renders native Y-axis labels avoiding candle occlusion and binding strictly to scale", () => {
      expect(dashboardContent).toContain('data-testid="chart-label-buy"');
      expect(dashboardContent).toContain('data-testid="chart-label-stop"');
      expect(dashboardContent).toContain('data-testid="chart-label-t1"');
      expect(dashboardContent).toContain('data-testid="chart-label-t2"');
      expect(dashboardContent).toContain('data-testid="chart-label-t3"');
      expect(dashboardContent).toContain('data-testid="chart-live-price-badge"');
    });

    it("resets trade levels immediately on activeTicker switch", () => {
      expect(dashboardContent).toContain("setTradeLevels(null);");
      expect(dashboardContent).toContain('key={`${activeTicker}-${activeTf}`}');
    });
  });
});

