import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { resolveCardSize } from "@/components/swing/TradingCard";
import { formatCurrency } from "@/components/swing/AIExecutionEngine";
import type { SwingDecision } from "@shared/swingDecision";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const aiEnginePath = path.resolve(__dirname, "../../client/src/components/swing/AIExecutionEngine.tsx");

describe("Dynamic Card Sizing (S/M/L) & Confirmed Lifecycle Routing & AI Data Sync", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const aiEngineSrc = fs.readFileSync(aiEnginePath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Dynamic Setup Card Sizing (S/M/L)", () => {
    it("resolves Small (sm) sizing when setup fails rules, is not tradeable, or is invalidated", () => {
      const mockUntradeable = {
        symbol: "TSLA",
        setupStatus: "SIGNAL_EXPIRED",
        entryPrice: 200,
        structuralStop: 190,
      } as SwingDecision;

      // Untradeable / expired -> sm
      expect(resolveCardSize(mockUntradeable, "NO_TRADE", false, false)).toBe("sm");

      // Invalid levels (entry <= stop) -> sm
      const mockInvalidLevels = {
        symbol: "AMZN",
        setupStatus: "LEVELS_INVALID",
        entryPrice: 150,
        structuralStop: 160,
      } as unknown as SwingDecision;
      expect(resolveCardSize(mockInvalidLevels, "NO_TRADE", false, false)).toBe("sm");
    });

    it("resolves Medium (md) sizing when setup is forming or awaiting close", () => {
      const mockForming = {
        symbol: "MSFT",
        setupStatus: "SETUP_FORMING",
        entryPrice: 420,
        structuralStop: 410,
      } as unknown as SwingDecision;

      // Forming and tradeable but not confirmed/ready -> md
      expect(resolveCardSize(mockForming, "FORMING", true, false)).toBe("md");
      expect(resolveCardSize(mockForming, "RETEST", true, false)).toBe("md");
    });

    it("resolves Large (lg) sizing when setup is confirmed or ready to arm", () => {
      const mockReady = {
        symbol: "NVDA",
        setupStatus: "READY_TO_TRADE",
        entryPrice: 715.04,
        structuralStop: 690.00,
      } as unknown as SwingDecision;

      // READY and tradeable -> lg
      expect(resolveCardSize(mockReady, "READY", true, false)).toBe("lg");

      // Confirmed setup -> lg
      expect(resolveCardSize(mockReady, "CONFIRMED", true, true)).toBe("lg");
    });

    it("renders single horizontal row with Ticker | Live Price | Status Badge | [ Expand ] in Small (sm) state", () => {
      expect(tradingCardSrc).toContain('data-card-size="sm"');
      expect(tradingCardSrc).toContain('data-testid={`button-expand-card-${d.symbol}`}');
      expect(tradingCardSrc).toContain("[ Expand ]");
    });

    it("renders core metrics and summary strip in Medium (md) state, but hides mini-chart and AI engine", () => {
      expect(tradingCardSrc).toContain('data-card-size={cardSize}');
      expect(tradingCardSrc).toContain('data-testid={`setup-card-summary-strip-${d.symbol}`}');
      // Mini-chart and AI engine are gated by cardSize === 'lg' or explicit flags
      expect(tradingCardSrc).toContain('(cardSize === "lg" || props.showMiniChart) && (');
      expect(tradingCardSrc).toContain('cardSize === "lg" && props.showAiEngine && (');
    });

    it("reveals mini-chart, AI engine, and arm button in Large (lg) state", () => {
      expect(tradingCardSrc).toContain('data-testid={`mini-chart-${d.symbol}`}');
      expect(tradingCardSrc).toContain("<MiniChartWidget");
      expect(tradingCardSrc).toContain("<AIExecutionEngine");
      expect(tradingCardSrc).toContain("export const SetupCard = InlineTradingCard;");
    });
  });

  describe("2. Strategic Active Execution Zone Routing (The Top Level)", () => {
    it("renders [ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ] as the top magnetic drop-zone", () => {
      expect(actionCenterSrc).toContain('data-testid="active-execution-zone"');
      expect(actionCenterSrc).toContain("[ ACTIVE EXECUTION ZONE - CONFIRMED TRADES ]");
    });

    it("unmounts confirmed setups from lower Priority Board and card decks", () => {
      expect(actionCenterSrc).toContain("const confirmedRows = rows.filter(isConfirmedSetup);");
      expect(actionCenterSrc).toContain("const confirmedSymSet = new Set(confirmedRows.map((d) => d.symbol));");
      expect(actionCenterSrc).toContain("const generalPriorityRows = rows.filter((d) => !confirmedSymSet.has(d.symbol));");
      expect(actionCenterSrc).toContain("const generalLoud = loud.filter((d) => !confirmedSymSet.has(d.symbol));");
      expect(actionCenterSrc).toContain("<PriorityBoard rows={generalPriorityRows}");
      expect(actionCenterSrc).toContain("{generalLoud.map((d) => {");
    });

    it("applies distinct pulsing emerald green border (#10B981) to execution zone cards", () => {
      expect(actionCenterSrc).toContain("border-2 border-emerald-500 bg-emerald-950/40");
      expect(actionCenterSrc).toContain("shadow-[0_0_15px_rgba(16,185,129,0.5)]");
      expect(actionCenterSrc).toContain("ring-2 ring-emerald-400/40 animate-pulse");
      expect(actionCenterSrc).toContain('data-testid={`active-execution-card-${d.symbol}`}');
    });
  });

  describe("3. Fix AI Execution Engine Price Syncing", () => {
    it("formats currency accurately using formatCurrency utility without hardcoded strings", () => {
      expect(formatCurrency(715.04)).toBe("$715.04");
      expect(formatCurrency(120)).toBe("$120.00");
      expect(formatCurrency(null)).toBe("—");
      expect(formatCurrency(undefined)).toBe("—");
    });

    it("binds Step 2, Step 3, and Step 4 directly to calculated setup variables", () => {
      // Step 2: Place Limit Buy at ${formatCurrency(entryPrice)}.
      expect(aiEngineSrc).toContain("Place Limit Buy at");
      expect(aiEngineSrc).toContain("{formatCurrency(entryPrice)}");

      // Step 3: Set Hard Stop at ${formatCurrency(stopLoss)} (-1R).
      expect(aiEngineSrc).toContain("Set Hard Stop at");
      expect(aiEngineSrc).toContain("{formatCurrency(stopLoss)}");
      expect(aiEngineSrc).toContain("(-1R)");

      // Step 4: Once filled, queue OCO Target 1 at ${formatCurrency(target1)} (+1.5R).
      expect(aiEngineSrc).toContain("Once filled, queue OCO Target 1 at");
      expect(aiEngineSrc).toContain("{formatCurrency(target1)}");
      expect(aiEngineSrc).toContain("(+1.5R)");
    });

    it("wipes hardcoded $100.00 fallback strings and derives prices from effectivePlan and setup state", () => {
      expect(aiEngineSrc).not.toContain("?? 100;");
      expect(aiEngineSrc).not.toContain("$100.00");
      expect(aiEngineSrc).toContain("plan?.entry != null && plan.entry > 0");
      expect(aiEngineSrc).toContain("d.entryPrice != null && d.entryPrice > 0");
      expect(aiEngineSrc).toContain("d.structuralStop != null && d.structuralStop > 0");
    });
  });
});

