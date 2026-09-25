// PR 3c — Weekly / Daily regime (spec §E, §H step 2). Pure; `now` injected.
// Same classification rules as mtfSignalEngine.computeWeeklyRegime/computeDailyRegime (PR 2),
// re-expressed over SwingBar + injected clock so they are testable and never read wall time.
import type { DailyRegime, WeeklyRegime } from "@shared/swingDecision";
import { sma, atr, type SwingBar } from "./candleMath";
import { aggregateWeekly, dailyClosed } from "./bars";

const r2 = (n: number) => Math.round(n * 100) / 100;

function rising(closes: number[], period: number, lookback: number): boolean {
  if (closes.length < period + lookback) return false;
  const now = sma(closes, period)!;
  const then = sma(closes.slice(0, closes.length - lookback), period)!;
  return now > then;
}

export interface WeeklyState {
  regime: WeeklyRegime;
  sma20: number | null;
  distPct: number | null;
  /** Current week is green / above SMA20 but the week has not closed (Friday 15:00 CT). */
  reclaimForming: boolean;
  lastClosedWeekStart: number | null;
  reason: string;
}

export function weeklyRegime(daily: SwingBar[], nowSec: number): WeeklyState {
  const weeks = aggregateWeekly(daily, nowSec);
  const closedW = weeks.filter((w) => w.closed);
  const none = (reason: string): WeeklyState => ({ regime: "NEUTRAL", sma20: null, distPct: null, reclaimForming: false, lastClosedWeekStart: null, reason });
  if (closedW.length < 21) return none(`only ${closedW.length} closed weekly bars (need 21) — treated as NEUTRAL`);
  const closes = closedW.map((w) => w.c);
  const s20 = sma(closes, 20)!;
  const c = closes[closes.length - 1];
  const dist = ((c - s20) / s20) * 100;
  const up = rising(closes, 20, 4);
  let regime: WeeklyRegime;
  if (c > s20 && up) regime = "GREEN";
  else if (c < s20 && !up) regime = "RED";
  else if (Math.abs(dist) < 1) regime = "NEUTRAL";
  else regime = c > s20 ? "GREEN" : "RED";
  const cur = weeks[weeks.length - 1];
  const reclaimForming = !cur.closed && cur.c > s20 && c <= s20;
  const reason = `last closed week ${r2(c)} vs weekly SMA20 ${r2(s20)} (${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%), SMA ${up ? "rising" : "flat/falling"}`
    + (reclaimForming ? " — WEEKLY RECLAIM FORMING (confirms only after Friday RTH close)" : "");
  return { regime, sma20: r2(s20), distPct: r2(dist), reclaimForming, lastClosedWeekStart: closedW[closedW.length - 1].t, reason };
}

export interface DailyState {
  regime: DailyRegime;
  /** NEUTRAL but improving: close above prior close and SMA20 flat-to-rising (spec §D Standard). */
  improving: boolean;
  sma20: number | null;
  atr: number | null;
  distPct: number | null;
  structureUpper: boolean;
  lastClosedDay: number | null;
  reason: string;
}

function higherHighsLows(bars: SwingBar[]): boolean {
  if (bars.length < 20) return false;
  const half = Math.floor(bars.length / 2);
  const a = bars.slice(0, bars.length - half), b = bars.slice(-half);
  return Math.max(...b.map((x) => x.h)) > Math.max(...a.map((x) => x.h)) && Math.min(...b.map((x) => x.l)) > Math.min(...a.map((x) => x.l));
}

export function dailyRegime(daily: SwingBar[], nowSec: number): DailyState {
  const closed = daily.filter((d) => dailyClosed(d, nowSec));
  const none = (reason: string): DailyState => ({ regime: "NEUTRAL", improving: false, sma20: null, atr: null, distPct: null, structureUpper: false, lastClosedDay: null, reason });
  if (closed.length < 25) return none(`only ${closed.length} closed daily bars (need 25) — treated as NEUTRAL`);
  const closes = closed.map((d) => d.c);
  const s20 = sma(closes, 20)!;
  const c = closes[closes.length - 1], pc = closes[closes.length - 2];
  const dist = ((c - s20) / s20) * 100;
  const up = rising(closes, 20, 5);
  const struct = higherHighsLows(closed.slice(-20));
  let regime: DailyRegime;
  if (c > s20 && pc <= s20) regime = "RECLAIMED";
  else if (up && c > s20 && dist <= 3.5 && struct) regime = "PULLBACK_VALID";
  else if (c < s20 && !up && !struct) regime = "RED";
  else if (Math.abs(dist) < 0.5) regime = "NEUTRAL";
  else if (c > s20) regime = "PULLBACK_VALID";
  else regime = "RED";
  const flatOrUp = sma(closes, 20)! >= sma(closes.slice(0, -3), 20)! * 0.998;
  const improving = regime === "NEUTRAL" && c > pc && flatOrUp;
  const reason = `last closed day ${r2(c)} vs daily SMA20 ${r2(s20)} (${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%), SMA ${up ? "rising" : "flat/falling"}${improving ? ", improving" : ""}`;
  return { regime, improving, sma20: r2(s20), atr: atr(closed), distPct: r2(dist), structureUpper: struct, lastClosedDay: closed[closed.length - 1].t, reason };
}
