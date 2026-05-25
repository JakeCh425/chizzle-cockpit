// ─── Trade Lifecycle Engine ────────────────────────────────────────────
// Pure functions for evaluating live price against an open trade and deciding:
//   - T1 partial fill (sell half at T1)
//   - T2 final fill (sell remainder at T2)
//   - Trailing stop level updates (after T1)
//   - Stop-out / invalidation
//
// All functions are PURE — they read inputs and return a "decision" object.
// The route handler does the storage writes + alert emission.

import type { Trade } from "../shared/schema";

export type LifecycleAction =
  | "NONE"
  | "T1_FILL"
  | "T2_FILL"
  | "TRAIL_UPDATE"
  | "STOP_HIT"
  | "INVALIDATED";

export interface LifecycleDecision {
  action: LifecycleAction;
  newTrailingStop?: number;
  newHighWaterMark?: number;
  exitPrice?: number;
  exitReason?: string;
  rMultiple?: number;
  note: string;
}

/**
 * Evaluate a live price against an open trade.
 * Returns the first material decision (or NONE).
 *
 * Order of checks (matters):
 *   1. Stop hit (lowest priority of "fills" but checked first — bad news first)
 *   2. T2 hit (final exit)
 *   3. T1 hit (partial)
 *   4. Trailing stop update (only post-T1)
 *   5. NONE
 */
export function evaluateLifecycle(trade: Trade, livePrice: number): LifecycleDecision {
  if (trade.status !== "OPEN") {
    return { action: "NONE", note: "Trade not open." };
  }

  const perShareRisk = trade.entry - trade.stop;
  if (perShareRisk <= 0) {
    return { action: "NONE", note: "Bad risk basis." };
  }

  // 1. Stop hit — check against trailing stop if set, else original stop
  const activeStop = trade.trailingStop != null ? trade.trailingStop : trade.stop;
  if (livePrice <= activeStop) {
    const rMult = (activeStop - trade.entry) / perShareRisk;
    return {
      action: "STOP_HIT",
      exitPrice: activeStop,
      exitReason: trade.t1Filled ? "Trailing stop hit" : "Initial stop hit",
      rMultiple: +rMult.toFixed(2),
      note: `Stopped out at ${activeStop.toFixed(2)} (${rMult.toFixed(2)}R)`,
    };
  }

  // 2. T2 final exit
  if (trade.t2 != null && !trade.t2Filled && livePrice >= trade.t2) {
    const rMult = (trade.t2 - trade.entry) / perShareRisk;
    return {
      action: "T2_FILL",
      exitPrice: trade.t2,
      exitReason: "T2 target hit",
      rMultiple: +rMult.toFixed(2),
      note: `T2 hit at ${trade.t2.toFixed(2)} (+${rMult.toFixed(2)}R)`,
    };
  }

  // 3. T1 partial fill (only if not already filled)
  if (!trade.t1Filled && livePrice >= trade.t1) {
    const rMult = (trade.t1 - trade.entry) / perShareRisk;
    return {
      action: "T1_FILL",
      // After T1: move stop to breakeven (entry) and start trailing
      newTrailingStop: trade.entry,
      rMultiple: +rMult.toFixed(2),
      note: `T1 hit at ${trade.t1.toFixed(2)} (+${rMult.toFixed(2)}R), stop → breakeven`,
    };
  }

  // 4. Trailing stop update — only post-T1, only if price made a new high
  if (trade.t1Filled) {
    const currentHigh = trade.highWaterMark ?? trade.entry;
    if (livePrice > currentHigh) {
      // Trail by 1.5R below the high water mark (conservative)
      const proposedTrail = +(livePrice - perShareRisk * 1.5).toFixed(2);
      const currentTrail = trade.trailingStop ?? trade.entry;
      // Only move stop UP, never down
      if (proposedTrail > currentTrail) {
        return {
          action: "TRAIL_UPDATE",
          newTrailingStop: proposedTrail,
          newHighWaterMark: livePrice,
          note: `Trail moved to ${proposedTrail.toFixed(2)} (HWM ${livePrice.toFixed(2)})`,
        };
      }
      // High moved but trail didn't — still update HWM
      return {
        action: "TRAIL_UPDATE",
        newHighWaterMark: livePrice,
        note: `HWM updated to ${livePrice.toFixed(2)} (trail unchanged)`,
      };
    }
  }

  return { action: "NONE", note: "No material change." };
}

/**
 * Earnings block check — independent of regime. Blocks new entries when
 * earnings are within `bufferDays` business days.
 *
 * Per spec: even GREEN + A-grade is blocked if earnings within buffer.
 */
export function earningsBlocksEntry(earningsDate: string | null | undefined, bufferDays = 5): boolean {
  if (!earningsDate) return false;
  const earnings = new Date(earningsDate);
  if (isNaN(earnings.getTime())) return false;
  const now = new Date();
  const diffMs = earnings.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  // Block if earnings is in the future AND within bufferDays calendar days.
  // (Approximate — calendar days, not business days. Conservative.)
  return diffDays >= 0 && diffDays <= bufferDays + 2;
}

/**
 * Compute final R-multiple for a closed trade.
 * Handles partial T1 fills: if T1 was filled and then trailing stop was hit,
 * the effective R is the average of (half at T1) + (half at exit).
 */
export function computeFinalRMultiple(trade: Trade, exitPrice: number): number {
  const perShareRisk = trade.entry - trade.stop;
  if (perShareRisk <= 0) return 0;
  if (trade.t1Filled) {
    // Half exited at T1, half at exitPrice
    const r1 = (trade.t1 - trade.entry) / perShareRisk;
    const r2 = (exitPrice - trade.entry) / perShareRisk;
    return +((r1 + r2) / 2).toFixed(2);
  }
  return +((exitPrice - trade.entry) / perShareRisk).toFixed(2);
}
