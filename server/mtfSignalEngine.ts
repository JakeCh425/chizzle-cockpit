// Chizzle Wealth Engine — Multi-Timeframe Swing Signal Engine
// -----------------------------------------------------------------------------
// Long-only rules-based swing engine per the CHIZZLE WEALTH ENGINE spec.
//
// Timeframe roles:
//   Weekly = regime / big-picture filter (GREEN | NEUTRAL | RED)
//   Daily  = primary swing eligibility (RECLAIMED | PULLBACK_VALID | NEUTRAL | RED)
//   4H     = setup detection (5 setup families, all closed-candle only)
//   1H     = entry confirmation + trade management
//
// Safety rules:
//   - Only CLOSED candles produce confirmations. FORMING is informational.
//   - Cards are analysis-only. Never place broker orders.
//   - If app data vs TradingView reference close mismatches > 0.15%,
//     status = DATA_MISMATCH and READY_TO_TRADE is blocked.
//
// This engine is fed two ways:
//   1) Server ticks — recompute Weekly + Daily regimes from the app's own
//      daily OHLC feed (via safeHistory). Cards for symbols with no active
//      4H setup stay at WATCH.
//   2) TradingView webhooks (POST /api/tradingview-alert) — deliver
//      confirmed CLOSED 4H and 1H bars in real time. Setup detection and
//      1H confirmation run inside handleWebhook().
//
// The engine writes cards to the mtf_signals table. UI reads from there.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./storage";
import {
  mtfSignals,
  mtfScanRejections,
  mtfSettings,
  mtfUniverse,
  mtfWebhookEvents,
  type MtfMode,
  type MtfSettings,
  type MtfSignal,
  type InsertMtfSignal,
} from "@shared/schema";
import { safeHistory, type DailyBar } from "./marketData";
import { isMtfV2Enabled } from "./featureFlags";

// ─── Constants (spec-tunable) ────────────────────────────────────────────────
// Data-match tolerance from spec §1: > 0.15% blocks READY_TO_TRADE.
export const DATA_MISMATCH_PCT = 0.15;
// Setup expiry: no 1H confirmation within N completed 4H bars → EXPIRED.
export const SETUP_EXPIRY_4H_BARS = 2;
// Fast confirmation hold time (minutes) for EARLY_TRIGGER label.
export const FAST_CONFIRM_HOLD_MIN = 20;
// Default risk plan defaults (overridable per-user via card fields).
export const DEFAULT_STOP_BUFFER_PCT = 0.5;
export const DEFAULT_MAX_DOLLAR_RISK = 100;
// R:R minimum for A-grade eligibility.
export const MIN_RR = 2.0;
// PR 2c: max % above trigger before entry is blocked without a retest (spec §6/§8).
export const EXTENDED_MAX_PCT = 1.0;
// PR 2c: retest tolerance — bar low within this % of trigger counts as a retest touch.
export const RETEST_TOLERANCE_PCT = 0.3;
// Cluster-of-lows tolerance for STRONG_BULL_BAR_CLUSTER (0.5% band).
export const CLUSTER_TOL_PCT = 0.5;
// Volume floor for AGGRESSIVE_BOUNCE — 1.2× 10-bar avg.
export const AGG_VOL_MULT = 1.2;

// ─── Types ────────────────────────────────────────────────────────────────────
export type WeeklyRegime = "GREEN" | "NEUTRAL" | "RED";
export type DailyRegime = "RECLAIMED" | "PULLBACK_VALID" | "NEUTRAL" | "RED";
export type SetupType =
  | "HAMMER"
  | "BULLISH_ENGULFING"
  | "STRONG_BULL_BAR_CLUSTER"
  | "AGGRESSIVE_BOUNCE"
  | "BREAKOUT_RETEST"
  | "RECLAIM_MOMENTUM_CONTINUATION";
export type CardGrade = "A4" | "A3" | "A2" | "WATCH" | "NO_TRADE";
export type CardStatus =
  | "FORMING"
  | "CONFIRMED"
  | "READY_TO_TRADE"
  | "EARLY_TRIGGER"
  | "EXPIRED"
  | "DATA_MISMATCH";

export interface OhlcBar {
  time: number;   // unix seconds (bar close)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function isRising(values: number[], period: number, lookback = 5): boolean {
  if (values.length < period + lookback) return false;
  const recent = sma(values.slice(-lookback), period);
  const prior = sma(values.slice(-lookback - lookback), period);
  if (recent == null || prior == null) return false;
  return recent > prior;
}

// Aggregate daily bars into weekly (ISO week, Monday-anchored) or monthly.
export function aggregateToWeekly(daily: OhlcBar[]): OhlcBar[] {
  if (daily.length === 0) return [];
  const groups = new Map<string, OhlcBar[]>();
  const order: string[] = [];
  for (const b of daily) {
    const d = new Date(b.time * 1000);
    const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = u.getUTCDay() || 7;
    u.setUTCDate(u.getUTCDate() + 4 - day); // shift to Thursday
    const ys = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
    const w = Math.ceil((((u.getTime() - ys.getTime()) / 86_400_000) + 1) / 7);
    const key = `${u.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(b);
  }
  const out: OhlcBar[] = [];
  for (const k of order) {
    const grp = groups.get(k)!;
    if (grp.length === 0) continue;
    let hi = -Infinity, lo = Infinity, vol = 0;
    for (const b of grp) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
      if (b.volume) vol += b.volume;
    }
    out.push({
      time: grp[grp.length - 1].time,
      open: grp[0].open,
      high: hi,
      low: lo,
      close: grp[grp.length - 1].close,
      volume: vol || undefined,
    });
  }
  return out;
}

// Weekly candle is "current" (still open) if its bucket contains today.
function isCurrentWeekOpen(lastWeeklyBarTime: number): boolean {
  const barDate = new Date(lastWeeklyBarTime * 1000);
  const now = new Date();
  // Same ISO week if the Thursday-of-week test yields identical keys.
  const wkOf = (d: Date) => {
    const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = u.getUTCDay() || 7;
    u.setUTCDate(u.getUTCDate() + 4 - day);
    const ys = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
    const w = Math.ceil((((u.getTime() - ys.getTime()) / 86_400_000) + 1) / 7);
    return `${u.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
  };
  return wkOf(barDate) === wkOf(now);
}

// ─── Weekly regime (spec §3) ─────────────────────────────────────────────────
export interface WeeklyState {
  regime: WeeklyRegime;
  sma20: number | null;
  distPct: number | null;
  reclaimForming: boolean; // current-week close above SMA20 but week not closed
  completedWeekBarTime: number | null;
}

export function computeWeeklyRegime(dailyBars: OhlcBar[]): WeeklyState {
  const weekly = aggregateToWeekly(dailyBars);
  if (weekly.length < 21) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, reclaimForming: false, completedWeekBarTime: null };
  }
  const closes = weekly.map((b) => b.close);
  const lastIsOpen = isCurrentWeekOpen(weekly[weekly.length - 1].time);
  // Use the last CLOSED weekly bar for confirmed classification (never the open one).
  const completedIdx = lastIsOpen ? weekly.length - 2 : weekly.length - 1;
  if (completedIdx < 20) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, reclaimForming: false, completedWeekBarTime: null };
  }
  const closedCloses = closes.slice(0, completedIdx + 1);
  const s20 = sma(closedCloses, 20);
  if (s20 == null) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, reclaimForming: false, completedWeekBarTime: null };
  }
  const closedClose = closedCloses[closedCloses.length - 1];
  const currentClose = closes[closes.length - 1];
  const distPct = ((closedClose - s20) / s20) * 100;
  const rising = isRising(closedCloses, 20, 4);

  let regime: WeeklyRegime = "NEUTRAL";
  if (closedClose > s20 && rising) regime = "GREEN";
  else if (closedClose < s20 && !rising) regime = "RED";
  else if (Math.abs(distPct) < 1.0) regime = "NEUTRAL";
  else regime = closedClose > s20 ? "GREEN" : "RED";

  // Reclaim-forming: current (open) week is above SMA20 but week hasn't closed.
  const reclaimForming = lastIsOpen && currentClose > s20 && closedClose <= s20;

  return {
    regime,
    sma20: s20,
    distPct,
    reclaimForming,
    completedWeekBarTime: weekly[completedIdx].time,
  };
}

// ─── Daily regime (spec §4) ──────────────────────────────────────────────────
export interface DailyState {
  regime: DailyRegime;
  sma20: number | null;
  distPct: number | null;
  completedDayBarTime: number | null;
  structureUpper: boolean;   // higher highs / higher lows over last 20 days
}

function isTodayBar(barTime: number): boolean {
  const d = new Date(barTime * 1000);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear()
    && d.getUTCMonth() === now.getUTCMonth()
    && d.getUTCDate() === now.getUTCDate();
}

function isHigherHighsLows(bars: OhlcBar[]): boolean {
  if (bars.length < 20) return false;
  const half = Math.floor(bars.length / 2);
  const firstHalf = bars.slice(-bars.length, -half);
  const secondHalf = bars.slice(-half);
  const fhHi = Math.max(...firstHalf.map((b) => b.high));
  const shHi = Math.max(...secondHalf.map((b) => b.high));
  const fhLo = Math.min(...firstHalf.map((b) => b.low));
  const shLo = Math.min(...secondHalf.map((b) => b.low));
  return shHi > fhHi && shLo > fhLo;
}

export function computeDailyRegime(dailyBars: OhlcBar[]): DailyState {
  if (dailyBars.length < 25) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, completedDayBarTime: null, structureUpper: false };
  }
  const last = dailyBars[dailyBars.length - 1];
  const isPartial = isTodayBar(last.time);
  const closedIdx = isPartial ? dailyBars.length - 2 : dailyBars.length - 1;
  const closedBars = dailyBars.slice(0, closedIdx + 1);
  if (closedBars.length < 20) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, completedDayBarTime: null, structureUpper: false };
  }
  const closes = closedBars.map((b) => b.close);
  const s20 = sma(closes, 20);
  if (s20 == null) {
    return { regime: "NEUTRAL", sma20: null, distPct: null, completedDayBarTime: null, structureUpper: false };
  }
  const closedClose = closes[closes.length - 1];
  const distPct = ((closedClose - s20) / s20) * 100;
  const rising = isRising(closes, 20, 5);
  const structureUpper = isHigherHighsLows(closedBars.slice(-20));

  let regime: DailyRegime = "NEUTRAL";
  // Reclaim: last completed daily close crossed above SMA20 from below in last N bars.
  const priorClose = closes[closes.length - 2];
  const reclaimed = closedClose > s20 && priorClose <= s20;
  // Pullback valid: above rising SMA20, touching or bouncing off it, structure intact.
  const withinPullbackZone = closedClose > s20 && distPct >= 0 && distPct <= 3.5;
  if (reclaimed) regime = "RECLAIMED";
  else if (rising && withinPullbackZone && structureUpper) regime = "PULLBACK_VALID";
  else if (closedClose < s20 && !rising && !structureUpper) regime = "RED";
  else if (Math.abs(distPct) < 0.5) regime = "NEUTRAL";
  else if (closedClose > s20) regime = "PULLBACK_VALID";
  else regime = "RED";

  return {
    regime,
    sma20: s20,
    distPct,
    completedDayBarTime: closedBars[closedBars.length - 1].time,
    structureUpper,
  };
}

// ─── 4H setup detection (spec §5) ────────────────────────────────────────────
// All setups operate on CLOSED 4H candles only. Callers must filter.
export interface SetupDetection {
  setup: SetupType | null;
  setupHigh: number;   // trigger reference (used for 1H confirmation)
  setupLow: number;    // structural stop reference
  bodyRatio: number;
  closePosition: number;
  volumeMult: number;  // last bar volume / 10-bar avg
  passed: string[];
  failed: string[];
  supportContext: boolean; // occurred near support / after decline
}

function bar(bars: OhlcBar[], i: number): OhlcBar { return bars[bars.length - 1 - i]; }

export function detectFourHourSetup(bars4h: OhlcBar[]): SetupDetection {
  const passed: string[] = [];
  const failed: string[] = [];
  const empty = (): SetupDetection => ({
    setup: null, setupHigh: 0, setupLow: 0, bodyRatio: 0, closePosition: 0, volumeMult: 0,
    passed, failed, supportContext: false,
  });
  if (bars4h.length < 10) { failed.push("insufficient 4H history (need 10+)"); return empty(); }
  const cur = bar(bars4h, 0);
  const prev = bar(bars4h, 1);
  const body = Math.abs(cur.close - cur.open);
  const range = cur.high - cur.low;
  if (range <= 0) { failed.push("zero range on current 4H bar"); return empty(); }
  const bodyRatio = body / range;
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const closePosition = (cur.close - cur.low) / range;
  const isGreen = cur.close > cur.open;

  // Volume context — 10-bar avg (excluding current bar for cleanliness).
  const prior10 = bars4h.slice(-11, -1);
  const avgVol10 = prior10.reduce((a, b) => a + (b.volume || 0), 0) / Math.max(prior10.length, 1);
  const volumeMult = avgVol10 > 0 ? (cur.volume || 0) / avgVol10 : 0;

  // Support / decline context: at least 3 red bars in prior 5-7 OR sharp selloff.
  const prior7 = bars4h.slice(-8, -1);
  const redCount = prior7.filter((b) => b.close < b.open).length;
  const supportContext = redCount >= 3;

  // ── Setup A: Hammer ──────────────────────────────────────────────────────
  if (
    isGreen &&
    lowerWick >= 2 * body &&
    upperWick <= body &&
    closePosition >= 0.67 &&
    supportContext
  ) {
    passed.push("HAMMER: green + long lower wick + close in top third + at support");
    return {
      setup: "HAMMER",
      setupHigh: cur.high,
      setupLow: cur.low,
      bodyRatio, closePosition, volumeMult, passed, failed, supportContext,
    };
  }

  // ── Setup B: Bullish Engulfing ───────────────────────────────────────────
  if (
    isGreen &&
    prev.close < prev.open &&                       // prior red
    cur.open <= prev.close &&
    cur.close >= prev.open &&
    supportContext
  ) {
    passed.push("BULLISH_ENGULFING: green engulfs prior red at support");
    return {
      setup: "BULLISH_ENGULFING",
      setupHigh: cur.high,
      setupLow: Math.min(cur.low, prev.low),
      bodyRatio, closePosition, volumeMult, passed, failed, supportContext,
    };
  }

  // ── Setup C: Strong Bull Bar after Cluster of Lows ───────────────────────
  if (isGreen && bodyRatio >= 0.60 && closePosition >= 0.75) {
    const swingLow = Math.min(...prior7.map((b) => b.low));
    const clusterHits = prior7.filter((b) =>
      Math.abs((b.low - swingLow) / swingLow) * 100 <= CLUSTER_TOL_PCT
    );
    const clusterReds = clusterHits.filter((b) => b.close < b.open);
    if (clusterHits.length >= 3 && clusterReds.length >= 2) {
      passed.push("STRONG_BULL_BAR: strong body + cluster of lows below");
      return {
        setup: "STRONG_BULL_BAR_CLUSTER",
        setupHigh: cur.high,
        setupLow: swingLow,
        bodyRatio, closePosition, volumeMult, passed, failed, supportContext: true,
      };
    }
  }

  // ── Setup D: Aggressive Bounce / V-Reversal ──────────────────────────────
  if (isGreen && bodyRatio >= 0.60 && closePosition >= 0.75) {
    const largeRed = prior7.find((b) => (b.open - b.close) > 0 && (b.open - b.close) / (b.high - b.low + 1e-9) > 0.6);
    const sharpSelloff = redCount >= 3 || !!largeRed;
    if (sharpSelloff && (volumeMult >= AGG_VOL_MULT || avgVol10 === 0)) {
      passed.push("AGGRESSIVE_BOUNCE: strong green after sharp selloff (lower confidence)");
      return {
        setup: "AGGRESSIVE_BOUNCE",
        setupHigh: cur.high,
        setupLow: Math.min(cur.low, ...prior7.map((b) => b.low)),
        bodyRatio, closePosition, volumeMult, passed, failed, supportContext: true,
      };
    }
  }

  // ── Setup E: Breakout-Retest ─────────────────────────────────────────────
  // Simplified: a prior 4H bar closed above a defined range high (max of prior 10),
  // then price retested that level and printed a green reversal bar off it.
  if (bars4h.length >= 15) {
    const rangeWindow = bars4h.slice(-13, -3);
    const rangeHigh = Math.max(...rangeWindow.map((b) => b.high));
    const breakoutBar = bars4h.slice(-3, -1).find((b) => b.close > rangeHigh);
    if (breakoutBar && isGreen && cur.low <= rangeHigh * 1.003 && cur.close > rangeHigh) {
      passed.push("BREAKOUT_RETEST: reclaim of prior range high after retest");
      return {
        setup: "BREAKOUT_RETEST",
        setupHigh: cur.high,
        setupLow: Math.min(rangeHigh * 0.995, cur.low),
        bodyRatio, closePosition, volumeMult, passed, failed, supportContext: true,
      };
    }
  }

  // ── Setup F: Reclaim + Momentum Continuation (Wealth Engine spec) ─────────
  // Catches 4H closes back above 4H SMA20 after price spent ≥3 of the prior 6
  // 4H bars at/below/near that reclaim level. Complements Setup A–E, which
  // require textbook candlestick shapes; this fires on structural reclaim
  // even when the candle isn't a hammer or engulfing.
  //
  // Gated behind ENABLE_MTF_ENGINE_V2. If the flag is OFF, the detector
  // still runs but its result is discarded by the caller (see engine loop).
  //
  // SMA20 basis is computed from the 4H closes themselves — no external
  // dependency, no vendor call.
  if (bars4h.length >= 25) {
    const closes20 = bars4h.slice(-20).map((b) => b.close);
    const sma20_4h = closes20.reduce((a, b) => a + b, 0) / closes20.length;
    const prev4hClose = prev.close;
    // (a) closed 4H bar closes ABOVE 4H SMA20
    const reclaimed = cur.close > sma20_4h && prev4hClose <= sma20_4h * 1.001;
    if (reclaimed) {
      // (b) prior price spent ≥3 of prior 6 4H bars at/below/near SMA20 basis
      const prior6 = bars4h.slice(-7, -1);
      const nearOrBelow = prior6.filter((b) => b.close <= sma20_4h * 1.005).length;
      // Support/decline context: base built below reclaim level
      const belowBasis = prior6.filter((b) => b.close < sma20_4h).length;
      if (nearOrBelow >= 3 && belowBasis >= 2 && isGreen && bodyRatio >= 0.45) {
        // trigger reference = current bar high (breakout of reclaim bar)
        // stop reference = lower of current 4H low OR SMA20 basis * 0.995
        const stopRef = Math.min(cur.low, sma20_4h * 0.995);
        passed.push(
          `RECLAIM_MOMENTUM_CONTINUATION: closed above 4H SMA20 ${sma20_4h.toFixed(2)} after ${nearOrBelow}/6 prior bars at/below basis`
        );
        return {
          setup: "RECLAIM_MOMENTUM_CONTINUATION",
          setupHigh: cur.high,
          setupLow: stopRef,
          bodyRatio,
          closePosition,
          volumeMult,
          passed,
          failed,
          supportContext: true,
        };
      } else {
        failed.push(
          `RECLAIM_MOMENTUM_CONTINUATION: reclaim closed above SMA20 but base too thin (near/below=${nearOrBelow}, below=${belowBasis}, bodyRatio=${bodyRatio.toFixed(2)})`
        );
      }
    }
  }

  failed.push("no valid 4H setup on closed bar");
  return empty();
}

// ─── Grade selection (spec §8) ───────────────────────────────────────────────
export function selectGrade(
  weekly: WeeklyRegime,
  daily: DailyRegime,
  setup: SetupType | null,
  hasH1Confirm: boolean,
  rr: number | null,
): CardGrade {
  const setupOk = setup != null;
  const rrOk = rr != null && rr >= MIN_RR;
  const weeklyOk = weekly === "GREEN" || weekly === "NEUTRAL";
  const dailyOk = daily === "RECLAIMED" || daily === "PULLBACK_VALID";
  // A4: Weekly green/neutral + Daily reclaim or pullback + confirmed setup + 1H + RR>=2
  if (weekly === "GREEN" && dailyOk && setupOk && hasH1Confirm && rrOk) return "A4";
  // A3: Daily reclaim + setup + 1H + RR>=2 (weekly can be neutral)
  if (daily === "RECLAIMED" && setupOk && hasH1Confirm && rrOk && weeklyOk) return "A3";
  // A2: Aggressive bounce / countertrend — misaligned weekly or daily but confirmed setup + 1H
  if (setupOk && hasH1Confirm && rrOk &&
      (setup === "AGGRESSIVE_BOUNCE" || setup === "STRONG_BULL_BAR_CLUSTER" || daily === "RED" || weekly === "RED")) {
    return "A2";
  }
  // WATCH: something in progress but not fully passing
  if (setupOk || dailyOk || (weekly === "GREEN")) return "WATCH";
  return "NO_TRADE";
}

export function tradeLabelForGrade(grade: CardGrade): "SWING" | "COUNTERTREND_PRACTICE" | "INTRADAY" {
  if (grade === "A2") return "COUNTERTREND_PRACTICE";
  return "SWING";
}

// ─── Trade plan math (spec §7) ───────────────────────────────────────────────
export interface TradePlan {
  entry: number;
  stop: number;
  riskPerShare: number;
  target1: number;
  target2: number;
  target1Rr: number;
  target2Rr: number;
  suggestedShares: number;
  warnings: string[];
}

export function buildTradePlan(opts: {
  triggerPrice: number;         // typically 4H setupHigh + tiny buffer or the 1H confirming close
  structuralStop: number;       // setupLow / breakout-retest failure
  stopBufferPct?: number;
  maxDollarRisk?: number;
  nextResistance?: number | null;
}): TradePlan {
  const warnings: string[] = [];
  const stopBuffer = opts.stopBufferPct ?? DEFAULT_STOP_BUFFER_PCT;
  const maxRisk = opts.maxDollarRisk ?? DEFAULT_MAX_DOLLAR_RISK;
  const entry = opts.triggerPrice;
  const bufferedStop = opts.structuralStop * (1 - stopBuffer / 100);
  const stop = Math.min(bufferedStop, opts.structuralStop);
  const risk = entry - stop;
  if (risk <= 0) {
    warnings.push("Invalid stop — entry not above structural invalidation.");
    return {
      entry, stop, riskPerShare: 0, target1: 0, target2: 0, target1Rr: 0, target2Rr: 0,
      suggestedShares: 0, warnings,
    };
  }
  // Target 1 = max(nearest resistance, entry + 2R)
  const t1FromR = entry + risk * 2;
  const nr = opts.nextResistance && opts.nextResistance > entry ? opts.nextResistance : t1FromR;
  const target1 = Math.max(nr, t1FromR);
  const target2 = entry + risk * 3;
  const target1Rr = (target1 - entry) / risk;
  const target2Rr = (target2 - entry) / risk;
  if (target1Rr < MIN_RR) warnings.push(`T1 R:R ${target1Rr.toFixed(2)} below 2.0R minimum.`);
  const suggestedShares = Math.floor(maxRisk / risk);
  if (suggestedShares < 1) warnings.push("WATCH ONLY — structural stop too wide for selected risk.");
  return {
    entry: Number(entry.toFixed(4)),
    stop: Number(stop.toFixed(4)),
    riskPerShare: Number(risk.toFixed(4)),
    target1: Number(target1.toFixed(4)),
    target2: Number(target2.toFixed(4)),
    target1Rr: Number(target1Rr.toFixed(2)),
    target2Rr: Number(target2Rr.toFixed(2)),
    suggestedShares,
    warnings,
  };
}

// ─── Data mismatch check (spec §1) ───────────────────────────────────────────
export function checkDataMismatch(appClose: number, refClose: number | null): { mismatch: boolean; pct: number | null } {
  if (refClose == null || appClose <= 0) return { mismatch: false, pct: null };
  const pct = Math.abs(appClose - refClose) / appClose * 100;
  return { mismatch: pct > DATA_MISMATCH_PCT, pct: Number(pct.toFixed(4)) };
}

// ─── Rejection log helper (PR 2d, spec §12) ─────────────────────────────────
// Persists one row per evaluated 1H/4H bar so the user can see WHY a
// setup did/didn't promote. Feature-flag gated — no-op when the engine
// v2 flag is OFF. Failures are swallowed so a logging bug can never
// break the primary webhook path.
async function logRejection(row: {
  symbol: string;
  exchange?: string | null;
  timeframe: string;
  barCloseTime: Date;
  outcome: string;
  setupsEvaluated?: string[];
  passed?: string[];
  failed?: string[];
  trigger?: number | null;
  stop?: number | null;
  rr?: number | null;
  extendedPct?: number | null;
  volumeMult?: number | null;
  dataMismatchPct?: number | null;
  dataVendor?: string | null;
  meta?: Record<string, any>;
}): Promise<void> {
  if (!isMtfV2Enabled()) return;
  try {
    await db.insert(mtfScanRejections).values({
      symbol: row.symbol,
      exchange: row.exchange ?? null,
      timeframe: row.timeframe,
      barCloseTime: row.barCloseTime,
      outcome: row.outcome,
      setupsEvaluated: (row.setupsEvaluated || []) as any,
      passed: (row.passed || []) as any,
      failed: (row.failed || []) as any,
      trigger: row.trigger ?? null,
      stop: row.stop ?? null,
      rr: row.rr ?? null,
      extendedPct: row.extendedPct ?? null,
      volumeMult: row.volumeMult ?? null,
      dataMismatchPct: row.dataMismatchPct ?? null,
      dataVendor: row.dataVendor ?? null,
      meta: (row.meta || {}) as any,
    } as any);
  } catch {
    // Never let logging break the webhook path.
  }
}

// ─── Effective settings resolver (PR 2e, spec §1) ───────────────────────────
// Loads mtf_settings row 1 and returns the effective rule set for this scan.
// When ENABLE_MTF_ENGINE_V2 is OFF, returns hardcoded PR 1 defaults so
// existing behavior is preserved byte-for-byte.
export interface EffectiveSettings {
  mode: MtfMode;
  minRr: number;
  expiryBars: number;
  allowEarlyTrigger: boolean;
  requireVolume: boolean;
  requireDailyAlignment: boolean;
  requireWeeklyAlignment: boolean;
  showForming: boolean;
  flagOn: boolean;
}

function defaultSettings(): EffectiveSettings {
  return {
    mode: "STANDARD",
    minRr: MIN_RR,
    expiryBars: SETUP_EXPIRY_4H_BARS,
    allowEarlyTrigger: false,
    requireVolume: false,
    requireDailyAlignment: true,
    requireWeeklyAlignment: true,
    showForming: true,
    flagOn: false,
  };
}

async function getEffectiveSettings(): Promise<EffectiveSettings> {
  if (!isMtfV2Enabled()) return defaultSettings();
  try {
    const [row] = await db.select().from(mtfSettings).limit(1);
    if (!row) return { ...defaultSettings(), flagOn: true };
    return {
      mode: (row.mode as MtfMode) || "STANDARD",
      minRr: Number(row.minRr) || MIN_RR,
      expiryBars: row.expiryBars || SETUP_EXPIRY_4H_BARS,
      allowEarlyTrigger: !!row.allowEarlyTrigger,
      requireVolume: !!row.requireVolume,
      requireDailyAlignment: !!row.requireDailyAlignment,
      requireWeeklyAlignment: !!row.requireWeeklyAlignment,
      showForming: !!row.showForming,
      flagOn: true,
    };
  } catch {
    return { ...defaultSettings(), flagOn: true };
  }
}

// ─── Storage helpers ─────────────────────────────────────────────────────────
async function upsertSignal(symbol: string, patch: Partial<InsertMtfSignal>): Promise<MtfSignal> {
  const existing = await db.select().from(mtfSignals)
    .where(and(eq(mtfSignals.symbol, symbol), eq(mtfSignals.archived, false)))
    .orderBy(desc(mtfSignals.updatedAt))
    .limit(1);
  if (existing[0]) {
    const [row] = await db.update(mtfSignals)
      .set({ ...patch, updatedAt: new Date() } as any)
      .where(eq(mtfSignals.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db.insert(mtfSignals)
    .values({ symbol, ...patch } as any)
    .returning();
  return row;
}

// ─── Server-tick recompute (Weekly + Daily from daily bars) ──────────────────
// Called on a schedule (or on-demand from a route). Refreshes weekly/daily
// regime context for every enabled universe row and downgrades any card
// whose regime moved against it.
export async function recomputeUniverseRegimes(): Promise<{ updated: number; symbols: string[] }> {
  const universe = await db.select().from(mtfUniverse).where(eq(mtfUniverse.enabled, true));
  const updated: string[] = [];
  for (const row of universe) {
    try {
      const dailyBars = await safeHistory(row.symbol);
      if (!dailyBars || dailyBars.length < 30) continue;
      const bars: OhlcBar[] = dailyBars.map((b: DailyBar) => ({
        time: Math.floor(new Date((b as any).date || (b as any).time || Date.now()).getTime() / 1000),
        open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close),
        volume: b.volume != null ? Number(b.volume) : undefined,
      }));
      const weekly = computeWeeklyRegime(bars);
      const daily = computeDailyRegime(bars);
      const last = bars[bars.length - 1];
      // Snapshot regime state on the card. If no card exists, create a WATCH
      // placeholder so the panel has a row to display for tracked symbols.
      await upsertSignal(row.symbol, {
        exchange: row.exchange,
        weeklyRegime: weekly.regime,
        weeklySma20: weekly.sma20,
        weeklyDistPct: weekly.distPct,
        weeklyReclaimForming: weekly.reclaimForming,
        dailyRegime: daily.regime,
        dailySma20: daily.sma20,
        dailyDistPct: daily.distPct,
        currentPrice: last.close,
        quoteTimestamp: new Date(last.time * 1000),
        lastCompletedBarTime: new Date((daily.completedDayBarTime || last.time) * 1000),
        dataVendor: "app-daily",
        sessionType: "RTH",
      });
      updated.push(row.symbol);
    } catch (err) {
      // Skip individual failures — one bad symbol shouldn't blow up the whole tick.
      continue;
    }
  }
  return { updated: updated.length, symbols: updated };
}

// ─── Webhook payload handling (spec §10) ─────────────────────────────────────
export interface WebhookPayload {
  secret: string;
  source: string;
  symbol: string;           // "NASDAQ:SMH"
  interval: string;         // "60" | "240" | "1D" | "1W"
  bar_close_time: string;   // ISO or unix seconds
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  volume?: string | number;
  setup?: string;
  status?: string;
}

// In-memory rolling cache of the last N 4H bars per symbol.
// Persistence: mtf_webhook_events is authoritative; this is a hot-path speedup.
const bar4hCache = new Map<string, OhlcBar[]>();
const CACHE_4H_LEN = 15;

function pushBar(map: Map<string, OhlcBar[]>, key: string, bar: OhlcBar, cap: number) {
  const arr = map.get(key) || [];
  // Dedupe by close time — TradingView can retry.
  const filtered = arr.filter((b) => b.time !== bar.time);
  filtered.push(bar);
  filtered.sort((a, b) => a.time - b.time);
  while (filtered.length > cap) filtered.shift();
  map.set(key, filtered);
}

export interface WebhookResult {
  accepted: boolean;
  reason?: string;
  signalId?: string;
  card?: MtfSignal;
}

export async function handleWebhook(
  payload: WebhookPayload,
  configuredSecret: string,
): Promise<WebhookResult> {
  // 1) Secret validation (constant-time compare to defeat trivial timing)
  if (!configuredSecret) return { accepted: false, reason: "Webhook secret not configured on server." };
  const a = Buffer.from(payload.secret || "", "utf8");
  const b = Buffer.from(configuredSecret, "utf8");
  if (a.length !== b.length) return { accepted: false, reason: "Invalid webhook secret." };
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) return { accepted: false, reason: "Invalid webhook secret." };

  // 2) Parse and validate the payload shape
  const symbolFull = String(payload.symbol || "").toUpperCase();
  const [exchangeRaw, tickerRaw] = symbolFull.includes(":") ? symbolFull.split(":") : ["", symbolFull];
  const symbol = tickerRaw.trim();
  const exchange = exchangeRaw.trim() || "NASDAQ";
  const interval = String(payload.interval || "").toUpperCase();
  const acceptedIntervals = new Set(["60", "240", "1D", "D", "1W", "W"]);
  if (!acceptedIntervals.has(interval)) return { accepted: false, reason: `Unsupported interval "${interval}"` };
  const tRaw = payload.bar_close_time;
  const t = typeof tRaw === "string" && /^\d+$/.test(tRaw) ? Number(tRaw) * (String(tRaw).length <= 10 ? 1 : 1e-3) : Math.floor(new Date(tRaw).getTime() / 1000);
  if (!Number.isFinite(t) || t <= 0) return { accepted: false, reason: "Invalid bar_close_time" };
  const bar: OhlcBar = {
    time: Math.floor(t),
    open: Number(payload.open), high: Number(payload.high),
    low: Number(payload.low), close: Number(payload.close),
    volume: payload.volume != null ? Number(payload.volume) : undefined,
  };
  if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) {
    return { accepted: false, reason: "Invalid OHLC values" };
  }

  // 3) Verify symbol is in the tracked universe.
  const uni = await db.select().from(mtfUniverse).where(eq(mtfUniverse.symbol, symbol)).limit(1);
  if (uni.length === 0 || !uni[0].enabled) {
    return { accepted: false, reason: `Symbol ${symbol} not in tracked universe` };
  }

  // 4) 4H bar → try to detect a setup on the closed candle.
  if (interval === "240") {
    // PR 2e: load user-controlled sensitivity settings (spec §1). When the
    // v2 flag is OFF, `settings.flagOn` is false and all fields carry PR 1
    // defaults so behavior is byte-for-byte identical.
    const settings = await getEffectiveSettings();
    pushBar(bar4hCache, symbol, bar, CACHE_4H_LEN);
    const bars = bar4hCache.get(symbol)!;
    const detRaw = detectFourHourSetup(bars);
    // PR 2b: Setup F is a Wealth Engine v2 addition. When the flag is OFF,
    // discard the RECLAIM_MOMENTUM_CONTINUATION detection so PR 1 behavior
    // is byte-for-byte preserved. When ON, it flows through as a normal setup.
    const det = (!isMtfV2Enabled() && detRaw.setup === "RECLAIM_MOMENTUM_CONTINUATION")
      ? {
          ...detRaw,
          setup: null,
          passed: detRaw.passed,
          failed: [...detRaw.failed, "RECLAIM_MOMENTUM_CONTINUATION detected but ENABLE_MTF_ENGINE_V2 flag is OFF"],
        }
      : detRaw;

    // Data-match check against app's daily close.
    const existing = await db.select().from(mtfSignals)
      .where(and(eq(mtfSignals.symbol, symbol), eq(mtfSignals.archived, false)))
      .orderBy(desc(mtfSignals.updatedAt)).limit(1);
    const appClose = existing[0]?.currentPrice ?? null;
    const mismatch = appClose != null ? checkDataMismatch(appClose, bar.close) : { mismatch: false, pct: null };

    // PR 2d: setups evaluated on this 4H bar (used by rejection log).
    const setups4hEvaluated = isMtfV2Enabled()
      ? ["HAMMER","BULLISH_ENGULFING","STRONG_BULL_BAR_CLUSTER","AGGRESSIVE_BOUNCE","BREAKOUT_RETEST","RECLAIM_MOMENTUM_CONTINUATION"]
      : ["HAMMER","BULLISH_ENGULFING","STRONG_BULL_BAR_CLUSTER","AGGRESSIVE_BOUNCE","BREAKOUT_RETEST"];

    if (!det.setup) {
      // PR 2e: honor "Show Setup Forming Cards" toggle. When flag ON and
      // showForming = false, skip creating the FORMING card but still log
      // the rejection so §12 diagnostics remain complete.
      if (settings.flagOn && !settings.showForming) {
        await logRejection({
          symbol, exchange, timeframe: "240",
          barCloseTime: new Date(bar.time * 1000),
          outcome: "NO_SETUP",
          setupsEvaluated: setups4hEvaluated,
          passed: det.passed, failed: [...det.failed, "Forming cards suppressed by user setting"],
          volumeMult: det.volumeMult, dataMismatchPct: mismatch.pct, dataVendor: "tv-webhook",
          meta: { mode: settings.mode, showForming: false, bodyRatio: det.bodyRatio, closePosition: det.closePosition, supportContext: det.supportContext },
        });
        return { accepted: true, reason: "4H closed — no valid setup; forming cards suppressed" };
      }
      const card = await upsertSignal(symbol, {
        status: "FORMING",
        tvSourceClose: bar.close,
        tvSourceTime: new Date(bar.time * 1000),
        dataMismatchPct: mismatch.pct,
        diagnostics: { last4hReject: det.failed, volumeMult: det.volumeMult } as any,
      });
      await logRejection({
        symbol, exchange, timeframe: "240",
        barCloseTime: new Date(bar.time * 1000),
        outcome: "NO_SETUP",
        setupsEvaluated: setups4hEvaluated,
        passed: det.passed, failed: det.failed,
        volumeMult: det.volumeMult, dataMismatchPct: mismatch.pct, dataVendor: "tv-webhook",
        meta: { mode: settings.mode, bodyRatio: det.bodyRatio, closePosition: det.closePosition, supportContext: det.supportContext },
      });
      return { accepted: true, signalId: card.id, card, reason: "4H closed — no valid setup" };
    }

    // PR 2e: setup detected. Apply mode-driven gates before promoting to
    // CONFIRMED. These only trip when the v2 flag is ON.
    const setupGateFails: string[] = [];
    if (settings.flagOn) {
      // Volume requirement (STRICT default, user-overrideable).
      if (settings.requireVolume && det.volumeMult < AGG_VOL_MULT) {
        setupGateFails.push(`requireVolume: ${det.volumeMult.toFixed(2)}× avg below ${AGG_VOL_MULT}× minimum`);
      }
      // Weekly alignment: existing card carries weeklyRegime from prior scan.
      const priorWeekly = (existing[0]?.weeklyRegime as WeeklyRegime | null) || null;
      if (settings.requireWeeklyAlignment && priorWeekly === "RED") {
        setupGateFails.push("requireWeeklyAlignment: weekly regime is RED");
      }
      if (settings.mode === "STRICT" && settings.requireWeeklyAlignment && priorWeekly && priorWeekly !== "GREEN") {
        setupGateFails.push("STRICT mode: weekly regime must be GREEN");
      }
      const priorDaily = (existing[0]?.dailyRegime as DailyRegime | null) || null;
      if (settings.requireDailyAlignment && priorDaily === "RED") {
        setupGateFails.push("requireDailyAlignment: daily regime is RED");
      }
      if (settings.mode === "STRICT" && settings.requireDailyAlignment && priorDaily && priorDaily !== "RECLAIMED" && priorDaily !== "PULLBACK_VALID") {
        setupGateFails.push("STRICT mode: daily must be RECLAIMED or PULLBACK_VALID");
      }
    }

    const expiryBars = settings.flagOn ? settings.expiryBars : SETUP_EXPIRY_4H_BARS;
    const expiresAt = new Date((bar.time + expiryBars * 4 * 3600) * 1000);
    const promotable = setupGateFails.length === 0;
    const card = await upsertSignal(symbol, {
      // Setup is retained either way — gate failures downgrade card to WATCH
      // (via diagnostics) so the user still sees the developing pattern.
      status: mismatch.mismatch ? "DATA_MISMATCH" : (promotable ? "CONFIRMED" : "FORMING"),
      setupType: det.setup,
      setupHigh: det.setupHigh,
      setupLow: det.setupLow,
      setupBarCloseTime: new Date(bar.time * 1000),
      setupConfirmedAt: promotable ? new Date() : null,
      setupExpiresAt: expiresAt,
      tvSourceClose: bar.close,
      tvSourceTime: new Date(bar.time * 1000),
      dataMismatchPct: mismatch.pct,
      diagnostics: {
        setupPassed: det.passed,
        bodyRatio: det.bodyRatio,
        closePosition: det.closePosition,
        volumeMult: det.volumeMult,
        supportContext: det.supportContext,
        // PR 2e diagnostics — only present when flag ON.
        ...(settings.flagOn ? {
          mode: settings.mode,
          modeGateFailed: setupGateFails,
          expiryBars,
        } : {}),
      } as any,
    });
    await logRejection({
      symbol, exchange, timeframe: "240",
      barCloseTime: new Date(bar.time * 1000),
      outcome: mismatch.mismatch ? "DATA_MISMATCH" : (promotable ? "CONFIRMED" : "NOT_PROMOTED"),
      setupsEvaluated: setups4hEvaluated,
      passed: det.passed, failed: [...det.failed, ...setupGateFails],
      trigger: det.setupHigh, stop: det.setupLow,
      volumeMult: det.volumeMult, dataMismatchPct: mismatch.pct, dataVendor: "tv-webhook",
      meta: {
        mode: settings.mode,
        expiryBars,
        setupType: det.setup,
        bodyRatio: det.bodyRatio,
        closePosition: det.closePosition,
        supportContext: det.supportContext,
        modeGated: !promotable,
      },
    });
    return { accepted: true, signalId: card.id, card };
  }

  // 5) 1H bar → check for confirmation on an active CONFIRMED card.
  if (interval === "60") {
    // PR 2e: load user settings (spec §1). PR 1 defaults when flag OFF.
    const settings = await getEffectiveSettings();
    const active = await db.select().from(mtfSignals)
      .where(and(eq(mtfSignals.symbol, symbol), eq(mtfSignals.archived, false)))
      .orderBy(desc(mtfSignals.updatedAt)).limit(1);
    const card = active[0];
    if (!card) return { accepted: true, reason: "1H bar received but no active card for symbol" };

    // Expiry check
    if (card.setupExpiresAt && new Date(bar.time * 1000) > new Date(card.setupExpiresAt)) {
      const expired = await upsertSignal(symbol, { status: "EXPIRED" });
      await logRejection({
        symbol, exchange, timeframe: "60",
        barCloseTime: new Date(bar.time * 1000),
        outcome: "EXPIRED",
        setupsEvaluated: card.setupType ? [String(card.setupType)] : [],
        failed: ["Setup expired before 1H confirmation window closed"],
        trigger: card.setupHigh ?? null, stop: card.setupLow ?? null,
        dataVendor: "tv-webhook",
        meta: { previousSetup: card.setupType, expiresAt: card.setupExpiresAt },
      });
      return { accepted: true, signalId: expired.id, card: expired, reason: "Setup expired before 1H confirmation" };
    }

    if (card.status !== "CONFIRMED" && card.status !== "DATA_MISMATCH" && card.status !== "EARLY_TRIGGER") {
      return { accepted: true, reason: `1H bar received but card status is ${card.status}` };
    }

    const trigger = card.setupHigh ?? 0;
    if (trigger <= 0) return { accepted: true, reason: "Card missing setup_high — cannot confirm" };

    // ── PR 2c: EXTENDED / AWAIT_RETEST gate (spec §6, §8) ────────────────────
    // Track whether ANY 1H bar since confirmation has retested the trigger
    // (bar low within RETEST_TOLERANCE_PCT of trigger). Persisted in
    // diagnostics.retestSeen. Sticky once true.
    // Feature-flagged: when ENABLE_MTF_ENGINE_V2 is OFF, behavior is identical
    // to PR 1 (no gating, no diagnostics writes for this feature).
    const priorDiag = (card.diagnostics as any) || {};
    const priorRetestSeen: boolean = !!priorDiag.retestSeen;
    const thisBarRetests = bar.low <= trigger * (1 + RETEST_TOLERANCE_PCT / 100);
    const retestSeen = priorRetestSeen || thisBarRetests;
    const extendedPct = ((bar.close - trigger) / trigger) * 100;
    const isExtended = extendedPct > EXTENDED_MAX_PCT;
    const flagOn = isMtfV2Enabled();

    if (flagOn && bar.close > trigger && isExtended && !retestSeen) {
      // Do NOT promote to READY_TO_TRADE. Keep status at CONFIRMED, mark the
      // card as WATCH-grade EXTENDED so the UI can surface the await-retest
      // state. This matches spec §6 "WATCH — EXTENDED / AWAIT RETEST".
      const held = await upsertSignal(symbol, {
        grade: "WATCH",
        tradeLabel: tradeLabelForGrade("WATCH"),
        tvSourceClose: bar.close,
        tvSourceTime: new Date(bar.time * 1000),
        diagnostics: {
          ...priorDiag,
          retestSeen,
          extendedAwaitRetest: true,
          extendedPct: Number(extendedPct.toFixed(3)),
          gateAppliedAt: new Date().toISOString(),
        } as any,
      });
      await logRejection({
        symbol, exchange, timeframe: "60",
        barCloseTime: new Date(bar.time * 1000),
        outcome: "EXTENDED_AWAIT_RETEST",
        setupsEvaluated: card.setupType ? [String(card.setupType)] : [],
        failed: [`Price ${extendedPct.toFixed(2)}% above trigger without a retest — entry blocked`],
        trigger, extendedPct: Number(extendedPct.toFixed(3)),
        dataVendor: "tv-webhook",
        meta: { retestSeen, retestToleranceBaseline: trigger * (1 + RETEST_TOLERANCE_PCT / 100) },
      });
      return {
        accepted: true,
        signalId: held.id,
        card: held,
        reason: `WATCH — EXTENDED / AWAIT RETEST (${extendedPct.toFixed(2)}% above trigger, no retest yet)`,
      };
    }

    // Conservative confirmation: 1H CLOSE above setup_high.
    if (bar.close > trigger) {
      const structuralStop = card.setupLow ?? bar.low;
      const plan = buildTradePlan({
        triggerPrice: bar.close,
        structuralStop,
        stopBufferPct: card.stopBufferPct ?? DEFAULT_STOP_BUFFER_PCT,
        maxDollarRisk: card.maxDollarRisk ?? DEFAULT_MAX_DOLLAR_RISK,
      });

      // Data mismatch — block READY_TO_TRADE if app disagrees with TV close.
      const mismatch = card.currentPrice != null ? checkDataMismatch(card.currentPrice, bar.close) : { mismatch: false, pct: null };

      // Grade selection
      let grade: CardGrade = mismatch.mismatch
        ? "WATCH"
        : selectGrade(
            (card.weeklyRegime as WeeklyRegime) || "NEUTRAL",
            (card.dailyRegime as DailyRegime) || "NEUTRAL",
            (card.setupType as SetupType) || null,
            true,
            plan.target1Rr,
          );

      // PR 2e: apply mode-driven promotion gates (spec §1).
      const modeGateFails: string[] = [];
      let promotable = true;
      if (settings.flagOn) {
        // User-selectable minimum R:R (1.5 / 2.0 / 2.5).
        if (plan.target1Rr < settings.minRr) {
          modeGateFails.push(`T1 R:R ${plan.target1Rr.toFixed(2)} below user minimum ${settings.minRr.toFixed(1)}R`);
          promotable = false;
        }
        // STRICT: no countertrend full-risk cards. A2 grade gets demoted to WATCH.
        if (settings.mode === "STRICT" && grade === "A2") {
          modeGateFails.push("STRICT mode: countertrend A2 cards not permitted");
          grade = "WATCH";
          promotable = false;
        }
        // STRICT: require volume confirmation on 1H if requested.
        // Volume is measured on the 4H detection bar; we honor requireVolume
        // as a promotion gate by re-reading the setup's own volumeMult.
        const setupVol = (card.diagnostics as any)?.volumeMult ?? null;
        if (settings.requireVolume && setupVol != null && setupVol < AGG_VOL_MULT) {
          modeGateFails.push(`requireVolume: setup volume ${Number(setupVol).toFixed(2)}× below ${AGG_VOL_MULT}×`);
          promotable = false;
        }
      }

      // PR 2e: FLEXIBLE mode adds a clear practice/reduced-risk label prefix
      // on non-A-grade or A2 cards. Spec §1: "Clearly label all lower-confidence
      // cards as FLEXIBLE / PRACTICE — REDUCED RISK."
      const baseLabel = tradeLabelForGrade(grade);
      const flexibleLabel = (settings.flagOn && settings.mode === "FLEXIBLE" && (grade === "A2" || grade === "WATCH"))
        ? "COUNTERTREND_PRACTICE" as const
        : baseLabel;

      const finalStatus = mismatch.mismatch
        ? "DATA_MISMATCH"
        : (promotable ? "READY_TO_TRADE" : "CONFIRMED");

      const updated = await upsertSignal(symbol, {
        status: finalStatus,
        grade,
        tradeLabel: flexibleLabel,
        h1ConfirmedAt: new Date(),
        h1CloseAboveTrigger: bar.close,
        entryPrice: plan.entry,
        stopPrice: plan.stop,
        target1: plan.target1,
        target2: plan.target2,
        target1Rr: plan.target1Rr,
        target2Rr: plan.target2Rr,
        riskPerShare: plan.riskPerShare,
        suggestedShares: plan.suggestedShares,
        tvSourceClose: bar.close,
        tvSourceTime: new Date(bar.time * 1000),
        dataMismatchPct: mismatch.pct,
        diagnostics: {
          ...(card.diagnostics as any || {}),
          h1Confirm: { close: bar.close, trigger, warnings: plan.warnings },
          // PR 2c: record retest state on promotion so history is preserved.
          ...(flagOn ? { retestSeen, extendedPct: Number(extendedPct.toFixed(3)), extendedAwaitRetest: false } : {}),
          // PR 2e: record mode application outcome so UI can explain demotions.
          ...(settings.flagOn ? {
            mode: settings.mode,
            minRrRequired: settings.minRr,
            modeGateFailed: modeGateFails,
            flexibleLabelApplied: settings.mode === "FLEXIBLE" && (grade === "A2" || grade === "WATCH"),
          } : {}),
        } as any,
      });
      await logRejection({
        symbol, exchange, timeframe: "60",
        barCloseTime: new Date(bar.time * 1000),
        outcome: mismatch.mismatch ? "DATA_MISMATCH" : (promotable ? "PROMOTED" : "NOT_PROMOTED"),
        setupsEvaluated: card.setupType ? [String(card.setupType)] : [],
        passed: [`1H close ${bar.close} above trigger ${trigger}`],
        failed: [...plan.warnings, ...modeGateFails],
        trigger, stop: plan.stop, rr: plan.target1Rr,
        extendedPct: flagOn ? Number(extendedPct.toFixed(3)) : null,
        dataMismatchPct: mismatch.pct, dataVendor: "tv-webhook",
        meta: { grade, setupType: card.setupType, suggestedShares: plan.suggestedShares, retestSeen: flagOn ? retestSeen : undefined, mode: settings.mode, minRr: settings.minRr },
      });
      return { accepted: true, signalId: updated.id, card: updated };
    }

    // No confirmation — record forming state on the card
    await logRejection({
      symbol, exchange, timeframe: "60",
      barCloseTime: new Date(bar.time * 1000),
      outcome: "NOT_PROMOTED",
      setupsEvaluated: card.setupType ? [String(card.setupType)] : [],
      failed: [`1H close ${bar.close} at/below trigger ${trigger}`],
      trigger, dataVendor: "tv-webhook",
      meta: { setupType: card.setupType, retestSeen: flagOn ? retestSeen : undefined, extendedPct: flagOn ? Number(extendedPct.toFixed(3)) : null },
    });
    return { accepted: true, signalId: card.id, card, reason: "1H closed below trigger — no confirmation" };
  }

  // Weekly/Daily webhook — refresh regime hint on the card (still uses server bars as truth).
  return { accepted: true, reason: `Interval ${interval} accepted (regime is computed server-side)` };
}
