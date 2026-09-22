// ─── Regime Engine v2 (Chizzle spec 2026-08-11) ────────────────────────────
// Classifies the market into GREEN / YELLOW / RED using three live inputs:
//   1. VIX (via ^VIX daily close from cached history)
//   2. Breadth (% of a symbol universe currently above its own 20-SMA)
//   3. Distribution days (SPY count of days closing < -1% on rising volume
//      within the last 25 sessions — classic O'Neil-style measure)
//
// Rules (from the spec, verbatim):
//   GREEN  = VIX < 22  AND breadth >= 55%  AND distribution <= 4
//   YELLOW = VIX 22-26 AND breadth >= 50%  AND distribution <= 6
//   RED    = VIX > 26  OR  breadth < 45%   OR  distribution >= 8
//
// Missing data (fetch failure, insufficient bars) resolves to "Unknown" for
// that dimension per the cockpit style rules — the engine never throws.

import { safeHistory, type DailyBar } from "./marketData";

export type RegimeV2Class = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

// Volatility Climate (Phase 4) — display-only fields describing how the VIX
// is BEHAVING today, independent of the regime-combine band. These do NOT
// participate in the regime traffic light; the existing `band` field still
// drives day_class. New fields, not replacements.
export type VixLevel = "calm" | "normal" | "caution" | "high" | "stress" | "unknown";
export type VixTrend = "falling" | "stable" | "rising" | "rising_fast" | "unknown";
export type VixRiskEffect =
  | "supportive"
  | "monitor"
  | "reduce_risk"
  | "defensive"
  | "unknown";

export interface RegimeV2Snapshot {
  day_class: RegimeV2Class;
  reason: string;
  vix: {
    last: number | null;
    /**
     * Regime-combine band. UNCHANGED behavior — still drives day_class.
     * Do NOT color the volatility tile with this field; use `level` + `trend`.
     */
    band: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
    // Phase 4 display fields — all optional, never affect day_class.
    change?: number | null;
    changePct?: number | null;
    prevClose?: number | null;
    trend5d?: VixTrend;
    /** 5-tier volatility state per spec; display-only. */
    level?: VixLevel;
    /** Risk-posture hint derived from level + trend; display-only. */
    riskEffect?: VixRiskEffect;
    /** 20-day simple average of ^VIX close when history allows. */
    avg20d?: number | null;
    /** ISO timestamp of the daily bar `last` was read from. */
    ts?: string | null;
  };
  breadth: {
    pct_above_20sma: number | null;
    universe_size: number;
    band: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  };
  distribution: {
    days_last_25: number | null;
    band: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
  };
  detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }>;
  computed_at: string;
}

const DEFAULT_UNIVERSE = ["SMH", "QQQ", "SPY", "XLK", "SOXX"];

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

// Distribution day = SPY closes down >= 1.0% on higher volume than prior day.
function countDistributionDays(bars: DailyBar[], windowN = 25): number {
  if (bars.length < windowN + 1) return 0;
  const slice = bars.slice(-windowN - 1);
  let count = 0;
  for (let i = 1; i < slice.length; i++) {
    const prev = slice[i - 1];
    const cur = slice[i];
    const pctChg = ((cur.close - prev.close) / prev.close) * 100;
    if (pctChg <= -1.0 && cur.volume > prev.volume) count++;
  }
  return count;
}

function classifyVix(v: number | null): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  if (v == null || !Number.isFinite(v)) return "UNKNOWN";
  if (v < 22) return "GREEN";
  if (v <= 26) return "YELLOW";
  return "RED";
}

function classifyBreadth(pct: number | null): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  if (pct == null || !Number.isFinite(pct)) return "UNKNOWN";
  if (pct >= 55) return "GREEN";
  if (pct >= 50) return "YELLOW";
  if (pct >= 45) return "YELLOW"; // 45–50 still allowed as YELLOW per spec
  return "RED";
}

function classifyDistribution(days: number | null): "GREEN" | "YELLOW" | "RED" | "UNKNOWN" {
  if (days == null || !Number.isFinite(days)) return "UNKNOWN";
  if (days <= 4) return "GREEN";
  if (days <= 6) return "YELLOW";
  return "RED"; // >= 8 or in the 7 grey zone leans YELLOW; strict spec: >=8 RED
}

// ── Volatility Climate helpers (Phase 4 — display-only) ──────────────────
// These classifications live ALONGSIDE the regime-combine `band`. They are
// consumed only by the VIX tile in the UI. Do not read them from the regime
// combine math — the traffic light is intentionally unchanged in PR 1.
export function classifyVixLevel(v: number | null): VixLevel {
  if (v == null || !Number.isFinite(v)) return "unknown";
  if (v < 15) return "calm";
  if (v <= 20) return "normal";
  if (v <= 25) return "caution";
  if (v <= 30) return "high";
  return "stress";
}

/** Classify 5-day direction from a slice of daily closes ending today.
 * `closes` should be ordered oldest→newest and include at least 2 points. */
export function classifyVixTrend(closes: number[]): VixTrend {
  if (!closes || closes.length < 2) return "unknown";
  const last = closes[closes.length - 1];
  const first = closes[closes.length - Math.min(closes.length, 5)];
  if (!Number.isFinite(last) || !Number.isFinite(first) || first === 0) return "unknown";
  const chgPct = ((last - first) / first) * 100;
  // Same-day pop check for "rising_fast": >15% single-day jump on top of
  // an overall 5-day rise is a stress signal even at moderate absolute levels.
  const prev = closes[closes.length - 2];
  const dayPct = prev && prev !== 0 ? ((last - prev) / prev) * 100 : 0;
  if (chgPct >= 15 || dayPct >= 15) return "rising_fast";
  if (chgPct >= 5) return "rising";
  if (chgPct <= -5) return "falling";
  return "stable";
}

/** Combine level + trend into a risk-posture hint. Display-only. */
export function deriveVixRiskEffect(level: VixLevel, trend: VixTrend): VixRiskEffect {
  if (level === "unknown") return "unknown";
  if (level === "stress") return "defensive";
  if (level === "high") return trend === "falling" ? "reduce_risk" : "defensive";
  if (level === "caution") return trend === "rising_fast" ? "reduce_risk" : "monitor";
  if (level === "normal") return trend === "rising_fast" ? "monitor" : "supportive";
  // calm
  return trend === "rising_fast" ? "monitor" : "supportive";
}

export async function computeRegimeV2(
  universe: string[] = DEFAULT_UNIVERSE,
): Promise<RegimeV2Snapshot> {
  // ── VIX ──
  let vixLast: number | null = null;
  // Phase 4 additions — display-only. All optional; no fallback fabrication.
  let vixPrev: number | null = null;
  let vixChange: number | null = null;
  let vixChangePct: number | null = null;
  let vixTrend: VixTrend = "unknown";
  let vixLevel: VixLevel = "unknown";
  let vixRiskEffect: VixRiskEffect = "unknown";
  let vixAvg20: number | null = null;
  let vixTs: string | null = null;
  try {
    const vixBars = await safeHistory("^VIX").catch(() => [] as DailyBar[]);
    if (vixBars.length > 0) {
      const lastBar = vixBars[vixBars.length - 1];
      vixLast = lastBar.close;
      // DailyBar `date` is expected to be YYYY-MM-DD or ISO; keep whatever we get.
      vixTs = (lastBar as any).date ?? (lastBar as any).time ?? null;
    }
    if (vixBars.length >= 2) {
      vixPrev = vixBars[vixBars.length - 2].close;
      if (vixLast != null && vixPrev != null && vixPrev !== 0) {
        vixChange = vixLast - vixPrev;
        vixChangePct = (vixChange / vixPrev) * 100;
      }
    }
    if (vixBars.length >= 2) {
      const closes = vixBars.map((b) => b.close);
      vixTrend = classifyVixTrend(closes.slice(-6)); // last 5 sessions + today
    }
    if (vixBars.length >= 20) {
      const slice = vixBars.slice(-20).map((b) => b.close);
      vixAvg20 = slice.reduce((a, b) => a + b, 0) / slice.length;
    }
    vixLevel = classifyVixLevel(vixLast);
    vixRiskEffect = deriveVixRiskEffect(vixLevel, vixTrend);
  } catch {
    vixLast = null;
  }
  const vixBand = classifyVix(vixLast);

  // ── Breadth over universe ──
  const detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }> = [];
  for (const sym of universe) {
    try {
      const bars = await safeHistory(sym);
      if (!bars || bars.length < 21) continue;
      const closes = bars.map((b) => b.close);
      const s20 = sma(closes, 20);
      if (s20 == null) continue;
      const last = closes[closes.length - 1];
      detail.push({ ticker: sym, last, sma20: s20, above: last > s20 });
    } catch {
      // Missing symbol just drops out of the breadth calc
    }
  }
  const breadthPct = detail.length > 0
    ? (detail.filter((d) => d.above).length / detail.length) * 100
    : null;
  const breadthBand = classifyBreadth(breadthPct);

  // ── Distribution days on SPY ──
  let distDays: number | null = null;
  try {
    const spyBars = await safeHistory("SPY");
    if (spyBars.length >= 26) distDays = countDistributionDays(spyBars, 25);
  } catch {
    distDays = null;
  }
  const distBand = classifyDistribution(distDays);

  // ── Combine into overall day class (RED wins if any dimension is RED) ──
  const bands = [vixBand, breadthBand, distBand];
  let day_class: RegimeV2Class;
  let reason: string;
  if (bands.includes("RED")) {
    day_class = "RED";
    const which: string[] = [];
    if (vixBand === "RED") which.push(`VIX ${vixLast?.toFixed(2)} > 26`);
    if (breadthBand === "RED") which.push(`breadth ${breadthPct?.toFixed(0)}% < 45%`);
    if (distBand === "RED") which.push(`distribution ${distDays} days ≥ 7 in last 25`);
    reason = `RED — ${which.join("; ")} — block new trades.`;
  } else if (bands.every((b) => b === "GREEN")) {
    day_class = "GREEN";
    reason = `GREEN — VIX ${vixLast?.toFixed(2)}, breadth ${breadthPct?.toFixed(0)}%, distribution ${distDays} — full trend alignment.`;
  } else if (bands.every((b) => b === "GREEN" || b === "YELLOW")) {
    day_class = "YELLOW";
    reason = `YELLOW — mixed conditions, VIX ${vixLast?.toFixed(2)}, breadth ${breadthPct?.toFixed(0)}%, distribution ${distDays}.`;
  } else {
    day_class = "UNKNOWN";
    reason = `UNKNOWN — one or more inputs unavailable (VIX ${vixBand}, breadth ${breadthBand}, dist ${distBand}).`;
  }

  return {
    day_class,
    reason,
    vix: {
      last: vixLast,
      band: vixBand,
      // Phase 4 display fields — do NOT feed into the regime combine.
      change: vixChange != null ? Number(vixChange.toFixed(2)) : null,
      changePct: vixChangePct != null ? Number(vixChangePct.toFixed(2)) : null,
      prevClose: vixPrev != null ? Number(vixPrev.toFixed(2)) : null,
      trend5d: vixTrend,
      level: vixLevel,
      riskEffect: vixRiskEffect,
      avg20d: vixAvg20 != null ? Number(vixAvg20.toFixed(2)) : null,
      ts: vixTs,
    },
    breadth: {
      pct_above_20sma: breadthPct != null ? Number(breadthPct.toFixed(1)) : null,
      universe_size: detail.length,
      band: breadthBand,
    },
    distribution: { days_last_25: distDays, band: distBand },
    detail: detail.map((d) => ({
      ticker: d.ticker,
      last: Number(d.last.toFixed(2)),
      sma20: Number(d.sma20.toFixed(2)),
      above: d.above,
    })),
    computed_at: new Date().toISOString(),
  };
}
