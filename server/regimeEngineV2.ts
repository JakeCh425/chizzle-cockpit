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

export interface RegimeV2Snapshot {
  day_class: RegimeV2Class;
  reason: string;
  vix: {
    last: number | null;
    band: "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
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

export async function computeRegimeV2(
  universe: string[] = DEFAULT_UNIVERSE,
): Promise<RegimeV2Snapshot> {
  // ── VIX ──
  let vixLast: number | null = null;
  try {
    const vixBars = await safeHistory("^VIX").catch(() => [] as DailyBar[]);
    if (vixBars.length > 0) vixLast = vixBars[vixBars.length - 1].close;
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
    vix: { last: vixLast, band: vixBand },
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
