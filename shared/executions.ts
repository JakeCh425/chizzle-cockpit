// Phase 2 — Execution math + status derivation.
// Lives in `shared/` so both the Express server and the React client import the
// exact same logic. Pure functions, no I/O, no React, no DB.

import type { TradeExecution, ExecutionType, TradePlanStatus } from "./schema";

export interface ExecutionStats {
  totalEnteredShares: number;
  totalExitedShares: number;
  remainingShares: number;
  avgEntryPrice: number | null;  // null until first entry logged
  avgExitPrice: number | null;   // null until first exit logged
  totalFees: number;
  grossRealizedPnl: number;      // (avgExit − avgEntry) × totalExited × directionSign
  netRealizedPnl: number;        // gross − totalFees
  firstEntryAt: Date | null;
  lastExitAt: Date | null;
  holdingDurationMs: number | null; // only when derivedStatus === "closed"
  derivedStatus: TradePlanStatus;   // never returns "cancelled" — that is manual-only
}

const ENTRY_TYPES: readonly ExecutionType[] = ["entry", "add"];
const EXIT_TYPES:  readonly ExecutionType[] = ["partial_exit", "exit"];

export function isEntryType(t: ExecutionType): boolean { return ENTRY_TYPES.includes(t); }
export function isExitType(t: ExecutionType):  boolean { return EXIT_TYPES.includes(t); }

export function calcExecutionStats(
  execs: TradeExecution[],
  direction: "long" | "short" = "long",
): ExecutionStats {
  const sorted = [...execs].sort(
    (a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime(),
  );

  let enteredShares = 0;
  let exitedShares = 0;
  let entryNotional = 0; // Σ shares × price (entries)
  let exitNotional  = 0; // Σ shares × price (exits)
  let totalFees = 0;
  let firstEntryAt: Date | null = null;
  let lastExitAt:   Date | null = null;

  for (const e of sorted) {
    totalFees += Number(e.fees) || 0;
    const shares = Number(e.shares);
    const price  = Number(e.price);
    const at     = new Date(e.executedAt);
    const type   = e.executionType as ExecutionType;

    if (isEntryType(type)) {
      enteredShares += shares;
      entryNotional += shares * price;
      if (firstEntryAt === null) firstEntryAt = at;
    } else if (isExitType(type)) {
      exitedShares += shares;
      exitNotional += shares * price;
      lastExitAt = at; // sorted ASC → this ends as the latest exit time
    }
  }

  const remainingShares = enteredShares - exitedShares;
  const avgEntryPrice = enteredShares > 0 ? entryNotional / enteredShares : null;
  const avgExitPrice  = exitedShares  > 0 ? exitNotional  / exitedShares  : null;

  // long: profit when exit > entry; short: profit when exit < entry.
  const directionSign = direction === "short" ? -1 : 1;
  const grossRealizedPnl =
    avgEntryPrice != null && avgExitPrice != null
      ? (avgExitPrice - avgEntryPrice) * exitedShares * directionSign
      : 0;
  const netRealizedPnl = grossRealizedPnl - totalFees;

  let derivedStatus: TradePlanStatus = "planned";
  if (enteredShares === 0) {
    derivedStatus = "planned";
  } else if (remainingShares <= 0 && exitedShares > 0) {
    derivedStatus = "closed";
  } else if (exitedShares > 0) {
    derivedStatus = "partial";
  } else {
    derivedStatus = "open";
  }

  const holdingDurationMs =
    derivedStatus === "closed" && firstEntryAt && lastExitAt
      ? lastExitAt.getTime() - firstEntryAt.getTime()
      : null;

  return {
    totalEnteredShares: enteredShares,
    totalExitedShares: exitedShares,
    remainingShares,
    avgEntryPrice,
    avgExitPrice,
    totalFees,
    grossRealizedPnl,
    netRealizedPnl,
    firstEntryAt,
    lastExitAt,
    holdingDurationMs,
    derivedStatus,
  };
}

/**
 * Validate a candidate execution against current state.
 * Returns null on OK, otherwise a single error string suitable for inline display.
 * Caller is responsible for surfacing the message.
 */
export function validateExecution(
  next: { executionType: ExecutionType; shares: number; price: number; fees?: number | null },
  current: ExecutionStats,
): string | null {
  if (!Number.isFinite(next.shares) || next.shares <= 0) return "Shares must be greater than 0.";
  if (!Number.isInteger(next.shares))                    return "Shares must be a whole number.";
  if (!Number.isFinite(next.price)  || next.price  <= 0) return "Price must be greater than 0.";
  if (next.fees != null && (!Number.isFinite(next.fees) || next.fees < 0)) {
    return "Fees cannot be negative.";
  }

  if (isExitType(next.executionType)) {
    if (current.totalEnteredShares === 0) {
      return "Cannot exit before any entry has been logged.";
    }
    if (next.shares > current.remainingShares) {
      return `Cannot exit ${next.shares} shares — only ${current.remainingShares} remaining.`;
    }
  }
  return null;
}

export function formatHoldingDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  if (mins < 1)  return `${totalSec}s`;
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
