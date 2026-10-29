// ─────────────────────────────────────────────────────────────────────────────
// SMA + proximity signal scoring.
// Pure functions, framework-free, fully memoizable.
// ─────────────────────────────────────────────────────────────────────────────

export type Signal = "BOUNCE" | "REJECTION" | "AT_SMA" | "APPROACHING" | "NEUTRAL" | "LOADING";
export type SignalColor = "green" | "amber" | "red" | "slate";

/**
 * A-score — categorical SMA20 setup score.
 *   A0 = neutral / clear of SMA20
 *   A1 = loading / insufficient data
 *   A2 = approaching SMA20 (within 1%)
 *   A3 = touching SMA20 (within 0.2%)
 *   A4 = bounce cross above SMA20
 *   REJECTION = cross below SMA20 (separate label, not numeric)
 */
export type AScore = "A0" | "A1" | "A2" | "A3" | "A4" | "REJECTION";

export interface AScoreResult {
  score: AScore;
  /** 0–3 numeric weight; REJECTION = -1 (downside signal). */
  numeric: number;
  color: SignalColor;
  label: string;
  tooltip: string;
}

export const A_SCORE_NUMERIC: Record<AScore, number> = {
  A0: 0, A1: 0, A2: 1, A3: 2, A4: 3, REJECTION: -1,
};

export interface SignalResult {
  signal: Signal;
  color: SignalColor;
  /** 0-100. Higher = stronger setup. Bounce=85, Rejection=15, At=60, Approaching=50, Neutral=40, Loading=0 */
  score: number;
  note: string;
}

/** O(n) rolling SMA. Returns array same length as input, null until window fills. */
export function rollingSMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Compute SMA20/50/200 in one pass-friendly batch. */
export function computeSMAs(closes: number[]) {
  return {
    sma20: rollingSMA(closes, 20),
    sma50: rollingSMA(closes, 50),
    sma200: rollingSMA(closes, 200),
  };
}

/**
 * O(n) rolling EMA. Returns array same length as input, null until window fills.
 * Multiplier k = 2 / (period + 1). For period 10, k = 2 / 11 = ~0.1818.
 * Seed is the SMA of the first `period` values.
 */
export function rollingEMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;

  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prevEma = sum / period;
  out[period - 1] = prevEma;

  for (let i = period; i < values.length; i++) {
    const val = (values[i] - prevEma) * multiplier + prevEma;
    out[i] = val;
    prevEma = val;
  }
  return out;
}

/** Compute EMAs (e.g. 10-EMA, 20-EMA) in one pass-friendly batch. */
export function computeEMAs(closes: number[]) {
  return {
    ema10: rollingEMA(closes, 10),
    ema20: rollingEMA(closes, 20),
  };
}

/**
 * 10-EMA Momentum Setup Detector:
 * 1. Runaway trend: stock trades significantly above 20-SMA (>= 1.5% above 20-SMA: price >= sma20 * 1.015).
 * 2. Pullback touches and holds 10-EMA: low touches or dips near 10-EMA (low <= ema10 * 1.005) while close holds above or near 10-EMA.
 * 3. 1H candle closes green off 10-EMA: close >= open (or close >= prevClose) and close >= ema10.
 */
export function is10EmaMomentumSetup(
  closes: number[],
  smas?: { sma20?: (number | null)[]; ema10?: (number | null)[] },
  lows?: number[],
  opens?: number[]
): boolean {
  const n = closes.length;
  if (n < 10) return false;

  const sma20Series = smas?.sma20 ?? rollingSMA(closes, 20);
  const ema10Series = smas?.ema10 ?? rollingEMA(closes, 10);

  const price = closes[n - 1];
  const sma20 = sma20Series[n - 1];
  const ema10 = ema10Series[n - 1];

  if (sma20 == null || ema10 == null || sma20 <= 0 || ema10 <= 0) return false;

  // 1. Runaway trend: stock trades >= 1.5% above its 20-SMA
  const isAboveSma20 = price >= sma20 * 1.015;
  if (!isAboveSma20) return false;

  // 2. Holds 10-EMA: close is at or above 10-EMA (or within 0.2%)
  const holdsEma10 = price >= ema10 * 0.998;
  if (!holdsEma10) return false;

  // 3. Touched 10-EMA on current or previous bar (low or close pulled back to near 10-EMA)
  const low = lows && lows.length >= n ? lows[n - 1] : Math.min(price, closes[n - 2] ?? price);
  const touchedEma10 = low <= ema10 * 1.005;
  if (!touchedEma10) return false;

  // 4. Closes green: close >= open (or close >= prevClose if open not provided)
  const open = opens && opens.length >= n ? opens[n - 1] : closes[n - 2] ?? price;
  const isGreen = price >= open;

  return isGreen;
}

// ── Tunable thresholds (export so callers can override per setup) ──────────
export const SIGNAL_THRESHOLDS = {
  atPct: 0.002,         // 0.2% — "At SMA"
  approachingPct: 0.01, // 1.0% — "Approaching SMA"
};

/**
 * SMA20-anchored swing signal. Priority:
 *   1. Cross detection on last two closes (Bounce / Rejection)
 *   2. Proximity to nearest SMA among 20/50/200 (At > Approaching > Neutral)
 *
 * Returns score in [0..100] so callers can sort/filter watchlists.
 */
export function computeSignal(
  closes: number[],
  sma20: (number | null)[],
  sma50: (number | null)[],
  sma200: (number | null)[],
  thresholds = SIGNAL_THRESHOLDS,
): SignalResult {
  const n = closes.length;
  if (n < 2) return { signal: "LOADING", color: "slate", score: 0, note: "Loading" };

  const price = closes[n - 1];
  const prevPrice = closes[n - 2];
  const s20 = sma20[n - 1];
  const s20Prev = sma20[n - 2];
  const s50 = sma50[n - 1];
  const s200 = sma200[n - 1];

  // Cross detection on SMA20 — highest priority.
  if (s20 != null && s20Prev != null) {
    if (prevPrice < s20Prev && price >= s20) {
      return { signal: "BOUNCE", color: "green", score: 85, note: "Bounce off SMA20" };
    }
    if (prevPrice > s20Prev && price <= s20) {
      return { signal: "REJECTION", color: "red", score: 15, note: "Rejected at SMA20" };
    }
  }

  // Proximity scan — closest SMA wins.
  const targets = [
    { name: "SMA20", val: s20 },
    { name: "SMA50", val: s50 },
    { name: "SMA200", val: s200 },
  ].filter((t): t is { name: string; val: number } => t.val != null && Number.isFinite(t.val));

  if (targets.length === 0) {
    return { signal: "LOADING", color: "slate", score: 0, note: "Insufficient data" };
  }

  let nearest = { name: "", dist: Infinity };
  for (const t of targets) {
    const d = Math.abs(price - t.val) / t.val;
    if (d < nearest.dist) nearest = { name: t.name, dist: d };
  }

  if (nearest.dist <= thresholds.atPct) {
    return { signal: "AT_SMA", color: "amber", score: 60, note: `At ${nearest.name}` };
  }
  if (nearest.dist <= thresholds.approachingPct) {
    return { signal: "APPROACHING", color: "amber", score: 50, note: `Near ${nearest.name}` };
  }
  return { signal: "NEUTRAL", color: "green", score: 40, note: "Clear" };
}

/**
 * A-score — SMA20-anchored setup grade.
 * Mirrors the server-side alert engine's classify() but returns a richer
 * descriptor for in-UI badges + tooltips.
 */
export function getAScore(
  closes: number[],
  sma20Series: (number | null)[],
  thresholds = SIGNAL_THRESHOLDS,
): AScoreResult {
  const n = closes.length;
  if (n < 2) return { score: "A1", numeric: 0, color: "slate", label: "A1", tooltip: "Loading…" };

  const price = closes[n - 1];
  const prev = closes[n - 2];
  const s = sma20Series[n - 1];
  const sPrev = sma20Series[n - 2];
  if (s == null || sPrev == null) {
    return { score: "A1", numeric: 0, color: "slate", label: "A1", tooltip: "Need 20+ bars" };
  }

  // Cross detection has priority.
  if (prev < sPrev && price >= s) {
    return {
      score: "A4",
      numeric: 3,
      color: "green",
      label: "A4",
      tooltip: `A4 · Bounce cross above SMA20 (${price.toFixed(2)} ↑ ${s.toFixed(2)})`,
    };
  }
  if (prev > sPrev && price <= s) {
    return {
      score: "REJECTION",
      numeric: -1,
      color: "red",
      label: "REJ",
      tooltip: `Rejection · Cross below SMA20 (${price.toFixed(2)} ↓ ${s.toFixed(2)})`,
    };
  }

  const dist = Math.abs(price - s) / s;
  const distPct = ((price - s) / s) * 100;
  if (dist <= thresholds.atPct) {
    return {
      score: "A3",
      numeric: 2,
      color: "amber",
      label: "A3",
      tooltip: `A3 · Touching SMA20 (${distPct >= 0 ? "+" : ""}${distPct.toFixed(2)}%)`,
    };
  }
  if (dist <= thresholds.approachingPct) {
    return {
      score: "A2",
      numeric: 1,
      color: "amber",
      label: "A2",
      tooltip: `A2 · Approaching SMA20 (${distPct >= 0 ? "+" : ""}${distPct.toFixed(2)}%)`,
    };
  }
  return {
    score: "A0",
    numeric: 0,
    color: "green",
    label: "A0",
    tooltip: `A0 · Clear of SMA20 (${distPct >= 0 ? "+" : ""}${distPct.toFixed(2)}%)`,
  };
}
