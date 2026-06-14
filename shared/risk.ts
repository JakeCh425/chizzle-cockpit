// Phase 5 — Risk Governor shared types.
//
// All risk rules live on the existing `settings` table (see shared/schema.ts).
// These types are derived views over Settings + computed/aggregated state for
// the UI and the rule-check layer. No new persistence tables.

import type { Settings } from "./schema";

/** A snapshot of the active risk rules pulled from settings + active regime. */
export interface RiskRules {
  // Loss/drawdown caps (absolute $ for daily/weekly; % for drawdown).
  maxDailyLossAmount: number;
  maxWeeklyLossAmount: number;
  maxDrawdownPercent: number;
  // Per-trade and aggregate sizing caps (regime-aware fields resolve to a
  // single active number at evaluation time).
  maxRiskPerTradePercent: number;
  maxOpenRiskPercent: number;
  maxOpenPositions: number;
  // Scaling guidance thresholds.
  scaleUpMinTrades: number;
  scaleUpMinExpectancy: number;
  scaleDownDrawdownPercent: number;
}

export type RiskRuleId =
  | "max_risk_per_trade"
  | "max_open_risk"
  | "max_open_positions"
  | "daily_loss_limit"
  | "weekly_loss_limit"
  | "max_drawdown";

export type Severity = "info" | "warn" | "block";

export interface RiskViolation {
  rule: RiskRuleId;
  severity: Severity;
  message: string;
  /** Optional structured context (e.g. observed vs. limit) for the UI. */
  observed?: number;
  limit?: number;
  unit?: "$" | "%" | "count";
}

/** Result of computing current account-level risk status. */
export interface RiskStatus {
  /** Realized P&L for the current local day, summed over closed trades. */
  dailyPnl: number;
  /** Realized P&L for the current local ISO week (Mon-Sun), closed trades. */
  weeklyPnl: number;
  /** Current drawdown from the all-time peak of cumulative realized P&L. */
  drawdownPercent: number;
  /** True if no positive peak exists (drawdown reported as 0%). */
  drawdownFallback: boolean;
  /** Open-risk dollar exposure across currently-open positions. */
  openRiskDollars: number;
  /** openRiskDollars / equity * 100, or 0 when equity <= 0. */
  openRiskPercent: number;
  /** Number of currently-open positions. */
  openPositionsCount: number;
  /** Active rule snapshot used to compute violations. */
  rules: RiskRules;
  /** Account equity at evaluation time. */
  equity: number;
  /** Account-level violations (excludes trade-specific checks). */
  violations: RiskViolation[];
  /** Scaling guidance derived from rules + recent closed-trade stats. */
  scaleGuidance: ScaleGuidance;
}

export type ScaleGuidanceState = "scale_up" | "hold" | "scale_down";

export interface ScaleGuidance {
  state: ScaleGuidanceState;
  reasons: string[];
  /** Recent expectancy in R-multiples (or 0 when not computable). */
  expectancyR: number;
  /** Number of closed trades used to compute expectancy. */
  sampleSize: number;
}

/** A single open position contributing to current open risk. */
export interface OpenPositionRisk {
  id: string;
  ticker: string;
  direction: "long" | "short";
  /** Share-weighted average fill price across entries/partial exits. */
  avgFillPrice: number;
  stopPrice: number;
  /** Current open shares = entries - exits. */
  openShares: number;
  /** |avgFillPrice - stopPrice| × openShares. */
  riskDollars: number;
  source: "new"; // legacy "trades" table has its own lifecycle; not included.
}

/** A trade plan candidate (or in-flight edit) under evaluation. */
export interface PlanRiskInput {
  ticker: string;
  direction: "long" | "short";
  entryPrice: number;
  stopPrice: number;
  plannedShares: number;
}

export type { Settings };
