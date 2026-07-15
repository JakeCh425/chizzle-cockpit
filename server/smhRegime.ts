// ─── SMH-led Regime Gauge ────────────────────────────────────────────────────
// Uses SMH as the primary regime gauge, with leading semis (NVDA/AMD/TSM/MU)
// as breadth confirmation. Produces a day classification that layers on top of
// the existing green/yellow/red engine.
//
// Chizzle rule (verbatim from user, 2026-07-15):
//   • Use SMH + leading semis as primary regime gauge.
//   • Do NOT require a full 15% drawdown before allowing swing trades.
//   • Allow strong ETF or approved swing setups during drawdowns up to 15%
//     IF trend is intact, setup is at a professional location (20/50 MA,
//     major support, or reclaim), invalidation is clear, RR >= 2:1.
//   • If SMH is >= 15% below peak AND the larger trend still holds,
//     conditions may qualify more easily as PRACTICE_SWING_DAY.
//   • If structure is messy or trend is broken, default to STANDBY_DAY
//     regardless of drawdown.
//
// Output: SWING_DAY / PRACTICE_SWING_DAY / STANDBY_DAY
//
// Design notes:
//   • Peak = highest close over the last 120 trading days (~6 months).
//   • Trend intact = SMH > rising 50 SMA (50 SMA today > 50 SMA 10 days ago).
//   • Messy structure = last 10 closes making lower highs AND lower lows.
//   • Broken trend = SMH < 50 SMA AND 50 SMA rolling over.
//   • Leader breadth = share of [NVDA, AMD, TSM, MU] above their own 20 SMA.

import { safeHistory, type DailyBar } from "./marketData";

export type SmhDayClass = "SWING_DAY" | "PRACTICE_SWING_DAY" | "STANDBY_DAY";

export interface SmhRegimeSnapshot {
  day_class: SmhDayClass;
  reason: string;
  smh: {
    last: number;
    sma20: number;
    sma50: number;
    sma50_slope_10d_pct: number; // % change in 50 SMA over last 10 bars
    peak_120d: number;
    drawdown_from_peak_pct: number; // negative if below peak
    dist_from_20sma_pct: number;
    dist_from_50sma_pct: number;
    trend_intact: boolean;
    structure_messy: boolean;
  };
  leaders: {
    breadth_above_20sma_pct: number;
    detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }>;
  };
  computed_at: string;
}

const LEADING_SEMIS = ["NVDA", "AMD", "TSM", "MU"];

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

// Returns true if the last 10 bars show lower highs AND lower lows overall
// (peak-to-peak declining). Uses first-half-max vs second-half-max comparison
// to avoid single-bar noise.
function isStructureMessy(bars: DailyBar[]): boolean {
  if (bars.length < 10) return false;
  const last10 = bars.slice(-10);
  const firstHalf = last10.slice(0, 5);
  const secondHalf = last10.slice(5);
  const firstHalfHigh = Math.max(...firstHalf.map((b) => b.high));
  const secondHalfHigh = Math.max(...secondHalf.map((b) => b.high));
  const firstHalfLow = Math.min(...firstHalf.map((b) => b.low));
  const secondHalfLow = Math.min(...secondHalf.map((b) => b.low));
  // Messy = lower highs AND lower lows across the two halves.
  return secondHalfHigh < firstHalfHigh && secondHalfLow < firstHalfLow;
}

export async function computeSmhRegime(): Promise<SmhRegimeSnapshot> {
  const bars = await safeHistory("SMH");
  if (!bars || bars.length < 60) {
    return {
      day_class: "STANDBY_DAY",
      reason: "Insufficient SMH history to classify — defaulting to standby.",
      smh: {
        last: 0,
        sma20: 0,
        sma50: 0,
        sma50_slope_10d_pct: 0,
        peak_120d: 0,
        drawdown_from_peak_pct: 0,
        dist_from_20sma_pct: 0,
        dist_from_50sma_pct: 0,
        trend_intact: false,
        structure_messy: true,
      },
      leaders: { breadth_above_20sma_pct: 0, detail: [] },
      computed_at: new Date().toISOString(),
    };
  }

  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20)!;
  const s50 = sma(closes, 50)!;
  const s50_10ago =
    closes.length >= 60 ? sma(closes.slice(0, -10), 50) ?? s50 : s50;
  const s50Slope = ((s50 - s50_10ago) / s50_10ago) * 100;

  const lookback = Math.min(120, closes.length);
  const peak = Math.max(...closes.slice(-lookback));
  const drawdown = ((last - peak) / peak) * 100;
  const dist20 = ((last - s20) / s20) * 100;
  const dist50 = ((last - s50) / s50) * 100;

  const trendIntact = last > s50 && s50Slope > -0.5;
  const trendBroken = last < s50 && s50Slope < -0.5;
  const messy = isStructureMessy(bars);

  // Leader breadth
  const leaderResults = await Promise.all(
    LEADING_SEMIS.map(async (t) => {
      try {
        const lb = await safeHistory(t);
        if (!lb || lb.length < 20) return null;
        const lc = lb.map((b) => b.close);
        const ll = lc[lc.length - 1];
        const ls20 = sma(lc, 20)!;
        return { ticker: t, last: ll, sma20: ls20, above: ll > ls20 };
      } catch {
        return null;
      }
    }),
  );
  const validLeaders = leaderResults.filter(
    (x): x is NonNullable<typeof x> => x !== null,
  );
  const breadth =
    validLeaders.length > 0
      ? validLeaders.filter((l) => l.above).length / validLeaders.length
      : 0;

  // Classification — per Chizzle SMH regime spec
  let dayClass: SmhDayClass;
  let reason: string;

  // Rule 1: If structure is messy OR trend is broken → STANDBY regardless of drawdown
  if (messy || trendBroken) {
    dayClass = "STANDBY_DAY";
    reason = trendBroken
      ? `SMH below 50 SMA with 50 SMA rolling over (${s50Slope.toFixed(2)}% slope) — trend broken.`
      : "SMH last 10 bars show lower highs and lower lows — structure messy.";
  }
  // Rule 2: SMH >= 15% below peak but larger trend still holds → PRACTICE_SWING_DAY
  else if (drawdown <= -15 && trendIntact) {
    dayClass = "PRACTICE_SWING_DAY";
    reason = `SMH ${drawdown.toFixed(1)}% below 120-day peak but 50 SMA still rising — practice tier only.`;
  }
  // Rule 3: Drawdown between -15% and -8% with intact trend but weak breadth → PRACTICE
  else if (drawdown <= -8 && trendIntact && breadth < 0.5) {
    dayClass = "PRACTICE_SWING_DAY";
    reason = `SMH ${drawdown.toFixed(1)}% off peak with only ${(breadth * 100).toFixed(0)}% of leading semis above 20 SMA — practice tier.`;
  }
  // Rule 4: Trend intact, drawdown < 15%, decent breadth → SWING_DAY
  else if (trendIntact && breadth >= 0.5) {
    dayClass = "SWING_DAY";
    reason = `SMH trend intact (>50 SMA, slope ${s50Slope >= 0 ? "+" : ""}${s50Slope.toFixed(2)}%), ${(breadth * 100).toFixed(0)}% of leading semis above 20 SMA — full swing conditions.`;
  }
  // Rule 5: Trend intact but low breadth (leaders lagging) → PRACTICE
  else if (trendIntact) {
    dayClass = "PRACTICE_SWING_DAY";
    reason = `SMH trend intact but only ${(breadth * 100).toFixed(0)}% of leaders above 20 SMA — practice tier.`;
  }
  // Rule 6: Everything else → STANDBY
  else {
    dayClass = "STANDBY_DAY";
    reason = `SMH below 50 SMA (dist ${dist50.toFixed(2)}%) — waiting for trend to reassert.`;
  }

  return {
    day_class: dayClass,
    reason,
    smh: {
      last: Number(last.toFixed(2)),
      sma20: Number(s20.toFixed(2)),
      sma50: Number(s50.toFixed(2)),
      sma50_slope_10d_pct: Number(s50Slope.toFixed(2)),
      peak_120d: Number(peak.toFixed(2)),
      drawdown_from_peak_pct: Number(drawdown.toFixed(2)),
      dist_from_20sma_pct: Number(dist20.toFixed(2)),
      dist_from_50sma_pct: Number(dist50.toFixed(2)),
      trend_intact: trendIntact,
      structure_messy: messy,
    },
    leaders: {
      breadth_above_20sma_pct: Number((breadth * 100).toFixed(1)),
      detail: validLeaders.map((l) => ({
        ticker: l.ticker,
        last: Number(l.last.toFixed(2)),
        sma20: Number(l.sma20.toFixed(2)),
        above: l.above,
      })),
    },
    computed_at: new Date().toISOString(),
  };
}
