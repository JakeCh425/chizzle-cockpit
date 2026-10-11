// Setup Score — a TypeScript port of the Swing Setup Board's scoring (chizzle_setup_board.py) so both use
// the same rules. Pure functions, no I/O. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
//
// The score is a sorting aid. It never changes the engine's setup status, Ready, levels, or any locked trade.
//
//   Trend Alignment  +40  last CLOSED daily close > 10 EMA and > 20 EMA, with 10 EMA > 20 EMA
//   Volume           +30  trigger candle volume ≥ 1.5 × its prior-20-bar volume average
//   Reward-to-Risk   +30  (next daily resistance − entry) ÷ (entry − stop) ≥ 2.5
//   Trigger          Hammer or Bullish Engulfing near the 10/20 EMA in the last 5 closed bars
//   Entry            trigger candle high          Stop  pattern low − 0.5 × ATR(14)
// Partial credit (default) scales volume 1.0×→1.5× and R:R 1.0→2.5 linearly; Strict = all-or-nothing.

export interface ScoreBar { t: number; o: number; h: number; l: number; c: number; v?: number }
export type ScoreTimeframe = "Daily" | "4H" | "1H";
export type ScoreGrade = "PRIORITY" | "WATCH" | "PASS";
export type ScoreStatus = "NO SETUP" | "AWAITING BREAK" | "TRIGGERED" | "TARGET REACHED" | "INVALIDATED" | "DATA ERROR";

export interface SetupScore {
  score: number; grade: ScoreGrade | null; timeframe: ScoreTimeframe; strict: boolean;
  trendPts: number; volumePts: number; rrPts: number;
  lastClose: number | null; ema10: number | null; ema20: number | null;
  trigger: "Hammer" | "Bullish Engulfing" | null; triggerAt: number | null;
  entry: number | null; patternLow: number | null; stop: number | null; atr: number | null;
  resistance: number | null; rr: number | null; volRatio: number | null;
  status: ScoreStatus; notes: string[]; error: string | null;
}

export const SCORE_RULES = {
  EMA_FAST: 10, EMA_SLOW: 20, ATR_LEN: 14, VOL_MA_LEN: 20,
  TREND_MAX: 40, VOLUME_MAX: 30, RR_MAX: 30,
  VOL_MULT_REQ: 1.5, RR_REQ: 2.5, STOP_ATR_MULT: 0.5,
  EMA_PROXIMITY_ATR: 0.5, TRIGGER_LOOKBACK: 5, PIVOT_WINDOW: 5, RESISTANCE_LOOKBACK: 250,
  VOL_PARTIAL_FLOOR: 1.0, RR_PARTIAL_FLOOR: 1.0,
} as const;
const R = SCORE_RULES;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ─── Indicators (match pandas ewm(adjust=False) and Wilder ATR) ─────────────
export function ema(xs: number[], span: number): number[] {
  const a = 2 / (span + 1), out: number[] = [];
  xs.forEach((x, i) => out.push(i === 0 ? x : a * x + (1 - a) * out[i - 1]));
  return out;
}
export function atrWilder(b: ScoreBar[], len = R.ATR_LEN): number[] {
  const out: number[] = [];
  b.forEach((x, i) => {
    const tr = i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c));
    out.push(i === 0 ? tr : tr / len + (1 - 1 / len) * out[i - 1]);
  });
  return out;
}
/** Average volume of the PRIOR `len` bars (excludes the bar itself), null until enough history. */
export function priorVolMA(b: ScoreBar[], len = R.VOL_MA_LEN): (number | null)[] {
  return b.map((_, i) => (i < len ? null : b.slice(i - len, i).reduce((s, x) => s + (x.v ?? 0), 0) / len));
}

// ─── Patterns ───────────────────────────────────────────────────────────────
export function isHammer(o: number, h: number, l: number, c: number): boolean {
  const rng = h - l;
  if (rng <= 0) return false;
  const body = Math.abs(c - o), lower = Math.min(o, c) - l, upper = h - Math.max(o, c);
  return lower >= 2 * Math.max(body, 0.05 * rng) && upper <= 0.25 * rng && (Math.min(o, c) - l) / rng >= 0.6;
}
export function isBullishEngulfing(o1: number, c1: number, o: number, c: number): boolean {
  return c1 < o1 && c > o && o <= c1 && c >= o1 && c - o > o1 - c1;
}
function nearEmas(bar: ScoreBar, e10: number, e20: number, atr: number): boolean {
  const tol = R.EMA_PROXIMITY_ATR * atr;
  return [e10, e20].some((e) => Math.abs(bar.l - e) <= tol || (bar.l <= e && e <= bar.h));
}

// ─── Levels ─────────────────────────────────────────────────────────────────
/** Confirmed swing highs: the high is the max of PIVOT_WINDOW bars on each side (full window required). */
export function pivotHighs(daily: ScoreBar[], w = R.PIVOT_WINDOW): number[] {
  const out: number[] = [];
  for (let i = w; i < daily.length - w; i++) {
    let max = -Infinity;
    for (let j = i - w; j <= i + w; j++) max = Math.max(max, daily[j].h);
    if (daily[i].h === max) out.push(daily[i].h);
  }
  return out;
}
export function nextResistance(daily: ScoreBar[], entry: number): number | null {
  const recent = daily.slice(-R.RESISTANCE_LOOKBACK);
  const above = pivotHighs(recent).filter((p) => p > entry * 1.001);
  if (above.length) return r2(Math.min(...above));
  const yr = recent.length ? Math.max(...recent.map((b) => b.h)) : null;
  return yr != null && yr > entry * 1.001 ? r2(yr) : null;
}

// ─── Scoring blocks ─────────────────────────────────────────────────────────
export function scoreTrend(close: number, e10: number, e20: number, strict: boolean): [number, string] {
  if (close > e10 && close > e20 && e10 > e20) return [R.TREND_MAX, "Daily close above 10 & 20 EMA, 10 EMA stacked above 20 EMA"];
  if (strict) return [0, "Daily trend not fully aligned"];
  if (close > e20 && e10 > e20) return [R.TREND_MAX / 2, "Stacked EMAs but close is below the 10 EMA (pullback)"];
  if (close > e20) return [R.TREND_MAX / 4, "Close above 20 EMA but EMAs not stacked"];
  return [0, "Daily close below the 20 EMA"];
}
export const scoreVolume = (ratio: number, strict: boolean) =>
  ratio >= R.VOL_MULT_REQ ? R.VOLUME_MAX : strict ? 0 : R.VOLUME_MAX * clamp01((ratio - R.VOL_PARTIAL_FLOOR) / (R.VOL_MULT_REQ - R.VOL_PARTIAL_FLOOR));
export const scoreRr = (rr: number, strict: boolean) =>
  rr >= R.RR_REQ ? R.RR_MAX : strict ? 0 : R.RR_MAX * clamp01((rr - R.RR_PARTIAL_FLOOR) / (R.RR_REQ - R.RR_PARTIAL_FLOOR));
export const gradeOf = (score: number): ScoreGrade => (score >= 80 ? "PRIORITY" : score >= 60 ? "WATCH" : "PASS");

/** Score one symbol. `daily` and `bars` must be CLOSED bars, oldest first (`bars` = the trigger timeframe). */
export function scoreSetup(daily: ScoreBar[], bars: ScoreBar[], timeframe: ScoreTimeframe = "Daily", strict = false): SetupScore {
  const sc: SetupScore = { score: 0, grade: null, timeframe, strict, trendPts: 0, volumePts: 0, rrPts: 0, lastClose: null, ema10: null, ema20: null,
    trigger: null, triggerAt: null, entry: null, patternLow: null, stop: null, atr: null, resistance: null, rr: null, volRatio: null,
    status: "NO SETUP", notes: [], error: null };
  if (daily.length < R.EMA_SLOW + R.PIVOT_WINDOW) { sc.error = "Not enough daily bars"; sc.status = "DATA ERROR"; return sc; }
  const tb = timeframe === "Daily" ? daily : bars;
  if (tb.length < R.VOL_MA_LEN + 2) { sc.error = `Not enough ${timeframe} bars`; sc.status = "DATA ERROR"; return sc; }

  // Trend (Daily)
  const dc = daily.map((b) => b.c), d10 = ema(dc, R.EMA_FAST), d20 = ema(dc, R.EMA_SLOW), n = daily.length - 1;
  sc.lastClose = dc[n]; sc.ema10 = r2(d10[n]); sc.ema20 = r2(d20[n]);
  const [tp, tn] = scoreTrend(dc[n], d10[n], d20[n], strict);
  sc.trendPts = tp; sc.notes.push(tn);

  // Most recent trigger in the last N closed bars of the trigger timeframe
  const c = tb.map((b) => b.c), e10 = ema(c, R.EMA_FAST), e20 = ema(c, R.EMA_SLOW), atr = atrWilder(tb), vma = priorVolMA(tb);
  let ti = -1, pattern: SetupScore["trigger"] = null, plow = 0;
  for (let i = Math.max(1, tb.length - R.TRIGGER_LOOKBACK); i < tb.length; i++) {
    const b = tb[i], p = tb[i - 1];
    if (!nearEmas(b, e10[i], e20[i], atr[i])) continue;
    if (isBullishEngulfing(p.o, p.c, b.o, b.c)) { ti = i; pattern = "Bullish Engulfing"; plow = Math.min(b.l, p.l); }
    else if (isHammer(b.o, b.h, b.l, b.c)) { ti = i; pattern = "Hammer"; plow = b.l; }
  }
  if (ti < 0) {
    sc.notes.push(`No Hammer / Bullish Engulfing near the EMAs in the last ${R.TRIGGER_LOOKBACK} closed ${timeframe} bars`);
    sc.score = Math.round(sc.trendPts); sc.grade = gradeOf(sc.score); return sc;
  }
  const t = tb[ti];
  sc.trigger = pattern; sc.triggerAt = t.t; sc.atr = r2(atr[ti]);
  sc.patternLow = r2(plow); sc.entry = r2(t.h);
  sc.stop = r2(sc.patternLow - R.STOP_ATR_MULT * atr[ti]);
  sc.status = "AWAITING BREAK";

  // Volume
  const vm = vma[ti];
  sc.volRatio = vm && vm > 0 ? r2((t.v ?? 0) / vm) : 0;
  sc.volumePts = scoreVolume((t.v ?? 0) / (vm && vm > 0 ? vm : Infinity), strict);

  // Reward-to-risk (risk = entry − stop)
  const risk = sc.entry - sc.stop;
  sc.resistance = nextResistance(daily, sc.entry);
  if (sc.resistance == null) sc.notes.push("No overhead ceiling found (price near highs) — R:R not measurable, 0 pts");
  else if (risk > 0) { const rr = (sc.resistance - sc.entry) / risk; sc.rr = r2(rr); sc.rrPts = scoreRr(rr, strict); }

  // Plan state vs the latest close (information only)
  const last = c[c.length - 1];
  if (last < sc.stop) { sc.status = "INVALIDATED"; sc.rrPts = 0; sc.notes.push("Latest close is below the stop — setup invalidated"); }
  else if (sc.resistance != null && last >= sc.resistance) { sc.status = "TARGET REACHED"; sc.notes.push("Price already reached the resistance ceiling"); }
  else if (last > sc.entry) { sc.status = "TRIGGERED"; sc.notes.push("A close is already above the trigger high — don't chase if extended"); }

  sc.score = Math.round(sc.trendPts + sc.volumePts + sc.rrPts);
  sc.grade = gradeOf(sc.score);
  return sc;
}

/** Priority Board order: score, then R:R, then volume ratio; data errors last. */
export function rankScores<T extends { setupScore?: SetupScore | null }>(rows: T[]): T[] {
  const k = (x: T) => x.setupScore;
  return rows.slice().sort((a, z) => {
    const A = k(a), Z = k(z);
    const ea = !A || !!A.error, ez = !Z || !!Z.error;
    if (ea !== ez) return ea ? 1 : -1;
    return (Z?.score ?? 0) - (A?.score ?? 0) || (Z?.rr ?? 0) - (A?.rr ?? 0) || (Z?.volRatio ?? 0) - (A?.volRatio ?? 0);
  });
}
