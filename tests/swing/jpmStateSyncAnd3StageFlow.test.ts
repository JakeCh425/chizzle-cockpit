import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

// Mock localStorage and window in Node test runner environment
const storageStore = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => storageStore.get(k) ?? null,
  setItem: (k: string, v: string) => { storageStore.set(k, String(v)); },
  removeItem: (k: string) => { storageStore.delete(k); },
  clear: () => { storageStore.clear(); },
};
if (typeof (globalThis as any).localStorage === "undefined") {
  (globalThis as any).localStorage = localStorageMock;
}
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    localStorage: localStorageMock,
    dispatchEvent: () => true,
    addEventListener: () => {},
  };
}

import {
  tradeSetupStore,
  useTradeSetupStore,
  type SetupStageInfo,
} from "../../client/src/lib/useTradeSetupStore";
import { fetchBarsWithFallback } from "../../client/src/lib/swing";

const rootDir = path.resolve(__dirname, "../..");

describe("Master Pipeline Fix - JPM State Sync, 3-Stage Beginner Flow & Resilient Chart Fetching", () => {
  beforeEach(() => {
    // Reset store state before each test
    tradeSetupStore.clearDismissed();
    const state = tradeSetupStore.getState();
    state.activeExecutionSetups = [];
    state.stages = {};
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. Fix Active Banner Desync (JPM Alert vs. UI State)", () => {
    it("subscribes to centralized tradeSetupStore and synchronizes confirmed JPM alert from backend audit log", () => {
      // Simulate backend audit log entry for JPM (confirmed 1H close alert sent to Telegram)
      const auditLogBySymbol = {
        JPM: {
          symbol: "JPM",
          alertType: "CONFIRMED_1H_20SMA" as const,
          status: "SENT" as const,
          channel: "telegram" as const,
          firedAt: Date.now() - 60000,
          entryPrice: 224.5,
          stopLoss: 221.1,
          target1: 229.6,
          calculatedShares: 73,
          source: "scanner" as const,
        },
      };

      // Call store sync
      tradeSetupStore.syncFromBackendAuditLog(auditLogBySymbol);

      const state = tradeSetupStore.getState();
      expect(state.activeExecutionSetups).toHaveLength(1);
      const jpmTrade = state.activeExecutionSetups[0];

      expect(jpmTrade.symbol).toBe("JPM");
      expect(jpmTrade.isTradeConfirmed).toBe(true);
      expect(jpmTrade.status).toBe("CONFIRMED BOUNCE");
      expect(jpmTrade.entryPrice).toBe(224.5);
      expect(jpmTrade.stopLoss).toBe(221.1);
      expect(jpmTrade.shares).toBe(73);

      // Verify stage is automatically set to Stage 3
      const jpmStage = tradeSetupStore.getStage("JPM");
      expect(jpmStage).not.toBeNull();
      expect(jpmStage?.stage).toBe(3);
      expect(jpmStage?.stageBadge).toBe("[ ⚡ ACTIVE EXECUTION READY ]");
    });

    it("prevents duplicate entries in activeExecutionSetups on repeated audit log syncs", () => {
      const auditLogBySymbol = {
        JPM: {
          symbol: "JPM",
          alertType: "READY_TO_TRADE" as const,
          status: "SENT" as const,
          channel: "telegram" as const,
          firedAt: Date.now(),
          entryPrice: 225.0,
          stopLoss: 221.5,
          target1: 230.0,
          calculatedShares: 70,
        },
      };

      tradeSetupStore.syncFromBackendAuditLog(auditLogBySymbol);
      tradeSetupStore.syncFromBackendAuditLog(auditLogBySymbol);

      expect(tradeSetupStore.getState().activeExecutionSetups).toHaveLength(1);
    });

    it("allows dismissing hero trade and respects dismissed status", () => {
      tradeSetupStore.setTradeConfirmed("JPM", true, { entryPrice: 224.5 });
      expect(tradeSetupStore.getState().activeExecutionSetups.some((s) => s.symbol === "JPM")).toBe(true);

      tradeSetupStore.dismissHeroTrade("JPM");
      expect(tradeSetupStore.getState().activeExecutionSetups.some((s) => s.symbol === "JPM")).toBe(false);
      expect(tradeSetupStore.getState().dismissedSymbols.has("JPM")).toBe(true);

      // Subsequent syncs should not re-add dismissed symbol unless re-confirmed
      const auditLog = {
        JPM: {
          symbol: "JPM",
          alertType: "CONFIRMED_1H_20SMA" as const,
          status: "SENT" as const,
          channel: "telegram" as const,
          firedAt: Date.now(),
          entryPrice: 224.5,
          stopLoss: 221.1,
          target1: 229.6,
          calculatedShares: 73,
        },
      };
      tradeSetupStore.syncFromBackendAuditLog(auditLog);
      expect(tradeSetupStore.getState().activeExecutionSetups.some((s) => s.symbol === "JPM")).toBe(false);
    });

    it("verifies ActionCenter merges useTradeSetupStore active setups with strategy engine", () => {
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );

      // ActionCenter must read storeActiveSetups from useTradeSetupStore
      expect(actionCenterSrc).toContain("useTradeSetupStore");
      expect(actionCenterSrc).toContain("storeActiveSetups");
      // Must merge both storeActiveSetups and strategyEngine.confirmedHeroTrades
      expect(actionCenterSrc).toMatch(/map\.set\(t\.symbol\.toUpperCase\(\),\s*t\)/);
      // Hero Card render check: iterates over heroTrades and renders ActiveExecutionHeroCard
      expect(actionCenterSrc).toContain("<ActiveExecutionHeroCard");
      expect(actionCenterSrc).toContain("heroTrades.map");
    });

    it("verifies useNotificationAuditLog synchronizes backend alerts with tradeSetupStore", () => {
      const hookSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/hooks/useNotificationAuditLog.ts"),
        "utf-8"
      );

      expect(hookSrc).toContain("tradeSetupStore.syncFromBackendAuditLog(bySymbol)");
    });

    it("guards ActionCenter against missing React hook imports (useMemo, useCallback, useRef, useState, useEffect)", () => {
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );

      expect(actionCenterSrc).toMatch(/import\s+React,\s*\{\s*[^}]*\buseMemo\b[^}]*\}\s*from\s+["']react["']/);
      expect(actionCenterSrc).toMatch(/import\s+React,\s*\{\s*[^}]*\buseCallback\b[^}]*\}\s*from\s+["']react["']/);
    });
  });

  describe("2. Fix Chart Data Freeze ('Loading 4H bars...' & 'Scan Failed')", () => {
    it("wraps historical bar fetching in strict 8-second AbortController timeout", () => {
      const swingSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/lib/swing.ts"),
        "utf-8"
      );

      expect(swingSrc).toContain("AbortController");
      expect(swingSrc).toContain("8000");
      expect(swingSrc).toContain("fetchBarsWithFallback");
    });

    it("falls back to cached localStorage bars if primary bar fetch fails", async () => {
      const cachedBarsPayload = {
        symbol: "JPM",
        tf: "4H",
        range: "3M",
        bars: [
          { time: 1700000000, open: 220, high: 225, low: 219, close: 224, volume: 1000000 },
          { time: 1700014400, open: 224, high: 228, low: 223, close: 227, volume: 1200000 },
        ],
      };
      localStorageMock.setItem("chizzle_cached_bars_JPM_4H", JSON.stringify(cachedBarsPayload));

      // Global fetch mock to simulate network failure / timeout
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout after 8000ms"));

      try {
        const result = await fetchBarsWithFallback("JPM", "4H", "3M", false);
        expect(result.bars).toHaveLength(2);
        expect(result.isStatic).toBe(true);
        expect(result.source).toBe("STATIC");
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("generates resilient static fallback bars if cache is also missing to prevent permanent loading spinner", async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("Service Unavailable 503"));

      try {
        const result = await fetchBarsWithFallback("XYZ_UNCACHED", "4H", "3M", false);
        expect(result.bars.length).toBeGreaterThan(0);
        expect(result.isStatic).toBe(true);
        expect(result.source).toBe("STATIC");
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("verifies SwingChart renders '[ ⚠️ STATIC 4H BARS ]' badge when static fallback is active", () => {
      const chartSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/SwingChart.tsx"),
        "utf-8"
      );

      expect(chartSrc).toContain("data-testid=\"badge-static-bars\"");
      expect(chartSrc).toContain("[ ⚠️ STATIC {TF_LABEL[tf]} BARS ]");
      expect(chartSrc).toContain("fetchBarsWithFallback");
    });

    it("verifies SwingChart cleans up and flushes series data on symbol switch (e.g., AAPL to JPM)", () => {
      const chartSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/SwingChart.tsx"),
        "utf-8"
      );

      // Check clean symbol transition logic
      expect(chartSrc).toContain("mainRef.current.setData([])");
      expect(chartSrc).toContain("setWaitSec(0)");
    });
  });

  describe("3. Beginner-Friendly 3-Stage Lifecycle Flow (Pending ➔ Waiting ➔ Ready)", () => {
    it("evaluates STAGE 1: [ WATCH / PENDING RETEST ] when price is > 1.0% away from moving averages", () => {
      // 20-SMA is 100, price is 105 (+5.0% away)
      const stage = tradeSetupStore.evaluateSetupStage({
        symbol: "AAPL",
        currentPrice: 105,
        sma20: 100,
        sma50: 95,
        ema10: 103,
        isTradeConfirmed: false,
      });

      expect(stage.stage).toBe(1);
      expect(stage.stageBadge).toBe("[ WATCH / PENDING RETEST ]");
      expect(stage.distanceToSma20Pct).toBe(5.0);
      expect(stage.statusText).toContain("Current Distance to 20-SMA: +5%");
      expect(stage.statusText).toContain("Status: WAITING FOR PULLBACK");
    });

    it("evaluates STAGE 2: [ ⏳ TESTING SUPPORT / AWAITING 1H CLOSE ] when price is within 0.5% of key MA", () => {
      // Fixed time to test countdown: 10:35 AM -> 25 mins to 11:00 AM (next 1H close)
      const mockDate = new Date("2026-11-10T10:35:00Z");

      // 20-SMA is 200, price is 200.60 (0.3% distance <= 0.5%)
      const stage = tradeSetupStore.evaluateSetupStage({
        symbol: "MSFT",
        currentPrice: 200.6,
        sma20: 200.0,
        sma50: 190.0,
        ema10: 204.0,
        isTradeConfirmed: false,
        now: mockDate,
      });

      expect(stage.stage).toBe(2);
      expect(stage.stageBadge).toBe("[ ⏳ TESTING SUPPORT / AWAITING 1H CLOSE ]");
      expect(stage.testedLine).toBe("20_SMA");
      expect(stage.supportFloorPrice).toBe(200.0);
      expect(stage.minsRemaining).toBe(25);
      expect(stage.statusText).toBe(
        "Testing Support Floor ($200.00) | Countdown: Awaiting 1H Bar Close (25 mins remaining)"
      );
    });

    it("evaluates STAGE 2 against 10-EMA when 10-EMA is closest within 0.5%", () => {
      const mockDate = new Date("2026-11-10T14:15:00Z"); // 45 mins remaining

      // 10-EMA is 150.0, price is 150.40 (0.26% distance)
      const stage = tradeSetupStore.evaluateSetupStage({
        symbol: "NVDA",
        currentPrice: 150.4,
        sma20: 145.0,
        sma50: 140.0,
        ema10: 150.0,
        isTradeConfirmed: false,
        now: mockDate,
      });

      expect(stage.stage).toBe(2);
      expect(stage.testedLine).toBe("10_EMA");
      expect(stage.supportFloorPrice).toBe(150.0);
      expect(stage.minsRemaining).toBe(45);
      expect(stage.statusText).toBe(
        "Testing Support Floor ($150.00) | Countdown: Awaiting 1H Bar Close (45 mins remaining)"
      );
    });

    it("evaluates STAGE 3: [ ⚡ ACTIVE EXECUTION READY ] when trade is confirmed (1H closed green)", () => {
      const stage = tradeSetupStore.evaluateSetupStage({
        symbol: "JPM",
        currentPrice: 224.5,
        sma20: 222.0,
        isTradeConfirmed: true,
      });

      expect(stage.stage).toBe(3);
      expect(stage.stageBadge).toBe("[ ⚡ ACTIVE EXECUTION READY ]");
      expect(stage.statusText).toContain("1H candle closed green holding support");
      expect(stage.minsRemaining).toBe(0);
    });

    it("verifies TradingCard applies Neon Emerald border and badges according to stage", () => {
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );

      // Neon emerald border styling for Stage 3
      expect(tradingCardSrc).toContain("border-2 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]");
      // Amber border for Stage 2
      expect(tradingCardSrc).toContain("border border-amber-400/80 shadow-[0_0_15px_rgba(245,158,11,0.2)]");
      // Stage badges in header
      expect(tradingCardSrc).toContain("badge-stage-initializing");
      expect(tradingCardSrc).toContain("badge-stage-3");
      expect(tradingCardSrc).toContain("badge-stage-2");
      expect(tradingCardSrc).toContain("badge-stage-1");
      // Stage status text block
      expect(tradingCardSrc).toContain("stage-status-text");
    });
  });

  describe("4. Dynamic Watchlist CRUD Synchronization", () => {
    it("verifies addTicker immediately renders Stage 1 with '[ INITIALIZING SCAN... ]' and sets 3s timer", () => {
      const globalStateSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/lib/globalState.tsx"),
        "utf-8"
      );

      // Immediate Stage 1 card with initializing badge
      expect(globalStateSrc).toContain("isInitializing: true");
      expect(globalStateSrc).toContain("subscribeSymbol(sym)");
      // 3-second evaluation timer
      expect(globalStateSrc).toContain("setTimeout(");
      expect(globalStateSrc).toContain("3000");
      expect(globalStateSrc).toContain("evaluateSetupStage");
    });

    it("verifies removeTicker cleans active execution setups, unmounts card, and unsubscribes WebSocket", () => {
      const globalStateSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/lib/globalState.tsx"),
        "utf-8"
      );

      expect(globalStateSrc).toContain("tradeSetupStore.removeActiveExecutionSetup(sym)");
      expect(globalStateSrc).toContain("unsubscribeSymbol(sym)");
    });

    it("verifies TradingCard renders [ x ] delete button bound to removeTicker", () => {
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );

      expect(tradingCardSrc).toContain("data-testid={`button-delete-ticker-${d.symbol}`}");
      expect(tradingCardSrc).toContain("global?.removeTicker?.(d.symbol)");
    });
  });

  describe("5. UI Contrast & Readability Guard", () => {
    it("verifies search input uses high-contrast dark theme styling", () => {
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );

      // Search input high-contrast classes
      expect(dashboardSrc).toContain("bg-gray-900 border border-gray-700");
      expect(dashboardSrc).toContain("font-mono font-bold");
      expect(dashboardSrc).toContain("text-white placeholder-gray-400");
    });

    it("verifies SwingWorkspace selects and inputs use high-contrast styling", () => {
      const workspaceSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/SwingWorkspace.tsx"),
        "utf-8"
      );

      // High-contrast background and borders on inputs/selects
      expect(workspaceSrc).toContain("bg-gray-900 border border-slate-700");
      expect(workspaceSrc).toContain("text-white");
    });
  });
});
