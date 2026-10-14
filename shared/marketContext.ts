// Chart Ecosystem — Part 1: Shared Market Context (the one source of truth per symbol + timeframe).
// Pure, deterministic functions only (no I/O, no randomness, no LLM). The server builds a context ONCE
// from the bars + decision the swing engine already cached (hourly sync / boot snapshots), caches it, and
// every panel reads it. Indicator formulas mirror the existing engine/chart math exactly:
//   SMA            = simple mean of the last n closes          (server/swing/candleMath.sma, SwingChart sma)
//   Bollinger      = SMA20 ± k · population SD                 (SwingChart bb)
//   EMA (MACD)     = SMA-seeded EMA                            (candleMath.ema)
//   RSI            = Wilder smoothing                          (client/src/lib/rsi.ts)
//   ATR            = mean of the last n true ranges            (candleMath.atr — the engine's daily ATR)
// Analysis / practice only. Nothing here places, sends or manages an order.
import type { SwingDecision } from "./swingDecision";
import { STATUS_LABEL } from "./swingDecision";
import { activeVersion, effectivePlan, type EffectivePlan, type PlanVersion } from "./practicePlan";

export const CONTEXT_TFS = ["1H", "4H", "D", "W"] as const;
export type ContextTf = typeof CONTEXT_TFS[number];
export const CONTEXT_VERSION = 1;

export interface CtxBar { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean }

export interface IndicatorParams {
  sma: [number, number, number];
  bb: { n: number; k: number };
  macd: { fast: number; slow: number; signal: number };
  rsi: number; atr: number; volAvg: number;
}
export const DEFAULT_INDICATORS: IndicatorParams = { sma: [20, 50, 200], bb: { n: 20, k: 2 }, macd: { fast: 12, slow: 26, signal: 9 }, rsi: 14, atr: 14, volAvg: 20 };

// ─── Series math (aligned to the input; null until the window is full) ──────
export function smaSeries(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []; let s = 0;
  vals.forEach((v, i) => { s += v; if (i >= n) s -= vals[i - n]; out.push(i >= n - 1 ? s / n : null); });
  return out;
}
export function bollingerSeries(vals: number[], n = 20, k = 2): ({ u: number; m: number; l: number } | null)[] {
  const m = smaSeries(vals, n);
  return vals.map((_, i) => {
    if (m[i] == null) return null;
    const w = vals.slice(i - n + 1, i + 1), mu = m[i]!;
    const sd = Math.sqrt(w.reduce((a, x) => a + (x - mu) ** 2, 0) / n);
    return { u: mu + k * sd, m: mu, l: mu - k * sd };
  });
}
/** SMA-seeded EMA (same seed as candleMath.ema), aligned to the input. */
export function emaSeries(vals: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  const k = 2 / (n + 1); let start = vals.findIndex((v) => v != null);
  if (start < 0 || vals.length - start < n) return out;
  let e = 0; for (let i = start; i < start + n; i++) e += vals[i] as number; e /= n;
  out[start + n - 1] = e;
  for (let i = start + n; i < vals.length; i++) { const v = vals[i]; if (v == null) { out[i] = e; continue; } e = v * k + e * (1 - k); out[i] = e; }
  return out;
}
export function macdSeries(vals: number[], fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(vals, fast), s = emaSeries(vals, slow);
  const line = vals.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const sig = emaSeries(line, signal);
  return line.map((m, i) => (m != null && sig[i] != null ? { macd: m, signal: sig[i] as number, hist: m - (sig[i] as number) } : null));
}
/** Wilder RSI — identical to client/src/lib/rsi.ts. */
export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l += -d; }
  let ag = g / period, al = l / period;
  const val = () => (al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period; al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = val();
  }
  return out;
}
/** Session VWAP for intraday bars: Σ(typical·vol)/Σvol, reset at each Chicago session date. */
export function vwapSeries(bars: Pick<CtxBar, "t" | "h" | "l" | "c" | "v">[]): (number | null)[] {
  let day = "", pv = 0, vv = 0;
  return bars.map((b) => {
    const d = ctParts(b.t).ymd;
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const v = b.v ?? 0; pv += ((b.h + b.l + b.c) / 3) * v; vv += v;
    return vv > 0 ? pv / vv : null;
  });
}
/** Engine ATR (candleMath.atr): mean of the last `period` true ranges of the given bars. */
export function atrOf(bars: Pick<CtxBar, "h" | "l" | "c">[], period = 14): number | null {
  if (bars.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) { const b = bars[i], p = bars[i - 1]; trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c))); }
  const n = Math.min(period, trs.length);
  return trs.slice(-n).reduce((a, x) => a + x, 0) / n;
}

// ─── Chicago session helpers (no server import) ─────────────────────────────
const ctFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function ctParts(tsSec: number): { ymd: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const x of ctFmt.formatToParts(new Date(tsSec * 1000))) p[x.type] = x.value;
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
/** Daily bar date (same rule as server/swing/bars.dailyYmd: 00:00 UTC stamps are the UTC date). */
export function dailyBarYmd(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return d.toISOString().slice(0, 10);
  return ctParts(tsSec).ymd;
}
export const RTH_OPEN = 510, RTH_CLOSE = 900; // 08:30–15:00 CT

// ─── Day levels: HOD/LOD (session) + PDH/PDL (prior session) ────────────────
export interface DayLevels {
  sessionDate: string | null;
  hod: number | null; lod: number | null;
  /** LIVE = today's RTH session still open (1H bars + quote); FIXED = the daily bar closed at 15:00 CT. */
  state: "LIVE" | "FIXED" | "NONE";
  source: string;
  priorDate: string | null; pdh: number | null; pdl: number | null;
  /** Prior session close (live ticker badges compute the session change from it). */
  priorClose?: number | null;
  premarket: { high: number; low: number } | null;
}
export function dayLevels(bars1h: Pick<CtxBar, "t" | "h" | "l">[], daily: (Pick<CtxBar, "t" | "h" | "l"> & { c?: number })[], quote: { price: number; ts: number | null } | null, now: number, extended1h?: Pick<CtxBar, "t" | "h" | "l">[]): DayLevels {
  const nowCt = ctParts(now);
  const rth = bars1h.filter((b) => { const p = ctParts(b.t); return p.minutes >= RTH_OPEN && p.minutes < RTH_CLOSE; });
  const days = [...new Set(daily.map((d) => dailyBarYmd(d.t)))].sort();
  const lastRthDay = rth.length ? ctParts(rth[rth.length - 1].t).ymd : null;
  const sessionDate = [lastRthDay, days[days.length - 1] ?? null].filter(Boolean).sort().pop() ?? null;
  const out: DayLevels = { sessionDate, hod: null, lod: null, state: "NONE", source: "", priorDate: null, pdh: null, pdl: null, premarket: null };
  if (!sessionDate) return out;
  const dBar = daily.find((d) => dailyBarYmd(d.t) === sessionDate);
  const closed = nowCt.ymd > sessionDate || (nowCt.ymd === sessionDate && nowCt.minutes >= RTH_CLOSE);
  const todays = rth.filter((b) => ctParts(b.t).ymd === sessionDate);
  if (closed && dBar) { out.hod = dBar.h; out.lod = dBar.l; out.state = "FIXED"; out.source = "daily bar (closed 15:00 CT)"; }
  else if (todays.length) {
    out.hod = Math.max(...todays.map((b) => b.h)); out.lod = Math.min(...todays.map((b) => b.l));
    if (quote && quote.ts != null && ctParts(quote.ts).ymd === sessionDate) { out.hod = Math.max(out.hod, quote.price); out.lod = Math.min(out.lod, quote.price); }
    out.state = closed ? "FIXED" : "LIVE"; out.source = closed ? "RTH 1H bars" : "RTH 1H bars + live quote";
  } else if (dBar) { out.hod = dBar.h; out.lod = dBar.l; out.state = closed ? "FIXED" : "LIVE"; out.source = "daily bar"; }
  const prior = days.filter((d) => d < sessionDate).pop() ?? null;
  const pBar = prior ? daily.find((d) => dailyBarYmd(d.t) === prior) : null;
  if (pBar) { out.priorDate = prior; out.pdh = pBar.h; out.pdl = pBar.l; if (pBar.c != null && isFinite(pBar.c)) out.priorClose = Math.round(pBar.c * 100) / 100; }
  for (const k of ["hod", "lod", "pdh", "pdl"] as const) if (out[k] != null) out[k] = Math.round((out[k] as number) * 100) / 100; // vendor floats → cents
  const pre = (extended1h ?? []).filter((b) => { const p = ctParts(b.t); return p.ymd === sessionDate && p.minutes < RTH_OPEN; });
  if (pre.length) out.premarket = { high: Math.round(Math.max(...pre.map((b) => b.h)) * 100) / 100, low: Math.round(Math.min(...pre.map((b) => b.l)) * 100) / 100 };
  return out;
}

// ─── Support / resistance: pivot highs/lows clustered within 0.5% (candleMath CLUSTER_TOL_PCT) ─
export interface SrLevel { price: number; side: "SUPPORT" | "RESISTANCE"; source: "PIVOT" | "PDH" | "PDL" | "ENGINE_ZONE" | "DRAWING"; touches: number; strength: number; label: string; lastT: number | null }
export function srLevels(bars: CtxBar[], price: number | null, extra: { price: number; source: SrLevel["source"]; label: string }[] = [], k = 2, tolPct = 0.5): { above: SrLevel[]; below: SrLevel[] } {
  const closed = bars.filter((b) => b.closed);
  const piv: { p: number; t: number }[] = [];
  for (let i = k; i < closed.length - k; i++) {
    const w = closed.slice(i - k, i + k + 1);
    if (closed[i].h === Math.max(...w.map((b) => b.h))) piv.push({ p: closed[i].h, t: closed[i].t });
    if (closed[i].l === Math.min(...w.map((b) => b.l))) piv.push({ p: closed[i].l, t: closed[i].t });
  }
  piv.sort((a, z) => a.p - z.p);
  const clusters: { ps: number[]; lastT: number }[] = [];
  for (const x of piv) {
    const c = clusters[clusters.length - 1];
    const mid = c ? c.ps.reduce((a, v) => a + v, 0) / c.ps.length : 0;
    if (c && Math.abs(x.p - mid) / mid * 100 <= tolPct) { c.ps.push(x.p); c.lastT = Math.max(c.lastT, x.t); } else clusters.push({ ps: [x.p], lastT: x.t });
  }
  const t0 = closed[0]?.t ?? 0, t1 = closed[closed.length - 1]?.t ?? 1;
  const ref = price ?? closed[closed.length - 1]?.c ?? null;
  const lv: SrLevel[] = clusters.map((c) => {
    const p = r2(c.ps.reduce((a, v) => a + v, 0) / c.ps.length);
    const rec = t1 > t0 ? (c.lastT - t0) / (t1 - t0) : 1;
    const strength = Math.min(100, Math.round(c.ps.length * 22 + rec * 34));
    return { price: p, side: ref != null && p > ref ? "RESISTANCE" : "SUPPORT", source: "PIVOT", touches: c.ps.length, strength, label: `${c.ps.length} touch${c.ps.length === 1 ? "" : "es"}`, lastT: c.lastT };
  });
  for (const e of extra) lv.push({ price: r2(e.price), side: ref != null && e.price > ref ? "RESISTANCE" : "SUPPORT", source: e.source, touches: 1, strength: e.source === "DRAWING" ? 70 : 60, label: e.label, lastT: null });
  const rank = (a: SrLevel, z: SrLevel) => z.strength - a.strength || a.price - z.price;
  const near = (side: SrLevel["side"]) => lv.filter((l) => l.side === side).sort((a, z) => (ref == null ? rank(a, z) : Math.abs(a.price - ref) - Math.abs(z.price - ref)));
  // Top 3 each side: the 6 nearest candidates, then strongest first, shown in price order.
  const pick = (side: SrLevel["side"]) => near(side).slice(0, 6).sort(rank).slice(0, 3).sort((a, z) => (side === "RESISTANCE" ? a.price - z.price : z.price - a.price));
  return { above: pick("RESISTANCE"), below: pick("SUPPORT") };
}

// ─── The context object ─────────────────────────────────────────────────────
export interface IndicatorSnapshot {
  sma20: number | null; sma50: number | null; sma200: number | null;
  bb: { u: number; m: number; l: number } | null;
  macd: { macd: number; signal: number; hist: number } | null;
  rsi: number | null; atr: number | null; atrDaily: number | null;
  volume: number | null; volAvg: number | null; volRatio: number | null;
  /** Part 3/5 — previous MACD histogram (to read "fading") and session VWAP (intraday timeframes). */
  histPrev?: number | null; vwap?: number | null;
}
export interface IndicatorSeries {
  t: number[]; sma20: (number | null)[]; sma50: (number | null)[]; sma200: (number | null)[];
  bbU: (number | null)[]; bbM: (number | null)[]; bbL: (number | null)[];
  macd: (number | null)[]; signal: (number | null)[]; hist: (number | null)[]; rsi: (number | null)[];
  vwap?: (number | null)[];
}
export interface ContextLevel { kind: string; price: number; label: string; source: "PLAN" | "TRADE" | "ALERT" | "DAY" | "SR" | "DRAWING" }
export interface ContextTrade { id: number; status: string; entry: number; stop: number; stopLimit: number | null; t1: number; t2: number | null; shares: number }
export interface ContextDrawing { id: number; type: string; label: string; price: number | null; priceHigh?: number | null }
/** Indicator params from a request (clamped to sane integer ranges; anything invalid → default). */
export function sanitizeParams(raw: unknown): IndicatorParams {
  const d = DEFAULT_INDICATORS, o = (raw && typeof raw === "object" ? raw : {}) as any;
  const int = (v: unknown, lo: number, hi: number, def: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : def; };
  const num = (v: unknown, lo: number, hi: number, def: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : def; };
  const sma = Array.isArray(o.sma) && o.sma.length === 3 ? o.sma.map((v: unknown, i: number) => int(v, 2, 400, d.sma[i])) as [number, number, number] : d.sma;
  const fast = int(o.macd?.fast, 2, 100, d.macd.fast), slow = int(o.macd?.slow, 3, 200, d.macd.slow);
  return {
    sma, bb: { n: int(o.bb?.n, 2, 200, d.bb.n), k: num(o.bb?.k, 0.5, 5, d.bb.k) },
    macd: fast < slow ? { fast, slow, signal: int(o.macd?.signal, 2, 100, d.macd.signal) } : d.macd,
    rsi: int(o.rsi, 2, 100, d.rsi), atr: int(o.atr, 2, 100, d.atr), volAvg: int(o.volAvg, 2, 200, d.volAvg),
  };
}
export interface MarketContext {
  v: number; symbol: string; tf: ContextTf; builtAt: string;
  /** Identity of the engine snapshot this was built from — the same one the scan, card and alerts read. */
  snapshot: { evaluatedAt: string; analysisAt: string | null; dataStatus: string; source: string | null };
  quote: { price: number | null; ts: string | null };
  barsSig: string; lastClosedBar: string | null;
  /** Close of the last CLOSED bar on this timeframe (proximity tips read "through" against it). */
  lastClosed?: { t: number; c: number } | null;
  /** Indicator params these numbers were computed with (default unless the chart asked otherwise). */
  params?: IndicatorParams;
  day: DayLevels;
  indicators: IndicatorSnapshot;
  sr: { above: SrLevel[]; below: SrLevel[] };
  plan: EffectivePlan & { label: string };
  trade: ContextTrade | null;
  alerts: { price: number; type: string }[];
  drawings: ContextDrawing[];
  /** Every price level a panel can draw or reference, in one list. */
  levels: ContextLevel[];
  decision: SwingDecision;
  /** Canonical display values — each panel shows these; the contract test pins them. */
  panel: PanelValues;
  bars?: CtxBar[]; series?: IndicatorSeries;
}
export interface PanelValues {
  symbol: string; status: string; statusLabel: string; nextAction: string;
  price: number | null; entry: number | null; stop: number | null; stopLimit: number | null; t1: number | null; t2: number | null;
  risk: number | null; rrT1: number | null; rrT2: number | null; planSource: string;
  hod: number | null; lod: number | null; pdh: number | null; pdl: number | null; atrDaily: number | null;
  setupScore: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const lastOf = <T,>(xs: (T | null)[]): T | null => { for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]; return null; };
export const barsSigOf = (bars: Pick<CtxBar, "t" | "c">[]) => bars.length ? `${bars.length}:${bars[bars.length - 1].t}:${bars[bars.length - 1].c}` : "0";

export function computeIndicators(bars: CtxBar[], dailyClosedBars: Pick<CtxBar, "h" | "l" | "c">[], p: IndicatorParams = DEFAULT_INDICATORS): { snap: IndicatorSnapshot; series: IndicatorSeries } {
  const closes = bars.map((b) => b.c);
  const [a, b2, c] = p.sma;
  const s20 = smaSeries(closes, a), s50 = smaSeries(closes, b2), s200 = smaSeries(closes, c);
  const bb = bollingerSeries(closes, p.bb.n, p.bb.k), md = macdSeries(closes, p.macd.fast, p.macd.slow, p.macd.signal), rs = rsiSeries(closes, p.rsi);
  const closedBars = bars.filter((x) => x.closed);
  const vols = closedBars.map((x) => x.v ?? 0), volAvg = vols.length >= p.volAvg ? vols.slice(-p.volAvg).reduce((s, v) => s + v, 0) / p.volAvg : null;
  const volume = bars.length ? bars[bars.length - 1].v ?? null : null;
  const series: IndicatorSeries = {
    t: bars.map((x) => x.t), sma20: s20, sma50: s50, sma200: s200,
    bbU: bb.map((x) => x?.u ?? null), bbM: bb.map((x) => x?.m ?? null), bbL: bb.map((x) => x?.l ?? null),
    macd: md.map((x) => x?.macd ?? null), signal: md.map((x) => x?.signal ?? null), hist: md.map((x) => x?.hist ?? null), rsi: rs,
    vwap: vwapSeries(bars),
  };
  const hists = md.map((x) => x?.hist ?? null).filter((v): v is number => v != null);
  const snap: IndicatorSnapshot = {
    sma20: lastOf(s20), sma50: lastOf(s50), sma200: lastOf(s200), bb: lastOf(bb), macd: lastOf(md), rsi: lastOf(rs),
    atr: atrOf(closedBars, p.atr), atrDaily: atrOf(dailyClosedBars, 14),
    volume, volAvg, volRatio: volAvg && volume != null ? volume / volAvg : null,
    histPrev: hists.length >= 2 ? hists[hists.length - 2] : null, vwap: lastOf(series.vwap!),
  };
  return { snap, series };
}

export interface BuildInput {
  symbol: string; tf: ContextTf; now: number;
  bars: CtxBar[]; bars1h: CtxBar[]; daily: CtxBar[]; dailyClosedBars: CtxBar[];
  decision: SwingDecision; selected?: Record<string, PlanVersion>;
  trades?: ContextTrade[]; alerts?: { active: boolean; symbol: string; type: string; level: number | null; levelHigh: number | null }[];
  drawings?: ContextDrawing[]; params?: IndicatorParams; withSeries?: boolean;
  /** Extended-hours 1H bars (pre-market high/low only; RTH stays the default everywhere else). */
  extended1h?: Pick<CtxBar, "t" | "h" | "l">[];
}
/** The one builder. Deterministic: same inputs → identical context. */
export function buildMarketContext(x: BuildInput): MarketContext {
  const d = x.decision, sym = x.symbol.toUpperCase();
  const { snap, series } = computeIndicators(x.bars, x.dailyClosedBars, x.params);
  const qTs = d.quoteTimestamp ? Math.floor(new Date(d.quoteTimestamp).getTime() / 1000) : null;
  const day = dayLevels(x.bars1h, x.daily, d.currentPrice != null ? { price: d.currentPrice, ts: qTs } : null, x.now, x.extended1h);
  const ver = activeVersion(d, x.selected);
  const ep = effectivePlan(d, ver);
  const plan = { ...ep, label: ep.source === "USER" ? `My Adjusted Plan v${ep.version}` : "Engine Plan" };
  const trade = (x.trades ?? []).find((t) => t.status === "ACTIVE") ?? (x.trades ?? []).find((t) => t.status === "ARMED") ?? null;
  const alerts: { price: number; type: string }[] = [];
  for (const a of x.alerts ?? []) { if (!a.active || a.symbol !== sym) continue; if (a.level != null) alerts.push({ price: a.level, type: a.type }); if (a.levelHigh != null) alerts.push({ price: a.levelHigh, type: a.type }); }
  const drawings = x.drawings ?? [];
  const extra: { price: number; source: SrLevel["source"]; label: string }[] = [];
  if (day.pdh != null) extra.push({ price: day.pdh, source: "PDH", label: "Prior-day high" });
  if (day.pdl != null) extra.push({ price: day.pdl, source: "PDL", label: "Prior-day low" });
  for (const dr of drawings) {
    if (dr.price != null) extra.push({ price: dr.price, source: "DRAWING", label: dr.label || (dr.priceHigh != null ? "Your zone (low)" : "Your line") });
    if (dr.priceHigh != null) extra.push({ price: dr.priceHigh, source: "DRAWING", label: dr.label ? `${dr.label} (top)` : "Your zone (top)" });
  }
  const sr = srLevels(x.bars, d.currentPrice, extra);
  const levels: ContextLevel[] = [];
  const push = (kind: string, price: number | null | undefined, label: string, source: ContextLevel["source"]) => { if (price != null && Number.isFinite(price)) levels.push({ kind, price, label, source }); };
  push("ENTRY", plan.entry, "Entry", "PLAN"); push("STOP", plan.stop, "Stop", "PLAN"); push("STOPLMT", plan.stopLimit, "Stop limit", "PLAN");
  push("T1", plan.t1, "T1", "PLAN"); push("T2", plan.t2, "T2", "PLAN");
  if (d.originalTrigger != null && d.originalTrigger !== plan.entry) push("TRIGGER", d.originalTrigger, "Trigger", "PLAN");
  if (trade) { push("TRADE_ENTRY", trade.entry, `Trade #${trade.id} entry`, "TRADE"); push("TRADE_STOP", trade.stop, `Trade #${trade.id} stop`, "TRADE"); push("TRADE_T1", trade.t1, `Trade #${trade.id} T1`, "TRADE"); }
  for (const a of alerts) push(`ALERT_${a.type}`, a.price, "Alert", "ALERT");
  push("HOD", day.hod, "HOD", "DAY"); push("LOD", day.lod, "LOD", "DAY"); push("PDH", day.pdh, "PDH", "DAY"); push("PDL", day.pdl, "PDL", "DAY");
  for (const l of [...sr.above, ...sr.below]) if (l.source === "PIVOT") push(l.side === "RESISTANCE" ? "RES" : "SUP", l.price, `${l.side === "RESISTANCE" ? "R" : "S"} ${l.strength}`, "SR");
  for (const dr of drawings) { push("DRAWING", dr.price, dr.label || (dr.priceHigh != null ? "Your zone (low)" : "Your line"), "DRAWING"); if (dr.priceHigh != null) push("DRAWING", dr.priceHigh, dr.label ? `${dr.label} (top)` : "Your zone (top)", "DRAWING"); }
  const panel: PanelValues = {
    symbol: sym, status: d.setupStatus, statusLabel: STATUS_LABEL[d.setupStatus], nextAction: d.nextAction,
    price: d.currentPrice, entry: plan.entry, stop: plan.stop, stopLimit: plan.stopLimit, t1: plan.t1, t2: plan.t2,
    risk: plan.risk, rrT1: plan.rrT1, rrT2: plan.rrT2, planSource: plan.label,
    hod: day.hod, lod: day.lod, pdh: day.pdh, pdl: day.pdl, atrDaily: snap.atrDaily == null ? null : r2(snap.atrDaily),
    setupScore: d.setupScore?.score ?? null,
  };
  const lastClosed = [...x.bars].reverse().find((b) => b.closed) ?? null;
  return {
    v: CONTEXT_VERSION, symbol: sym, tf: x.tf, builtAt: new Date(x.now * 1000).toISOString(),
    snapshot: { evaluatedAt: d.evaluatedAt, analysisAt: d.planRefresh?.analysisAt ?? null, dataStatus: d.dataStatus, source: d.dataSource },
    quote: { price: d.currentPrice, ts: d.quoteTimestamp }, barsSig: barsSigOf(x.bars), lastClosedBar: lastClosed ? new Date(lastClosed.t * 1000).toISOString() : null,
    lastClosed: lastClosed ? { t: lastClosed.t, c: lastClosed.c } : null, params: x.params ?? DEFAULT_INDICATORS,
    day, indicators: snap, sr, plan, trade, alerts, drawings, levels, decision: d, panel,
    ...(x.withSeries ? { bars: x.bars, series } : {}),
  };
}

/** Plain-English "price vs level" helper every panel uses (no advice wording). */
export function priceVs(price: number | null, level: number | null): { pct: number; text: string } | null {
  if (price == null || level == null || !(level > 0)) return null;
  const pct = ((price - level) / level) * 100;
  return { pct, text: Math.abs(pct) < 0.005 ? "at" : `${Math.abs(pct).toFixed(2)}% ${pct > 0 ? "above" : "below"}` };
}

/** Part 2 — "Price vs HOD/LOD" line shared by the Trade Card tile and its summary. */
export function priceVsDay(price: number | null, day: Pick<DayLevels, "hod" | "lod"> | null | undefined): { text: string; pos: number | null } | null {
  if (price == null || !day || day.hod == null || day.lod == null) return null;
  const h = priceVs(price, day.hod), l = priceVs(price, day.lod);
  const span = day.hod - day.lod, pos = span > 0 ? Math.max(0, Math.min(100, Math.round(((price - day.lod) / span) * 100))) : null;
  return { text: `${h?.text ?? "—"} HOD · ${l?.text ?? "—"} LOD${pos != null ? ` · ${pos}% of today's range` : ""}`, pos };
}
