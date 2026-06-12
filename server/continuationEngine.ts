// ─────────────────────────────────────────────────────────────────────────────
// continuationEngine.ts
//
// Catches the rallies the single-bar pattern engine misses.
//
// Jake's real-world miss (SMH 4H, Jun 9-13 2026):
//   - SMA20 was touched on the V-bottom
//   - 4 consecutive green 4H bars rallied $595 -> $624
//   - patternEngine.ts only fires on the SINGLE bar that hammers / engulfs /
//     V-reverses — so bars 2-4 of the run had no path to trigger
//
// This module adds three NEW patterns that complement (do not replace)
// patternEngine.ts:
//
//   1. Follow-through Green Run  (Flexible)
//      Fires on bar 2 or 3 after an SMA20 touch when >=2 consecutive green
//      bars print with rising closes. You missed bar 1 — you still get in.
//
//   2. V-Bottom Continuation     (Flexible)
//      Fires when the bar AFTER a confirmed hammer / aggressive bounce
//      continues higher (green, higher close than the reversal bar). Lets
//      you catch the V-rally even if you missed the strict breakout trigger.
//
//   3. Looser SMA20 Bounce       (Aggressive)
//      Replaces sharp_selloff requirement with "any bar in last 3 dipped at
//      or below SMA20" — i.e. classic SMA20 touch + reversal. Drops the
//      elevated_volume gate.
//
// Stop placement uses Jake's "whichever gives >=1.5% risk" rule so the
// trade isn't immediately knocked out by noise.
// ─────────────────────────────────────────────────────────────────────────────

import type { OHLCBar } from "./patternEngine";

export type ContinuationPattern =
  | "Follow-through Green Run"
  | "V-Bottom Continuation"
  | "SMA20 Bounce";

export type ContinuationStatus =
  | "No Valid Trigger Yet"
  | "Green Run Forming"
  | "V-Continuation Forming"
  | "SMA20 Bounce Forming"
  | "Ready to Trade"
  | "Signal Expired";

export type ContinuationEntryMode = "Flexible" | "Aggressive";

export interface ContinuationInputs {
  bars: OHLCBar[];                    // chronological, oldest -> newest
  current_price: number;
  daily_sma20: number;
  sma_band_percent?: number;          // default 2.0
  min_risk_percent?: number;          // default 1.5 (Jake's rule)
  conservative_mode?: boolean;        // default true (controls expiry only)
  // Extended lookback per spec: search up to 5 bars back for setup origin,
  // expire after 4 bars without continuation.
  lookback_bars?: number;             // default 5
  expiry_bars?: number;               // default 4
}

export interface ContinuationEvaluation {
  status: ContinuationStatus;
  pattern: ContinuationPattern | null;
  entry_mode: ContinuationEntryMode | null;
  trigger_price: number | null;       // entry breakout level
  invalidation_price: number | null;  // stop level
  notes: string;
  // Diagnostics
  near_support: boolean;
  distance_from_sma20_percent: number;
  sma20_touched_recently: boolean;
  green_run_length: number;
  setup_origin_bars_ago: number | null;
}

function isGreen(b: OHLCBar): boolean { return b.close > b.open; }
function pct(a: number, b: number): number { return b === 0 ? 0 : (a - b) / b * 100; }

/**
 * Did any closed bar in the last N bars touch the daily SMA20?
 * "Touch" = bar's low <= sma20 * (1 + band%) AND bar's high >= sma20 * (1 - band%)
 * i.e. the bar crossed or sat inside the SMA20 zone.
 */
function findSma20TouchBar(
  bars: OHLCBar[],
  dailySma20: number,
  bandPct: number,
  lookback: number,
): number | null {
  if (bars.length === 0) return null;
  const lo = dailySma20 * (1 - bandPct / 100);
  const hi = dailySma20 * (1 + bandPct / 100);
  // exclude the current (possibly-live) bar — we want the origin, not now
  const end = bars.length - 1;
  const start = Math.max(0, end - lookback);
  // walk backward, return MOST RECENT touch index
  for (let i = end - 1; i >= start; i--) {
    const b = bars[i];
    if (b.low <= hi && b.high >= lo) return i;
  }
  return null;
}

/** Count of consecutive green bars ending at index `endIdx` (inclusive). */
function greenRunLength(bars: OHLCBar[], endIdx: number): number {
  let n = 0;
  for (let i = endIdx; i >= 0; i--) {
    if (isGreen(bars[i])) n++;
    else break;
  }
  return n;
}

/**
 * Apply Jake's "whichever gives >=1.5% risk" stop rule. Returns the stop level
 * that produces at least min_risk_pct% risk from entry; if both fail, returns
 * the looser (lower) stop.
 */
function pickStop(entry: number, tightStop: number, looseStop: number, minRiskPct: number): number {
  if (entry <= 0) return looseStop;
  const tightRiskPct = (entry - tightStop) / entry * 100;
  const looseRiskPct = (entry - looseStop) / entry * 100;
  // Prefer the tightest stop that still meets the min-risk floor
  if (tightRiskPct >= minRiskPct) return tightStop;
  if (looseRiskPct >= minRiskPct) return looseStop;
  // Neither meets the floor — pick whichever gives more cushion
  return Math.min(tightStop, looseStop);
}

export function evaluateContinuation(inputs: ContinuationInputs): ContinuationEvaluation {
  const {
    bars,
    current_price,
    daily_sma20,
    sma_band_percent = 2.0,
    min_risk_percent = 1.5,
    conservative_mode = true,
    lookback_bars = 5,
    expiry_bars = 4,
  } = inputs;

  const empty: ContinuationEvaluation = {
    status: "No Valid Trigger Yet",
    pattern: null,
    entry_mode: null,
    trigger_price: null,
    invalidation_price: null,
    notes: "",
    near_support: false,
    distance_from_sma20_percent: 0,
    sma20_touched_recently: false,
    green_run_length: 0,
    setup_origin_bars_ago: null,
  };

  if (bars.length < 6 || !Number.isFinite(daily_sma20) || daily_sma20 <= 0) {
    return { ...empty, notes: "Insufficient bars or SMA20 unavailable." };
  }

  const distPct = Math.abs(current_price - daily_sma20) / daily_sma20 * 100;
  empty.distance_from_sma20_percent = Number(distPct.toFixed(3));
  empty.near_support = distPct <= sma_band_percent;

  const curIdx = bars.length - 1;
  const cur = bars[curIdx];
  const isClosed = cur.is_closed !== false;

  // ── Step 1: Find SMA20 touch within lookback window ──────────────────────
  const touchIdx = findSma20TouchBar(bars, daily_sma20, sma_band_percent, lookback_bars);
  empty.sma20_touched_recently = touchIdx !== null;
  if (touchIdx === null) {
    return { ...empty, notes: `No SMA20 touch in last ${lookback_bars} bars.` };
  }

  const touchBar = bars[touchIdx];
  const barsSinceTouch = curIdx - touchIdx;
  empty.setup_origin_bars_ago = barsSinceTouch;

  // ── Step 2: Count consecutive green bars from touch forward ─────────────
  // The run starts at the first green bar AT OR AFTER the touch
  let runStartIdx = -1;
  for (let i = touchIdx; i <= curIdx; i++) {
    if (isGreen(bars[i])) { runStartIdx = i; break; }
  }
  if (runStartIdx < 0) {
    return { ...empty, notes: `SMA20 touched ${barsSinceTouch} bars ago, no green bar yet.` };
  }
  // Count contiguous green bars from runStartIdx forward (allow current bar
  // even if not closed — we surface "Forming" for that case).
  let runLen = 0;
  for (let i = runStartIdx; i <= curIdx; i++) {
    if (isGreen(bars[i])) runLen++;
    else break;
  }
  empty.green_run_length = runLen;

  // Has the run continued making higher closes? (rising-closes check)
  let risingCloses = true;
  for (let i = runStartIdx + 1; i <= runStartIdx + runLen - 1; i++) {
    if (bars[i].close <= bars[i - 1].close) { risingCloses = false; break; }
  }

  // ── Step 3: Expiry check ─────────────────────────────────────────────────
  if (conservative_mode && barsSinceTouch > expiry_bars) {
    return {
      ...empty,
      status: "Signal Expired",
      notes: `SMA20 touch ${barsSinceTouch} bars ago — beyond ${expiry_bars}-bar window.`,
    };
  }

  // ── Step 4: Pattern selection ────────────────────────────────────────────
  // Trigger = current bar's high; stop options:
  //   - tight: most recent bar low (current or prior)
  //   - loose: SMA20-touch bar low (the real invalidation per Jake's spec)
  const trigger = cur.high;
  const tightStop = Math.min(cur.low, bars[curIdx - 1].low);
  const looseStop = touchBar.low;
  const stop = pickStop(trigger, tightStop, looseStop, min_risk_percent);
  const riskPct = trigger > 0 ? (trigger - stop) / trigger * 100 : 0;

  // 4A: V-Bottom Continuation
  // If the touch bar was red/down and the NEXT bar (touchIdx+1) is a strong
  // green reversal, and we're now on bar 2 or 3 of green follow-through with
  // rising closes — this is the V continuation.
  const reversalIdx = touchIdx + 1 <= curIdx ? touchIdx + 1 : -1;
  const hasReversalBar = reversalIdx > 0 && isGreen(bars[reversalIdx]) &&
    (bars[reversalIdx].close - bars[reversalIdx].open) / Math.max(1e-9, bars[reversalIdx].high - bars[reversalIdx].low) >= 0.5;
  const isVContinuation =
    hasReversalBar &&
    runLen >= 2 &&
    risingCloses &&
    barsSinceTouch >= 1 &&
    barsSinceTouch <= expiry_bars;

  // 4B: Follow-through Green Run
  // >=2 consecutive green bars from SMA20 touch with rising closes,
  // current bar is part of the run.
  const isFollowThrough =
    runLen >= 2 &&
    risingCloses &&
    isGreen(cur) &&
    barsSinceTouch >= 1 &&
    barsSinceTouch <= expiry_bars;

  // 4C: SMA20 Bounce (looser aggressive bounce)
  // Touch bar exists, current bar is a green reversal at/near SMA20,
  // no elevated_volume gate, no sharp_selloff requirement.
  const isSma20Bounce =
    barsSinceTouch <= 2 &&
    isGreen(cur) &&
    cur.close > cur.open &&
    (cur.close - cur.low) / Math.max(1e-9, cur.high - cur.low) >= 0.6;

  // ── Step 5: Classify (most specific wins) ───────────────────────────────
  // V-Bottom Continuation is strongest signal — clean reversal bar + follow-through
  if (isVContinuation) {
    return {
      ...empty,
      status: isClosed ? "Ready to Trade" : "V-Continuation Forming",
      pattern: "V-Bottom Continuation",
      entry_mode: "Flexible",
      trigger_price: Math.round(trigger * 100) / 100,
      invalidation_price: Math.round(stop * 100) / 100,
      notes: `V-bottom + ${runLen} green bars rising from SMA20 touch ${barsSinceTouch}b ago. Risk ${riskPct.toFixed(2)}%.`,
    };
  }

  // Follow-through Green Run — multi-bar run without strict V reversal bar
  if (isFollowThrough) {
    return {
      ...empty,
      status: isClosed ? "Ready to Trade" : "Green Run Forming",
      pattern: "Follow-through Green Run",
      entry_mode: "Flexible",
      trigger_price: Math.round(trigger * 100) / 100,
      invalidation_price: Math.round(stop * 100) / 100,
      notes: `${runLen} green bars rising from SMA20 touch ${barsSinceTouch}b ago. Risk ${riskPct.toFixed(2)}%.`,
    };
  }

  // SMA20 Bounce — single strong green bar at/near SMA20
  if (isSma20Bounce) {
    return {
      ...empty,
      status: isClosed ? "Ready to Trade" : "SMA20 Bounce Forming",
      pattern: "SMA20 Bounce",
      entry_mode: "Aggressive",
      trigger_price: Math.round(trigger * 100) / 100,
      invalidation_price: Math.round(stop * 100) / 100,
      notes: `Strong green bar at SMA20 touch (no volume gate). Risk ${riskPct.toFixed(2)}%.`,
    };
  }

  return {
    ...empty,
    notes: `SMA20 touch ${barsSinceTouch}b ago, run=${runLen}, rising=${risingCloses}. Waiting for setup.`,
  };
}

export const __continuationInternals = {
  findSma20TouchBar,
  greenRunLength,
  pickStop,
};
