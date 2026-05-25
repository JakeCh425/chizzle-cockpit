// ─── Setup Quality Classifier (A / B / C) ──────────────────────────────
// Per regime_gate_spec.md "Setup Quality Classification" block.
// Pure function — no I/O, no side effects.

export interface QualityInputs {
  relativeStrength: number;   // 0–100
  trendStrength: number;       // 0–100
  volumeScore: number;          // 0–100
  cleanlinessScore: number;     // 0–100
  marketAlignment: boolean;     // SPY/QQQ trending with the setup
  earningsRisk: boolean;        // earnings within 5 business days
}

export interface QualityResult {
  grade: "A" | "B" | "C";
  reason: string;
}

export function classifyQuality(inp: QualityInputs): QualityResult {
  // A-grade: all four scores high + market aligned + no earnings risk
  if (
    inp.relativeStrength >= 70 &&
    inp.trendStrength >= 70 &&
    inp.volumeScore >= 60 &&
    inp.cleanlinessScore >= 70 &&
    inp.marketAlignment &&
    !inp.earningsRisk
  ) {
    return { grade: "A", reason: "All scores ≥ A thresholds, market aligned, no earnings risk." };
  }
  // B-grade: moderate scores, still no earnings risk (vetoes B too per spec)
  if (
    inp.relativeStrength >= 50 &&
    inp.trendStrength >= 50 &&
    inp.volumeScore >= 40 &&
    inp.cleanlinessScore >= 50 &&
    !inp.earningsRisk
  ) {
    return { grade: "B", reason: "Scores ≥ B thresholds, no earnings risk." };
  }
  // C-grade: fallback
  const why: string[] = [];
  if (inp.earningsRisk) why.push("earnings within 5d");
  if (inp.relativeStrength < 50) why.push(`RS ${inp.relativeStrength}`);
  if (inp.trendStrength < 50) why.push(`trend ${inp.trendStrength}`);
  if (inp.volumeScore < 40) why.push(`vol ${inp.volumeScore}`);
  if (inp.cleanlinessScore < 50) why.push(`clean ${inp.cleanlinessScore}`);
  return { grade: "C", reason: why.length ? `Below thresholds: ${why.join(", ")}` : "Fallback bucket." };
}

// ─── Score component computers ─────────────────────────────────────────
// Each returns 0-100. Pure functions on bar arrays.

export interface Bar { open: number; high: number; low: number; close: number; volume: number; }

/**
 * Relative strength vs benchmark (SPY). 3-month return of ticker minus 3-month
 * return of SPY, mapped to a 0-100 score where +20% outperformance = 100,
 * -20% = 0, linear between.
 */
export function computeRelativeStrength(bars: Bar[], spyBars: Bar[]): number {
  if (bars.length < 63 || spyBars.length < 63) return 50;
  const tRet = (bars[bars.length - 1].close / bars[bars.length - 63].close - 1) * 100;
  const sRet = (spyBars[spyBars.length - 1].close / spyBars[spyBars.length - 63].close - 1) * 100;
  const diff = tRet - sRet; // outperformance in %
  // -20 → 0, +20 → 100. Clamp.
  const score = 50 + diff * 2.5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Trend strength: how cleanly stacked the SMAs are AND price's position.
 * 100 = price > 20 > 50 > 200, all rising. 0 = inverted death cross.
 */
export function computeTrendStrength(bars: Bar[]): number {
  if (bars.length < 200) return 50;
  const closes = bars.map(b => b.close);
  const last = closes[closes.length - 1];
  const sma = (period: number, offset = 0): number => {
    const end = closes.length - offset;
    const start = end - period;
    if (start < 0) return 0;
    let s = 0;
    for (let i = start; i < end; i++) s += closes[i];
    return s / period;
  };
  const s20 = sma(20), s50 = sma(50), s200 = sma(200);
  const s20Prev = sma(20, 5), s50Prev = sma(50, 5);
  let score = 0;
  if (last > s20) score += 20;
  if (s20 > s50) score += 25;
  if (s50 > s200) score += 25;
  if (s20 > s20Prev) score += 15; // 20 rising
  if (s50 > s50Prev) score += 15; // 50 rising
  return score;
}

/**
 * Volume score: ratio of recent 5-day avg volume to 20-day avg.
 * Higher = volume expansion. 1.5x+ = 100, 1.0 = 50, 0.5 = 0.
 */
export function computeVolumeScore(bars: Bar[]): number {
  if (bars.length < 20) return 50;
  const n = bars.length;
  let v5 = 0, v20 = 0;
  for (let i = n - 5; i < n; i++) v5 += bars[i].volume;
  for (let i = n - 20; i < n; i++) v20 += bars[i].volume;
  v5 /= 5; v20 /= 20;
  if (v20 === 0) return 50;
  const ratio = v5 / v20;
  // 0.5 → 0, 1.0 → 50, 1.5 → 100
  const score = (ratio - 0.5) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Cleanliness: penalizes wicky / choppy action. Measures how often the close
 * landed in the upper half of each candle over the last 20 days, AND the
 * ratio of body to range (less wick = cleaner).
 */
export function computeCleanlinessScore(bars: Bar[]): number {
  if (bars.length < 20) return 50;
  const recent = bars.slice(-20);
  let strongCloses = 0;
  let bodyRatioSum = 0;
  for (const b of recent) {
    const range = b.high - b.low;
    if (range <= 0) continue;
    const closePos = (b.close - b.low) / range;
    if (closePos >= 0.5) strongCloses++;
    const body = Math.abs(b.close - b.open);
    bodyRatioSum += body / range;
  }
  const strongClosePct = (strongCloses / 20) * 100;        // 0-100
  const bodyAvgPct = (bodyRatioSum / 20) * 100;            // 0-100
  return Math.round(strongClosePct * 0.5 + bodyAvgPct * 0.5);
}

/**
 * Market alignment: SPY trading above its 50-day SMA AND 50-day rising.
 */
export function computeMarketAlignment(spyBars: Bar[]): boolean {
  if (spyBars.length < 55) return false;
  const closes = spyBars.map(b => b.close);
  const last = closes[closes.length - 1];
  const sma50 = (offset: number): number => {
    const end = closes.length - offset;
    let s = 0;
    for (let i = end - 50; i < end; i++) s += closes[i];
    return s / 50;
  };
  const s50Now = sma50(0);
  const s50Past = sma50(5);
  return last > s50Now && s50Now > s50Past;
}
