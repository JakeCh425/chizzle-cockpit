import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { evaluateExecutionGating } from "../../client/src/lib/executionGating";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const strategyEnginePath = path.resolve(__dirname, "../../client/src/hooks/useStrategyEngine.ts");
const wealthDashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
const pipelineCockpitPath = path.resolve(__dirname, "../../client/src/pages/PipelineCockpit.tsx");

describe("Architecture Simplification: Master Chart & 2-Stage Beginner Dashboard", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const strategyEngineSrc = fs.readFileSync(strategyEnginePath, "utf-8").replace(/\r\n/g, "\n");
  const wealthDashboardSrc = fs.readFileSync(wealthDashboardPath, "utf-8").replace(/\r\n/g, "\n");
  const pipelineCockpitSrc = fs.readFileSync(pipelineCockpitPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fix State Contradiction (Strict Execution Gating)", () => {
    it("locks out tickers with STANDBY DAY (HARD BLOCK) or Red Regime from execution ready", () => {
      const standbyResult = evaluateExecutionGating({
        symbol: "SMH",
        regimeCode: "yellow",
        isStandbyDay: true,
        mechanicalStatus: "STANDBY_DAY (Red Regime)",
        testedLine: "20_SMA",
        testedPrice: 240,
        candleConfirmedGreen: true,
      });

      expect(standbyResult.isReady).toBe(false);
      expect(standbyResult.passedRegime).toBe(false);
      expect(standbyResult.failedGates).toContain("STANDBY_DAY_HARD_BLOCK");
      expect(standbyResult.rejectionReason).toBe("STANDBY DAY (HARD BLOCK)");

      const redRegimeResult = evaluateExecutionGating({
        symbol: "SPY",
        regimeCode: "red",
        isStandbyDay: false,
        mechanicalStatus: "CONFIRMED BOUNCE",
        testedLine: "10_SMA",
        testedPrice: 580,
        candleConfirmedGreen: true,
      });

      expect(redRegimeResult.isReady).toBe(false);
      expect(redRegimeResult.passedRegime).toBe(false);
      expect(redRegimeResult.failedGates).toContain("RED_REGIME_HARD_BLOCK");
    });

    it("locks out tickers that are not actively bouncing off SMA 10, SMA 20, or SMA 50", () => {
      const noSmaResult = evaluateExecutionGating({
        symbol: "NVDA",
        regimeCode: "green",
        isStandbyDay: false,
        mechanicalStatus: "WAIT FOR RETEST (Entry Missed)",
        testedLine: null,
        testedPrice: null,
        candleConfirmedGreen: true,
      });

      expect(noSmaResult.isReady).toBe(false);
      expect(noSmaResult.passedSmaBounce).toBe(false);
      expect(noSmaResult.failedGates).toContain("NO_ACTIVE_SMA_BOUNCE");
    });

    it("locks out tickers whose 1H confirmation candle has not closed green", () => {
      const testingSmaResult = evaluateExecutionGating({
        symbol: "PLTR",
        regimeCode: "green",
        isStandbyDay: false,
        mechanicalStatus: "TESTING SMA (Wait for Close)",
        testedLine: "10_SMA",
        testedPrice: 42,
        candleConfirmedGreen: false,
      });

      expect(testingSmaResult.isReady).toBe(false);
      expect(testingSmaResult.passedCandleClose).toBe(false);
      expect(testingSmaResult.failedGates).toContain("1H_CANDLE_NOT_CLOSED_GREEN");
    });

    it("allows execution ONLY when ALL 3 rules pass (Green/Yellow, SMA 10/20/50 bounce, 1H green close)", () => {
      const validResult = evaluateExecutionGating({
        symbol: "QQQ",
        regimeCode: "green",
        isStandbyDay: false,
        mechanicalStatus: "CONFIRMED BOUNCE",
        testedLine: "20_SMA",
        testedPrice: 490,
        candleConfirmedGreen: true,
      });

      expect(validResult.isReady).toBe(true);
      expect(validResult.passedRegime).toBe(true);
      expect(validResult.passedSmaBounce).toBe(true);
      expect(validResult.passedCandleClose).toBe(true);
      expect(validResult.failedGates).toHaveLength(0);
    });

    it("wires centralized evaluateExecutionGating into ActionCenter and useStrategyEngine", () => {
      expect(actionCenterSrc).toContain("evaluateExecutionGating");
      expect(strategyEngineSrc).toContain("evaluateExecutionGating");
    });
  });

  describe("2. Consolidate to a 2-Stage Dashboard (Pending vs. Ready)", () => {
    it("renders Zone A (Top Row): [ ⚡ READY TO TRADE ]", () => {
      expect(actionCenterSrc).toContain("[ ⚡ READY TO TRADE ]");
      expect(actionCenterSrc).toContain('data-testid="active-execution-zone"');
      expect(actionCenterSrc).toContain("No Hard Blocks · SMA 10/20/50 Bounce Verified · 1H Candle Close Validated");
    });

    it("renders Zone B (Main Grid): [ ⏳ PENDING & WAITING ] with compact cards", () => {
      expect(actionCenterSrc).toContain("[ ⏳ PENDING & WAITING ]");
      expect(actionCenterSrc).toContain('data-testid="zone-pending-waiting"');
      expect(actionCenterSrc).toContain("Forming Setups · Waiting For Retest · Missed Entries · Standby Hard Blocks");
      expect(actionCenterSrc).toContain('data-testid="ac-cards-grid"');
    });
  });

  describe("3. The 'One Master Chart' Architecture", () => {
    it("integrates Ticker CRUD ([ + Add ] / [ Delete ]) cleanly at the top-left of the Master Chart", () => {
      expect(wealthDashboardSrc).toContain('data-testid="master-chart-ticker-crud"');
      expect(wealthDashboardSrc).toContain('data-testid="input-master-chart-ticker"');
      expect(wealthDashboardSrc).toContain('data-testid="button-master-chart-add-ticker"');
      expect(wealthDashboardSrc).toContain('data-testid="button-master-chart-delete-ticker"');
    });

    it("embeds AI Trade Coach and Reflections as sleek overlay in bottom-left corner of the Master Chart", () => {
      expect(wealthDashboardSrc).toContain('data-testid="master-chart-ai-coach-overlay"');
      expect(wealthDashboardSrc).toContain("AI Trade Coach ·");
      expect(wealthDashboardSrc).toContain("Reflections: SMA 10, 20 & 50 Active");
      expect(wealthDashboardSrc).toContain("Single Master Chart");
    });

    it("cleanly displays SMA 10, SMA 20, and SMA 50 paths and labels on the Master Chart", () => {
      expect(wealthDashboardSrc).toContain('data-testid="chart-path-sma10"');
      expect(wealthDashboardSrc).toContain('data-testid="chart-path-sma20"');
      expect(wealthDashboardSrc).toContain('data-testid="chart-path-sma50"');
      expect(wealthDashboardSrc).toContain('data-testid="sma-overlay-labels"');
    });

    it("removes redundant secondary CockpitWorkspace chart from main Cockpit page", () => {
      expect(pipelineCockpitSrc).not.toContain("<CockpitWorkspace");
    });
  });
});
