// ============================================================================
//  Setup Service — server-side automatic detection of Trend-Pullback (Setup A)
//  and Breakout (Setup B) candidates on the 6 Tier 1 watchlist tickers.
//  Implements the qualification rules from blueprint Section 02 exactly.
// ============================================================================
import { storage } from "./storage";
import {
  classifyQuality,
  computeRelativeStrength,
  computeTrendStrength,
  computeVolumeScore,
  computeCleanlinessScore,
  computeMarketAlignment,
} from "./qualityClassifier";
import { getQuote } from "./priceService";
import { getEffectiveRegime } from "./regimeService";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import {
  getHistory,
  safeHistory,
  computeSymbolMetrics,
  sma,
  ema,
  atr,
  consecutiveAboveRising50SMA,
  type DailyBar,
} from "./marketData";

// Proxy plumbing (mirrors priceService) so Finnhub earnings calendar gets
// the X-Finnhub-Token injected by the credential proxy.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyDispatcher = PROXY_URL ? new ProxyAgent({ uri: PROXY_URL }) : null;
async function proxiedFetch(url: string, init: any = {}) {
  if (proxyDispatcher) {
    return undiciFetch(url, { ...init, dispatcher: proxyDispatcher });
  }
  return fetch(url, init);
}

// Tier 1 tickers we scan.
const WATCHLIST_SYMS = ["SMH", "QQQ", "SPY", "IWM", "AAPL", "META"];

// Mega-cap vs semis/IWM groups — used for variable pullback / base depth bands.
const MEGA_CAP = new Set(["AAPL", "META", "QQQ", "SPY"]);
const SEMIS_OR_IWM = new Set(["SMH", "IWM"]);

export type SetupKind = "trend_pullback" | "breakout";
export type SetupState =
  | "dormant" | "building" | "approaching" | "in_zone" | "armed" | "live" | "invalidated";

export interface QualificationDetail {
  name: string;
  passed: boolean;
  value: string;
  threshold: string;
}

export interface SetupCandidate {
  ticker: string;
  setup: SetupKind;
  state: SetupState;
  qualificationsPassed: number;
  qualificationsTotal: number;
  qualificationDetails: QualificationDetail[];
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
  rrToT1: number | null;
  atr14: number;
  swingHigh?: number;
  pullbackPct?: number;
  basePivot?: number;
  baseDepth?: number;
  baseLength?: number;
  triggerFired: boolean;
  triggerNote: string | null;
  disqualifiers: string[];
  lastComputedAt: string;
  regimeEligible: boolean;
  regimeBlockedReason: string | null;
  // Quality classification (Batch 2)
  relativeStrength?: number;
  trendStrength?: number;
  volumeScore?: number;
  cleanlinessScore?: number;
  marketAlignment?: boolean;
  earningsRisk?: boolean;
  quality?: "A" | "B" | "C";
  qualityReason?: string;
}

// Regime gate helpers (server-side source of truth)
export function regimeBlockReason(
  regime: "green" | "yellow" | "red",
  setup: SetupKind,
): string | null {
  if (regime === "green") return null;
  if (regime === "yellow") {
    if (setup === "breakout") return "YELLOW regime — breakouts disabled";
    return null;
  }
  // red
  return "RED regime — capital protection, no new entries";
}

// ─── Earnings calendar cache (Finnhub) ───────────────────────────────────
interface EarningsEntry { symbol: string; date: string; }
const earningsCache = new Map<string, { entries: EarningsEntry[]; cacheDate: string }>();

function todayET(): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.toISOString().slice(0, 10);
}

function addBusinessDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

async function getEarningsWithin5d(ticker: string): Promise<EarningsEntry[]> {
  const today = todayET();
  const cached = earningsCache.get(ticker);
  if (cached && cached.cacheDate === today) return cached.entries;
  try {
    const start = new Date();
    const end = addBusinessDays(new Date(), 5);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}`;
    const res = await proxiedFetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      earningsCache.set(ticker, { entries: [], cacheDate: today });
      return [];
    }
    const j: any = await res.json();
    const entries: EarningsEntry[] = (j?.earningsCalendar || []).map((e: any) => ({
      symbol: e.symbol, date: e.date,
    }));
    earningsCache.set(ticker, { entries, cacheDate: today });
    return entries;
  } catch (e: any) {
    console.warn(`[setupService] earnings fetch failed for ${ticker}:`, e?.message || e);
    earningsCache.set(ticker, { entries: [], cacheDate: today });
    return [];
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function isMarketHoursET(now = new Date()): boolean {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 9 * 60 + 30 && m < 16 * 60;
}

function msUntilNext620pmET(): number {
  // 5 minutes after the regime engine runs, so daily bars + regime are fresh.
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const target = new Date(et);
  target.setHours(18, 20, 0, 0);
  if (target.getTime() <= et.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - et.getTime();
}

// Find swing high in the last `lookback` sessions: bar i (0..lookback-1 from end)
// whose high exceeds the highest high of the 5 bars before AND 5 bars after.
// For "recent" allow lookback-only swing where current pullback is the right side.
function findRecentSwingHigh(bars: DailyBar[], lookback = 10):
  { idx: number; high: number; pullbackPct: number } | null {
  const n = bars.length;
  if (n < 20) return null;
  const lastIdx = n - 1;
  const curPrice = bars[lastIdx].close;
  // Walk from most-recent-but-stable region (skip current bar itself); accept
  // either two-sided (5 before + 5 after) or lookback-only (current bar pulls back).
  let best: { idx: number; high: number; pullbackPct: number } | null = null;
  for (let i = lastIdx - 1; i >= Math.max(0, lastIdx - lookback); i--) {
    const hi = bars[i].high;
    // Left side: previous 5 highs must be lower
    let leftOk = true;
    for (let k = 1; k <= 5; k++) {
      const j = i - k;
      if (j < 0) { leftOk = false; break; }
      if (bars[j].high >= hi) { leftOk = false; break; }
    }
    if (!leftOk) continue;
    // Right side: subsequent bars (up to lastIdx) must not exceed
    let rightOk = true;
    for (let k = i + 1; k <= lastIdx; k++) {
      if (bars[k].high >= hi) { rightOk = false; break; }
    }
    if (!rightOk) continue;
    const pullbackPct = ((hi - curPrice) / hi) * 100;
    if (!best || pullbackPct > 0) { best = { idx: i, high: hi, pullbackPct }; break; }
  }
  return best;
}

// Identify the most recent base by walking backward from the most recent bar.
function findRecentBase(bars: DailyBar[]):
  { startIdx: number; endIdx: number; high: number; low: number; depthPct: number; length: number } | null {
  const n = bars.length;
  if (n < 16) return null;
  const lookback = Math.min(60, n);
  // The local high in the last lookback sessions
  let hiIdx = n - lookback;
  let hi = bars[hiIdx].high;
  for (let i = n - lookback; i < n; i++) {
    if (bars[i].high > hi) { hi = bars[i].high; hiIdx = i; }
  }
  // Walk backward from end: collect contiguous range where price stayed within +/-15% of the high.
  const tolerance = 0.15;
  let startIdx = n - 1;
  let endIdx = n - 1;
  // Walk back from end while bars are within tolerance and we don't find a higher high
  let lo = bars[n - 1].low;
  let maxHi = bars[n - 1].high;
  for (let i = n - 2; i >= Math.max(0, n - lookback); i--) {
    const b = bars[i];
    if (b.high > maxHi * (1 + 0.005)) {
      // a higher high appeared mid-base — reject continuing further
      break;
    }
    if (b.low < hi * (1 - tolerance)) break;
    if (b.high > maxHi) maxHi = b.high;
    if (b.low < lo) lo = b.low;
    startIdx = i;
  }
  const length = endIdx - startIdx + 1;
  if (length < 15) return null;
  const depthPct = (maxHi - lo) / maxHi;
  return { startIdx, endIdx, high: maxHi, low: lo, depthPct, length };
}

// Volume comparison helper
function avgVolume(bars: DailyBar[], from: number, to: number): number {
  let s = 0; let c = 0;
  for (let i = from; i <= to; i++) {
    if (i < 0 || i >= bars.length) continue;
    s += bars[i].volume; c++;
  }
  return c > 0 ? s / c : 0;
}

// Number of bars within 0.5% of baseHigh (resistance tests).
function countResistanceTests(bars: DailyBar[], from: number, to: number, baseHigh: number): number {
  let count = 0;
  for (let i = from; i <= to; i++) {
    if (i < 0 || i >= bars.length) continue;
    if (Math.abs(bars[i].high - baseHigh) / baseHigh <= 0.005) count++;
  }
  return count;
}

// 3-month % return (≈ 63 sessions).
function threeMonthReturn(bars: DailyBar[]): number {
  const n = bars.length;
  if (n < 64) return 0;
  const prev = bars[n - 64].close;
  const now = bars[n - 1].close;
  if (prev <= 0) return 0;
  return ((now - prev) / prev) * 100;
}

// ─── State classifier ─────────────────────────────────────────────────────
function classifyState(args: {
  passed: number;
  total: number;
  disqualifiers: string[];
  lp: number;
  zoneLow: number | null;
  zoneHigh: number | null;
  triggerFired: boolean;
  hasOpenTrade: boolean;
  invalidated: boolean;
  regimeEligible: boolean;
}): SetupState {
  if (args.hasOpenTrade) return "live";
  if (args.invalidated) return "invalidated";
  if (args.disqualifiers.length > 0) return "dormant";
  // Regime-blocked setups never reach ARMED — downgrade to the lower state.
  if (args.triggerFired && args.regimeEligible) return "armed";
  if (args.zoneLow != null && args.zoneHigh != null) {
    if (args.lp >= args.zoneLow && args.lp <= args.zoneHigh) return "in_zone";
    const pctToZone = ((args.zoneLow - args.lp) / args.lp) * 100;
    // approaching: within 2% (above OR below zone — both directions)
    if (args.passed === args.total && Math.abs(pctToZone) <= 2) return "approaching";
  }
  if (args.passed === args.total) return "approaching"; // qualified but far from zone — treat as approaching
  if (args.passed >= Math.ceil(args.total * 0.6)) return "building";
  return "dormant";
}

// ─── Setup A — Trend-Pullback ─────────────────────────────────────────────
async function detectTrendPullback(ticker: string, bars: DailyBar[], lp: number, atrPct: number, disq: string[], regimeCode: "green" | "yellow" | "red"): Promise<SetupCandidate> {
  const details: QualificationDetail[] = [];
  const n = bars.length;
  const closes = bars.map(b => b.close);
  const lastIdx = n - 1;
  const sma20 = sma(closes, 20, lastIdx);
  const sma50 = sma(closes, 50, lastIdx);
  const sma200 = sma(closes, 200, lastIdx);
  const ema10 = ema(closes, 10, lastIdx);
  const atr14 = atr(bars, 14, lastIdx);

  // 1. ≥ 20 consecutive sessions above rising 50 SMA
  const consec = consecutiveAboveRising50SMA(bars);
  const q1 = consec >= 20;
  details.push({ name: "≥20 sessions above rising 50 SMA", passed: q1, value: `${consec} sessions`, threshold: "≥20" });

  // 2. Trend stack 20>50>200
  const q2 = sma20 > sma50 && sma50 > sma200;
  details.push({ name: "Trend stack 20 > 50 > 200 SMA", passed: q2, value: `${sma20.toFixed(2)} / ${sma50.toFixed(2)} / ${sma200.toFixed(2)}`, threshold: "20>50>200" });

  // 3. Recent swing high within last 10 sessions
  const swing = findRecentSwingHigh(bars, 10);
  const q3 = !!swing;
  details.push({ name: "Recent swing high within 10 sessions", passed: q3, value: swing ? `H=${swing.high.toFixed(2)} (${lastIdx - swing.idx}d ago)` : "none", threshold: "≤10d" });

  // 4. Pullback band
  const isMega = MEGA_CAP.has(ticker);
  const pullbackLow = isMega ? 3 : 5;
  const pullbackHigh = isMega ? 8 : 12;
  const pullbackPct = swing ? swing.pullbackPct : 0;
  const q4 = swing != null && pullbackPct >= pullbackLow && pullbackPct <= pullbackHigh;
  details.push({ name: "Pullback depth in band", passed: q4, value: `${pullbackPct.toFixed(2)}%`, threshold: `${pullbackLow}–${pullbackHigh}%` });

  // 5. Price within 1.0 × ATR of max(20SMA, 10EMA)
  const anchor = Math.max(sma20, ema10);
  const distAtr = atr14 > 0 ? Math.abs(lp - anchor) / atr14 : 999;
  const q5 = atr14 > 0 && distAtr <= 1.0;
  details.push({ name: "Price within 1.0 × ATR of anchor", passed: q5, value: `${distAtr.toFixed(2)} ATR (anchor ${anchor.toFixed(2)})`, threshold: "≤1.0 ATR" });

  // 6. Volume on pullback < volume on prior advance
  let vPull = 0; let vAdv = 0;
  if (swing) {
    vPull = avgVolume(bars, lastIdx - 2, lastIdx);
    vAdv = avgVolume(bars, swing.idx - 3, swing.idx - 1);
  }
  const q6 = vPull > 0 && vAdv > 0 && vPull < vAdv;
  details.push({ name: "Pullback volume < advance volume", passed: q6, value: vPull && vAdv ? `${(vPull/1e6).toFixed(1)}M vs ${(vAdv/1e6).toFixed(1)}M` : "n/a", threshold: "pullback < advance" });

  const passed = details.filter(d => d.passed).length;

  // Compute entry/stop/targets (always — even when not fully qualified, show what they'd be)
  let entryZoneLow: number | null = null;
  let entryZoneHigh: number | null = null;
  let stop: number | null = null;
  let t1: number | null = null;
  let t2: number | null = null;
  let rrToT1: number | null = null;
  if (atr14 > 0 && anchor > 0 && swing) {
    entryZoneLow = +(anchor - 0.25 * atr14).toFixed(2);
    entryZoneHigh = +(anchor + 0.50 * atr14).toFixed(2);
    // Pullback low — lowest low between swing idx and now
    let pullbackLowVal = bars[lastIdx].low;
    for (let i = swing.idx; i <= lastIdx; i++) {
      if (bars[i].low < pullbackLowVal) pullbackLowVal = bars[i].low;
    }
    stop = +(Math.min(pullbackLowVal, sma20) - 0.25 * atr14).toFixed(2);
    t1 = +swing.high.toFixed(2);
    // measuredMove = swingHigh − pullbackStartLow. Use the low of the bar 3 prior to swing as pullbackStartLow proxy.
    const advLowIdx = Math.max(0, swing.idx - 10);
    let advLow = bars[advLowIdx].low;
    for (let i = advLowIdx; i < swing.idx; i++) if (bars[i].low < advLow) advLow = bars[i].low;
    const measuredMove = swing.high - advLow;
    const entryProxy = (entryZoneLow + entryZoneHigh) / 2;
    t2 = +(entryProxy + measuredMove).toFixed(2);
    const risk = entryProxy - stop;
    rrToT1 = risk > 0 ? +((t1 - entryProxy) / risk).toFixed(2) : null;
  }

  // Trigger: live LP reclaims PDH while inside the entry zone band
  const pdh = n >= 2 ? bars[n - 2].high : 0;
  const inZone = entryZoneLow != null && entryZoneHigh != null && lp >= entryZoneLow && lp <= entryZoneHigh;
  const triggerFired = passed === details.length && inZone && lp >= pdh;
  const triggerNote = triggerFired ? `LP ${lp.toFixed(2)} reclaimed PDH ${pdh.toFixed(2)} inside zone` : null;

  // Invalidation check: closed below 50 SMA or pullback exceeded band
  let invalidated = false;
  if (q1 && bars[lastIdx].close < sma50) invalidated = true;
  if (swing && pullbackPct > pullbackHigh + 2) invalidated = true;

  const hasOpenTrade = storage.listOpenTrades().some(t => t.ticker === ticker && t.setup === "TREND_PULLBACK");

  const blockedReason = regimeBlockReason(regimeCode, "trend_pullback");
  const regimeEligible = blockedReason === null;

  const state = classifyState({
    passed, total: details.length, disqualifiers: disq,
    lp, zoneLow: entryZoneLow, zoneHigh: entryZoneHigh,
    triggerFired, hasOpenTrade, invalidated, regimeEligible,
  });

  return {
    ticker, setup: "trend_pullback", state,
    qualificationsPassed: passed, qualificationsTotal: details.length,
    qualificationDetails: details,
    entryZoneLow, entryZoneHigh, stop, t1, t2, rrToT1,
    atr14: +atr14.toFixed(3),
    swingHigh: swing?.high,
    pullbackPct: swing ? +pullbackPct.toFixed(2) : undefined,
    triggerFired, triggerNote,
    disqualifiers: disq,
    lastComputedAt: new Date().toISOString(),
    regimeEligible,
    regimeBlockedReason: blockedReason,
  };
}

// ─── Setup B — Breakout ───────────────────────────────────────────────────
async function detectBreakout(ticker: string, bars: DailyBar[], spyBars: DailyBar[], smhBars: DailyBar[], lp: number, atrPct: number, disq: string[], regimeCode: "green" | "yellow" | "red"): Promise<SetupCandidate> {
  const details: QualificationDetail[] = [];
  const n = bars.length;
  const closes = bars.map(b => b.close);
  const lastIdx = n - 1;
  const sma50 = sma(closes, 50, lastIdx);
  const sma50Prev = sma(closes, 50, Math.max(0, lastIdx - 5));
  const atr14 = atr(bars, 14, lastIdx);
  const base = findRecentBase(bars);

  // 1. Base depth band
  const isMega = MEGA_CAP.has(ticker);
  const depthMax = isMega ? 0.15 : 0.20;
  const depth = base ? base.depthPct : 1;
  const q1 = !!base && depth <= depthMax;
  details.push({ name: "Base depth within band", passed: q1, value: base ? `${(depth*100).toFixed(2)}%` : "no base", threshold: `≤${(depthMax*100).toFixed(0)}%` });

  // 2. Base length
  const baseLen = base?.length ?? 0;
  const q2 = baseLen >= 15;
  details.push({ name: "Base length ≥ 15 sessions", passed: q2, value: `${baseLen}`, threshold: "≥15" });

  // 3. Resistance tests (≥ 2 within 0.5% of baseHigh)
  const tests = base ? countResistanceTests(bars, base.startIdx, base.endIdx, base.high) : 0;
  const q3 = tests >= 2;
  details.push({ name: "≥2 resistance tests within 0.5%", passed: q3, value: `${tests}`, threshold: "≥2" });

  // 4. Volume contraction (last 5 in base < first 5)
  let vLast5 = 0; let vFirst5 = 0;
  if (base) {
    vLast5 = avgVolume(bars, base.endIdx - 4, base.endIdx);
    vFirst5 = avgVolume(bars, base.startIdx, base.startIdx + 4);
  }
  const q4 = vLast5 > 0 && vFirst5 > 0 && vLast5 < vFirst5;
  details.push({ name: "Volume contraction in base", passed: q4, value: vLast5 && vFirst5 ? `${(vLast5/1e6).toFixed(1)}M vs ${(vFirst5/1e6).toFixed(1)}M` : "n/a", threshold: "last5 < first5" });

  // 5. Close above rising 50 SMA
  const q5 = closes[lastIdx] > sma50 && sma50 > sma50Prev;
  details.push({ name: "Close above rising 50 SMA", passed: q5, value: `${closes[lastIdx].toFixed(2)} > ${sma50.toFixed(2)} (rising)`, threshold: "rising" });

  // 6. Relative strength: 3-mo return > SPY (or SMH > SPY for semis context)
  const myRet = threeMonthReturn(bars);
  const spyRet = threeMonthReturn(spyBars);
  const smhRet = threeMonthReturn(smhBars);
  let q6 = myRet > spyRet;
  if (!q6 && SEMIS_OR_IWM.has(ticker)) q6 = smhRet > spyRet;
  details.push({ name: "3-mo RS > SPY", passed: q6, value: `${myRet.toFixed(2)}% vs SPY ${spyRet.toFixed(2)}%`, threshold: "ticker > SPY" });

  const passed = details.filter(d => d.passed).length;

  // Compute entry/stop/targets
  let entryZoneLow: number | null = null;
  let entryZoneHigh: number | null = null;
  let stop: number | null = null;
  let t1: number | null = null;
  let t2: number | null = null;
  let rrToT1: number | null = null;
  let basePivot: number | null = null;
  if (base && atr14 > 0) {
    basePivot = +(base.high * 1.001).toFixed(2);
    entryZoneLow = basePivot;
    entryZoneHigh = +(basePivot + 0.5 * atr14).toFixed(2);
    // stop = max(pivot − 1.0×ATR, baseLow) — whichever is tighter (HIGHER)
    stop = +Math.max(basePivot - 1.0 * atr14, base.low).toFixed(2);
    const entryProxy = basePivot;
    const risk = entryProxy - stop;
    t1 = +(entryProxy + 2 * risk).toFixed(2);
    const measuredMove = base.high - base.low;
    t2 = +(entryProxy + measuredMove).toFixed(2);
    rrToT1 = risk > 0 ? +((t1 - entryProxy) / risk).toFixed(2) : null;
  }

  // Trigger: LP above pivot + today's session high already above pivot
  const sessionHigh = getQuote(ticker)?.high ?? 0;
  const triggerFired = passed === details.length && basePivot != null && (lp > basePivot || sessionHigh > basePivot);
  const triggerNote = triggerFired ? `LP ${lp.toFixed(2)} above pivot ${basePivot?.toFixed(2)}` : null;

  // Invalidation: closed below 50 SMA
  const invalidated = closes[lastIdx] < sma50;

  const hasOpenTrade = storage.listOpenTrades().some(t => t.ticker === ticker && t.setup === "BREAKOUT");

  const blockedReason = regimeBlockReason(regimeCode, "breakout");
  const regimeEligible = blockedReason === null;

  const state = classifyState({
    passed, total: details.length, disqualifiers: disq,
    lp, zoneLow: entryZoneLow, zoneHigh: entryZoneHigh,
    triggerFired, hasOpenTrade, invalidated, regimeEligible,
  });

  return {
    ticker, setup: "breakout", state,
    qualificationsPassed: passed, qualificationsTotal: details.length,
    qualificationDetails: details,
    entryZoneLow, entryZoneHigh, stop, t1, t2, rrToT1,
    atr14: +atr14.toFixed(3),
    basePivot: basePivot ?? undefined,
    baseDepth: base ? +(base.depthPct * 100).toFixed(2) : undefined,
    baseLength: base?.length,
    triggerFired, triggerNote,
    disqualifiers: disq,
    lastComputedAt: new Date().toISOString(),
    regimeEligible,
    regimeBlockedReason: blockedReason,
  };
}

// ─── Public detect functions ──────────────────────────────────────────────
export async function detectSetups(ticker: string, opts: { forceRefresh?: boolean } = {}): Promise<SetupCandidate[]> {
  const force = !!opts.forceRefresh;
  const sym = ticker.toUpperCase();
  const regimeCode = getEffectiveRegime().code;
  const bars = await safeHistory(sym, force);
  if (!bars.length) {
    // mark dormant with data_unavailable disqualifier
    const stale: SetupCandidate[] = (["trend_pullback", "breakout"] as SetupKind[]).map(k => {
      const blockedReason = regimeBlockReason(regimeCode, k);
      return {
        ticker: sym, setup: k, state: "dormant" as SetupState,
        qualificationsPassed: 0, qualificationsTotal: 6, qualificationDetails: [],
        entryZoneLow: null, entryZoneHigh: null, stop: null, t1: null, t2: null, rrToT1: null,
        atr14: 0, triggerFired: false, triggerNote: null,
        disqualifiers: ["data_unavailable"],
        lastComputedAt: new Date().toISOString(),
        regimeEligible: blockedReason === null,
        regimeBlockedReason: blockedReason,
      };
    });
    return stale;
  }
  // Build common disqualifier set
  const disq: string[] = [];
  const lp = getQuote(sym)?.price ?? bars[bars.length - 1].close;
  const atr14 = atr(bars, 14, bars.length - 1);
  const atrPct = lp > 0 ? (atr14 / lp) * 100 : 0;
  if (atrPct > 0 && atrPct < 1.0) disq.push("low_atr");
  // Intraday: down >2% disqualifier
  const q = getQuote(sym);
  if (q && q.changePct < -2) disq.push("down_2pct");
  // Earnings
  const earnings = await getEarningsWithin5d(sym);
  if (earnings.length > 0) disq.push("earnings_window");
  // SPY bars for RS comparison
  const [spyBars, smhBars] = await Promise.all([safeHistory("SPY", false), safeHistory("SMH", false)]);
  const a = await detectTrendPullback(sym, bars, lp, atrPct, disq, regimeCode);
  const b = await detectBreakout(sym, bars, spyBars, smhBars, lp, atrPct, disq, regimeCode);

  // ─── Quality classification (Batch 2) ────────────────────────────────
  // Compute scores once per ticker and stamp both candidates with quality.
  const earningsRisk = earnings.length > 0;
  const relativeStrength = computeRelativeStrength(bars as any, spyBars as any);
  const trendStrength = computeTrendStrength(bars as any);
  const volumeScore = computeVolumeScore(bars as any);
  const cleanlinessScore = computeCleanlinessScore(bars as any);
  const marketAlignment = computeMarketAlignment(spyBars as any);
  const quality = classifyQuality({
    relativeStrength, trendStrength, volumeScore, cleanlinessScore,
    marketAlignment, earningsRisk,
  });
  for (const c of [a, b]) {
    c.relativeStrength = relativeStrength;
    c.trendStrength = trendStrength;
    c.volumeScore = volumeScore;
    c.cleanlinessScore = cleanlinessScore;
    c.marketAlignment = marketAlignment;
    c.earningsRisk = earningsRisk;
    c.quality = quality.grade;
    c.qualityReason = quality.reason;
  }

  return [a, b];
}

export async function getAllSetups(opts: { forceRefresh?: boolean } = {}): Promise<Record<string, SetupCandidate[]>> {
  const results = await Promise.all(WATCHLIST_SYMS.map(s => detectSetups(s, opts)));
  const out: Record<string, SetupCandidate[]> = {};
  for (let i = 0; i < WATCHLIST_SYMS.length; i++) out[WATCHLIST_SYMS[i]] = results[i];
  return out;
}

// ─── Alert / transition emission ───────────────────────────────────────────
const sessionTriggerCount = new Map<string, number>(); // key = `${ticker}:${sessionDate}`
const sessionBlockedTriggerCount = new Map<string, number>(); // key = `${ticker}:${setup}:${sessionDate}`

function shouldFireTrigger(ticker: string): boolean {
  const key = `${ticker}:${todayET()}`;
  const count = sessionTriggerCount.get(key) || 0;
  if (count >= 1) return false;
  sessionTriggerCount.set(key, count + 1);
  return true;
}

function shouldFireBlockedTrigger(ticker: string, setup: SetupKind): boolean {
  const key = `${ticker}:${setup}:${todayET()}`;
  const count = sessionBlockedTriggerCount.get(key) || 0;
  if (count >= 1) return false;
  sessionBlockedTriggerCount.set(key, count + 1);
  return true;
}

function emitTransitionAlert(c: SetupCandidate, prevState: SetupState) {
  // Suppress redundant alerts when current state is same as prev (transition dedupe).
  if (prevState === c.state) return;
  const setupLabel = c.setup === "trend_pullback" ? "Trend-Pullback" : "Breakout";
  if (c.state === "approaching") {
    storage.createAlert({
      ticker: c.ticker, type: "APPROACHING_ZONE", severity: "info",
      message: `${c.ticker} ${setupLabel} approaching entry zone $${c.entryZoneLow?.toFixed(2)}–$${c.entryZoneHigh?.toFixed(2)}`,
      firedAt: new Date().toISOString(),
    });
  } else if (c.state === "in_zone") {
    storage.createAlert({
      ticker: c.ticker, type: "IN_ZONE", severity: "action",
      message: `${c.ticker} ${setupLabel} inside entry zone $${c.entryZoneLow?.toFixed(2)}–$${c.entryZoneHigh?.toFixed(2)}`,
      firedAt: new Date().toISOString(),
    });
  } else if (c.state === "armed") {
    if (shouldFireTrigger(c.ticker)) {
      storage.createAlert({
        ticker: c.ticker, type: "trigger_fired", severity: "action",
        message: `${c.ticker} ${setupLabel} trigger fired — ${c.triggerNote || "trigger condition met"}`,
        firedAt: new Date().toISOString(),
      });
    }
  } else if (c.state === "invalidated") {
    storage.createAlert({
      ticker: c.ticker, type: "INVALIDATED", severity: "info",
      message: `${c.ticker} ${setupLabel} invalidated — closed below 50 SMA or pullback band breached`,
      firedAt: new Date().toISOString(),
    });
  }
  // Record transition history
  storage.recordSetupTransition({
    ticker: c.ticker, setup: c.setup,
    prevState, newState: c.state,
    transitionedAt: new Date().toISOString(),
    details: JSON.stringify({
      qualificationsPassed: c.qualificationsPassed,
      qualificationsTotal: c.qualificationsTotal,
      entryZoneLow: c.entryZoneLow, entryZoneHigh: c.entryZoneHigh,
      stop: c.stop, t1: c.t1, rrToT1: c.rrToT1,
    }),
  });
}

function persistAndEmit(c: SetupCandidate) {
  const existing = storage.getSetupCandidate(c.ticker, c.setup);
  const prevState = (existing?.state as SetupState) || "dormant";
  storage.upsertSetupCandidate({
    ticker: c.ticker, setup: c.setup, state: c.state,
    qualificationsPassed: c.qualificationsPassed,
    qualificationsTotal: c.qualificationsTotal,
    qualificationDetails: JSON.stringify(c.qualificationDetails),
    entryZoneLow: c.entryZoneLow,
    entryZoneHigh: c.entryZoneHigh,
    stop: c.stop, t1: c.t1, t2: c.t2, rrToT1: c.rrToT1,
    atr14: c.atr14,
    swingHigh: c.swingHigh ?? null,
    pullbackPct: c.pullbackPct ?? null,
    basePivot: c.basePivot ?? null,
    baseDepth: c.baseDepth ?? null,
    baseLength: c.baseLength ?? null,
    triggerFired: c.triggerFired,
    triggerNote: c.triggerNote,
    disqualifiers: JSON.stringify(c.disqualifiers),
    lastComputedAt: c.lastComputedAt,
    regimeEligible: c.regimeEligible,
    regimeBlockedReason: c.regimeBlockedReason,
    relativeStrength: c.relativeStrength ?? null,
    trendStrength: c.trendStrength ?? null,
    volumeScore: c.volumeScore ?? null,
    cleanlinessScore: c.cleanlinessScore ?? null,
    marketAlignment: c.marketAlignment ?? null,
    earningsRisk: c.earningsRisk ?? null,
    quality: c.quality ?? null,
  });
  if (prevState !== c.state) emitTransitionAlert(c, prevState);
  // Emit a regime_blocked_trigger alert when the trigger fired but regime
  // blocked the setup from ARMING. At most once per ticker/setup/session.
  if (c.triggerFired && !c.regimeEligible && shouldFireBlockedTrigger(c.ticker, c.setup)) {
    const regimeCode = getEffectiveRegime().code.toUpperCase();
    const setupLabel = c.setup === "breakout" ? "breakouts" : "trend-pullbacks";
    storage.createAlert({
      ticker: c.ticker, type: "regime_blocked_trigger", severity: "action",
      message: `${c.ticker} trigger fired but regime ${regimeCode} blocks ${setupLabel} \u2014 setup parked`,
      firedAt: new Date().toISOString(),
    });
  }
}

// ─── Run full scan ─────────────────────────────────────────────────────────
export async function runFullScan(opts: { forceRefresh?: boolean } = {}): Promise<Record<string, SetupCandidate[]>> {
  const all = await getAllSetups(opts);
  for (const sym of Object.keys(all)) {
    for (const c of all[sym]) persistAndEmit(c);
  }
  return all;
}

// ─── Scheduler ─────────────────────────────────────────────────────────────
let started = false;
let dailyTimer: NodeJS.Timeout | null = null;
let intradayTimer: NodeJS.Timeout | null = null;

export function startSetupScheduler() {
  if (started) return;
  started = true;
  console.log("[setupService] scheduler starting");
  // Initial run on boot (fire-and-forget so we don't block server)
  setTimeout(() => {
    runFullScan({ forceRefresh: true }).catch(e =>
      console.warn("[setupService] initial scan failed:", e?.message));
  }, 4000);

  const scheduleDaily = () => {
    if (dailyTimer) clearTimeout(dailyTimer);
    const delay = msUntilNext620pmET();
    dailyTimer = setTimeout(async () => {
      try { await runFullScan({ forceRefresh: true }); }
      catch (e: any) { console.warn("[setupService] daily scan err:", e?.message); }
      scheduleDaily();
    }, delay);
  };
  scheduleDaily();

  intradayTimer = setInterval(() => {
    if (!isMarketHoursET()) return;
    runFullScan({ forceRefresh: false }).catch(e =>
      console.warn("[setupService] intraday scan err:", e?.message));
  }, 15 * 60 * 1000);
}

export function stopSetupScheduler() {
  started = false;
  if (dailyTimer) clearTimeout(dailyTimer);
  if (intradayTimer) clearInterval(intradayTimer);
}

export { WATCHLIST_SYMS as SETUP_TICKERS };
