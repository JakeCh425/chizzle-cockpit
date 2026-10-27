// Funding, whole-share position sizing and calculated R targets for a LONG practice plan.
// Pure functions — no I/O. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. Nothing here places or arms an order,
// and nothing here changes setup status, entry eligibility, the stop, or the setup score.
//
//   E = planned entry   S = chart/setup stop   A = account equity   p = max risk % (decimal)
//   C = available trading cash after reservations   D = requested allocation
//   risk/share = E − S          risk budget = A × p          permitted allocation = min(D, C)
//   cash-limited shares = floor((permitted − fees) / (E × (1 + buffer)))
//   risk-limited shares = floor(risk budget / (E − S))
//   final shares = min(cash-limited, risk-limited)          — never rounded up past either limit.

/** Account-level funding inputs, saved once and shared by every card (one snapshot). All values are manual. */
export interface FundingProfile {
  /** RISK_PROFILE = Settings → Risk Profile equity; MANUAL = a sizing-only equity typed here. */
  equityMode: "RISK_PROFILE" | "MANUAL";
  manualEquity: number | null; equityUpdatedAt: string | null;
  /** Available trading cash (cash only — this app has no margin mode). */
  cash: number | null; cashUpdatedAt: string | null;
  /** Max risk % per trade; null = use the Risk Profile's current-regime %. Never above that limit. */
  riskPct: number | null;
  /** Optional cash already committed: open positions and pending orders not yet reflected in `cash`. */
  reservedOpen: number; reservedPending: number;
  /** True when the cash figure already reflects the reservations (don't subtract twice). */
  cashIncludesReservations: boolean;
  /** Estimates: flat fee per trade ($) and execution buffer (% added to entry for the affordability check). */
  feePerTrade: number; bufferPct: number;
}
export const DEFAULT_FUNDING: FundingProfile = {
  equityMode: "RISK_PROFILE", manualEquity: null, equityUpdatedAt: null, cash: null, cashUpdatedAt: null, riskPct: null,
  reservedOpen: 0, reservedPending: 0, cashIncludesReservations: false, feePerTrade: 0, bufferPct: 0,
};
/** Manual cash older than this is flagged STALE (still usable, clearly warned). */
export const FUNDING_STALE_MS = 24 * 3600_000;

export interface SizingInput {
  equity: number | null; riskPct: number | null; riskPctLimit: number | null;
  cash: number | null; reservedOpen?: number; reservedPending?: number; cashIncludesReservations?: boolean;
  allocation: number | null; entry: number | null; stop: number | null;
  feePerTrade?: number; bufferPct?: number;
}
export type Binding = "RISK" | "AVAILABLE_CASH" | "REQUESTED_ALLOCATION" | "CASH_AND_RISK" | null;
export interface SizingIssue { field: "equity" | "riskPct" | "cash" | "allocation" | "entry" | "stop" | "reserved" | "fees"; text: string }
export interface SizingResult {
  ok: boolean; issues: SizingIssue[];
  riskPerShare: number | null; riskBudget: number | null; cashAfterReservations: number | null; permitted: number | null;
  costPerShare: number | null; estFees: number;
  cashShares: number | null; riskShares: number | null; shares: number;
  positionCost: number | null; unusedAllocation: number | null; cashRemaining: number | null;
  plannedLoss: number | null; riskPctOfEquity: number | null; positionPctOfEquity: number | null;
  binding: Binding; bindingText: string | null; zeroReason: string | null;
}

/** Cents rounding, half away from zero (consistent financial rounding; the app's price precision is cents). */
export const r2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100;
/** floor() that ignores binary-float dust (e.g. 2.22 / 1.11 = 1.9999999999999998 → 2). */
export const safeFloor = (x: number) => Math.floor(x + 1e-9);
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const $ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Parse a typed money/number field. "" → null; anything non-numeric → NaN (so validation can explain it). */
export function parseNum(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === "number") return s;
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

export function sizePosition(i: SizingInput): SizingResult {
  const issues: SizingIssue[] = [];
  const need = (v: number | null | undefined, field: SizingIssue["field"], name: string, allowZero = false) => {
    if (v == null) { issues.push({ field, text: `${name} is missing.` }); return false; }
    if (!fin(v)) { issues.push({ field, text: `${name} must be a number.` }); return false; }
    if (v < 0 || (!allowZero && v === 0)) { issues.push({ field, text: `${name} must be ${allowZero ? "zero or more" : "greater than zero"}.` }); return false; }
    return true;
  };
  const okE = need(i.equity, "equity", "Account equity");
  const okP = need(i.riskPct, "riskPct", "Max risk %");
  if (okP && i.riskPct! > 100) issues.push({ field: "riskPct", text: "Max risk % can't exceed 100%." });
  if (okP && fin(i.riskPctLimit) && i.riskPct! > i.riskPctLimit + 1e-9)
    issues.push({ field: "riskPct", text: `Max risk ${i.riskPct}% is above your Risk Profile limit of ${i.riskPctLimit}% for the current regime.` });
  const okC = need(i.cash, "cash", "Available trading cash", true);
  const okD = need(i.allocation, "allocation", "Requested allocation", true);
  const resO = i.reservedOpen ?? 0, resP = i.reservedPending ?? 0, fee = i.feePerTrade ?? 0, buf = i.bufferPct ?? 0;
  if (!fin(resO) || !fin(resP) || resO < 0 || resP < 0) issues.push({ field: "reserved", text: "Reservations must be zero or more." });
  if (!fin(fee) || !fin(buf) || fee < 0 || buf < 0 || buf > 25) issues.push({ field: "fees", text: "Fees must be zero or more and the execution buffer between 0% and 25%." });
  const okEn = need(i.entry, "entry", "Entry");
  const okS = need(i.stop, "stop", "Stop");
  if (okEn && okS && i.stop! >= i.entry!) issues.push({ field: "stop", text: `Stop ${$(i.stop!)} must be below entry ${$(i.entry!)} for a long trade (E > S > 0).` });

  const blank: SizingResult = { ok: false, issues, riskPerShare: null, riskBudget: null, cashAfterReservations: null, permitted: null, costPerShare: null, estFees: 0,
    cashShares: null, riskShares: null, shares: 0, positionCost: null, unusedAllocation: null, cashRemaining: null, plannedLoss: null,
    riskPctOfEquity: null, positionPctOfEquity: null, binding: null, bindingText: null, zeroReason: null };
  if (okEn && okS && i.stop! < i.entry!) blank.riskPerShare = r2(i.entry! - i.stop!);
  if (issues.length) return blank;

  const E = i.entry!, S = i.stop!, A = i.equity!, p = i.riskPct! / 100, D = i.allocation!;
  const R = r2(E - S);
  const budget = r2(A * p);
  const C = r2(Math.max(0, i.cash! - (i.cashIncludesReservations ? 0 : resO + resP)));
  const permitted = Math.min(D, C);
  const costPerShare = E * (1 + buf / 100);
  const cashShares = Math.max(0, safeFloor((permitted - fee) / costPerShare));
  const riskShares = Math.max(0, safeFloor(budget / R));
  const shares = Math.min(cashShares, riskShares);
  const estFees = shares > 0 ? fee : 0;
  const cost = r2(shares * E);
  const loss = r2(shares * R);
  const allocLimited = D <= C;
  let binding: Binding, bindingText: string;
  if (cashShares === riskShares) { binding = "CASH_AND_RISK"; bindingText = `${allocLimited ? "Requested allocation" : "Available cash"} and the risk limit both allow ${shares} shares.`; }
  else if (riskShares < cashShares) { binding = "RISK"; bindingText = `Risk limit: ${$(budget)} budget ÷ ${$(R)} risk/share = ${riskShares} shares (cash would allow ${cashShares}).`; }
  else if (allocLimited) { binding = "REQUESTED_ALLOCATION"; bindingText = `Requested allocation: ${$(D)} buys ${cashShares} shares at ${$(E)}${buf || fee ? " incl. estimated fees/buffer" : ""} (risk would allow ${riskShares}).`; }
  else { binding = "AVAILABLE_CASH"; bindingText = `Available cash: ${$(C)} buys ${cashShares} shares at ${$(E)}${buf || fee ? " incl. estimated fees/buffer" : ""} (risk would allow ${riskShares}).`; }

  let zeroReason: string | null = null;
  if (shares === 0) {
    const parts: string[] = [];
    if (cashShares === 0) parts.push(`${allocLimited ? "requested allocation" : "available cash"} ${$(permitted)} is below one share's cost ${$(r2(costPerShare + fee))}${buf || fee ? " (incl. estimated fees/buffer)" : ""}`);
    if (riskShares === 0) parts.push(`risk budget ${$(budget)} is below one share's stop risk ${$(R)}`);
    zeroReason = `0 shares: ${parts.join(" and ")}. The stop is not moved to make a share fit.`;
  }
  return {
    ok: true, issues, riskPerShare: R, riskBudget: budget, cashAfterReservations: C, permitted: r2(permitted), costPerShare: r2(costPerShare), estFees,
    cashShares, riskShares, shares, positionCost: cost,
    unusedAllocation: r2(Math.max(0, D - cost - estFees)), cashRemaining: r2(C - cost - estFees),
    plannedLoss: loss, riskPctOfEquity: (loss / A) * 100, positionPctOfEquity: (cost / A) * 100,
    binding, bindingText, zeroReason,
  };
}

export interface RTarget { r: number; price: number; pctMove: number; grossProfit: number }
/** Calculated R targets for a long plan: E + k·R. Not predictions or chart resistance. */
export function rTargets(entry: number, stop: number, shares: number, extended: boolean): RTarget[] {
  if (!(fin(entry) && fin(stop) && entry > stop && stop > 0)) return [];
  const R = r2(entry - stop);
  return (extended ? [1.5, 2, 3, 4, 5, 6] : [1.5, 2, 3]).map((k) => {
    const price = r2(entry + k * R);
    return { r: k, price, pctMove: ((price - entry) / entry) * 100, grossProfit: r2(shares * (price - entry)) };
  });
}

/** Funding values' status for display: everything in this app is manual (no broker connection exists). */
export function fundingStatus(updatedAt: string | null, now = Date.now()): { state: "MANUAL" | "STALE" | "UNAVAILABLE"; ageText: string | null } {
  if (!updatedAt) return { state: "UNAVAILABLE", ageText: null };
  const age = now - new Date(updatedAt).getTime();
  const h = Math.floor(age / 3600_000), dd = Math.floor(h / 24);
  const ageText = dd >= 1 ? `${dd} day${dd > 1 ? "s" : ""} ago` : h >= 1 ? `${h} h ago` : "under 1 h ago";
  return { state: age > FUNDING_STALE_MS ? "STALE" : "MANUAL", ageText };
}
