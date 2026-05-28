import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type ReactNode } from "react";

// ─── Glossary ────────────────────────────────────────────────────────────────
// Central dictionary of every abbreviation / shorthand used across the cockpit.
// Add a new entry here and reference it by key anywhere via <TermTooltip term="LP" />.
export const GLOSSARY: Record<string, { label: string; definition: string }> = {
  LP: {
    label: "Last Price",
    definition:
      "Most recent quoted price from the live feed. Updates every few seconds while markets are open.",
  },
  R: {
    label: "R-Multiple",
    definition:
      "Current profit/loss measured in units of initial risk. +1R means the trade has made back the dollar amount you risked; -1R means you're at the stop.",
  },
  RR: {
    label: "Reward : Risk",
    definition:
      "Ratio of potential reward (entry → T1) to risk (entry → stop). Minimum 2.0 required to take a trade.",
  },
  "RR→T1": {
    label: "Reward : Risk to T1",
    definition:
      "Reward:Risk ratio calculated against the first target. (T1 − Entry) ÷ (Entry − Stop). Must be ≥ 2.0.",
  },
  "P/L $": {
    label: "Profit / Loss ($)",
    definition:
      "Open profit or loss in dollars on this position, based on the latest price.",
  },
  "% to T1": {
    label: "Distance to Target 1",
    definition:
      "Percent move from the current price to T1. Negative means price is already past T1.",
  },
  "% to Zone": {
    label: "Distance to Entry Zone",
    definition:
      "Percent move from the current price to the bottom of the entry zone. Negative means price is already inside or above the zone.",
  },
  T1: {
    label: "Target 1",
    definition:
      "First profit target. Typically where 50–66% of the position is scaled out.",
  },
  T2: {
    label: "Target 2",
    definition:
      "Second / final profit target. Where the remaining position is closed.",
  },
  Stop: {
    label: "Stop Loss",
    definition:
      "Hard exit price below entry. If price hits this, the trade is closed at -1R no matter what.",
  },
  Entry: {
    label: "Entry Price",
    definition:
      "The price at which you entered the trade. Anchors all risk math.",
  },
  Ticker: {
    label: "Ticker Symbol",
    definition:
      "Exchange symbol for the underlying instrument (e.g. AAPL, SPY).",
  },
  Setup: {
    label: "Setup Type",
    definition:
      "Pattern that triggered the candidate — Trend Pullback or Breakout. Determines entry/stop rules.",
  },
  State: {
    label: "Setup State",
    definition:
      "Lifecycle of the setup — Dormant → Building → Approaching → In-Zone → Armed → Live, or Invalidated.",
  },
  Quals: {
    label: "Qualifiers",
    definition:
      "Count of pattern qualifiers (volume, structure, momentum, etc.) currently confirmed for this setup.",
  },
  "Entry Zone": {
    label: "Entry Zone",
    definition:
      "Price range where the setup is considered tradeable. Buy inside the zone, not above it.",
  },
  Days: {
    label: "Days Held",
    definition: "Number of calendar days the position has been open.",
  },
  "Hold (d)": {
    label: "Hold (Days)",
    definition: "Days between entry and exit on a closed trade.",
  },
  Shares: {
    label: "Shares",
    definition:
      "Share count for the position. Computed as (risk $) ÷ (entry − stop). Supports 2-decimal fractional shares.",
  },
  Regime: {
    label: "Market Regime",
    definition:
      "Current macro regime — Green (full size), Yellow (selective), Red (defense). Sets risk % per trade and max positions.",
  },
  Exit: {
    label: "Exit Price",
    definition: "Price at which the position was closed.",
  },
  Plan: {
    label: "Plan Followed?",
    definition:
      "Yes / No flag for whether the exit followed your written plan — used in the discipline score.",
  },
  Lesson: {
    label: "Lesson Tag",
    definition:
      "Short tag categorizing what this closed trade taught you (e.g. patience, sizing, thesis).",
  },
  Status: {
    label: "Trade Status",
    definition: "Pending → Open → Closed lifecycle of the trade record.",
  },
  Actions: {
    label: "Row Actions",
    definition: "Confirm, edit, close, or archive controls for this trade.",
  },
  Notional: {
    label: "Notional",
    definition:
      "Total dollar value of the position (shares × entry price). Capped per regime.",
  },
  "Per-Share Risk": {
    label: "Per-Share Risk",
    definition: "Dollar amount risked per share. Equals entry − stop.",
  },
  "Risk $ (× mult)": {
    label: "Risk Dollars (× Multiplier)",
    definition:
      "Final dollar risk after applying the discipline multiplier (0×, 0.5×, 1×, or 1.5×).",
  },
  "New Open Risk %": {
    label: "New Open Risk %",
    definition:
      "Combined open-risk after adding this trade. Must stay under the 6% portfolio cap.",
  },
};

// ─── Component ───────────────────────────────────────────────────────────────
// Wraps any text in a click/hover tooltip that shows the term definition.
// Usage: <TermTooltip term="LP" /> or <TermTooltip term="LP">LP</TermTooltip>
export function TermTooltip({
  term,
  children,
  className = "",
}: {
  term: string;
  children?: ReactNode;
  className?: string;
}) {
  const entry = GLOSSARY[term];
  const display = children ?? term;
  if (!entry) {
    return <span className={className}>{display}</span>;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            tabIndex={0}
            className={`cursor-help underline decoration-dotted decoration-slate-gray/50 underline-offset-2 hover:decoration-neon-blue hover:text-neon-blue focus:outline-none focus:text-neon-blue ${className}`}
            data-testid={`tooltip-term-${term.replace(/[^a-zA-Z0-9]+/g, "-")}`}
            onClick={(e) => e.preventDefault()}
          >
            {display}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="max-w-[260px] border border-neon-blue/40 bg-ink-panel text-soft-white px-3 py-2 rounded-sm"
        >
          <div className="text-[11px] uppercase tracking-wider text-neon-blue font-display mb-1">
            {entry.label}
          </div>
          <div className="text-[12px] leading-snug text-soft-white/90">
            {entry.definition}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default TermTooltip;
