// ─────────────────────────────────────────────────────────────────────────────
// Bull Bar After Cluster of Lows — 1H pattern detector
//
// Setup ingredients (all on the 1H timeframe):
//   1. Price is in/near the daily SMA20 pullback band (within PULLBACK_BAND_PCT)
//   2. Short-term decline into that zone (net negative move over DECLINE_LOOKBACK)
//   3. Cluster of lows: ≥ CLUSTER_MIN_BARS bars in last CLUSTER_WINDOW with
//      lows within CLUSTER_BAND_PCT of the recent swing low, ≥ 2 red candles
//   4. Strong bullish bar: green, body ≥ 60% of H-L range, close in top 25% of range
//
// Status labels (mirrors hammer monitor):
//   - "Bull Bar Forming"     (intrabar — current bar partially meets criteria)
//   - "Confirmed Bull Bar"   (after close — strong bull bar conditions all true)
//   - "Ready to Trade"       (post-confirmation trigger above bull-bar high)
//   - "Invalidated"          (next bar broke below bull-bar low)
//   - "Scanning"             (no qualifying setup)
//
// Modes:
//   - conservative: Ready to Trade only when NEXT 1H bar trades / closes above bull-bar high
//   - aggressive:   Ready to Trade allowed immediately after a Confirmed Bull Bar closes
//
// This module is independent of the hammer logic. Both can fire simultaneously.
// ─────────────────────────────────────────────────────────────────────────────

import { safeHistory, sma, type DailyBar } from "./marketData";
import { fetchTwelveDataOHLCBars } from "./priceService";
import { storage } from "./storage";
import { dispatchHammerAlert } from "./alert-dispatcher";

export type BullBarTradeMode = "conservative" | "aggressive";

const PULLBACK_BAND_PCT = 2.5;        // daily SMA20 pullback band (±)
const DECLINE_LOOKBACK = 8;            // 1H bars used to confirm "short-term decline"
const DECLINE_MIN_PCT = 0.4;           // min % drop over the lookback to call it a decline
const CLUSTER_WINDOW = 10;             // bars to scan for clustered lows
const CLUSTER_MIN_BARS = 3;            // minimum lows in the cluster
const CLUSTER_BAND_PCT = 0.6;          // lows must sit within ±% of recent swing low
const CLUSTER_MIN_REDS = 2;            // require ≥ 2 red candles inside the cluster
const STRONG_BAR_BODY_PCT = 0.60;      // body ≥ 60% of range
const STRONG_BAR_TOP_QUARTILE = 0.75;  // close in top 25% of range (≥ low + 0.75 * range)
const FORMING_BODY_PCT = 0.45;         // looser body % for intrabar "forming" label
const FORMING_TOP_QUARTILE = 0.60;     // looser close-in-range for "forming"
const DEFAULT_RR_RATIO = 2;

export interface BullBarEvalOpts {
  symbol?: string;        // default "SMH"
  mode?: BullBarTradeMode;
  rr?: number;
  allow_off_band?: boolean; // default false. When true, the engine emits
                            // Off-Band Forming / Off-Band Confirmed phases
                            // when price sits outside the SMA20 pullback band
                            // but the rest of the pattern is intact.
                            // Awareness-only — never auto-promotes to Ready.
}

export type BullBarPhase =
  | "Scanning"
  | "Bull Bar Forming"
  | "Confirmed Bull Bar"
  | "Ready to Trade"
  | "Invalidated"
  // Off-band variants: same pattern geometry + decline + cluster, but price
  // is not in the SMA20 pullback band. Lower priority, no Ready-to-Trade.
  | "Off-Band Bull Bar Forming"
  | "Off-Band Confirmed Bull Bar";

export interface BullBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  body_pct: number;     // body / range
  close_position: number; // (close - low) / range
  is_closed: boolean;
}

export interface ClusterInfo {
  swing_low: number;
  bar_count: number;       // bars in the cluster
  red_count: number;       // red bars in the cluster
  band_pct: number;        // configured band
  start_timestamp: string; // earliest bar in cluster window
}

export interface ConfirmationBar1H {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  broke_high: boolean;
  broke_low: boolean;
  is_closed: boolean;
}

export interface BullBarTradePlan {
  entry: number;
  stop_loss: number;
  risk_per_share: number;
  target: number;
  reward_per_share: number;
  risk_reward: number;
}

export interface BullBarState {
  symbol: string;
  timeframe: "1H";
  phase: BullBarPhase;
  mode: BullBarTradeMode;
  rr: number;
  price: number;
  asof: string;
  market_open: boolean;

  daily_sma20: number;
  sma20_distance_pct: number;
  in_pullback_band: boolean;

  decline_pct: number;
  has_decline: boolean;

  cluster: ClusterInfo | null;
  bull_bar: BullBar | null;
  confirmation: ConfirmationBar1H | null;
  trade_plan: BullBarTradePlan | null;

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

interface OHLCBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function tsToIso(t: number): string {
  return new Date(t * 1000).toISOString();
}

// Yahoo 1H fetcher as fallback when Twelve Data has no key / is rate-limited.
async function fetchYahoo1H(symbol: string): Promise<OHLCBar[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=60m&range=30d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chizzle/1.0",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const r = j.chart?.result?.[0];
    if (!r) return null;
    const ts: number[] = r.timestamp || [];
    const q = r.indicators?.quote?.[0];
    if (!q) return null;
    const out: OHLCBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
      if (o == null || h == null || l == null || c == null) continue;
      out.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: Number(v ?? 0) });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

async function fetch1HBars(symbol: string): Promise<OHLCBar[]> {
  // Prefer Twelve Data (cleaner sessions) → fall back to Yahoo 60m.
  const td = await fetchTwelveDataOHLCBars(symbol, "1h");
  if (td && td.length >= 30) return td;
  const yh = await fetchYahoo1H(symbol);
  if (yh && yh.length >= 30) return yh;
  return td || yh || [];
}

function isStrongBullBar(bar: OHLCBar): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  if (bar.close <= bar.open) return false; // must be green
  const body = bar.close - bar.open;
  const bodyPct = body / range;
  const closePos = (bar.close - bar.low) / range;
  return bodyPct >= STRONG_BAR_BODY_PCT && closePos >= STRONG_BAR_TOP_QUARTILE;
}

function isFormingBullBar(bar: OHLCBar): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  if (bar.close < bar.open) return false;
  const body = bar.close - bar.open;
  const bodyPct = body / range;
  const closePos = (bar.close - bar.low) / range;
  return bodyPct >= FORMING_BODY_PCT && closePos >= FORMING_TOP_QUARTILE;
}

function findClusterOfLows(bars: OHLCBar[], endIdx: number): ClusterInfo | null {
  const startIdx = Math.max(0, endIdx - CLUSTER_WINDOW + 1);
  if (endIdx - startIdx + 1 < CLUSTER_MIN_BARS) return null;
  const slice = bars.slice(startIdx, endIdx + 1);
  // Recent swing low = the minimum low across the window.
  const swingLow = slice.reduce((m, b) => Math.min(m, b.low), Infinity);
  if (!Number.isFinite(swingLow) || swingLow <= 0) return null;
  const band = swingLow * (CLUSTER_BAND_PCT / 100);
  let barCount = 0;
  let redCount = 0;
  for (const b of slice) {
    if (Math.abs(b.low - swingLow) <= band) {
      barCount++;
      if (b.close < b.open) redCount++;
    }
  }
  if (barCount < CLUSTER_MIN_BARS) return null;
  if (redCount < CLUSTER_MIN_REDS) return null;
  return {
    swing_low: Number(swingLow.toFixed(2)),
    bar_count: barCount,
    red_count: redCount,
    band_pct: CLUSTER_BAND_PCT,
    start_timestamp: tsToIso(slice[0].time),
  };
}

function computeDeclinePct(bars: OHLCBar[], endIdx: number): number {
  const startIdx = Math.max(0, endIdx - DECLINE_LOOKBACK);
  const start = bars[startIdx];
  const end = bars[endIdx];
  if (!start || !end || start.close <= 0) return 0;
  return ((end.close - start.close) / start.close) * 100;
}

function buildTradePlan(entry: number, stop: number, rr: number): BullBarTradePlan {
  const risk = Math.max(entry - stop, 0);
  const reward = risk * rr;
  return {
    entry: Number(entry.toFixed(2)),
    stop_loss: Number(stop.toFixed(2)),
    risk_per_share: Number(risk.toFixed(2)),
    target: Number((entry + reward).toFixed(2)),
    reward_per_share: Number(reward.toFixed(2)),
    risk_reward: rr,
  };
}

function emptyState(symbol: string, mode: BullBarTradeMode, rr: number, market_open: boolean, notes: string): BullBarState {
  return {
    symbol,
    timeframe: "1H",
    phase: "Scanning",
    mode,
    rr,
    price: 0,
    asof: new Date().toISOString(),
    market_open,
    daily_sma20: 0,
    sma20_distance_pct: 0,
    in_pullback_band: false,
    decline_pct: 0,
    has_decline: false,
    cluster: null,
    bull_bar: null,
    confirmation: null,
    trade_plan: null,
    notes,
  };
}

// ─── Core evaluator ─────────────────────────────────────────────────────────

export async function evaluateBullBarMonitor(opts: BullBarEvalOpts = {}): Promise<BullBarState> {
  const symbol = (opts.symbol || "SMH").toUpperCase();
  const mode: BullBarTradeMode = opts.mode === "aggressive" ? "aggressive" : "conservative";
  const rr = [2, 3, 4, 5].includes(Number(opts.rr)) ? Number(opts.rr) : DEFAULT_RR_RATIO;
  const market_open = isMarketOpenET();

  // Pull data in parallel.
  const [dailyBars, intradayBars] = await Promise.all([
    safeHistory(symbol),
    fetch1HBars(symbol),
  ]);

  if (!dailyBars || dailyBars.length < 25) {
    return emptyState(symbol, mode, rr, market_open, "Insufficient daily history to compute SMA20.");
  }
  if (!intradayBars || intradayBars.length < CLUSTER_WINDOW + 2) {
    return emptyState(symbol, mode, rr, market_open, "Insufficient 1H history to evaluate pattern.");
  }

  const dailyCloses = dailyBars.map((b: DailyBar) => b.close);
  const dailySma20 = sma(dailyCloses, 20, dailyBars.length - 1);
  const lastIdx = intradayBars.length - 1;
  const current = intradayBars[lastIdx];
  const prior = intradayBars[lastIdx - 1];
  const currentPrice = current.close;

  const sma20Distance = ((currentPrice - dailySma20) / dailySma20) * 100;
  const inBand = Math.abs(sma20Distance) <= PULLBACK_BAND_PCT;

  const declinePct = computeDeclinePct(intradayBars, lastIdx);
  const hasDecline = declinePct <= -DECLINE_MIN_PCT;

  const baseState = emptyState(symbol, mode, rr, market_open, "");
  baseState.price = Number(currentPrice.toFixed(2));
  baseState.daily_sma20 = Number(dailySma20.toFixed(2));
  baseState.sma20_distance_pct = Number(sma20Distance.toFixed(2));
  baseState.in_pullback_band = inBand;
  baseState.decline_pct = Number(declinePct.toFixed(2));
  baseState.has_decline = hasDecline;

  const allowOffBand = !!opts.allow_off_band;

  // Gates 1+2: must be in pullback band AND have a recent decline. (Aggressive
  // mode keeps both gates — the only difference is the readiness trigger.)
  //
  // When allow_off_band is OFF — hard-fail outside the band, current behavior.
  // When ON — we still continue the detection so we can surface off-band
  // candidates as awareness cards. We never let off-band reach Ready-to-Trade.
  if (!inBand && !allowOffBand) {
    return { ...baseState, notes: `Price ${currentPrice.toFixed(2)} is ${sma20Distance.toFixed(2)}% from daily SMA20 ${dailySma20.toFixed(2)} — outside ±${PULLBACK_BAND_PCT}% pullback band.` };
  }
  if (!hasDecline) {
    return { ...baseState, notes: `In pullback band, but no short-term decline (${declinePct.toFixed(2)}% over last ${DECLINE_LOOKBACK} 1H bars). Need ≤ -${DECLINE_MIN_PCT}%.` };
  }

  // ── Case A: prior bar was a Confirmed Bull Bar → check confirmation/invalidation ──
  // We compute the cluster on the bar that precedes the bull bar (so we look at
  // the cluster BEFORE the strong bar formed).
  const priorIsStrong = isStrongBullBar(prior);
  if (priorIsStrong) {
    const priorClusterEnd = lastIdx - 2; // cluster up to the bar before the bull bar
    const cluster = findClusterOfLows(intradayBars, Math.max(0, priorClusterEnd));
    if (cluster) {
      const isClosed = !market_open || lastIdx > intradayBars.length - 1; // current is in progress until close
      const brokeHigh = current.high > prior.high || current.close > prior.high;
      const brokeLow = current.low < prior.low;

      let phase: BullBarPhase;
      let notes: string;
      let trade_plan: BullBarTradePlan | null = null;

      if (brokeLow) {
        phase = "Invalidated";
        notes = `Next 1H bar broke below bull-bar low ${prior.low.toFixed(2)}. Setup voided.`;
      } else if (!inBand) {
        // Off-band: still surface the confirmed bull bar with trade-plan math
        // (so the user can plan it manually) but mark it as awareness-only.
        phase = "Off-Band Confirmed Bull Bar";
        trade_plan = buildTradePlan(prior.high, prior.low, rr);
        notes = `Off-band: bull bar confirmed at ${sma20Distance.toFixed(2)}% from SMA20 (outside ±${PULLBACK_BAND_PCT}%). Awareness only — plan manually if you take it.`;
      } else if (brokeHigh) {
        phase = "Ready to Trade";
        trade_plan = buildTradePlan(prior.high, prior.low, rr);
        notes = `Trigger fired: price traded above bull-bar high ${prior.high.toFixed(2)}. Entry ${trade_plan.entry}, stop ${trade_plan.stop_loss}, target ${trade_plan.target} (1:${rr} R:R).`;
      } else if (mode === "aggressive") {
        // Aggressive mode: Ready to Trade as soon as Confirmed Bull Bar closes,
        // even before the next bar takes out its high.
        phase = "Ready to Trade";
        trade_plan = buildTradePlan(prior.high, prior.low, rr);
        notes = `Aggressive mode: ready immediately after confirmed bull bar close. Buy stop ${trade_plan.entry}, stop ${trade_plan.stop_loss}, target ${trade_plan.target} (1:${rr} R:R).`;
      } else {
        phase = "Confirmed Bull Bar";
        notes = `Bull bar confirmed at close. Waiting for next 1H bar to trade > ${prior.high.toFixed(2)} (conservative trigger).`;
      }

      return {
        ...baseState,
        phase,
        cluster,
        bull_bar: {
          timestamp: tsToIso(prior.time),
          open: Number(prior.open.toFixed(2)),
          high: Number(prior.high.toFixed(2)),
          low: Number(prior.low.toFixed(2)),
          close: Number(prior.close.toFixed(2)),
          volume: prior.volume,
          body_pct: Number(((prior.close - prior.open) / Math.max(prior.high - prior.low, 1e-9)).toFixed(3)),
          close_position: Number(((prior.close - prior.low) / Math.max(prior.high - prior.low, 1e-9)).toFixed(3)),
          is_closed: true,
        },
        confirmation: {
          timestamp: tsToIso(current.time),
          open: Number(current.open.toFixed(2)),
          high: Number(current.high.toFixed(2)),
          low: Number(current.low.toFixed(2)),
          close: Number(current.close.toFixed(2)),
          volume: current.volume,
          broke_high: brokeHigh,
          broke_low: brokeLow,
          is_closed: !market_open,
        },
        trade_plan,
        notes,
      };
    }
  }

  // ── Case B: current bar IS the bull bar (forming or just confirmed at close) ──
  const currentIsStrong = isStrongBullBar(current);
  const currentIsForming = isFormingBullBar(current);
  if (currentIsStrong || currentIsForming) {
    // Cluster lookup should end at the bar BEFORE the bull bar.
    const cluster = findClusterOfLows(intradayBars, Math.max(0, lastIdx - 1));
    if (cluster) {
      const isClosed = !market_open;
      let phase: BullBarPhase;
      let trade_plan: BullBarTradePlan | null = null;
      let notes: string;

      if (isClosed && currentIsStrong) {
        if (!inBand) {
          phase = "Off-Band Confirmed Bull Bar";
          trade_plan = buildTradePlan(current.high, current.low, rr);
          notes = `Off-band: bull bar closed at ${sma20Distance.toFixed(2)}% from SMA20 (outside ±${PULLBACK_BAND_PCT}%). Awareness only — plan manually if you take it.`;
        } else if (mode === "aggressive") {
          phase = "Ready to Trade";
          trade_plan = buildTradePlan(current.high, current.low, rr);
          notes = `Aggressive: bull bar closed; ready immediately. Buy stop ${trade_plan.entry}, stop ${trade_plan.stop_loss}, target ${trade_plan.target} (1:${rr} R:R).`;
        } else {
          phase = "Confirmed Bull Bar";
          notes = `Bull bar confirmed at close (body ${(((current.close - current.open) / (current.high - current.low)) * 100).toFixed(0)}%, close in top ${((1 - (current.high - current.close) / (current.high - current.low)) * 100).toFixed(0)}% of range). Wait for next 1H bar > ${current.high.toFixed(2)}.`;
        }
      } else {
        if (!inBand) {
          phase = "Off-Band Bull Bar Forming";
          notes = `Off-band: bull bar forming at ${sma20Distance.toFixed(2)}% from SMA20 (outside ±${PULLBACK_BAND_PCT}%). Awareness only — wait for close.`;
        } else {
          phase = "Bull Bar Forming";
          notes = `Bull bar forming live after cluster of ${cluster.bar_count} lows near ${cluster.swing_low.toFixed(2)} (${cluster.red_count} red). Wait for 1H close to confirm.`;
        }
      }

      return {
        ...baseState,
        phase,
        cluster,
        bull_bar: {
          timestamp: tsToIso(current.time),
          open: Number(current.open.toFixed(2)),
          high: Number(current.high.toFixed(2)),
          low: Number(current.low.toFixed(2)),
          close: Number(current.close.toFixed(2)),
          volume: current.volume,
          body_pct: Number(((current.close - current.open) / Math.max(current.high - current.low, 1e-9)).toFixed(3)),
          close_position: Number(((current.close - current.low) / Math.max(current.high - current.low, 1e-9)).toFixed(3)),
          is_closed: isClosed,
        },
        confirmation: null,
        trade_plan,
        notes,
      };
    }
  }

  // ── Case C: gates pass but no bull bar / no cluster ──
  const cluster = findClusterOfLows(intradayBars, lastIdx);
  return {
    ...baseState,
    cluster,
    notes: cluster
      ? `Pullback band ✓, decline ${declinePct.toFixed(2)}% ✓, cluster of ${cluster.bar_count} lows near ${cluster.swing_low.toFixed(2)} (${cluster.red_count} red) ✓ — waiting for a strong bull bar to print.`
      : `Pullback band ✓, decline ${declinePct.toFixed(2)}% ✓ — no clustered lows yet (need ${CLUSTER_MIN_BARS}+ lows within ±${CLUSTER_BAND_PCT}% incl. ≥ ${CLUSTER_MIN_REDS} red).`,
  };
}

// ─── Alert emission (writes to signal_history on phase transitions) ─────────

const lastEmittedKeys = new Map<string, string>();

export async function maybeEmitBullBarAlert(state: BullBarState): Promise<boolean> {
  if (!state.bull_bar) return false;
  const emittablePhases: BullBarPhase[] = [
    "Bull Bar Forming",
    "Confirmed Bull Bar",
    "Ready to Trade",
  ];
  if (!emittablePhases.includes(state.phase)) return false;

  const key = `${state.symbol}::${state.bull_bar.timestamp}::${state.mode}::${state.phase}`;
  if (lastEmittedKeys.get(state.symbol) === key) return false;

  try {
    const score =
      state.phase === "Ready to Trade" ? 95 :
      state.phase === "Confirmed Bull Bar" ? 75 : 55;
    const color =
      state.phase === "Ready to Trade" ? "#00E5A8" :
      state.phase === "Confirmed Bull Bar" ? "#7AC9FF" : "#FFD166";
    const ts = Math.floor(new Date(state.bull_bar.timestamp).getTime() / 1000) || Math.floor(Date.now() / 1000);
    await storage.createSignalHistory({
      ticker: state.symbol,
      patternType: "BullBar",
      timestamp: ts,
      setupCandleIndex: 0,
      confirmationCandleIndex: state.confirmation ? 1 : 0,
      setupCandleLow: state.bull_bar.low,
      confirmationCandleLow: state.confirmation?.low ?? state.bull_bar.low,
      confirmationClose: state.confirmation?.close ?? state.bull_bar.close,
      retestZoneUpper: state.bull_bar.high,
      retestZoneLower: state.bull_bar.low,
      score,
      scoreBreakdown: JSON.stringify([state.phase, "1H", state.cluster ? `cluster=${state.cluster.bar_count}` : "no-cluster"]),
      volume: state.confirmation?.volume ?? state.bull_bar.volume,
      volumeVsAverage20: 0,
      markerType: `bullbar_${state.phase.replace(/\s+/g, "_").toLowerCase()}`,
      markerPosition: state.bull_bar.low,
      color,
      soundPlayed: false,
      notificationSent: false,
      smaProximity: `sma20 ${state.daily_sma20.toFixed(2)} (${state.sma20_distance_pct.toFixed(2)}%)`,
      createdAt: new Date().toISOString(),
    });
    lastEmittedKeys.set(state.symbol, key);

    // Fan out to email/SMS/Telegram contacts.
    const dispatchPhase: "forming" | "confirmed" | null =
      state.phase === "Bull Bar Forming" ? "forming"
      : state.phase === "Confirmed Bull Bar" || state.phase === "Ready to Trade" ? "confirmed"
      : null;
    if (dispatchPhase) {
      const risk = Math.max(0, state.bull_bar.high - state.bull_bar.low);
      const entry = state.trade_plan?.entry ?? state.bull_bar.high;
      const stop = state.trade_plan?.stop_loss ?? state.bull_bar.low;
      dispatchHammerAlert({
        ticker: state.symbol,
        phase: dispatchPhase,
        mode: state.mode,
        candleTimestamp: state.bull_bar.timestamp,
        timeframe: "1H",
        price: state.price,
        entry,
        stop,
        rr2: risk > 0 ? entry + 2 * risk : undefined,
        rr3: risk > 0 ? entry + 3 * risk : undefined,
        rr4: risk > 0 ? entry + 4 * risk : undefined,
        rr5: risk > 0 ? entry + 5 * risk : undefined,
        setupNote: state.notes,
        patternName: "Bull Bar",
      }).catch((e) => console.warn("[bullBarMonitor] dispatch error:", e?.message || e));
    }
    return true;
  } catch (err) {
    console.warn("[bullBarMonitor] alert emit failed:", err);
    return false;
  }
}
