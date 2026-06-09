// ─── Candlestick Confirmation Module ────────────────────────────────────────
// A focused implementation of the pseudo-code spec: detect when a ticker is
// only FORMING a bullish reversal versus when it is fully CONFIRMED and READY
// to trade, gated by proximity to the daily SMA20 pullback band.
//
// This is intentionally a separate file from the existing `confirmationDetector`
// (which scans for confirmed signals and writes to signal_history) and from
// `patternForming` (which emits free-form smart labels). This one owns the
// status state machine the user specified verbatim:
//
//   No Valid Trigger Yet
//   Hammer Forming
//   Engulfing Forming
//   Confirmed Hammer
//   Confirmed Bullish Engulfing
//   Ready to Trade

import { safeHistory, type DailyBar } from "./marketData";
import { getQuote } from "./priceService";
import { fetchTwelveDataOHLCBars } from "./priceService";

// ─── Types ──────────────────────────────────────────────────────────────────
export type PatternStatus =
  | "No Valid Trigger Yet"
  | "Hammer Forming"
  | "Engulfing Forming"
  | "Confirmed Hammer"
  | "Confirmed Bullish Engulfing"
  | "Ready to Trade";

export type EntryMode = "aggressive" | "conservative";
export type Timeframe = "daily" | "4h";

export interface CandleConfirmationOutput {
  ticker: string;
  timeframe: Timeframe;
  price: number;
  daily_sma20: number | null;
  distance_from_sma20_percent: number | null;
  pattern_status: PatternStatus;
  trigger_price: number | null;
  invalidation_price: number | null;
  entry_mode: EntryMode;
  notes: string;
  // diagnostic context (not part of the spec, but useful for the UI):
  near_sma20: boolean;
  short_term_decline: boolean;
  candle_closed: boolean;
  pattern_detected_on: "Hammer" | "Engulfing" | null;
}

export interface ConfirmOptions {
  conservative_mode?: boolean;          // default: true
  sma_band_percent?: number;            // default: 2.0  (2.0 = ±2% band)
  timeframe?: Timeframe;                // default: "daily"
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function sma20(closes: number[]): number | null {
  if (closes.length < 20) return null;
  let s = 0;
  for (let i = closes.length - 20; i < closes.length; i++) s += closes[i];
  return s / 20;
}

// "Recent candles show weakness" — at least one of:
//   • last 3 closes form lower highs OR lower lows
//   • current bar's low is below the 5-bar low (excluding current)
//   • close has dropped >= 1.5% over the last 5 bars
// We deliberately keep this loose; the SMA20 proximity gate carries most of
// the weight in deciding "is this a pullback?".
function shortTermDecline(priors: DailyBar[], currentLow: number): boolean {
  if (priors.length < 5) return false;
  const last3 = priors.slice(-3);
  const last5 = priors.slice(-5);

  const lowerHighs = last3.length === 3
    && last3[0].high > last3[1].high
    && last3[1].high > last3[2].high;
  const lowerLows = last3.length === 3
    && last3[0].low > last3[1].low
    && last3[1].low > last3[2].low;

  const min5Low = Math.min(...last5.map(b => b.low));
  const currentBelowRecentLow = currentLow < min5Low;

  const close5Ago = last5[0].close;
  const closeLatest = last5[last5.length - 1].close;
  const fivebarDrop = (close5Ago - closeLatest) / close5Ago >= 0.015;

  return lowerHighs || lowerLows || currentBelowRecentLow || fivebarDrop;
}

// ─── Pattern primitives (spec verbatim) ─────────────────────────────────────
function isHammer(c: DailyBar): boolean {
  const body = Math.abs(c.close - c.open);
  if (body === 0) return false;
  const range = c.high - c.low;
  if (range === 0) return false;
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  return (
    c.close > c.open &&
    lowerWick >= 2 * body &&
    upperWick <= body &&
    c.close >= c.low + 0.67 * range
  );
}

function isBullishEngulfing(prev: DailyBar, curr: DailyBar): boolean {
  return (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

// ─── Live-bar synthesis (daily mode only) ───────────────────────────────────
function buildLiveBar(q: { open: number; high: number; low: number; price: number; prevClose: number }): DailyBar {
  // When the provider omits intraday OHLC we anchor to prevClose so the body
  // shape is meaningful (matches what we do in patternForming.ts).
  const open = q.open && q.open > 0 ? q.open : q.prevClose;
  const high = q.high && q.high > 0 ? q.high : Math.max(open, q.price);
  const low = q.low && q.low > 0 ? q.low : Math.min(open, q.price);
  return {
    date: new Date().toISOString().slice(0, 10),
    ts: Math.floor(Date.now() / 1000),
    open, high, low,
    close: q.price,
    volume: 0,
  };
}

// True if the US regular session has closed (≥16:00 ET)
function isMarketClosedET(): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return true;
  const minutesIntoDay = hour * 60 + minute;
  return minutesIntoDay >= 16 * 60; // 16:00 ET cash close
}

// ─── 4H fetch ───────────────────────────────────────────────────────────────
async function fetch4HBars(symbol: string): Promise<DailyBar[] | null> {
  const bars = await fetchTwelveDataOHLCBars(symbol, "4h");
  if (!bars || bars.length === 0) return null;
  return bars.map(b => ({
    date: new Date(b.time * 1000).toISOString().slice(0, 10),
    ts: b.time,
    open: b.open, high: b.high, low: b.low, close: b.close,
    volume: b.volume,
  }));
}

// ─── Note builder ───────────────────────────────────────────────────────────
function buildNote(
  status: PatternStatus,
  near_sma20: boolean,
  pattern: "Hammer" | "Engulfing" | null,
  entry_mode: EntryMode
): string {
  if (!near_sma20 && pattern) {
    return "Pattern valid but extended from pullback zone.";
  }
  switch (status) {
    case "Hammer Forming":
      return "Hammer shape building; wait for close.";
    case "Engulfing Forming":
      return "Engulfing forming; wait for close above prior open.";
    case "Confirmed Hammer":
      return entry_mode === "conservative"
        ? "Hammer confirmed near SMA20. Wait for break above hammer high."
        : "Hammer confirmed near SMA20; entry above high, stop below low.";
    case "Confirmed Bullish Engulfing":
      return entry_mode === "conservative"
        ? "Bullish engulfing confirmed; entry above pattern high preferred."
        : "Bullish engulfing confirmed near SMA20; entry above pattern high, stop below low.";
    case "Ready to Trade":
      return pattern === "Hammer"
        ? "Hammer confirmed and trigger cleared. Stop below pattern low."
        : "Bullish engulfing confirmed and trigger cleared. Stop below pattern low.";
    case "No Valid Trigger Yet":
    default:
      return near_sma20
        ? "No valid reversal pattern at SMA20."
        : "Price extended; awaiting pullback to SMA20.";
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────
export async function evaluateCandleConfirmation(
  symbol: string,
  opts: ConfirmOptions = {}
): Promise<CandleConfirmationOutput> {
  const ticker = symbol.toUpperCase();
  const timeframe = opts.timeframe ?? "daily";
  const conservative = opts.conservative_mode ?? true;
  const entry_mode: EntryMode = conservative ? "conservative" : "aggressive";
  const band = opts.sma_band_percent ?? 2.0;

  const empty = (msg = "No Valid Trigger Yet", price = 0, sma: number | null = null, dist: number | null = null): CandleConfirmationOutput => ({
    ticker,
    timeframe,
    price,
    daily_sma20: sma,
    distance_from_sma20_percent: dist,
    pattern_status: "No Valid Trigger Yet",
    trigger_price: null,
    invalidation_price: null,
    entry_mode,
    notes: msg,
    near_sma20: false,
    short_term_decline: false,
    candle_closed: false,
    pattern_detected_on: null,
  });

  // ── Source bars ────────────────────────────────────────────────────────
  let bars: DailyBar[];
  let currentCandle: DailyBar;
  let candleClosed: boolean;
  let currentPrice: number;
  let nextCandle: DailyBar | undefined; // for conservative confirmation

  if (timeframe === "4h") {
    const b = await fetch4HBars(ticker);
    if (!b || b.length < 22) return empty("4H data unavailable.");
    // For 4H, we treat the LAST bar as the most-recent candle. Twelve Data
    // closes 4h bars discretely, so the latest bar is effectively closed once
    // its window has passed (we check by comparing ts to now).
    const lastBar = b[b.length - 1];
    const nowSec = Math.floor(Date.now() / 1000);
    candleClosed = nowSec - lastBar.ts >= 4 * 3600; // closed if ≥4h since open
    currentCandle = lastBar;
    currentPrice = lastBar.close;
    bars = candleClosed ? b : b.slice(0, -1); // priors for SMA/decline
    if (candleClosed) bars = b; // include closed bar in priors
    nextCandle = undefined;     // 4h doesn't have a "next" bar yet
  } else {
    const hist = await safeHistory(ticker).catch(() => [] as DailyBar[]);
    if (hist.length < 22) return empty("Not enough daily history.");

    // The "current candle" is today's live bar if the market is open, OR
    // yesterday's closed bar if the market is closed (then we look for a
    // "next candle" confirmation — there is none yet, so conservative mode
    // stays at "Confirmed *" until the next session prints).
    const marketClosed = isMarketClosedET();
    const quote = getQuote(ticker);

    if (marketClosed) {
      // Most recent closed bar is the "current candle"; there is no next yet.
      currentCandle = hist[hist.length - 1];
      candleClosed = true;
      currentPrice = quote?.price && quote.price > 0 ? quote.price : currentCandle.close;
      bars = hist;
      nextCandle = undefined;
    } else {
      // Live, forming bar synthesized from the intraday quote.
      if (!quote || !quote.price) return empty("Live quote unavailable.");
      currentCandle = buildLiveBar({
        open: quote.open,
        high: quote.high,
        low: quote.low,
        price: quote.price,
        prevClose: quote.prevClose,
      });
      candleClosed = false;
      currentPrice = quote.price;
      bars = hist; // priors = full history (already excludes today)
      nextCandle = undefined;
    }
  }

  // ── SMA20 + distance ────────────────────────────────────────────────────
  const closesForSMA = bars.map(b => b.close);
  // If today's bar isn't in `bars` yet (live daily mode), include the live close
  // in SMA20 to get a more current reference.
  if (timeframe === "daily" && !candleClosed) closesForSMA.push(currentPrice);
  const dailySMA20 = sma20(closesForSMA);
  if (dailySMA20 == null) return empty("SMA20 not available.", currentPrice);

  const distance_from_sma20_percent =
    Math.abs(currentPrice - dailySMA20) / dailySMA20 * 100;
  const near_sma20 = distance_from_sma20_percent <= band;

  // ── Short-term decline check ────────────────────────────────────────────
  const priorsForDecline = candleClosed ? bars.slice(0, -1) : bars;
  const short_term_decline = shortTermDecline(priorsForDecline, currentCandle.low);

  // ── Pattern checks ──────────────────────────────────────────────────────
  const hammer = isHammer(currentCandle);
  // For engulfing, the "previous candle" is the bar BEFORE the current.
  const prev = candleClosed ? bars[bars.length - 2] : bars[bars.length - 1];
  const engulfing = prev ? isBullishEngulfing(prev, currentCandle) : false;

  let pattern_status: PatternStatus = "No Valid Trigger Yet";
  let pattern_detected_on: "Hammer" | "Engulfing" | null = null;
  let trigger_price: number | null = null;
  let invalidation_price: number | null = null;

  if (!candleClosed) {
    // FORMING branch
    if (near_sma20 && short_term_decline && hammer) {
      pattern_status = "Hammer Forming";
      pattern_detected_on = "Hammer";
    } else if (near_sma20 && short_term_decline && engulfing) {
      pattern_status = "Engulfing Forming";
      pattern_detected_on = "Engulfing";
    }
  } else {
    // CONFIRMED branch
    if (near_sma20 && short_term_decline && hammer) {
      pattern_status = "Confirmed Hammer";
      pattern_detected_on = "Hammer";
      trigger_price = currentCandle.high;
      invalidation_price = currentCandle.low;
    } else if (near_sma20 && short_term_decline && engulfing) {
      pattern_status = "Confirmed Bullish Engulfing";
      pattern_detected_on = "Engulfing";
      trigger_price = currentCandle.high;
      invalidation_price = currentCandle.low;
    }

    // READY TO TRADE upgrade
    if (pattern_status === "Confirmed Hammer" || pattern_status === "Confirmed Bullish Engulfing") {
      if (!conservative) {
        pattern_status = "Ready to Trade";
      } else if (nextCandle && trigger_price != null) {
        const nc = nextCandle as DailyBar;
        if (nc.high > trigger_price || nc.close > trigger_price) {
          pattern_status = "Ready to Trade";
        }
      }
    }
  }

  const notes = buildNote(pattern_status, near_sma20, pattern_detected_on, entry_mode);

  return {
    ticker,
    timeframe,
    price: Number(currentPrice.toFixed(4)),
    daily_sma20: Number(dailySMA20.toFixed(4)),
    distance_from_sma20_percent: Number(distance_from_sma20_percent.toFixed(2)),
    pattern_status,
    trigger_price: trigger_price != null ? Number(trigger_price.toFixed(4)) : null,
    invalidation_price: invalidation_price != null ? Number(invalidation_price.toFixed(4)) : null,
    entry_mode,
    notes,
    near_sma20,
    short_term_decline,
    candle_closed: candleClosed,
    pattern_detected_on,
  };
}
