// Fixture builders — real Chicago session timestamps so 4H/1H alignment matches production.
import { chicagoTs, chicago } from "../../server/swing/bars";
import type { Bar1H, Bar4H } from "../../server/swing/bars";
import type { SwingBar } from "../../server/swing/candleMath";

export type OHLC = [number, number, number, number, number?];

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function isWeekday(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd >= 1 && wd <= 5;
}

/** n consecutive RTH 4H session slots starting at ymd (A = 08:30–12:30, B = 12:30–15:00). */
export function sessions4H(ymd: string, n: number): { t: number; end: number }[] {
  const out: { t: number; end: number }[] = [];
  let day = ymd;
  while (out.length < n) {
    if (isWeekday(day)) {
      out.push({ t: chicagoTs(day, 510), end: chicagoTs(day, 750) });
      if (out.length < n) out.push({ t: chicagoTs(day, 750), end: chicagoTs(day, 900) });
    }
    day = addDays(day, 1);
  }
  return out;
}

/** n consecutive RTH 1H slots starting at or after `fromTs`. */
export function hours1H(fromTs: number, n: number): { t: number; end: number }[] {
  const out: { t: number; end: number }[] = [];
  let day = chicago(fromTs).ymd;
  while (out.length < n) {
    if (isWeekday(day)) {
      for (let m = 510; m < 900 && out.length < n; m += 60) {
        const t = chicagoTs(day, m);
        if (t >= fromTs) out.push({ t, end: chicagoTs(day, Math.min(m + 60, 900)) });
      }
    }
    day = addDays(day, 1);
  }
  return out;
}

export function mk4H(rows: OHLC[], startYmd = "2026-08-03", opts: { developingLast?: boolean } = {}): Bar4H[] {
  const slots = sessions4H(startYmd, rows.length);
  return rows.map(([o, h, l, c, v], i) => ({
    t: slots[i].t, end: slots[i].end, o, h, l, c, v: v ?? 1000, parts: 4,
    closed: !(opts.developingLast && i === rows.length - 1),
  }));
}

export function mk1H(rows: OHLC[], fromTs: number): Bar1H[] {
  const slots = hours1H(fromTs, rows.length);
  return rows.map(([o, h, l, c, v], i) => ({ t: slots[i].t, end: slots[i].end, o, h, l, c, v: v ?? 1000, closed: true }));
}

/** Quiet range-bound base around `mid`: small-bodied bars (no pattern of their own),
 *  pivot lows at mid-1 every 4 bars, highs ≈ mid+0.6. */
export function flat(n: number, mid = 100): OHLC[] {
  const lows = [-1, -0.6, -0.3, -0.6];
  const out: OHLC[] = [];
  for (let i = 0; i < n; i++) {
    const l = mid + lows[i % 4];
    const green = i % 2 === 0;
    const o = green ? mid - 0.03 : mid + 0.05;
    const c = green ? mid + 0.03 : mid - 0.05;
    out.push([o, mid + 0.6, l, c]);
  }
  return out;
}

export function dailyFlat(n: number, close: number, startYmd = "2026-06-01"): SwingBar[] {
  const out: SwingBar[] = [];
  let day = startYmd;
  while (out.length < n) {
    if (isWeekday(day)) {
      const [y, m, d] = day.split("-").map(Number);
      out.push({ t: Date.UTC(y, m - 1, d) / 1000, o: close, h: close + 0.5, l: close - 0.5, c: close, v: 1e6 });
    }
    day = addDays(day, 1);
  }
  return out;
}
