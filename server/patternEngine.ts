// ─────────────────────────────────────────────────────────────────────────────
// patternEngine.ts
//
// Multi-pattern reversal engine — implements Jake's full pattern spec:
//   1. Strict Hammer (Core)
//   2. Strict Bullish Engulfing (Core)
//   3. Strong Bull Bar after cluster of lows (Flexible)
//   4. Aggressive bounce / V-reversal after sharp selloff (Aggressive)
//
// All four share:
//   - location filter: price within sma_band_percent of daily SMA20 (default 2%)
//   - forming / confirmed / ready-to-trade lifecycle
//   - conservative vs aggressive entry modes
//
// IMPORTANT: this is additive. The existing smhHammerMonitor and bullBarMonitor
// modules are not modified — this engine powers the new /api/multi-pattern-monitor
// endpoint and runs alongside them.
// ─────────────────────────────────────────────────────────────────────────────

export interface OHLCBar {
  time: number;       // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_closed?: boolean;
}

export type PatternType =
  | "Hammer"
  | "Bullish Engulfing"
  | "Strong Bull Bar"
  | "Aggressive Bounce";

export type EntryMode = "Core" | "Flexible" | "Aggressive";

export type PatternStatus =
  | "No Valid Trigger Yet"
  | "Hammer Forming"
  | "Engulfing Forming"
  | "Bull Bar Forming"
  | "Aggressive Bounce Forming"
  | "Confirmed Hammer"
  | "Confirmed Bullish Engulfing"
  | "Confirmed Bull Bar"
  | "Confirmed Aggressive Bounce"
  | "Ready to Trade"
  | "Signal Expired";

export interface PatternEvaluation {
  pattern_status: PatternStatus;
  pattern: PatternType | null;
  entry_mode: EntryMode | null;
  trigger_price: number | null;     // breakout level (pattern high)
  invalidation_price: number | null; // stop level (pattern low)
  notes: string;
  // Diagnostics — useful for UI surface + alert payload
  near_support: boolean;
  distance_from_sma20_percent: number;
  short_term_decline: boolean;
  cluster_of_lows: boolean;
  sharp_selloff: boolean;
  elevated_volume: boolean;
}

export interface EngineInputs {
  bars: OHLCBar[];                    // chronological, oldest → newest
  current_price: number;              // live tick if available, else last close
  daily_sma20: number;
  sma_band_percent?: number;          // default 2.0 (percent)
  conservative_mode?: boolean;        // default true
  bars_since_confirmation?: number;   // for Ready-to-Trade logic; 0 = current bar is the confirmation
  last_confirmed_pattern?: {
    type: PatternType;
    high: number;
    low: number;
  } | null;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function isRed(b: OHLCBar): boolean { return b.close < b.open; }
function isGreen(b: OHLCBar): boolean { return b.close > b.open; }

// ─── Context detectors (Section 3 of spec) ──────────────────────────────────

/** ≥3 red bars AND lower-lows forming across last 5–7 bars. */
function shortTermDecline(bars: OHLCBar[]): boolean {
  if (bars.length < 5) return false;
  const window = bars.slice(-7, -1); // exclude current bar (the would-be reversal)
  if (window.length < 5) return false;
  const reds = window.filter(isRed).length;
  // forming-lower-lows: each new low ≤ previous low (allow up to 1 violation)
  let violations = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].low > window[i - 1].low) violations++;
  }
  return reds >= 3 && violations <= 1;
}

/** Several candles with lows in a ±0.5% band around the recent low (last 5–7). */
function clusterOfLows(bars: OHLCBar[]): boolean {
  if (bars.length < 5) return false;
  const window = bars.slice(-7, -1);
  if (window.length < 5) return false;
  const lows = window.map(b => b.low);
  const recentLow = Math.min(...lows);
  const bandLo = recentLow * 0.995;
  const bandHi = recentLow * 1.005;
  const inBand = window.filter(b => b.low >= bandLo && b.low <= bandHi).length;
  const reds = window.filter(isRed).length;
  return inBand >= 3 && reds >= 2;
}

/** Big down move OR large red bar with continuation in last ~5 bars. */
function sharpSelloff(bars: OHLCBar[]): boolean {
  if (bars.length < 5) return false;
  const window = bars.slice(-6, -1); // last 5 bars before current
  if (window.length < 4) return false;
  const startClose = window[0].close;
  const endClose = window[window.length - 1].close;
  if (startClose <= 0) return false;
  const dropPct = (startClose - endClose) / startClose * 100;
  if (dropPct >= 2.0) return true;
  // Alternative: 1 big red bar > 1.5% drop followed by another red continuation bar
  for (let i = 0; i < window.length - 1; i++) {
    const b = window[i];
    const next = window[i + 1];
    if (b.open <= 0) continue;
    const bigRedPct = (b.open - b.close) / b.open * 100;
    if (isRed(b) && bigRedPct >= 1.5 && isRed(next)) return true;
  }
  return false;
}

function elevatedVolume(bars: OHLCBar[]): boolean {
  if (bars.length < 11) return false;
  const cur = bars[bars.length - 1];
  const avgVol = avg(bars.slice(-11, -1).map(b => b.volume).filter(v => v > 0));
  if (avgVol <= 0) return false;
  return cur.volume >= 1.2 * avgVol;
}

// ─── Pattern shape detectors (Section 4 of spec) ────────────────────────────

interface Shape {
  body: number;
  range: number;
  bodyRatio: number;
  lowerWick: number;
  upperWick: number;
  closePos: number;
  green: boolean;
  red: boolean;
}

function shapeOf(b: OHLCBar): Shape {
  const body = Math.abs(b.close - b.open);
  const range = b.high - b.low;
  if (range <= 0) {
    return { body: 0, range: 0, bodyRatio: 0, lowerWick: 0, upperWick: 0, closePos: 0, green: false, red: false };
  }
  return {
    body,
    range,
    bodyRatio: body / range,
    lowerWick: Math.min(b.open, b.close) - b.low,
    upperWick: b.high - Math.max(b.open, b.close),
    closePos: (b.close - b.low) / range,
    green: b.close > b.open,
    red: b.close < b.open,
  };
}

function hammerShape(b: OHLCBar): boolean {
  const s = shapeOf(b);
  return s.green && s.range > 0 && s.lowerWick >= 2 * s.body && s.upperWick <= s.body && s.closePos >= 0.67;
}

function bullishEngulfingShape(cur: OHLCBar, prev: OHLCBar): boolean {
  const prevBody = Math.abs(prev.close - prev.open);
  if (prevBody <= 0) return false;
  const prevRed = prev.close < prev.open;
  const curGreen = cur.close > cur.open;
  return prevRed && curGreen && cur.open <= prev.close && cur.close >= prev.open;
}

function strongBullBarShape(b: OHLCBar): boolean {
  const s = shapeOf(b);
  return s.green && s.range > 0 && s.bodyRatio >= 0.6 && s.closePos >= 0.75;
}

// (Aggressive reversal bar uses identical shape to strong bull bar.)
const strongReversalBarShape = strongBullBarShape;

// ─── Engine ─────────────────────────────────────────────────────────────────

export function evaluatePattern(inputs: EngineInputs): PatternEvaluation {
  const {
    bars,
    current_price,
    daily_sma20,
    sma_band_percent = 2.0,
    conservative_mode = true,
    bars_since_confirmation,
    last_confirmed_pattern,
  } = inputs;

  // Defaults — populated as we evaluate
  const result: PatternEvaluation = {
    pattern_status: "No Valid Trigger Yet",
    pattern: null,
    entry_mode: null,
    trigger_price: null,
    invalidation_price: null,
    notes: "",
    near_support: false,
    distance_from_sma20_percent: 0,
    short_term_decline: false,
    cluster_of_lows: false,
    sharp_selloff: false,
    elevated_volume: false,
  };

  if (bars.length === 0 || !Number.isFinite(daily_sma20) || daily_sma20 <= 0) {
    result.notes = "Insufficient data.";
    return result;
  }

  // ── 1. Location filter ────────────────────────────────────────────────────
  const distancePct = Math.abs(current_price - daily_sma20) / daily_sma20 * 100;
  result.distance_from_sma20_percent = Number(distancePct.toFixed(3));
  result.near_support = distancePct <= sma_band_percent;

  // ── 3. Context flags ─────────────────────────────────────────────────────
  result.short_term_decline = shortTermDecline(bars);
  result.cluster_of_lows = clusterOfLows(bars);
  result.sharp_selloff = sharpSelloff(bars);
  result.elevated_volume = elevatedVolume(bars);

  const cur = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  const isClosed = cur.is_closed !== false; // default to closed

  // ── 6. Ready-to-Trade check (runs against last confirmed pattern) ────────
  // This takes precedence: if we have an active confirmed pattern AND the
  // current bar has broken its high, surface Ready to Trade rather than
  // re-evaluating shape on the breakout bar (which won't be a hammer).
  if (last_confirmed_pattern) {
    const since = bars_since_confirmation ?? 0;
    if (conservative_mode) {
      const breakout = cur.close > last_confirmed_pattern.high || cur.high > last_confirmed_pattern.high;
      if (breakout) {
        result.pattern_status = "Ready to Trade";
        result.pattern = last_confirmed_pattern.type;
        result.entry_mode = entryModeFor(last_confirmed_pattern.type);
        result.trigger_price = last_confirmed_pattern.high;
        result.invalidation_price = last_confirmed_pattern.low;
        result.notes = `Confirmed ${last_confirmed_pattern.type} with breakout above high.`;
        return result;
      }
      if (since > 2) {
        result.pattern_status = "Signal Expired";
        result.pattern = last_confirmed_pattern.type;
        result.notes = `${last_confirmed_pattern.type} signal expired after ${since} bars without breakout.`;
        return result;
      }
    } else {
      // Aggressive mode — confirmation IS the trigger
      result.pattern_status = "Ready to Trade";
      result.pattern = last_confirmed_pattern.type;
      result.entry_mode = entryModeFor(last_confirmed_pattern.type);
      result.trigger_price = last_confirmed_pattern.high;
      result.invalidation_price = last_confirmed_pattern.low;
      result.notes = `Confirmed ${last_confirmed_pattern.type}; aggressive entry allowed at close.`;
      return result;
    }
  }

  // ── 5. Forming (intrabar) — only when current bar still open & near support
  if (!isClosed && result.near_support) {
    if (hammerShape(cur) && result.short_term_decline) {
      result.pattern_status = "Hammer Forming";
      result.pattern = "Hammer";
      result.notes = "Hammer shape forming near SMA20 after short-term decline.";
      return result;
    }
    if (prev && bullishEngulfingShape(cur, prev) && result.short_term_decline) {
      result.pattern_status = "Engulfing Forming";
      result.pattern = "Bullish Engulfing";
      result.notes = "Bullish engulfing forming near SMA20 after short-term decline.";
      return result;
    }
    if (strongBullBarShape(cur) && result.cluster_of_lows) {
      result.pattern_status = "Bull Bar Forming";
      result.pattern = "Strong Bull Bar";
      result.notes = "Strong bull bar forming after cluster of lows near SMA20.";
      return result;
    }
    if (strongReversalBarShape(cur) && result.sharp_selloff) {
      result.pattern_status = "Aggressive Bounce Forming";
      result.pattern = "Aggressive Bounce";
      result.notes = "V-shaped bounce bar forming after sharp selloff near SMA20.";
      return result;
    }
  }

  // ── 5. Confirmed (closed bar) ────────────────────────────────────────────
  if (isClosed && result.near_support) {
    // Order matters: strictest pattern wins so "Confirmed Hammer" doesn't
    // get re-classified as "Strong Bull Bar" when both shapes happen to fit.
    if (hammerShape(cur) && result.short_term_decline) {
      result.pattern_status = "Confirmed Hammer";
      result.pattern = "Hammer";
      result.entry_mode = "Core";
      result.trigger_price = cur.high;
      result.invalidation_price = cur.low;
      result.notes = "Hammer confirmed near SMA20; conservative entry above high.";
      return result;
    }
    if (prev && bullishEngulfingShape(cur, prev) && result.short_term_decline) {
      result.pattern_status = "Confirmed Bullish Engulfing";
      result.pattern = "Bullish Engulfing";
      result.entry_mode = "Core";
      result.trigger_price = cur.high;
      result.invalidation_price = cur.low;
      result.notes = "Bullish engulfing confirmed near SMA20; entry above pattern high.";
      return result;
    }
    if (strongBullBarShape(cur) && result.cluster_of_lows) {
      result.pattern_status = "Confirmed Bull Bar";
      result.pattern = "Strong Bull Bar";
      result.entry_mode = "Flexible";
      result.trigger_price = cur.high;
      result.invalidation_price = cur.low;
      result.notes = "Strong bull bar after cluster of lows; flexible pullback setup.";
      return result;
    }
    if (strongReversalBarShape(cur) && result.sharp_selloff && (result.elevated_volume || result.near_support)) {
      result.pattern_status = "Confirmed Aggressive Bounce";
      result.pattern = "Aggressive Bounce";
      result.entry_mode = "Aggressive";
      result.trigger_price = cur.high;
      result.invalidation_price = cur.low;
      result.notes = "V-shaped reversal bar after sharp selloff; aggressive bounce.";
      return result;
    }
  }

  // No qualifying setup
  if (!result.near_support) {
    result.notes = `Price ${distancePct.toFixed(2)}% from SMA20 — outside ${sma_band_percent}% band.`;
  } else {
    result.notes = "No qualifying pattern at support yet.";
  }
  return result;
}

function entryModeFor(p: PatternType): EntryMode {
  switch (p) {
    case "Hammer":
    case "Bullish Engulfing":
      return "Core";
    case "Strong Bull Bar":
      return "Flexible";
    case "Aggressive Bounce":
      return "Aggressive";
  }
}

// ─── Test-only exports (not part of public API but handy for unit checks) ──
export const __internals = {
  hammerShape,
  bullishEngulfingShape,
  strongBullBarShape,
  shortTermDecline,
  clusterOfLows,
  sharpSelloff,
  elevatedVolume,
  shapeOf,
};
