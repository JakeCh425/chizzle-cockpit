// PR 3b — shared candle math (spec §F). Pure functions, no I/O.
// Every detector reads the same definitions so "bodyRatio" means one thing everywhere.

export interface SwingBar {
  t: number;       // bar OPEN time, unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface CandleStats {
  body: number;
  range: number;
  bodyRatio: number;
  lowerWick: number;
  upperWick: number;
  closePosition: number;
  isGreen: boolean;
  isRed: boolean;
}

export function stats(b: SwingBar): CandleStats {
  const body = Math.abs(b.c - b.o);
  const range = b.h - b.l;
  return {
    body,
    range,
    bodyRatio: range > 0 ? body / range : 0,
    lowerWick: Math.min(b.o, b.c) - b.l,
    upperWick: b.h - Math.max(b.o, b.c),
    closePosition: range > 0 ? (b.c - b.l) / range : 0,
    isGreen: b.c > b.o,
    isRed: b.c < b.o,
  };
}

// ─── Indicators ─────────────────────────────────────────────────────────────
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Wilder-style ATR using simple average of true range (stable on short series). */
export function atr(bars: SwingBar[], period = 14): number | null {
  if (bars.length < 2) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  const n = Math.min(period, trs.length);
  return trs.slice(-n).reduce((a, b) => a + b, 0) / n;
}

/** Bollinger midline = SMA20 of closes (spec treats them as separate levels; same math). */
export function bbMid(bars: SwingBar[], period = 20): number | null {
  return sma(bars.map((b) => b.c), period);
}

// ─── Context definitions (spec §F) ──────────────────────────────────────────
export const CLUSTER_TOL_PCT = 0.5;
export const ELEVATED_VOL_MULT = 1.2;

/** 3+ red bars among previous 5–7 bars OR lower lows into support. `prior` excludes the signal bar. */
export function shortTermDecline(prior: SwingBar[]): { ok: boolean; why: string } {
  const w = prior.slice(-7);
  const reds = w.filter((b) => b.c < b.o).length;
  if (reds >= 3) return { ok: true, why: `${reds} red bars in prior ${w.length}` };
  const last3 = prior.slice(-3);
  const lowerLows = last3.length === 3 && last3[1].l < last3[0].l && last3[2].l < last3[1].l;
  if (lowerLows) return { ok: true, why: "lower lows into signal bar" };
  return { ok: false, why: `only ${reds} red bars in prior ${w.length}, no lower-low sequence` };
}

/** 3+ prior candles within ±0.5% of the recent swing low. */
export function clusterOfLows(prior: SwingBar[], lookback = 7): { ok: boolean; swingLow: number; hits: number } {
  const w = prior.slice(-lookback);
  if (!w.length) return { ok: false, swingLow: NaN, hits: 0 };
  const swingLow = Math.min(...w.map((b) => b.l));
  const hits = w.filter((b) => ((b.l - swingLow) / swingLow) * 100 <= CLUSTER_TOL_PCT).length;
  return { ok: hits >= 3, swingLow, hits };
}

/** 3+ red bars, rapid decline (≥1.5 ATR over 5 bars), or a large red candle with continuation. */
export function sharpSelloff(prior: SwingBar[], atrVal: number | null): { ok: boolean; why: string; low: number } {
  const w = prior.slice(-5);
  const low = w.length ? Math.min(...w.map((b) => b.l)) : NaN;
  const reds = w.filter((b) => b.c < b.o).length;
  if (reds >= 3) return { ok: true, why: `${reds} red bars in prior 5`, low };
  if (atrVal && w.length >= 2) {
    const drop = Math.max(...w.map((b) => b.h)) - w[w.length - 1].c;
    if (drop >= 1.5 * atrVal) return { ok: true, why: `rapid decline ${(drop / atrVal).toFixed(1)} ATR`, low };
  }
  for (let i = 0; i < w.length - 1; i++) {
    const s = stats(w[i]);
    if (s.isRed && s.bodyRatio > 0.6 && (!atrVal || s.body >= atrVal) && w[i + 1].l < w[i].l) {
      return { ok: true, why: "large red candle with continuation", low };
    }
  }
  return { ok: false, why: "no sharp selloff", low };
}

/** Current volume ≥ 1.2× prior 10-bar same-timeframe average. Unknown volume → null (NEUTRAL). */
export function elevatedVolume(bar: SwingBar, prior: SwingBar[]): { ok: boolean | null; mult: number | null } {
  const w = prior.slice(-10).filter((b) => (b.v ?? 0) > 0);
  if (!bar.v || w.length < 5) return { ok: null, mult: null };
  const avg = w.reduce((a, b) => a + (b.v as number), 0) / w.length;
  const mult = bar.v / avg;
  return { ok: mult >= ELEVATED_VOL_MULT, mult };
}

// ─── Support levels ─────────────────────────────────────────────────────────
export interface Level { name: string; price: number }

/** Pivot lows (2-bar fractal) — used as "prior support". */
export function pivotLows(bars: SwingBar[], span = 2): number[] {
  const out: number[] = [];
  for (let i = span; i < bars.length - span; i++) {
    let ok = true;
    for (let k = 1; k <= span; k++) if (!(bars[i].l < bars[i - k].l && bars[i].l <= bars[i + k].l)) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}
export function pivotHighs(bars: SwingBar[], span = 2): number[] {
  const out: number[] = [];
  for (let i = span; i < bars.length - span; i++) {
    let ok = true;
    for (let k = 1; k <= span; k++) if (!(bars[i].h > bars[i - k].h && bars[i].h >= bars[i + k].h)) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

/** Standard support set: 4H SMA20/BB mid, daily SMA20, weekly SMA20, recent 4H pivot lows, plus extras
 *  (breakout zone, reclaim level, consolidation low) supplied by the caller. */
export function supportLevels(opts: {
  bars4h: SwingBar[];
  daily?: SwingBar[];
  weekly?: SwingBar[];
  extra?: Level[];
}): Level[] {
  const out: Level[] = [];
  const s4 = bbMid(opts.bars4h);
  if (s4 != null) out.push({ name: "4H SMA20 / BB mid", price: s4 });
  const d = opts.daily ? sma(opts.daily.map((b) => b.c), 20) : null;
  if (d != null) out.push({ name: "Daily SMA20", price: d });
  const w = opts.weekly ? sma(opts.weekly.map((b) => b.c), 20) : null;
  if (w != null) out.push({ name: "Weekly SMA20", price: w });
  const recent = opts.bars4h.slice(-30);
  for (const i of pivotLows(recent).slice(-3)) out.push({ name: "Prior 4H swing low", price: recent[i].l });
  if (opts.extra) out.push(...opts.extra);
  return out;
}

/** Near support: the signal bar's low (or the lowest of the prior 3 lows) is within
 *  max(0.5%, 0.5 ATR) of any support level. */
export function nearSupport(
  bar: SwingBar,
  prior: SwingBar[],
  levels: Level[],
  atrVal: number | null,
): { ok: boolean; level: Level | null; distPct: number | null } {
  const probe = Math.min(bar.l, ...prior.slice(-3).map((b) => b.l));
  let best: Level | null = null, bestDist = Infinity;
  for (const lv of levels) {
    const d = Math.abs(probe - lv.price);
    if (d < bestDist) { bestDist = d; best = lv; }
  }
  if (!best) return { ok: false, level: null, distPct: null };
  const tol = Math.max(best.price * 0.005, (atrVal ?? 0) * 0.5);
  return { ok: bestDist <= tol, level: best, distPct: (bestDist / best.price) * 100 };
}

/** Generic bullish reversal on a single closed bar (used by retest / pullback setups). */
export function bullishReversal(bar: SwingBar, prev: SwingBar | undefined): { ok: boolean; kind: string | null } {
  const s = stats(bar);
  if (!s.isGreen) return { ok: false, kind: null };
  if (s.lowerWick >= 2 * s.body && s.upperWick <= s.body && s.closePosition >= 0.67) return { ok: true, kind: "hammer" };
  if (prev && prev.c < prev.o && bar.o <= prev.c && bar.c >= prev.o) return { ok: true, kind: "bullish engulfing" };
  if (s.bodyRatio >= 0.6 && s.closePosition >= 0.75) return { ok: true, kind: "strong bull bar" };
  return { ok: false, kind: null };
}

// ─── Extension (spec §F notExtended) ────────────────────────────────────────
export function extension(price: number, trigger: number, atrVal: number | null): { pct: number; atr: number | null } {
  const diff = price - trigger;
  return { pct: (diff / trigger) * 100, atr: atrVal ? diff / atrVal : null };
}
export function isExtended(price: number, trigger: number, atrVal: number | null, maxPct: number, maxAtr: number): boolean {
  const e = extension(price, trigger, atrVal);
  return e.pct > maxPct || (e.atr != null && e.atr > maxAtr);
}
