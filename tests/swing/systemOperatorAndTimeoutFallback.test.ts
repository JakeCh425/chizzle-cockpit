import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  globalStore,
  LIVE_EXCHANGE_TIMEOUT_MS,
  STATIC_LAST_CLOSE_BADGE,
} from "../../client/src/lib/useMarketDataStore";

describe("Fix Infinite Loading State & Build System Operator Dashboard UI", () => {
  const marketStorePath = path.resolve(__dirname, "../../client/src/lib/useMarketDataStore.ts");
  const marketStoreSrc = fs.readFileSync(marketStorePath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedSrc = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  beforeEach(() => {
    globalStore.clearData("AAPL");
  });

  describe("1. Fix Infinite Loading Loop (10-Second Timeout Fallback to Last Official Close)", () => {
    it("enforces a strict 10-second timeout fallback (LIVE_EXCHANGE_TIMEOUT_MS = 10000) to Last Official Close", () => {
      expect(LIVE_EXCHANGE_TIMEOUT_MS).toBe(10_000);
      expect(STATIC_LAST_CLOSE_BADGE).toBe("[ ⏸️ STATIC: LAST CLOSE ]");

      expect(marketStoreSrc).toContain("triggerTimeoutFallback");
      expect(marketStoreSrc).toContain("applyStaticLastClose");
      expect(priceFeedSrc).toContain("LIVE_EXCHANGE_TIMEOUT_MS");
      expect(priceFeedSrc).toContain("triggerTimeoutFallback");
      expect(globalStateSrc).toContain("triggerTimeoutFallback");
      expect(tradingCardSrc).toContain("triggerTimeoutFallback");
      expect(dashboardSrc).toContain("triggerTimeoutFallback");
    });

    it("populates AAPL with Last Official Close, sets isLoading to false, and activates [ ⏸️ STATIC: LAST CLOSE ] on timeout fallback", async () => {
      globalStore.clearData("AAPL");
      expect(globalStore.currentPrice).toBeNull();
      expect(globalStore.getState().isLoading).toBe(true);
      expect(globalStore.getState().isLoadingTicker).toBe(true);
      expect(globalStore.getState().isStaticLastClose).toBe(false);

      const resolvedPrice = await globalStore.triggerTimeoutFallback("AAPL", 234.80);

      expect(resolvedPrice).toBe(234.80);
      expect(globalStore.currentPrice).toBe(234.80);
      expect(globalStore.getState().prices["AAPL"]).toBe(234.80);
      expect(globalStore.getState().isLoading).toBe(false);
      expect(globalStore.getState().isLoadingTicker).toBe(false);
      expect(globalStore.getState().isStaticLastClose).toBe(true);
      expect(globalStore.getState().status).toBe("STATIC");
    });

    it("clears static last close mode immediately when a live tick arrives", async () => {
      await globalStore.triggerTimeoutFallback("AAPL", 234.80);
      expect(globalStore.getState().isStaticLastClose).toBe(true);

      const applied = globalStore.validateAndApplyTick({
        symbol: "AAPL",
        p: 235.40,
        t: Math.floor(Date.now() / 1000),
      });
      expect(applied).toBe(true);
      expect(globalStore.currentPrice).toBe(235.40);
      expect(globalStore.getState().isLoading).toBe(false);
      expect(globalStore.getState().isStaticLastClose).toBe(false);
      expect(globalStore.getState().status).toBe("LIVE");
    });

    it("renders [ ⏸️ STATIC: LAST CLOSE ] badge across TradingCard, ActionCenter, and WealthEngineDashboard", () => {
      expect(tradingCardSrc).toContain("[ ⏸️ STATIC: LAST CLOSE ]");
      expect(tradingCardSrc).toContain('data-testid={`badge-static-last-close-${d.symbol}`}');
      expect(actionCenterSrc).toContain("[ ⏸️ STATIC: LAST CLOSE ]");
      expect(actionCenterSrc).toContain('data-testid={`badge-exec-static-last-close-${d.symbol}`}');
      expect(dashboardSrc).toContain("[ ⏸️ STATIC: LAST CLOSE ]");
      expect(dashboardSrc).toContain('data-testid="badge-setup-card-static-last-close"');
    });
  });

  describe("2. Build Professional System Operator UI", () => {
    it("Action 1 (Status Console): renders dedicated narrow System Status strip above Action Center header with WebSocket, Latency, Market State, and Last Sync", () => {
      expect(actionCenterSrc).toContain("export function SystemStatusConsole()");
      expect(actionCenterSrc).toContain('data-testid="system-status-console"');
      expect(actionCenterSrc).toContain('data-testid="status-console-websocket"');
      expect(actionCenterSrc).toContain("WebSocket:");
      expect(actionCenterSrc).toContain('isConnected ? "CONNECTED" : "DISCONNECTED"');
      expect(actionCenterSrc).toContain('data-testid="status-console-latency"');
      expect(actionCenterSrc).toContain("Latency:");
      expect(actionCenterSrc).toContain("{latencyMs} ms");
      expect(actionCenterSrc).toContain('data-testid="status-console-market-state"');
      expect(actionCenterSrc).toContain("Market State:");
      expect(actionCenterSrc).toContain('isMarketOpenNow ? "OPEN" : "CLOSED"');
      expect(actionCenterSrc).toContain('data-testid="status-console-last-sync"');
      expect(actionCenterSrc).toContain("Last Sync:");

      // Verify SystemStatusConsole is mounted above the Action Center header
      const consoleIdx = actionCenterSrc.indexOf("<SystemStatusConsole />");
      const headerIdx = actionCenterSrc.indexOf("<EditableTitle value={title}");
      expect(consoleIdx).toBeGreaterThan(-1);
      expect(headerIdx).toBeGreaterThan(consoleIdx);
    });

    it("Action 2 (Card Typography & Density): uses sleek rotating spinner, strict font-mono tabular-nums, and compact truncated Summary Strip", () => {
      expect(tradingCardSrc).toContain("animate-spin");
      expect(tradingCardSrc).toContain('data-testid={`spinner-connecting-${d.symbol}`}');
      expect(tradingCardSrc).toContain("font-mono tabular-nums");
      expect(tradingCardSrc).toContain("px-2.5 py-1.5 my-1 rounded-lg border border-[var(--card-border)] bg-slate-900/60 font-mono tabular-nums text-xs shadow-inner overflow-hidden truncate");
    });

    it("Action 3 (Skeleton States): renders pulsing low-opacity skeleton structure mimicking number layout", () => {
      const skeletonBar = '<div className="h-4 bg-gray-700 rounded w-24 animate-pulse"></div>';
      expect(tradingCardSrc).toContain(skeletonBar);
      expect(actionCenterSrc).toContain(skeletonBar);
      expect(dashboardSrc).toContain(skeletonBar);
    });
  });
});

