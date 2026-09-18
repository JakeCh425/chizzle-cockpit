// ─── Chart timeframes ─────────────────────────────────────────────────────
// Single source of truth for the Cockpit chart's timeframe switcher.
//
// Contract with the server:
//   - GET /api/candles-ohlc/:symbol?interval=<TF_API>
//   - Existing supported intervals: 1D | 1H | 4H | 30M | 5M
//   - We DO NOT invent new intervals here — every value in `SUPPORTED` maps
//     to something the server already returns. Anything not in this list
//     stays out of the UI so we never fabricate candles.
//
// Purely a UI/URL contract. No schema change, no server change.

export type Timeframe = "5m" | "30m" | "1H" | "4H" | "1D";

export interface TimeframeMeta {
  key: Timeframe;
  label: string;      // What we show in the button ("5m", "1H", …)
  apiValue: string;   // What we send to the server (?interval=)
  group: "MINUTES" | "HOURS" | "DAYS";
  // How many trailing bars to keep visible by default when this TF is picked.
  // Kept small enough that hand-rolled indicator math stays fast, big enough
  // that SMA(200) still resolves for 1D and 4H.
  defaultVisibleBars: number;
  // How the timeframe reads in an English sentence: "on the 4-hour chart".
  spoken: string;
}

export const TIMEFRAMES: Record<Timeframe, TimeframeMeta> = {
  "5m":  { key: "5m",  label: "5m",  apiValue: "5M",  group: "MINUTES", defaultVisibleBars: 78,  spoken: "on the 5-minute chart" },   // ~1 trading day
  "30m": { key: "30m", label: "30m", apiValue: "30M", group: "MINUTES", defaultVisibleBars: 130, spoken: "on the 30-minute chart" },  // ~10 trading days
  "1H":  { key: "1H",  label: "1H",  apiValue: "1H",  group: "HOURS",   defaultVisibleBars: 140, spoken: "on the 1-hour chart" },     // ~20 trading days
  "4H":  { key: "4H",  label: "4H",  apiValue: "4H",  group: "HOURS",   defaultVisibleBars: 130, spoken: "on the 4-hour chart" },     // ~3 months
  "1D":  { key: "1D",  label: "1D",  apiValue: "1D",  group: "DAYS",    defaultVisibleBars: 252, spoken: "on the daily chart" },       // ~1 year
};

// Order shown in the quick-access strip in the chart header. 30m/1H/4H/1D
// are the swing-trader defaults; 5m lives in the More dropdown only.
export const QUICK_TIMEFRAMES: Timeframe[] = ["30m", "1H", "4H", "1D"];
export const MORE_TIMEFRAMES: Timeframe[] = ["5m"];
export const ALL_TIMEFRAMES: Timeframe[] = ["5m", "30m", "1H", "4H", "1D"];

// LocalStorage key for the per-ticker sticky timeframe. Keeping the ticker in
// the key means SPY on 1H and QQQ on 4H don't fight each other.
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
