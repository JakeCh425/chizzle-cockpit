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

// Fallback provider: Tiingo daily EOD. Fires when Yahoo returns empty or errors
// (rate limits, unlisted symbols, etc.). Requires TIINGO_API_KEY env var.
export async function fetchTiingoHistory(symbol: string): Promise<DailyBar[]> {
  const key = process.env.TIINGO_API_KEY;
  if (!key) throw new Error("TIINGO_API_KEY missing");
  // ~14 months of daily bars — enough for 200-SMA + buffer
  const start = new Date(Date.now() - 430 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${start}&token=${key}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Tiingo ${symbol} HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{
    date: string; open: number; high: number; low: number; close: number; volume: number;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Tiingo ${symbol} empty`);
  return rows.map((r) => ({
    date: r.date.slice(0, 10),
    ts: Math.floor(new Date(r.date).getTime() / 1000),
    open: r.open, high: r.high, low: r.low, close: r.close,
    volume: Number(r.volume ?? 0),
  }));
}

// Third-fallback: TwelveData daily. Free tier is ~800 credits/day (each 1D bar
// call is 1 credit). Only fires when both Yahoo and Tiingo are exhausted so we
// don't burn credits on the happy path.
export async function fetchTwelveDataHistory(symbol: string): Promise<DailyBar[]> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY missing");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=300&apikey=${key}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`TwelveData ${symbol} HTTP ${res.status}`);
  const j = (await res.json()) as {
    status?: string; code?: number; message?: string;
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume: string }>;
  };
  if (j.status === "error" || !Array.isArray(j.values) || j.values.length === 0) {
    throw new Error(`TwelveData ${symbol}: ${j.message || "empty"}`);
  }
  // TwelveData returns newest-first — reverse to oldest-first for consistency.
  return j.values.slice().reverse().map((r) => ({
    date: r.datetime.slice(0, 10),
    ts: Math.floor(new Date(r.datetime).getTime() / 1000),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume ?? 0),
  })).filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
}

// Fourth-fallback: Alpha Vantage TIME_SERIES_DAILY. Free tier is 25/day
// (or 500/day with a signed-up key). Only fires when the other three
// providers are all exhausted, so the daily quota stretches across many days.
export async function fetchAlphaVantageHistory(symbol: string): Promise<DailyBar[]> {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error("ALPHA_VANTAGE_API_KEY missing");
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=full&apikey=${key}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`AlphaVantage ${symbol} HTTP ${res.status}`);
  const j = (await res.json()) as {
    "Meta Data"?: Record<string, string>;
    "Time Series (Daily)"?: Record<string, { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }>;
    Note?: string; Information?: string; "Error Message"?: string;
  };
  // AV surfaces rate limits + errors as free-form text fields; treat any of
  // them as a hard failure so we drop through to stale cache instead of
  // pretending we got data.
  if (j.Note || j.Information || j["Error Message"] || !j["Time Series (Daily)"]) {
    throw new Error(`AlphaVantage ${symbol}: ${j.Note || j.Information || j["Error Message"] || "empty"}`);
  }
  const series = j["Time Series (Daily)"];
  // AV returns newest-first by date-string key order; sort ascending for consistency.
  const dates = Object.keys(series).sort();
  return dates.map((d) => {
    const r = series[d];
    return {
      date: d,
      ts: Math.floor(new Date(d).getTime() / 1000),
      open: Number(r["1. open"]),
      high: Number(r["2. high"]),
      low: Number(r["3. low"]),
      close: Number(r["4. close"]),
      volume: Number(r["5. volume"] ?? 0),
    };
  }).filter((b) => Number.isFinite(b.open) && Number.isFinite(b.close));
}

export async function getHistory(symbol: string, forceRefresh = false): Promise<DailyBar[]> {
  const sym = symbol.toUpperCase();
  const cached = histCache.get(sym);
  const today = todayET();
  if (!forceRefresh && cached && cached.cacheDate === today && cached.bars.length) {
    return cached.bars;
  }
  // Provider chain: Yahoo → Tiingo → TwelveData. Cache whichever succeeds.
  let bars: DailyBar[] = [];
  let firstErr: any = null;
  try {
    bars = await fetchYahooHistory(sym);
  } catch (e: any) {
    firstErr = e;
    console.warn(`[marketData] Yahoo ${sym} failed: ${e?.message || e}`);
  }
  if (!bars.length) {
    try {
      bars = await fetchTiingoHistory(sym);
      console.info(`[marketData] Tiingo fallback OK for ${sym} (${bars.length} bars)`);
    } catch (e: any) {
      console.warn(`[marketData] Tiingo ${sym} failed: ${e?.message || e}`);
    }
  }
  if (!bars.length) {
    try {
      bars = await fetchTwelveDataHistory(sym);
      console.info(`[marketData] TwelveData fallback OK for ${sym} (${bars.length} bars)`);
    } catch (e: any) {
      console.warn(`[marketData] TwelveData ${sym} failed: ${e?.message || e}`);
    }
  }
  if (!bars.length) {
    try {
      bars = await fetchAlphaVantageHistory(sym);
      console.info(`[marketData] AlphaVantage fallback OK for ${sym} (${bars.length} bars)`);
    } catch (e: any) {
      console.warn(`[marketData] AlphaVantage ${sym} failed: ${e?.message || e}`);
      // All four providers exhausted. Serve any cached bars we still have
      // (even stale ones from a prior ET day) rather than blanking the chart.
      if (cached && cached.bars.length) {
        console.info(`[marketData] Serving STALE cache for ${sym} (${cached.bars.length} bars from ${cached.cacheDate})`);
        return cached.bars;
      }
      throw firstErr || e;
    }
  }
  histCache.set(sym, { bars, fetchedAt: Date.now(), cacheDate: today });
  return bars;
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
