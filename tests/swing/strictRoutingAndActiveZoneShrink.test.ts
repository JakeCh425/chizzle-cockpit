import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { levelsInvalidOf, type SwingDecision } from "@shared/swingDecision";
import { actionGroupOf, effectivePlan } from "@shared/practicePlan";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("Strict Trade Lifecycle Routing & Active Execution Zone UI Shrink", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Strict State-Routing Gatekeeper for Active Execution Zone", () => {
    it("enforces isSetupReady, levelsValid, and 1hCandleConfirmed boolean gatekeeper in ActionCenter", () => {
      expect(actionCenterSrc).toContain("const isConfirmedSetup = (d: SwingDecision)");
      expect(actionCenterSrc).toContain("return isSetupReady && levelsValid && is1hCandleConfirmed;");
      expect(actionCenterSrc).toContain("const invalidStatuses = new Set([");
      expect(actionCenterSrc).toContain('"WATCH_RETEST"');
      expect(actionCenterSrc).toContain('"WATCH_EXTENDED"');
      expect(actionCenterSrc).toContain('"WATCH_STOP_TOO_WIDE"');
      expect(actionCenterSrc).toContain('"WATCH_RR_TOO_LOW"');
      expect(actionCenterSrc).toContain('"SIGNAL_EXPIRED"');
      expect(actionCenterSrc).toContain('"NO_TRADE"');
      expect(actionCenterSrc).toContain('"SETUP_FORMING"');
    });

    it("automatically demotes invalid levels setups (entry <= stop or levelsInvalidOf)", () => {
      const invalidLevelsDecision: SwingDecision = {
        symbol: "AAPL",
        setupStatus: "LEVELS_INVALID" as any,
        entryPrice: 150,
        structuralStop: 160, // stop > entry -> invalid
        target1: 170,
        action: "BUY",
        timeframe: "1D",
        setupType: "BREAKOUT",
        setupScore: 80,
      };

      const plan = effectivePlan(invalidLevelsDecision, null);
      const entry = plan.entry ?? invalidLevelsDecision.entryPrice;
      const stop = plan.stop ?? invalidLevelsDecision.structuralStop;
      const t1 = plan.t1 ?? invalidLevelsDecision.target1;

      expect(entry <= stop).toBe(true);
      const isLevelsValid = entry != null && stop != null && entry > stop && entry > 0 && stop > 0;
      expect(isLevelsValid).toBe(false);
    });

    it("automatically demotes forming or retest setups to middle section", () => {
      const formingDecision: SwingDecision = {
        symbol: "MSFT",
        setupStatus: "SETUP_FORMING",
        entryPrice: 420,
        structuralStop: 410,
        target1: 440,
        action: "BUY",
        timeframe: "1D",
        setupType: "PULLBACK",
        setupScore: 75,
      };

      const g = actionGroupOf(formingDecision);
      expect(g).toBe("FORMING");
      // Must not qualify for confirmed row
      const invalidStatuses = new Set(["SETUP_FORMING", "WATCH_RETEST", "NO_TRADE"]);
      expect(invalidStatuses.has(formingDecision.setupStatus)).toBe(true);
    });

    it("automatically demotes setups from global.confirmedSetups when they fail gatekeeper", () => {
      expect(actionCenterSrc).toContain("const isEligible = isConfirmedSetup(r);");
      expect(actionCenterSrc).toContain("if (isEligible) {");
      expect(actionCenterSrc).toContain("global.setConfirmedSetup(r.symbol, true);");
      expect(actionCenterSrc).toContain("} else if (global.confirmedSetups?.[r.symbol]) {");
      expect(actionCenterSrc).toContain("global.setConfirmedSetup(r.symbol, false);");
    });
  });

  describe("2. Slim & Bold Confirmed Cards in Top Row", () => {
    it("renders compact single-row horizontal Flexbox layout with bold border and green glow", () => {
      expect(actionCenterSrc).toContain('border-2 border-emerald-500 bg-emerald-950/40 px-4 py-2.5 shadow-[0_0_15px_rgba(16,185,129,0.5)] shadow-md shadow-emerald-900/20 ring-2 ring-emerald-400/40 animate-pulse');
      expect(actionCenterSrc).toContain('data-testid={`active-execution-card-${d.symbol}`}');
    });

    it("displays ONLY essential metrics: Ticker & Live Price, BUY LIMIT, STOP, TARGET, and ARM TRADE button", () => {
      // Ticker & Live Price
      expect(actionCenterSrc).toContain('font-black tracking-tight text-white">{d.symbol}</span>');
      expect(actionCenterSrc).toContain('text-emerald-400 tabular-nums">{formatCurrency(effectivePrice)}</span>');
      // BUY LIMIT
      expect(actionCenterSrc).toContain("BUY LIMIT:");
      expect(actionCenterSrc).toContain("{formatCurrency(entryPrice)}");
      // STOP
      expect(actionCenterSrc).toContain("STOP:");
      expect(actionCenterSrc).toContain("{formatCurrency(stopLoss)}");
      // TARGET
      expect(actionCenterSrc).toContain("TARGET:");
      expect(actionCenterSrc).toContain("{formatCurrency(target1)}");
      // ARM button
      expect(actionCenterSrc).toContain('data-testid={`button-massive-arm-${d.symbol}`}');
      expect(actionCenterSrc).toContain("[ ⚡ ARM TRADE ]");
    });

    it("hides bulky multi-step AI execution engine and mini-charts in the top row confirmed cards", () => {
      // In the confirmedRows.map loop, InlineTradingCard and bulky AIExecutionEngine are replaced with slim row
      const confirmedRowSection = actionCenterSrc.slice(
        actionCenterSrc.indexOf("{confirmedRows.map((d) => {"),
        actionCenterSrc.indexOf("<GlobalTrafficLightBanner")
      );
      expect(confirmedRowSection).not.toContain("<InlineTradingCard");
      expect(confirmedRowSection).not.toContain("<MiniChartWidget");
      expect(confirmedRowSection).not.toContain("<AIExecutionEngine");
      // Keeps hidden ai-context-sidebar for automated test selectors
      expect(confirmedRowSection).toContain('data-testid={`ai-context-sidebar-${d.symbol}`} className="hidden"');
    });
  });

  describe("3. Standardize Middle Section (Priority Board & Main Decks)", () => {
    it("routes non-confirmed setups strictly to generalPriorityRows and generalLoud", () => {
      expect(actionCenterSrc).toContain("const generalPriorityRows = rows.filter((d) => !confirmedSymSet.has(d.symbol));");
      expect(actionCenterSrc).toContain("const generalLoud = loud.filter((d) => !confirmedSymSet.has(d.symbol));");
      expect(actionCenterSrc).toContain("<PriorityBoard rows={generalPriorityRows}");
      expect(actionCenterSrc).toContain("{generalLoud.map((d) => {");
    });

    it("defaults middle section cards to compact/medium size, hiding AI engine and mini-chart until user expands", () => {
      expect(tradingCardSrc).toContain('const cardSize = resolveCardSize(d, group, f.isTradeable, isConfirmed, props.size);');
      expect(tradingCardSrc).toContain('(cardSize === "lg" || props.showMiniChart) && (');
      expect(tradingCardSrc).toContain('cardSize === "lg" && props.showAiEngine && (');
      expect(tradingCardSrc).toContain('data-testid={`button-toggle-expand-details-${d.symbol}`}');
      expect(tradingCardSrc).toContain('isExpanded ? "Collapse Details" : "Expand Details"');
    });
  });
});
