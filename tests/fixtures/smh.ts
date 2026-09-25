// Shared SMH 560→600 replay (same bars as lifecycle fixture 1) for marker / service tests.
import { flat, type OHLC } from "./builders";
import { raw1HFrom4H, raw1H, scale, dailySeries, settings, upTo } from "./replay";
import { evaluate, type EvalInput } from "../../server/swing/lifecycle";
import type { SwingSettings } from "@shared/swingDecision";
import type { SwingBar } from "../../server/swing/candleMath";

export const K = 5.7, X = 570;
const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
export const base = raw1HFrom4H(scale([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]], K));
export const rbEnd = base[base.length - 1].t + 3600;
const confirmRows: OHLC[] = [
  [100.5, 100.65, 100.35, 100.55], [100.55, 100.6, 100.2, 100.3], [100.3, 100.5, 100.25, 100.45],
  [100.45, 100.6, 100.4, 100.5], [100.5, 101.3, 100.45, 101.25],
];
const runRows: OHLC[] = [[101.25, 102.2, 101.2, 102.1], [102.1, 103.1, 102.0, 103.0], [103.0, 104.0, 102.9, 103.9], [103.9, 104.8, 103.8, 104.7], [104.7, 105.4, 104.6, 105.26]];
export const smh = [...base, ...raw1H(scale([...confirmRows, ...runRows], K), rbEnd)];
export const post = smh.filter((b) => b.t >= rbEnd);
export const endOf = (b: SwingBar) => b.t + 3600;
export const dailyFlat = dailySeries(Array(140).fill(X));
export const T = { forming: base[base.length - 2].t + 3600, confirmed: rbEnd, ready: endOf(post[4]), extended: endOf(post[9]) };
export const run = (now: number, over: Partial<SwingSettings> = {}, extra: Partial<EvalInput> = {}, bars = smh, daily = dailyFlat, symbol = "SMH") =>
  evaluate({ symbol, exchange: "NASDAQ", bars1h: upTo(bars, now), daily, settings: settings(over), now, dataSource: "fixture", ...extra });
