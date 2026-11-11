import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const heroCardPath = path.resolve(__dirname, "../../client/src/components/swing/ActiveExecutionHeroCard.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");

describe("Action Center UI Overhaul - Modern Institutional Card Tile Architecture & High-Contrast Visual Hierarchy", () => {
  const heroCardSrc = fs.readFileSync(heroCardPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. High-Contrast Card Tile Architecture (ActiveExecutionHeroCard)", () => {
    it("wraps each card in an isolated, dark slate container with mb-3", () => {
      expect(heroCardSrc).toContain("bg-[#0d131f] border border-slate-700/70 hover:border-slate-500 rounded-xl p-4 shadow-lg mb-3 transition-colors");
    });

    it("renders Top Header Strip (Row 1) with prominent Ticker, Live Price, and Consolidated Status Pill", () => {
      // Ticker: text-2xl font-black tracking-tight text-white
      expect(heroCardSrc).toContain("text-2xl font-black tracking-tight text-white");

      // Current Live Price: text-2xl font-bold font-mono text-slate-100 ml-2
      expect(heroCardSrc).toContain("text-2xl font-bold font-mono text-slate-100 ml-2 tabular-nums");

      // Consolidated Status Pill: Single high-contrast badge
      expect(heroCardSrc).toContain("px-2.5 py-1 text-xs font-bold font-mono uppercase rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/50");
      expect(heroCardSrc).toContain("⚡ READY TO EXECUTE");

      // Secondary Context: Support level and alert timestamp
      expect(heroCardSrc).toContain("text-xs text-slate-400 font-mono ml-auto mr-3");
      expect(heroCardSrc).toContain("Confirmed");

      // Accordion Toggle on far right
      expect(heroCardSrc).toContain("[ ⌄ Details ]");
      expect(heroCardSrc).toContain("[ ⌃ Details ]");
    });
  });

  describe("2. Large, Semantic Data Columns (Row 2 - 4-Column Grid)", () => {
    it("renders a 4-column balanced grid with border-y border-slate-800/80", () => {
      expect(heroCardSrc).toContain("grid grid-cols-2 lg:grid-cols-4 gap-4 py-3 my-2 border-y border-slate-800/80");
    });

    it("Col 1 (Limit Entry): renders cyan-400 price and 1H Candle Confirmed subtext", () => {
      expect(heroCardSrc).toContain("text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold");
      expect(heroCardSrc).toContain("ENTRY (LIMIT)");
      expect(heroCardSrc).toContain("text-2xl font-bold font-mono text-cyan-400 tabular-nums");
      expect(heroCardSrc).toContain("${trade.entryPrice.toFixed(2)}");
      expect(heroCardSrc).toContain("1H Candle Confirmed");
    });

    it("Col 2 (Protective Stop): renders rose-400 price and -$XX.XX (1.0R Risk) subtext", () => {
      expect(heroCardSrc).toContain("text-[11px] font-mono uppercase tracking-wider text-rose-400 font-semibold");
      expect(heroCardSrc).toContain("STOP (-1.0R)");
      expect(heroCardSrc).toContain("text-2xl font-bold font-mono text-rose-400 tabular-nums");
      expect(heroCardSrc).toContain("${trade.stopLoss.toFixed(2)}");
      expect(heroCardSrc).toContain("-${plannedLoss.toFixed(2)} (1.0R Risk)");
    });

    it("Col 3 (Target 1 - 1.5R): renders emerald-400 price and +$XX.XX Profit (50% Scale) subtext", () => {
      expect(heroCardSrc).toContain("text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-semibold");
      expect(heroCardSrc).toContain("TARGET 1 (1.5R)");
      expect(heroCardSrc).toContain("text-2xl font-bold font-mono text-emerald-400 tabular-nums");
      expect(heroCardSrc).toContain("${trade.target1.toFixed(2)}");
      expect(heroCardSrc).toContain("+${plannedGain.toFixed(2)} Profit (50% Scale)");
    });

    it("Col 4 (Position Sizing & Cash): renders amber-300 label, 2xl white shares count, and Cash • Eq Risk subtext", () => {
      expect(heroCardSrc).toContain("text-[11px] font-mono uppercase tracking-wider text-amber-300 font-semibold");
      expect(heroCardSrc).toContain("POSITION SIZING");
      expect(heroCardSrc).toContain("text-2xl font-bold font-mono text-white tabular-nums whitespace-nowrap");
      expect(heroCardSrc).toContain("{calculatedShares} {calculatedShares === 1 ? 'Share' : 'Shares'}");
      expect(heroCardSrc).toContain("Cash • ${equityPct}% Eq Risk");
    });
  });

  describe("3. Tactile Action Button Footer (Row 3)", () => {
    it("Primary button: renders solid tactile cyan Copy Fidelity Ticket button", () => {
      expect(heroCardSrc).toContain("bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs font-mono flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer");
      expect(heroCardSrc).toContain("[ ⚡ Copy Fidelity Ticket ]");
      expect(heroCardSrc).toContain('data-testid={`button-copy-fidelity-ticket-${trade.symbol}`}');
    });

    it("Secondary button: renders solid tactile emerald Log Trade button", () => {
      expect(heroCardSrc).toContain("bg-emerald-600 hover:bg-emerald-500 text-white");
      expect(heroCardSrc).toContain("[ 📋 Log Trade ]");
      expect(heroCardSrc).toContain('data-testid={`button-log-trade-${trade.symbol}`}');
    });

    it("Tertiary button: renders solid slate Dismiss button", () => {
      expect(heroCardSrc).toContain("bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-xs font-mono cursor-pointer");
      expect(heroCardSrc).toContain("[ ✕ Dismiss ]");
      expect(heroCardSrc).toContain('data-testid={`button-dismiss-hero-${trade.symbol}`}');
    });

    it("Inline Extended Targets: renders T2 (2.0R) and T3 (3.0R) in subtle text-xs text-slate-400", () => {
      expect(heroCardSrc).toContain("T2: ${trade.target2.toFixed(2)} (2.0R) | T3: ${t3Price.toFixed(2)} (3.0R)");
      expect(heroCardSrc).toContain('data-testid={`hero-runners-summary-${trade.symbol}`}');
    });
  });

  describe("4. Parent Container Spacing & Contrast (ActionCenter Zone A)", () => {
    it("wraps Zone A in clean dark slate container (#080d16) with border-slate-800", () => {
      expect(actionCenterSrc).toContain("border border-slate-800 bg-[#080d16] p-4 shadow-lg backdrop-blur-md animate-in fade-in duration-300 w-full col-span-full mb-3");
    });

    it("renders high-contrast total active count badge in bg-emerald-500 text-black", () => {
      expect(actionCenterSrc).toContain("bg-emerald-500 text-black px-2 py-0.5 rounded-full font-bold text-xs font-mono");
    });
  });
});
