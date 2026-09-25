// PR 3b — session-aware bar handling (spec §E, plan "4H bars").
// 4H bars match TradingView's RTH session split for US equities:
//   Bar A: 08:30–12:30 CT   Bar B: 12:30–15:00 CT (2.5h, TradingView's short last bar)
// Only CLOSED bars may confirm a pattern. Pure functions; `now` is always injected.
import type { SwingBar } from "./candleMath";

export const TZ = "America/Chicago";
const RTH_OPEN_MIN = 8 * 60 + 30;   // 08:30
const MIDDAY_MIN = 12 * 60 + 30;    // 12:30
const RTH_CLOSE_MIN = 15 * 60;      // 15:00

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});

export interface ChicagoParts { ymd: string; minutes: number; weekday: number } // weekday 0=Sun
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function chicago(tsSec: number): ChicagoParts {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(tsSec * 1000))) p[x.type] = x.value;
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: WD[p.weekday] };
}

/** Unix seconds for a Chicago wall-clock time on a given Chicago date (DST-safe). */
export function chicagoTs(ymd: string, minutes: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  // Guess as UTC, then correct by the observed offset (twice handles DST edges).
  let ts = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) / 1000;
  for (let i = 0; i < 2; i++) {
    const c = chicago(ts);
    const [cy, cm, cd] = c.ymd.split("-").map(Number);
    const seen = Date.UTC(cy, cm - 1, cd, Math.floor(c.minutes / 60), c.minutes % 60) / 1000;
    ts += (Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60) / 1000) - seen;
  }
  return ts;
}

export function isRthBar(b: SwingBar): boolean {
  const c = chicago(b.t);
  return c.weekday >= 1 && c.weekday <= 5 && c.minutes >= RTH_OPEN_MIN && c.minutes < RTH_CLOSE_MIN;
}

export function filterRth(bars: SwingBar[]): SwingBar[] {
  return bars.filter(isRthBar);
}

/** End time of an RTH 1H bar (last bar 14:30 ends at 15:00, not 15:30). */
export function end1H(b: SwingBar): number {
  const c = chicago(b.t);
  const endMin = Math.min(c.minutes + 60, RTH_CLOSE_MIN);
  return chicagoTs(c.ymd, endMin);
}

export function sessionOf4H(tsSec: number): { ymd: string; half: "A" | "B"; start: number; end: number } | null {
  const c = chicago(tsSec);
  if (c.minutes < RTH_OPEN_MIN || c.minutes >= RTH_CLOSE_MIN) return null;
  const half = c.minutes < MIDDAY_MIN ? "A" : "B";
  return {
    ymd: c.ymd, half,
    start: chicagoTs(c.ymd, half === "A" ? RTH_OPEN_MIN : MIDDAY_MIN),
    end: chicagoTs(c.ymd, half === "A" ? MIDDAY_MIN : RTH_CLOSE_MIN),
  };
}

export interface Bar4H extends SwingBar { end: number; closed: boolean; parts: number }

/** Aggregate RTH 1H bars into session 4H bars. `closed` = now ≥ session end. */
export function aggregate4H(bars1h: SwingBar[], nowSec: number): Bar4H[] {
  const out: Bar4H[] = [];
  const byKey = new Map<string, Bar4H>();
  for (const b of filterRth(bars1h).sort((a, z) => a.t - z.t)) {
    const s = sessionOf4H(b.t);
    if (!s) continue;
    const key = `${s.ymd}${s.half}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { t: s.start, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, end: s.end, closed: nowSec >= s.end, parts: 1 };
      byKey.set(key, agg);
      out.push(agg);
    } else {
      agg.h = Math.max(agg.h, b.h);
      agg.l = Math.min(agg.l, b.l);
      agg.c = b.c;
      agg.v = (agg.v ?? 0) + (b.v ?? 0);
      agg.parts++;
    }
  }
  return out;
}

export interface Bar1H extends SwingBar { end: number; closed: boolean }
export function tag1H(bars1h: SwingBar[], nowSec: number, rthOnly = true): Bar1H[] {
  const src = (rthOnly ? filterRth(bars1h) : bars1h).slice().sort((a, z) => a.t - z.t);
  return src.map((b) => {
    const end = rthOnly ? end1H(b) : b.t + 3600;
    return { ...b, end, closed: nowSec >= end };
  });
}

export function closedOnly<T extends { closed: boolean }>(bars: T[]): T[] {
  return bars.filter((b) => b.closed);
}
export function developing<T extends { closed: boolean }>(bars: T[]): T | null {
  const last = bars[bars.length - 1];
  return last && !last.closed ? last : null;
}

/** Calendar date of a daily bar. Vendors stamp daily bars at 00:00 UTC (→ previous
 *  evening in Chicago) or at Chicago midnight/open; handle both. */
export function dailyYmd(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return d.toISOString().slice(0, 10);
  return chicago(tsSec).ymd;
}
function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Daily → weekly (Mon-anchored, Chicago dates). A week is closed only after Friday 15:00 CT. */
export interface BarW extends SwingBar { closed: boolean }
export function aggregateWeekly(daily: SwingBar[], nowSec: number): BarW[] {
  const out: BarW[] = [];
  let cur: BarW | null = null, curKey = "";
  for (const d of daily.slice().sort((a, z) => a.t - z.t)) {
    const ymd = dailyYmd(d.t);
    const key = addDays(ymd, -((weekdayOf(ymd) + 6) % 7)); // Monday
    if (key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      const fridayClose = chicagoTs(addDays(key, 4), RTH_CLOSE_MIN);
      cur = { t: d.t, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v ?? 0, closed: nowSec >= fridayClose };
    } else if (cur) {
      cur.h = Math.max(cur.h, d.h); cur.l = Math.min(cur.l, d.l); cur.c = d.c; cur.v = (cur.v ?? 0) + (d.v ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Daily bar closed after 15:00 CT on its own date. */
export function dailyClosed(d: SwingBar, nowSec: number): boolean {
  return nowSec >= chicagoTs(dailyYmd(d.t), RTH_CLOSE_MIN);
}

export function inRth(nowSec: number): boolean {
  const c = chicago(nowSec);
  return c.weekday >= 1 && c.weekday <= 5 && c.minutes >= RTH_OPEN_MIN && c.minutes < RTH_CLOSE_MIN;
}
