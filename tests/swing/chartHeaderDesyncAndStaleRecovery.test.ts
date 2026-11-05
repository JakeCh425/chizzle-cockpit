import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  marketDataStore,
  globalStore,
  STALE_TICK_THRESHOLD_MS,
} from "../../client/src/lib/useMarketDataStore";

describe("Fix Chart/Header Data Desync & Clean Stale State Architecture", () => {
  const marketStorePath = path.resolve(__dirname, "../../client/src/lib/useMarketDataStore.ts");
  const marketStoreSrc = fs.readFileSync(marketStorePath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedSrc = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const swingChartPath = path.resolve(__dirname, "../../client/src/components/swing/SwingChart.tsx");
  const swingChartSrc = fs.readFileSync(swingChartPath, "utf-8").replace(/\r\n/g, "\n");

  const swingWorkspacePath = path.resolve(__dirname, "../../client/src/components/swing/SwingWorkspace.tsx");
  const swingWorkspaceSrc = fs.readFileSync(swingWorkspacePath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  beforeEach(() => {
    globalStore.setCurrentPrice(185.00, "AAPL");
  });

  describe("1. Fix Cross-Component Data Bleed (The AAPL / XLV Mismatch)", () => {
    it("strictly enforces activeTicker and exposes clearData() in globalStore and GlobalStateProvider", () => {
      expect(marketStoreSrc).toContain("public clearData(nextTicker?: string): void");
      expect(marketStoreSrc).toContain("public setActiveTicker(ticker: string): void");
      expect(globalStateSrc).toContain("marketDataStore.clearData(sym)");
      expect(dashboardSrc).toContain("globalStore.clearData(clean)");
      expect(swingWorkspaceSrc).toContain("globalStore.clearData(sym)");
      expect(tradingCardSrc).toContain("globalStore.clearData(d.symbol)");
      expect(actionCenterSrc).toContain("globalStore.clearData(sym)");
    });

    it("clears previous ticker price and sets momentary loading state BEFORE fetching new ticker data", () => {
      // Simulate user viewing XLV at $190.00
      globalStore.setCurrentPrice(190.0, "XLV");
      expect(globalStore.activeTicker).toBe("XLV");
      expect(globalStore.currentPrice).toBe(190.0);

      // User clicks AAPL: clearData("AAPL") fires BEFORE new data arrives
      globalStore.clearData("AAPL");
      const clearedState = globalStore.getState();

      expect(clearedState.activeTicker).toBe("AAPL");
      expect(clearedState.currentPrice).toBeNull();
      expect(clearedState.isLoadingTicker).toBe(true);
      // Stale seed reference for AAPL is cleared so fresh quote ($352.00) is not blocked by old cached values
      expect(clearedState.lastValidTicks["AAPL"]).toBeUndefined();
    });

    it("guards SwingChart and SwingWorkspace against decision/bars symbol bleed across tickers", () => {
      expect(swingWorkspaceSrc).toContain("const d = rawD && rawD.symbol === active ? rawD : undefined;");
      expect(swingChartSrc).toContain("const d = decision && (!symbol || decision.symbol === symbol) ? decision : undefined;");
      expect(swingChartSrc).toContain("const b = bars.data && (!symbol || !bars.data.symbol || bars.data.symbol === symbol) ? bars.data : undefined;");
      expect(swingChartSrc).toContain('data-testid="chart-loading-state"');
    });
  });

  describe("2. Enforce 'Single Source of Truth' for Current Price (globalStore.currentPrice)", () => {
    it("routes Header, Watchlist, Setup Cards, and Chart through globalStore.currentPrice", () => {
      expect(marketStoreSrc).toContain("export const globalStore = marketDataStore;");
      expect(marketStoreSrc).toContain("public get currentPrice(): number | null");
      expect(dashboardSrc).toContain("globalStore.currentPrice");
      expect(swingChartSrc).toContain("globalStore.currentPrice");
      expect(tradingCardSrc).toContain("globalStore.currentPrice");
      expect(actionCenterSrc).toContain("globalStore.currentPrice");
    });

    it("updates every subscriber simultaneously when AAPL ticks to $352.00", () => {
      // Switch to AAPL and clear stale cache first
      globalStore.clearData("AAPL");

      let subscriberNotifiedCount = 0;
      let observedCurrentPrice: number | null = null;
      let observedMapPrice: number | undefined = undefined;

      const unsub = globalStore.subscribe(() => {
        subscriberNotifiedCount++;
        observedCurrentPrice = globalStore.currentPrice;
        observedMapPrice = globalStore.getState().prices["AAPL"];
      });

      // AAPL ticks to $352.00 via WebSocket / globalStore
      const applied = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        price: 352.0,
        timestamp: Date.now(),
      });

      expect(applied).toBe(true);
      expect(subscriberNotifiedCount).toBe(1);
      expect(globalStore.currentPrice).toBe(352.0);
      expect(observedCurrentPrice).toBe(352.0);
      expect(observedMapPrice).toBe(352.0);
      expect(globalStore.getState().isLoadingTicker).toBe(false);

      unsub();
    });
  });

  describe("3. Implement 'Stale State' Auto-Recovery (> 15s Last Tick Timestamp Checker)", () => {
    it("enforces a 15-second (15,000ms) stale tick threshold when market is OPEN", () => {
      expect(STALE_TICK_THRESHOLD_MS).toBe(15_000);
      expect(marketStoreSrc).toContain("public async checkStaleState(isMarketOpenNow = true)");
      expect(priceFeedSrc).toContain("if (age > 15000)");
      expect(priceFeedSrc).toContain("marketDataStore.checkStaleState(true)");
    });

    it("automatically triggers a background REST quote fetch and sets DELAYED status when lastTickTimestamp > 15s", async () => {
      const fetchSpy = vi.spyOn(globalStore, "fetchLastClose").mockResolvedValue(globalStore.getState().prices);

      // Simulate last tick received 16 seconds ago while market is OPEN
      const sixteenSecondsAgo = Date.now() - 16_000;
      globalStore.setLastTickTimestamp(sixteenSecondsAgo);

      const wasStale = await globalStore.checkStaleState(true);

      expect(wasStale).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(globalStore.activeTicker);
      expect(globalStore.getState().isDelayed).toBe(true);
      expect(globalStore.getState().status).toBe("DELAYED");

      fetchSpy.mockRestore();
    });

    it("does not trigger stale warning when market is CLOSED or tick is fresher than 15s", async () => {
      const fetchSpy = vi.spyOn(globalStore, "fetchLastClose").mockResolvedValue(globalStore.getState().prices);

      // Fresh tick (2 seconds ago)
      globalStore.setCurrentPrice(352.0, "AAPL");
      globalStore.setLastTickTimestamp(Date.now() - 2_000);

      const staleWhenFresh = await globalStore.checkStaleState(true);
      expect(staleWhenFresh).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Market closed (even with old timestamp)
      globalStore.setLastTickTimestamp(Date.now() - 60_000);
      const staleWhenClosed = await globalStore.checkStaleState(false);
      expect(staleWhenClosed).toBe(false);

      fetchSpy.mockRestore();
    });

    it("renders the prominent yellow [ ⚠️ DELAYED DATA ] warning badge next to the main ticker header", () => {
      expect(dashboardSrc).toContain("[ ⚠️ DELAYED DATA ]");
      expect(dashboardSrc).toContain('data-testid="badge-delayed-data-warning"');
      expect(swingChartSrc).toContain("[ ⚠️ DELAYED DATA ]");
      expect(swingChartSrc).toContain('data-testid="badge-delayed-data-warning"');
      expect(tradingCardSrc).toContain("[ ⚠️ DELAYED DATA ]");
      expect(actionCenterSrc).toContain("[ ⚠️ DELAYED DATA ]");
    });
  });
});

