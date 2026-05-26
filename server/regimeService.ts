// ============================================================================
//  Regime Service — auto-classifies the macro tape into green/yellow/red using
//  real Yahoo Finance daily candles for SPY, QQQ, RSP, VIXY plus the live VIXY
//  tick from the Finnhub priceService. Persists results in regime_state and
//  regime_inputs (Section 01 of the Wealth Engine blueprint, Sections 1.2–1.5).
// ============================================================================
import { storage } from "./storage";
import type { InsertRegimeInputs } from "@shared/schema";
import { getQuote } from "./priceService";
import { getHistory, sma, computeSymbolMetrics, type DailyBar, type SymbolMetrics } from "./marketData";

export type RegimeCode = "green" | "yellow" | "red";
export type { DailyBar } from "./marketData";

const HISTORY_SYMBOLS = ["SPY", "QQQ", "RSP", "VIXY"] as const;
type HistorySymbol = typeof HISTORY_SYMBOLS[number];

// Count distribution days over the last 25 sessions:
//   close < prev_close * 0.99  AND  volume > prev_volume
function distributionDays(bars: DailyBar[]): { count: number; dates: string[] } {
  const dates: string[] = [];
  const n = bars.length;
  const start = Math.max(1, n - 25);
  for (let i = start; i < n; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (cur.close < prev.close * 0.99 && cur.volume > prev.volume) {
      dates.push(cur.date);
    }
  }
  return { count: dates.length, dates };
}

// Follow-through day: within last 25 sessions, find a day where
//   close >= prev_close * 1.015  AND  volume > prev_volume,
// occurring 4+ sessions AFTER a recent ≥5% pullback low.
function followThroughDay(bars: DailyBar[]): boolean {
  const n = bars.length;
  if (n < 30) return false;
  const win = bars.slice(Math.max(0, n - 25));
  // Find the recent pullback low within the window: a low that is ≥5% below
  // the rolling 25-bar max prior to it.
  let lowIdx = -1;
  for (let i = 0; i < win.length; i++) {
    const max = Math.max(...win.slice(0, i + 1).map(b => b.high));
    if (max > 0 && (max - win[i].low) / max >= 0.05) {
      lowIdx = i; // keep the latest qualifying low
    }
  }
  if (lowIdx < 0) return false;
  for (let i = lowIdx + 4; i < win.length; i++) {
    const prev = win[i - 1];
    const cur = win[i];
    const rallyPct = (cur.close - prev.close) / prev.close;
    if (rallyPct >= 0.015 && cur.volume > prev.volume) return true;
  }
  return false;
}

// Breadth proxy: 50 baseline, ±20 RSP-vs-50SMA, ±15 RSP/SPY ratio trend over 20 sessions.
function breadthProxy(rspBars: DailyBar[], spyBars: DailyBar[]): { pct: number; rspAbove50: boolean; ratioTrend: number } {
  const rspCloses = rspBars.map(b => b.close);
  const spyCloses = spyBars.map(b => b.close);
  const rspLast = rspCloses[rspCloses.length - 1] ?? 0;
  const rspSma50 = sma(rspCloses, 50, rspCloses.length - 1);
  const rspAbove50 = rspLast > rspSma50;

  let ratioTrend = 1;
  if (rspCloses.length >= 21 && spyCloses.length >= 21) {
    const now = rspCloses[rspCloses.length - 1] / spyCloses[spyCloses.length - 1];
    const then = rspCloses[rspCloses.length - 21] / spyCloses[spyCloses.length - 21];
    if (then > 0) ratioTrend = now / then;
  }

  let pct = 50;
  if (rspAbove50) pct += 20; else pct -= 20;
  if (ratioTrend > 1.02) pct += 15;
  else if (ratioTrend < 0.98) pct -= 15;
  pct = Math.max(0, Math.min(100, pct));
  return { pct, rspAbove50, ratioTrend };
}

// VIX (VIXY proxy) level + 5d slope.
function vixSnapshot(vixyBars: DailyBar[], liveLevel: number | null): { level: number; slope5d: number } {
  const closes = vixyBars.map(b => b.close);
  const n = closes.length;
  const lastDaily = n > 0 ? closes[n - 1] : 0;
  const level = liveLevel != null && liveLevel > 0 ? liveLevel : lastDaily;
  const slope5d = n >= 6 ? level - closes[n - 6] : 0;
  return { level, slope5d };
}

// ─── Classifier ────────────────────────────────────────────────────────────
export interface RawInputs {
  spy: SymbolMetrics;
  qqq: SymbolMetrics;
  breadthProxyPct: number;
  rspAbove50Sma: boolean;
  rspSpyRatioTrend: number;
  vixLevel: number;
  vixSlope5d: number;
  distributionDays: number;
  distributionDayDates: string[];
  followThroughDay: boolean;
}

export function classifyRegime(i: RawInputs): RegimeCode {
  // RED triggers (any)
  if (!i.spy.above_200) return "red";
  if (!i.qqq.above_200) return "red";
  if (i.breadthProxyPct < 40) return "red";
  if (i.vixLevel > 25) return "red";
  if (i.distributionDays >= 6) return "red";

  // GREEN (all must hold)
  const trendOk = i.spy.above_20 && i.spy.above_50 && i.spy.sma20_rising && i.spy.sma50_rising
    && i.qqq.above_20 && i.qqq.above_50 && i.qqq.sma20_rising && i.qqq.sma50_rising;
  if (trendOk
    && i.breadthProxyPct > 55
    && i.vixLevel < 18 && i.vixSlope5d <= 0
    && i.distributionDays <= 3) return "green";

  return "yellow";
}

// ─── Compute & persist ─────────────────────────────────────────────────────
export interface ComputeResult {
  raw: RawInputs;
  rawRegime: RegimeCode;
  effectiveRegime: RegimeCode;
  ok: boolean;
  error?: string;
}

async function safeHistory(symbol: HistorySymbol, forceRefresh: boolean): Promise<DailyBar[]> {
  try { return await getHistory(symbol, forceRefresh); }
  catch (e) { return []; }
}

export async function computeAndPersist(opts: { forceRefresh?: boolean; intraday?: boolean } = {}): Promise<ComputeResult> {
  const force = !!opts.forceRefresh;
  let lastError: string | undefined;

  let spyBars: DailyBar[] = [];
  let qqqBars: DailyBar[] = [];
  let rspBars: DailyBar[] = [];
  let vixyBars: DailyBar[] = [];

  try {
    [spyBars, qqqBars, rspBars, vixyBars] = await Promise.all([
      safeHistory("SPY", force),
      safeHistory("QQQ", force),
      safeHistory("RSP", force),
      safeHistory("VIXY", force),
    ]);
  } catch (e: any) {
    lastError = e?.message || String(e);
  }

  if (!spyBars.length || !qqqBars.length || !rspBars.length || !vixyBars.length) {
    lastError = lastError || "incomplete-data";
    await storage.updateRegimeState({ lastError, stale: true, lastClassifiedAt: new Date().toISOString() });
    // Without bars we can't classify. Return a benign yellow.
    const empty: SymbolMetrics = { price: 0, sma20: 0, sma50: 0, sma200: 0, sma20_rising: false, sma50_rising: false, above_20: false, above_50: false, above_200: false };
    const currentState = await storage.getRegimeState();
    return {
      raw: { spy: empty, qqq: empty, breadthProxyPct: 50, rspAbove50Sma: false, rspSpyRatioTrend: 1, vixLevel: 0, vixSlope5d: 0, distributionDays: 0, distributionDayDates: [], followThroughDay: false },
      rawRegime: "yellow",
      effectiveRegime: currentState.currentRegime as RegimeCode,
      ok: false,
      error: lastError,
    };
  }

  const spy = computeSymbolMetrics(spyBars);
  const qqq = computeSymbolMetrics(qqqBars);
  const distSpy = distributionDays(spyBars);
  const fts = followThroughDay(spyBars);
  const breadth = breadthProxy(rspBars, spyBars);

  // Use live VIXY tick when available (intraday recomputes), else yesterday's close.
  const liveVixy = getQuote("VIXY")?.price ?? null;
  const vix = vixSnapshot(vixyBars, liveVixy);

  const raw: RawInputs = {
    spy, qqq,
    breadthProxyPct: breadth.pct,
    rspAbove50Sma: breadth.rspAbove50,
    rspSpyRatioTrend: breadth.ratioTrend,
    vixLevel: vix.level,
    vixSlope5d: vix.slope5d,
    distributionDays: distSpy.count,
    distributionDayDates: distSpy.dates,
    followThroughDay: fts,
  };

  const rawRegime = classifyRegime(raw);

  // Persist inputs row
  const inputsRow: InsertRegimeInputs = {
    computedAt: new Date().toISOString(),
    spyPrice: spy.price,
    spySma20: spy.sma20,
    spySma50: spy.sma50,
    spySma200: spy.sma200,
    spySma20Rising: spy.sma20_rising,
    spySma50Rising: spy.sma50_rising,
    spyAbove20: spy.above_20,
    spyAbove50: spy.above_50,
    spyAbove200: spy.above_200,
    qqqPrice: qqq.price,
    qqqSma20: qqq.sma20,
    qqqSma50: qqq.sma50,
    qqqSma200: qqq.sma200,
    qqqSma20Rising: qqq.sma20_rising,
    qqqSma50Rising: qqq.sma50_rising,
    qqqAbove20: qqq.above_20,
    qqqAbove50: qqq.above_50,
    qqqAbove200: qqq.above_200,
    vixLevel: vix.level,
    vixSlope5d: vix.slope5d,
    breadthProxyPct: breadth.pct,
    rspAbove50Sma: breadth.rspAbove50,
    rspSpyRatioTrend: breadth.ratioTrend,
    distributionDays: distSpy.count,
    distributionDayDates: JSON.stringify(distSpy.dates),
    followThroughDay: fts,
    rawRegime,
  };
  await storage.appendRegimeInputs(inputsRow);

  // Update regime_state with 2-consecutive-close confirmation logic.
  const state = await storage.getRegimeState();
  const nowIso = new Date().toISOString();
  // Capture effective regime BEFORE the update — needed to detect shifts.
  const prevEffective: RegimeCode = state.manualOverride && state.manualOverrideRegime
    ? (state.manualOverrideRegime as RegimeCode)
    : (state.currentRegime as RegimeCode);
  let nextState = { ...state };

  if (rawRegime === state.currentRegime) {
    // raw matches current → clear pending
    nextState.pendingRegime = null;
    nextState.pendingSince = null;
    nextState.pendingConsecutiveCount = 0;
  } else if (state.pendingRegime === rawRegime) {
    // raw differs from current and matches pending → advance count
    const newCount = (state.pendingConsecutiveCount || 0) + 1;
    if (newCount >= 2) {
      // Promote
      nextState.currentRegime = rawRegime;
      nextState.currentRegimeSince = nowIso;
      nextState.pendingRegime = null;
      nextState.pendingSince = null;
      nextState.pendingConsecutiveCount = 0;
    } else {
      nextState.pendingConsecutiveCount = newCount;
    }
  } else {
    // raw differs from both current and pending → start new pending at 1
    nextState.pendingRegime = rawRegime;
    nextState.pendingSince = nowIso;
    nextState.pendingConsecutiveCount = 1;
  }
  nextState.lastClassifiedAt = nowIso;
  nextState.lastError = null;
  nextState.stale = false;

  await storage.updateRegimeState({
    currentRegime: nextState.currentRegime,
    currentRegimeSince: nextState.currentRegimeSince,
    pendingRegime: nextState.pendingRegime,
    pendingSince: nextState.pendingSince,
    pendingConsecutiveCount: nextState.pendingConsecutiveCount,
    lastClassifiedAt: nextState.lastClassifiedAt,
    lastError: null,
    stale: false,
  });

  // Mirror effective regime into settings.regime so legacy UI keeps working.
  const finalState = await storage.getRegimeState();
  _updateRegimeCache(finalState);
  const effective = finalState.manualOverride && finalState.manualOverrideRegime
    ? (finalState.manualOverrideRegime as RegimeCode)
    : (finalState.currentRegime as RegimeCode);
  try {
    await storage.updateSettings({
      regime: effective.toUpperCase(),
      regimeOverride: !!finalState.manualOverride,
      regimeChangedAt: finalState.currentRegimeSince,
    });
  } catch (e) { /* ignore */ }

  // ── REGIME_SHIFT_BYPASS alert ─────────────────────────────────────────
  // Fires when effective regime actually changed AND there is an open
  // position. Bypass-lane alert — always allowed regardless of new regime
  // (per regime_gate_spec.md "Always-on bypass lane").
  if (effective !== prevEffective) {
    try {
      const openTrades = await storage.listOpenTrades();
      if (openTrades.length > 0) {
        const tickers = openTrades.map(t => t.ticker).join(", ");
        await storage.createAlert({
          ticker: openTrades[0].ticker, // primary ticker; message lists all
          type: "REGIME_SHIFT_BYPASS",
          severity: "critical",
          message: `Regime shifted ${prevEffective.toUpperCase()} → ${effective.toUpperCase()} while holding ${openTrades.length} open position(s): ${tickers}. Review stops and exposure.`,
          firedAt: new Date().toISOString(),
        });
      }
    } catch (e) { /* ignore alert failure — don't break regime computation */ }
  }

  return { raw, rawRegime, effectiveRegime: effective, ok: true };
}

// ─── Scheduler ─────────────────────────────────────────────────────────────
let started = false;
let dailyTimer: NodeJS.Timeout | null = null;
let intradayTimer: NodeJS.Timeout | null = null;

function isMarketHoursET(now = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

function msUntilNext615pmET(): number {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const target = new Date(et);
  target.setHours(18, 15, 0, 0);
  if (target.getTime() <= et.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - et.getTime();
}

export function startRegimeScheduler() {
  if (started) return;
  started = true;
  console.log("[regimeService] scheduler starting");
  // Initial run on boot (don't block — fire-and-forget)
  computeAndPersist({ forceRefresh: true }).catch(e => console.warn("[regimeService] initial compute failed:", e?.message));

  // Daily at 6:15pm ET — schedule via setTimeout that re-arms after each run.
  const scheduleDaily = () => {
    if (dailyTimer) clearTimeout(dailyTimer);
    const delay = msUntilNext615pmET();
    dailyTimer = setTimeout(async () => {
      try { await computeAndPersist({ forceRefresh: true }); }
      catch (e: any) { console.warn("[regimeService] daily compute err:", e?.message); }
      scheduleDaily();
    }, delay);
  };
  scheduleDaily();

  // Intraday every 15 min during market hours.
  intradayTimer = setInterval(() => {
    if (!isMarketHoursET()) return;
    computeAndPersist({ forceRefresh: false, intraday: true })
      .catch(e => console.warn("[regimeService] intraday compute err:", e?.message));
  }, 15 * 60 * 1000);
}

export function stopRegimeScheduler() {
  started = false;
  if (dailyTimer) clearTimeout(dailyTimer);
  if (intradayTimer) clearInterval(intradayTimer);
}

// ─── Public read API ───────────────────────────────────────────────────────
// Cache for synchronous getEffectiveRegime access (updated after each async call)
let _cachedRegimeState: { currentRegime: string; manualOverride: boolean; manualOverrideRegime: string | null } = {
  currentRegime: "yellow",
  manualOverride: false,
  manualOverrideRegime: null,
};

// Update the cache whenever we read regime state
export function _updateRegimeCache(state: { currentRegime: string; manualOverride: boolean; manualOverrideRegime: string | null }) {
  _cachedRegimeState = state;
}

export function getEffectiveRegime(): { code: RegimeCode; source: "AUTO" | "MANUAL" } {
  const s = _cachedRegimeState;
  if (s.manualOverride && s.manualOverrideRegime) {
    return { code: s.manualOverrideRegime as RegimeCode, source: "MANUAL" };
  }
  return { code: s.currentRegime as RegimeCode, source: "AUTO" };
}
