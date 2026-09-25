// Raw-bar builders for lifecycle replays: the engine takes RAW 1H bars and aggregates 4H itself,
// so fixtures are written as 4H patterns and split into 1H bars whose aggregation is exact.
import { sessions4H, hours1H, type OHLC } from "./builders";
import type { SwingBar } from "../../server/swing/candleMath";
import { DEFAULT_SWING_SETTINGS, type SwingSettings } from "@shared/swingDecision";

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Split one 4H bar into k 1H bars along the path o→l→h→c (green) or o→h→l→c (red). */
function split(row: OHLC, k: number, t0: number): SwingBar[] {
  const [o, h, l, c, v] = row;
  const way = c >= o ? [o, l, h, c] : [o, h, l, c];
  const at = (x: number) => { // x in [0,3] along the 3 legs
    const i = Math.min(2, Math.floor(x)), f = x - i;
    return way[i] + (way[i + 1] - way[i]) * f;
  };
  const out: SwingBar[] = [];
  for (let j = 0; j < k; j++) {
    const a = (3 * j) / k, b = (3 * (j + 1)) / k;
    const pts = [at(a), at(b)];
    for (let w = Math.ceil(a); w <= Math.floor(b); w++) pts.push(way[w]);
    out.push({ t: t0 + j * 3600, o: pts[0], h: Math.max(...pts), l: Math.min(...pts), c: pts[1], v: (v ?? 1000) / k });
  }
  return out;
}

/** 4H pattern rows → raw 1H bars (A session = 4 bars, B = 3). */
export function raw1HFrom4H(rows: OHLC[], startYmd = "2026-08-03"): SwingBar[] {
  const slots = sessions4H(startYmd, rows.length);
  return rows.flatMap((r, i) => split(r, (slots[i].end - slots[i].t) / 3600 >= 4 ? 4 : 3, slots[i].t));
}

/** 1H rows appended from a timestamp onward (RTH slots). */
export function raw1H(rows: OHLC[], fromTs: number): SwingBar[] {
  const slots = hours1H(fromTs, rows.length);
  return rows.map(([o, h, l, c, v], i) => ({ t: slots[i].t, o, h, l, c, v: v ?? 1000 }));
}

export const scale = (rows: OHLC[], k: number): OHLC[] => rows.map(([o, h, l, c, v]) => [o * k, h * k, l * k, c * k, v]);

/** Weekday daily bars with a given close path and a ±rangePct/2 range. */
export function dailySeries(closes: number[], rangePct = 1.5, startYmd = "2026-01-05"): SwingBar[] {
  const out: SwingBar[] = [];
  let day = startYmd, i = 0;
  while (out.length < closes.length) {
    const [y, m, d] = day.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (wd >= 1 && wd <= 5) {
      const c = closes[i++], half = (c * rangePct) / 200;
      out.push({ t: Date.UTC(y, m - 1, d) / 1000, o: c, h: c + half, l: c - half, c, v: 1e6 });
    }
    day = addDays(day, 1);
  }
  return out;
}

export const settings = (over: Partial<SwingSettings> = {}): SwingSettings => ({ ...DEFAULT_SWING_SETTINGS, ...over });

/** Bars visible at time `now` (bars that have started). */
export const upTo = (bars: SwingBar[], now: number) => bars.filter((b) => b.t < now);
