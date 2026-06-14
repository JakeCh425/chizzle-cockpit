// Phase 1 — Pure position-size calculator. Reusable across Trade Planner and
// any future planner surfaces. No side effects, no React.
//
// Formula (locked by spec):
//   Position Size = (Account Size × Risk %) ÷ (Entry Price − Stop Loss)
//
// Rules:
//   - Long: stop < entry; per-share risk = entry − stop
//   - Short: stop > entry; per-share risk = stop − entry
//   - Round shares DOWN to whole number
//   - Never return negative/zero/NaN — failures come back as a typed Err
//   - Clear failure reasons for inline validation

export type PositionSizeInput = {
  accountSize: number; // dollars
  riskPercent: number; // e.g. 3 means 3%
  entryPrice: number;
  stopPrice: number;
  direction?: "long" | "short";
};

export type PositionSizeOk = {
  ok: true;
  shares: number; // integer, floored
  riskDollars: number; // dollars at risk
  perShareRisk: number; // |entry − stop|
  notional: number; // shares * entry
};

export type PositionSizeErr = {
  ok: false;
  reason:
    | "INVALID_ACCOUNT"
    | "INVALID_RISK_PCT"
    | "INVALID_ENTRY"
    | "INVALID_STOP"
    | "STOP_EQUALS_ENTRY"
    | "STOP_WRONG_SIDE"
    | "NO_SHARES_AFFORDABLE";
  message: string;
};

export type PositionSizeResult = PositionSizeOk | PositionSizeErr;

const isFiniteNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

export function calcPositionSize(input: PositionSizeInput): PositionSizeResult {
  const { accountSize, riskPercent, entryPrice, stopPrice } = input;
  const direction = input.direction ?? "long";

  if (!isFiniteNumber(accountSize) || accountSize <= 0) {
    return { ok: false, reason: "INVALID_ACCOUNT", message: "Account size must be greater than 0." };
  }
  if (!isFiniteNumber(riskPercent) || riskPercent <= 0 || riskPercent > 100) {
    return { ok: false, reason: "INVALID_RISK_PCT", message: "Risk % must be between 0 and 100." };
  }
  if (!isFiniteNumber(entryPrice) || entryPrice <= 0) {
    return { ok: false, reason: "INVALID_ENTRY", message: "Entry price must be greater than 0." };
  }
  if (!isFiniteNumber(stopPrice) || stopPrice <= 0) {
    return { ok: false, reason: "INVALID_STOP", message: "Stop price must be greater than 0." };
  }
  if (entryPrice === stopPrice) {
    return { ok: false, reason: "STOP_EQUALS_ENTRY", message: "Stop cannot equal entry." };
  }
  if (direction === "long" && stopPrice >= entryPrice) {
    return { ok: false, reason: "STOP_WRONG_SIDE", message: "For a long, stop must be below entry." };
  }
  if (direction === "short" && stopPrice <= entryPrice) {
    return { ok: false, reason: "STOP_WRONG_SIDE", message: "For a short, stop must be above entry." };
  }

  const perShareRisk = Math.abs(entryPrice - stopPrice);
  const riskDollars = (accountSize * riskPercent) / 100;
  const rawShares = riskDollars / perShareRisk;
  const shares = Math.max(0, Math.floor(rawShares));

  if (shares <= 0) {
    return {
      ok: false,
      reason: "NO_SHARES_AFFORDABLE",
      message: "Per-share risk is too large for this account/risk. Tighten the stop or raise risk %.",
    };
  }

  return {
    ok: true,
    shares,
    riskDollars,
    perShareRisk,
    notional: shares * entryPrice,
  };
}

// Risk:Reward helper (display only). Returns null if any input invalid.
export function calcRR(entry: number, stop: number, target: number | null | undefined): number | null {
  if (!isFiniteNumber(entry) || !isFiniteNumber(stop) || !isFiniteNumber(target as any) || target == null) return null;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return null;
  return reward / risk;
}
