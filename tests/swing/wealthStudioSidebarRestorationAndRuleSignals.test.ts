import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { evaluateCandleSetupConfirmation } from "../../client/src/hooks/useCandleSetupConfirmation";

const dashboardPath = path.resolve(
  __dirname,
  "../../client/src/pages/WealthEngineDashboard.tsx"
);
const dashboardContent = fs.readFileSync(dashboardPath, "utf-8");

const appShellPath = path.resolve(
  __dirname,
  "../../client/src/components/AppShell.tsx"
);
const appShellContent = fs.readFileSync(appShellPath, "utf-8");

describe("Wealth Studio — Right Sidebar Restoration & Context-Aware Execution Signals", () => {
  describe("1. Fix Right Sidebar Disappearance (CSS Flex/Grid Bounds)", () => {
    it("constrains AppShell main wrapper to min-w-0 max-w-full and removes padding on /engine so the right sidebar is never pushed off-screen", () => {
      expect(appShellContent).toContain("flex-1 flex min-w-0 max-w-full overflow-hidden");
      expect(appShellContent).toContain("flex-1 min-w-0 w-full max-w-full overflow-x-hidden");
      expect(appShellContent).toContain('location === "/engine" || location === "/dashboard"');
      expect(appShellContent).toContain("p-0 h-[calc(100vh-3.5rem)] overflow-hidden");
    });

    it("enforces strict CSS layout bounds on WealthEngineDashboard root, center chart, and right sidebar", () => {
      expect(dashboardContent).toContain('width: "100%", maxWidth: "100%"');
      expect(dashboardContent).toContain("grid grid-cols-[250px_minmax(0,_1fr)_350px] h-screen overflow-hidden");
      expect(dashboardContent).toContain("flex-1 min-w-0 relative");
      expect(dashboardContent).toContain("w-[350px] flex-shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-950");
    });
  });

  describe("2. Context-Aware Execution Signals & Rule-Based Tooltip", () => {
    it("evaluates confirmed 1H setup to [ SETUP ARMED - LIMIT: $541.62 ] with passed 3-point rule checklist", () => {
      const candles = Array.from({ length: 24 }, (_, idx) => ({
        o: 540,
        h: 542,
        l: 539,
        c: 541,
        v: 1000,
        sma20: 540,
        sma50: 535,
        t: idx,
      }));
      // Index 22 (last closed 1H bar): tests 20-SMA (540.00), closes green above 20-SMA at 541.62, volume 1500 (> 1.2x avg)
      candles[22] = {
        o: 540.80,
        h: 542.10,
        l: 539.90,
        c: 541.62,
        v: 1500,
        sma20: 540.0,
        sma50: 535.0,
        t: 22,
      };

      const res = evaluateCandleSetupConfirmation({
        candles,
        entryPrice: 541.62,
        livePrice: 541.62,
      });

      expect(res.isConfirmedSetup).toBe(true);
      expect(res.markerText).toBe("[ SETUP ARMED - LIMIT: $541.62 ]");
      expect(res.actionText).toBe("ACTION: Set Buy Limit at $541.62");
      expect(res.ruleChecklist).toHaveLength(3);
      expect(res.ruleChecklist.map((r) => r.label)).toEqual([
        "1H Candle Closed Green",
        "Held 20-SMA Structural Support",
        "Volume > 1.2x Average",
      ]);
      expect(res.ruleChecklist.every((r) => r.passed)).toBe(true);
    });

    it("evaluates forming / unclosed 1H setup to [ FORMING: AWAITING 1H CLOSE ] and never claims Buy Confirmed", () => {
      const candles = Array.from({ length: 24 }, (_, idx) => ({
        o: 540,
        h: 542,
        l: 539,
        c: 541,
        v: 1000,
        sma20: 530, // price extended far above 20-SMA
        sma50: 525,
        t: idx,
      }));

      const res = evaluateCandleSetupConfirmation({
        candles,
        entryPrice: 541.62,
        livePrice: 541.62,
      });

      expect(res.isConfirmedSetup).toBe(false);
      expect(res.markerText).toBe("[ FORMING: AWAITING 1H CLOSE ]");
      expect(res.markerText).not.toContain("BUY CONFIRMED");
    });

    it("renders [ SETUP ARMED - LIMIT: $... ] on confirmed chart marker with glassmorphic rule tooltip and [ FORMING: AWAITING 1H CLOSE ] in amber when forming", () => {
      expect(dashboardContent).toContain('data-testid="chart-marker-buy-confirmed"');
      expect(dashboardContent).toContain("[ SETUP ARMED - LIMIT: $${confirmedPrice.toFixed(2)} ]");
      expect(dashboardContent).toContain('data-testid="chart-marker-rule-tooltip"');
      expect(dashboardContent).toContain("1H Candle Closed Green");
      expect(dashboardContent).toContain("Held 20-SMA Structural Support");
      expect(dashboardContent).toContain("Volume > 1.2x Average");
      expect(dashboardContent).toContain("ACTION: Set Buy Limit at $${confirmedPrice.toFixed(2)}");
      expect(dashboardContent).toContain('data-testid="chart-marker-forming-awaiting-close"');
      expect(dashboardContent).toContain("[ FORMING: AWAITING 1H CLOSE ]");
    });
  });

  describe("3. Checklist Integration at the Top of the Restored Right Sidebar", () => {
    it("mounts cockpit-confirmation-checklist directly at the top of column-right above quote strip and setup card", () => {
      const rightColIdx = dashboardContent.indexOf('data-testid="column-right"');
      const checklistIdx = dashboardContent.indexOf('data-testid="cockpit-confirmation-checklist"', rightColIdx);
      const quoteStripIdx = dashboardContent.indexOf('data-testid="sidebar-quote-strip"', rightColIdx);
      const proximityMeterIdx = dashboardContent.indexOf('data-testid="trade-proximity-meter"', rightColIdx);
      const setupCardIdx = dashboardContent.indexOf('data-testid="setup-card"', rightColIdx);

      expect(rightColIdx).toBeGreaterThan(-1);
      expect(checklistIdx).toBeGreaterThan(rightColIdx);
      expect(checklistIdx).toBeLessThan(quoteStripIdx);
      expect(checklistIdx).toBeLessThan(proximityMeterIdx);
      expect(checklistIdx).toBeLessThan(setupCardIdx);
    });

    it("includes real-time gray-to-bright-green transitions and live signal banner inside the checklist", () => {
      expect(dashboardContent).toContain("transition-all duration-500 ease-out");
      expect(dashboardContent).toContain("bg-emerald-950/35 border-emerald-500/50 text-[#00E676]");
      expect(dashboardContent).toContain("bg-slate-900/60 border-slate-800 text-slate-400");
      expect(dashboardContent).toContain('data-testid="sidebar-checklist-signal-banner"');
    });
  });
});
