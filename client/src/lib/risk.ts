// Phase 5 — Risk Governor pure calc utilities.
//
// All functions are pure (no fetches, no React). They take primitives from
// the existing endpoints (/api/settings, /api/analytics/trades,
// /api/risk/open-positions, /api/trade-plans) and produce the user-facing
// risk status + violation list.
//
// Date-boundary assumptions:
//   - Daily window: [start-of-today, start-of-tomorrow) in **America/Chicago**.
//     Reset at local midnight.
//   - Weekly window: ISO week (Mon 00:00 → next Mon 00:00) in America/Chicago.
//   - Drawdown: peak-to-current of cumulative realized P&L across the full
//     unified closed-trade history (legacy + new). If peak <= 0, drawdown
//     is reported as 0% with `drawdownFallback: true`.

import type {
  RiskRules,
  RiskStatus,
  RiskViolation,
  OpenPositionRisk,
  PlanRiskInput,
  ScaleGuidance,
  Settings,
} from "@shared/risk";

const TZ = "America/Chicago";

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve the active risk rules from Settings + active regime.
 * Per-trade % and max-positions are regime-aware in this codebase, so we
 * collapse them to a single number at evaluation time.
 */
export function resolveRiskRules(
  settings: Settings,
  activeRegime: "GREEN" | "YELLOW" | "RED",
): RiskRules {
  const perTrade =
    activeRegime === "GREEN"
      ? settings.riskPctGreen
      : activeRegime === "YELLOW"
        ? settings.riskPctYellow
        : settings.riskPctRed;
  const maxPos =
    activeRegime === "GREEN"
      ? settings.maxPositionsGreen
      : activeRegime === "YELLOW"
        ? settings.maxPositionsYellow
        : settings.maxPositionsRed;
  return {
    maxRiskPerTradePercent: perTrade,
    maxOpenRiskPercent: settings.maxOpenRiskPct,
    maxOpenPositions: maxPos,
    maxDailyLossAmount: settings.maxDailyLossAmount,
    maxWeeklyLossAmount: settings.maxWeeklyLossAmount,
    maxDrawdownPercent: settings.maxDrawdownPercent,
    scaleUpMinTrades: settings.scaleUpMinTrades,
    scaleUpMinExpectancy: settings.scaleUpMinExpectancy,
    scaleDownDrawdownPercent: settings.scaleDownDrawdownPercent,
  };
}

/** Format an ISO timestamp into America/Chicago `YYYY-MM-DD`. */
function localDateStr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // sv-SE locale produces YYYY-MM-DD format; pinning the TZ gives us
  // calendar-day grouping in the user's local zone without pulling in a
  // date library.
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Today's date in TZ, as `YYYY-MM-DD`. */
function todayLocal(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/**
 * ISO week key (e.g. `2026-W24`) for an ISO timestamp, in America/Chicago.
 * Used to group closed trades into the current week.
 */
function isoWeekKey(iso: string, now: Date = new Date()): string {
  void now; // unused, retained for API symmetry
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Get Y/M/D in local TZ.
  const ymd = d.toLocaleDateString("sv-SE", { timeZone: TZ });
  const [y, m, day] = ymd.split("-").map(Number);
  // Build a UTC Date at noon to dodge DST edges, then apply ISO-week math.
  const dt = new Date(Date.UTC(y, m - 1, day, 12));
  const dayOfWeek = (dt.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  // Move to the Thursday of this week (ISO week defining day).
  dt.setUTCDate(dt.getUTCDate() - dayOfWeek + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const firstThuDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThuDow + 3);
  const week =
    1 +
    Math.round(
      (dt.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── P&L windows ──────────────────────────────────────────────────────────

export interface ClosedTradeMin {
  closedAt: string | null;
  netPnl: number | null;
}

/** Sum of realized P&L for closed trades that closed today (local TZ). */
export function computeDailyPnl(
  trades: ClosedTradeMin[],
  now: Date = new Date(),
): number {
  const today = todayLocal(now);
  return trades.reduce((acc, t) => {
    if (!t.closedAt || t.netPnl == null) return acc;
    return localDateStr(t.closedAt) === today ? acc + t.netPnl : acc;
  }, 0);
}

/** Sum of realized P&L for closed trades that closed in this ISO week. */
export function computeWeeklyPnl(
  trades: ClosedTradeMin[],
  now: Date = new Date(),
): number {
  const nowIso = now.toISOString();
  const currentWeek = isoWeekKey(nowIso, now);
  return trades.reduce((acc, t) => {
    if (!t.closedAt || t.netPnl == null) return acc;
    return isoWeekKey(t.closedAt, now) === currentWeek ? acc + t.netPnl : acc;
  }, 0);
}

// ─── drawdown ─────────────────────────────────────────────────────────────

/**
 * Drawdown = (peak - current) / peak × 100, where peak/current are computed
 * over the cumulative net realized P&L curve in chronological order. If
 * peak <= 0 the function reports 0% and sets `fallback: true` so the UI
 * can label the value as not-yet-meaningful.
 */
export function computeDrawdown(trades: ClosedTradeMin[]): {
  drawdownPercent: number;
  fallback: boolean;
} {
  const sorted = trades
    .filter((t) => t.closedAt && t.netPnl != null)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.closedAt as string).getTime() -
        new Date(b.closedAt as string).getTime(),
    );
  let cum = 0;
  let peak = 0;
  for (const t of sorted) {
    cum += t.netPnl as number;
    if (cum > peak) peak = cum;
  }
  if (peak <= 0) return { drawdownPercent: 0, fallback: true };
  const drawdownPercent = ((peak - cum) / peak) * 100;
  return { drawdownPercent: Math.max(0, drawdownPercent), fallback: false };
}

// ─── open risk ────────────────────────────────────────────────────────────

export function computeOpenRisk(positions: OpenPositionRisk[]): {
  openRiskDollars: number;
  openPositionsCount: number;
} {
  let openRiskDollars = 0;
  for (const p of positions) openRiskDollars += p.riskDollars;
  return { openRiskDollars, openPositionsCount: positions.length };
}

// ─── scaling guidance ─────────────────────────────────────────────────────

export interface ClosedTradeForExpectancy {
  rMultiple: number | null;
  closedAt: string | null;
}

/**
 * Expectancy in R-multiples over the most recent N closed trades that have a
 * valid R-multiple. Empty/insufficient samples return expectancy=0 and
 * sampleSize equal to whatever was usable.
 */
export function computeExpectancyR(
  trades: ClosedTradeForExpectancy[],
  windowSize = 20,
): { expectancyR: number; sampleSize: number } {
  const valid = trades
    .filter((t) => t.rMultiple != null && t.closedAt)
    .sort(
      (a, b) =>
        new Date(b.closedAt as string).getTime() -
        new Date(a.closedAt as string).getTime(),
    )
    .slice(0, windowSize)
    .map((t) => t.rMultiple as number);
  if (valid.length === 0) return { expectancyR: 0, sampleSize: 0 };
  const sum = valid.reduce((a, b) => a + b, 0);
  return { expectancyR: sum / valid.length, sampleSize: valid.length };
}

export function computeScaleGuidance(
  rules: RiskRules,
  drawdownPercent: number,
  drawdownFallback: boolean,
  expectancy: { expectancyR: number; sampleSize: number },
): ScaleGuidance {
  const reasons: string[] = [];
  // Scale-down trigger wins over scale-up (safety first).
  if (!drawdownFallback && drawdownPercent >= rules.scaleDownDrawdownPercent) {
    reasons.push(
      `Drawdown ${drawdownPercent.toFixed(1)}% ≥ scale-down threshold ${rules.scaleDownDrawdownPercent.toFixed(1)}%`,
    );
    return {
      state: "scale_down",
      reasons,
      expectancyR: expectancy.expectancyR,
      sampleSize: expectancy.sampleSize,
    };
  }
  if (expectancy.sampleSize < rules.scaleUpMinTrades) {
    reasons.push(
      `Sample size ${expectancy.sampleSize} below scale-up minimum ${rules.scaleUpMinTrades}`,
    );
    return {
      state: "hold",
      reasons,
      expectancyR: expectancy.expectancyR,
      sampleSize: expectancy.sampleSize,
    };
  }
  if (expectancy.expectancyR >= rules.scaleUpMinExpectancy) {
    reasons.push(
      `Expectancy ${expectancy.expectancyR.toFixed(2)}R ≥ minimum ${rules.scaleUpMinExpectancy.toFixed(2)}R`,
    );
    if (!drawdownFallback) {
      reasons.push(`Drawdown ${drawdownPercent.toFixed(1)}% within tolerance`);
    }
    return {
      state: "scale_up",
      reasons,
      expectancyR: expectancy.expectancyR,
      sampleSize: expectancy.sampleSize,
    };
  }
  reasons.push(
    `Expectancy ${expectancy.expectancyR.toFixed(2)}R below scale-up minimum ${rules.scaleUpMinExpectancy.toFixed(2)}R`,
  );
  return {
    state: "hold",
    reasons,
    expectancyR: expectancy.expectancyR,
    sampleSize: expectancy.sampleSize,
  };
}

// ─── account-level violations ─────────────────────────────────────────────

/**
 * Account-level checks that don't depend on a candidate trade. Used by the
 * top status bar. Trade-specific checks (max risk per trade, "would this
 * push open risk over the cap?", "would this exceed max positions?") live
 * in `evaluatePlanRisk` below.
 */
export function evaluateAccountRisk(args: {
  rules: RiskRules;
  equity: number;
  dailyPnl: number;
  weeklyPnl: number;
  drawdownPercent: number;
  drawdownFallback: boolean;
}): RiskViolation[] {
  const v: RiskViolation[] = [];
  if (args.dailyPnl <= -args.rules.maxDailyLossAmount) {
    v.push({
      rule: "daily_loss_limit",
      severity: "warn",
      message: `Daily loss limit hit: ${fmtUsd(args.dailyPnl)} ≤ -${fmtUsd(args.rules.maxDailyLossAmount)}.`,
      observed: args.dailyPnl,
      limit: -args.rules.maxDailyLossAmount,
      unit: "$",
    });
  }
  if (args.weeklyPnl <= -args.rules.maxWeeklyLossAmount) {
    v.push({
      rule: "weekly_loss_limit",
      severity: "warn",
      message: `Weekly loss limit hit: ${fmtUsd(args.weeklyPnl)} ≤ -${fmtUsd(args.rules.maxWeeklyLossAmount)}.`,
      observed: args.weeklyPnl,
      limit: -args.rules.maxWeeklyLossAmount,
      unit: "$",
    });
  }
  if (
    !args.drawdownFallback &&
    args.drawdownPercent >= args.rules.maxDrawdownPercent
  ) {
    v.push({
      rule: "max_drawdown",
      severity: "warn",
      message: `Drawdown ${args.drawdownPercent.toFixed(1)}% ≥ cap ${args.rules.maxDrawdownPercent.toFixed(1)}%.`,
      observed: args.drawdownPercent,
      limit: args.rules.maxDrawdownPercent,
      unit: "%",
    });
  }
  return v;
}

// ─── plan-level violations ────────────────────────────────────────────────

/**
 * Evaluate a candidate trade plan against the active rules. Returns the
 * union of trade-specific violations + the account-level set (so the
 * banner in the planner shows everything in one place).
 */
export function evaluatePlanRisk(args: {
  plan: PlanRiskInput;
  rules: RiskRules;
  equity: number;
  openRiskDollars: number;
  openPositionsCount: number;
  dailyPnl: number;
  weeklyPnl: number;
  drawdownPercent: number;
  drawdownFallback: boolean;
}): RiskViolation[] {
  const v: RiskViolation[] = [];
  const { plan, rules, equity, openRiskDollars, openPositionsCount } = args;

  // Per-trade risk %. Falls back safely if equity <= 0.
  const tradeRisk =
    Math.abs(plan.entryPrice - plan.stopPrice) * (plan.plannedShares || 0);
  if (!Number.isFinite(tradeRisk) || tradeRisk <= 0) {
    v.push({
      rule: "max_risk_per_trade",
      severity: "info",
      message:
        "Cannot compute per-trade risk (entry/stop/shares incomplete). Risk-per-trade check skipped.",
    });
  } else if (equity <= 0) {
    v.push({
      rule: "max_risk_per_trade",
      severity: "info",
      message:
        "Account equity is not set; per-trade % check skipped. Set equity in Settings to enable.",
    });
  } else {
    const tradeRiskPct = (tradeRisk / equity) * 100;
    if (tradeRiskPct > rules.maxRiskPerTradePercent) {
      v.push({
        rule: "max_risk_per_trade",
        severity: "warn",
        message: `Trade risk ${tradeRiskPct.toFixed(2)}% > cap ${rules.maxRiskPerTradePercent.toFixed(2)}% (${fmtUsd(tradeRisk)} on ${fmtUsd(equity)} equity).`,
        observed: tradeRiskPct,
        limit: rules.maxRiskPerTradePercent,
        unit: "%",
      });
    }
  }

  // Open risk % (after adding this trade).
  if (equity > 0 && Number.isFinite(tradeRisk) && tradeRisk > 0) {
    const projectedOpenRiskDollars = openRiskDollars + tradeRisk;
    const projectedPct = (projectedOpenRiskDollars / equity) * 100;
    if (projectedPct > rules.maxOpenRiskPercent) {
      v.push({
        rule: "max_open_risk",
        severity: "warn",
        message: `Projected open risk ${projectedPct.toFixed(2)}% > cap ${rules.maxOpenRiskPercent.toFixed(2)}% (${fmtUsd(projectedOpenRiskDollars)} of ${fmtUsd(equity)}).`,
        observed: projectedPct,
        limit: rules.maxOpenRiskPercent,
        unit: "%",
      });
    }
  }

  // Max open positions.
  if (openPositionsCount + 1 > rules.maxOpenPositions) {
    v.push({
      rule: "max_open_positions",
      severity: "warn",
      message: `Saving this plan would push open positions to ${openPositionsCount + 1}, above cap ${rules.maxOpenPositions}.`,
      observed: openPositionsCount + 1,
      limit: rules.maxOpenPositions,
      unit: "count",
    });
  }

  // Roll in account-level checks so a single banner shows everything.
  v.push(
    ...evaluateAccountRisk({
      rules,
      equity,
      dailyPnl: args.dailyPnl,
      weeklyPnl: args.weeklyPnl,
      drawdownPercent: args.drawdownPercent,
      drawdownFallback: args.drawdownFallback,
    }),
  );

  return v;
}

// ─── status assembly ──────────────────────────────────────────────────────

/**
 * High-level helper that assembles a full RiskStatus from raw inputs. The
 * planner and the status bar share this so the same numbers appear in both
 * surfaces.
 */
export function buildRiskStatus(args: {
  settings: Settings;
  activeRegime: "GREEN" | "YELLOW" | "RED";
  closedTrades: ClosedTradeMin[];
  closedTradesWithR: ClosedTradeForExpectancy[];
  openPositions: OpenPositionRisk[];
  now?: Date;
}): RiskStatus {
  const rules = resolveRiskRules(args.settings, args.activeRegime);
  const equity = args.settings.equity ?? 0;
  const dailyPnl = computeDailyPnl(args.closedTrades, args.now);
  const weeklyPnl = computeWeeklyPnl(args.closedTrades, args.now);
  const { drawdownPercent, fallback: drawdownFallback } = computeDrawdown(
    args.closedTrades,
  );
  const { openRiskDollars, openPositionsCount } = computeOpenRisk(
    args.openPositions,
  );
  const openRiskPercent = equity > 0 ? (openRiskDollars / equity) * 100 : 0;
  const expectancy = computeExpectancyR(args.closedTradesWithR);
  const scaleGuidance = computeScaleGuidance(
    rules,
    drawdownPercent,
    drawdownFallback,
    expectancy,
  );
  const violations = evaluateAccountRisk({
    rules,
    equity,
    dailyPnl,
    weeklyPnl,
    drawdownPercent,
    drawdownFallback,
  });
  return {
    dailyPnl,
    weeklyPnl,
    drawdownPercent,
    drawdownFallback,
    openRiskDollars,
    openRiskPercent,
    openPositionsCount,
    rules,
    equity,
    violations,
    scaleGuidance,
  };
}

// ─── formatters (shared with components) ──────────────────────────────────

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtR(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}R`;
}
