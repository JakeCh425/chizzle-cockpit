import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  marketDataStore,
  globalStore,
  initialState,
  extractQuotePrice,
  normalizeQuoteTimestampMs,
  clearStaleCachedPrices,
  MAX_QUOTE_AGE_OPEN_MARKET_MS,
  STALE_QUOTE_ERROR_MESSAGE,
  SYNCING_LIVE_DATA_BADGE,
} from "../../client/src/lib/useMarketDataStore";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";

describe("CRITICAL ARCHITECTURE FIX - Eradicate Mock Data, Fix Live Pipeline & Loading States", () => {
  const watchlistPath = path.resolve(__dirname, "../../client/src/lib/wealthWatchlist.ts");
  const watchlistSrc = fs.readFileSync(watchlistPath, "utf-8").replace(/\r\n/g, "\n");

  const marketStorePath = path.resolve(__dirname, "../../client/src/lib/useMarketDataStore.ts");
  const marketStoreSrc = fs.readFileSync(marketStorePath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedSrc = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  beforeEach(() => {
    globalStore.clearData("AAPL");
  });

  describe("1. Eradicate Hardcoded Mock Data & Stale Cache", () => {
    it("completely removes the hardcoded AAPL mock price (232.15) from watchlist, store, and state files", () => {
      const forbiddenMock = ["232", "15"].join(".");
      expect(watchlistSrc).not.toContain(forbiddenMock);
      expect(marketStoreSrc).not.toContain(forbiddenMock);
      expect(globalStateSrc).not.toContain(forbiddenMock);
      expect(priceFeedSrc).not.toContain(forbiddenMock);

      const aaplItem = DEFAULT_WATCHLIST.find((i) => i.symbol === "AAPL");
      expect(aaplItem?.price).toBe(0);
    });

    it("strictly sets initialState.currentPrice to null and starts with empty store prices", () => {
      expect(initialState.currentPrice).toBeNull();
      expect(initialState.isLoadingTicker).toBe(true);
      expect(Object.keys(initialState.prices)).toHaveLength(0);
      expect(Object.keys(initialState.lastValidTicks)).toHaveLength(0);
    });

    it("clears stale localStorage cached prices on boot via clearStaleCachedPrices()", () => {
      expect(marketStoreSrc).toContain("export function clearStaleCachedPrices(): void");
      expect(marketStoreSrc).toContain("clearStaleCachedPrices();");
      expect(globalStateSrc).toContain("{ ...item, price: 0, sparkline: [] }");
      expect(() => clearStaleCachedPrices()).not.toThrow();
    });
  });

  describe("2. Implement Strict 'Loading' UI States (No Silent Failures)", () => {
    it("displays [ 🔄 SYNCING LIVE DATA... ] badge when currentPrice === null or actively fetching", () => {
      expect(SYNCING_LIVE_DATA_BADGE).toBe("[ 🔄 SYNCING LIVE DATA... ]");
      expect(dashboardSrc).toContain("[ 🔄 SYNCING LIVE DATA... ]");
      expect(dashboardSrc).toContain('data-testid="badge-chart-syncing-live-data"');
      expect(dashboardSrc).toContain('data-testid="badge-header-syncing-live-data"');
      expect(dashboardSrc).toContain('data-testid="badge-setup-card-syncing-live-data"');
      expect(tradingCardSrc).toContain("[ 🔄 SYNCING LIVE DATA... ]");
      expect(tradingCardSrc).toContain('data-testid={`badge-syncing-live-data-${d.symbol}`}');
      expect(actionCenterSrc).toContain("[ 🔄 SYNCING LIVE DATA... ]");
      expect(actionCenterSrc).toContain('data-testid={`badge-exec-syncing-${d.symbol}`}');
    });

    it("blurs/hides Entry, Target, and Stop math until a verified live quote is written to the global store", () => {
      expect(dashboardSrc).toContain('isSyncingLiveData ? "blur-sm opacity-40 pointer-events-none select-none" : ""');
      expect(tradingCardSrc).toContain('isSyncingLiveData ? "blur-sm opacity-40 pointer-events-none select-none" : ""');
      expect(actionCenterSrc).toContain('isSyncingLiveData ? "blur-sm opacity-40 pointer-events-none select-none" : ""');
    });
  });

  describe("3. Fortify the Primary Data Fetching Pipeline", () => {
    it("maps Finnhub (data.c), standard (data.price), and Yahoo (data.regularMarketPrice) directly to currentPrice", () => {
      expect(extractQuotePrice({ c: 229.85 })).toBe(229.85);
      expect(extractQuotePrice({ price: 230.10 })).toBe(230.10);
      expect(extractQuotePrice({ regularMarketPrice: 231.40 })).toBe(231.40);
      expect(extractQuotePrice({ close: 228.75 })).toBe(228.75);

      globalStore.clearData("AAPL");
      expect(globalStore.currentPrice).toBeNull();

      // Finnhub payload with `c` key
      const appliedFinnhub = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        c: 229.85,
        t: Math.floor(Date.now() / 1000),
      });
      expect(appliedFinnhub).toBe(true);
      expect(globalStore.currentPrice).toBe(229.85);
      expect(globalStore.getState().prices["AAPL"]).toBe(229.85);
      expect(globalStore.getState().isLoadingTicker).toBe(false);
    });

    it("logs 'LIVE TICK RECEIVED:' when ingesting market data payloads", () => {
      expect(marketStoreSrc).toContain("console.log('LIVE TICK RECEIVED:', payload);");
      expect(priceFeedSrc).toContain("console.log('LIVE TICK RECEIVED:', payload);");
      expect(globalStateSrc).toContain("console.log('LIVE TICK RECEIVED:', payload);");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const payload = { symbol: "AAPL", c: 230.50, t: Math.floor(Date.now() / 1000) };
      globalStore.validateAndApplyTick(payload);

      expect(logSpy).toHaveBeenCalledWith("LIVE TICK RECEIVED:", payload);
      logSpy.mockRestore();
    });
  });

  describe("4. Timestamp Validation (Stale Data Rejection)", () => {
    it("normalizes both Unix seconds and millisecond quote timestamps", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const nowMs = Date.now();
      expect(normalizeQuoteTimestampMs({ ts: nowSec })).toBe(nowSec * 1000);
      expect(normalizeQuoteTimestampMs({ t: nowSec })).toBe(nowSec * 1000);
      expect(normalizeQuoteTimestampMs({ timestamp: nowMs })).toBe(nowMs);
    });

    it("rejects quotes > 5 minutes old when the market is OPEN without updating globalStore.currentPrice", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      globalStore.clearData("AAPL");
      expect(globalStore.currentPrice).toBeNull();

      // Quote timestamp is 6 minutes old (> 5-minute threshold) while market is OPEN
      const sixMinutesAgoSec = Math.floor((Date.now() - (MAX_QUOTE_AGE_OPEN_MARKET_MS + 60_000)) / 1000);
      const accepted = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        c: 229.50,
        t: sixMinutesAgoSec,
        isMarketOpen: true,
      });

      expect(accepted).toBe(false);
      // Global store price MUST NOT be updated
      expect(globalStore.currentPrice).toBeNull();
      expect(globalStore.getState().prices["AAPL"]).toBeUndefined();
      // Triggers UI error state [ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ] and reconnect state
      expect(globalStore.getState().staleQuoteRejected).toBe(true);
      expect(globalStore.getState().dataFeedError).toBe(STALE_QUOTE_ERROR_MESSAGE);
      expect(globalStore.getState().dataFeedError).toBe("[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]");
      expect(globalStore.getState().isReconnecting).toBe(true);

      // UI components render the stale quote error badge
      expect(dashboardSrc).toContain("[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]");
      expect(tradingCardSrc).toContain("[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]");
      expect(actionCenterSrc).toContain("[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]");

      warnSpy.mockRestore();
    });

    it("clears the stale quote error state immediately when a fresh live quote arrives", () => {
      const sixMinutesAgoSec = Math.floor((Date.now() - (MAX_QUOTE_AGE_OPEN_MARKET_MS + 60_000)) / 1000);
      globalStore.validateAndApplyTick({
        symbol: "AAPL",
        c: 229.50,
        t: sixMinutesAgoSec,
        isMarketOpen: true,
      });
      expect(globalStore.getState().staleQuoteRejected).toBe(true);

      // Fresh quote arrives (2 seconds old)
      const freshSec = Math.floor((Date.now() - 2_000) / 1000);
      const accepted = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        c: 231.25,
        t: freshSec,
        isMarketOpen: true,
      });

      expect(accepted).toBe(true);
      expect(globalStore.currentPrice).toBe(231.25);
      expect(globalStore.getState().staleQuoteRejected).toBe(false);
      expect(globalStore.getState().dataFeedError).toBeNull();
    });
  });
});

