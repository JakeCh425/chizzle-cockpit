// ─────────────────────────────────────────────────────────────────────────────
// continuationPatterns.ts
//
// Client-side, deterministic detection for the three continuation/base
// patterns the user explicitly approved on 2026-09-21:
//
//   • Bull Flag       — pole + tight pullback + volume dry-up
//   • Flat Base       — prior uptrend + tight sideways range + volume dry-up
//   • Double Bottom   — two equal lows separated by a neckline
//
// The rules follow the approved thresholds verbatim. Every detector:
//   - Operates on CLOSED bars only (the last bar in the input is treated as
//     the current/potentially-forming bar; confirmation is measured from the
//     closed bars before it).
//   - Uses documented, non-repainting thresholds — labels never rewrite the
//     past once a bar closes.
//   - Emits one state per formation: Not Detected → Developing → Near
//     Confirmation → Confirmed → Failed (or Not Enough Data).
//   - Never promotes a formation to a setup card or invents a trigger/stop.
//     Confirmation levels are marked for visual reference only.
//
// This module is deliberately self-contained — the chart component consumes it,
// and no server route depends on it.
// ─────────────────────────────────────────────────────────────────────────────

export interface OHLCBar {
  time: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PatternState =
  | "Not Detected"
  | "Developing"
  | "Near Confirmation"
  | "Confirmed"
  | "Failed"
  | "Not Enough Data";

export interface PatternResult {
  state: PatternState;
  /** First bar index of the formation (pole start / base start / L1). */
  startIdx?: number;
  /** Last relevant bar index (breakout bar if Confirmed, otherwise current). */
  endIdx?: number;
  /** Breakout level / neckline / pole high — for on-chart marker only. */
  level?: number;
  /** Human-readable one-liner. Never a signal instruction. */
  details?: string;
}

export interface ContinuationDetection {
  bullFlag: PatternResult;
  flatBase: PatternResult;
  doubleBottom: PatternResult;
}

const MIN_BARS = 40;

// ─── helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function max(arr: number[]): number {
  let m = -Infinity;
  for (const x of arr) if (x > m) m = x;
  return m;
}

function min(arr: number[]): number {
  let m = Infinity;
  for (const x of arr) if (x < m) m = x;
  return m;
}

/** Linear regression slope of `values` against index (per-bar slope). */
function slopePerBar(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return den === 0 ? 0 : num / den;
}

// ─── Bull Flag ───────────────────────────────────────────────────────────────
// Approved rules:
//   Pole: ≥15% advance over ≤10 bars, ending ≤12 bars ago.
//   Flag: 3–10 bars after the pole, pullback 3–15% off pole high, slope ≤0,
//         range ≤60% of pole range, avg volume ≤85% of pole avg volume.
//   Confirmed: close above flag upper AND breakout volume ≥1.2× flag avg.
//   Failed: close below flag lower, OR flag > 10 bars without breakout.
function detectBullFlag(bars: OHLCBar[]): PatternResult {
  const closed = bars.slice(0, -1); // exclude the current forming bar
  if (closed.length < 25) return { state: "Not Enough Data" };

  const n = closed.length;
  const currentBar = bars[bars.length - 1];

  // Search all plausible flag windows ending in the last 12 closed bars.
  for (let flagEnd = n - 1; flagEnd >= n - 12 && flagEnd >= 15; flagEnd--) {
    for (let flagLen = 3; flagLen <= 10; flagLen++) {
      const flagStart = flagEnd - flagLen + 1;
      if (flagStart < 12) continue;

      // Search plausible pole windows ending immediately before flagStart.
      for (let poleLen = 3; poleLen <= 10; poleLen++) {
        const poleEnd = flagStart - 1;
        const poleStart = poleEnd - poleLen + 1;
        if (poleStart < 0) continue;

        const poleBars = closed.slice(poleStart, poleEnd + 1);
        const poleLow = min(poleBars.map((b) => b.low));
        const poleHigh = max(poleBars.map((b) => b.high));
        const poleAdvance = (poleHigh - poleLow) / poleLow;
        if (poleAdvance < 0.15) continue;
        // Pole must actually trend up: last close > first close.
        if (poleBars[poleBars.length - 1].close <= poleBars[0].close) continue;

        const flagBars = closed.slice(flagStart, flagEnd + 1);
        const flagHigh = max(flagBars.map((b) => b.high));
        const flagLow = min(flagBars.map((b) => b.low));
        const pullback = (poleHigh - flagLow) / poleHigh;
        if (pullback < 0.03 || pullback > 0.15) continue;

        const flagCloses = flagBars.map((b) => b.close);
        const flagSlope = slopePerBar(flagCloses);
        if (flagSlope > 0) continue;

        const flagRange = flagHigh - flagLow;
        const poleRange = poleHigh - poleLow;
        if (flagRange > 0.6 * poleRange) continue;

        const flagAvgVol = mean(flagBars.map((b) => b.volume));
        const poleAvgVol = mean(poleBars.map((b) => b.volume));
        if (flagAvgVol > 0.85 * poleAvgVol) continue;

        // We have a valid flag on the closed bars. Now judge state using the
        // current (possibly still-forming) bar plus the most recent closed bar.
        const lastClosed = closed[closed.length - 1];
        const barsSinceFlag = n - 1 - flagEnd;

        // Failed: last closed bar's close is below flag lower.
        if (lastClosed.close < flagLow) {
          return {
            state: "Failed",
            startIdx: poleStart,
            endIdx: n - 1,
            level: flagHigh,
            details: "Pullback broke flag support.",
          };
        }
        // Failed: flag extended beyond 10 bars without breakout.
        if (flagLen === 10 && lastClosed.close < flagHigh) {
          continue; // let another window try
        }

        // Confirmed: last CLOSED bar closed above flag upper on ≥1.2× flag vol.
        if (barsSinceFlag <= 3 &&
            lastClosed.close > flagHigh &&
            lastClosed.volume >= 1.2 * flagAvgVol) {
          return {
            state: "Confirmed",
            startIdx: poleStart,
            endIdx: n - 1,
            level: flagHigh,
            details: `Closed above flag upper on ${(lastClosed.volume / flagAvgVol).toFixed(1)}× flag volume.`,
          };
        }

        // Near Confirmation: current bar pushing through flag upper.
        if (currentBar && currentBar.high > flagHigh && currentBar.close > (flagHigh + flagLow) / 2) {
          return {
            state: "Near Confirmation",
            startIdx: poleStart,
            endIdx: n,
            level: flagHigh,
            details: "Testing flag upper — awaiting closed-bar confirmation.",
          };
        }

        // Otherwise still developing inside the flag.
        return {
          state: "Developing",
          startIdx: poleStart,
          endIdx: n - 1,
          level: flagHigh,
          details: `Pole +${(poleAdvance * 100).toFixed(1)}%, flag ${flagLen} bars, pullback ${(pullback * 100).toFixed(1)}%.`,
        };
      }
    }
  }

  return { state: "Not Detected" };
}

// ─── Flat Base ───────────────────────────────────────────────────────────────
// Approved rules:
//   Prior uptrend: ≥25% above the low 40 bars before base start.
//   Base: 5–15 bars, range ≤15% of midpoint, |slope|/mean ≤0.003 per bar,
//         no bar closes >2% below the median of lows.
//   Volume: base avg <90% of pre-base 20-bar avg.
//   Confirmed: close above base upper AND breakout volume ≥1.4× base avg.
//   Failed: close below base lower, OR base > 15 bars without breakout.
function detectFlatBase(bars: OHLCBar[]): PatternResult {
  const closed = bars.slice(0, -1);
  if (closed.length < MIN_BARS) return { state: "Not Enough Data" };
  const n = closed.length;

  for (let baseEnd = n - 1; baseEnd >= n - 8 && baseEnd >= 24; baseEnd--) {
    for (let baseLen = 5; baseLen <= 15; baseLen++) {
      const baseStart = baseEnd - baseLen + 1;
      if (baseStart < 21) continue;

      const priorLowIdx = Math.max(0, baseStart - 40);
      const priorLow = min(closed.slice(priorLowIdx, baseStart).map((b) => b.low));
      const baseBars = closed.slice(baseStart, baseEnd + 1);
      const baseHigh = max(baseBars.map((b) => b.high));
      const baseLow = min(baseBars.map((b) => b.low));
      const mid = (baseHigh + baseLow) / 2;
      const uptrend = (baseHigh - priorLow) / priorLow;
      if (uptrend < 0.25) continue;

      const rangePct = (baseHigh - baseLow) / mid;
      if (rangePct > 0.15) continue;

      const closes = baseBars.map((b) => b.close);
      const s = slopePerBar(closes);
      if (Math.abs(s / mean(closes)) > 0.003) continue;

      // Median of lows.
      const lows = baseBars.map((b) => b.low).slice().sort((a, b) => a - b);
      const medLow = lows[Math.floor(lows.length / 2)];
      if (baseBars.some((b) => b.close < medLow * 0.98)) continue;

      const baseAvgVol = mean(baseBars.map((b) => b.volume));
      const preBaseBars = closed.slice(Math.max(0, baseStart - 20), baseStart);
      const preBaseVol = mean(preBaseBars.map((b) => b.volume));
      if (preBaseVol > 0 && baseAvgVol > 0.9 * preBaseVol) continue;

      const lastClosed = closed[closed.length - 1];
      const currentBar = bars[bars.length - 1];

      if (lastClosed.close < baseLow) {
        return {
          state: "Failed",
          startIdx: baseStart,
          endIdx: n - 1,
          level: baseHigh,
          details: "Base broke to the downside.",
        };
      }
      if (baseLen === 15 && lastClosed.close < baseHigh) continue;

      if (lastClosed.close > baseHigh && lastClosed.volume >= 1.4 * baseAvgVol) {
        return {
          state: "Confirmed",
          startIdx: baseStart,
          endIdx: n - 1,
          level: baseHigh,
          details: `Closed above base on ${(lastClosed.volume / baseAvgVol).toFixed(1)}× base volume.`,
        };
      }

      if (currentBar && currentBar.high > baseHigh && currentBar.close > mid) {
        return {
          state: "Near Confirmation",
          startIdx: baseStart,
          endIdx: n,
          level: baseHigh,
          details: "Pushing through base upper — awaiting closed-bar confirmation.",
        };
      }

      return {
        state: "Developing",
        startIdx: baseStart,
        endIdx: n - 1,
        level: baseHigh,
        details: `Base ${baseLen} bars, range ${(rangePct * 100).toFixed(1)}%, vol dry-up ${(baseAvgVol / preBaseVol * 100).toFixed(0)}%.`,
      };
    }
  }

  return { state: "Not Detected" };
}

// ─── Double Bottom ───────────────────────────────────────────────────────────
// Approved rules:
//   L1: swing low in last 30 bars, ≥10% below the prior 20-bar high, and
//       lower than the 3 bars on either side.
//   M (neckline): swing high after L1, ≥5% above L1.
//   L2: swing low after M, within ±3% of L1, occurring 5–25 bars after L1.
//   Confirmed: close above neckline AND breakout volume ≥1.3× 20-bar avg.
//   Failed: close >2% below L2 before the neckline breaks, OR >15 bars pass
//           after L2 without a breakout.
function isSwingLow(bars: OHLCBar[], i: number, span = 3): boolean {
  if (i < span || i > bars.length - 1 - span) return false;
  const low = bars[i].low;
  for (let k = 1; k <= span; k++) {
    if (bars[i - k].low <= low) return false;
    if (bars[i + k].low <= low) return false;
  }
  return true;
}

function isSwingHigh(bars: OHLCBar[], i: number, span = 3): boolean {
  if (i < span || i > bars.length - 1 - span) return false;
  const high = bars[i].high;
  for (let k = 1; k <= span; k++) {
    if (bars[i - k].high >= high) return false;
    if (bars[i + k].high >= high) return false;
  }
  return true;
}

function detectDoubleBottom(bars: OHLCBar[]): PatternResult {
  const closed = bars.slice(0, -1);
  if (closed.length < MIN_BARS) return { state: "Not Enough Data" };
  const n = closed.length;

  // Find candidate L1 in the last 30 bars.
  for (let l1 = Math.max(20, n - 30); l1 <= n - 8; l1++) {
    if (!isSwingLow(closed, l1)) continue;
    const priorHigh = max(closed.slice(Math.max(0, l1 - 20), l1).map((b) => b.high));
    if ((priorHigh - closed[l1].low) / priorHigh < 0.10) continue;

    // Find neckline M — highest swing high after L1.
    let mIdx = -1;
    let mHigh = -Infinity;
    for (let j = l1 + 3; j <= n - 4; j++) {
      if (isSwingHigh(closed, j) && closed[j].high > mHigh) {
        mHigh = closed[j].high;
        mIdx = j;
      }
    }
    if (mIdx < 0) continue;
    if ((mHigh - closed[l1].low) / closed[l1].low < 0.05) continue;

    // Find L2 5–25 bars after L1, within ±3% of L1.
    for (let l2 = l1 + 5; l2 <= Math.min(n - 1, l1 + 25); l2++) {
      if (l2 <= mIdx + 2) continue;
      if (!isSwingLow(closed, l2)) continue;
      const diffPct = Math.abs(closed[l2].low - closed[l1].low) / closed[l1].low;
      if (diffPct > 0.03) continue;

      const lastClosed = closed[n - 1];
      const currentBar = bars[bars.length - 1];
      const barsSinceL2 = n - 1 - l2;
      const vol20 = mean(closed.slice(Math.max(0, n - 20), n).map((b) => b.volume));

      // Failed: close >2% below L2 before neckline broken.
      const brokenBefore = closed.slice(l2 + 1, n).some((b) => b.close > mHigh);
      if (!brokenBefore && lastClosed.close < closed[l2].low * 0.98) {
        return {
          state: "Failed",
          startIdx: l1,
          endIdx: n - 1,
          level: mHigh,
          details: "Right-shoulder low broke without reclaiming neckline.",
        };
      }
      if (barsSinceL2 > 15 && !brokenBefore) continue;

      if (lastClosed.close > mHigh && lastClosed.volume >= 1.3 * vol20) {
        return {
          state: "Confirmed",
          startIdx: l1,
          endIdx: n - 1,
          level: mHigh,
          details: `Closed above neckline on ${(lastClosed.volume / vol20).toFixed(1)}× 20-bar volume.`,
        };
      }

      if (currentBar && currentBar.high > mHigh && currentBar.close > (mHigh + closed[l2].low) / 2) {
        return {
          state: "Near Confirmation",
          startIdx: l1,
          endIdx: n,
          level: mHigh,
          details: "Testing neckline — awaiting closed-bar confirmation.",
        };
      }

      return {
        state: "Developing",
        startIdx: l1,
        endIdx: n - 1,
        level: mHigh,
        details: `L1 ${l1}, L2 ${l2} (Δ ${(diffPct * 100).toFixed(1)}%), neckline ${mHigh.toFixed(2)}.`,
      };
    }
  }

  return { state: "Not Detected" };
}

// ─── public API ──────────────────────────────────────────────────────────────

export function detectContinuationPatterns(bars: OHLCBar[]): ContinuationDetection {
  if (!bars || bars.length < MIN_BARS) {
    const nd: PatternResult = { state: "Not Enough Data" };
    return { bullFlag: nd, flatBase: nd, doubleBottom: nd };
  }
  return {
    bullFlag: detectBullFlag(bars),
    flatBase: detectFlatBase(bars),
    doubleBottom: detectDoubleBottom(bars),
  };
}
