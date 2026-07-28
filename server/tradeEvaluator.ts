// ─── Chizzle Wealth Trade Evaluator ─────────────────────────────────────────
// Implements the tiered evaluator the user defined in their thread:
//
//   Stage 1 – STANDARD_SWING_APPROVED  (strict 20-SMA pullback rules)
//   Stage 2 – FLEX_SWING_APPROVED      (up to 3.5% above SMA + strong fundies)
//   Else    – PRACTICE_CARD            (interesting but not pro-grade)
//   Else    – NO_TRADE                 (extended / chase / weak R:R)
//
// Inputs come from the cockpit's manual trade-check form. We pull daily OHLC
// from priceService for the 20-SMA + structure read, and use the live snapshot
// for the current price. Fundamentals/theme are scored heuristically from the
// last ~60 daily bars (trend + relative-strength) plus a small per-ticker map
// for known semis/AI/megacap themes. This keeps the evaluator self-contained —
// no extra connector calls per request, so it stays under 1s.

import { fetchTwelveDataDailyOHLC, snapshot as priceSnapshot } from "./priceService";

export type TradeStatus =
  | "STANDARD_SWING_APPROVED"
  | "FLEX_SWING_APPROVED"
  | "PRACTICE_CARD"
  | "NO_TRADE";

export interface TradeCheckInput {
  ticker: string;
  entry: number;
  stop: number;
  t1: number;
  t2?: number | null;
  // Optional human notes — surfaced back in the response unchanged so the
  // user can read them alongside the verdict on screen.
  notes?: string;
}

export interface TradeCheckResult {
  status: TradeStatus;
  setup_type: string;
  regime: "GREEN" | "YELLOW" | "RED" | "MIXED" | "UNKNOWN";
  entry: number;
  stop: number;
  t1: number;
  t2: number | null;
  risk_reward: { t1: number; t2: number | null };
  technical_score: number;     // 0–5
  fundamental_score: number;   // 0–5
  one_sentence_reason: string;
  card_summary_5_lines: string[] | null;
  // Debug breadcrumbs — not part of the user's required schema but useful in
  // the UI for trust / "show your work":
  diagnostics: {
    sma20: number;
    sma50: number | null;
    sma200: number | null;
    above_20sma: boolean;
    above_50sma: boolean;
    above_200sma: boolean;
    distance_from_sma20_pct: number;
    current_price: number;
    near_resistance: boolean;
    nearest_resistance: number | null;
    structure: string;
    standard_failures: string[];
    flex_failures: string[];
    practice_failures: string[];
    technical_breakdown: Record<string, number>;
    fundamental_breakdown: Record<string, number>;
  };
}

// ─── Theme map ──────────────────────────────────────────────────────────────
// User's primary trading universe. Adjust as themes evolve. Score is 0–5
// where 5 means a current dominant tailwind. This is a soft input — combined
// with the price-action trend score so a hot theme can't carry a broken chart.
const THEME_SCORES: Record<string, number> = {
  // Semis / AI infra — primary theme
  SMH: 5, SOXX: 5, NVDA: 5, AMD: 5, AVGO: 5, MU: 4, TSM: 4, ASML: 4,
  // Megacap tech
  QQQ: 4, AAPL: 4, MSFT: 4, META: 4, GOOGL: 4, AMZN: 4,
  // Broad market
  SPY: 3, IWM: 3, DIA: 3,
  // Common single names — neutral by default
};

// ─── Math helpers ───────────────────────────────────────────────────────────

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

// Identify recent swing-high resistance: highest high in last `lookback` bars
// that is above current price. Returns null if price is already above all.
function nearestResistance(highs: number[], current: number, lookback = 30): number | null {
  const recent = highs.slice(-lookback);
  const above = recent.filter((h) => h > current);
  if (above.length === 0) return null;
  return Math.min(...above);
}

// Trend score from EMA-style price action: how strong is the underlying uptrend?
// Returns 0–5.
function trendScore(closes: number[]): number {
  if (closes.length < 50) return 2;
  const last = closes[closes.length - 1];
  const sma20 = sma(closes, 20)!;
  const sma50 = sma(closes, 50)!;
  let score = 0;
  if (last > sma20) score += 1;
  if (sma20 > sma50) score += 1;
  if (last > sma50) score += 1;
  // Slope of 20-SMA over last 5 bars
  const recent20 = sma(closes.slice(-25, -5), 20);
  if (recent20 && sma20 > recent20) score += 1;
  // 30-day return positive
  if (closes.length >= 30 && last > closes[closes.length - 30]) score += 1;
  return Math.min(5, score);
}

// Structure detector: is there a higher low / reclaim / consolidation in the
// last ~10 bars? Returns a label plus a quality score 0–5.
function readStructure(
  closes: number[],
  highs: number[],
  lows: number[],
  entry: number
): { label: string; score: number; isHigherLow: boolean; isReclaim: boolean } {
  if (closes.length < 20) return { label: "insufficient history", score: 0, isHigherLow: false, isReclaim: false };

  const last10Lows = lows.slice(-10);
  const last20Lows = lows.slice(-20, -10);
  const recentLow = Math.min(...last10Lows);
  const olderLow = Math.min(...last20Lows);
  const isHigherLow = recentLow > olderLow;

  const sma20 = sma(closes, 20)!;
  const last5Closes = closes.slice(-5);
  const closedBelowRecently = closes.slice(-10, -5).some((c) => c < sma20);
  const closedAboveNow = last5Closes.filter((c) => c > sma20).length >= 3;
  const isReclaim = closedBelowRecently && closedAboveNow;

  // Tight consolidation: range of last 5 closes < 3% of mean
  const last5Range = Math.max(...last5Closes) - Math.min(...last5Closes);
  const last5Mean = last5Closes.reduce((a, b) => a + b, 0) / 5;
  const isConsolidating = last5Range / last5Mean < 0.03;

  // Breakout-pullback: today below recent high but above 20-SMA
  const last10High = Math.max(...highs.slice(-10));
  const isBreakoutPullback = entry < last10High && entry > sma20 && (last10High - entry) / last10High < 0.04;

  if (isReclaim && isHigherLow) return { label: "Reclaim + higher low", score: 5, isHigherLow, isReclaim };
  if (isReclaim) return { label: "20-SMA reclaim", score: 4, isHigherLow, isReclaim };
  if (isHigherLow && isConsolidating) return { label: "Higher low + consolidation", score: 4, isHigherLow, isReclaim };
  if (isHigherLow) return { label: "Higher low", score: 3, isHigherLow, isReclaim };
  if (isBreakoutPullback) return { label: "Breakout-pullback", score: 4, isHigherLow, isReclaim };
  if (isConsolidating) return { label: "Tight consolidation", score: 3, isHigherLow, isReclaim };
  return { label: "Trend (no clear pullback structure)", score: 2, isHigherLow, isReclaim };
}

// Volume score: is recent volume above the longer-run average?
function volumeScore(volumes: number[]): number {
  if (volumes.length < 30) return 3;
  const last5 = volumes.slice(-5);
  const baseline30 = volumes.slice(-30);
  const avg5 = last5.reduce((a, b) => a + b, 0) / 5;
  const avg30 = baseline30.reduce((a, b) => a + b, 0) / 30;
  if (avg30 === 0) return 3;
  const ratio = avg5 / avg30;
  if (ratio > 1.3) return 5;
  if (ratio > 1.1) return 4;
  if (ratio > 0.9) return 3;
  if (ratio > 0.7) return 2;
  return 1;
}

// Fundamental score proxy: for ETFs we use the underlying theme score + price
// trend stability as a proxy for "fundamentals" since the underlying basket's
// fundamentals are aggregated. For single names this is a lighter heuristic
// — the user can still override via notes / their own research.
function scoreFundamentals(
  ticker: string,
  closes: number[]
): { total: number; breakdown: Record<string, number> } {
  const theme = THEME_SCORES[ticker.toUpperCase()] ?? 3;
  // Trend stability: lower volatility on a strong trend = stronger underlying
  const last60 = closes.slice(-60);
  let revenueProxy = 3, epsProxy = 3, profitabilityProxy = 3, balanceSheetProxy = 3;
  if (last60.length >= 60) {
    const start = last60[0];
    const end = last60[last60.length - 1];
    const sixtyDayReturn = (end - start) / start;
    if (sixtyDayReturn > 0.15) { revenueProxy = 5; epsProxy = 5; }
    else if (sixtyDayReturn > 0.05) { revenueProxy = 4; epsProxy = 4; }
    else if (sixtyDayReturn > -0.05) { revenueProxy = 3; epsProxy = 3; }
    else if (sixtyDayReturn > -0.15) { revenueProxy = 2; epsProxy = 2; }
    else { revenueProxy = 1; epsProxy = 1; }
    // Profitability proxy: smoothness of uptrend (smaller drawdowns)
    const maxDrawdown = computeMaxDrawdown(last60);
    if (maxDrawdown < 0.05) profitabilityProxy = 5;
    else if (maxDrawdown < 0.10) profitabilityProxy = 4;
    else if (maxDrawdown < 0.15) profitabilityProxy = 3;
    else if (maxDrawdown < 0.20) profitabilityProxy = 2;
    else profitabilityProxy = 1;
    // Balance sheet proxy: ETFs assumed healthy; single names get a flat 3
    balanceSheetProxy = THEME_SCORES[ticker.toUpperCase()] !== undefined ? 4 : 3;
  }
  // Compress 5 sub-scores (revenue, EPS, profitability, balance sheet, theme)
  // into a single 0–5 by averaging then rounding.
  const subs = { revenue: revenueProxy, eps: epsProxy, profitability: profitabilityProxy, balance_sheet: balanceSheetProxy, theme };
  const total = Math.round((revenueProxy + epsProxy + profitabilityProxy + balanceSheetProxy + theme) / 5);
  return { total: Math.max(0, Math.min(5, total)), breakdown: subs };
}

function computeMaxDrawdown(closes: number[]): number {
  let peak = closes[0];
  let maxDD = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (peak - c) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ─── Regime read ───────────────────────────────────────────────────────────
// Lightweight read using QQQ + SPY trend. We do NOT call the cockpit's regime
// engine to keep this stateless — that engine reads from the DB and has cron
// dependencies. For evaluator purposes a quick QQQ trend snapshot is enough.
async function readRegime(): Promise<"GREEN" | "YELLOW" | "RED" | "MIXED" | "UNKNOWN"> {
  try {
    const qqq = await fetchTwelveDataDailyOHLC("QQQ");
    const spy = await fetchTwelveDataDailyOHLC("SPY");
    if (!qqq || !spy) return "UNKNOWN";
    const qScore = trendScore(qqq.map((b) => b.close));
    const sScore = trendScore(spy.map((b) => b.close));
    const avg = (qScore + sScore) / 2;
    if (avg >= 4) return "GREEN";
    if (avg >= 2.5) return "YELLOW"; // Yellow is the cockpit's "mixed" — keep both labels usable
    return "RED";
  } catch {
    return "UNKNOWN";
  }
}

// ─── Main evaluator ────────────────────────────────────────────────────────

export async function evaluateTrade(input: TradeCheckInput): Promise<TradeCheckResult> {
  const ticker = input.ticker.trim().toUpperCase();
  const { entry, stop, t1 } = input;
  const t2 = input.t2 ?? null;

  // ── Validate inputs ──
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(t1)) {
    throw new Error("entry, stop, t1 must be numbers");
  }
  if (stop >= entry) throw new Error("stop must be below entry for a long");
  if (t1 <= entry) throw new Error("t1 must be above entry for a long");

  // ── Risk/reward ──
  const risk = entry - stop;
  const rrT1 = (t1 - entry) / risk;
  const rrT2 = t2 != null && t2 > entry ? (t2 - entry) / risk : null;

  // ── Fetch price history ──
  const bars = await fetchTwelveDataDailyOHLC(ticker);
  if (!bars || bars.length < 30) {
    throw new Error(`could not fetch enough daily history for ${ticker}`);
  }
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const sma20 = sma(closes, 20)!;
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const lastClose = closes[closes.length - 1];

  // Use live snapshot if available so distance reflects right-now price
  let currentPrice = lastClose;
  try {
    const snap = priceSnapshot();
    const live = snap?.[ticker];
    const livePrice = live?.last ?? live?.price ?? live?.close;
    if (typeof livePrice === "number" && Number.isFinite(livePrice)) currentPrice = livePrice;
  } catch {
    /* fall back to lastClose */
  }

  const distancePct = ((entry - sma20) / sma20) * 100;

  // ── Chizzle SMA-stack gates (2026-07-28 spec) ──
  // Longs are never allowed below the 200-day SMA. This is a hard reject that
  // supersedes every other classifier below.
  const above200 = sma200 != null && entry > sma200;
  const above50 = sma50 != null && entry > sma50;
  const above20 = entry > sma20;

  // ── Resistance check ──
  const resistance = nearestResistance(highs, entry, 30);
  // "Chasing into resistance" = entry within 1.5% of the nearest higher high
  const nearResistance = resistance != null && (resistance - entry) / entry < 0.015;

  // ── Structure read ──
  const structure = readStructure(closes, highs, lows, entry);

  // ── Component scores ──
  const tTrend = trendScore(closes);
  const tLocation = locationScore(distancePct);
  const tPattern = structure.score;
  const tVolume = volumeScore(volumes);
  const tRR = rrScoreFromRR(rrT1);
  const techTotal = Math.round((tTrend + tLocation + tPattern + tVolume + tRR) / 5);
  const technical_breakdown = { trend: tTrend, location: tLocation, pattern: tPattern, volume: tVolume, reward_risk: tRR };

  const fundies = scoreFundamentals(ticker, closes);

  const regime = await readRegime();

  // ── Stage 1: Standard test ──
  // Standard: above 20/50/200 SMA, near 20-SMA pullback or clean 20-SMA reclaim.
  const standardFailures: string[] = [];
  if (regime === "RED") standardFailures.push(`regime ${regime} (risk-off)`);
  if (!above200) standardFailures.push(`entry below 200-SMA (${sma200?.toFixed(2) ?? "insufficient history"}) — no longs below 200-day`);
  if (!above50) standardFailures.push(`entry below 50-SMA (${sma50?.toFixed(2) ?? "insufficient history"})`);
  if (!above20 && !structure.isReclaim) standardFailures.push(`entry below 20-SMA without a clean reclaim — cannot be standard`);
  if (distancePct < -3 || distancePct > 1.0) standardFailures.push(`entry ${distancePct.toFixed(2)}% from 20-SMA (standard band: -3% to +1%)`);
  if (structure.score < 3) standardFailures.push(`structure too weak: ${structure.label}`);
  if (rrT1 < 2.0) standardFailures.push(`R:R to T1 ${rrT1.toFixed(2)}:1 < 2:1 floor`);
  if (nearResistance) standardFailures.push(`entry within 1.5% of resistance ${resistance!.toFixed(2)}`);

  // ── Stage 2: Flex test ──
  // Flex: must still be above 50-SMA and 200-SMA with pro structure + 2:1 RR.
  const flexFailures: string[] = [];
  if (regime === "RED") flexFailures.push(`regime ${regime} (risk-off)`);
  if (!above200) flexFailures.push(`entry below 200-SMA — no longs below 200-day`);
  if (!above50) flexFailures.push(`entry below 50-SMA — flex requires >50-SMA`);
  if (fundies.total < 4) flexFailures.push(`fundamentals weak (${fundies.total}/5)`);
  if ((THEME_SCORES[ticker] ?? 3) < 4) flexFailures.push(`theme/sector not strong enough`);
  if (structure.score < 3) flexFailures.push(`structure too weak: ${structure.label}`);
  // Flex band: up to 3.5% above SMA, unless reclaim/breakout-pullback
  const isFlexLocationOK =
    distancePct <= 3.5 ||
    structure.isReclaim ||
    structure.label.includes("Breakout-pullback");
  if (!isFlexLocationOK) flexFailures.push(`entry ${distancePct.toFixed(2)}% above 20-SMA exceeds 3.5% flex cap and not a clean reclaim/breakout-pullback`);
  if (rrT1 < 2.0) flexFailures.push(`R:R to T1 ${rrT1.toFixed(2)}:1 < 2:1 floor`);
  if (nearResistance) flexFailures.push(`entry within 1.5% of resistance ${resistance!.toFixed(2)} — chase`);

  // ── Stage 3: Practice Card test (spec 2026-07-28) ──
  // Practice: below 20-SMA but ABOVE 50-SMA and 200-SMA, near the 50-SMA area,
  // intact larger trend, defined stop, RR >= 2:1, real confirmation
  // (reclaim / bullish reversal / bounce off 50 / supportive volume).
  const nearSma50 = sma50 != null && Math.abs((entry - sma50) / sma50) <= 0.03; // within ±3% of 50-SMA
  const bullishReversal = structure.label.toLowerCase().includes("bounce") ||
                          structure.label.toLowerCase().includes("reclaim") ||
                          structure.label.toLowerCase().includes("higher low");
  const supportiveVolume = tVolume >= 3;
  const practiceFailures: string[] = [];
  if (!above200) practiceFailures.push("entry below 200-SMA — no longs below 200-day");
  if (!above50) practiceFailures.push("entry below 50-SMA — practice card requires >50 & >200 SMA");
  if (!nearSma50) practiceFailures.push(`entry not near 50-SMA (${sma50?.toFixed(2) ?? "n/a"}, within ±3% required)`);
  if (rrT1 < 2.0) practiceFailures.push(`R:R to T1 ${rrT1.toFixed(2)}:1 < 2:1 floor`);
  if (!bullishReversal && !structure.isReclaim && !supportiveVolume) {
    practiceFailures.push("no confirmation: need reclaim, bullish reversal, bounce off 50, or supportive volume");
  }
  if (nearResistance) practiceFailures.push(`entry within 1.5% of resistance — chase`);

  // ── Decision ──
  let status: TradeStatus;
  let reason: string;
  let setupType = structure.label;

  // Hard reject: no longs below the 200-day SMA — no tier, no override.
  if (!above200) {
    status = "NO_TRADE";
    reason = `NO TRADE: entry ${entry.toFixed(2)} is below 200-SMA (${sma200?.toFixed(2) ?? "insufficient history"}). Longs are never approved below the 200-day.`;
  } else if (standardFailures.length === 0) {
    status = "STANDARD_SWING_APPROVED";
    reason = `Standard setup: ${structure.label} ${distancePct.toFixed(2)}% from 20-SMA, above 20/50/200 SMA, R:R ${rrT1.toFixed(2)}:1 to T1, regime ${regime}.`;
  } else if (flexFailures.length === 0) {
    status = "FLEX_SWING_APPROVED";
    reason = `Flex setup: ${structure.label} ${distancePct.toFixed(2)}% from 20-SMA, above 50 & 200 SMA, strong theme/fundamentals (${fundies.total}/5), R:R ${rrT1.toFixed(2)}:1.`;
  } else if (practiceFailures.length === 0) {
    status = "PRACTICE_CARD";
    reason = `Practice Card: entry near 50-SMA with confirmation (${structure.label}), R:R ${rrT1.toFixed(2)}:1, larger trend intact.`;
  } else if (
    techTotal >= 3 && fundies.total >= 3 && rrT1 >= 1.5 && !nearResistance && above50
  ) {
    status = "PRACTICE_CARD";
    reason = `Interesting but not pro-grade — ${flexFailures[0]}; log as practice.`;
  } else {
    status = "NO_TRADE";
    reason = flexFailures[0] ?? standardFailures[0] ?? "setup does not meet professional criteria";
  }

  // Below-20-SMA clamp: a setup below the 20-day SMA can never be STANDARD,
  // and is usually capped at PRACTICE_CARD unless momentum is clearly reclaiming
  // AND structure is exceptional (isReclaim + isHigherLow + structure.score >= 4).
  if (!above20 && status !== "NO_TRADE") {
    const exceptionalReclaim =
      structure.isReclaim && structure.isHigherLow && structure.score >= 4;
    if (status === "STANDARD_SWING_APPROVED") {
      // Only allow FLEX on an exceptional reclaim; otherwise cap at PRACTICE.
      status = exceptionalReclaim ? "FLEX_SWING_APPROVED" : "PRACTICE_CARD";
      reason = `Clamped: entry below 20-SMA cannot be STANDARD. ${exceptionalReclaim ? "Exceptional reclaim + higher low — kept as FLEX." : "Capped at PRACTICE_CARD."}`;
    } else if (status === "FLEX_SWING_APPROVED" && !exceptionalReclaim) {
      status = "PRACTICE_CARD";
      reason = `Clamped: entry below 20-SMA without exceptional reclaim — capped at PRACTICE_CARD.`;
    }
  }

  // Downgrade rule: if uncertain (mixed signals), one level down. Apply when
  // status is APPROVED but one component is on the edge.
  if (status === "STANDARD_SWING_APPROVED" && (techTotal < 3 || fundies.total < 3)) {
    status = "FLEX_SWING_APPROVED";
    reason = `Downgraded to FLEX — scores below confidence threshold (tech ${techTotal}, fund ${fundies.total}).`;
  }
  if (status === "FLEX_SWING_APPROVED" && (techTotal < 3 || fundies.total < 3)) {
    status = "PRACTICE_CARD";
    reason = `Downgraded to PRACTICE — scores below confidence threshold (tech ${techTotal}, fund ${fundies.total}).`;
  }

  // ── Card summary (5 lines, only for approved) ──
  const card_summary_5_lines =
    status === "STANDARD_SWING_APPROVED" || status === "FLEX_SWING_APPROVED"
      ? buildCardSummary(ticker, status, entry, stop, t1, t2, rrT1, rrT2, structure.label, regime)
      : null;

  return {
    status,
    setup_type: setupType,
    regime,
    entry,
    stop,
    t1,
    t2,
    risk_reward: { t1: Number(rrT1.toFixed(2)), t2: rrT2 != null ? Number(rrT2.toFixed(2)) : null },
    technical_score: techTotal,
    fundamental_score: fundies.total,
    one_sentence_reason: reason,
    card_summary_5_lines,
    diagnostics: {
      sma20: Number(sma20.toFixed(2)),
      sma50: sma50 != null ? Number(sma50.toFixed(2)) : null,
      sma200: sma200 != null ? Number(sma200.toFixed(2)) : null,
      above_20sma: above20,
      above_50sma: above50,
      above_200sma: above200,
      distance_from_sma20_pct: Number(distancePct.toFixed(2)),
      current_price: Number(currentPrice.toFixed(2)),
      near_resistance: nearResistance,
      nearest_resistance: resistance != null ? Number(resistance.toFixed(2)) : null,
      structure: structure.label,
      standard_failures: standardFailures,
      flex_failures: flexFailures,
      practice_failures: practiceFailures,
      technical_breakdown,
      fundamental_breakdown: fundies.breakdown,
    },
  };
}

// Location score: how good is entry's position relative to 20-SMA?
function locationScore(distancePct: number): number {
  // Sweet spot: 0% to +1% (standard band)
  if (distancePct >= -1 && distancePct <= 1) return 5;
  if (distancePct >= -3 && distancePct <= 2.5) return 4;
  if (distancePct >= -5 && distancePct <= 3.5) return 3;
  if (distancePct > 3.5 && distancePct <= 5) return 2;
  return 1; // extended chase OR well below SMA in a downtrend
}

function rrScoreFromRR(rr: number): number {
  if (rr >= 3) return 5;
  if (rr >= 2.5) return 4;
  if (rr >= 2) return 3;
  if (rr >= 1.5) return 2;
  return 1;
}

function buildCardSummary(
  ticker: string,
  status: TradeStatus,
  entry: number,
  stop: number,
  t1: number,
  t2: number | null,
  rrT1: number,
  rrT2: number | null,
  setupLabel: string,
  regime: string
): string[] {
  return [
    `${ticker} · ${status.replace(/_/g, " ")} · ${setupLabel}`,
    `Entry $${entry.toFixed(2)} · Stop $${stop.toFixed(2)} · Risk $${(entry - stop).toFixed(2)}/share`,
    `T1 $${t1.toFixed(2)} (${rrT1.toFixed(2)}:1)${t2 != null && rrT2 != null ? ` · T2 $${t2.toFixed(2)} (${rrT2.toFixed(2)}:1)` : ""}`,
    `Regime ${regime} · plan via Fidelity OTOCO`,
    `Trail remaining shares 5% (ETF) / 8% (single name) after T1 fills`,
  ];
}
