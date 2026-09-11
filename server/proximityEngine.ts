// ─── Proximity Engine v3 ──────────────────────────────────────────────────
// Risk-profile aware swing scanner. Every ticker gets:
//   - status: REACHING | TOUCHING | READY | REJECTED
//   - setup_grade: A+ | A | B | C | NO-TRADE  (structural quality)
//   - structure_score: 0-100  (how many pillars are met)
//   - distance_to_ready: pct-of-price to fully qualify at current profile
//   - next_action: one-line operator instruction (never "Unknown")
//
// Three built-in risk profiles + custom lever overrides:
//   low     → strict Chizzle trend rules, R:R ≥ 3, band -2%..+0.5%, above-50-SMA
//   medium  → default Chizzle, R:R ≥ 2, band -3%..+1%, above-50-SMA
//   high    → practice: sub-50-SMA allowed if R:R ≥ 2.5, band -6%..+3%
//
// Setup grading (independent of profile):
//   A+ = in-band + R:R ≥ 3 + above 50 + above 200 + reclaim/momentum bar
//   A  = in-band + R:R ≥ 2 + above 50 + above 200
//   B  = touching (in-band, R:R short) OR reaching-close
//   C  = reaching (out of band but trend intact)
//   NO-TRADE = hard rejects at current profile

import { safeHistory, type DailyBar } from "./marketData";
import { storage } from "./storage";

const FALLBACK_UNIVERSE = ["QQQ", "SMH", "SPY"];

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
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
}

export type ProximityStatus = "REACHING" | "TOUCHING" | "READY" | "REJECTED";
export type SetupGrade = "A+" | "A" | "B" | "C" | "NO-TRADE";
export type RiskProfile = "low" | "medium" | "high";

export interface ProximityCandidate {
  ticker: string;
  status: ProximityStatus;
  setup_grade: SetupGrade;
  structure_score: number;              // 0..100
  distance_to_ready_pct: number | null; // % of price move needed to become READY
  next_action: string;                   // "Wait for close above 445" etc — never Unknown
  last: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr14: number | null;
  distance_from_sma20_pct: number | null;
  in_band: boolean;
  above_50sma: boolean;
  above_200sma: boolean;
  suggested_entry: number | null;
  suggested_stop: number | null;
  suggested_t1: number | null;
  suggested_t2: number | null;
  suggested_rr: number | null;
  reason: string;
  computed_at: string;
  // ── Structure pillars (each true/false so UI can render checkmarks)
  pillars: {
    above_20sma: boolean;
    above_50sma: boolean;
    above_200sma: boolean;
    in_band: boolean;
    rr_ok: boolean;
    volume_ok: boolean;
    momentum_bar: boolean; // last close > prev close by > 0.3% (fresh buy pressure)
  };
}

export interface ScanLevers {
  band_low: number;      // e.g. -3
  band_high: number;     // e.g. 1
  min_rr: number;        // e.g. 2
  extended_ceiling: number; // reject above +X%
  deep_pullback_floor: number; // reject below -X%
  require_above_50sma: boolean;
  require_above_200sma: boolean;
}

export interface ProximityScan {
  universe_size: number;
  candidates: ProximityCandidate[];
  computed_at: string;
  risk_profile: RiskProfile | "custom";
  levers: ScanLevers;
}

// Default lever presets. Every profile also carries a stated intent.
export const RISK_PRESETS: Record<RiskProfile, ScanLevers> = {
  low: {
    band_low: -2, band_high: 0.5,
    min_rr: 3,
    extended_ceiling: 4,
    deep_pullback_floor: -6,
    require_above_50sma: true,
    require_above_200sma: true,
  },
  medium: {
    band_low: -3, band_high: 1,
    min_rr: 2,
    extended_ceiling: 6,
    deep_pullback_floor: -8,
    require_above_50sma: true,
    require_above_200sma: true,
  },
  high: {
    band_low: -6, band_high: 3,
    min_rr: 2.5,
    extended_ceiling: 10,
    deep_pullback_floor: -12,
    require_above_50sma: false,   // sub-50-SMA setups allowed
    require_above_200sma: true,   // still respect the long-term line
  },
};

function emptyCandidate(symbol: string, computedAt: string): ProximityCandidate {
  return {
    ticker: symbol,
    status: "REJECTED",
    setup_grade: "NO-TRADE",
    structure_score: 0,
    distance_to_ready_pct: null,
    next_action: "No data",
    last: null, sma20: null, sma50: null, sma200: null, atr14: null,
    distance_from_sma20_pct: null,
    in_band: false, above_50sma: false, above_200sma: false,
    suggested_entry: null, suggested_stop: null,
    suggested_t1: null, suggested_t2: null, suggested_rr: null,
    reason: "No data",
    computed_at: computedAt,
    pillars: {
      above_20sma: false, above_50sma: false, above_200sma: false,
      in_band: false, rr_ok: false, volume_ok: false, momentum_bar: false,
    },
  };
}

async function classifyOne(
  symbol: string,
  computedAt: string,
  levers: ScanLevers,
): Promise<ProximityCandidate> {
  const base = emptyCandidate(symbol, computedAt);

  let bars: DailyBar[] = [];
  try {
    bars = await safeHistory(symbol);
  } catch {
    return { ...base, reason: `Data unavailable — Yahoo+Tiingo both failed. Rescan in 2min or remove ${symbol}.`, next_action: `Rescan or remove ${symbol}` };
  }
  if (!bars || bars.length === 0) {
    return { ...base, reason: `No bars for ${symbol}. Verify US exchange listing.`, next_action: `Verify ticker or remove ${symbol}` };
  }
  if (bars.length < 20) {
    return { ...base, reason: `Only ${bars.length} bars — need ≥20. New listing.`, next_action: `Wait for ${20 - bars.length} more sessions` };
  }

  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2] ?? last;
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const atr14 = computeAtr(bars, 14);

  if (last == null || s20 == null) {
    return {
      ...base,
      last, sma20: s20, sma50: s50, sma200: s200,
      reason: `Missing 20-SMA (bars=${bars.length}).`,
      next_action: `Wait for more history or drop ${symbol}`,
    };
  }

  const dist20 = ((last - s20) / s20) * 100;
  // Missing longer SMAs → treat as neutral (don't silently drop the ticker).
  const above50 = s50 != null ? last > s50 : true;
  const above200 = s200 != null ? last > s200 : true;
  const above20 = last > s20;
  const inBand = dist20 >= levers.band_low && dist20 <= levers.band_high;

  // Volume proxy: today's volume >= 20-day avg volume
  const vols = bars.map((b) => b.volume || 0);
  const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volOk = (bars[bars.length - 1].volume || 0) >= avgVol20 * 0.9;
  // Momentum bar: last close > prev close by ≥ 0.3%
  const momentumBar = last > prev * 1.003;

  // Trade parameters. Fallback to 2%-of-price ATR when ATR missing.
  const atrForStop = atr14 != null ? atr14 : s20 * 0.02;
  const suggestedEntry = s20;
  const suggestedStop = Number((s20 - 1.5 * atrForStop).toFixed(2));
  // Structural T1: highest high in last 40 bars. Fallback: entry + 4×ATR.
  const lookback = Math.min(40, bars.length);
  const recentHigh = Math.max(...bars.slice(-lookback).map((b) => b.high));
  const t1 = recentHigh > suggestedEntry ? recentHigh : suggestedEntry + 4 * atrForStop;
  const suggestedT1 = Number(t1.toFixed(2));
  const suggestedT2 = Number((t1 + (t1 - suggestedEntry)).toFixed(2));
  const suggestedRr =
    suggestedEntry > suggestedStop && suggestedT1 > suggestedEntry
      ? Number(((suggestedT1 - suggestedEntry) / (suggestedEntry - suggestedStop)).toFixed(2))
      : null;
  const rr = suggestedRr ?? 0;
  const rrOk = rr >= levers.min_rr;

  const pillars = {
    above_20sma: above20,
    above_50sma: above50,
    above_200sma: above200,
    in_band: inBand,
    rr_ok: rrOk,
    volume_ok: volOk,
    momentum_bar: momentumBar,
  };
  const pillarCount = Object.values(pillars).filter(Boolean).length;
  const structureScore = Math.round((pillarCount / 7) * 100);

  // Distance to READY: how far (%) price must move to be in-band + rr_ok.
  // If already qualifying, 0. If out of band, distance to nearest band edge.
  let distanceToReady: number | null = null;
  if (inBand && rrOk) distanceToReady = 0;
  else if (!inBand) {
    if (dist20 < levers.band_low) distanceToReady = Math.abs(levers.band_low - dist20);
    else if (dist20 > levers.band_high) distanceToReady = dist20 - levers.band_high;
  } else distanceToReady = 0;

  // Setup grade — structural quality independent of profile.
  const grade: SetupGrade =
    inBand && rr >= 3 && above50 && above200 && momentumBar ? "A+"
    : inBand && rr >= 2 && above50 && above200 ? "A"
    : inBand ? "B"
    : distanceToReady != null && distanceToReady <= 2 && above50 && above200 ? "B"
    : above50 && above200 ? "C"
    : "NO-TRADE";

  const partial: ProximityCandidate = {
    ...base,
    last: Number(last.toFixed(2)),
    sma20: Number(s20.toFixed(2)),
    sma50: s50 != null ? Number(s50.toFixed(2)) : null,
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
    structure_score: structureScore,
    distance_to_ready_pct: distanceToReady != null ? Number(distanceToReady.toFixed(2)) : null,
    setup_grade: grade,
    pillars,
    reason: "",
    next_action: "",
    status: "REJECTED",
  };

  // ── Cascade ────────────────────────────────────────────────────────────
  if (dist20 < levers.deep_pullback_floor) {
    return { ...partial, status: "REJECTED", setup_grade: "NO-TRADE",
      reason: `Deep pullback (${dist20.toFixed(1)}% < ${levers.deep_pullback_floor}%).`,
      next_action: `Wait for base + reclaim of 20-SMA at ${s20.toFixed(2)}` };
  }
  if (dist20 > levers.extended_ceiling) {
    return { ...partial, status: "REJECTED", setup_grade: "NO-TRADE",
      reason: `Extended (+${dist20.toFixed(1)}% > +${levers.extended_ceiling}%).`,
      next_action: `Wait for pullback to 20-SMA near ${s20.toFixed(2)}` };
  }
  if (levers.require_above_200sma && !above200 && s200 != null) {
    return { ...partial, status: "REJECTED", setup_grade: "NO-TRADE",
      reason: `Below 200-SMA (${s200.toFixed(2)}) — no trade at this profile.`,
      next_action: `Switch to Higher-risk profile or wait for reclaim of ${s200.toFixed(2)}` };
  }
  if (levers.require_above_50sma && !above50 && s50 != null) {
    return { ...partial, status: "REJECTED", setup_grade: "NO-TRADE",
      reason: `Below 50-SMA (${s50.toFixed(2)}) — trend broken at this profile.`,
      next_action: `Switch to Higher-risk profile or wait for reclaim of ${s50.toFixed(2)}` };
  }

  if (inBand && rrOk) {
    return { ...partial, status: "READY",
      reason: `${grade} setup: in band (${dist20.toFixed(1)}%), R:R ${rr.toFixed(2)}:1${!above50 ? " · sub-50-SMA" : ""}.`,
      next_action: `Enter at ${suggestedEntry.toFixed(2)} · stop ${suggestedStop.toFixed(2)} · T1 ${suggestedT1.toFixed(2)}` };
  }
  if (inBand && !rrOk) {
    return { ...partial, status: "TOUCHING",
      reason: `In band (${dist20.toFixed(1)}%) but R:R ${rr.toFixed(2)}:1 < ${levers.min_rr}:1.`,
      next_action: `Tighten stop or wait — need R:R ≥ ${levers.min_rr}:1` };
  }
  const distToBand = dist20 < levers.band_low
    ? Math.abs(levers.band_low - dist20)
    : dist20 > levers.band_high ? dist20 - levers.band_high : 0;
  return { ...partial, status: "REACHING",
    reason: `${dist20 > 0 ? "Above" : "Below"} 20-SMA by ${Math.abs(dist20).toFixed(1)}%, ${distToBand.toFixed(1)}% from band.`,
    next_action: dist20 > 0
      ? `Wait for pullback to ${(s20 * (1 + levers.band_high / 100)).toFixed(2)}`
      : `Watch for reclaim of ${(s20 * (1 + levers.band_low / 100)).toFixed(2)}` };
}

export async function scanProximity(
  universe?: string[],
  profile: RiskProfile | "custom" = "medium",
  customLevers?: Partial<ScanLevers>,
): Promise<ProximityScan> {
  const levers: ScanLevers =
    profile === "custom"
      ? { ...RISK_PRESETS.medium, ...(customLevers || {}) }
      : { ...RISK_PRESETS[profile] };

  let symbols: string[];
  if (universe && universe.length > 0) {
    symbols = universe.map((s) => s.toUpperCase().trim()).filter(Boolean);
  } else {
    try {
      const rows = await storage.listProximityScanTickers();
      symbols = rows.map((r) => r.ticker.toUpperCase());
    } catch {
      symbols = [];
    }
    if (symbols.length === 0) symbols = FALLBACK_UNIVERSE.slice();
  }
  const computedAt = new Date().toISOString();

  const results = await Promise.all(symbols.map((s) =>
    classifyOne(s, computedAt, levers).catch((err: any) => ({
      ...emptyCandidate(s, computedAt),
      reason: `Classify failed: ${(err?.message || String(err)).slice(0, 80)}`,
      next_action: `Rescan or remove ${s}`,
    })),
  ));

  const priority: Record<ProximityStatus, number> = { READY: 0, TOUCHING: 1, REACHING: 2, REJECTED: 3 };
  results.sort((a, b) => {
    const p = priority[a.status] - priority[b.status];
    if (p !== 0) return p;
    // Within status, sort by setup grade then structure score desc
    const gradeRank: Record<SetupGrade, number> = { "A+": 0, "A": 1, "B": 2, "C": 3, "NO-TRADE": 4 };
    const g = gradeRank[a.setup_grade] - gradeRank[b.setup_grade];
    if (g !== 0) return g;
    return b.structure_score - a.structure_score;
  });

  let dismissedSet = new Set<string>();
  try {
    await storage.syncProximityDismissals(results.map((r) => ({ ticker: r.ticker, status: r.status })));
    const all = await storage.listProximityUniverse({ includeDismissed: true });
    dismissedSet = new Set(all.filter((r) => r.status === "dismissed").map((r) => r.ticker));
  } catch { /* best-effort */ }

  const visible = results.filter((r) => !dismissedSet.has(r.ticker));

  return {
    universe_size: symbols.length,
    candidates: visible,
    computed_at: computedAt,
    risk_profile: profile,
    levers,
  };
}
