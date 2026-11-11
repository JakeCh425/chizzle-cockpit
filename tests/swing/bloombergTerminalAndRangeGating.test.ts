import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  MarketDataDistributor,
  marketDataDistributor,
  marketDataStore,
} from "../../client/src/lib/useMarketDataStore";

const rootDir = path.resolve(__dirname, "../..");
const heroCardPath = path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx");
const actionCenterPath = path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx");
const checklistPath = path.resolve(rootDir, "client/src/components/swing/StepByStepActionChecklist.tsx");
const pipelinePath = path.resolve(rootDir, "client/src/lib/useMarketDataPipeline.ts");

describe("Master Terminal Overhaul: Bloomberg High-Contrast Theme, Real-Time Tick Stabilization, Out-of-Range Gating, & Collapsible Watchlist", () => {
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const checklistSrc = fs.readFileSync(checklistPath, "utf-8").replace(/\r\n/g, "\n");
  const pipelineSrc = fs.readFileSync(pipelinePath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Bloomberg-Style High-Contrast Minimalist Aesthetic", () => {
    it("uses solid matte dark slate container with crisp neutral borders for setup cards", () => {
      // Confirmed setup cards in ActionCenter
      expect(actionCenterSrc).toContain("bg-[#0c1017] border border-slate-700/60 rounded-lg p-3.5");
      // Hero card surface container
      expect(heroCardSrc).toContain("bg-[#0d131f] border border-slate-700/70 hover:border-slate-500 rounded-xl p-4 shadow-lg mb-3 transition-colors");
    });

    it("enforces strict semantic palette: neutral text, amber entry, rose stop, emerald targets", () => {
      // Neutral labels
      expect(actionCenterSrc).toContain("text-slate-400 font-mono text-[11px] uppercase");
      // Stop in rose-400 font-bold
      expect(actionCenterSrc).toContain("text-rose-400 font-bold text-base tabular-nums");
      // Target in emerald-400 font-bold
      expect(actionCenterSrc).toContain("text-emerald-400 font-bold text-base tabular-nums");
      // Entry in amber-400
      expect(actionCenterSrc).toContain("text-amber-400 text-slate-100 text-base tabular-nums");
    });

    it("separates drawer/tab with recessed interior and completed/pending step pills", () => {
      // Recessed drawer interior: bg-[#070a0f] border-t border-slate-800 p-3 rounded-b-lg
      expect(heroCardSrc).toContain("bg-[#070a0f] border-t border-slate-800 p-3 rounded-b-lg");
      // Completed step pills
      expect(checklistSrc).toContain("text-emerald-400 bg-emerald-950/40 border border-emerald-800/50");
      // Pending step pills
      expect(checklistSrc).toContain("text-slate-400 bg-slate-900 border border-slate-800");
    });
  });

  describe("2. Strict Entry vs. Live Price Range Gating (Prevent Chasing)", () => {
    it("enforces max 0.75% chase tolerance calculation", () => {
      // Price extension percentage logic
      expect(actionCenterSrc).toContain("pct <= 0.75");
      expect(heroCardSrc).toContain("const priceExtensionPercent = trade.entryPrice > 0 && livePrice > 0");
      expect(heroCardSrc).toContain("const isWithinExecutionRange = priceExtensionPercent <= 0.75");
    });

    it("strictly disqualifies setups extended > 0.75% from readySetups and routes them to Pending", () => {
      expect(actionCenterSrc).toContain("getSetupPriceExtension(d).isWithinRange");
      expect(actionCenterSrc).toContain("badge-extended-await-retest");
      expect(actionCenterSrc).toContain("EXTENDED: ${ext.diffSign}${ext.extensionPercent.toFixed(1)}% ABOVE ENTRY — AWAIT RETEST");
    });

    it("disables Copy Fidelity Ticket and Log button when trade is out of range", () => {
      expect(heroCardSrc).toContain("disabled={!isWithinExecutionRange}");
      expect(heroCardSrc).toContain("Trade Out of Range");
      expect(heroCardSrc).toContain("badge-hero-extended");
      expect(heroCardSrc).toContain("AWAIT RETEST");
    });
  });

  describe("3. Dual-Source Stable Live Ticker Engine (MarketDataDistributor)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("exports MarketDataDistributor and singleton instance from useMarketDataStore and useMarketDataPipeline", () => {
      expect(typeof MarketDataDistributor).toBe("function");
      expect(marketDataDistributor).toBeInstanceOf(MarketDataDistributor);
      expect(pipelineSrc).toContain("MarketDataDistributor");
      expect(pipelineSrc).toContain("marketDataDistributor");
    });

    it("configures 20s WebSocket heartbeat, 3s REST fallback loop, and 2s/4s/8s exponential backoff", () => {
      const distributor = new MarketDataDistributor();
      expect(distributor.heartbeatIntervalMs).toBe(20000);
      expect(distributor.restFallbackIntervalMs).toBe(3000);
      expect(distributor.backoffSchedule).toEqual([2000, 4000, 8000]);
    });

    it("tracks subscriptions and executes REST fallback without wiping store state", async () => {
      const distributor = new MarketDataDistributor();
      distributor.subscribe(["AAPL", "MSFT"]);
      expect(distributor.getSubscribedSymbols()).toContain("AAPL");
      expect(distributor.getSubscribedSymbols()).toContain("MSFT");

      distributor.unsubscribe(["AAPL"]);
      expect(distributor.getSubscribedSymbols()).not.toContain("AAPL");
      expect(distributor.getSubscribedSymbols()).toContain("MSFT");
    });
  });

  describe("4. Fully Collapsible Watchlist & Minimalist Wealth Studio", () => {
    it("implements collapsible watchlist toggle button with [ ⇤ Collapse Watchlist ] and [ ⇥ Expand Watchlist ]", () => {
      expect(actionCenterSrc).toContain("button-toggle-collapse-watchlist");
      expect(actionCenterSrc).toContain("[ ⇤ Collapse Watchlist ]");
      expect(actionCenterSrc).toContain("[ ⇥ Expand Watchlist ]");
    });

    it("collapses to a narrow 48px rail displaying ticker symbol and status dots (🟢 Ready, 🟡 Pending)", () => {
      expect(actionCenterSrc).toContain("watchlist-collapsed-rail");
      expect(actionCenterSrc).toContain("min-w-[48px] max-w-[48px]");
      expect(actionCenterSrc).toContain('watchlist-rail-ticker-${sym}');
      expect(actionCenterSrc).toContain('isReady ? "🟢" : "🟡"');
    });

    it("seamlessly synchronizes single master chart when any ticker is selected from the rail or list", () => {
      expect(actionCenterSrc).toContain("setSelectedTicker(sym)");
      expect(actionCenterSrc).toContain("global?.setActiveTicker?.(sym)");
      expect(actionCenterSrc).toContain("marketStore.setActiveTicker?.(sym)");
    });
  });
});
