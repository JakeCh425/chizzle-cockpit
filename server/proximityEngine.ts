// ─── Proximity Engine ──────────────────────────────────────────────────────
// Scans a universe of ETFs/stocks and classifies each ticker's proximity to a
// Chizzle-valid swing entry. Emits a staged pipeline:
//   REACHING  — trending toward the setup zone, not yet in range
//   TOUCHING  — inside the 20-SMA pullback band (-3% to +1%) but structure/RR unconfirmed
//   READY     — inside the band AND all Chizzle filters pass — click to auto-fill PLAN
//   REJECTED  — hard filter failure (regime-red level, sub-200SMA, broken trend, etc.)
//
// This is meant to be pinned at the top of the cockpit. The frontend fades
// REJECTED items after showing them briefly.

import { safeHistory, type DailyBar } from "./marketData";

const DEFAULT_UNIVERSE = [
  "SMH", "QQQ", "SPY", "XLK", "SOXX",
  "NVDA", "AMD", "AAPL", "MSFT", "META", "GOOGL", "AVGO", "TSM", "MU", "AMAT",
  "XLF", "XLE", "XLV", "XLI", "XLP",
];

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeAtr(bars: DailyBar[], period: number): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = bars.length - period; i < bars.length; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    if (!b || !prev) continue;
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    );
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

export type ProximityStatus = "REACHING" | "TOUCHING" | "READY" | "REJECTED";

export interface ProximityCandidate {
  ticker: string;
  status: ProximityStatus;
  last: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr14: number | null;
  distance_from_sma20_pct: number | null;
  in_band: boolean;              // -3% to +1% of 20-SMA
  above_50sma: boolean;
  above_200sma: boolean;
  suggested_entry: number | null;
  suggested_stop: number | null;
  suggested_t1: number | null;
  suggested_t2: number | null;
  suggested_rr: number | null;
  reason: string;
  computed_at: string;
}

export interface ProximityScan {
  universe_size: number;
  candidates: ProximityCandidate[];
  computed_at: string;
}

/**
 * Classify a single ticker against Chizzle proximity rules.
 * All soft/hard failures are captured in `reason` — never throws.
 */
async function classifyOne(symbol: string, computedAt: string): Promise<ProximityCandidate> {
  const base: ProximityCandidate = {
    ticker: symbol,
    status: "REJECTED",
    last: null,
    sma20: null,
    sma50: null,
    sma200: null,
    atr14: null,
    distance_from_sma20_pct: null,
    in_band: false,
    above_50sma: false,
    above_200sma: false,
    suggested_entry: null,
    suggested_stop: null,
    suggested_t1: null,
    suggested_t2: null,
    suggested_rr: null,
    reason: "No data",
    computed_at: computedAt,
  };

  let bars: DailyBar[] = [];
  try {
    bars = await safeHistory(symbol);
  } catch {
    return { ...base, reason: "history fetch failed" };
  }
  if (!bars || bars.length < 50) {
    return { ...base, reason: "insufficient history" };
  }

  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const atr14 = computeAtr(bars, 14);

  if (last == null || s20 == null || s50 == null) {
    return { ...base, last, sma20: s20, sma50: s50, sma200: s200, reason: "SMA insufficient" };
  }

  const dist20 = ((last - s20) / s20) * 100;
  const above50 = last > s50;
  const above200 = s200 != null ? last > s200 : true; // give benefit of doubt when 200-SMA missing

  // Chizzle pullback band: -3% (below) to +1% (above) of 20-SMA
  const inBand = dist20 >= -3 && dist20 <= 1;

  // Suggested trade parameters: entry at 20-SMA, stop = 20-SMA - 1.5*ATR, T1 = entry + 3*ATR, T2 = entry + 5*ATR
  const suggestedEntry = s20;
  const suggestedStop = atr14 != null ? Number((s20 - 1.5 * atr14).toFixed(2)) : null;
  const suggestedT1 = atr14 != null ? Number((s20 + 3 * atr14).toFixed(2)) : null;
  const suggestedT2 = atr14 != null ? Number((s20 + 5 * atr14).toFixed(2)) : null;
  const suggestedRr =
    suggestedStop != null && suggestedT1 != null && suggestedEntry > suggestedStop
      ? Number(((suggestedT1 - suggestedEntry) / (suggestedEntry - suggestedStop)).toFixed(2))
      : null;

  const result: ProximityCandidate = {
    ...base,
    last: Number(last.toFixed(2)),
    sma20: Number(s20.toFixed(2)),
    sma50: Number(s50.toFixed(2)),
    sma200: s200 != null ? Number(s200.toFixed(2)) : null,
    atr14: atr14 != null ? Number(atr14.toFixed(2)) : null,
    distance_from_sma20_pct: Number(dist20.toFixed(2)),
    in_band: inBand,
    above_50sma: above50,
    above_200sma: above200,
    suggested_entry: Number(suggestedEntry.toFixed(2)),
    suggested_stop: suggestedStop,
    suggested_t1: suggestedT1,
    suggested_t2: suggestedT2,
    suggested_rr: suggestedRr,
    reason: "",
    status: "REJECTED",
  };

  // ── Classification cascade ────────────────────────────────────────────────
  // Hard rejects first (never fadable to READY):
  if (!above200 && s200 != null) {
    return { ...result, status: "REJECTED", reason: "Below 200-SMA — no trade" };
  }
  if (dist20 < -8) {
    return { ...result, status: "REJECTED", reason: "Deep pullback (>8% below 20-SMA)" };
  }
  if (dist20 > 6) {
    return { ...result, status: "REJECTED", reason: "Extended (>6% above 20-SMA) — wait for pullback" };
  }
  if (!above50) {
    // Not a hard reject if only slightly below 50-SMA and reclaiming — but still not ready.
    return { ...result, status: "REJECTED", reason: `Below 50-SMA (${s50.toFixed(2)}) — trend broken` };
  }

  // R:R gate on suggested params
  const rrOk = suggestedRr != null && suggestedRr >= 2;

  if (inBand && rrOk) {
    return {
      ...result,
      status: "READY",
      reason: `In pullback band (${dist20.toFixed(1)}%), R:R ${suggestedRr!.toFixed(2)}:1 — click to plan`,
    };
  }
  if (inBand && !rrOk) {
    return {
      ...result,
      status: "TOUCHING",
      reason: `In band (${dist20.toFixed(1)}%) but R:R ${suggestedRr?.toFixed(2) ?? "n/a"}:1 < 2:1 floor`,
    };
  }

  // Not in band yet — approaching from either side
  const distanceToBand = dist20 < -3 ? Math.abs(-3 - dist20) : dist20 > 1 ? dist20 - 1 : 0;
  return {
    ...result,
    status: "REACHING",
    reason: `${dist20 > 0 ? "Above" : "Below"} 20-SMA by ${Math.abs(dist20).toFixed(1)}% — ${distanceToBand.toFixed(1)}% from band`,
  };
}

/**
 * Run a proximity scan across the universe.
 * Returns candidates sorted by status priority (READY → TOUCHING → REACHING → REJECTED)
 * then by |distance_from_sma20_pct| ascending within each group.
 */
export async function scanProximity(universe?: string[]): Promise<ProximityScan> {
  const symbols = (universe && universe.length > 0 ? universe : DEFAULT_UNIVERSE).map((s) =>
    s.toUpperCase().trim(),
  );
  const computedAt = new Date().toISOString();

  const results = await Promise.all(symbols.map((s) => classifyOne(s, computedAt).catch(() => ({
    ticker: s,
    status: "REJECTED" as ProximityStatus,
    last: null, sma20: null, sma50: null, sma200: null, atr14: null,
    distance_from_sma20_pct: null, in_band: false, above_50sma: false, above_200sma: false,
    suggested_entry: null, suggested_stop: null, suggested_t1: null, suggested_t2: null, suggested_rr: null,
    reason: "classify failed",
    computed_at: computedAt,
  }))));

  const priority: Record<ProximityStatus, number> = {
    READY: 0,
    TOUCHING: 1,
    REACHING: 2,
    REJECTED: 3,
  };
  results.sort((a, b) => {
    const p = priority[a.status] - priority[b.status];
    if (p !== 0) return p;
    const da = a.distance_from_sma20_pct == null ? 99 : Math.abs(a.distance_from_sma20_pct);
    const db = b.distance_from_sma20_pct == null ? 99 : Math.abs(b.distance_from_sma20_pct);
    return da - db;
  });

  return {
    universe_size: symbols.length,
    candidates: results,
    computed_at: computedAt,
  };
}
