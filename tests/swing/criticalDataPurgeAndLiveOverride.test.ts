import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  globalStore,
  initialState,
  extractQuotePrice,
  purgeStaleLocalStorageOnBoot,
  clearStaleCachedPrices,
  MAX_CACHE_AGE_OPEN_MARKET_MS,
  CACHE_TIMESTAMP_KEY,
  CACHE_VERSION_KEY,
  CACHE_VERSION,
  CONNECTING_TO_EXCHANGE_BADGE,
} from "../../client/src/lib/useMarketDataStore";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";

describe("CRITICAL DATA PURGE - Eradicate Stale State, Clear Cache, and Enforce Live Pipeline", () => {
  const watchlistPath = path.resolve(__dirname, "../../client/src/lib/wealthWatchlist.ts");
  const watchlistSrc = fs.readFileSync(watchlistPath, "utf-8").replace(/\r\n/g, "\n");

  const marketStorePath = path.resolve(__dirname, "../../client/src/lib/useMarketDataStore.ts");
  const marketStoreSrc = fs.readFileSync(marketStorePath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedSrc = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const appPath = path.resolve(__dirname, "../../client/src/App.tsx");
  const appSrc = fs.readFileSync(appPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  beforeEach(() => {
    globalStore.clearData("AAPL");
  });

  describe("1. Global Search & Destroy (Hardcoded Ghost Data)", () => {
    it("completely eradicates 232.15, 252, and 252.00 from watchlist, global store, and state files", () => {
      const forbidden232 = ["232", "15"].join(".");
      const forbidden252Dec = ["252", "00"].join(".");
      const forbidden252Regex = /\b252(\.00)?\b/;

      expect(watchlistSrc).not.toContain(forbidden232);
      expect(watchlistSrc).not.toContain(forbidden252Dec);
      expect(watchlistSrc).not.toMatch(forbidden252Regex);

      expect(marketStoreSrc).not.toContain(forbidden232);
      expect(marketStoreSrc).not.toContain(forbidden252Dec);
      expect(marketStoreSrc).not.toMatch(forbidden252Regex);

      expect(globalStateSrc).not.toContain(forbidden232);
      expect(globalStateSrc).not.toContain(forbidden252Dec);

      expect(priceFeedSrc).not.toContain(forbidden232);
      expect(priceFeedSrc).not.toContain(forbidden252Dec);

      const aaplItem = DEFAULT_WATCHLIST.find((i) => i.symbol === "AAPL");
      expect(aaplItem?.price).toBe(0);
      expect(initialState.currentPrice).toBeNull();
    });
  });

  describe("2. Purge Stale LocalStorage on Boot (15-Minute Cache Invalidation)", () => {
    it("injects mount lifecycle cache check in App.tsx and GlobalStateProvider before WebSocket init", () => {
      expect(MAX_CACHE_AGE_OPEN_MARKET_MS).toBe(15 * 60 * 1000);
      expect(appSrc).toContain("purgeStaleLocalStorageOnBoot()");
      expect(globalStateSrc).toContain("purgeStaleLocalStorageOnBoot()");
      expect(marketStoreSrc).toContain('localStorage.removeItem("your_store_key")');
      expect(marketStoreSrc).toContain('localStorage.removeItem("chizzle-wealth-watchlist")');
    });

    it("wipes localStorage store keys when cached data is older than 15 minutes and market is OPEN", () => {
      const mockStorage: Record<string, string> = {};
      const origWindow = (globalThis as any).window;
      const origLocalStorage = (globalThis as any).localStorage;

      const localStorageMock = {
        getItem: vi.fn((k: string) => (k in mockStorage ? mockStorage[k] : null)),
        setItem: vi.fn((k: string, v: string) => {
          mockStorage[k] = String(v);
        }),
        removeItem: vi.fn((k: string) => {
          delete mockStorage[k];
        }),
      };

      (globalThis as any).window = globalThis;
      (globalThis as any).localStorage = localStorageMock;

      try {
        const nowMs = Date.now();
        // Seed 20-minute-old cache (> 15 minutes) with matching version
        mockStorage[CACHE_VERSION_KEY] = CACHE_VERSION;
        mockStorage[CACHE_TIMESTAMP_KEY] = String(nowMs - 20 * 60 * 1000);
        mockStorage["your_store_key"] = JSON.stringify({ AAPL: 232.15 });
        mockStorage["chizzle-wealth-watchlist"] = JSON.stringify([{ symbol: "AAPL", price: 232.15 }]);

        const purged = purgeStaleLocalStorageOnBoot({
          nowMs,
          marketOpenOverride: true,
        });

        expect(purged).toBe(true);
        expect(localStorageMock.removeItem).toHaveBeenCalledWith("your_store_key");
        expect(localStorageMock.removeItem).toHaveBeenCalledWith("chizzle-wealth-watchlist");
        expect(mockStorage["your_store_key"]).toBeUndefined();
        expect(mockStorage["chizzle-wealth-watchlist"]).toBeUndefined();
      } finally {
        (globalThis as any).window = origWindow;
        (globalThis as any).localStorage = origLocalStorage;
      }
    });
  });

  describe("3. Strict Live Data Pipeline & Dev Logger (No Silent Failures)", () => {
    it("maps payload.p, payload.lastPrice, payload.c, and payload.price directly to globalStore.currentPrice", () => {
      expect(extractQuotePrice({ p: 228.45 })).toBe(228.45);
      expect(extractQuotePrice({ lastPrice: 229.10 })).toBe(229.10);
      expect(extractQuotePrice({ c: 230.25 })).toBe(230.25);
      expect(extractQuotePrice({ price: 231.00 })).toBe(231.00);

      globalStore.clearData("AAPL");
      expect(globalStore.currentPrice).toBeNull();

      const appliedP = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        p: 228.45,
        t: Math.floor(Date.now() / 1000),
      });
      expect(appliedP).toBe(true);
      expect(globalStore.currentPrice).toBe(228.45);

      const appliedLastPrice = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        lastPrice: 229.10,
        t: Math.floor(Date.now() / 1000),
      });
      expect(appliedLastPrice).toBe(true);
      expect(globalStore.currentPrice).toBe(229.10);
    });

    it("logs '🟢 LIVE TICK OVERRIDE:' with { ticker, price } when live ticks hit the store", () => {
      expect(marketStoreSrc).toContain("console.log('🟢 LIVE TICK OVERRIDE:', { ticker: msg.symbol, price: msg.price });");
      expect(priceFeedSrc).toContain("console.log('🟢 LIVE TICK OVERRIDE:', { ticker: msg.symbol, price: msg.price });");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      globalStore.clearData("AAPL");
      globalStore.validateAndApplyTick({
        symbol: "AAPL",
        p: 231.80,
        t: Math.floor(Date.now() / 1000),
      });

      expect(logSpy).toHaveBeenCalledWith("🟢 LIVE TICK OVERRIDE:", {
        ticker: "AAPL",
        price: 231.80,
      });
      logSpy.mockRestore();
    });
  });

  describe("4. Enforce Strict Loading / Skeleton States ([ 🔄 CONNECTING TO EXCHANGE... ])", () => {
    it("renders [ 🔄 CONNECTING TO EXCHANGE... ] and pulsing skeleton overlays when currentPrice === null or 0", () => {
      expect(CONNECTING_TO_EXCHANGE_BADGE).toBe("[ 🔄 CONNECTING TO EXCHANGE... ]");

      expect(dashboardSrc).toContain("[ 🔄 CONNECTING TO EXCHANGE... ]");
      expect(dashboardSrc).toContain('data-testid="badge-chart-connecting-exchange"');
      expect(dashboardSrc).toContain('data-testid="badge-header-connecting-exchange"');
      expect(dashboardSrc).toContain('data-testid="badge-setup-card-connecting-exchange"');
      expect(dashboardSrc).toContain('data-testid="skeleton-overlay-connecting-exchange"');
      expect(dashboardSrc).toContain("marketStore.currentPrice === 0");

      expect(tradingCardSrc).toContain("[ 🔄 CONNECTING TO EXCHANGE... ]");
      expect(tradingCardSrc).toContain('data-testid={`badge-connecting-exchange-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`skeleton-overlay-connecting-${d.symbol}`}');
      expect(tradingCardSrc).toContain("market.currentPrice === 0");

      expect(actionCenterSrc).toContain("[ 🔄 CONNECTING TO EXCHANGE... ]");
      expect(actionCenterSrc).toContain('data-testid={`badge-exec-connecting-${d.symbol}`}');
      expect(actionCenterSrc).toContain('data-testid={`skeleton-exec-connecting-${d.symbol}`}');
      expect(actionCenterSrc).toContain("marketStore.currentPrice === 0");
    });
  });
});

