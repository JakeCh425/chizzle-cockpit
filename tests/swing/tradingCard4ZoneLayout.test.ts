import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("TradingCard 4-Zone Linear Vertical Flow Refactor", () => {
  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Zone 1 — Capital & Position Sizing (Top)", () => {
    it("renders Zone 1 at the top of the expanded card with dark-mode styling and telemetry", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone-1-capital-sizing-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Zone 1 · Capital & Position Sizing");
      expect(tradingCardSrc).toContain("bg-[#151E2E]");
      expect(tradingCardSrc).toContain("bg-[#0B1220]");
    });

    it("renders centralized control bar: [ Capital Input: $____ ] ➔ [ Calculated Shares: X ]", () => {
      expect(tradingCardSrc).toContain('data-testid={`custom-allocation-bar-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Custom Allocation:");
      expect(tradingCardSrc).toContain('data-testid={`input-cash-${d.symbol}`}');
      expect(tradingCardSrc).toContain("➔");
      expect(tradingCardSrc).toContain("Calculated Shares:");
      expect(tradingCardSrc).toContain('data-testid={`text-calculated-shares-${d.symbol}`}');
    });

    it("calculates shares using Math.floor(customCapital / livePrice) when live price is better than limit entry", () => {
      expect(tradingCardSrc).toContain("const isLivePriceBetter = livePrice > 0 && limitEntry > 0 && livePrice < limitEntry;");
      expect(tradingCardSrc).toContain("const customCapital = customCash;");
      expect(tradingCardSrc).toContain("isLivePriceBetter\n    ? Math.floor(customCapital / livePrice)");
    });
  });

  describe("Task 2: Zone 2 — Core Trade Math (Middle)", () => {
    it("renders Zone 2 with a massive 3-column grid", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone-2-core-math-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Zone 2 · Core Trade Math");
      expect(tradingCardSrc).toContain("grid grid-cols-1 md:grid-cols-3 gap-4");
    });

    it("Column 1 (Entry): renders Limit Price in bold white", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone2-entry-${d.symbol}`}');
      expect(tradingCardSrc).toContain("font-mono tabular-nums text-2xl sm:text-3xl font-bold text-white");
    });

    it("Column 2 (Stop): renders Stop Loss Price in Signal Red with Dollar Risk below it", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone2-stop-${d.symbol}`}');
      expect(tradingCardSrc).toContain("font-mono tabular-nums text-2xl sm:text-3xl font-bold text-rose-400");
      expect(tradingCardSrc).toContain('data-testid={`zone2-dollar-risk-${d.symbol}`}');
      expect(tradingCardSrc).toContain("-${totalRisk.toFixed(2)}");
    });

    it("Column 3 (Targets): renders Target 1 (1.5R) and Target 2 (2.0R) with Dollar Profit", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone2-target1-${d.symbol}`}');
      expect(tradingCardSrc).toContain('data-testid={`zone2-target2-${d.symbol}`}');
      expect(tradingCardSrc).toContain("(1.5R)");
      expect(tradingCardSrc).toContain("(2.0R)");
      expect(tradingCardSrc).toContain("+${(1.5 * totalRisk).toFixed(2)}");
      expect(tradingCardSrc).toContain("+${(2.0 * totalRisk).toFixed(2)}");
    });
  });

  describe("Task 3: Zone 3 — The Fidelity Ticket & Safety Lock (Lower Middle)", () => {
    it("renders 1-Click Fidelity Ticket in Zone 3", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone-3-fidelity-safety-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Zone 3 · 1-Click Fidelity Ticket & Safety Lock");
      expect(tradingCardSrc).toContain("<FidelityExecutionGuide");
    });

    it("implements critical real-time tradability safety check", () => {
      expect(tradingCardSrc).toContain("const isBreakoutFailing = stopDist > 0 && livePrice > 0 && (entPx - livePrice) > 0.5 * stopDist;");
      expect(tradingCardSrc).toContain("const isPastTarget1 = t1Px > 0 && livePrice > 0 && livePrice >= t1Px;");
      expect(tradingCardSrc).toContain("const isTradeInvalidated = isBreakoutFailing || isPastTarget1 || isExtendedRunUp || isExpiredEndOfDay;");
    });

    it("renders dark glassmorphism overlay and warning banner when trade is invalidated", () => {
      expect(tradingCardSrc).toContain('data-testid={`banner-trade-invalidated-${d.symbol}`}');
      expect(tradingCardSrc).toContain("⚠️ TRADE INVALIDATED: Live price has deviated significantly from entry structure. Do not execute.");
      expect(tradingCardSrc).toContain("bg-slate-950/85 backdrop-blur-md");
    });
  });

  describe("Task 4: Zone 4 — Clean Chart (Bottom) & Layout Constraints", () => {
    it("moves clean execution chart to the bottom of the card with signal update timestamp", () => {
      expect(tradingCardSrc).toContain('data-testid={`zone-4-clean-chart-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Zone 4 · Clean Execution Chart");
      expect(tradingCardSrc).toContain('data-testid={`chart-timestamp-${d.symbol}`}');
      expect(tradingCardSrc).toContain("Live Data • Signal Updated:");
      expect(tradingCardSrc).toContain("<SparklineChart");
    });

    it("enforces strict vertical stack (flex flex-col gap-6) and institutional dark mode palette", () => {
      expect(tradingCardSrc).toContain("flex flex-col gap-6 pt-4 mt-2 border-t border-[var(--card-border)] expanded-details bg-[#0B1220]");
      expect(tradingCardSrc).toContain("bg-[#0B1220]");
      expect(tradingCardSrc).toContain("bg-[#151E2E]");
    });
  });
});
