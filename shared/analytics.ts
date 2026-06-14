// ─── Phase 4: Analytics shared types ─────────────────────────────────────────
// Pure types only. No runtime. Server returns UnifiedTrade[]; client computes
// metrics and breakdowns from that single list.

/**
 * A single closed-trade row, unioned from the legacy `trades` table and the
 * Phase 2/3 lifecycle (`trade_plans` + `trade_executions` + `trade_reviews`).
 *
 * All P&L values are NET (after fees) where fees are available.
 * `rMultiple` is null when planned risk cannot be computed (e.g. entry == stop
 * or plannedShares == 0).
 */
export interface UnifiedTrade {
  /** Stable id prefixed by source so legacy id 7 and new id "uuid" never collide. */
  id: string;
  source: "legacy" | "new";
  ticker: string;
  /** Normalized setup label (lowercased, trimmed) for breakdown grouping. */
  setupType: string;
  /** Display version of setup label, preserves original case. */
  setupTypeRaw: string;
  direction: "long" | "short";
  /** Status is always "closed" in this dataset. Kept for filter symmetry. */
  status: "closed";
  /** First execution timestamp (new) or `openedAt` (legacy). ISO string. */
  openedAt: string;
  /** Last execution timestamp (new) or `closedAt` (legacy). ISO string. */
  closedAt: string;
  /** Net realized P&L in dollars. */
  netPnl: number;
  /** Planned $ risk = |entry − stop| × plannedShares. Null if not computable. */
  plannedRiskDollars: number | null;
  /** Realized R-multiple = netPnl / plannedRiskDollars. Null if not computable. */
  rMultiple: number | null;
  /** True/false if recorded, null when no review/legacy flag exists. */
  followedPlan: boolean | null;
  /** Lowercased tag names attached via Phase 3 reviews. Always [] for legacy. */
  tags: string[];
  /** Hold duration in days (closedAt − openedAt). 0 for same-day. */
  holdDays: number;
}

/**
 * Filter shape used by the analytics page. All fields optional; absent fields
 * mean "no constraint".
 */
export interface AnalyticsFilters {
  /** ISO date (YYYY-MM-DD). Trades with closedAt >= from are kept. */
  from?: string;
  /** ISO date (YYYY-MM-DD). Trades with closedAt <= to (end of day) are kept. */
  to?: string;
  ticker?: string;
  setupType?: string;
  direction?: "long" | "short";
  /** Reserved for future expansion; right now the dataset is always closed. */
  status?: "closed";
  followedPlan?: boolean;
  /** Lowercased tag name; matches trades that have this tag in their `tags`. */
  tag?: string;
}

/**
 * Core performance metrics — section A of the Phase 4 spec.
 * All R-based metrics ignore trades with rMultiple == null.
 */
export interface CoreMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakEven: number;
  winRate: number;          // 0..1
  lossRate: number;         // 0..1
  avgWin: number;           // dollars, positive
  avgLoss: number;          // dollars, positive magnitude (NOT signed)
  avgRR: number;            // average reward-to-risk among winners only
  expectancy: number;       // dollars; (winRate × avgWin) − (lossRate × avgLoss)
  expectancyR: number;      // R; same formula in R units
  profitFactor: number;     // grossWin / grossLoss; Infinity if no losers
  grossPnl: number;         // sum of positive nets (gross win) — gross profits
  grossLoss: number;        // sum of |negative nets| — gross losses (positive)
  netPnl: number;           // grossPnl − grossLoss
  maxDrawdown: number;      // dollars (negative or 0)
  maxDrawdownPct: number;   // percent of peak equity; 0..−100
  avgHoldDays: number;
  longestWinStreak: number;
  longestLossStreak: number;
  // R-multiple support
  totalR: number;
  avgR: number;
  rCounted: number;         // # of trades with non-null R
}

/** A single row in a breakdown table. */
export interface BreakdownRow {
  key: string;
  label: string;
  n: number;
  winRate: number;
  avgR: number;
  totalR: number;
  netPnl: number;
  expectancyR: number;
}

export type BreakdownDimension =
  | "ticker"
  | "setup"
  | "tag"
  | "followedPlan"
  | "month"
  | "week"
  | "day";

/** One point on the reconstructed equity curve. */
export interface EquityPoint {
  /** ISO date string (closedAt). */
  date: string;
  /** Cumulative net P&L up to and including this trade. */
  cumulativePnl: number;
  /** Peak cumulative P&L seen so far. */
  peak: number;
  /** Drawdown from peak (negative or 0, dollars). */
  drawdown: number;
}

/** A bucket in the R-distribution histogram. */
export interface RDistributionBucket {
  label: string;
  /** Inclusive lower bound; null = -Infinity. */
  min: number | null;
  /** Exclusive upper bound; null = +Infinity. */
  max: number | null;
  count: number;
}
