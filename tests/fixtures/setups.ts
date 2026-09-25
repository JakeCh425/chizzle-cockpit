// One fixture per setup (spec §G). Each is a DetectCtx the named detector must CONFIRM.
import type { DetectCtx } from "../../server/swing/detectors";
import { mk4H, mk1H, flat, dailyFlat, type OHLC } from "./builders";

const decline: OHLC[] = [[100.2, 100.3, 99.5, 99.6], [99.6, 99.7, 99.2, 99.3], [99.3, 99.4, 99.05, 99.1]];

export function hammer(): DetectCtx {
  const bars4h = mk4H([...flat(22), ...decline, [99.2, 99.45, 98.8, 99.35]]);
  return { bars4h, bars1h: [], signalMode: "STANDARD" };
}

export function hammerForming(): DetectCtx {
  const bars4h = mk4H([...flat(22), ...decline, [99.2, 99.4, 98.8, 99.3]], undefined, { developingLast: true });
  return { bars4h, bars1h: [], signalMode: "STANDARD" };
}

export function engulfing(): DetectCtx {
  const bars4h = mk4H([...flat(22), ...decline, [99.6, 99.7, 99.1, 99.2], [99.15, 99.8, 99.05, 99.7]]);
  return { bars4h, bars1h: [], signalMode: "STANDARD" };
}

export function strongBullCluster(): DetectCtx {
  const bars4h = mk4H([...flat(22), [98.6, 98.7, 98.0, 98.3], [98.3, 98.6, 98.05, 98.5], [98.5, 98.6, 98.02, 98.2], [98.25, 99.4, 98.15, 99.35]]);
  return { bars4h, bars1h: [], signalMode: "STANDARD" };
}

export function aggressiveBounce(volume = 2000, mode: DetectCtx["signalMode"] = "STANDARD"): DetectCtx {
  const bars4h = mk4H([...flat(22), [100.0, 100.1, 98.8, 98.9], [98.9, 99.0, 97.8, 97.9], [97.9, 98.0, 96.9, 97.0], [97.0, 98.6, 96.9, 98.5, volume]]);
  return { bars4h, bars1h: [], daily: dailyFlat(25, 97), signalMode: mode };
}

export function breakoutRetest(): DetectCtx {
  const bars4h = mk4H([...flat(22), [100.4, 101.6, 100.3, 101.5]]);
  const bo = bars4h[bars4h.length - 1];
  const bars1h = mk1H([[101.4, 101.5, 100.9, 101.0], [101.0, 101.1, 100.7, 100.8], [100.75, 101.6, 100.65, 101.55]], bo.end);
  return { bars4h, bars1h, signalMode: "STANDARD" };
}

export function reclaimMomentum(): DetectCtx {
  const below: OHLC[] = Array.from({ length: 6 }, (_, i) => [99.4, 99.6, 99.0, 99.3 - (i % 2) * 0.1] as OHLC);
  const bars4h = mk4H([...flat(16), ...below, [99.3, 100.7, 99.2, 100.6]]);
  const rb = bars4h[bars4h.length - 1];
  const bars1h = mk1H([
    [100.5, 100.9, 100.35, 100.8], [100.8, 100.95, 100.5, 100.6], [100.6, 100.7, 100.3, 100.5],
    [100.5, 100.85, 100.45, 100.8], [100.8, 100.9, 100.55, 100.7], [100.7, 101.4, 100.65, 101.35],
  ], rb.end);
  return { bars4h, bars1h, signalMode: "STANDARD" };
}

export function firstPullback(): DetectCtx {
  const bars4h = mk4H([...flat(22), [100.4, 101.6, 100.3, 101.5]]);
  const bo = bars4h[bars4h.length - 1];
  // Pre-breakout 1H history (for EMA10) + post-breakout pullback + reversal
  const pre = mk1H(flat(12).map(([o, h, l, c]) => [o, h, l, c] as OHLC), bo.t - 5 * 86400).filter((b) => b.end <= bo.t);
  const post = mk1H([[101.5, 101.9, 101.3, 101.8], [101.8, 101.85, 101.1, 101.2], [101.2, 101.25, 100.7, 100.8], [100.8, 101.7, 100.72, 101.65]], bo.end);
  return { bars4h, bars1h: [...pre, ...post], signalMode: "STANDARD" };
}

export function higherLowConsolidation(): DetectCtx {
  const bars4h = mk4H(flat(22));
  const last = bars4h[bars4h.length - 1];
  const rows: OHLC[] = [
    ...flat(10).map(([o, h, l, c]) => [o, h, l + 0.4, c] as OHLC),
    [99.9, 100.0, 99.5, 99.6], [99.6, 99.7, 99.2, 99.3], [99.3, 99.5, 99.0, 99.4],
    [99.4, 100.2, 99.3, 100.1], [100.1, 101.0, 100.3, 100.9], [100.9, 100.95, 100.4, 100.5],
    [100.5, 100.6, 100.1, 100.4], [100.4, 100.8, 100.25, 100.6], [100.6, 100.8, 100.3, 100.5],
    [100.5, 100.75, 100.35, 100.7], [100.7, 101.3, 100.6, 101.2],
  ];
  return { bars4h, bars1h: mk1H(rows, last.end), signalMode: "STANDARD" };
}

export function noSetup(): DetectCtx {
  // Steady grind up, no decline, no base, no reclaim event.
  const rows: OHLC[] = Array.from({ length: 30 }, (_, i) => [100 + i * 0.5, 100.6 + i * 0.5, 99.9 + i * 0.5, 100.4 + i * 0.5]);
  return { bars4h: mk4H(rows), bars1h: [], signalMode: "STANDARD" };
}
