// ─────────────────────────────────────────────────────────────────────────────
// multiPatternMonitor.ts
//
// Orchestrates patternEngine.evaluatePattern across multiple symbols + the
// 1H / 4H timeframes. Pulls intraday OHLC from Twelve Data, daily SMA20 from
// existing daily history, and constructs a trade_plan compatible with the rest
// of the cockpit (entry/stop/target/risk/RR).
// ─────────────────────────────────────────────────────────────────────────────

import { safeHistory, sma, type DailyBar } from "./marketData";
import { fetchTwelveDataOHLCBars } from "./priceService";
import {
  evaluatePattern,
  type EngineInputs,
  type OHLCBar,
  type PatternEvaluation,
  type PatternType,
} from "./patternEngine";

export type MPTimeframe = "1h" | "4h";
export type MPMode = "conservative" | "aggressive";

export interface MPOpts {
  symbols: string[];
  timeframe: MPTimeframe;
  mode: MPMode;
  rr: 2 | 3 | 4 | 5;
}

export interface MPSymbolState extends PatternEvaluation {
  symbol: string;
  timeframe: MPTimeframe;
  mode: MPMode;
  price: number;
  daily_sma20: number;
  asof: string; // ISO
  bar_count: number;
  trade_plan: {
    entry: number;
    stop_loss: number;
    risk_per_share: number;
    target: number;
    reward_per_share: number;
    risk_reward: number;
  } | null;
}

export interface MPResponse {
  timeframe: MPTimeframe;
  mode: MPMode;
  rr: number;
  asof: string;
  symbols: MPSymbolState[];
}

// Look back up to this many CLOSED bars searching for a recently confirmed
// pattern that may now be "ready to trade" on the current bar.
const CONFIRMATION_LOOKBACK = 3;

// Conservative-mode signals expire after this many bars without breakout.
const SIGNAL_EXPIRY_BARS = 2;

function entryRoundFor(rr: number): number {
  // Whole-cent rounding for prices.
  return Math.round(rr * 100) / 100;
}

function findRecentConfirmedPattern(
  bars: OHLCBar[],
  dailySma20: number,
  smaBandPct: number,
): { type: PatternType; high: number; low: number; barsAgo: number } | null {
  // Walk backwards through closed bars (excluding the current bar) and run the
  // engine on the truncated history to detect prior confirmations.
  for (let lookback = 1; lookback <= CONFIRMATION_LOOKBACK; lookback++) {
    const idx = bars.length - 1 - lookback;
    if (idx < 5) break;
    const truncated = bars.slice(0, idx + 1).map(b => ({ ...b, is_closed: true }));
    const confirmedBar = truncated[truncated.length - 1];
    // Quick location check on the confirmed bar's close
    const dist = Math.abs(confirmedBar.close - dailySma20) / dailySma20 * 100;
    if (dist > smaBandPct) continue;
    const evalAtConf = evaluatePattern({
      bars: truncated,
      current_price: confirmedBar.close,
      daily_sma20: dailySma20,
      sma_band_percent: smaBandPct,
      conservative_mode: true,
      last_confirmed_pattern: null,
    });
    if (evalAtConf.pattern && evalAtConf.pattern_status.startsWith("Confirmed")) {
      return {
        type: evalAtConf.pattern,
        high: confirmedBar.high,
        low: confirmedBar.low,
        barsAgo: lookback,
      };
    }
  }
  return null;
}

function buildTradePlan(
  triggerPrice: number,
  invalidationPrice: number,
  rr: number,
): MPSymbolState["trade_plan"] {
  if (!Number.isFinite(triggerPrice) || !Number.isFinite(invalidationPrice)) return null;
  const risk = triggerPrice - invalidationPrice;
  if (risk <= 0) return null;
  const target = triggerPrice + rr * risk;
  return {
    entry: entryRoundFor(triggerPrice),
    stop_loss: entryRoundFor(invalidationPrice),
    risk_per_share: Math.round(risk * 100) / 100,
    target: entryRoundFor(target),
    reward_per_share: Math.round(rr * risk * 100) / 100,
    risk_reward: rr,
  };
}

async function evaluateSymbol(
  symbol: string,
  timeframe: MPTimeframe,
  mode: MPMode,
  rr: 2 | 3 | 4 | 5,
): Promise<MPSymbolState> {
  const asof = new Date().toISOString();
  const empty: MPSymbolState = {
    symbol,
    timeframe,
    mode,
    price: 0,
    daily_sma20: 0,
    asof,
    bar_count: 0,
    trade_plan: null,
    pattern_status: "No Valid Trigger Yet",
    pattern: null,
    entry_mode: null,
    trigger_price: null,
    invalidation_price: null,
    notes: "",
    near_support: false,
    distance_from_sma20_percent: 0,
    short_term_decline: false,
    cluster_of_lows: false,
    sharp_selloff: false,
    elevated_volume: false,
  };

  // Daily SMA20 (location filter)
  let daily: DailyBar[] = [];
  try { daily = await safeHistory(symbol); } catch { /* swallow */ }
  if (daily.length < 21) {
    return { ...empty, notes: "Daily history unavailable for SMA20 calc." };
  }
  const dailyCloses = daily.map(b => b.close);
  const dailySma20 = sma(dailyCloses, 20, dailyCloses.length - 1);
  if (!Number.isFinite(dailySma20) || dailySma20 <= 0) {
    return { ...empty, notes: "Could not compute daily SMA20." };
  }

  // Intraday bars
  const intraday = await fetchTwelveDataOHLCBars(symbol, timeframe);
  if (!intraday || intraday.length < 12) {
    return {
      ...empty,
      daily_sma20: dailySma20,
      notes: `No ${timeframe} intraday data available (${intraday?.length ?? 0} bars).`,
    };
  }

  const bars: OHLCBar[] = intraday.map((b, i) => ({
    ...b,
    // Mark every bar except the very latest as closed. We treat the most
    // recent intraday bar as "in progress" which surfaces "Forming" states.
    is_closed: i < intraday.length - 1,
  }));
  const currentPrice = bars[bars.length - 1].close;

  // Look back a few bars for a prior CONFIRMED pattern to surface Ready/Expired
  const recent = findRecentConfirmedPattern(bars, dailySma20, 2.0);

  const engineInputs: EngineInputs = {
    bars,
    current_price: currentPrice,
    daily_sma20: dailySma20,
    sma_band_percent: 2.0,
    conservative_mode: mode === "conservative",
    bars_since_confirmation: recent?.barsAgo,
    last_confirmed_pattern: recent ? { type: recent.type, high: recent.high, low: recent.low } : null,
  };

  const evalOut = evaluatePattern(engineInputs);

  // Build trade plan whenever we have a trigger + invalidation
  const plan = (evalOut.trigger_price != null && evalOut.invalidation_price != null)
    ? buildTradePlan(evalOut.trigger_price, evalOut.invalidation_price, rr)
    : null;

  return {
    ...evalOut,
    symbol,
    timeframe,
    mode,
    price: currentPrice,
    daily_sma20: Math.round(dailySma20 * 100) / 100,
    asof,
    bar_count: bars.length,
    trade_plan: plan,
  };
}

export async function evaluateMultiPattern(opts: MPOpts): Promise<MPResponse> {
  const states = await Promise.all(
    opts.symbols.map(s => evaluateSymbol(s, opts.timeframe, opts.mode, opts.rr).catch(err => {
      console.warn(`[multi-pattern-monitor] ${s} failed:`, err?.message || err);
      return null;
    })),
  );
  return {
    timeframe: opts.timeframe,
    mode: opts.mode,
    rr: opts.rr,
    asof: new Date().toISOString(),
    symbols: states.filter((s): s is MPSymbolState => s !== null),
  };
}
