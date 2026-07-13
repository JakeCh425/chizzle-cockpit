// Chizzle Swing Scanner
// -----------------------------------------------------------------------------
// Scans a universe of ETFs (+ optional single stocks), computes a
// professional-quality auto-entry (near 20 SMA / recent support), sizes a stop
// at prior swing low, projects T1 = last swing high and T2 = T1 * 1.02, then
// runs each candidate through the existing Chizzle Trade Evaluator. Returns
// the top 1-3 setups plus market tone and risk guidance.
//
// Design notes:
// - Uses fetchTwelveDataDailyOHLC (already used by the evaluator) for consistent
//   daily bars across the app. One call per symbol; universe stays small.
// - MARKET_TONE derived from SPY vs its own 20 SMA + intraday breadth
//   (share of universe above their own 20 SMA).
// - Risk guidance is deterministic from tone + count of approved setups so the
//   UI never has to interpret free-form language.

import {
  evaluateTrade,
  type TradeCheckResult,
  type TradeStatus,
} from "./tradeEvaluator";
import { safeHistory, type DailyBar } from "./marketData";

export type MarketTone = "trending" | "orderly_pullback" | "choppy";

export interface SwingScanInput {
  include_stocks?: boolean;
  universe?: string[]; // optional override
}

export interface SwingSetup {
  ticker: string;
  direction: "long";
  setup_type: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  risk_reward: number;
  status: TradeStatus;
  technical_score: number;
  fundamental_score: number;
  one_sentence_reason: string;
  card_summary_5_lines: string[] | null;
  distance_from_sma20_pct: number;
  current_price: number;
  sma20: number;
}

export interface SwingScanResult {
  market_tone: MarketTone;
  scanned_at: string;
  universe_size: number;
  include_stocks: boolean;
  setups: SwingSetup[];
  risk_guidance: {
    max_positions: number;
    size: "tiny_practice" | "small" | "normal" | "no_new";
    note: string;
  };
  diagnostics: {
    spy_last: number | null;
    spy_sma20: number | null;
    spy_dist_pct: number | null;
    pct_above_20sma: number;
    rejected: Array<{ ticker: string; reason: string }>;
  };
}

// Universe — matches the tone of the user's finance briefings.
const ETF_UNIVERSE = [
  "SPY",
  "QQQ",
  "IWM",
  "SMH",
  "XLF",
  "XLE",
  "XLK",
  "XLV",
  "XLI",
  "XLU",
  "XLP",
  "XLY",
  "XLB",
  "XLRE",
  "XBI",
];

const STOCK_UNIVERSE = ["NVDA", "AMD", "MU", "TSM", "AAPL", "META", "MSFT"];

function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

// Find the lowest low over the last `lookback` bars, excluding today.
function recentSwingLow(lows: number[], lookback: number): number | null {
  if (lows.length < lookback + 1) return null;
  const window = lows.slice(-lookback - 1, -1); // exclude today
  return Math.min(...window);
}

function recentSwingHigh(highs: number[], lookback: number): number | null {
  if (highs.length < lookback) return null;
  return Math.max(...highs.slice(-lookback));
}

interface Candidate {
  ticker: string;
  bars: {
    close: number;
    high: number;
    low: number;
    volume?: number;
  }[];
}

async function fetchBars(
  ticker: string,
): Promise<Candidate["bars"] | null> {
  try {
    const bars = await safeHistory(ticker);
    if (!bars || bars.length < 30) return null;
    return bars.map((b: DailyBar) => ({
      close: Number(b.close),
      high: Number(b.high),
      low: Number(b.low),
      volume: b.volume != null ? Number(b.volume) : undefined,
    }));
  } catch {
    return null;
  }
}

function classifyTone(
  spyLast: number,
  spyDistPct: number,
  breadthPctAbove20: number,
): MarketTone {
  // trending: SPY at least +1% above 20SMA AND >=60% of universe above own 20SMA
  if (spyDistPct >= 1.0 && breadthPctAbove20 >= 0.6) return "trending";
  // orderly_pullback: SPY 0..+1.5% above 20SMA AND >=45% breadth
  if (spyDistPct >= -0.5 && spyDistPct <= 1.5 && breadthPctAbove20 >= 0.45)
    return "orderly_pullback";
  return "choppy";
}

function pickSize(
  tone: MarketTone,
  approvedCount: number,
): SwingScanResult["risk_guidance"] {
  if (approvedCount === 0)
    return {
      max_positions: 0,
      size: "no_new",
      note: "No professional setups cleared the filters. Wait.",
    };
  if (tone === "choppy")
    return {
      max_positions: 1,
      size: "tiny_practice",
      note: "Choppy tape — 1 best idea at practice size only.",
    };
  if (tone === "orderly_pullback")
    return {
      max_positions: 2,
      size: "small",
      note: "Orderly pullback — 1-2 positions at small size.",
    };
  return {
    max_positions: 3,
    size: "normal",
    note: "Trending tape — up to 3 positions, normal size.",
  };
}

export async function runSwingScan(
  input: SwingScanInput,
): Promise<SwingScanResult> {
  const includeStocks = input.include_stocks === true;
  const universe =
    input.universe && input.universe.length > 0
      ? input.universe
      : includeStocks
        ? [...ETF_UNIVERSE, ...STOCK_UNIVERSE]
        : ETF_UNIVERSE;

  // Fetch bars in parallel (bounded by the price feed).
  const results = await Promise.all(
    universe.map(async (t) => ({ ticker: t, bars: await fetchBars(t) })),
  );
  const valid: Candidate[] = results.filter(
    (r): r is Candidate => r.bars !== null,
  );

  // Compute breadth + SPY tone anchors.
  let aboveCount = 0;
  let spyLast: number | null = null;
  let spySma20: number | null = null;
  for (const c of valid) {
    const closes = c.bars.map((b) => b.close);
    const s20 = sma(closes, 20);
    if (s20 !== null) {
      const last = closes[closes.length - 1];
      if (last > s20) aboveCount++;
      if (c.ticker === "SPY") {
        spyLast = last;
        spySma20 = s20;
      }
    }
  }
  const breadth = valid.length > 0 ? aboveCount / valid.length : 0;
  const spyDistPct =
    spyLast !== null && spySma20 !== null
      ? ((spyLast - spySma20) / spySma20) * 100
      : 0;
  const tone: MarketTone =
    spyLast !== null
      ? classifyTone(spyLast, spyDistPct, breadth)
      : "choppy";

  // Build candidate setups from each symbol.
  const rejected: Array<{ ticker: string; reason: string }> = [];
  const rawSetups: SwingSetup[] = [];

  for (const c of valid) {
    const closes = c.bars.map((b) => b.close);
    const highs = c.bars.map((b) => b.high);
    const lows = c.bars.map((b) => b.low);
    const last = closes[closes.length - 1];
    const s20 = sma(closes, 20);
    if (s20 === null) {
      rejected.push({ ticker: c.ticker, reason: "insufficient history" });
      continue;
    }
    const distPct = ((last - s20) / s20) * 100;

    // Only consider longs where price is at or near the 20 SMA pullback zone.
    // Accept -1.5% below to +3.5% above the 20 SMA (matches the user's flex band).
    if (distPct < -1.5 || distPct > 3.5) {
      rejected.push({
        ticker: c.ticker,
        reason: `${distPct.toFixed(2)}% from 20 SMA (outside pullback band)`,
      });
      continue;
    }

    // Auto entry: current price (the scan is a snapshot).
    // Auto stop: max(recent swing low over last 10 bars, price - 2*ATR14 fallback)
    const swingLow10 = recentSwingLow(lows, 10) ?? last * 0.97;
    const stop = Math.min(swingLow10, s20 * 0.985); // just below 20 SMA or swing low, whichever is lower
    const risk = last - stop;
    if (risk <= 0) {
      rejected.push({ ticker: c.ticker, reason: "invalid stop (>= entry)" });
      continue;
    }

    // Targets: T1 = last 20-day swing high (or 2R if higher), T2 = T1 * 1.02
    const swingHigh20 = recentSwingHigh(highs, 20) ?? last * 1.05;
    const t1Candidate = Math.max(swingHigh20, last + risk * 2);
    const t1 = t1Candidate;
    const t2 = t1 * 1.02;
    const rr = (t1 - last) / risk;

    if (rr < 2.0) {
      rejected.push({
        ticker: c.ticker,
        reason: `RR ${rr.toFixed(2)}:1 below 2:1 minimum`,
      });
      continue;
    }

    // Run through the full Chizzle evaluator.
    try {
      const verdict = await evaluateTrade({
        ticker: c.ticker,
        entry: Number(last.toFixed(2)),
        stop: Number(stop.toFixed(2)),
        t1: Number(t1.toFixed(2)),
        t2: Number(t2.toFixed(2)),
      });

      rawSetups.push({
        ticker: c.ticker,
        direction: "long",
        setup_type:
          distPct < 1.0
            ? "20 SMA pullback"
            : distPct < 2.5
              ? "20 SMA flex zone / reclaim"
              : "breakout-pullback watch",
        entry: Number(last.toFixed(2)),
        stop: Number(stop.toFixed(2)),
        t1: Number(t1.toFixed(2)),
        t2: Number(t2.toFixed(2)),
        risk_reward: Number(rr.toFixed(2)),
        status: verdict.status,
        technical_score: verdict.technical_score,
        fundamental_score: verdict.fundamental_score,
        one_sentence_reason: verdict.one_sentence_reason,
        card_summary_5_lines: verdict.card_summary_5_lines,
        distance_from_sma20_pct: Number(distPct.toFixed(2)),
        current_price: Number(last.toFixed(2)),
        sma20: Number(s20.toFixed(2)),
      });
    } catch (e: any) {
      rejected.push({
        ticker: c.ticker,
        reason: `evaluator error: ${e?.message || "unknown"}`,
      });
    }
  }

  // Rank: STANDARD > FLEX > PRACTICE > NO_TRADE, then by (technical + fundamental) desc, then by RR desc.
  const statusRank: Record<TradeStatus, number> = {
    STANDARD_SWING_APPROVED: 4,
    FLEX_SWING_APPROVED: 3,
    PRACTICE_CARD: 2,
    NO_TRADE: 1,
  };
  rawSetups.sort((a, b) => {
    if (statusRank[b.status] !== statusRank[a.status])
      return statusRank[b.status] - statusRank[a.status];
    const scoreA = a.technical_score + a.fundamental_score;
    const scoreB = b.technical_score + b.fundamental_score;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return b.risk_reward - a.risk_reward;
  });

  // Keep only approved-tier or better (drop NO_TRADEs from output).
  const approved = rawSetups.filter((s) => s.status !== "NO_TRADE");
  const risk = pickSize(tone, approved.length);
  const topSetups = approved.slice(0, risk.max_positions);

  return {
    market_tone: tone,
    scanned_at: new Date().toISOString(),
    universe_size: valid.length,
    include_stocks: includeStocks,
    setups: topSetups,
    risk_guidance: risk,
    diagnostics: {
      spy_last: spyLast,
      spy_sma20: spySma20,
      spy_dist_pct:
        spyLast !== null && spySma20 !== null
          ? Number(spyDistPct.toFixed(2))
          : null,
      pct_above_20sma: Number((breadth * 100).toFixed(1)),
      rejected,
    },
  };
}
