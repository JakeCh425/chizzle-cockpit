import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("Action Center & Setup Card Progressive Disclosure Architecture", () => {
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("Task 1: Global Action Center Controls (ActionCenter.tsx)", () => {
    it("provides master collapse container with ChevronUp / ChevronDown toggle button", () => {
      expect(actionCenterSrc).toContain('data-testid="button-toggle-action-center"');
      expect(actionCenterSrc).toContain("setBoxOpen(!boxOpen)");
      expect(actionCenterSrc).toContain("<ChevronUp");
      expect(actionCenterSrc).toContain("<ChevronDown");
      expect(actionCenterSrc).toContain("[ Collapse Action Center ]");
      expect(actionCenterSrc).toContain("[ Expand Action Center ]");
    });

    it("includes sleek bulk controls for [ Expand All ] and [ Collapse All ]", () => {
      expect(actionCenterSrc).toContain('data-testid="button-bulk-expand-all"');
      expect(actionCenterSrc).toContain("[ Expand All ]");
      expect(actionCenterSrc).toContain('data-testid="button-bulk-collapse-all"');
      expect(actionCenterSrc).toContain("[ Collapse All ]");
    });

    it("wires bulkExpanded state down to individual InlineTradingCard instances", () => {
      expect(actionCenterSrc).toContain("const [bulkExpanded, setBulkExpanded] = useState<boolean | null>(null);");
      expect(actionCenterSrc).toContain("bulkExpanded={bulkExpanded}");
      expect(tradingCardSrc).toContain("bulkExpanded?: boolean | null;");
      expect(tradingCardSrc).toContain("setIsExpanded(props.bulkExpanded);");
    });
  });

  describe("Task 2: The 'Compact Row' Default State (TradingCard.tsx)", () => {
    it("enforces compact row container height and progressive disclosure layout", () => {
      expect(tradingCardSrc).toContain("min-h-14 sm:min-h-16 h-14 sm:h-16");
      expect(tradingCardSrc).toContain('data-testid={`compact-card-header-${d.symbol}`}');
    });

    it("features Left to Right flow: Chevron toggle, Ticker Symbol, Status Badge, 3 Core Prices", () => {
      // 1. Expand/collapse toggle
      expect(tradingCardSrc).toContain('data-testid={`button-toggle-card-collapse-${d.symbol}`}');
      expect(tradingCardSrc).toContain("setIsExpanded((prev) => !prev)");
      // 2. Ticker symbol with prominent typography
      expect(tradingCardSrc).toContain('text-xl font-extrabold tracking-tight text-soft-white');
      expect(tradingCardSrc).toContain('data-testid={`card-symbol-${d.symbol}`}');
      // 3. Status Badge
      expect(tradingCardSrc).toContain("[ ⚡ LIVE EXECUTION READY ]");
      // 4. 3 Core Prices
      expect(tradingCardSrc).toContain('data-testid={`core-metrics-${d.symbol}`}');
    });

    it("applies institutional typography shift: massive price numbers and tiny uppercase labels", () => {
      // Tiny labels: text-[9px] uppercase tracking-widest text-slate-gray
      expect(tradingCardSrc).toContain("text-[9px] uppercase tracking-widest text-slate-gray");
      // Massive prices: text-lg sm:text-xl font-mono tabular-nums font-bold text-soft-white
      expect(tradingCardSrc).toContain("text-lg sm:text-xl font-mono tabular-nums font-bold text-soft-white");
    });
  });

  describe("Task 3: The 'Expanded View' Institutional State (TradingCard.tsx)", () => {
    it("wraps expanded view inside an institutional glassmorphism panel with smooth Tailwind transitions", () => {
      expect(tradingCardSrc).toContain("bg-ink-deep/40 border-t border-ink-line/50 p-4 mt-2 transition-all duration-200 ease-in-out");
      expect(tradingCardSrc).toContain('data-testid={`card-expanded-details-${d.symbol}`}');
    });

    it("renders institutional execution details (ScaleOutRLadder, Fidelity guide, summary strip, mini-chart) inside expanded body", () => {
      const expandedIdx = tradingCardSrc.indexOf('data-testid={`card-expanded-details-${d.symbol}`}');
      const ladderIdx = tradingCardSrc.indexOf("<ScaleOutRLadder");
      const fidelityIdx = tradingCardSrc.indexOf("<FidelityExecutionGuide");
      const summaryStripIdx = tradingCardSrc.indexOf('data-testid={`setup-card-summary-strip-${d.symbol}`}');
      const miniChartIdx = tradingCardSrc.indexOf('data-testid={`mini-chart-${d.symbol}`}');

      expect(ladderIdx).toBeGreaterThan(expandedIdx);
      expect(fidelityIdx).toBeGreaterThan(expandedIdx);
      expect(summaryStripIdx).toBeGreaterThan(expandedIdx);
      expect(miniChartIdx).toBeGreaterThan(expandedIdx);
    });
  });
});
