import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const heroCardPath = path.resolve(__dirname, "../../client/src/components/swing/ActiveExecutionHeroCard.tsx");

describe("Action Center & Setup Card Progressive Disclosure Architecture", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Repair the Expand/Collapse State Logic", () => {
    it("provides master collapse container with ChevronUp / ChevronDown toggle button in ActionCenter", () => {
      expect(actionCenterSrc).toContain('data-testid="button-toggle-action-center"');
      expect(actionCenterSrc).toContain("setBoxOpen(!boxOpen)");
      expect(actionCenterSrc).toContain("<ChevronUp");
      expect(actionCenterSrc).toContain("<ChevronDown");
      expect(actionCenterSrc).toContain("[ Collapse Action Center ]");
      expect(actionCenterSrc).toContain("[ Expand Action Center ]");
    });

    it("includes sleek bulk controls for [ Expand All ] and [ Collapse All ] and wires to both card types", () => {
      expect(actionCenterSrc).toContain('data-testid="button-bulk-expand-all"');
      expect(actionCenterSrc).toContain("[ Expand All ]");
      expect(actionCenterSrc).toContain('data-testid="button-bulk-collapse-all"');
      expect(actionCenterSrc).toContain("[ Collapse All ]");
      expect(actionCenterSrc).toContain("const [bulkExpanded, setBulkExpanded] = useState<boolean | null>(null);");
      // Passes down to both ActiveExecutionHeroCard and InlineTradingCard
      expect(actionCenterSrc).toContain("<ActiveExecutionHeroCard");
      expect(actionCenterSrc).toContain("bulkExpanded={bulkExpanded}");
      expect(actionCenterSrc).toContain("<InlineTradingCard");
    });

    it("ensures toolbar toggle button updates both isCollapsedAll and bulkExpanded", () => {
      expect(actionCenterSrc).toContain('data-testid="button-collapse-expand-all"');
      expect(actionCenterSrc).toContain("setIsCollapsedAll(next);");
      expect(actionCenterSrc).toContain("setBulkExpanded(!next);");
    });

    it("ensures ActiveExecutionHeroCard has local isExpanded state defaulting to false and listens to bulkExpanded", () => {
      expect(heroCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
      expect(heroCardSrc).toContain("setIsExpanded(bulkExpanded);");
      expect(heroCardSrc).toContain('data-testid={`button-toggle-hero-collapse-${trade.symbol}`}');
    });

    it("crucial fix: wraps entire bottom half of ActiveExecutionHeroCard (Fidelity ticket, Target 2, Scale-outs, Log as Executed) inside expanded-details conditional block", () => {
      expect(heroCardSrc).toContain("{isExpanded && (");
      expect(heroCardSrc).toContain('className="expanded-details mt-4 border-t border-ink-line/50 pt-4"');
      expect(heroCardSrc).toContain('data-testid={`hero-expanded-details-${trade.symbol}`}');

      const expandedIdx = heroCardSrc.indexOf('data-testid={`hero-expanded-details-${trade.symbol}`}');
      const target2Idx = heroCardSrc.indexOf('data-testid={`copy-hero-target2-${trade.symbol}`}');
      const ladderIdx = heroCardSrc.indexOf("<ScaleOutRLadder");
      const fidelityIdx = heroCardSrc.indexOf('data-testid={`hero-fidelity-ticket-${trade.symbol}`}');
      const armBtnIdx = heroCardSrc.indexOf('data-testid={`button-arm-hero-${trade.symbol}`}');

      expect(target2Idx).toBeGreaterThan(expandedIdx);
      expect(ladderIdx).toBeGreaterThan(expandedIdx);
      expect(fidelityIdx).toBeGreaterThan(expandedIdx);
      expect(armBtnIdx).toBeGreaterThan(expandedIdx);
    });

    it("ensures TradingCard has local isExpanded state defaulting to false and listens to bulkExpanded", () => {
      expect(tradingCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
      expect(tradingCardSrc).toContain("setIsExpanded(props.bulkExpanded);");
      expect(tradingCardSrc).toContain("expanded-details");
    });
  });

  describe("Task 2: The Ultra-Compact Default Row (Big Text, Small Footprint)", () => {
    it("features Left to Right flow with Chevron toggle, Ticker Symbol (text-signal-green), and Status Badge in Hero Card", () => {
      expect(heroCardSrc).toContain('data-testid={`button-toggle-hero-collapse-${trade.symbol}`}');
      expect(heroCardSrc).toContain("text-signal-green");
      expect(heroCardSrc).toContain("[ ⚡ LIVE EXECUTION READY ]");
    });

    it("applies institutional typography shift to ActiveExecutionHeroCard: massive text-2xl numbers and tiny labels", () => {
      expect(heroCardSrc).toContain("text-[9px] uppercase tracking-widest text-slate-gray");
      expect(heroCardSrc).toContain("text-2xl font-mono tabular-nums font-bold text-soft-white");
      expect(heroCardSrc).toContain("Limit Entry Price");
      expect(heroCardSrc).toContain("Stop Loss (1.0R)");
      expect(heroCardSrc).toContain("Target 1 (1.5R - 50%)");
    });

    it("applies institutional typography shift to TradingCard: massive text-2xl numbers and tiny labels", () => {
      expect(tradingCardSrc).toContain("text-[9px] uppercase tracking-widest text-slate-gray font-mono font-bold");
      expect(tradingCardSrc).toContain("text-2xl font-mono tabular-nums font-bold text-soft-white");
      expect(tradingCardSrc).toContain("text-signal-green");
      expect(tradingCardSrc).toContain("Buy Target");
      expect(tradingCardSrc).toContain("Stop Loss");
    });
  });

  describe("Task 3: Surface Trade Capital & Targets in the Compact View", () => {
    it("surfaces position sizing and trade capital readout in ActiveExecutionHeroCard compact row", () => {
      expect(heroCardSrc).toContain('data-testid={`hero-position-sizing-${trade.symbol}`}');
      expect(heroCardSrc).toContain("font-mono text-sm font-semibold text-neon-blue tabular-nums");
      expect(heroCardSrc).toMatch(/\{(?:trade\.shares|calculatedShares)\}\s*Shares\s*·\s*\$\{(?:totalCapital|totalPositionCost)\.toLocaleString\(/);
      expect(heroCardSrc).toContain("Total · Risk: ${totalRisk.toFixed(2)}");
    });

    it("surfaces position sizing and trade capital readout in TradingCard compact row", () => {
      expect(tradingCardSrc).toContain('data-testid={`card-position-sizing-${d.symbol}`}');
      expect(tradingCardSrc).toContain("font-mono text-sm font-semibold text-neon-blue tabular-nums");
      expect(tradingCardSrc).toContain("{calculatedShares} Shares · ${effectiveFunding.toLocaleString(");
      expect(tradingCardSrc).toContain("Total · Risk: ${totalRisk.toFixed(2)}");
    });
  });

  describe("Dynamic Manual Position Sizing & Risk Telemetry Architecture", () => {
    it("Task 1: renders editable Trade Capital input inside expanded card with futuristic styling", () => {
      expect(tradingCardSrc).toContain('data-testid={`input-cash-${d.symbol}`}');
      expect(tradingCardSrc).toContain("bg-ink-black/50 border border-ink-line rounded-md px-3 py-1.5 font-mono text-sm text-neon-blue focus:border-neon-blue outline-none transition-colors");
      expect(tradingCardSrc).toContain("type=\"number\"");
      expect(tradingCardSrc).toContain("Cash Allocation:");
      expect(tradingCardSrc).toContain("const [customCash, setCustomCash] = useState");
    });

    it("Task 2: dynamically calculates shares and displays prominent count, wired to execution ticket and compact row", () => {
      expect(tradingCardSrc).toContain("Math.floor(customCash / p.entry)");
      expect(tradingCardSrc).toContain('data-testid={`text-calculated-shares-${d.symbol}`}');
      expect(tradingCardSrc).toMatch(/{customShares}|{calculatedShares}/);
      expect(tradingCardSrc).toMatch(/Broker Ticket \({customShares} Shares\):|Broker Ticket \({calculatedShares} Shares\):/);
      expect(tradingCardSrc).toMatch(/calculatedShares={customShares}|calculatedShares={calculatedShares}/);
      expect(tradingCardSrc).toMatch(/totalShares={customShares}|totalShares={calculatedShares}/);
    });

    it("Task 3: renders account equity and risk telemetry block with conditional 2.0% threshold coloring", () => {
      expect(tradingCardSrc).toContain('data-testid={`risk-telemetry-${d.symbol}`}');
      expect(tradingCardSrc).toContain("font-mono text-xs uppercase tracking-wider text-slate-gray");
      expect(tradingCardSrc).toContain("EQUITY: ${safeEquity.toLocaleString(");
      expect(tradingCardSrc).toContain("TOTAL RISK: ${totalRisk.toFixed(2)}");
      expect(tradingCardSrc).toContain("RISK OVERALL:");
      expect(tradingCardSrc).toContain('data-testid={`text-risk-percent-${d.symbol}`}');
      expect(tradingCardSrc).toContain('riskPercent > 2.0 ? "text-signal-red font-extrabold" : "text-signal-green font-bold"');
    });
  });
});
