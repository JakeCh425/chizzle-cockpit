// ─────────────────────────────────────────────────────────────────────────────
// Confirmation candle detector — Hammer / Engulfing pattern recognition with
// confidence scoring. Logs every detection to signal_history (logging only, NOT
// a buy/sell trigger). Runs alongside the SMA20 alert engine on a slow timer.
//
// Pattern definitions (daily bars):
//   • HAMMER: long lower wick (>= 2× body), small upper wick (<= body), bullish
//             or slightly bearish close. Setup candle for the confirmation.
//   • ENGULFING: bullish candle whose body fully engulfs the prior bearish body
//             (open <= prior close, close >= prior open). Strongest 2-candle
//             bullish reversal pattern.
//
// Confirmation: the NEXT candle closes ABOVE the setup candle's high, with the
// retest zone defined as [setupLow, setupHigh].
//
// SMA proximity rule (extended per user spec):
//   The classic rule was "only fire when price is at or below SMA20."
//   The user now wants: also allow fires UP TO `SMA_ABOVE_PCT` above SMA20
//   (default 2.5%) AS LONG AS the same bullish hammer/engulfing pattern fires
//   on the prior red candle. This gives more setups in trending markets without
//   compromising the core strategy.
// ─────────────────────────────────────────────────────────────────────────────

import { storage } from "./storage";
import { safeHistory, type DailyBar } from "./marketData";
import type { InsertSignalHistory, SignalHistory } from "@shared/schema";
import { dispatchHammerAlert } from "./alert-dispatcher";

export type PatternType = "Hammer" | "Engulfing";

export interface MarkerData {
  index: number;
  type: "setup" | "confirmation";
  color: string;
  position: number; // price level for vertical placement
  label: string;
}

export interface AlertData {
  ticker: string;
  patternType: PatternType;
  score: number;
  message: string;
}

export interface DetectorOutput {
  detected: boolean;
  score: number;
  message: string;
  markers: MarkerData[];
  alert: AlertData | null;
  historyEntry: InsertSignalHistory | null;
}

// Tunable: how far ABOVE SMA20 we still allow a confirmation (in percent).
// User asked for "a couple percentages" — 2.5% is the default starting point.
const SMA_ABOVE_PCT = 0.025;

// ─── Helpers ────────────────────────────────────────────────────────────────
function sma(values: number[], period: number, at: number): number | null {
  if (at < period - 1) return null;
  let s = 0;
  for (let i = at - period + 1; i <= at; i++) s += values[i];
  return s / period;
}

function avgVolume(bars: DailyBar[], at: number, period: number): number {
  if (at < period - 1) return 0;
  let s = 0;
  for (let i = at - period + 1; i <= at; i++) s += bars[i].volume;
  return s / period;
}

// ─── Pattern primitives ─────────────────────────────────────────────────────
function isHammer(bar: DailyBar): boolean {
  const body = Math.abs(bar.close - bar.open);
  if (body === 0) return false; // doji, not a hammer
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  // Classic hammer: lower wick >= 2× body, upper wick <= body, body in upper third.
  return lowerWick >= body * 2 && upperWick <= body;
}

function isBullishEngulfing(prev: DailyBar, curr: DailyBar): boolean {
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  if (!prevBearish || !currBullish) return false;
  // Body engulfment (not just wicks).
  return curr.open <= prev.close && curr.close >= prev.open;
}

// ─── Core detector ──────────────────────────────────────────────────────────
// Scans the last N bars; if the LATEST bar is a confirmation of a prior
// Hammer or Engulfing setup, returns a DetectorOutput with detected=true.
export function detectConfirmation(ticker: string, bars: DailyBar[]): DetectorOutput {
  const empty: DetectorOutput = {
    detected: false, score: 0, message: "", markers: [], alert: null, historyEntry: null,
  };
  if (bars.length < 25) return empty;

  const closes = bars.map(b => b.close);
  const lastIdx = bars.length - 1;
  const confirmation = bars[lastIdx];
  const setup = bars[lastIdx - 1];
  const setupHigh = Math.max(setup.open, setup.close, setup.high);
  const setupLow = Math.min(setup.open, setup.close, setup.low);

  // Confirmation: latest close must clear setup high.
  if (confirmation.close <= setupHigh) return empty;

  // Identify pattern — Hammer on setup candle OR engulfing across (setup-1, setup).
  let patternType: PatternType | null = null;
  if (isHammer(setup)) patternType = "Hammer";
  else if (lastIdx >= 2 && isBullishEngulfing(bars[lastIdx - 2], setup)) patternType = "Engulfing";
  if (!patternType) return empty;

  // SMA20 proximity gate (extended): allow up to SMA_ABOVE_PCT above SMA20.
  const sma20 = sma(closes, 20, lastIdx);
  const sma50 = sma(closes, 50, lastIdx);
  if (sma20 == null) return empty;
  const distPctSigned = (confirmation.close - sma20) / sma20;
  // Below SMA20 is unrestricted (pullback territory).
  // Above SMA20 is allowed only up to SMA_ABOVE_PCT.
  if (distPctSigned > SMA_ABOVE_PCT) return empty;

  // ─── Confidence scoring (0–100) ───────────────────────────────────────────
  const breakdown: string[] = [];
  let score = 50; // base credit for fielding any valid setup

  // Pattern strength
  if (patternType === "Engulfing") { score += 15; breakdown.push("+15 Engulfing pattern (strongest 2-candle reversal)"); }
  else { score += 10; breakdown.push("+10 Hammer pattern"); }

  // SMA20 proximity quality
  if (distPctSigned <= 0) {
    score += 15;
    breakdown.push(`+15 At/below SMA20 (${(distPctSigned * 100).toFixed(2)}%) — classic pullback`);
  } else {
    // Above SMA20 — penalty scales with distance up to SMA_ABOVE_PCT.
    const aboveCredit = Math.round(10 * (1 - distPctSigned / SMA_ABOVE_PCT));
    score += aboveCredit;
    breakdown.push(`+${aboveCredit} Above SMA20 by ${(distPctSigned * 100).toFixed(2)}% (within tolerance)`);
  }

  // SMA50 trend filter
  if (sma50 != null && confirmation.close > sma50) {
    score += 10;
    breakdown.push("+10 Above SMA50 (uptrend intact)");
  } else if (sma50 != null) {
    score -= 5;
    breakdown.push("-5 Below SMA50 (counter-trend setup)");
  }

  // Volume confirmation
  const vol20 = avgVolume(bars, lastIdx, 20);
  const volRatio = vol20 > 0 ? confirmation.volume / vol20 : 1;
  if (volRatio >= 1.5) { score += 10; breakdown.push(`+10 Volume ${volRatio.toFixed(2)}× 20-day avg`); }
  else if (volRatio >= 1.0) { score += 5; breakdown.push(`+5 Volume ${volRatio.toFixed(2)}× 20-day avg`); }
  else { breakdown.push(`+0 Volume ${volRatio.toFixed(2)}× 20-day avg (weak)`); }

  // Body strength of confirmation candle
  const confBody = Math.abs(confirmation.close - confirmation.open);
  const confRange = confirmation.high - confirmation.low;
  const bodyPct = confRange > 0 ? confBody / confRange : 0;
  if (bodyPct >= 0.6) { score += 5; breakdown.push(`+5 Strong confirmation body (${(bodyPct * 100).toFixed(0)}% of range)`); }

  // Clamp to [0, 100]
  score = Math.max(0, Math.min(100, Math.round(score)));

  const smaProximity = distPctSigned >= 0
    ? `+${(distPctSigned * 100).toFixed(2)}% above SMA20`
    : `${(distPctSigned * 100).toFixed(2)}% below SMA20`;

  const message = `${ticker} · ${patternType} confirmation · close ${confirmation.close.toFixed(2)} · ${smaProximity} · score ${score}`;

  const markers: MarkerData[] = [
    { index: lastIdx - 1, type: "setup", color: "#FFB020", position: setupLow, label: `${patternType} setup` },
    { index: lastIdx, type: "confirmation", color: "#00E5A8", position: confirmation.close, label: `Confirm (${score})` },
  ];

  const historyEntry: InsertSignalHistory = {
    ticker,
    patternType,
    timestamp: confirmation.ts,
    setupCandleIndex: lastIdx - 1,
    confirmationCandleIndex: lastIdx,
    setupCandleLow: setupLow,
    confirmationCandleLow: confirmation.low,
    confirmationClose: confirmation.close,
    retestZoneUpper: setupHigh,
    retestZoneLower: setupLow,
    score,
    scoreBreakdown: JSON.stringify(breakdown),
    volume: confirmation.volume,
    volumeVsAverage20: vol20 > 0 ? volRatio : 0,
    markerType: "confirmation",
    markerPosition: confirmation.close,
    color: score >= 75 ? "#00E5A8" : score >= 60 ? "#FFB020" : "#94A3B8",
    soundPlayed: false,
    notificationSent: false,
    smaProximity,
    createdAt: new Date().toISOString(),
  };

  return {
    detected: true,
    score,
    message,
    markers,
    alert: { ticker, patternType, score, message },
    historyEntry,
  };
}

// ─── Persistence + scan loop ────────────────────────────────────────────────
const COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8h per (symbol, pattern)
const lastFiredAt = new Map<string, number>();

export async function scanSymbol(symbol: string): Promise<SignalHistory | null> {
  const bars = await safeHistory(symbol, false);
  if (bars.length < 25) return null;

  const out = detectConfirmation(symbol, bars);
  if (!out.detected || !out.historyEntry) return null;

  const key = `${symbol}:${out.historyEntry.patternType}`;
  const now = Date.now();
  const last = lastFiredAt.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) return null;
  lastFiredAt.set(key, now);

  // Persist + create cockpit alert. createSignalHistory is idempotent via
  // (ticker, pattern_type, timestamp) unique index, so re-runs are safe.
  const saved = await storage.createSignalHistory(out.historyEntry);
  if (saved && out.alert) {
    try {
      await storage.createAlert({
        ticker: symbol,
        type: `CONFIRMATION_${out.historyEntry.patternType.toUpperCase()}`,
        severity: out.score >= 75 ? "action" : "info",
        message: out.alert.message,
        firedAt: new Date().toISOString(),
        acknowledged: false,
      } as any);
    } catch (err) {
      console.warn("[confirmation-detector] createAlert failed:", (err as any)?.message || err);
    }

    // Fan out to email/SMS contacts. Candle-confirmation only fires when the next
    // bar closes above the setup high, so phase is always "confirmed".
    try {
      const setup = bars[bars.length - 2];
      const confirmation = bars[bars.length - 1];
      const entry = confirmation.close;
      const stop = Math.min(setup.open, setup.close, setup.low);
      const risk = Math.max(0, entry - stop);
      const tsIso = new Date((confirmation.ts || 0) * 1000).toISOString();
      dispatchHammerAlert({
        ticker: symbol,
        phase: "confirmed",
        mode: "conservative",
        candleTimestamp: tsIso,
        timeframe: "daily",
        price: confirmation.close,
        entry,
        stop,
        rr2: risk > 0 ? entry + 2 * risk : undefined,
        rr3: risk > 0 ? entry + 3 * risk : undefined,
        rr4: risk > 0 ? entry + 4 * risk : undefined,
        rr5: risk > 0 ? entry + 5 * risk : undefined,
        setupNote: out.alert.message,
      }).catch((e) => console.warn("[confirmation-detector] dispatch error:", e?.message || e));
    } catch (err) {
      console.warn("[confirmation-detector] dispatchHammerAlert prep failed:", (err as any)?.message || err);
    }
  }
  return saved;
}

let scanning = false;
async function scanOnce() {
  if (scanning) return;
  scanning = true;
  try {
    const wl = await storage.listWatchlist();
    if (wl.length === 0) return;
    const tickers = await storage.listTickers();
    const byId = new Map(tickers.map(t => [t.id, t.symbol]));
    for (const w of wl) {
      const sym = byId.get(w.tickerId);
      if (!sym) continue;
      try { await scanSymbol(sym); }
      catch (err) {
        console.warn(`[confirmation-detector] ${sym} failed:`, (err as any)?.message || err);
      }
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (err) {
    console.warn("[confirmation-detector] scanOnce failed:", (err as any)?.message || err);
  } finally {
    scanning = false;
  }
}

export async function triggerConfirmationScan() {
  await scanOnce();
}

let started = false;
export function startConfirmationDetector() {
  if (started) return;
  started = true;
  setTimeout(scanOnce, 45_000);          // first scan 45s after boot
  setInterval(scanOnce, 30 * 60 * 1000); // then every 30 minutes
  console.log("[confirmation-detector] engine started (30-min cadence)");
}

export const _internal = { detectConfirmation, isHammer, isBullishEngulfing, SMA_ABOVE_PCT };
