// ============================================================================
//  Shared market data module — Yahoo daily candle fetcher with per-symbol
//  in-memory cache, refreshed once per ET trading day. Both the regime engine
//  and the setup detector consume from here so we never duplicate Yahoo calls.
// ============================================================================

export interface DailyBar {
  date: string;     // YYYY-MM-DD ET
  ts: number;       // unix sec
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YahooResponse {
  chart: {
    result?: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
      meta?: { regularMarketPrice?: number };
    }>;
    error?: any;
  };
}

const YH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chizzle/1.0",
  "Accept": "application/json",
};

const histCache = new Map<string, { bars: DailyBar[]; fetchedAt: number; cacheDate: string }>();

export function todayET(): string {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.toISOString().slice(0, 10);
}

export async function fetchYahooHistory(symbol: string, range: string = "1y"): Promise<DailyBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: YH_HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const j = (await res.json()) as YahooResponse;
  const r = j.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${symbol} empty result`);
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0];
  if (!q) throw new Error(`Yahoo ${symbol} no quote indicators`);
  const bars: DailyBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    const d = new Date(ts[i] * 1000);
    bars.push({
      date: d.toISOString().slice(0, 10),
      ts: ts[i],
      open: o, high: h, low: l, close: c,
      volume: Number(v ?? 0),
    });
  }
  return bars;
}

export async function getHistory(symbol: string, forceRefresh = false): Promise<DailyBar[]> {
  const sym = symbol.toUpperCase();
  const cached = histCache.get(sym);
  const today = todayET();
  if (!forceRefresh && cached && cached.cacheDate === today && cached.bars.length) {
    return cached.bars;
  }
  try {
    const bars = await fetchYahooHistory(sym);
    histCache.set(sym, { bars, fetchedAt: Date.now(), cacheDate: today });
    return bars;
  } catch (e: any) {
    console.warn(`[marketData] Yahoo ${sym} failed: ${e?.message || e}`);
    if (cached) return cached.bars;
    throw e;
  }
}

export async function safeHistory(symbol: string, forceRefresh = false): Promise<DailyBar[]> {
  try { return await getHistory(symbol, forceRefresh); }
  catch (e) { return []; }
}

// ─── Math helpers ──────────────────────────────────────────────────────────
export function sma(values: number[], n: number, atIndex: number): number {
  if (atIndex < n - 1) return 0;
  let s = 0;
  for (let i = atIndex - n + 1; i <= atIndex; i++) s += values[i];
  return s / n;
}

// Exponential moving average — seeded with a simple average of the first n.
export function ema(values: number[], n: number, atIndex: number): number {
  if (atIndex < n - 1) return 0;
  const k = 2 / (n + 1);
  let prev = sma(values, n, n - 1);
  for (let i = n; i <= atIndex; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

// Wilder's ATR with period n at atIndex. Uses true range.
export function atr(bars: DailyBar[], n: number, atIndex: number): number {
  if (atIndex < n) return 0;
  const trs: number[] = [];
  for (let i = 1; i <= atIndex; i++) {
    const hi = bars[i].high, lo = bars[i].low, prevClose = bars[i - 1].close;
    const tr = Math.max(hi - lo, Math.abs(hi - prevClose), Math.abs(lo - prevClose));
    trs.push(tr);
  }
  // Seed with simple average of first n TRs, then Wilder smooth.
  if (trs.length < n) return 0;
  let atrVal = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < trs.length; i++) {
    atrVal = (atrVal * (n - 1) + trs[i]) / n;
  }
  return atrVal;
}

export interface SymbolMetrics {
  price: number;
  sma20: number;
  sma50: number;
  sma200: number;
  sma20_rising: boolean;
  sma50_rising: boolean;
  above_20: boolean;
  above_50: boolean;
  above_200: boolean;
}

export function computeSymbolMetrics(bars: DailyBar[]): SymbolMetrics {
  const closes = bars.map(b => b.close);
  const n = closes.length;
  if (n === 0) {
    return { price: 0, sma20: 0, sma50: 0, sma200: 0, sma20_rising: false, sma50_rising: false, above_20: false, above_50: false, above_200: false };
  }
  const lastIdx = n - 1;
  const sma20Now = sma(closes, 20, lastIdx);
  const sma50Now = sma(closes, 50, lastIdx);
  const sma200Now = sma(closes, 200, lastIdx);
  const sma20Then = sma(closes, 20, Math.max(0, lastIdx - 5));
  const sma50Then = sma(closes, 50, Math.max(0, lastIdx - 5));
  const price = closes[lastIdx];
  return {
    price,
    sma20: sma20Now,
    sma50: sma50Now,
    sma200: sma200Now,
    sma20_rising: sma20Now > sma20Then,
    sma50_rising: sma50Now > sma50Then,
    above_20: price > sma20Now,
    above_50: price > sma50Now,
    above_200: price > sma200Now,
  };
}

// Count of consecutive most-recent sessions where close > sma50 (with sma50 also rising).
export function consecutiveAboveRising50SMA(bars: DailyBar[]): number {
  const closes = bars.map(b => b.close);
  const n = closes.length;
  if (n < 51) return 0;
  let count = 0;
  for (let i = n - 1; i >= 50; i--) {
    const cur = sma(closes, 50, i);
    const prev = sma(closes, 50, i - 1);
    if (closes[i] > cur && cur >= prev) count++;
    else break;
  }
  return count;
}
