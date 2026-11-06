// ─── Mechanical SMA Swing Scanner (4H Regime & 1H Execution) ────────────────
// Implements the mechanical Moving Average strategy:
// 1. 4H Trend Filter (20 SMA > 50 SMA -> Bullish floors vs Bearish ceilings)
// 2. 1H Execution Logic (10, 20, 50 SMAs)
// 3. States:
//    - "CONFIRMED BOUNCE": Touched 10/20/50 SMA and closed green reclaiming the line
//    - "TESTING SMA (Wait for Close)": Touched SMA but 1H candle hasn't closed green
//    - "WAIT FOR RETEST (Entry Missed)": Price floating above all SMAs (no chasing)
//    - "STANDBY_DAY (Red Regime)": 4H 20 SMA <= 50 SMA (hard block all long swings)
// 4. Dynamic Risk: Stop Loss = 1.0 ATR below tested SMA | 2:1 Target = Entry + 2 * Risk

export const MECHANICAL_WATCHLIST = ["SMH", "QQQ", "SPY", "PLTR", "AVGO", "MRVL"];

export async function runMechanicalScan(symbols: string[] = MECHANICAL_WATCHLIST): Promise<MechanicalScanResult[]> {
  const { fetch1H } = await import("./swing/feed");
  const results: MechanicalScanResult[] = [];
  for (const sym of symbols) {
    try {
      const barsRes = await fetch1H(sym).catch(() => ({ bars: [] }));
      const bars = barsRes?.bars ?? [];
      const evaluated = evaluateMechanicalSMABars(sym, bars);
      scanCache.set(sym.toUpperCase(), evaluated);
      results.push(evaluated);
    } catch {
      const fallback = scanCache.get(sym.toUpperCase()) ?? evaluateMechanicalSMABars(sym, []);
      results.push(fallback);
    }
  }
  return results;
}

export type MechanicalStatus =
  | "STANDBY_DAY (Red Regime)"
  | "CONFIRMED BOUNCE"
  | "TESTING SMA (Wait for Close)"
  | "WAIT FOR RETEST (Entry Missed)";

export interface MechanicalScanResult {
  ticker: string;
  status: MechanicalStatus;
  actionable: boolean;
  price: number;
  regime4H: "Bullish" | "Bearish";
  is4hBullish: boolean;
  testedLine: "10_SMA" | "20_SMA" | "50_SMA" | null;
  testedPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit2R: number | null;
  riskPerShare: number | null;
  sma10_1h: number;
  sma20_1h: number;
  sma50_1h: number;
  atr14_1h: number;
  subtext: string;
  updatedAt: string;
}

export interface BarData {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export function calculateSMA(data: number[], window: number): number {
  if (data.length < window) return 0;
  const slice = data.slice(-window);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return +(sum / window).toFixed(2);
}

export function calculateATR(bars: BarData[], period = 14): number {
  if (bars.length < period + 1) return +(bars[bars.length - 1]?.c * 0.015 || 1).toFixed(2);
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h;
    const low = bars[i].l;
    const prevClose = bars[i - 1].c;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return +(sum / period).toFixed(2);
}

export function resample1HTo4H(bars1H: BarData[]): BarData[] {
  const bars4H: BarData[] = [];
  const chunkSize = 4;
  for (let i = 0; i < bars1H.length; i += chunkSize) {
    const chunk = bars1H.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    bars4H.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((sum, b) => sum + (b.v ?? 0), 0),
    });
  }
  return bars4H;
}

/**
 * Pure evaluation function matching the exact quantitative logic of the scanner
 */
export function evaluateMechanicalSMABars(ticker: string, bars1H: BarData[]): MechanicalScanResult {
  const cleanTicker = ticker.trim().toUpperCase();
  const nowIso = new Date().toISOString();

  if (!bars1H || bars1H.length < 50) {
    const lastPrice = bars1H && bars1H.length > 0 ? bars1H[bars1H.length - 1].c : 0;
    return {
      ticker: cleanTicker,
      status: "STANDBY_DAY (Red Regime)",
      actionable: false,
      price: lastPrice,
      regime4H: "Bearish",
      is4hBullish: false,
      testedLine: null,
      testedPrice: null,
      entryPrice: null,
      stopLoss: null,
      takeProfit2R: null,
      riskPerShare: null,
      sma10_1h: 0,
      sma20_1h: 0,
      sma50_1h: 0,
      atr14_1h: 0,
      subtext: "Insufficient historical bars to compute 50 SMA.",
      updatedAt: nowIso,
    };
  }

  // 1. 1-Hour Indicators
  const closes1H = bars1H.map((b) => b.c);
  const sma10_1h = calculateSMA(closes1H, 10);
  const sma20_1h = calculateSMA(closes1H, 20);
  const sma50_1h = calculateSMA(closes1H, 50);
  const atr14_1h = calculateATR(bars1H, 14);

  // 2. 4-Hour Resampling & Indicators
  const bars4H = resample1HTo4H(bars1H);
  const closes4H = bars4H.map((b) => b.c);
  const sma20_4h = calculateSMA(closes4H, 20);
  const sma50_4h = calculateSMA(closes4H, 50);

  const curr1H = bars1H[bars1H.length - 1];
  const is4hBullish = sma20_4h > sma50_4h;

  if (!is4hBullish) {
    return {
      ticker: cleanTicker,
      status: "STANDBY_DAY (Red Regime)",
      actionable: false,
      price: curr1H.c,
      regime4H: "Bearish",
      is4hBullish: false,
      testedLine: null,
      testedPrice: null,
      entryPrice: null,
      stopLoss: null,
      takeProfit2R: null,
      riskPerShare: null,
      sma10_1h,
      sma20_1h,
      sma50_1h,
      atr14_1h,
      subtext: `4H 20 SMA ($${sma20_4h.toFixed(2)}) is below 50 SMA ($${sma50_4h.toFixed(2)}). Moving averages act as resistance ceilings.`,
      updatedAt: nowIso,
    };
  }

  // 3. 1-Hour Execution Logic
  const low = curr1H.l;
  const close = curr1H.c;
  const open = curr1H.o;

  const touched10 = low <= sma10_1h;
  const touched20 = low <= sma20_1h;
  const touched50 = low <= sma50_1h;
  const touchedSma = touched10 || touched20 || touched50;

  const isGreenCandle = close > open;
  const reclaimed10 = touched10 && close > sma10_1h;
  const reclaimed20 = touched20 && close > sma20_1h;
  const reclaimed50 = touched50 && close > sma50_1h;
  const reclaimedSma = isGreenCandle && (reclaimed10 || reclaimed20 || reclaimed50);

  let status: MechanicalStatus;
  let actionable = false;
  let testedLine: "10_SMA" | "20_SMA" | "50_SMA" | null = null;
  let testedPrice: number | null = null;
  let stopLoss: number | null = null;
  let takeProfit2R: number | null = null;
  let riskPerShare: number | null = null;
  let subtext = "";

  if (touchedSma && reclaimedSma) {
    status = "CONFIRMED BOUNCE";
    actionable = true;

    // Prioritize deepest institutional floor touched & reclaimed
    if (reclaimed50) {
      testedLine = "50_SMA";
      testedPrice = sma50_1h;
    } else if (reclaimed20) {
      testedLine = "20_SMA";
      testedPrice = sma20_1h;
    } else {
      testedLine = "10_SMA";
      testedPrice = sma10_1h;
    }

    const entry = +(close).toFixed(2);
    // Stop Loss = 1.0 ATR below the exact tested SMA
    const calculatedStop = +(testedPrice - 1.0 * atr14_1h).toFixed(2);
    stopLoss = calculatedStop < entry ? calculatedStop : +(entry * 0.985).toFixed(2);
    riskPerShare = +(entry - stopLoss).toFixed(2);
    // Take Profit = Strict 2:1 R:R target
    takeProfit2R = +(entry + 2.0 * riskPerShare).toFixed(2);

    subtext = `Reclaimed ${testedLine.replace("_", " ")} ($${testedPrice.toFixed(2)}) green. 2:1 R:R target: $${takeProfit2R.toFixed(2)}.`;
  } else if (touchedSma && !reclaimedSma) {
    status = "TESTING SMA (Wait for Close)";
    actionable = false;
    testedLine = touched50 ? "50_SMA" : touched20 ? "20_SMA" : "10_SMA";
    testedPrice = touched50 ? sma50_1h : touched20 ? sma20_1h : sma10_1h;
    subtext = `Testing ${testedLine.replace("_", " ")} ($${testedPrice.toFixed(2)}) support floor. Awaiting 1H green candle close.`;
  } else {
    status = "WAIT FOR RETEST (Entry Missed)";
    actionable = false;
    const highestSMA = Math.max(sma10_1h, sma20_1h, sma50_1h);
    const distPct = +(((close - highestSMA) / highestSMA) * 100).toFixed(1);
    subtext = `Price is floating +${distPct}% above nearest SMA ($${highestSMA.toFixed(2)}). Entry missed, wait for retest.`;
  }

  return {
    ticker: cleanTicker,
    status,
    actionable,
    price: +(close).toFixed(2),
    regime4H: "Bullish",
    is4hBullish: true,
    testedLine,
    testedPrice,
    entryPrice: actionable ? +(close).toFixed(2) : null,
    stopLoss,
    takeProfit2R,
    riskPerShare,
    sma10_1h,
    sma20_1h,
    sma50_1h,
    atr14_1h,
    subtext,
    updatedAt: nowIso,
  };
}

// ── In-Memory Scanner Cache ──
const scanCache = new Map<string, MechanicalScanResult>();

export function getMechanicalScanResults(symbols: string[] = MECHANICAL_WATCHLIST): MechanicalScanResult[] {
  return symbols.map((sym) => {
    const clean = sym.trim().toUpperCase();
    return (
      scanCache.get(clean) ?? {
        ticker: clean,
        status: "WAIT FOR RETEST (Entry Missed)",
        actionable: false,
        price: 0,
        regime4H: "Bullish",
        is4hBullish: true,
        testedLine: null,
        testedPrice: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit2R: null,
        riskPerShare: null,
        sma10_1h: 0,
        sma20_1h: 0,
        sma50_1h: 0,
        atr14_1h: 0,
        subtext: "Awaiting initial scan.",
        updatedAt: new Date().toISOString(),
      }
    );
  });
}

export function syncExternalScanResults(setups: any[]): number {
  if (!Array.isArray(setups)) return 0;
  let count = 0;
  const nowIso = new Date().toISOString();
  for (const s of setups) {
    if (!s || !s.ticker) continue;
    const cleanTicker = String(s.ticker).trim().toUpperCase();
    scanCache.set(cleanTicker, {
      ticker: cleanTicker,
      status: s.status ?? "WAIT FOR RETEST (Entry Missed)",
      actionable: Boolean(s.actionable),
      price: Number(s.price ?? 0),
      regime4H: s.regime4H ?? s["4h_regime"]?.includes("Bullish") ? "Bullish" : "Bearish",
      is4hBullish: s.is4hBullish ?? (s.regime4H === "Bullish" || s["4h_regime"]?.includes("Bullish")),
      testedLine: s.testedLine ?? s.tested_line ?? null,
      testedPrice: s.testedPrice != null ? Number(s.testedPrice) : null,
      entryPrice: s.entryPrice != null ? Number(s.entryPrice) : s.entry_price != null ? Number(s.entry_price) : null,
      stopLoss: s.stopLoss != null ? Number(s.stopLoss) : s.stop_loss != null ? Number(s.stop_loss) : null,
      takeProfit2R: s.takeProfit2R != null ? Number(s.takeProfit2R) : s.take_profit_2r != null ? Number(s.take_profit_2r) : null,
      riskPerShare: s.riskPerShare != null ? Number(s.riskPerShare) : s.risk_per_share != null ? Number(s.risk_per_share) : null,
      sma10_1h: Number(s.sma10_1h ?? s["1h_sma10"] ?? 0),
      sma20_1h: Number(s.sma20_1h ?? s["1h_sma20"] ?? 0),
      sma50_1h: Number(s.sma50_1h ?? s["1h_sma50"] ?? 0),
      atr14_1h: Number(s.atr14_1h ?? 0),
      subtext: s.subtext ?? "",
      updatedAt: nowIso,
    });
    count++;
  }
  return count;
}
