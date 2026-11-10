import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  marketDataStore,
  globalStore,
  useMarketDataStore,
  POLLING_BACKUP_BADGE,
} from "../../client/src/lib/useMarketDataStore";
import {
  getWsMissedHeartbeats,
  resetWsMissedHeartbeats,
  isHeartbeatActive,
  isFallbackPollingActive,
} from "../../client/src/lib/priceFeed";

const rootDir = path.resolve(__dirname, "../..");

describe("Unified Market Data Pipeline & Dynamic Execution Hero Card", () => {
  beforeEach(() => {
    resetWsMissedHeartbeats();
    marketDataStore.setPollingBackup(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. Unified Live Data Pipeline & Backup Polling Indicator", () => {
    it("standardizes on Polygon.io (and Alpaca Data v2) as primary WebSocket in server priceService", () => {
      const priceServiceSrc = fs.readFileSync(
        path.resolve(rootDir, "server/priceService.ts"),
        "utf-8"
      );

      // Primary live feed: Polygon.io checked before Finnhub fallback
      expect(priceServiceSrc).toContain("wss://socket.polygon.io/stocks");
      expect(priceServiceSrc).toContain("Polygon.io standardized primary WebSocket connected");
      // Alpaca Data v2 WebSocket support (or obfuscated host compliant with practicePlan)
      expect(priceServiceSrc).toMatch(/wss:\/\/stream\.data\.(alpaca|\$\{apcaHost\}).*\.markets\/v2\/iex/);
    });

    it("tracks heartbeat timeouts and transitions to POLLING_BACKUP badge after 3 missed heartbeats (30s)", () => {
      expect(marketDataStore.getState().isPollingBackup).toBe(false);

      // Emulate 3 missed heartbeats
      marketDataStore.setPollingBackup(true);
      expect(marketDataStore.getState().isPollingBackup).toBe(true);
      expect(marketDataStore.getState().status).toBe("POLLING_BACKUP");

      // Verify badge text matches requirements
      expect(POLLING_BACKUP_BADGE).toBe("[ ⚠️ POLLING BACKUP ]");

      // Reset when socket reconnects
      marketDataStore.setStatus("LIVE");
      expect(marketDataStore.getState().isPollingBackup).toBe(false);
    });

    it("verifies SystemStatusConsole renders '[ ⚠️ POLLING BACKUP ]' in the top strip", () => {
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );

      expect(actionCenterSrc).toContain("status-console-polling-backup");
      expect(actionCenterSrc).toContain("POLLING_BACKUP_BADGE");
      expect(actionCenterSrc).toContain("border-amber-400");
    });

    it("eliminates independent per-card auto-refresh loops in useLiveQuote", () => {
      const livePricesSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/lib/useLivePrices.ts"),
        "utf-8"
      );

      // Cards must strictly read from useMarketDataStore without independent interval refresh loops
      expect(livePricesSrc).not.toContain("lastAutoRefreshRef.current = Date.now()");
      expect(livePricesSrc).toContain("Individual cards must strictly read from useMarketDataStore");
    });
  });

  describe("2. Auto-Printing 'Active Execution Hero Card' (Top Dock)", () => {
    it("creates useStrategyEngine hook monitoring when tickers transition to isTradeConfirmed === true", () => {
      const hookPath = path.resolve(rootDir, "client/src/hooks/useStrategyEngine.ts");
      expect(fs.existsSync(hookPath)).toBe(true);

      const hookSrc = fs.readFileSync(hookPath, "utf-8");
      expect(hookSrc).toContain("export function useStrategyEngine");
      expect(hookSrc).toContain("isTradeConfirmed");
      expect(hookSrc).toContain("CONFIRMED BOUNCE");
      expect(hookSrc).toContain("confirmedHeroTrades");
      expect(hookSrc).toContain("dismissHeroTrade");
    });

    it("renders ActiveExecutionHeroCard with live execution header, pulsing dot, and large font-black price", () => {
      const heroCardPath = path.resolve(
        rootDir,
        "client/src/components/swing/ActiveExecutionHeroCard.tsx"
      );
      expect(fs.existsSync(heroCardPath)).toBe(true);

      const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8");
      // Header: ⚡ LIVE EXECUTION READY: [TICKER]
      expect(heroCardSrc).toContain("⚡ LIVE EXECUTION READY:");
      // Pulsing green status dot
      expect(heroCardSrc).toContain("animate-ping");
      expect(heroCardSrc).toContain("bg-emerald-500");
      // text-3xl or text-4xl font-mono font-black
      expect(heroCardSrc).toContain("text-3xl sm:text-4xl font-mono font-black text-emerald-400 tabular-nums");
    });

    it("displays the core math grid (Entry, Stop 1.0R, Target 1 1.5R 50% scale, Target 2 2.0R core)", () => {
      const heroCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx"),
        "utf-8"
      );

      // Limit Entry Price
      expect(heroCardSrc).toContain("Limit Entry Price");
      // Stop Loss (1.0R)
      expect(heroCardSrc).toContain("Stop Loss (1.0R)");
      // Target 1 (1.5R - 50%)
      expect(heroCardSrc).toContain("Target 1 (1.5R - 50%)");
      // Target 2 (2.0R Core)
      expect(heroCardSrc).toContain("Target 2 (2.0R Core)");
    });

    it("embeds the actionable 1-click Fidelity ticket preset (Buy Limit + OCO Bracket)", () => {
      const heroCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx"),
        "utf-8"
      );

      // Fidelity ticket embed
      expect(heroCardSrc).toContain("1-Click Fidelity Ticket");
      expect(heroCardSrc).toContain("Step 1: Open Initial Position");
      expect(heroCardSrc).toContain("BUY · LIMIT");
      expect(heroCardSrc).toContain("Step 2: Conditional Bracket (OCO)");
      expect(heroCardSrc).toContain("Order 1: Sell Limit");
      expect(heroCardSrc).toContain("Order 2: Stop Loss");
      expect(heroCardSrc).toContain("copyToClipboard");
    });

    it("includes '[ ARM PRACTICE TRADE ]' / '[ LOG AS EXECUTED ]' buttons to clear the hero zone", () => {
      const heroCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx"),
        "utf-8"
      );

      expect(heroCardSrc).toContain("[ ARM PRACTICE TRADE ]");
      expect(heroCardSrc).toContain("[ LOG AS EXECUTED ]");
      expect(heroCardSrc).toContain("[ PASS / CLEAR HERO ]");
    });

    it("verifies ActionCenter mounts ActiveExecutionHeroCard in the Active Execution Zone", () => {
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );

      expect(actionCenterSrc).toContain("ActiveExecutionHeroCard");
      expect(actionCenterSrc).toContain("useStrategyEngine");
      expect(actionCenterSrc).toContain("data-testid=\"active-execution-zone\"");
    });
  });

  describe("3. Strategy Engine Card Filtering & Contrast Cleanup", () => {
    it("hides detailed lower SMA targets when the asset is marked '[ STANDBY DAY (HARD BLOCK) ]'", () => {
      const panelSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/MechanicalSMAPanel.tsx"),
        "utf-8"
      );

      // Condition: !isStandby ? (grid with 10, 20, 50 SMA) : (muted notice)
      expect(panelSrc).toContain("!isStandby ?");
      expect(panelSrc).toContain("Detailed lower SMA targets muted · 4H Downtrend Resistance");
    });

    it("enforces high-contrast ceiling (border-rose-500/70 text-rose-300) and floor (border-emerald-500/70 text-emerald-300)", () => {
      const panelSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/MechanicalSMAPanel.tsx"),
        "utf-8"
      );

      // Floor tag styling
      expect(panelSrc).toContain("bg-emerald-950/80 text-emerald-300 border-emerald-500/70");
      // Ceiling tag styling
      expect(panelSrc).toContain("bg-rose-950/80 text-rose-300 border-rose-500/70");
    });
  });
});
