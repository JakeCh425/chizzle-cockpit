// ─── Chart timeframes ─────────────────────────────────────────────────────
// Single source of truth for the Cockpit chart's timeframe switcher.
//
// Contract with the server:
//   - GET /api/candles-ohlc/:symbol?interval=<TF_API>
//   - Existing supported intervals: 1D | 1H | 4H | 30M | 5M
//
// 1W and 1M are CLIENT-SIDE AGGREGATIONS of the 1D endpoint (no new server
// intervals, no schema change, no extra network round-trip since it reuses
// the 1D TanStack cache). The aggregation is done by `aggregateBars` in
// this file; consumers still fetch `apiValue` and then call `aggregateBars`
// when `aggregateFrom` is set.

export type Timeframe = "5m" | "30m" | "1H" | "4H" | "1D" | "1W" | "1M";

export interface TimeframeMeta {
  key: Timeframe;
  label: string;      // What we show in the button ("5m", "1H", …)
  apiValue: string;   // What we send to the server (?interval=)
  group: "MINUTES" | "HOURS" | "DAYS" | "WEEKS" | "MONTHS";
  defaultVisibleBars: number;
  spoken: string;
  /** When set, the caller must aggregate the fetched apiValue bars into
   *  this coarser bucket before rendering. Client-side aggregation lets us
   *  offer 1W / 1M without adding new server intervals. */
  aggregateFrom?: "1D";
  /** Bucket size for the aggregator. Ignored when aggregateFrom is unset. */
  aggregateBucket?: "week" | "month";
}

export const TIMEFRAMES: Record<Timeframe, TimeframeMeta> = {
  "5m":  { key: "5m",  label: "5m",  apiValue: "5M",  group: "MINUTES", defaultVisibleBars: 78,  spoken: "on the 5-minute chart" },   // ~1 trading day
  "30m": { key: "30m", label: "30m", apiValue: "30M", group: "MINUTES", defaultVisibleBars: 130, spoken: "on the 30-minute chart" },  // ~10 trading days
  "1H":  { key: "1H",  label: "1H",  apiValue: "1H",  group: "HOURS",   defaultVisibleBars: 140, spoken: "on the 1-hour chart" },     // ~20 trading days
  "4H":  { key: "4H",  label: "4H",  apiValue: "4H",  group: "HOURS",   defaultVisibleBars: 130, spoken: "on the 4-hour chart" },     // ~3 months
  "1D":  { key: "1D",  label: "1D",  apiValue: "1D",  group: "DAYS",    defaultVisibleBars: 252, spoken: "on the daily chart" },       // ~1 year
  "1W":  { key: "1W",  label: "1W",  apiValue: "1D",  group: "WEEKS",   defaultVisibleBars: 104, spoken: "on the weekly chart",
           aggregateFrom: "1D", aggregateBucket: "week"  },  // ~2 years of weekly bars
  "1M":  { key: "1M",  label: "1M",  apiValue: "1D",  group: "MONTHS",  defaultVisibleBars: 60,  spoken: "on the monthly chart",
           aggregateFrom: "1D", aggregateBucket: "month" }, // ~5 years of monthly bars
};

// Order shown in the quick-access strip. Swing focus: 30m/1H/4H/1D/1W/1M.
// 5m is niche (intraday scalp) — lives in the More dropdown.
export const QUICK_TIMEFRAMES: Timeframe[] = ["30m", "1H", "4H", "1D", "1W", "1M"];
export const MORE_TIMEFRAMES: Timeframe[] = ["5m"];
export const ALL_TIMEFRAMES: Timeframe[] = ["5m", "30m", "1H", "4H", "1D", "1W", "1M"];

export const TF_STORAGE_KEY = (ticker: string) => `chizzle:tf:${ticker.toUpperCase()}`;

export function readSavedTimeframe(ticker: string, fallback: Timeframe = "1D"): Timeframe {
  try {
    const v = window.localStorage.getItem(TF_STORAGE_KEY(ticker));
    if (v && (ALL_TIMEFRAMES as string[]).includes(v)) return v as Timeframe;
  } catch { /* SSR / private mode */ }
  return fallback;
}

export function writeSavedTimeframe(ticker: string, tf: Timeframe): void {
  try { window.localStorage.setItem(TF_STORAGE_KEY(ticker), tf); } catch { /* noop */ }
}

// ─── Client-side aggregation ─────────────────────────────────────────────
// Rolls a daily OHLC series into weekly (ISO week, Monday start) or monthly
// bars. Volume sums, open = first bar's open, close = last bar's close,
// high/low = max/min across the bucket. Preserves the same OHLCBar shape
// downstream code already expects (numeric `time` in unix seconds).

export interface OHLCBarLike {
  time?: number;      // unix seconds (canonical from /api/candles-ohlc)
  date?: string;      // YYYY-MM-DD fallback
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Turn an OHLCBarLike's timestamp into a Date. Prefers numeric `time`. */
function barToDate(b: OHLCBarLike): Date | null {
  if (typeof b.time === "number" && Number.isFinite(b.time)) return new Date(b.time * 1000);
  if (typeof b.date === "string") {
    const d = new Date(b.date + "T00:00:00Z");
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

/** ISO-week bucket key: YYYY-Www using UTC. Monday is week start. */
function weekKey(d: Date): string {
  // Copy to avoid mutating input; ISO week uses Thursday of the target week.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;               // Sun -> 7
  t.setUTCDate(t.getUTCDate() + 4 - day);        // shift to Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Monday of the ISO week that contains `d`, at 00:00 UTC. */
function weekStart(d: Date): Date {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (day - 1));
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function aggregateBars<B extends OHLCBarLike>(
  daily: B[] | undefined,
  bucket: "week" | "month"
): B[] {
  if (!Array.isArray(daily) || daily.length === 0) return [];
  const keyOf = bucket === "week" ? weekKey : monthKey;
  const anchorOf = bucket === "week" ? weekStart : monthStart;

  const groups = new Map<string, B[]>();
  const order: string[] = [];
  for (const bar of daily) {
    const d = barToDate(bar);
    if (!d) continue;
    const k = keyOf(d);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push(bar);
  }

  const out: B[] = [];
  for (const k of order) {
    const grp = groups.get(k)!;
    if (grp.length === 0) continue;
    const first = grp[0];
    const last = grp[grp.length - 1];
    const anchor = anchorOf(barToDate(first)!);
    let hi = -Infinity, lo = Infinity, vol = 0;
    for (const b of grp) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
      if (typeof b.volume === "number") vol += b.volume;
    }
    out.push({
      ...first,
      time: Math.floor(anchor.getTime() / 1000),
      date: anchor.toISOString().slice(0, 10),
      open: first.open,
      high: hi,
      low: lo,
      close: last.close,
      volume: vol || undefined,
    } as B);
  }
  return out;
}

/** Convenience: aggregate if the timeframe needs it, else return as-is. */
export function maybeAggregate<B extends OHLCBarLike>(bars: B[] | undefined, tf: Timeframe): B[] {
  const meta = TIMEFRAMES[tf];
  if (!meta.aggregateFrom || !meta.aggregateBucket) return bars || [];
  return aggregateBars(bars, meta.aggregateBucket);
}
