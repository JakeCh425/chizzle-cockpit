import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const heroCardPath = path.resolve(__dirname, "../../client/src/components/swing/ActiveExecutionHeroCard.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");

describe("UI Refactor - Position Share Truncation Fix & Compact Beginner-Friendly Card Architecture", () => {
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fix Position Size Text Truncation ('3 Shar', '17 Shar')", () => {
    it("removes rigid fixed widths (w-20, max-w-[80px]) and applies flexible container min-w-[100px]/min-w-[110px] shrink-0", () => {
      expect(heroCardSrc).not.toContain("w-20");
      expect(heroCardSrc).toContain("min-w-[110px] shrink-0");
      expect(tradingCardSrc).toContain("min-w-[100px] shrink-0");
      expect(tradingCardSrc).toContain("min-w-[110px] shrink-0");
    });

    it("formats shares cleanly with whitespace-nowrap and singular/plural formatting ('Share' / 'Shares')", () => {
      expect(heroCardSrc).toContain("{calculatedShares} {calculatedShares === 1 ? 'Share' : 'Shares'}");
      expect(heroCardSrc).toContain("whitespace-nowrap");

      expect(tradingCardSrc).toContain("{calculatedShares} {calculatedShares === 1 ? 'Share' : 'Shares'}");
      expect(tradingCardSrc).toContain("whitespace-nowrap");
    });

    it("labels the metric clearly as Position Size / POSITION SIZING", () => {
      expect(heroCardSrc).toContain("POSITION SIZING");
      expect(tradingCardSrc).toContain("Position Size");
    });
  });

  describe("2. High-Density Beginner-Friendly Card Architecture (ActiveExecutionHeroCard)", () => {
    it("Row 1 (Status & Header): renders Ticker, Live Price, Status Badge, Alert Pill, and [ ⌄ Details ] toggle", () => {
      // Ticker symbol in text-xl/text-2xl font-black text-white
      expect(heroCardSrc).toContain("text-xl sm:text-2xl font-black uppercase tracking-tight text-white");
      // Live exchange price in font-mono text-emerald-400
      expect(heroCardSrc).toContain("text-xl sm:text-2xl font-mono font-black text-emerald-400 tabular-nums");
      // Status badge: [ 1H 20-SMA CONFIRMED ]
      expect(heroCardSrc).toContain("1H 20-SMA CONFIRMED");
      // Alert timestamp pill
      expect(heroCardSrc).toContain("[ 🔔 Alert Sent:");
      // [ ⌄ Details ] toggle button
      expect(heroCardSrc).toContain("[ ⌄ Details ]");
      expect(heroCardSrc).toContain("[ ⌃ Details ]");
    });

    it("Row 2 (Core Trade Math - 4 Columns): renders Entry, Stop Loss, Target 1, and Position Sizing", () => {
      // Col 1: Limit Entry
      expect(heroCardSrc).toContain("ENTRY (LIMIT)");
      expect(heroCardSrc).toContain("${trade.entryPrice.toFixed(2)}");

      // Col 2: Stop Loss (-1.0R) with planned dollar loss
      expect(heroCardSrc).toContain("STOP (-1.0R)");
      expect(heroCardSrc).toContain("${trade.stopLoss.toFixed(2)}");
      expect(heroCardSrc).toContain("-${plannedLoss.toFixed(2)}");

      // Col 3: Target 1 (1.5R) with planned dollar gain
      expect(heroCardSrc).toContain("TARGET 1 (1.5R)");
      expect(heroCardSrc).toContain("${trade.target1.toFixed(2)}");
      expect(heroCardSrc).toContain("+${plannedGain.toFixed(2)}");

      // Col 4: Position Sizing with total cash cost & equity percentage
      expect(heroCardSrc).toContain("POSITION SIZING");
      expect(heroCardSrc).toContain("{equityPct}% Equity");
    });

    it("Row 3 (Action Footer): renders Copy Fidelity Ticket, Log Trade, Dismiss, and Runners summary", () => {
      // [ ⚡ Copy Fidelity Ticket ]
      expect(heroCardSrc).toContain("[ ⚡ Copy Fidelity Ticket ]");
      expect(heroCardSrc).toContain('data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}');

      // [ 📋 Log Trade ]
      expect(heroCardSrc).toContain("[ 📋 Log Trade ]");
      expect(heroCardSrc).toContain('data-testid={`button-log-trade-${trade.symbol}`}');

      // [ ✕ Dismiss ]
      expect(heroCardSrc).toContain("[ ✕ Dismiss ]");
      expect(heroCardSrc).toContain('data-testid={`button-dismiss-hero-${trade.symbol}`}');

      // Right edge: Runners summary (T2 / T3)
      expect(heroCardSrc).toContain('data-testid={`hero-runners-summary-${trade.symbol}`}');
      expect(heroCardSrc).toContain("T2: ${trade.target2.toFixed(2)} | T3: ${t3Price.toFixed(2)}");
    });
  });

  describe("3. Drawer Accordion for Advanced Diagnostics", () => {
    it("wraps advanced elements (action engine, scale-out ladder, Fidelity ticket) inside conditional isExpanded block", () => {
      expect(heroCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
      expect(heroCardSrc).toContain("{isExpanded && (");
      expect(heroCardSrc).toContain('data-testid={`hero-expanded-details-${trade.symbol}`}');
      expect(heroCardSrc).toContain("<StepByStepActionChecklist");
      expect(heroCardSrc).toContain("<ScaleOutRLadder");
      expect(heroCardSrc).toContain('data-testid={`hero-fidelity-ticket-${trade.symbol}`}');
    });

    it("defaults isExpanded to false across both hero card and compact trading card", () => {
      expect(heroCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
      expect(tradingCardSrc).toContain("const [isExpanded, setIsExpanded] = useState(false);");
    });
  });

  describe("4. Cash Allocation Safety Guard", () => {
    it("evaluates if total position cost exceeds available cash", () => {
      expect(heroCardSrc).toContain("const isCashExceeded = totalPositionCost > availableCash;");
      expect(tradingCardSrc).toContain("effectiveFunding > (global?.availableCash ?? 25000)");
    });

    it("renders an amber warning pill '[ ⚠️ Cash Limit Exceeded ]' when cash limit is breached", () => {
      expect(heroCardSrc).toContain("[ ⚠️ Cash Limit Exceeded ]");
      expect(heroCardSrc).toContain('data-testid={`badge-cash-exceeded-${trade.symbol}`}');

      expect(tradingCardSrc).toContain("[ ⚠️ Cash Limit Exceeded ]");
      expect(tradingCardSrc).toContain('data-testid={`badge-card-cash-exceeded-${d.symbol}`}');
    });

    it("disables execution/arm action button when cash limit is exceeded", () => {
      expect(heroCardSrc).toContain("disabled={isExecuting || isCashExceeded}");
      expect(heroCardSrc).toContain("bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-50");
    });
  });
});
