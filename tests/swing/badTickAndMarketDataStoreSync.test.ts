import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { marketDataStore, useMarketDataStore } from "../../client/src/lib/useMarketDataStore";

describe("Architecture Overhaul - 'Bad Tick' Filtering & Single Source of Truth Synchronization", () => {
  const marketStorePath = path.resolve(__dirname, "../../client/src/lib/useMarketDataStore.ts");
  const marketStoreSrc = fs.readFileSync(marketStorePath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedSrc = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  const modalChartPath = path.resolve(__dirname, "../../client/src/components/swing/ModalLargeChart.tsx");
  const modalChartSrc = fs.readFileSync(modalChartPath, "utf-8").replace(/\r\n/g, "\n");

  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const swingChartSrc = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Global State Management (Single Source of Truth: useMarketDataStore)", () => {
    it("creates and exports useMarketDataStore and marketDataStore singleton", () => {
      expect(marketStoreSrc).toContain("export function useMarketDataStore");
      expect(marketStoreSrc).toContain("export const marketDataStore = new MarketDataStore()");
      expect(globalStateSrc).toContain("useMarketDataStore");
      expect(priceFeedSrc).toContain("useMarketDataStore");
    });

    it("root level connection feeds the single store", () => {
      expect(priceFeedSrc).toContain("marketDataStore.validateAndApplyTick");
      expect(priceFeedSrc).toContain("marketDataStore.setSnapshot");
      expect(priceFeedSrc).toContain("marketDataStore.setStatus");
    });

    it("Wealth Studio chart, Top Header, and Setup Cards subscribe to the exact same store", () => {
      // WealthEngineDashboard Header
      expect(dashboardSrc).toContain('marketStore.prices[activeTicker]');
      expect(dashboardSrc).toContain('data-testid="header-live-price"');
      // WealthEngineDashboard Chart
      expect(dashboardSrc).toContain('data-testid="chart-live-price-value"');
      // WealthEngineDashboard Setup Card
      expect(dashboardSrc).toContain('data-testid="studio-setup-card-header"');
      // TradingCard (Action Center)
      expect(tradingCardSrc).toContain('data-testid={`cardheader-price-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`inline-header-price-${d.symbol}`}');
      expect(tradingCardSrc).toContain('market.prices[d.symbol]');
      // Action Center
      expect(actionCenterSrc).toContain('marketStore.prices[d.symbol]');
      expect(actionCenterSrc).toContain('data-testid={`active-execution-card-${d.symbol}`}');
    });

    it("synchronously updates all prices across subscribers when a valid tick arrives in the store", () => {
      marketDataStore.setCurrentPrice(185.00, "AAPL");
      const initialAAPL = marketDataStore.getState().prices["AAPL"];
      expect(initialAAPL).toBeGreaterThan(0);

      const validTick = { symbol: "AAPL", price: +(initialAAPL * 1.01).toFixed(2), timestamp: Date.now() };
      const applied = marketDataStore.validateAndApplyTick(validTick);
      expect(applied).toBe(true);
      expect(marketDataStore.getState().prices["AAPL"]).toBe(validTick.price);
      expect(marketDataStore.getState().lastValidTicks["AAPL"]?.price).toBe(validTick.price);
    });
  });

  describe("2. Implement 'Bad Tick' Filtering (Outlier Rejection Sandbox)", () => {
    it("stores previousClose and lastValidTick in state", () => {
      expect(marketStoreSrc).toContain("lastValidTicks: Record<string, LastValidTick>");
      expect(marketStoreSrc).toContain("previousClose: Record<string, number>");
      const state = marketDataStore.getState();
      expect(state.lastValidTicks).toBeDefined();
      expect(state.previousClose).toBeDefined();
    });

    it("calculates percentage difference against lastValidTick: Math.abs((liveTick.price - lastValidTick.price) / lastValidTick.price)", () => {
      expect(marketStoreSrc).toContain("Math.abs((tick.price - lastValid) / lastValid)");
      expect(marketStoreSrc).toContain("Math.abs((newPrice - ref) / ref)");
    });

    it("classifies >5% sudden jumps as BAD TICK and drops them", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      marketDataStore.setCurrentPrice(185.00, "AAPL");

      // Massive dirty print ($352.73 vs $185.00 is >50% jump)
      const dirtyTick = { symbol: "AAPL", price: 352.73, timestamp: Date.now() };
      const applied = marketDataStore.validateAndApplyTick(dirtyTick);

      expect(applied).toBe(false);
      expect(marketDataStore.getState().prices["AAPL"]).not.toBe(352.73);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it("chart components guard candlestick update calls with isBadTick rejection", () => {
      // WealthEngineDashboard activeCandle
      expect(dashboardSrc).toContain("isBadTick(symbol, livePrice, lastBase.c)");
      // TradingCard sparkline
      expect(tradingCardSrc).toContain("marketDataStore.isBadTick(symbol, p, lastBar.c)");
      // ModalLargeChart
      expect(modalChartSrc).toContain("marketDataStore.isBadTick(symbol, p, lastBar.c)");
      // SwingChart
      expect(swingChartSrc).toContain("marketDataStore.isBadTick(ticker, rawPrice, lastBar.c)");
    });
  });

  describe("3. Graceful 'Stale Data' Fallback & Auto-Refresh", () => {
    it("implements fallback trigger to fetch Last Close when WebSocket drops or status is stale", () => {
      expect(marketStoreSrc).toContain("fetchLastClose");
      expect(priceFeedSrc).toContain("marketDataStore.setStatus(\"RECONNECTING\")");
      expect(priceFeedSrc).toContain("marketDataStore.fetchLastClose()");
    });

    it("displays subtle yellow [ DELAYED ] or [ RECONNECTING... ] badge next to price in Header", () => {
      expect(dashboardSrc).toContain('data-testid="badge-header-delayed"');
      expect(dashboardSrc).toContain('[ RECONNECTING... ]');
      expect(dashboardSrc).toContain('[ DELAYED ]');
    });

    it("displays subtle yellow [ DELAYED ] or [ RECONNECTING... ] badge next to price in Chart", () => {
      expect(dashboardSrc).toContain('data-testid="badge-chart-delayed"');
      expect(dashboardSrc).toContain('[ RECONNECTING... ]');
      expect(dashboardSrc).toContain('[ DELAYED ]');
    });

    it("displays subtle yellow [ DELAYED ] or [ RECONNECTING... ] badge next to price in Setup Cards", () => {
      expect(dashboardSrc).toContain('data-testid="badge-setup-card-delayed"');
      expect(tradingCardSrc).toContain('data-testid={`badge-card-delayed-${d.symbol}`}');
      expect(actionCenterSrc).toContain('data-testid={`badge-card-delayed-${d.symbol}`}');
    });
  });

  describe("4. Fix Setup Card UI (Text Overflow & Layout Break on CompactCard Header)", () => {
    it("exports CompactCard and enforces flex flex-wrap items-center justify-between gap-2 overflow-hidden on the top header row", () => {
      expect(tradingCardSrc).toContain("export const CompactCard = InlineTradingCard");
      expect(tradingCardSrc).toContain("flex flex-wrap items-center justify-between gap-2 overflow-hidden");
      expect(dashboardSrc).toContain("flex flex-wrap items-center justify-between gap-2 overflow-hidden");
    });

    it("keeps Potential Gain badge and Expand Chart & Details button in flex flow with shrink-0 and no absolute positioning", () => {
      expect(tradingCardSrc).toContain("Potential Gain");
      expect(tradingCardSrc).toContain("[ Expand Chart & Details ⌄ ]");
      expect(tradingCardSrc).toContain('data-testid={`badge-potential-gain-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`button-toggle-card-collapse-${d.symbol}`}');
      // Verify the right action group wraps cleanly with shrink-0
      expect(tradingCardSrc).toContain("flex flex-wrap items-center justify-end gap-2 shrink-0 max-w-full");
    });
  });
});

