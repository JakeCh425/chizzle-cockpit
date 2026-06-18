// ─── Live Pattern-Forming Detector ──────────────────────────────────────────
// Runs on the CURRENT (still-forming) bar — combines today's live OHLC from the
// price quote with the prior closed daily bars to detect setups IN PROGRESS.
//
// Returns a smart label like:
//   "Hammer forming after lower low — watch the close"
//   "Bullish engulfing in progress — needs close > $X"
//   "Setup invalid — close not clearing setup high"
//
// This is intentionally separate from the historical `confirmationDetector` —
// that one fires once per confirmed signal and is recorded to signal_history.
// This one is a *live status* meant to refresh every 30-60s in the UI.

import { safeHistory, type DailyBar } from "./marketData";
import { getQuote, fetchTwelveDataOHLCBars } from "./priceService";
import { _internal as detectorInternals } from "./confirmationDetector";

const { isHammer, isBullishEngulfing, SMA_ABOVE_PCT } = detectorInternals;

export type FormingSeverity = "watch" | "warm" | "hot" | "invalid" | "none";

export interface PatternFormingStatus {
  symbol: string;
  status: "forming" | "confirmed" | "invalid" | "none";
  label: string;                   // human-readable smart label
  pattern: "Hammer" | "Engulfing" | null;
  severity: FormingSeverity;
  candleProgress: number;          // 0..1 — fraction of the trading day elapsed
  currentBar: {
    open: number;
    high: number;
    low: number;
    close: number;                 // current price = close-so-far
  };
  context: {
    lowerLow: boolean;             // current low < min(prior 10 bars' lows)
    aboveSMA20: boolean | null;
    distPctFromSMA20: number | null;
    setupHigh: number | null;      // level the close must clear to confirm
    targetClose: number | null;    // what we need at close to qualify
  };
  asOf: number;                    // epoch ms
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  let s = 0;
  for (let i = values.length - n; i < values.length; i++) s += values[i];
  return s / n;
}

// US equity regular session: 09:30–16:00 ET. We approximate using current time
// in ET. If markets are closed, candleProgress = 1 (the bar "is" the day).
function tradingDayProgress(): number {
  const now = new Date();
  // Use ET via Intl
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  const minutesIntoDay = hour * 60 + minute;
  const open = 9 * 60 + 30;    // 09:30 ET
  const close = 16 * 60;       // 16:00 ET
  if (minutesIntoDay <= open) return 0;
  if (minutesIntoDay >= close) return 1;
  return (minutesIntoDay - open) / (close - open);
}

function isLowerLow(currLow: number, priors: DailyBar[], lookback = 10): boolean {
  const recent = priors.slice(-lookback);
  if (recent.length === 0) return false;
  const minLow = Math.min(...recent.map(b => b.low));
  return currLow < minLow;
}

// Compose the live bar from the quote. We treat `price` as close-so-far.
function buildLiveBar(q: { open: number; high: number; low: number; price: number }): DailyBar {
  return {
    date: new Date().toISOString().slice(0, 10),
    ts: Math.floor(Date.now() / 1000),
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.price,
    volume: 0,
  };
}

// ─── 4H bar fetch ───────────────────────────────────────────────────────────
async function fetch4HHistory(symbol: string): Promise<DailyBar[] | null> {
  const bars = await fetchTwelveDataOHLCBars(symbol, "4h");
  if (!bars || bars.length === 0) return null;
  return bars.map(b => ({
    date: new Date(b.time * 1000).toISOString().slice(0, 10),
    ts: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

// ─── Main entry ─────────────────────────────────────────────────────────────
export async function detectPatternForming(
  symbol: string,
  opts: { timeframe?: "daily" | "4h" } = {}
): Promise<PatternFormingStatus> {
  const sym = symbol.toUpperCase();
  const timeframe = opts.timeframe ?? "daily";
  const progress = timeframe === "daily" ? tradingDayProgress() : 1; // 4h closes are discrete
  const asOf = Date.now();

  const empty = (label = "No active setup", severity: FormingSeverity = "none"): PatternFormingStatus => ({
    symbol: sym,
    status: "none",
    label,
    pattern: null,
    severity,
    candleProgress: progress,
    currentBar: { open: 0, high: 0, low: 0, close: 0 },
    context: { lowerLow: false, aboveSMA20: null, distPctFromSMA20: null, setupHigh: null, targetClose: null },
    asOf,
  });

  // 4H mode: use Twelve Data bars directly. The last bar may be the still-
  // forming 4H candle; we evaluate it the same way we evaluate the live daily
  // bar — checking hammer shape, engulfing vs. prior, and lower-low context.
  if (timeframe === "4h") {
    const bars4h = await fetch4HHistory(sym);
    if (!bars4h || bars4h.length < 25) {
      return empty("4H data unavailable");
    }
    const liveBar = bars4h[bars4h.length - 1];
    const priors = bars4h.slice(0, -1);
    const lastClosed = priors[priors.length - 1];
    const priorToSetup = priors[priors.length - 2];
    const closesAll = bars4h.map(b => b.close);
    const sma20 = sma(closesAll, 20);
    const distPct = sma20 ? (liveBar.close - sma20) / sma20 : null;
    const aboveSMA20 = sma20 != null ? liveBar.close > sma20 : null;
    const lowerLow = isLowerLow(liveBar.low, priors);

    if (isHammer(liveBar)) {
      return {
        symbol: sym, status: "forming", pattern: "Hammer",
        label: lowerLow ? "4H hammer forming after lower low — strong reversal signal" : "4H hammer forming — watch the close",
        severity: lowerLow ? "hot" : "warm",
        candleProgress: progress,
        currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
        context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh: Math.max(liveBar.open, liveBar.close, liveBar.high), targetClose: null },
        asOf,
      };
    }
    if (isBullishEngulfing(lastClosed, liveBar)) {
      return {
        symbol: sym, status: "forming", pattern: "Engulfing",
        label: "4H bullish engulfing in progress",
        severity: "hot",
        candleProgress: progress,
        currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
        context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh: Math.max(lastClosed.open, lastClosed.close, lastClosed.high), targetClose: lastClosed.open },
        asOf,
      };
    }
    // Confirmation candle on a prior 4H setup
    const setupIsHammer = isHammer(lastClosed);
    const setupIsEngulfing = priorToSetup ? isBullishEngulfing(priorToSetup, lastClosed) : false;
    if (setupIsHammer || setupIsEngulfing) {
      const setupHigh = Math.max(lastClosed.open, lastClosed.close, lastClosed.high);
      if (liveBar.close > setupHigh) {
        return {
          symbol: sym, status: "confirmed", pattern: setupIsEngulfing ? "Engulfing" : "Hammer",
          label: `4H ${setupIsEngulfing ? "engulfing" : "hammer"} confirmed — cleared $${setupHigh.toFixed(2)}`,
          severity: "hot",
          candleProgress: progress,
          currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
          context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh, targetClose: setupHigh },
          asOf,
        };
      }
      const gap = setupHigh - liveBar.close;
      return {
        symbol: sym, status: "forming", pattern: setupIsEngulfing ? "Engulfing" : "Hammer",
        label: `4H ${setupIsEngulfing ? "engulfing" : "hammer"} setup — needs close > $${setupHigh.toFixed(2)} (gap $${gap.toFixed(2)})`,
        severity: "warm",
        candleProgress: progress,
        currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
        context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh, targetClose: setupHigh },
        asOf,
      };
    }
    return empty("No active 4H setup");
  }

  const quote = getQuote(sym);
  if (!quote || !quote.price) {
    return empty("Live quote unavailable");
  }

  const history = await safeHistory(sym).catch(() => [] as DailyBar[]);
  if (history.length < 25) {
    return empty("Not enough history yet");
  }

  // Some live providers (e.g. Nasdaq snapshot) don't populate open/high/low.
  // When that happens, derive a synthetic OHLC for today using prevClose as the
  // open anchor and the live price + prevClose envelope for high/low so the
  // pattern primitives still have meaningful bar shape to evaluate.
  const synthOpen = quote.open && quote.open > 0 ? quote.open : quote.prevClose;
  const synthHigh = quote.high && quote.high > 0 ? quote.high : Math.max(synthOpen, quote.price);
  const synthLow = quote.low && quote.low > 0 ? quote.low : Math.min(synthOpen, quote.price);
  const liveBar = buildLiveBar({
    open: synthOpen,
    high: synthHigh,
    low: synthLow,
    price: quote.price,
  });
  const priors = history; // last bar of `history` may be yesterday's close
  const lastClosed = priors[priors.length - 1];

  // SMA20 of closes including today (live close-so-far)
  const closesWithLive = [...priors.map(b => b.close), liveBar.close];
  const sma20 = sma(closesWithLive, 20);
  const distPct = sma20 ? (liveBar.close - sma20) / sma20 : null;
  const aboveSMA20 = sma20 != null ? liveBar.close > sma20 : null;

  const lowerLow = isLowerLow(liveBar.low, priors.slice(0, -1)); // exclude today's bar from lookback

  // ── Case A: Hammer forming on the LIVE bar ───────────────────────────────
  if (isHammer(liveBar)) {
    // To "confirm" tomorrow's close needs to clear today's high. For *today's*
    // forming label, we report shape + lower-low context.
    const isGreen = liveBar.close > liveBar.open;
    const shapeLabel = isGreen ? "Green hammer" : "Hammer";
    let label: string;
    let severity: FormingSeverity = "warm";
    if (lowerLow) {
      label = `${shapeLabel} forming after lower low — watch the close`;
      severity = "hot";
    } else {
      label = `${shapeLabel} forming — needs to hold the lower wick`;
    }
    // Off-band: extended above SMA20. Per Off-Band Pullback spec, this is
    // awareness-only (not weak) when it follows a lower low. Keep severity
    // honest; never drop below "warm" if lower-low context is present.
    if (distPct != null && distPct > SMA_ABOVE_PCT) {
      if (lowerLow && isGreen) {
        label = `Off-Band ${shapeLabel.toLowerCase()} after lower low — awareness setup`;
        severity = "warm";
      } else {
        label = `Off-Band ${shapeLabel.toLowerCase()} — outside SMA20 band`;
        severity = "watch";
      }
    }
    return {
      symbol: sym,
      status: "forming",
      label,
      pattern: "Hammer",
      severity,
      candleProgress: progress,
      currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
      context: {
        lowerLow,
        aboveSMA20,
        distPctFromSMA20: distPct,
        setupHigh: Math.max(liveBar.open, liveBar.close, liveBar.high),
        targetClose: null,
      },
      asOf,
    };
  }

  // ── Case B: Bullish Engulfing forming (live bar vs. last closed bar) ─────
  if (isBullishEngulfing(lastClosed, liveBar)) {
    let label = "Bullish engulfing in progress — close must hold above setup";
    let severity: FormingSeverity = "hot";
    if (distPct != null && distPct > SMA_ABOVE_PCT) {
      if (lowerLow) {
        label = "Off-Band engulfing after lower low — awareness setup";
        severity = "warm";
      } else {
        label = "Off-Band engulfing — outside SMA20 band";
        severity = "watch";
      }
    }
    return {
      symbol: sym,
      status: "forming",
      label,
      pattern: "Engulfing",
      severity,
      candleProgress: progress,
      currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
      context: {
        lowerLow,
        aboveSMA20,
        distPctFromSMA20: distPct,
        setupHigh: Math.max(lastClosed.open, lastClosed.close, lastClosed.high),
        targetClose: lastClosed.open, // needs to close >= prev open for engulfment
      },
      asOf,
    };
  }

  // ── Case C: PARTIAL engulfing — live close > prev close but not yet ≥ prev open ─
  const prevBearish = lastClosed.close < lastClosed.open;
  if (prevBearish && liveBar.close > lastClosed.close && liveBar.close < lastClosed.open) {
    const needed = lastClosed.open;
    const gap = needed - liveBar.close;
    return {
      symbol: sym,
      status: "forming",
      label: `Bullish reversal building — needs close ≥ $${needed.toFixed(2)} (gap $${gap.toFixed(2)})`,
      pattern: "Engulfing",
      severity: "warm",
      candleProgress: progress,
      currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
      context: {
        lowerLow,
        aboveSMA20,
        distPctFromSMA20: distPct,
        setupHigh: Math.max(lastClosed.open, lastClosed.close, lastClosed.high),
        targetClose: needed,
      },
      asOf,
    };
  }

  // ── Case D: Confirmation candle forming (yesterday was a hammer/engulfing setup) ─
  // If yesterday looks like a hammer OR an engulfing across (-2,-1), and today's
  // live close is above yesterday's high → confirmation IN PROGRESS.
  const setup = lastClosed;
  const priorToSetup = priors[priors.length - 2];
  const setupIsHammer = isHammer(setup);
  const setupIsEngulfing = priorToSetup ? isBullishEngulfing(priorToSetup, setup) : false;
  if (setupIsHammer || setupIsEngulfing) {
    const setupHigh = Math.max(setup.open, setup.close, setup.high);
    if (liveBar.close > setupHigh) {
      return {
        symbol: sym,
        status: "confirmed",
        label: `Setup confirmed live — ${setupIsEngulfing ? "Engulfing" : "Hammer"} confirmation candle clearing $${setupHigh.toFixed(2)}`,
        pattern: setupIsEngulfing ? "Engulfing" : "Hammer",
        severity: "hot",
        candleProgress: progress,
        currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
        context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh, targetClose: setupHigh },
        asOf,
      };
    }
    // Close not yet clearing
    const gap = setupHigh - liveBar.close;
    return {
      symbol: sym,
      status: "forming",
      label: `${setupIsEngulfing ? "Engulfing" : "Hammer"} setup yesterday — needs close > $${setupHigh.toFixed(2)} to confirm (gap $${gap.toFixed(2)})`,
      pattern: setupIsEngulfing ? "Engulfing" : "Hammer",
      severity: progress > 0.85 ? "invalid" : "warm",
      candleProgress: progress,
      currentBar: { open: liveBar.open, high: liveBar.high, low: liveBar.low, close: liveBar.close },
      context: { lowerLow, aboveSMA20, distPctFromSMA20: distPct, setupHigh, targetClose: setupHigh },
      asOf,
    };
  }

  return empty();
}
