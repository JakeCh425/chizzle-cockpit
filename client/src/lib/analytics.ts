// ─── Phase 4: Analytics pure utilities ───────────────────────────────────────
// No React, no fetching. Every function is deterministic and takes
// UnifiedTrade[] (already closed, already unioned by the server).
//
// Inputs are assumed pre-sorted by `closedAt` ascending (server does this),
// but functions that depend on order re-sort defensively.

import type {
  UnifiedTrade,
  AnalyticsFilters,
  CoreMetrics,
  BreakdownRow,
  BreakdownDimension,
  EquityPoint,
  RDistributionBucket,
} from "@shared/analytics";

// ─── Filtering ───────────────────────────────────────────────────────────────

/**
 * Apply the analytics filter shape to a list of trades. Date filters were
 * applied server-side; we re-apply here as a safety net so client-only
 * filter changes still produce the right slice without a refetch.
 */
export function applyFilters(trades: UnifiedTrade[], f: AnalyticsFilters): UnifiedTrade[] {
  const fromTs = f.from ? Date.parse(f.from + "T00:00:00Z") : null;
  const toTs   = f.to   ? Date.parse(f.to   + "T23:59:59.999Z") : null;
  const wantTag = f.tag ? f.tag.toLowerCase() : null;
  const wantSetup = f.setupType ? f.setupType.toLowerCase().trim() : null;
  const wantTicker = f.ticker ? f.ticker.toUpperCase() : null;

  return trades.filter((t) => {
    if (fromTs != null) {
      const ts = Date.parse(t.closedAt);
      if (!Number.isFinite(ts) || ts < fromTs) return false;
    }
    if (toTs != null) {
      const ts = Date.parse(t.closedAt);
      if (!Number.isFinite(ts) || ts > toTs) return false;
    }
    if (wantTicker && t.ticker.toUpperCase() !== wantTicker) return false;
    if (wantSetup && t.setupType !== wantSetup) return false;
    if (f.direction && t.direction !== f.direction) return false;
    if (f.followedPlan !== undefined && t.followedPlan !== f.followedPlan) return false;
    if (wantTag && !t.tags.includes(wantTag)) return false;
    return true;
  });
}

// ─── Core metrics (section A) ────────────────────────────────────────────────

/**
 * Empty-state metrics object. Returned when there are zero closed trades so
 * the UI never has to null-check individual fields.
 */
export const EMPTY_METRICS: CoreMetrics = {
  totalTrades: 0,
  wins: 0,
  losses: 0,
  breakEven: 0,
  winRate: 0,
  lossRate: 0,
  avgWin: 0,
  avgLoss: 0,
  avgRR: 0,
  expectancy: 0,
  expectancyR: 0,
  profitFactor: 0,
  grossPnl: 0,
  grossLoss: 0,
  netPnl: 0,
  maxDrawdown: 0,
  maxDrawdownPct: 0,
  avgHoldDays: 0,
  longestWinStreak: 0,
  longestLossStreak: 0,
  totalR: 0,
  avgR: 0,
  rCounted: 0,
};

/**
 * Compute every Phase 4 KPI from a list of (already filtered) closed trades.
 *
 * Decisions:
 *  - A "win" is netPnl > 0. A "loss" is netPnl < 0. Exactly zero is break-even
 *    and excluded from win/loss rate denominators-by-outcome but included in
 *    `totalTrades` and `netPnl`.
 *  - `avgWin` and `avgLoss` are dollar magnitudes (avgLoss is positive).
 *  - `avgRR` is the average of (win_size / avg_loss_size) is misleading; we
 *    instead use the cleaner "average reward-to-risk realized on winners" =
 *    avgWin / avgLoss. Falls back to 0 when there are no losers.
 *  - `expectancy` uses your formula verbatim: (WR × avgWin) − (LR × avgLoss).
 *  - `profitFactor` = grossPnl / grossLoss. When grossLoss == 0 and grossPnl > 0
 *    we return Infinity; UI formats it as "∞".
 *  - R metrics ignore trades with null R (`rCounted` reports the population).
 *  - Streaks count consecutive wins/losses; break-evens reset both streaks.
 *  - Drawdown is computed against the reconstructed cumulative-net-P&L curve
 *    (anchored at 0); `maxDrawdownPct` is relative to peak — if peak is 0
 *    (no profits yet) we report 0% rather than divide by zero.
 */
export function computeCoreMetrics(trades: UnifiedTrade[]): CoreMetrics {
  if (trades.length === 0) return { ...EMPTY_METRICS };

  // Sort by closedAt for streaks + drawdown. Defensive copy.
  const sorted = trades.slice().sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));

  let wins = 0, losses = 0, breakEven = 0;
  let grossPnl = 0, grossLoss = 0;
  let holdSum = 0;
  let totalR = 0, rCounted = 0;
  let longestWinStreak = 0, longestLossStreak = 0;
  let curWin = 0, curLoss = 0;

  for (const t of sorted) {
    const p = t.netPnl;
    if (p > 0) {
      wins++;
      grossPnl += p;
      curWin++; curLoss = 0;
      if (curWin > longestWinStreak) longestWinStreak = curWin;
    } else if (p < 0) {
      losses++;
      grossLoss += -p;
      curLoss++; curWin = 0;
      if (curLoss > longestLossStreak) longestLossStreak = curLoss;
    } else {
      breakEven++;
      curWin = 0; curLoss = 0;
    }
    holdSum += t.holdDays;
    if (t.rMultiple != null && Number.isFinite(t.rMultiple)) {
      totalR += t.rMultiple;
      rCounted++;
    }
  }

  const totalTrades = sorted.length;
  const decisive = wins + losses; // exclude break-evens from rate denominator
  const winRate  = decisive > 0 ? wins   / decisive : 0;
  const lossRate = decisive > 0 ? losses / decisive : 0;

  const avgWin  = wins   > 0 ? grossPnl  / wins   : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  const avgRR   = avgLoss > 0 ? avgWin / avgLoss : 0;

  const expectancy  = winRate * avgWin - lossRate * avgLoss;
  const expectancyR = rCounted > 0 ? totalR / rCounted : 0;

  const profitFactor = grossLoss > 0 ? grossPnl / grossLoss : (grossPnl > 0 ? Infinity : 0);
  const netPnl = grossPnl - grossLoss;

  // Reconstructed equity (cumulative net P&L anchored at 0)
  const curve = computeEquityCurve(sorted);
  const { maxDrawdown, maxDrawdownPct } = computeDrawdown(curve);

  const avgHoldDays = totalTrades > 0 ? holdSum / totalTrades : 0;
  const avgR = rCounted > 0 ? totalR / rCounted : 0;

  return {
    totalTrades,
    wins,
    losses,
    breakEven,
    winRate,
    lossRate,
    avgWin,
    avgLoss,
    avgRR,
    expectancy,
    expectancyR,
    profitFactor,
    grossPnl,
    grossLoss,
    netPnl,
    maxDrawdown,
    maxDrawdownPct,
    avgHoldDays,
    longestWinStreak,
    longestLossStreak,
    totalR,
    avgR,
    rCounted,
  };
}

// ─── Equity curve + drawdown ─────────────────────────────────────────────────

/**
 * Build a cumulative-net-P&L curve from sorted closed trades. Each point
 * carries cumulative P&L, the running peak, and the drawdown from that peak.
 */
export function computeEquityCurve(trades: UnifiedTrade[]): EquityPoint[] {
  const sorted = trades.slice().sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const out: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  for (const t of sorted) {
    cum += t.netPnl;
    if (cum > peak) peak = cum;
    out.push({
      date: t.closedAt,
      cumulativePnl: cum,
      peak,
      drawdown: cum - peak,
    });
  }
  return out;
}

/**
 * Max drawdown in dollars and as a percentage of peak.
 * - When the curve never goes positive, `maxDrawdownPct` is 0 (can't divide
 *   by a non-positive peak meaningfully).
 * - Returned `maxDrawdown` is ≤ 0; `maxDrawdownPct` is in the range [-100, 0].
 */
export function computeDrawdown(curve: EquityPoint[]): { maxDrawdown: number; maxDrawdownPct: number } {
  let worst = 0;
  let worstPeak = 0;
  for (const p of curve) {
    if (p.drawdown < worst) {
      worst = p.drawdown;
      worstPeak = p.peak;
    }
  }
  const maxDrawdownPct = worstPeak > 0 ? (worst / worstPeak) * 100 : 0;
  return { maxDrawdown: worst, maxDrawdownPct };
}

// ─── R distribution ──────────────────────────────────────────────────────────

const R_BUCKETS: Array<{ label: string; min: number | null; max: number | null }> = [
  { label: "≤ -2R",      min: null, max: -2   },
  { label: "-2 to -1R",  min: -2,   max: -1   },
  { label: "-1 to 0R",   min: -1,   max:  0   },
  { label: "0 to 1R",    min:  0,   max:  1   },
  { label: "1 to 2R",    min:  1,   max:  2   },
  { label: "≥ 2R",       min:  2,   max: null },
];

/**
 * Histogram of realized R-multiples in fixed buckets. Trades with null R
 * are silently excluded.
 */
export function computeRDistribution(trades: UnifiedTrade[]): RDistributionBucket[] {
  return R_BUCKETS.map((b) => {
    const count = trades.reduce((n, t) => {
      const r = t.rMultiple;
      if (r == null || !Number.isFinite(r)) return n;
      const ge = b.min == null ? true : r >= b.min;
      const lt = b.max == null ? true : r < b.max;
      return n + (ge && lt ? 1 : 0);
    }, 0);
    return { ...b, count };
  });
}

// ─── Breakdowns (section C) ──────────────────────────────────────────────────

/**
 * Group trades by a dimension and compute per-group win rate / avg R / total
 * R / net P&L / expectancy (in R).
 *
 * For dimension "tag", trades are counted once per distinct tag they carry
 * (membership semantics): a trade with [breakout, trend] appears in both rows.
 * Trades with zero tags are placed in a "(untagged)" bucket so they are not
 * silently dropped from the breakdown.
 */
export function computeBreakdown(
  trades: UnifiedTrade[],
  dim: BreakdownDimension,
): BreakdownRow[] {
  // Bucket each trade into one or more (key, label) pairs.
  const keyOf = (t: UnifiedTrade): Array<{ key: string; label: string }> => {
    switch (dim) {
      case "ticker":
        return [{ key: t.ticker, label: t.ticker || "(unknown)" }];
      case "setup":
        return [{ key: t.setupType || "(none)", label: t.setupTypeRaw || t.setupType || "(none)" }];
      case "tag":
        if (t.tags.length === 0) return [{ key: "__untagged__", label: "(untagged)" }];
        return t.tags.map((tag) => ({ key: tag, label: tag }));
      case "followedPlan":
        return [{
          key: t.followedPlan == null ? "unknown" : t.followedPlan ? "yes" : "no",
          label: t.followedPlan == null ? "Unknown" : t.followedPlan ? "Followed plan" : "Did not follow",
        }];
      case "month": {
        const d = new Date(t.closedAt);
        if (!Number.isFinite(d.getTime())) return [{ key: "(invalid)", label: "(invalid)" }];
        const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return [{ key: k, label: k }];
      }
      case "week": {
        // ISO week label (YYYY-Www). Simplified: take the Monday of the UTC
        // week containing closedAt.
        const d = new Date(t.closedAt);
        if (!Number.isFinite(d.getTime())) return [{ key: "(invalid)", label: "(invalid)" }];
        const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = (monday.getUTCDay() + 6) % 7; // 0=Mon
        monday.setUTCDate(monday.getUTCDate() - day);
        const k = monday.toISOString().slice(0, 10);
        return [{ key: k, label: `Wk of ${k}` }];
      }
      case "day": {
        const k = (t.closedAt || "").slice(0, 10);
        return [{ key: k || "(invalid)", label: k || "(invalid)" }];
      }
    }
  };

  type Acc = { label: string; trades: UnifiedTrade[] };
  const buckets = new Map<string, Acc>();
  for (const t of trades) {
    for (const { key, label } of keyOf(t)) {
      if (!buckets.has(key)) buckets.set(key, { label, trades: [] });
      buckets.get(key)!.trades.push(t);
    }
  }

  const rows: BreakdownRow[] = [];
  for (const [key, { label, trades: subset }] of buckets) {
    const m = computeCoreMetrics(subset);
    rows.push({
      key,
      label,
      n: m.totalTrades,
      winRate: m.winRate,
      avgR: m.avgR,
      totalR: m.totalR,
      netPnl: m.netPnl,
      expectancyR: m.expectancyR,
    });
  }

  // Time dimensions sort chronologically; everything else sorts by trade
  // count descending so the most-active groups float to the top.
  if (dim === "month" || dim === "week" || dim === "day") {
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  } else {
    rows.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  }
  return rows;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function fmtUsd(n: number, opts?: { sign?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  const sign = opts?.sign && n > 0 ? "+" : "";
  const abs = Math.abs(n);
  const rounded = abs >= 1000 ? abs.toFixed(0) : abs.toFixed(2);
  return `${n < 0 ? "−" : sign}$${rounded}`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtR(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}R`;
}

export function fmtFactor(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "—";
  return n.toFixed(2);
}

export function fmtDays(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${(n * 24).toFixed(1)}h`;
  return `${n.toFixed(1)}d`;
}
