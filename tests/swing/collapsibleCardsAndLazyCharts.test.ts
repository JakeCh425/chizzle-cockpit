import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");

describe("Architecture Refactor - Collapsible Setup Cards with Lazy-Loaded Mini-Charts", () => {
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Implement Accordion Logic (Collapsible Cards)", () => {
    it("renders compact header with Ticker, Live Price, Status Badge, Buy/Stop/Target, and Summary Strip", () => {
      // Ticker and live price
      expect(tradingCardSrc).toContain("{d.symbol}");
      expect(tradingCardSrc).toContain("data-testid={`inline-header-price-${d.symbol}`}");
      // Status pill
      expect(tradingCardSrc).toContain("<StatusPill");
      // Buy/Stop/Target core metrics
      expect(tradingCardSrc).toContain('data-testid={`core-metrics-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Buy Target");
      expect(tradingCardSrc).toContain("Stop Loss");
      expect(tradingCardSrc).toContain("Return %");
      // Summary strip
      expect(tradingCardSrc).toContain('data-testid={`setup-card-summary-strip-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Funding Allocated:");
      expect(tradingCardSrc).toContain("Position Size:");
      expect(tradingCardSrc).toContain("Target R-Multiple:");
    });

    it("wraps mini-chart and deeper diagnostics inside collapsible body controlled by isExpanded", () => {
      expect(tradingCardSrc).toContain("{isExpanded && (");
      expect(tradingCardSrc).toContain('data-testid={`card-expanded-details-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`card-collapsible-body-${d.symbol}`}');
    });

    it("provides highly visible [ Expand Chart & Details ⌄ ] toggle affordances", () => {
      expect(tradingCardSrc).toContain("[ Expand Chart & Details ⌄ ]");
      expect(tradingCardSrc).toContain('data-testid={`button-toggle-card-collapse-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`button-toggle-expand-details-${d.symbol}`}');
    });
  });

  describe("2. Lazy-Load the Mini-Charts (Performance Optimization)", () => {
    it("places the mini-chart inside the isExpanded collapsible body so it does not mount when collapsed", () => {
      const expandedBodyIdx = tradingCardSrc.indexOf("{isExpanded && (\n        <div\n          className=\"flex flex-col gap-2.5 pt-3 mt-2 border-t border-[var(--card-border)]");
      const miniChartIdx = tradingCardSrc.indexOf('data-testid={`mini-chart-${d.symbol}`}');
      expect(miniChartIdx).toBeGreaterThan(expandedBodyIdx);
    });

    it("calls chart.remove() on unmount to completely free browser memory and prevent memory leaks", () => {
      expect(tradingCardSrc).toContain("ro.disconnect();");
      expect(tradingCardSrc).toContain("cleanupEvents();");
      expect(tradingCardSrc).toContain("chart.remove();");
      expect(tradingCardSrc).toContain("chartRef.current = null;");
    });
  });

  describe("3. Strict CSS Grid Alignment (Keep it Flushed)", () => {
    it("configures cards grid container with grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start", () => {
      expect(actionCenterSrc).toContain("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start");
      expect(actionCenterSrc).toContain('data-testid="ac-cards-grid"');
    });

    it("anchors individual card wrappers with self-start to prevent vertical stretching", () => {
      expect(actionCenterSrc).toContain('className="flex flex-col gap-1.5 self-start w-full"');
    });
  });

  describe("4. Chart Sizing & Scoping", () => {
    it("constrains the chart container height strictly with h-64 and height 210/250px", () => {
      expect(tradingCardSrc).toContain('className="h-64 my-2.5 rounded-lg border border-slate-800 bg-slate-950/80');
      expect(tradingCardSrc).toContain("height = 250");
    });

    it("plots 20 and 50 SMAs on 1H candles", () => {
      expect(tradingCardSrc).toContain("const sma20Data = barsData?.smas?.sma20");
      expect(tradingCardSrc).toContain("const sma50Data = barsData?.smas?.sma50");
      expect(tradingCardSrc).toContain("1H Candle Mini-Chart · 20/50 SMA");
    });

    it("dynamically plots entry, stop, and target using native createPriceLine() API", () => {
      expect(tradingCardSrc).toContain("buyLine = candleSeries.createPriceLine({");
      expect(tradingCardSrc).toContain('title: "Buy",');
      expect(tradingCardSrc).toContain("stopLine = candleSeries.createPriceLine({");
      expect(tradingCardSrc).toContain('title: "Stop",');
      expect(tradingCardSrc).toContain("targetLine = candleSeries.createPriceLine({");
      expect(tradingCardSrc).toContain('title: "Target 1",');
    });
  });
});
