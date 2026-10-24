import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Chizzle Wealth Engine — Single-Page Dashboard Studio", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Global Layout & Architecture", () => {
    it("creates a strict 100vh full-width container with no vertical window scrolling", () => {
      expect(dashboardContent).toContain("h-screen w-screen max-h-screen");
      expect(dashboardContent).toContain("overflow-hidden flex flex-col");
    });

    it("implements a 3-column layout with 20%, 55%, and 25% widths", () => {
      // Left column: 20% width
      expect(dashboardContent).toContain('w-[20%]');
      expect(dashboardContent).toContain('data-testid="column-left"');

      // Center column: 55% width
      expect(dashboardContent).toContain('w-[55%]');
      expect(dashboardContent).toContain('data-testid="column-center"');

      // Right column: 25% width
      expect(dashboardContent).toContain('w-[25%]');
      expect(dashboardContent).toContain('data-testid="column-right"');
    });

    it("ensures each column scrolls internally without main browser window scroll", () => {
      expect(dashboardContent).toContain("overflow-y-auto");
    });
  });

  describe("2. Branding & Navigation", () => {
    it("renders top navigation bar with brand text CHIZZLE WEALTH ENGINE and bullish candlestick SVG", () => {
      expect(dashboardContent).toContain("CHIZZLE");
      expect(dashboardContent).toContain("WEALTH ENGINE");
      expect(dashboardContent).toContain("function CandlestickIcon");
      expect(dashboardContent).toContain('<rect x="2" y="6" width="6" height="11"');
      expect(dashboardContent).toContain('line x1="5" y1="1" x2="5" y2="6"');
      expect(dashboardContent).toContain('line x1="5" y1="17" x2="5" y2="23"');
    });

    it("defines and supports all three specific color themes via CSS variables", () => {
      // Cyber Neon (Default)
      expect(dashboardContent).toContain('"cyber-neon"');
      expect(dashboardContent).toContain('#0F172A'); // deep slate/charcoal bg
      expect(dashboardContent).toContain('#06B6D4'); // cyan borders
      expect(dashboardContent).toContain('#22C55E'); // neon green

      // Stealth Mode
      expect(dashboardContent).toContain('"stealth"');
      expect(dashboardContent).toContain('#000000'); // OLED black
      expect(dashboardContent).toContain('#F59E0B'); // amber/gold highlights

      // Arctic Terminal
      expect(dashboardContent).toContain('"arctic"');
      expect(dashboardContent).toContain('#FFFFFF'); // crisp white
      expect(dashboardContent).toContain('#0F172A'); // stark black borders / navy text
    });

    it("provides an interactive theme switcher button in the top right corner", () => {
      expect(dashboardContent).toContain('data-testid="button-theme-switcher"');
      expect(dashboardContent).toContain("cycleTheme");
    });
  });

  describe("3. Column Details & Components", () => {
    it("Left Column includes Market Regime traffic-light indicator (Red/Yellow/Green)", () => {
      expect(dashboardContent).toContain('data-testid="market-regime-indicator"');
      expect(dashboardContent).toContain("Red Traffic Light");
      expect(dashboardContent).toContain("Yellow Traffic Light");
      expect(dashboardContent).toContain("Green Traffic Light");
    });

    it("Left Column includes scrollable, compact watchlist with symbols, prices, and mini sparklines", () => {
      expect(dashboardContent).toContain("watchlist-row-");
      expect(dashboardContent).toContain("<polyline");
      expect(dashboardContent).toContain("sparkline");
    });

    it("Center Column includes horizontal tab-bar for Chart, Setup History, Settings, and Indicators", () => {
      expect(dashboardContent).toContain('data-testid="center-tab-bar"');
      expect(dashboardContent).toContain('data-testid="tab-chart"');
      expect(dashboardContent).toContain('data-testid="tab-setup-history"');
      expect(dashboardContent).toContain('data-testid="tab-settings"');
      expect(dashboardContent).toContain('data-testid="tab-indicators"');
    });

    it("Center Column overlays text labels for 20-SMA, 50-SMA, and 200-SMA on top edge of chart", () => {
      expect(dashboardContent).toContain('data-testid="sma-overlay-labels"');
      expect(dashboardContent).toContain("20-SMA:");
      expect(dashboardContent).toContain("50-SMA:");
      expect(dashboardContent).toContain("200-SMA:");
    });

    it("Right Column renders Setup Card with background color tints indicating status", () => {
      expect(dashboardContent).toContain('data-testid="setup-card"');
      expect(dashboardContent).toContain('data-testid="badge-setup-status"');
      expect(dashboardContent).toContain("bg-emerald-950/20");
      expect(dashboardContent).toContain("bg-amber-950/20");
    });

    it("Right Column prominently displays exactly three large, bold data points: Buy Target, Stop Loss, Primary Target", () => {
      expect(dashboardContent).toContain('data-testid="setup-three-bold-datapoints"');
      expect(dashboardContent).toContain("Buy Target");
      expect(dashboardContent).toContain("Stop Loss");
      expect(dashboardContent).toContain("Primary T1");
    });

    it("Right Column includes short Bottom Line summary sentence below the numbers", () => {
      expect(dashboardContent).toContain('data-testid="setup-bottom-line"');
      expect(dashboardContent).toContain("Bottom Line");
    });

    it("Right Column includes collapsed Advanced Metrics accordion dropdown for partial profit targets and win rates", () => {
      expect(dashboardContent).toContain('data-testid="advanced-metrics-accordion"');
      expect(dashboardContent).toContain('data-testid="button-toggle-advanced-metrics"');
      expect(dashboardContent).toContain("Advanced Metrics");
      expect(dashboardContent).toContain("Partial Profit Targets");
      expect(dashboardContent).toContain("Historical Win Rate");
    });
  });
});

