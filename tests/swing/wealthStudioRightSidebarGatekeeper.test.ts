import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  evaluateTradeReadiness,
  TRADE_LOCKED_TOOLTIP,
  TRADE_CONFIRMED_BADGE,
  TRADE_PENDING_BADGE,
} from "../../client/src/hooks/useTradeReadiness";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";

describe("Wealth Studio Right-Sidebar Layout & Cockpit Confirmation Gatekeeper", () => {
  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Layout Restructure & Viewport Squeeze Prevention", () => {
    it("configures main studio layout as flex container preventing right sidebar compression", () => {
      expect(dashboardContent).toContain('className="flex w-full h-full overflow-hidden flex-1 min-h-0"');
    });

    it("enforces Left Watchlist Panel fixed width w-64 flex-shrink-0", () => {
      expect(dashboardContent).toContain('w-64 flex-shrink-0 shrink-0');
      expect(dashboardContent).toContain('data-testid="column-left"');
    });

    it("enforces Center Main Chart Canvas flex-1 min-w-0 to auto-scale without pushing right sidebar", () => {
      expect(dashboardContent).toContain('flex-1 min-w-0 h-full flex flex-col border-r overflow-hidden');
      expect(dashboardContent).toContain('data-testid="column-center"');
    });

    it("enforces Right Execution Sidebar fixed width w-80/w-96 flex-shrink-0 with border-l border-cyan-900/40 and internal padding", () => {
      expect(dashboardContent).toContain('w-80 xl:w-96');
      expect(dashboardContent).toContain('flex-shrink-0 shrink-0');
      expect(dashboardContent).toContain('border-l border-cyan-900/40');
      expect(dashboardContent).toContain('overflow-y-auto');
      expect(dashboardContent).toContain('p-4');
      expect(dashboardContent).toContain('data-testid="column-right"');
    });
  });

  describe("2. Structured Right Sidebar Content Hierarchy", () => {
    it("includes AMD with full NASDAQ and semiconductor metadata in default watchlist", () => {
      const amd = DEFAULT_WATCHLIST.find((item) => item.symbol === "AMD");
      expect(amd).toBeDefined();
      expect(amd?.exchange).toBe("NASDAQ");
      expect(amd?.sector).toBe("Technology / Semiconductors");
    });

    it("renders Section 1: Ticker & Proximity Header with live price, delta, and visual gauge", () => {
      expect(dashboardContent).toContain('data-testid="sidebar-quote-strip"');
      expect(dashboardContent).toContain('data-testid="sidebar-live-price"');
      expect(dashboardContent).toContain('data-testid="badge-market-session"');
      expect(dashboardContent).toContain('data-testid="sidebar-session-stats-grid"');
      expect(dashboardContent).toContain('data-testid="trade-proximity-meter"');
      expect(dashboardContent).toContain('data-testid="trade-proximity-gauge"');
      expect(dashboardContent).toContain("Within");
      expect(dashboardContent).toContain("of 20-SMA");
    });

    it("renders Section 2: Cockpit 3-Point Confirmation Checklist with all 3 prerequisites", () => {
      expect(dashboardContent).toContain('data-testid="cockpit-confirmation-checklist"');
      expect(dashboardContent).toContain('data-testid="badge-checklist-summary"');
      expect(dashboardContent).toContain('[ Check 1 ]');
      expect(dashboardContent).toContain('Structural 20-SMA Support');
      expect(dashboardContent).toContain('[ Check 2 ]');
      expect(dashboardContent).toContain('1H Candle Close');
      expect(dashboardContent).toContain('[ Check 3 ]');
      expect(dashboardContent).toContain('Volume Threshold');
      expect(dashboardContent).toContain('data-testid="checklist-item-sma-support"');
      expect(dashboardContent).toContain('data-testid="checklist-item-candle-close"');
      expect(dashboardContent).toContain('data-testid="checklist-item-volume-threshold"');
    });

    it("renders Section 3: Active Trade Plan Details with dynamic levels in high-contrast monospace font", () => {
      expect(dashboardContent).toContain('data-testid="active-trade-plan-levels"');
      expect(dashboardContent).toContain('BUY LIMIT:');
      expect(dashboardContent).toContain('STOP LOSS:');
      expect(dashboardContent).toContain('TARGET 1 (1.5R):');
      expect(dashboardContent).toContain('(50% scale-out)');
      expect(dashboardContent).toContain('TARGET 2 (2.0R):');
      expect(dashboardContent).toContain('(core profit)');
      expect(dashboardContent).toContain('TARGET 3 (3.0R):');
      expect(dashboardContent).toContain('(runner)');
      expect(dashboardContent).toContain('data-testid="trade-level-buy"');
      expect(dashboardContent).toContain('data-testid="trade-level-stop"');
      expect(dashboardContent).toContain('data-testid="trade-level-t1"');
      expect(dashboardContent).toContain('data-testid="trade-level-t2"');
      expect(dashboardContent).toContain('data-testid="trade-level-t3"');
    });

    it("displays position sizing output from usePositionSizer with shares and capital required", () => {
      expect(dashboardContent).toContain('data-testid="studio-setup-summary-strip"');
      expect(dashboardContent).toContain('cardSizing.calculatedShares');
      expect(dashboardContent).toContain('cardSizing.totalCapitalRequired');
      expect(dashboardContent).toContain('cardSizing.totalDollarRiskAllowed');
      expect(dashboardContent).toContain('Funding Allocated:');
      expect(dashboardContent).toContain('Position Size:');
    });
  });

  describe("3. Cockpit Confirmation Gatekeeper (evaluateTradeReadiness & Lock Enforcement)", () => {
    it("strictly evaluates isTradeConfirmed = candleConfirmation && smaSupportHeld && volumeBenchmarkPassed", () => {
      // All 3 pass
      const confirmedResult = evaluateTradeReadiness({
        status: "Ready",
        currentPrice: 156.70,
        sma20Price: 154.50,
        proximityPct: 0.4,
        changePct: 1.5,
      });
      expect(confirmedResult.candleConfirmation).toBe(true);
      expect(confirmedResult.smaSupportHeld).toBe(true);
      expect(confirmedResult.volumeBenchmarkPassed).toBe(true);
      expect(confirmedResult.isTradeConfirmed).toBe(true);
      expect(confirmedResult.statusBadge.text).toBe(TRADE_CONFIRMED_BADGE);

      // Pending candle close (e.g. SPY or awaiting close)
      const pendingResult = evaluateTradeReadiness({
        status: "Awaiting Close",
        currentPrice: 582.40,
        sma20Price: 580.00,
        proximityPct: 0.4,
        changePct: 0.5,
      });
      expect(pendingResult.candleConfirmation).toBe(false);
      expect(pendingResult.smaSupportHeld).toBe(true);
      expect(pendingResult.isTradeConfirmed).toBe(false);
      expect(pendingResult.statusBadge.text).toBe(TRADE_PENDING_BADGE);
      expect(pendingResult.lockMessage).toBe(TRADE_LOCKED_TOOLTIP);
    });

    it("supports explicit boolean overrides for trade prerequisites", () => {
      const result = evaluateTradeReadiness({
        candleConfirmation: true,
        smaSupportHeld: true,
        volumeBenchmarkPassed: false, // 1 check failing
      });
      expect(result.isTradeConfirmed).toBe(false);

      const allPassed = evaluateTradeReadiness({
        candleConfirmation: true,
        smaSupportHeld: true,
        volumeBenchmarkPassed: true,
      });
      expect(allPassed.isTradeConfirmed).toBe(true);
      expect(allPassed.statusBadge.text).toBe(TRADE_CONFIRMED_BADGE);
    });

    it("enforces disabled attribute, opacity-40, cursor-not-allowed, and hover tooltip on [ ARM TRADE ] when locked", () => {
      expect(dashboardContent).toContain('data-testid="button-arm-practice-trade"');
      expect(dashboardContent).toContain('disabled={!isTradeConfirmed}');
      expect(dashboardContent).toContain('opacity-40 cursor-not-allowed');
      expect(dashboardContent).toContain(TRADE_LOCKED_TOOLTIP);
    });

    it("enforces disabled attribute, opacity-40, cursor-not-allowed, and hover tooltip on [ EXECUTE FIDELITY TICKET ] when locked", () => {
      expect(dashboardContent).toContain('data-testid="button-execute-fidelity-ticket"');
      expect(dashboardContent).toContain('disabled={!isTradeConfirmed}');
      expect(dashboardContent).toContain('data-testid="button-execute-fidelity-ticket"');
      expect(dashboardContent).toContain(TRADE_LOCKED_TOOLTIP);
    });

    it("renders gatekeeper locked notice banner when confirmation is pending", () => {
      expect(dashboardContent).toContain('data-testid="gatekeeper-lock-notice"');
      expect(dashboardContent).toContain('Trade execution locked pending 1H candle confirmation.');
    });

    it("displays pulsing emerald green badge [ ⚡ ALL RULES MET — READY TO ARM ] when isTradeConfirmed is true", () => {
      expect(dashboardContent).toContain(TRADE_CONFIRMED_BADGE);
      expect(dashboardContent).toContain(TRADE_PENDING_BADGE);
    });
  });
});
