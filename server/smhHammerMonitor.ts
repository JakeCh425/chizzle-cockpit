// ─────────────────────────────────────────────────────────────────────────────
// SMH Hammer Monitor
// Dedicated monitor for SMH that:
//   1. Identifies support levels (recent swing lows + SMA20/SMA50)
//   2. Scans for hammer candle FORMING at/near support → emits alert
//   3. Tracks NEXT candle for confirmed breakout above hammer high
//   4. Applies a high-volume filter (>= 1.2x 20-day avg volume) on the
//      confirmation candle
//   5. Calculates stop-loss = hammer.low and 1:2 R:R target from
//      confirmation close
// ─────────────────────────────────────────────────────────────────────────────

import { safeHistory, sma, type DailyBar } from "./marketData";
import { storage } from "./storage";

const SYMBOL = "SMH";
const VOLUME_MULTIPLIER = 1.2;        // high-volume filter
const SUPPORT_PROXIMITY_PCT = 1.5;    // hammer must be within 1.5% of support
const SWING_LOOKBACK = 30;            // bars to scan for swing-low supports
const SWING_PIVOT_HALF_WIDTH = 3;     // bars left/right that define a swing low
const RR_RATIO = 2;                   // 1:2 risk:reward

// ─── Types ──────────────────────────────────────────────────────────────────

export type HammerMonitorPhase =
  | "Scanning"               // no qualifying hammer yet
  | "Hammer Forming"         // live in-progress hammer at support (not closed)
  | "Hammer Confirmed"       // hammer closed at support, waiting for breakout
  | "Breakout Confirmed"     // next candle broke above hammer high with volume
  | "Invalidated";           // next candle broke hammer low OR no breakout / low volume

export interface SupportLevel {
  type: "swing_low" | "sma20" | "sma50";
  price: number;
  distance_pct: number;       // % distance from current price (positive = above support)
}

export interface HammerMonitorState {
  symbol: string;
  phase: HammerMonitorPhase;
  price: number;
  asof: string;               // ISO timestamp
  market_open: boolean;

  // Support context
  nearest_support: SupportLevel | null;
  support_levels: SupportLevel[];

  // Hammer details (null until detected)
  hammer: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    body_size: number;
    lower_wick: number;
    upper_wick: number;
    is_closed: boolean;
    support_distance_pct: number;
  } | null;

  // Confirmation candle details (null until next candle starts)
  confirmation: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    avg_volume_20: number;
    volume_ratio: number;      // volume / avg_volume_20
    high_volume: boolean;       // volume_ratio >= VOLUME_MULTIPLIER
    broke_high: boolean;        // close > hammer.high
    broke_low: boolean;         // low < hammer.low
    is_closed: boolean;
  } | null;

  // Trade levels (populated after Breakout Confirmed)
  trade_plan: {
    entry: number;
    stop_loss: number;
    risk_per_share: number;
    target: number;             // entry + 2 * risk
    reward_per_share: number;
    risk_reward: number;
  } | null;

  notes: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isMarketOpenET(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function isHammer(bar: DailyBar): { is_hammer: boolean; body: number; lower_wick: number; upper_wick: number } {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;
  const lower_wick = Math.min(bar.open, bar.close) - bar.low;
  const upper_wick = bar.high - Math.max(bar.open, bar.close);
  // Hammer: bullish body, lower wick >= 2x body, upper wick <= body, close in top 1/3
  const is_hammer =
    range > 0 &&
    bar.close > bar.open &&
    lower_wick >= 2 * body &&
    upper_wick <= body &&
    bar.close >= bar.low + 0.67 * range;
  return { is_hammer, body, lower_wick, upper_wick };
}

// Check if a candle "looks like a hammer" while still forming — slightly looser
// criteria so we can alert before close. Requires lower wick already >= 1.5x body
// and price recovered into top 40% of range.
function isFormingHammer(bar: DailyBar): boolean {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const lower_wick = Math.min(bar.open, bar.close) - bar.low;
  const upper_wick = bar.high - Math.max(bar.open, bar.close);
  return (
    bar.close >= bar.open &&
    lower_wick >= 1.5 * Math.max(body, range * 0.05) &&
    upper_wick <= Math.max(body, range * 0.25) &&
    bar.close >= bar.low + 0.6 * range
  );
}

// Find swing lows in recent history (pivot lows).
function findSwingLows(bars: DailyBar[], lookback: number, halfWidth: number): number[] {
  const out: number[] = [];
  const start = Math.max(halfWidth, bars.length - lookback);
  for (let i = start; i < bars.length - halfWidth; i++) {
    const candidate = bars[i].low;
    let isPivot = true;
    for (let j = i - halfWidth; j <= i + halfWidth; j++) {
      if (j === i) continue;
      if (bars[j].low <= candidate) { isPivot = false; break; }
    }
    if (isPivot) out.push(candidate);
  }
  return out;
}

function computeSupports(bars: DailyBar[], currentPrice: number): SupportLevel[] {
  const supports: SupportLevel[] = [];
  const lastIdx = bars.length - 1;
  const closes = bars.map((b) => b.close);

  const sma20 = sma(closes, 20, lastIdx);
  if (sma20 < currentPrice) {
    supports.push({
      type: "sma20",
      price: Number(sma20.toFixed(2)),
      distance_pct: Number((((currentPrice - sma20) / currentPrice) * 100).toFixed(2)),
    });
  }
  const sma50 = sma(closes, 50, lastIdx);
  if (sma50 < currentPrice) {
    supports.push({
      type: "sma50",
      price: Number(sma50.toFixed(2)),
      distance_pct: Number((((currentPrice - sma50) / currentPrice) * 100).toFixed(2)),
    });
  }
  const swings = findSwingLows(bars, SWING_LOOKBACK, SWING_PIVOT_HALF_WIDTH);
  // Keep only swing lows BELOW current price; dedupe within 0.5% of each other
  const filtered: number[] = [];
  for (const s of swings) {
    if (s >= currentPrice) continue;
    if (filtered.some((f) => Math.abs(f - s) / s < 0.005)) continue;
    filtered.push(s);
  }
  for (const s of filtered) {
    supports.push({
      type: "swing_low",
      price: Number(s.toFixed(2)),
      distance_pct: Number((((currentPrice - s) / currentPrice) * 100).toFixed(2)),
    });
  }
  // Sort by closest to price
  supports.sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct));
  return supports;
}

// Returns nearest support that the given low is within proximity of.
function supportNearLow(supports: SupportLevel[], low: number): SupportLevel | null {
  for (const s of supports) {
    const dist_pct = Math.abs((low - s.price) / s.price) * 100;
    if (dist_pct <= SUPPORT_PROXIMITY_PCT) return s;
  }
  return null;
}

function averageVolume(bars: DailyBar[], n: number, atIndex: number): number {
  if (atIndex < n - 1) return 0;
  let sum = 0;
  for (let i = atIndex - n + 1; i <= atIndex; i++) sum += bars[i].volume;
  return sum / n;
}

function buildTradePlan(confirmationClose: number, hammerLow: number) {
  const entry = confirmationClose;
  const stop_loss = hammerLow;
  const risk_per_share = Math.max(entry - stop_loss, 0);
  const reward_per_share = risk_per_share * RR_RATIO;
  const target = entry + reward_per_share;
  return {
    entry: Number(entry.toFixed(2)),
    stop_loss: Number(stop_loss.toFixed(2)),
    risk_per_share: Number(risk_per_share.toFixed(2)),
    target: Number(target.toFixed(2)),
    reward_per_share: Number(reward_per_share.toFixed(2)),
    risk_reward: RR_RATIO,
  };
}

// ─── Core evaluator ─────────────────────────────────────────────────────────

export async function evaluateSmhHammerMonitor(): Promise<HammerMonitorState> {
  const bars = await safeHistory(SYMBOL);
  const market_open = isMarketOpenET();
  const nowIso = new Date().toISOString();

  if (!bars || bars.length < 60) {
    return {
      symbol: SYMBOL,
      phase: "Scanning",
      price: 0,
      asof: nowIso,
      market_open,
      nearest_support: null,
      support_levels: [],
      hammer: null,
      confirmation: null,
      trade_plan: null,
      notes: "Insufficient history to evaluate.",
    };
  }

  const lastIdx = bars.length - 1;
  const current = bars[lastIdx];
  const prior = bars[lastIdx - 1];
  const currentPrice = current.close;

  const supports = computeSupports(bars, currentPrice);
  const nearest = supports[0] ?? null;

  // ── Phase 1: check the CURRENT bar for a hammer (forming or confirmed) ──
  // The current bar in safeHistory is the most recent daily print. If market
  // is open it can still update intrabar. If market closed it's a finalized
  // session.
  const currentHammer = isHammer(current);
  const currentForming = isFormingHammer(current);
  const hammerSupport = supportNearLow(supports, current.low);

  // If the most recent bar IS a hammer at support and there's a NEXT bar,
  // we may already be in confirmation territory — but since safeHistory only
  // gives daily bars, the "next" candle = today's bar when yesterday was the
  // hammer. So check the PRIOR bar as the hammer and current bar as confirmation.
  const priorHammer = isHammer(prior);
  const priorSupport = supportNearLow(supports, prior.low);

  // ── Case A: prior bar was a hammer at support → today is confirmation ──
  if (priorHammer.is_hammer && priorSupport) {
    const avgVol20 = averageVolume(bars, 20, lastIdx);
    const volRatio = avgVol20 > 0 ? current.volume / avgVol20 : 0;
    const highVolume = volRatio >= VOLUME_MULTIPLIER;
    const brokeHigh = current.close > prior.high;
    const brokeLow = current.low < prior.low;
    const isClosed = !market_open;

    let phase: HammerMonitorPhase;
    let notes: string;
    let trade_plan = null;

    if (brokeLow) {
      phase = "Invalidated";
      notes = `Confirmation candle broke below hammer low ${prior.low.toFixed(2)}. Setup voided.`;
    } else if (brokeHigh && highVolume && isClosed) {
      phase = "Breakout Confirmed";
      trade_plan = buildTradePlan(current.close, prior.low);
      notes = `Breakout above hammer high ${prior.high.toFixed(2)} on ${volRatio.toFixed(2)}x avg volume. Entry ${trade_plan.entry}, stop ${trade_plan.stop_loss}, target ${trade_plan.target} (1:${RR_RATIO} R:R).`;
    } else if (brokeHigh && !highVolume && isClosed) {
      phase = "Invalidated";
      notes = `Price broke hammer high but volume ${volRatio.toFixed(2)}x < ${VOLUME_MULTIPLIER}x filter. Skip — no high-volume confirmation.`;
    } else if (brokeHigh && market_open) {
      phase = "Hammer Confirmed";
      notes = `Confirmation in progress: price above hammer high ${prior.high.toFixed(2)}, volume ${volRatio.toFixed(2)}x avg. Wait for close + volume confirmation.`;
    } else {
      phase = "Hammer Confirmed";
      notes = `Hammer confirmed at ${priorSupport.type} support ${priorSupport.price}. Awaiting breakout > ${prior.high.toFixed(2)} on ${VOLUME_MULTIPLIER}x volume.`;
    }

    return {
      symbol: SYMBOL,
      phase,
      price: Number(currentPrice.toFixed(2)),
      asof: nowIso,
      market_open,
      nearest_support: nearest,
      support_levels: supports,
      hammer: {
        timestamp: prior.date,
        open: Number(prior.open.toFixed(2)),
        high: Number(prior.high.toFixed(2)),
        low: Number(prior.low.toFixed(2)),
        close: Number(prior.close.toFixed(2)),
        volume: prior.volume,
        body_size: Number(Math.abs(prior.close - prior.open).toFixed(2)),
        lower_wick: Number((Math.min(prior.open, prior.close) - prior.low).toFixed(2)),
        upper_wick: Number((prior.high - Math.max(prior.open, prior.close)).toFixed(2)),
        is_closed: true,
        support_distance_pct: Number(
          (Math.abs((prior.low - priorSupport.price) / priorSupport.price) * 100).toFixed(2)
        ),
      },
      confirmation: {
        timestamp: current.date,
        open: Number(current.open.toFixed(2)),
        high: Number(current.high.toFixed(2)),
        low: Number(current.low.toFixed(2)),
        close: Number(current.close.toFixed(2)),
        volume: current.volume,
        avg_volume_20: Math.round(avgVol20),
        volume_ratio: Number(volRatio.toFixed(2)),
        high_volume: highVolume,
        broke_high: brokeHigh,
        broke_low: brokeLow,
        is_closed: isClosed,
      },
      trade_plan,
      notes,
    };
  }

  // ── Case B: current bar IS a hammer (or forming) at support ──
  if ((currentHammer.is_hammer || currentForming) && hammerSupport) {
    const isClosed = !market_open;
    const phase: HammerMonitorPhase = isClosed && currentHammer.is_hammer
      ? "Hammer Confirmed"
      : "Hammer Forming";
    const notes = isClosed
      ? `Hammer closed at ${hammerSupport.type} support ${hammerSupport.price}. Watch next session for breakout > ${current.high.toFixed(2)} on ${VOLUME_MULTIPLIER}x volume.`
      : `Hammer forming live at ${hammerSupport.type} support ${hammerSupport.price}. Wait for daily close to confirm pattern.`;

    return {
      symbol: SYMBOL,
      phase,
      price: Number(currentPrice.toFixed(2)),
      asof: nowIso,
      market_open,
      nearest_support: nearest,
      support_levels: supports,
      hammer: {
        timestamp: current.date,
        open: Number(current.open.toFixed(2)),
        high: Number(current.high.toFixed(2)),
        low: Number(current.low.toFixed(2)),
        close: Number(current.close.toFixed(2)),
        volume: current.volume,
        body_size: Number(Math.abs(current.close - current.open).toFixed(2)),
        lower_wick: Number(currentHammer.lower_wick.toFixed(2)),
        upper_wick: Number(currentHammer.upper_wick.toFixed(2)),
        is_closed: isClosed,
        support_distance_pct: Number(
          (Math.abs((current.low - hammerSupport.price) / hammerSupport.price) * 100).toFixed(2)
        ),
      },
      confirmation: null,
      trade_plan: null,
      notes,
    };
  }

  // ── Case C: no qualifying setup ──
  let notes = "No hammer at support detected.";
  if (currentHammer.is_hammer || currentForming) {
    notes = "Hammer pattern detected but not near a support level (>1.5% away).";
  } else if (nearest && Math.abs(nearest.distance_pct) <= SUPPORT_PROXIMITY_PCT) {
    notes = `Price near ${nearest.type} support ${nearest.price} but no hammer formation yet.`;
  }

  return {
    symbol: SYMBOL,
    phase: "Scanning",
    price: Number(currentPrice.toFixed(2)),
    asof: nowIso,
    market_open,
    nearest_support: nearest,
    support_levels: supports,
    hammer: null,
    confirmation: null,
    trade_plan: null,
    notes,
  };
}

// ─── Alert emission (writes to signal_history when state transitions) ──────
// Track last emitted phase keyed by hammer timestamp so we don't spam.

let lastEmittedKey: string | null = null;

export async function maybeEmitHammerAlert(state: HammerMonitorState): Promise<boolean> {
  if (!state.hammer) return false;
  // Emit on Hammer Forming, Hammer Confirmed, Breakout Confirmed
  const emittablePhases: HammerMonitorPhase[] = [
    "Hammer Forming",
    "Hammer Confirmed",
    "Breakout Confirmed",
  ];
  if (!emittablePhases.includes(state.phase)) return false;

  const key = `${state.hammer.timestamp}::${state.phase}`;
  if (key === lastEmittedKey) return false;

  try {
    const score = state.phase === "Breakout Confirmed" ? 95 : state.phase === "Hammer Confirmed" ? 75 : 55;
    const color = state.phase === "Breakout Confirmed" ? "#00E5A8" : state.phase === "Hammer Confirmed" ? "#7AC9FF" : "#FFD166";
    const ts = Math.floor(new Date(state.hammer.timestamp).getTime() / 1000) || Math.floor(Date.now() / 1000);
    const confVol = state.confirmation?.volume ?? 0;
    const confVolRatio = state.confirmation?.volume_ratio ?? 0;
    await storage.createSignalHistory({
      ticker: SYMBOL,
      patternType: "Hammer",
      timestamp: ts,
      setupCandleIndex: 0,
      confirmationCandleIndex: state.confirmation ? 1 : 0,
      setupCandleLow: state.hammer.low,
      confirmationCandleLow: state.confirmation?.low ?? state.hammer.low,
      confirmationClose: state.confirmation?.close ?? state.hammer.close,
      retestZoneUpper: state.hammer.high,
      retestZoneLower: state.hammer.low,
      score,
      scoreBreakdown: JSON.stringify([state.phase, state.nearest_support?.type ?? "support"]),
      volume: confVol,
      volumeVsAverage20: confVolRatio,
      markerType: state.phase.replace(/\s+/g, "_").toLowerCase(),
      markerPosition: state.hammer.low,
      color,
      soundPlayed: false,
      notificationSent: false,
      smaProximity: state.nearest_support ? `${state.nearest_support.type} ${state.nearest_support.price}` : "",
      createdAt: new Date().toISOString(),
    });
    lastEmittedKey = key;
    return true;
  } catch (err) {
    console.warn("[smhHammerMonitor] alert emit failed:", err);
    return false;
  }
}
