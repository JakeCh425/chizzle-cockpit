// PR 3b — the 8-setup library (spec §G). Pure functions over closed/developing bars.
// detectAll() returns one Detection per setup type — CONFIRMED, FORMING, or NONE with
// reasons — so the "WHY NO CARD?" log can show every setup that was evaluated.
// 4H candle setups search back LOOKBACK_4H closed bars so a setup that confirmed
// earlier is still reported (extension must never erase setup history).
import type { SetupType, SignalMode, VolumeCondition } from "@shared/swingDecision";
import {
  stats, atr, bbMid, ema, shortTermDecline, clusterOfLows, sharpSelloff, elevatedVolume,
  supportLevels, nearSupport, bullishReversal, pivotLows, type Level, type SwingBar,
} from "./candleMath";
import type { Bar1H, Bar4H } from "./bars";

export type Stage = "NONE" | "FORMING" | "CONFIRMED";

export interface Detection {
  type: SetupType;
  stage: Stage;
  phase: string | null;            // e.g. RECLAIM | MOMENTUM for setup 6
  timeframe: "1H" | "4H";
  barTime: number | null;          // open time of the confirming/forming bar
  barEnd: number | null;
  trigger: number | null;          // entry trigger (pre-buffer)
  structureLow: number | null;     // structural stop reference (pre-buffer)
  levels: Record<string, number>;  // support, reclaim, breakout, retestLow, consHigh …
  volume: VolumeCondition;
  passed: string[];
  failed: string[];
  missing: string[];
}

export interface DetectCtx {
  bars4h: Bar4H[];                 // chronological, may end with a developing bar
  bars1h: Bar1H[];
  daily?: SwingBar[];
  weekly?: SwingBar[];
  signalMode: SignalMode;
  reclaimLevel?: number | null;    // user-defined reclaim level (overrides 4H SMA20)
  allowFirstPullback?: boolean;
}

export const LOOKBACK_4H = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;

function base(type: SetupType, timeframe: "1H" | "4H"): Detection {
  return { type, stage: "NONE", phase: null, timeframe, barTime: null, barEnd: null, trigger: null,
    structureLow: null, levels: {}, volume: "NEUTRAL", passed: [], failed: [], missing: [] };
}
function volCond(ok: boolean | null): VolumeCondition { return ok == null ? "NEUTRAL" : ok ? "PASS" : "FAIL"; }

// ─── 4H single-candle setups (1–4) ──────────────────────────────────────────
type CandleCheck = (bar: Bar4H, prior: Bar4H[], ctx: DetectCtx, levels: Level[], a: number | null) =>
  { ok: boolean; passed: string[]; failed: string[]; stop: number; levels?: Record<string, number>; volOk?: boolean | null };

function scan4H(type: SetupType, ctx: DetectCtx, confirm: CandleCheck, forming: CandleCheck): Detection {
  const d = base(type, "4H");
  const closed = ctx.bars4h.filter((b) => b.closed);
  const dev = ctx.bars4h.length && !ctx.bars4h[ctx.bars4h.length - 1].closed ? ctx.bars4h[ctx.bars4h.length - 1] : null;
  if (closed.length < 8) { d.failed.push(`insufficient closed 4H history (${closed.length}/8)`); return d; }
  let lastFail: string[] = [];
  for (let k = 0; k < LOOKBACK_4H && closed.length - 1 - k >= 7; k++) {
    const i = closed.length - 1 - k;
    const bar = closed[i], prior = closed.slice(0, i);
    const a = atr(prior.concat(bar));
    const levels = supportLevels({ bars4h: prior.concat(bar), daily: ctx.daily, weekly: ctx.weekly });
    const r = confirm(bar, prior, ctx, levels, a);
    if (r.ok) {
      Object.assign(d, { stage: "CONFIRMED", barTime: bar.t, barEnd: bar.end, trigger: r2(bar.h), structureLow: r2(r.stop),
        levels: r.levels ?? {}, volume: volCond(r.volOk ?? elevatedVolume(bar, prior).ok) });
      d.passed.push(...r.passed, k === 0 ? "confirmed on latest closed 4H bar" : `confirmed ${k} closed 4H bar(s) ago`);
      return d;
    }
    if (k === 0) lastFail = r.failed;
  }
  if (dev) {
    const prior = closed;
    const a = atr(prior.concat(dev));
    const levels = supportLevels({ bars4h: prior.concat(dev), daily: ctx.daily, weekly: ctx.weekly });
    const f = forming(dev, prior, ctx, levels, a);
    if (f.ok) {
      Object.assign(d, { stage: "FORMING", barTime: dev.t, barEnd: dev.end, trigger: r2(dev.h), structureLow: r2(f.stop), levels: f.levels ?? {} });
      d.passed.push(...f.passed, "developing 4H bar — NOT confirmed until close");
      return d;
    }
  }
  d.failed.push(...lastFail);
  return d;
}

function sup(ns: { level: Level | null }): Record<string, number> {
  return ns.level ? { support: r2(ns.level.price) } : {};
}

function supportCheck(bar: Bar4H, prior: Bar4H[], levels: Level[], a: number | null, passed: string[], failed: string[]) {
  const ns = nearSupport(bar, prior, levels, a);
  if (ns.ok) passed.push(`near support: ${ns.level!.name} ${r2(ns.level!.price)}`);
  else failed.push(ns.level ? `not near support (closest ${ns.level.name} ${r2(ns.level.price)}, ${ns.distPct!.toFixed(2)}% away)` : "no support levels");
  return ns;
}

export function detectHammer(ctx: DetectCtx): Detection {
  return scan4H("HAMMER", ctx,
    (bar, prior, _c, levels, a) => {
      const s = stats(bar), passed: string[] = [], failed: string[] = [];
      (s.isGreen ? passed : failed).push(s.isGreen ? "closed green" : "not green");
      (s.lowerWick >= 2 * s.body ? passed : failed).push(`lower wick ${r2(s.lowerWick)} ${s.lowerWick >= 2 * s.body ? "≥" : "<"} 2× body ${r2(s.body)}`);
      (s.upperWick <= s.body ? passed : failed).push(`upper wick ${s.upperWick <= s.body ? "≤" : ">"} body`);
      (s.closePosition >= 0.67 ? passed : failed).push(`close position ${s.closePosition.toFixed(2)} ${s.closePosition >= 0.67 ? "≥" : "<"} 0.67`);
      const dec = shortTermDecline(prior); (dec.ok ? passed : failed).push(`decline: ${dec.why}`);
      const ns = supportCheck(bar, prior, levels, a, passed, failed);
      return { ok: failed.length === 0, passed, failed, stop: bar.l, levels: sup(ns) };
    },
    (bar, prior, _c, levels, a) => {
      const s = stats(bar);
      const ok = s.lowerWick >= Math.max(s.body, s.range * 0.4) && s.closePosition >= 0.5 && shortTermDecline(prior).ok && nearSupport(bar, prior, levels, a).ok;
      return { ok, passed: ok ? ["developing lower wick after decline into support"] : [], failed: [], stop: bar.l };
    });
}

export function detectEngulfing(ctx: DetectCtx): Detection {
  return scan4H("BULLISH_ENGULFING", ctx,
    (bar, prior, _c, levels, a) => {
      const prev = prior[prior.length - 1], passed: string[] = [], failed: string[] = [];
      (bar.c > bar.o ? passed : failed).push(bar.c > bar.o ? "closed green" : "not green");
      (prev.c < prev.o ? passed : failed).push(prev.c < prev.o ? "prior 4H red" : "prior 4H not red");
      (bar.o <= prev.c ? passed : failed).push(`open ${r2(bar.o)} ${bar.o <= prev.c ? "≤" : ">"} prior close ${r2(prev.c)}`);
      (bar.c >= prev.o ? passed : failed).push(`close ${r2(bar.c)} ${bar.c >= prev.o ? "≥" : "<"} prior open ${r2(prev.o)}`);
      const dec = shortTermDecline(prior.slice(0, -1).concat(prev));
      const ns = nearSupport(bar, prior, levels, a);
      if (dec.ok || ns.ok) passed.push(dec.ok ? `after decline: ${dec.why}` : `at support: ${ns.level!.name}`);
      else failed.push("not after decline and not at support");
      return { ok: failed.length === 0, passed, failed, stop: Math.min(bar.l, prev.l), levels: sup(ns) };
    },
    (bar, prior, _c, levels, a) => {
      const prev = prior[prior.length - 1];
      const ok = bar.c > bar.o && prev.c < prev.o && bar.o <= prev.c && bar.c >= prev.c + 0.5 * (prev.o - prev.c)
        && (shortTermDecline(prior).ok || nearSupport(bar, prior, levels, a).ok);
      return { ok, passed: ok ? ["green candle growing to cover prior red body"] : [], failed: [], stop: Math.min(bar.l, prev.l) };
    });
}

export function detectStrongBullAfterCluster(ctx: DetectCtx): Detection {
  return scan4H("STRONG_BULL_BAR", ctx,
    (bar, prior, _c, levels, a) => {
      const s = stats(bar), passed: string[] = [], failed: string[] = [];
      (s.isGreen ? passed : failed).push(s.isGreen ? "closed green" : "not green");
      (s.bodyRatio >= 0.6 ? passed : failed).push(`body ratio ${s.bodyRatio.toFixed(2)} ${s.bodyRatio >= 0.6 ? "≥" : "<"} 0.60`);
      (s.closePosition >= 0.75 ? passed : failed).push(`close position ${s.closePosition.toFixed(2)} ${s.closePosition >= 0.75 ? "≥" : "<"} 0.75`);
      const cl = clusterOfLows(prior);
      (cl.ok ? passed : failed).push(`cluster of lows: ${cl.hits} bars within 0.5% of ${r2(cl.swingLow)}`);
      const ns = supportCheck(bar, prior, levels.concat(cl.ok ? [{ name: "Cluster low", price: cl.swingLow }] : []), a, passed, failed);
      return { ok: failed.length === 0, passed, failed, stop: Math.min(bar.l, cl.swingLow), levels: { clusterLow: r2(cl.swingLow), ...(ns.level ? { support: ns.level.price } : {}) } };
    },
    (bar, prior) => {
      const s = stats(bar), cl = clusterOfLows(prior);
      const ok = cl.ok && s.isGreen && s.bodyRatio >= 0.5;
      return { ok, passed: ok ? [`cluster of lows at ${r2(cl.swingLow)}, strong green body developing`] : [], failed: [], stop: Math.min(bar.l, cl.swingLow) };
    });
}

export function detectAggressiveBounce(ctx: DetectCtx): Detection {
  return scan4H("AGGRESSIVE_BOUNCE", ctx,
    (bar, prior, c, levels, a) => {
      const s = stats(bar), passed: string[] = [], failed: string[] = [];
      (s.isGreen ? passed : failed).push(s.isGreen ? "closed green" : "not green");
      (s.bodyRatio >= 0.6 ? passed : failed).push(`body ratio ${s.bodyRatio.toFixed(2)} ${s.bodyRatio >= 0.6 ? "≥" : "<"} 0.60`);
      (s.closePosition >= 0.75 ? passed : failed).push(`close position ${s.closePosition.toFixed(2)} ${s.closePosition >= 0.75 ? "≥" : "<"} 0.75`);
      const ss = sharpSelloff(prior, a); (ss.ok ? passed : failed).push(`selloff: ${ss.why}`);
      supportCheck(bar, prior, levels, a, passed, failed);
      const v = elevatedVolume(bar, prior);
      if (v.ok) passed.push(`elevated volume ${v.mult!.toFixed(2)}×`);
      else if (c.signalMode === "STRICT") failed.push(v.ok == null ? "volume unavailable (required in Strict)" : `volume ${v.mult!.toFixed(2)}× < 1.2× (required in Strict)`);
      return { ok: failed.length === 0, passed, failed, stop: Math.min(bar.l, ss.low), volOk: v.ok };
    },
    (bar, prior, _c, levels, a) => {
      const s = stats(bar), ss = sharpSelloff(prior, a);
      const ok = ss.ok && s.isGreen && s.closePosition >= 0.6 && nearSupport(bar, prior, levels, a).ok;
      return { ok, passed: ok ? ["sharp selloff into support, green reversal developing"] : [], failed: [], stop: Math.min(bar.l, ss.low) };
    });
}

// ─── Setup 5: Breakout-Retest ───────────────────────────────────────────────
export const RETEST_TOL_PCT = 0.3;

export function detectBreakoutRetest(ctx: DetectCtx): Detection {
  const d = base("BREAKOUT_RETEST", "4H");
  const closed = ctx.bars4h.filter((b) => b.closed);
  if (closed.length < 15) { d.failed.push(`insufficient closed 4H history (${closed.length}/15)`); return d; }
  // Find the most recent breakout: a closed 4H bar closing above the prior 10-bar range high.
  let bi = -1, level = 0;
  for (let i = closed.length - 1; i >= Math.max(10, closed.length - 12); i--) {
    const rh = Math.max(...closed.slice(i - 10, i).map((b) => b.h));
    if (closed[i].c > rh && closed[i - 1].c <= rh && stats(closed[i]).isGreen) { bi = i; level = rh; break; }
  }
  if (bi < 0) { d.failed.push("no closed 4H breakout above a 10-bar range high in last 12 bars"); return d; }
  d.levels.breakout = r2(level);
  d.passed.push(`4H closed above range high ${r2(level)}`);
  // Retest on 1H (preferred) or 4H after the breakout bar: low tags level (±tol) and close holds above.
  const after1h = ctx.bars1h.filter((b) => b.closed && b.t >= closed[bi].end);
  const tol = level * (RETEST_TOL_PCT / 100);
  for (let j = after1h.length - 1; j >= 0; j--) {
    const b = after1h[j];
    if (b.l <= level + tol && b.c > level) {
      const rev = bullishReversal(b, after1h[j - 1]);
      if (rev.ok) {
        const retestLow = Math.min(...after1h.slice(Math.max(0, j - 2), j + 1).map((x) => x.l));
        if (retestLow < level - tol) { d.failed.push(`retest broke below breakout (${r2(retestLow)} < ${r2(level)})`); break; }
        Object.assign(d, { stage: "CONFIRMED", timeframe: "1H", barTime: b.t, barEnd: b.end, trigger: r2(b.h), structureLow: r2(retestLow),
          volume: volCond(elevatedVolume(b, after1h.slice(0, j)).ok) });
        d.levels.retestLow = r2(retestLow);
        d.passed.push(`1H retest held above ${r2(level)}`, `closed 1H ${rev.kind} from retest`, `trigger = reversal high ${r2(b.h)}`);
        return d;
      }
    }
  }
  const last = ctx.bars1h[ctx.bars1h.length - 1] ?? closed[closed.length - 1];
  if (last.c > level) {
    Object.assign(d, { stage: "FORMING", barTime: closed[bi].t, barEnd: closed[bi].end, trigger: r2(closed[bi].h), structureLow: r2(level - tol) });
    d.passed.push("price holding above breakout level; waiting for retest + bullish reversal");
    d.missing.push("retest of breakout level", "closed bullish reversal candle from retest");
  } else {
    d.failed.push(`price back below breakout ${r2(level)}`);
  }
  return d;
}

// ─── Setup 6: Reclaim + Momentum Continuation ───────────────────────────────
/** A decisive 4H reclaim: green bar (body ≥ 45% of range) closing above the level after
 *  ≥3 of the prior 6 bars closed at/below/near it and ≥2 closed below it. Chop that merely
 *  wobbles across the SMA does not qualify. */
export function isReclaimBar(closed: Bar4H[], i: number, level: number): { ok: boolean; nearCount: number } {
  const b = closed[i], s = stats(b);
  const prior6 = closed.slice(Math.max(0, i - 6), i);
  const near = prior6.filter((x) => x.c <= level * 1.003).length;
  const below = prior6.filter((x) => x.c < level).length;
  const ok = b.c > level && closed[i - 1].c <= level * 1.003 && near >= 3 && below >= 2 && s.isGreen && s.bodyRatio >= 0.45;
  return { ok, nearCount: near };
}

export function findReclaim(closed: Bar4H[], userLevel?: number | null): { i: number; level: number; nearCount: number } | null {
  for (let i = closed.length - 1; i >= Math.max(20, closed.length - 6); i--) {
    const level = userLevel ?? bbMid(closed.slice(0, i + 1))!;
    const r = isReclaimBar(closed, i, level);
    if (r.ok) return { i, level, nearCount: r.nearCount };
  }
  return null;
}

export function detectReclaimMomentum(ctx: DetectCtx): Detection {
  const d = base("RECLAIM_MOMENTUM_CONTINUATION", "4H");
  const closed = ctx.bars4h.filter((b) => b.closed);
  if (closed.length < 21) { d.failed.push(`insufficient closed 4H history (${closed.length}/21)`); return d; }
  const rc = findReclaim(closed, ctx.reclaimLevel);
  const h1 = ctx.bars1h.filter((b) => b.closed);
  if (!rc) {
    // FORMING: approaching/crossing level + 1H higher low or two higher closes
    const level = ctx.reclaimLevel ?? bbMid(closed)!;
    const last = ctx.bars1h[ctx.bars1h.length - 1];
    const approaching = last && Math.abs(last.c - level) / level <= 0.005;
    const tail = h1.slice(-3);
    const improving = tail.length === 3 && tail[2].c > tail[1].c && tail[1].c > tail[0].c;
    const hl = tail.length === 3 && tail[2].l > tail[1].l;
    d.levels.reclaim = r2(level);
    if (approaching && (improving || hl)) {
      Object.assign(d, { stage: "FORMING", phase: "APPROACH", timeframe: "1H", barTime: last.t, barEnd: last.end, trigger: r2(level), structureLow: r2(Math.min(...tail.map((b) => b.l), level * 0.995)) });
      d.passed.push(`price within 0.5% of reclaim level ${r2(level)}`, improving ? "two improving 1H closes" : "1H higher low");
      d.missing.push("closed 4H candle above reclaim level");
    } else d.failed.push(`no closed 4H reclaim of ${r2(level)} with ≥3/6 prior bars at/below it`);
    return d;
  }
  const rb = closed[rc.i];
  d.levels.reclaim = r2(rc.level);
  d.passed.push(`closed 4H reclaim above ${ctx.reclaimLevel ? "user level" : "4H SMA20/BB mid"} ${r2(rc.level)}`, `${rc.nearCount}/6 prior 4H bars at/below level`);
  Object.assign(d, { stage: "CONFIRMED", phase: "RECLAIM", barTime: rb.t, barEnd: rb.end, trigger: r2(rb.h), structureLow: r2(Math.min(rb.l, rc.level * 0.995)) });

  // Momentum continuation on the 1H bars after the reclaim bar closed.
  const after = h1.filter((b) => b.t >= rb.end);
  const first3 = after.slice(0, 3);
  const above = first3.filter((b) => b.c > rc.level).length;
  if (first3.length < 3) { d.missing.push(`${3 - first3.length} more closed 1H bar(s) to judge momentum`); return d; }
  if (above < 2) { d.failed.push(`only ${above}/3 closed 1H bars above reclaim`); return d; }
  d.passed.push(`${above}/3 closed 1H bars above reclaim`);
  // Higher low: a 1H pivot low after reclaim that is above the reclaim-bar low.
  const piv = pivotLows(after, 1).map((i) => after[i]).filter((b) => b.l > rb.l && b.l > rc.level * 0.997);
  if (!piv.length) { d.missing.push("1H higher low above reclaim"); return d; }
  const hl = piv[piv.length - 1];
  d.passed.push(`1H higher low ${r2(hl.l)}`);
  // Break of local consolidation high: closed 1H closing above max high of the 3–6 bars before it.
  const hlIdx = after.indexOf(hl);
  for (let j = hlIdx + 1; j < after.length; j++) {
    const win = after.slice(Math.max(0, j - 6), j);
    if (win.length < 3) continue;
    const consHigh = Math.max(...win.map((b) => b.h));
    if (after[j].c > consHigh) {
      const v = elevatedVolume(after[j], after.slice(0, j));
      if (ctx.signalMode === "STRICT" && v.ok !== true) { d.failed.push("momentum bar volume < 1.2× (required in Strict)"); return d; }
      Object.assign(d, { phase: "MOMENTUM", timeframe: "1H", barTime: after[j].t, barEnd: after[j].end, trigger: r2(consHigh), structureLow: r2(hl.l), volume: volCond(v.ok) });
      d.levels.consHigh = r2(consHigh); d.levels.higherLow = r2(hl.l);
      d.passed.push(`closed 1H ${r2(after[j].c)} above consolidation high ${r2(consHigh)}`);
      return d;
    }
  }
  d.missing.push("closed 1H above local consolidation high");
  return d;
}

// ─── Setup 7: First Pullback After Breakout ─────────────────────────────────
export function detectFirstPullback(ctx: DetectCtx): Detection {
  const d = base("FIRST_PULLBACK_AFTER_BREAKOUT", "1H");
  if (ctx.allowFirstPullback === false) { d.failed.push("disabled in settings"); return d; }
  const closed = ctx.bars4h.filter((b) => b.closed);
  if (closed.length < 21) { d.failed.push(`insufficient closed 4H history (${closed.length}/21)`); return d; }
  // Event: 4H reclaim or range breakout within prior 1–5 closed 4H bars.
  let ev: { i: number; level: number; kind: string } | null = null;
  for (let i = closed.length - 1; i >= closed.length - 5; i--) {
    const rh = Math.max(...closed.slice(i - 10, i).map((b) => b.h));
    if (closed[i].c > rh && closed[i - 1].c <= rh && stats(closed[i]).isGreen) { ev = { i, level: rh, kind: "breakout" }; break; }
    const mid = bbMid(closed.slice(0, i + 1))!;
    if (isReclaimBar(closed, i, mid).ok) { ev = { i, level: mid, kind: "reclaim" }; break; }
  }
  if (!ev) { d.failed.push("no 4H breakout/reclaim in prior 1–5 bars"); return d; }
  const evBar = closed[ev.i];
  d.levels.breakout = r2(ev.level);
  d.passed.push(`4H ${ev.kind} of ${r2(ev.level)} ${closed.length - 1 - ev.i} bar(s) ago`);
  const h1 = ctx.bars1h.filter((b) => b.closed && b.t >= evBar.end);
  if (h1.length < 2) { d.missing.push("pullback on 1H after breakout"); return d; }
  const allH1 = ctx.bars1h.filter((b) => b.closed);
  const e10 = ema(allH1.map((b) => b.c), 10);
  const invalidation = Math.min(evBar.l, ev.level * 0.99);
  // Retest zone: breakout level, 1H EMA8/10, or first higher-low area (within 0.5%).
  const zoneLevels = [ev.level, ...(e10 ? [e10] : [])];
  const inZone = (b: SwingBar) => zoneLevels.some((z) => b.l <= z * 1.005 && b.l >= z * 0.995 - 1e-9) || zoneLevels.some((z) => b.l <= z * 1.005 && b.c >= z);
  for (let j = h1.length - 1; j >= 1; j--) {
    const b = h1[j];
    const pullLow = Math.min(...h1.slice(Math.max(0, j - 3), j + 1).map((x) => x.l));
    if (pullLow <= invalidation) { d.failed.push(`pullback broke structure (${r2(pullLow)} ≤ ${r2(invalidation)})`); return d; }
    const rev = bullishReversal(b, h1[j - 1]);
    if (rev.ok && inZone(h1.slice(Math.max(0, j - 3), j + 1).reduce((m, x) => (x.l < m.l ? x : m)))) {
      Object.assign(d, { stage: "CONFIRMED", barTime: b.t, barEnd: b.end, trigger: r2(b.h), structureLow: r2(pullLow),
        volume: volCond(elevatedVolume(b, h1.slice(0, j)).ok) });
      d.levels.retestLow = r2(pullLow);
      d.passed.push(`closed 1H ${rev.kind} from retest zone`, `trigger = reversal high ${r2(b.h)}`);
      return d;
    }
  }
  const last = h1[h1.length - 1];
  const postHigh = Math.max(...h1.map((b) => b.h));
  if (last.c < postHigh && inZone(last)) {
    Object.assign(d, { stage: "FORMING", barTime: last.t, barEnd: last.end, trigger: r2(last.h), structureLow: r2(Math.min(...h1.slice(-3).map((b) => b.l))) });
    d.passed.push("pulling back into retest zone, above invalidation");
    d.missing.push("closed 1H bullish reversal from retest zone");
  } else d.missing.push("pullback into breakout / 1H EMA10 zone");
  return d;
}

// ─── Setup 8: Higher-Low Consolidation ──────────────────────────────────────
export function detectHigherLowConsolidation(ctx: DetectCtx): Detection {
  const d = base("HIGHER_LOW_CONSOLIDATION", "1H");
  const h1 = ctx.bars1h.filter((b) => b.closed);
  if (h1.length < 15) { d.failed.push(`insufficient closed 1H history (${h1.length}/15)`); return d; }
  const w = h1.slice(-40);
  const lows = pivotLows(w, 2);
  if (lows.length < 2) { d.failed.push("fewer than two 1H swing lows"); return d; }
  // Most recent pair of swing lows L1 < L2 with an upswing high between them.
  for (let p = lows.length - 1; p >= 1; p--) {
    const i1 = lows[p - 1], i2 = lows[p];
    const L1 = w[i1].l, L2 = w[i2].l;
    if (L2 <= L1) continue;
    const H1 = Math.max(...w.slice(i1, i2 + 1).map((b) => b.h));
    const retrace = (H1 - L2) / (H1 - L1);
    if (retrace > 0.618) { d.failed.push(`pullback too deep (${(retrace * 100).toFixed(0)}% of upswing)`); continue; }
    // Consolidation: bars after L2 up to (excluding) any break bar, 3+ bars, range ≤ 60% of the upswing.
    const rest = w.slice(i2 + 1);
    for (let j = 3; j <= rest.length; j++) {
      const cons = rest.slice(0, j);
      const consHigh = Math.max(...cons.map((b) => b.h)), consLow = Math.min(...cons.map((b) => b.l));
      if (consLow < L2 || consHigh - consLow > 0.6 * (H1 - L1)) break;
      const next = rest[j];
      if (next && next.c > consHigh) {
        Object.assign(d, { stage: "CONFIRMED", barTime: next.t, barEnd: next.end, trigger: r2(consHigh), structureLow: r2(L2),
          volume: volCond(elevatedVolume(next, w.slice(0, i2 + 1 + j)).ok) });
        d.levels = { higherLow: r2(L2), priorLow: r2(L1), consHigh: r2(consHigh) };
        d.passed.push(`1H higher low ${r2(L2)} > ${r2(L1)}`, `shallow pullback ${(retrace * 100).toFixed(0)}%`, `closed 1H break above consolidation ${r2(consHigh)}`);
        return d;
      }
      if (!next) {
        Object.assign(d, { stage: "FORMING", barTime: cons[cons.length - 1].t, barEnd: cons[cons.length - 1].end, trigger: r2(consHigh), structureLow: r2(L2) });
        d.levels = { higherLow: r2(L2), priorLow: r2(L1), consHigh: r2(consHigh) };
        d.passed.push(`1H higher low ${r2(L2)} > ${r2(L1)}`, `tight consolidation under ${r2(consHigh)}`);
        d.missing.push("closed 1H break above consolidation high");
        return d;
      }
    }
    break;
  }
  if (!d.failed.length) d.failed.push("no higher-low + tight consolidation structure");
  return d;
}

// ─── All setups ─────────────────────────────────────────────────────────────
export function detectAll(ctx: DetectCtx): Detection[] {
  return [
    detectHammer(ctx),
    detectEngulfing(ctx),
    detectStrongBullAfterCluster(ctx),
    detectAggressiveBounce(ctx),
    detectBreakoutRetest(ctx),
    detectReclaimMomentum(ctx),
    detectFirstPullback(ctx),
    detectHigherLowConsolidation(ctx),
  ];
}
