import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { getAiTipText } from "../../client/src/components/swing/TradingCard";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("Action Center Routing Bug Fix, Unified Waiting Bucket, Intelligent Sorting & AI Tips", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Fix the Routing Bug (Strict 'Ready' Filtering)", () => {
    it("strictly requires READY_TO_TRADE and ensures no hard blocks, standby days, or wait-and-retest exist", () => {
      expect(actionCenterSrc).toContain("const readySetups = setups.filter(");
      expect(actionCenterSrc).toContain('d.setupStatus === "READY_TO_TRADE" && !d.isStandbyDay && !d.hasHardBlock && !d.isWaitAndRetest');
    });

    it("verifies isConfirmedSetup and heroTrades reject hard blocks and 4H ceiling overrides", () => {
      expect(actionCenterSrc).toContain("(d as any).hasHardBlock");
      expect(actionCenterSrc).toContain("(d as any).isStandbyDay");
      expect(actionCenterSrc).toContain("(d as any).isWaitAndRetest");
    });
  });

  describe("Task 2: Merge the 'Pending & Waiting' Bucket", () => {
    it("combines all non-ready setups into a unified pendingWaitingSetups bucket", () => {
      expect(actionCenterSrc).toContain("const pendingWaitingSetups = setups.filter(");
      expect(actionCenterSrc).toContain("!confirmedSymSet.has(d.symbol) && !lockedSyms.has(d.symbol)");
      expect(actionCenterSrc).toContain("[ ⏳ PENDING & WAITING ]");
      expect(actionCenterSrc).toContain('data-testid="zone-pending-waiting"');
    });

    it("displays the unified count and subtitle for pending, retest, and blocked setups", () => {
      expect(actionCenterSrc).toContain("{generalLoud.length} PENDING");
      expect(actionCenterSrc).toContain("Forming Setups · Waiting For Retest · Missed Entries · Standby Hard Blocks");
    });
  });

  describe("Task 3: Intelligent Sorting & AI Tips (TradingCard.tsx)", () => {
    it("sorts readySetups by engine score in descending order in the Active Execution Zone", () => {
      expect(actionCenterSrc).toContain("readySetups.sort((a, b) => b.score - a.score)");
    });

    it("TradingCard renders AI Edge inline badge with Sparkles icon and text-[10px] text-neon-blue font-medium", () => {
      expect(tradingCardSrc).toContain("text-[10px] text-neon-blue font-medium");
      expect(tradingCardSrc).toContain('data-testid={`badge-ai-tip-${d.symbol}`}');
      expect(tradingCardSrc).toContain("<Sparkles");
    });

    it("getAiTipText returns the exact institutional explanations for ready and blocked states", () => {
      // 1. Ready Setup
      const readyDecision: any = {
        symbol: "NVDA",
        setupStatus: "READY_TO_TRADE",
        hasHardBlock: false,
        isStandbyDay: false,
        isWaitAndRetest: false,
      };
      expect(getAiTipText(readyDecision, "READY")).toBe(
        "AI Edge: 1H momentum aligned with 4H trend, clearing nearest resistance."
      );

      // 2. Blocked by 4H SMA 50 ceiling (SMH, QQQ, or ceiling notes)
      const smhBlockedDecision: any = {
        symbol: "SMH",
        setupStatus: "READY_TO_TRADE",
        hasHardBlock: true,
        notes: "4H Ceiling / Hard Block",
      };
      expect(getAiTipText(smhBlockedDecision)).toBe(
        "AI Edge: Blocked by 4H SMA 50 ceiling. Wait for a reclaim."
      );

      const qqqBlockedDecision: any = {
        symbol: "QQQ",
        setupStatus: "STANDBY_DAY",
        isStandbyDay: true,
        hasHardBlock: true,
      };
      expect(getAiTipText(qqqBlockedDecision)).toBe(
        "AI Edge: Blocked by 4H SMA 50 ceiling. Wait for a reclaim."
      );

      // 3. Waiting for retest
      const retestDecision: any = {
        symbol: "AAPL",
        setupStatus: "WATCH_RETEST",
        isWaitAndRetest: true,
      };
      expect(getAiTipText(retestDecision)).toBe(
        "AI Edge: Wait for 1H support retest and green candle confirmation."
      );
    });
  });

  describe("Task 4: Collapsible Theme Switcher (ActionCenter.tsx)", () => {
    it("declares uiPreferencesOpen state defaulting to false (closed)", () => {
      expect(actionCenterSrc).toContain("const [uiPreferencesOpen, setUiPreferencesOpen] = useState(false);");
    });

    it("renders minimal toggle button styled with text-xs text-slate-gray hover:text-soft-white", () => {
      expect(actionCenterSrc).toContain('data-testid="button-toggle-ui-preferences"');
      expect(actionCenterSrc).toContain("text-xs text-slate-gray hover:text-soft-white");
      expect(actionCenterSrc).toContain("<Settings className=\"w-4 h-4\" />");
      expect(actionCenterSrc).toContain("<span>UI Preferences</span>");
    });

    it("wraps CyberThemeSwitcher and CardStyleSection in conditional uiPreferencesOpen disclosure", () => {
      expect(actionCenterSrc).toContain("{uiPreferencesOpen && (");
      expect(actionCenterSrc).toContain('data-testid="ui-preferences-panel"');
      expect(actionCenterSrc).toContain("<CyberThemeSwitcher");
      expect(actionCenterSrc).toContain("<CardStyleSection />");
    });
  });
});
