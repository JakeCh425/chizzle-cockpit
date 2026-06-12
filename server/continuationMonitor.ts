// ─────────────────────────────────────────────────────────────────────────────
// continuationMonitor.ts
//
// Orchestrator for continuationEngine — pulls 1H/4H intraday bars per symbol,
// computes daily SMA20, evaluates the 3 continuation patterns and produces a
// trade plan compatible with the rest of the cockpit (entry/stop/target/R:R).
// ─────────────────────────────────────────────────────────────────────────────

import { safeHistory, sma, type DailyBar } from "./marketData";
import { fetchTwelveDataOHLCBars } from "./priceService";
import { evaluateContinuation, type ContinuationEvaluation } from "./continuationEngine";
import type { OHLCBar } from "./patternEngine";

export type CMTimeframe = "1h" | "4h";

export interface CMOpts {
  symbols: string[];
  timeframe: CMTimeframe;
  rr: 2 | 3 | 4 | 5;
  minRiskPercent?: number; // default 1.5
}

export interface CMSymbolState extends ContinuationEvaluation {
  symbol: string;
  timeframe: CMTimeframe;
  price: number;
  daily_sma20: number;
  asof: string;
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

export interface CMResponse {
  timeframe: CMTimeframe;
  rr: number;
  min_risk_percent: number;
  asof: string;
  symbols: CMSymbolState[];
}

function roundC(n: number): number { return Math.round(n * 100) / 100; }

function buildTradePlan(
  trigger: number,
  stop: number,
  rr: number,
): CMSymbolState["trade_plan"] {
  if (!Number.isFinite(trigger) || !Number.isFinite(stop)) return null;
  const risk = trigger - stop;
  if (risk <= 0) return null;
  return {
    entry: roundC(trigger),
    stop_loss: roundC(stop),
    risk_per_share: roundC(risk),
    target: roundC(trigger + rr * risk),
    reward_per_share: roundC(rr * risk),
    risk_reward: rr,
  };
}

async function evaluateSymbol(
  symbol: string,
  timeframe: CMTimeframe,
  rr: 2 | 3 | 4 | 5,
  minRiskPct: number,
): Promise<CMSymbolState> {
  const asof = new Date().toISOString();
  const empty: CMSymbolState = {
    symbol,
    timeframe,
    price: 0,
    daily_sma20: 0,
    asof,
    bar_count: 0,
    trade_plan: null,
    status: "No Valid Trigger Yet",
    pattern: null,
    entry_mode: null,
    trigger_price: null,
    invalidation_price: null,
    notes: "",
    near_support: false,
    distance_from_sma20_percent: 0,
    sma20_touched_recently: false,
    green_run_length: 0,
    setup_origin_bars_ago: null,
  };

  let daily: DailyBar[] = [];
  try { daily = await safeHistory(symbol); } catch { /* swallow */ }
  if (daily.length < 21) return { ...empty, notes: "Daily history unavailable." };
  const closes = daily.map(b => b.close);
  const dailySma20 = sma(closes, 20, closes.length - 1);
  if (!Number.isFinite(dailySma20) || dailySma20 <= 0) {
    return { ...empty, notes: "Could not compute daily SMA20." };
  }

  const intraday = await fetchTwelveDataOHLCBars(symbol, timeframe);
  if (!intraday || intraday.length < 8) {
    return {
      ...empty,
      daily_sma20: dailySma20,
      notes: `No ${timeframe} intraday data (${intraday?.length ?? 0} bars).`,
    };
  }

  const bars: OHLCBar[] = intraday.map((b, i) => ({
    ...b,
    is_closed: i < intraday.length - 1,
  }));
  const currentPrice = bars[bars.length - 1].close;

  const evalOut = evaluateContinuation({
    bars,
    current_price: currentPrice,
    daily_sma20: dailySma20,
    sma_band_percent: 2.0,
    min_risk_percent: minRiskPct,
    conservative_mode: true,
    lookback_bars: 5,
    expiry_bars: 4,
  });

  const plan = (evalOut.trigger_price != null && evalOut.invalidation_price != null)
    ? buildTradePlan(evalOut.trigger_price, evalOut.invalidation_price, rr)
    : null;

  return {
    ...evalOut,
    symbol,
    timeframe,
    price: currentPrice,
    daily_sma20: roundC(dailySma20),
    asof,
    bar_count: bars.length,
    trade_plan: plan,
  };
}

export async function evaluateContinuationMonitor(opts: CMOpts): Promise<CMResponse> {
  const minRiskPct = opts.minRiskPercent ?? 1.5;
  const states = await Promise.all(
    opts.symbols.map(s => evaluateSymbol(s, opts.timeframe, opts.rr, minRiskPct).catch(err => {
      console.warn(`[continuation-monitor] ${s} failed:`, err?.message || err);
      return null;
    })),
  );
  return {
    timeframe: opts.timeframe,
    rr: opts.rr,
    min_risk_percent: minRiskPct,
    asof: new Date().toISOString(),
    symbols: states.filter((s): s is CMSymbolState => s !== null),
  };
}
