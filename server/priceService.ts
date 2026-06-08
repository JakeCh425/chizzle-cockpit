// ============================================================================
//  Price Service — polls Finnhub REST quote endpoint for the 6 watchlist
//  tickers on a cadence that respects US market hours. Holds an in-memory
//  cache, persists tick history to SQLite, and broadcasts updates via SSE.
//
//  Finnhub credential is injected by the credential proxy as the
//  `X-Finnhub-Token` header on outbound HTTPS calls to finnhub.io. The
//  server process must be started with api_credentials=['custom-cred:finnhub.io']
//  for this to work.
// ============================================================================
import type { Response } from "express";
import { storage } from "./storage";
import { ProxyAgent, fetch as undiciFetch } from "undici";

// Node's global fetch does not honour HTTPS_PROXY. Route Finnhub calls through
// the credential-injecting proxy that the sandbox sets via HTTPS_PROXY, using
// undici's ProxyAgent. The header X-Finnhub-Token is added by the proxy.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyDispatcher = PROXY_URL ? new ProxyAgent({ uri: PROXY_URL }) : null;
// Direct Finnhub token (used in production on Render where no credential proxy exists).
// Set FINNHUB_API_KEY (or FINNHUB_TOKEN) in the deploy environment.
const FINNHUB_TOKEN = process.env.FINNHUB_API_KEY || process.env.FINNHUB_TOKEN || "";
const TIINGO_TOKEN = process.env.TIINGO_API_KEY || process.env.TIINGO_TOKEN || "";

async function proxiedFetch(url: string, init: any = {}) {
  // Prefer the credential proxy (sandbox dev). On Render the proxy is absent
  // and we send X-Finnhub-Token directly using the env var.
  if (proxyDispatcher) {
    return undiciFetch(url, { ...init, dispatcher: proxyDispatcher });
  }
  if (FINNHUB_TOKEN) {
    const headers = { ...(init.headers || {}), "X-Finnhub-Token": FINNHUB_TOKEN } as Record<string, string>;
    return fetch(url, { ...init, headers });
  }
  return fetch(url, init);
}

export type FeedSource = "FINNHUB" | "TIINGO_IEX" | "YAHOO" | "NASDAQ" | "SIMULATOR" | "OVERRIDE";

export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  ts: number;          // unix seconds from Finnhub, or our Date.now()/1000 fallback
  receivedAt: number;  // local Date.now() ms when we received the update
  source: FeedSource;
}

// Public watchlist symbols (shown to user)
const WATCHLIST_SYMS = ["SMH", "QQQ", "SPY", "IWM", "AAPL", "META"];
// Internal regime inputs (NOT shown in watchlist UI)
const INTERNAL_SYMS = ["VIXY"];
const SYMBOLS = [...WATCHLIST_SYMS, ...INTERNAL_SYMS];

// Cadence (seconds) — staggered across the cycle to stay under provider quotas.
// Finnhub free is 60 req/min so 5s with 7 staggered symbols = ~84 req/min (over).
// Tiingo IEX free is ~50 req/hour total which translates to ~72s between batch
// calls. We use 30s as a balance: 120 req/hour for IEX, comfortably under any
// reasonable free-tier ceiling, and updates feel real-time on a swing-trading
// scale (1H/1D charts).
function activeCadenceSec(now = new Date()): number {
  // Translate to America/New_York to classify the session.
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return 300; // weekend
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 90;  // regular session — 40 req/hr, under Tiingo 50/hr free cap
  if ((minutes >= 4 * 60 && minutes < 9 * 60 + 30) || (minutes >= 16 * 60 && minutes < 20 * 60)) return 180; // pre/post
  return 300; // overnight
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state
const quotes = new Map<string, Quote>();
const lastPollOk = new Map<string, number>();    // ms
const errorsLastHour: number[] = [];             // timestamps (ms)
const sseClients = new Set<Response>();
let pollerStarted = false;
let pollerStoppedFlag = false;
let lastFetchAt = 0;

const USE_SIMULATOR = (process.env.USE_SIMULATOR || "").toLowerCase() === "true";

// Anchor prices fall back for sim mode
const SIM_ANCHORS: Record<string, number> = {
  SMH: 577, QQQ: 485, SPY: 748, IWM: 225, AAPL: 298, META: 640, VIXY: 26.8,
};

function pushError() {
  const now = Date.now();
  errorsLastHour.push(now);
  // Trim entries older than 1 hour
  const cutoff = now - 60 * 60 * 1000;
  while (errorsLastHour.length && errorsLastHour[0] < cutoff) errorsLastHour.shift();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch a single Finnhub quote. The credential proxy injects X-Finnhub-Token
// automatically when the process was launched with the right api_credentials.
// Per-host failure cache so we don't pound a known-dead provider every cycle.
// When a provider has failed N times in a row, skip it for the next cooldown
// window and let the fallback do the work.
const providerFailures = new Map<string, { count: number; until: number }>();
function markFail(provider: string) {
  const cur = providerFailures.get(provider) || { count: 0, until: 0 };
  cur.count++;
  // After 5 consecutive failures, cool down for 60s.
  if (cur.count >= 5) cur.until = Date.now() + 60_000;
  providerFailures.set(provider, cur);
}
function markOk(provider: string) {
  providerFailures.delete(provider);
}
function isCooling(provider: string): boolean {
  const cur = providerFailures.get(provider);
  return !!cur && cur.until > Date.now();
}

// Tiingo IEX live quote — free tier, real-time-ish (~delayed by exchange).
// Batch-capable: one call returns N symbols. Used as primary live source
// when configured, with Finnhub as fallback. Falls back to simulator if both fail.
async function fetchTiingoQuotesBatch(symbols: string[]): Promise<Quote[]> {
  if (!TIINGO_TOKEN || symbols.length === 0) return [];
  const url = `https://api.tiingo.com/iex/?tickers=${symbols.map(encodeURIComponent).join(",")}&token=${TIINGO_TOKEN}`;
  try {
    const r = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "chizzle-cockpit/1.0" },
    });
    if (!r.ok) {
      if (r.status === 429) {
        // Rate-limited — force a long cooldown so we stop pounding the endpoint.
        const cur = providerFailures.get("tiingo-iex") || { count: 0, until: 0 };
        cur.count = 999;
        cur.until = Date.now() + 10 * 60_000;
        providerFailures.set("tiingo-iex", cur);
        console.warn(`[priceService:tiingo] batch 429 — cooling down 10min`);
      } else {
        markFail("tiingo-iex");
        console.warn(`[priceService:tiingo] batch HTTP ${r.status}`);
      }
      return [];
    }
    const arr = (await r.json()) as Array<any>;
    if (!Array.isArray(arr) || arr.length === 0) {
      markFail("tiingo-iex");
      return [];
    }
    markOk("tiingo-iex");
    const out: Quote[] = [];
    for (const row of arr) {
      const sym = String(row?.ticker || "").toUpperCase();
      const last = Number(row?.tngoLast ?? row?.last ?? row?.mid ?? 0);
      const prev = Number(row?.prevClose ?? 0);
      if (!sym || !Number.isFinite(last) || last <= 0) continue;
      const change = prev > 0 ? last - prev : 0;
      const changePct = prev > 0 ? (change / prev) * 100 : 0;
      out.push({
        symbol: sym,
        price: last,
        prevClose: prev,
        change,
        changePct,
        high: Number(row?.high ?? last),
        low: Number(row?.low ?? last),
        open: Number(row?.open ?? last),
        ts: row?.timestamp ? Math.floor(new Date(row.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
        receivedAt: Date.now(),
        source: "TIINGO_IEX",
      });
    }
    return out;
  } catch (e: any) {
    markFail("tiingo-iex");
    console.warn(`[priceService:tiingo] batch error: ${e?.message || e}`);
    return [];
  }
}

async function fetchFinnhubQuote(symbol: string): Promise<Quote | null> {
  if (isCooling("finnhub")) return null;
  if (!proxyDispatcher && !FINNHUB_TOKEN) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
  try {
    const res = await proxiedFetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      pushError();
      markFail("finnhub");
      console.warn(`[priceService:finnhub] ${symbol} HTTP ${res.status}`);
      return null;
    }
    const j: any = await res.json();
    if (j?.error) {
      pushError();
      markFail("finnhub");
      console.warn(`[priceService:finnhub] ${symbol} error: ${j.error}`);
      return null;
    }
    if (j?.c == null || j.c === 0) {
      pushError();
      markFail("finnhub");
      return null;
    }
    markOk("finnhub");
    return {
      symbol,
      price: Number(j.c),
      prevClose: Number(j.pc ?? 0),
      change: Number(j.d ?? 0),
      changePct: Number(j.dp ?? 0),
      high: Number(j.h ?? 0),
      low: Number(j.l ?? 0),
      open: Number(j.o ?? 0),
      ts: Number(j.t ?? Math.floor(Date.now() / 1000)),
      receivedAt: Date.now(),
      source: "FINNHUB",
    };
  } catch (e: any) {
    pushError();
    markFail("finnhub");
    console.warn(`[priceService:finnhub] ${symbol} fetch error: ${e?.message || e}`);
    return null;
  }
}

// Yahoo Finance v8 chart endpoint — no auth, no quota meaningfully enforced
// on this path. We hit it once per symbol in parallel (cheap) and pull
// `meta.regularMarketPrice` + `meta.chartPreviousClose` to construct a Quote.
// The v7 /finance/quote endpoint requires a session cookie/crumb and 429s
// without it; v8 chart works from datacenter IPs as long as we send a
// browser-like User-Agent.
export async function fetchYahooQuote(symbol: string): Promise<Quote | null> {
  if (isCooling("yahoo")) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  try {
    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      if (r.status === 429) {
        const cur = providerFailures.get("yahoo") || { count: 0, until: 0 };
        cur.count = 999;
        cur.until = Date.now() + 5 * 60_000;
        providerFailures.set("yahoo", cur);
        console.warn(`[priceService:yahoo] ${symbol} 429 — cooling 5min`);
      } else {
        markFail("yahoo");
      }
      return null;
    }
    const j: any = await r.json();
    const result = j?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) {
      markFail("yahoo");
      return null;
    }
    const last = Number(meta.regularMarketPrice ?? 0);
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
    if (!Number.isFinite(last) || last <= 0) {
      markFail("yahoo");
      return null;
    }
    markOk("yahoo");
    const change = prev ? last - prev : 0;
    const changePct = prev ? ((last - prev) / prev) * 100 : 0;
    return {
      symbol,
      price: last,
      prevClose: prev,
      change,
      changePct,
      high: Number(meta.regularMarketDayHigh ?? 0),
      low: Number(meta.regularMarketDayLow ?? 0),
      open: Number(meta.regularMarketOpen ?? 0),
      ts: Number(meta.regularMarketTime ?? Math.floor(Date.now() / 1000)),
      receivedAt: Date.now(),
      source: "YAHOO",
    };
  } catch (e: any) {
    pushError();
    markFail("yahoo");
    console.warn(`[priceService:yahoo] ${symbol} fetch error: ${e?.message || e}`);
    return null;
  }
}

// Parallel batch wrapper — fan out v8 chart calls and gather results.
async function fetchYahooQuotesBatch(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  if (isCooling("yahoo")) return [];
  const results = await Promise.all(symbols.map(s => fetchYahooQuote(s)));
  return results.filter((q): q is Quote => q != null);
}

// ETF vs stock classification — used by the Nasdaq API which requires the
// asset class as a query parameter. Anything not in the ETF set is treated
// as `stocks`. Update this when adding new watchlist symbols.
const ETF_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "SMH", "VIXY", "DIA", "XLF", "XLK", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "GLD", "SLV", "TLT", "HYG", "LQD", "USO", "UNG"]);
function nasdaqAssetClass(symbol: string): "etf" | "stocks" | "index" {
  if (ETF_SYMBOLS.has(symbol)) return "etf";
  if (symbol.startsWith("^") || symbol === "NDX" || symbol === "SPX" || symbol === "DJI" || symbol === "VIX") return "index";
  return "stocks";
}

// Nasdaq.com /api/quote — free, no auth, real-time intraday prices, and
// crucially: not rate-limited from datacenter IPs the way Yahoo and Tiingo's
// free tier are. Used as the primary live source when both Tiingo IEX and
// Yahoo are unavailable, which is the steady state during long sessions.
export async function fetchNasdaqQuote(symbol: string): Promise<Quote | null> {
  if (isCooling("nasdaq")) return null;
  const assetClass = nasdaqAssetClass(symbol);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`;
  try {
    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      if (r.status === 429) {
        const cur = providerFailures.get("nasdaq") || { count: 0, until: 0 };
        cur.count = 999;
        cur.until = Date.now() + 5 * 60_000;
        providerFailures.set("nasdaq", cur);
        console.warn(`[priceService:nasdaq] ${symbol} 429 — cooling 5min`);
      } else {
        markFail("nasdaq");
        console.warn(`[priceService:nasdaq] ${symbol} HTTP ${r.status}`);
      }
      return null;
    }
    const j: any = await r.json();
    const pd = j?.data?.primaryData;
    if (!pd?.lastSalePrice) {
      markFail("nasdaq");
      return null;
    }
    // Nasdaq returns values like "$744.95" and "+7.40" / "+1.00%".
    const last = parseFloat(String(pd.lastSalePrice).replace(/[$,]/g, ""));
    const change = parseFloat(String(pd.netChange ?? "0").replace(/[+,]/g, ""));
    const changePct = parseFloat(String(pd.percentageChange ?? "0").replace(/[+%,]/g, ""));
    if (!Number.isFinite(last) || last <= 0) {
      markFail("nasdaq");
      return null;
    }
    const prev = Number.isFinite(change) ? last - change : 0;
    markOk("nasdaq");
    return {
      symbol,
      price: last,
      prevClose: prev,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      high: 0, low: 0, open: 0,
      ts: Math.floor(Date.now() / 1000),
      receivedAt: Date.now(),
      source: "NASDAQ",
    };
  } catch (e: any) {
    pushError();
    markFail("nasdaq");
    console.warn(`[priceService:nasdaq] ${symbol} fetch error: ${e?.message || e}`);
    return null;
  }
}

async function fetchNasdaqQuotesBatch(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) return [];
  if (isCooling("nasdaq")) return [];
  const results = await Promise.all(symbols.map(s => fetchNasdaqQuote(s)));
  return results.filter((q): q is Quote => q != null);
}

async function fetchQuote(symbol: string): Promise<Quote | null> {
  if (USE_SIMULATOR) return simulatorQuote(symbol);
  // 1. Tiingo IEX (preferred — single batch call covers many symbols,
  //    works reliably from datacenter IPs). For single-symbol calls we still hit it.
  if (TIINGO_TOKEN && !isCooling("tiingo-iex")) {
    const arr = await fetchTiingoQuotesBatch([symbol]);
    if (arr.length > 0) return arr[0];
  }
  // 2. Nasdaq fallback (zero-quota, no auth, works from Render IPs)
  if (!isCooling("nasdaq")) {
    const nq = await fetchNasdaqQuote(symbol);
    if (nq) return nq;
  }
  // 3. Yahoo fallback (zero-quota but heavily rate-limited from datacenter IPs)
  if (!isCooling("yahoo")) {
    const yhArr = await fetchYahooQuotesBatch([symbol]);
    if (yhArr.length > 0) return yhArr[0];
  }
  // 4. Finnhub fallback
  const fh = await fetchFinnhubQuote(symbol);
  if (fh) return fh;
  // 4. Auto-fallback: if no quote provider is healthy and no token configured,
  //    fall back to simulator so the UI still shows motion.
  if (!proxyDispatcher && !FINNHUB_TOKEN && !TIINGO_TOKEN) {
    console.warn(`[priceService] No quote provider configured — using simulator for ${symbol}`);
    return simulatorQuote(symbol);
  }
  return null;
}

function simulatorQuote(symbol: string): Quote {
  const anchor = SIM_ANCHORS[symbol] ?? 100;
  const last = quotes.get(symbol)?.price ?? anchor;
  const step = (Math.random() - 0.5) * last * 0.003;
  const pull = (anchor - last) * 0.05;
  const price = +(last + step + pull).toFixed(2);
  return {
    symbol,
    price,
    prevClose: anchor * 0.998,
    change: price - anchor,
    changePct: ((price - anchor) / anchor) * 100,
    high: Math.max(price, last),
    low: Math.min(price, last),
    open: anchor,
    ts: Math.floor(Date.now() / 1000),
    receivedAt: Date.now(),
    source: "SIMULATOR",
  };
}

// Persist tick + update DB ticker.currentPrice + broadcast over SSE
function commitQuote(q: Quote) {
  quotes.set(q.symbol, q);
  lastPollOk.set(q.symbol, q.receivedAt);
  lastFetchAt = q.receivedAt;
  // Persist tick history (best-effort, fire-and-forget async)
  storage.appendPriceTick({ symbol: q.symbol, price: q.price, ts: Math.floor(q.receivedAt / 1000) }).catch(() => {});
  // Update tickers table currentPrice so other pages without SSE still see fresh values.
  // VIXY is an internal regime input and is NOT in the tickers table.
  if (WATCHLIST_SYMS.includes(q.symbol)) {
    storage.getTickerBySymbol(q.symbol).then(t => {
      if (t) return storage.updateTicker(t.id, { currentPrice: q.price });
    }).catch(() => {});
    broadcast({ type: "tick", quote: q });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE plumbing
function broadcast(payload: any) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (e) { /* drop on error */ }
  }
}

export function addSseClient(res: Response) {
  sseClients.add(res);
  // Send initial snapshot — public watchlist symbols only.
  try {
    const visible = Array.from(quotes.values()).filter(q => WATCHLIST_SYMS.includes(q.symbol));
    res.write(`event: hello\n`);
    res.write(`data: ${JSON.stringify({ quotes: visible })}\n\n`);
  } catch (e) { /* ignore */ }
}

export function removeSseClient(res: Response) {
  sseClients.delete(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling loop. When Tiingo IEX is configured, do ONE batch call per cycle
// for all symbols (highly efficient). Otherwise fall back to staggered
// per-symbol Finnhub calls.
let symbolIdx = 0;
async function pollOnce() {
  if (pollerStoppedFlag) return;
  const cadenceSec = activeCadenceSec();

  if (TIINGO_TOKEN && !isCooling("tiingo-iex")) {
    // Batch: one HTTP request for all SYMBOLS.
    const arr = await fetchTiingoQuotesBatch(SYMBOLS);
    if (arr.length > 0) {
      for (const q of arr) commitQuote(q);
      setTimeout(pollOnce, Math.max(1000, cadenceSec * 1000));
      return;
    }
    // Tiingo returned nothing — fall through to Yahoo this cycle.
  }

  // Nasdaq batch (primary fallback when Tiingo cooling — zero quota, works
  // reliably from datacenter IPs unlike Yahoo).
  if (!isCooling("nasdaq")) {
    const ndArr = await fetchNasdaqQuotesBatch(SYMBOLS);
    if (ndArr.length > 0) {
      for (const q of ndArr) commitQuote(q);
      setTimeout(pollOnce, Math.max(1000, cadenceSec * 1000));
      return;
    }
  }

  // Yahoo batch (zero-quota, no auth) — last fallback, often rate-limited.
  if (!isCooling("yahoo")) {
    const yhArr = await fetchYahooQuotesBatch(SYMBOLS);
    if (yhArr.length > 0) {
      for (const q of yhArr) commitQuote(q);
      setTimeout(pollOnce, Math.max(1000, cadenceSec * 1000));
      return;
    }
  }

  // Staggered single-symbol fallback (Finnhub).
  const symbol = SYMBOLS[symbolIdx % SYMBOLS.length];
  symbolIdx++;
  const q = await fetchQuote(symbol);
  if (q) commitQuote(q);
  const intervalMs = Math.floor((cadenceSec * 1000) / SYMBOLS.length);
  setTimeout(pollOnce, Math.max(250, intervalMs));
}

// Force-refresh every symbol once (for the manual refresh endpoint).
export async function refreshAllSymbolsOnce(): Promise<number> {
  let ok = 0;
  for (const sym of SYMBOLS) {
    const q = await fetchQuote(sym);
    if (q) { commitQuote(q); ok++; }
  }
  return ok;
}

// Immediate batch warmup — fills the quotes map in ONE Tiingo IEX call before
// the staggered loop starts, so the first SSE client receives a populated
// `hello` event and the cockpit goes LIVE within ~500ms of boot.
async function warmupAllQuotes() {
  if (USE_SIMULATOR) {
    for (const s of SYMBOLS) commitQuote(simulatorQuote(s));
    return;
  }
  if (TIINGO_TOKEN) {
    const arr = await fetchTiingoQuotesBatch(SYMBOLS);
    let n = 0;
    for (const q of arr) { commitQuote(q); n++; }
    if (n > 0) {
      console.log(`[priceService] warmup: Tiingo IEX populated ${n}/${SYMBOLS.length} symbols`);
      return;
    }
  }
  // Nasdaq batch fallback — zero-quota, no auth, works from Render IPs.
  const nd = await fetchNasdaqQuotesBatch(SYMBOLS);
  if (nd.length > 0) {
    for (const q of nd) commitQuote(q);
    console.log(`[priceService] warmup: Nasdaq populated ${nd.length}/${SYMBOLS.length} symbols`);
    return;
  }
  // Yahoo batch fallback (zero-quota but heavily rate-limited from datacenter IPs).
  const yh = await fetchYahooQuotesBatch(SYMBOLS);
  if (yh.length > 0) {
    for (const q of yh) commitQuote(q);
    console.log(`[priceService] warmup: Yahoo populated ${yh.length}/${SYMBOLS.length} symbols`);
    return;
  }
  // Fall back to per-symbol Finnhub if everything else unavailable.
  for (const s of SYMBOLS) {
    const q = await fetchFinnhubQuote(s);
    if (q) commitQuote(q);
  }
}

export function startPricePoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  pollerStoppedFlag = false;
  console.log(`[priceService] poller starting; simulator=${USE_SIMULATOR}`);
  // Immediate batch warmup, then start staggered loop.
  warmupAllQuotes()
    .catch(e => console.warn("[priceService] warmup error", e))
    .finally(() => {
      pollOnce().catch(e => console.warn("[priceService] poll error", e));
    });
}

export function stopPricePoller() {
  pollerStoppedFlag = true;
  pollerStarted = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public read API
export function snapshot(): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const [s, q] of quotes.entries()) out[s] = q;
  return out;
}

export function getQuote(symbol: string): Quote | undefined {
  return quotes.get(symbol);
}

export interface FeedStatus {
  provider: "Finnhub" | "Tiingo IEX" | "Yahoo" | "Nasdaq" | "Simulator";
  tier: "Free";
  cadenceSec: number;
  session: string;
  useSimulator: boolean;
  lastTickAt: number | null;
  ageSec: number | null;
  symbols: Array<{ symbol: string; lastOk: number | null; ageSec: number | null; price: number | null }>;
  errorsLastHour: number;
}

export function feedStatus(): FeedStatus {
  const now = Date.now();
  const cadence = activeCadenceSec();
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const m = et.getHours() * 60 + et.getMinutes();
  let session = "OFF";
  if (day !== 0 && day !== 6) {
    if (m >= 9 * 60 + 30 && m < 16 * 60) session = "OPEN";
    else if (m >= 4 * 60 && m < 9 * 60 + 30) session = "PRE";
    else if (m >= 16 * 60 && m < 20 * 60) session = "POST";
  }
  return {
    provider: (() => {
      if (USE_SIMULATOR) return "Simulator" as const;
      // Reflect the source of the most recent successful tick so the UI shows
      // the actual active provider (e.g. Yahoo when Tiingo is quota-exhausted).
      let newest: Quote | undefined;
      for (const q of quotes.values()) {
        if (!newest || q.receivedAt > newest.receivedAt) newest = q;
      }
      if (newest?.source === "NASDAQ") return "Nasdaq" as const;
      if (newest?.source === "YAHOO") return "Yahoo" as const;
      if (newest?.source === "FINNHUB") return "Finnhub" as const;
      if (newest?.source === "TIINGO_IEX") return "Tiingo IEX" as const;
      // No ticks yet — fall back to configured preference.
      return TIINGO_TOKEN ? ("Tiingo IEX" as const) : ("Finnhub" as const);
    })(),
    tier: "Free",
    cadenceSec: cadence,
    session,
    useSimulator: USE_SIMULATOR,
    lastTickAt: lastFetchAt || null,
    ageSec: lastFetchAt ? Math.round((now - lastFetchAt) / 1000) : null,
    symbols: SYMBOLS.map(s => {
      const t = lastPollOk.get(s) || null;
      const q = quotes.get(s);
      return {
        symbol: s,
        lastOk: t,
        ageSec: t ? Math.round((now - t) / 1000) : null,
        price: q ? q.price : null,
      };
    }),
    errorsLastHour: errorsLastHour.length,
  };
}

export const WATCHED_SYMBOLS = SYMBOLS;
export const PUBLIC_SYMBOLS = WATCHLIST_SYMS;

/**
 * Generic Finnhub candle fetch. Used as a fallback when Stooq is blocked
 * by its bot-challenge or returns no data on its free tier.
 *
 * Resolution mapping:
 *   "D"  -> daily   (~400 days)
 *   "60" -> hourly  (~30 days)
 *
 * Returns `null` when Finnhub is unconfigured or returns no data, so the
 * caller can pick the next fallback or surface a warning.
 */
export async function fetchFinnhubBars(
  symbol: string,
  resolution: "D" | "60"
): Promise<{ time: number; close: number; volume?: number }[] | null> {
  if (!FINNHUB_TOKEN && !proxyDispatcher) return null;
  const to = Math.floor(Date.now() / 1000);
  // Daily: ~400 trading days = ~560 calendar days. Hourly: 30 days.
  const lookbackSec = resolution === "D" ? 560 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
  const from = to - lookbackSec;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`;
  try {
    const r = await proxiedFetch(url);
    if (!r.ok) {
      console.warn(`[finnhub-candle] ${symbol} ${resolution} HTTP ${r.status} ${r.statusText}`);
      return null;
    }
    const j = (await r.json()) as { s?: string; t?: number[]; c?: number[]; v?: number[] };
    if (j.s !== "ok" || !Array.isArray(j.t) || !Array.isArray(j.c) || j.t.length === 0) {
      console.warn(`[finnhub-candle] ${symbol} ${resolution} returned s=${j.s} tlen=${j.t?.length ?? 0}`);
      return null;
    }
    const out: { time: number; close: number; volume?: number }[] = [];
    for (let i = 0; i < j.t.length; i++) {
      const ts = j.t[i];
      const c = j.c[i];
      const v = Array.isArray(j.v) ? j.v[i] : undefined;
      if (Number.isFinite(ts) && Number.isFinite(c)) {
        out.push({ time: ts, close: c, volume: Number.isFinite(v as number) ? (v as number) : undefined });
      }
    }
    return out.slice(-400);
  } catch {
    return null;
  }
}

/** Backwards-compatible thin wrapper. */
export async function fetchFinnhubHourlyBars(symbol: string) {
  return fetchFinnhubBars(symbol, "60");
}

/**
 * Tiingo daily prices — free tier gives 1000 req/hr and works reliably from
 * datacenter IPs (Render). Requires TIINGO_API_KEY env var. Daily-only on
 * the free plan; IEX intraday is separate and not used here.
 *
 * Returns null when token missing or upstream returns empty/error so the
 * caller can fall back to Stooq / Yahoo / Finnhub.
 */
// Shared cooldown for the Tiingo daily endpoint — hit by both the candles
// route and sma20Alerts. When we get a 429, back off for 10 minutes (Tiingo
// rate-limit window) instead of pounding every cache-miss request.
let tiingoDailyCooldownUntil = 0;
export async function fetchTiingoDailyBars(
  symbol: string
): Promise<{ time: number; close: number; volume?: number }[] | null> {
  if (!TIINGO_TOKEN) return null;
  if (Date.now() < tiingoDailyCooldownUntil) return null; // skip while rate-limited
  // ~560 calendar days back == ~400 trading bars
  const endMs = Date.now();
  const startMs = endMs - 560 * 24 * 60 * 60 * 1000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${fmt(startMs)}&endDate=${fmt(endMs)}&format=json&token=${TIINGO_TOKEN}`;
  try {
    const r = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "chizzle-cockpit/1.0",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      if (r.status === 429) {
        // Cool down for 10min on rate-limit. Tiingo's window resets hourly.
        tiingoDailyCooldownUntil = Date.now() + 10 * 60_000;
        console.warn(`[tiingo] ${symbol} daily 429 — cooling down 10min`);
      } else {
        console.warn(`[tiingo] ${symbol} daily HTTP ${r.status} ${r.statusText}`);
      }
      return null;
    }
    const j = (await r.json()) as Array<{
      date?: string;
      close?: number;
      adjClose?: number;
      volume?: number;
    }>;
    if (!Array.isArray(j) || j.length === 0) {
      console.warn(`[tiingo] ${symbol} daily returned empty`);
      return null;
    }
    const out: { time: number; close: number; volume?: number }[] = [];
    for (const row of j) {
      const ts = row.date ? Math.floor(new Date(row.date).getTime() / 1000) : NaN;
      const c = Number.isFinite(row.adjClose as number) ? (row.adjClose as number) : (row.close as number);
      if (Number.isFinite(ts) && Number.isFinite(c)) {
        out.push({
          time: ts,
          close: c,
          volume: Number.isFinite(row.volume as number) ? (row.volume as number) : undefined,
        });
      }
    }
    return out.length > 0 ? out.slice(-400) : null;
  } catch (e) {
    console.warn(`[tiingo] ${symbol} daily error:`, (e as Error)?.message || e);
    return null;
  }
}

// Yahoo Finance simple throttling. Yahoo rate-limits aggressively on
// concurrent identical requests from a datacenter IP. Keep a tiny per-host
// queue with a ~1s min spacing. On 429 we extend the spacing temporarily
// rather than cooling down globally — that way we keep trying (slowly)
// instead of black-holing every request.
let yahooQueue: Promise<unknown> = Promise.resolve();
let yahoo429Until = 0;
function yahooScheduled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    // If we recently saw a 429, wait the remainder before the next call.
    const remaining = yahoo429Until - Date.now();
    if (remaining > 0) await new Promise(r => setTimeout(r, Math.min(remaining, 5000)));
    const out = await fn();
    // 1s gap between Yahoo calls in the normal case.
    await new Promise(r => setTimeout(r, 1000));
    return out;
  };
  const next = yahooQueue.then(run, run);
  yahooQueue = next.catch(() => undefined);
  return next;
}

/**
 * Yahoo Finance v8 chart endpoint — no key required, works from datacenter IPs,
 * supports daily and hourly resolution. Returns null on failure so caller can
 * fall back to the next provider.
 *
 *   interval: "1d" (daily, ~400 trading days)  | "1h" (hourly, ~30 days)
 */
export async function fetchYahooBars(
  symbol: string,
  interval: "1d" | "1h"
): Promise<{ time: number; close: number; volume?: number }[] | null> {
  const to = Math.floor(Date.now() / 1000);
  // Yahoo allows wide ranges; cap at ~560d for daily, ~30d for hourly (Yahoo
  // intraday history limit on the free chart endpoint).
  const lookbackSec = interval === "1d" ? 560 * 24 * 60 * 60 : 30 * 24 * 60 * 60;
  const from = to - lookbackSec;
  // Rotate Yahoo subdomains — query1/query2 have independent rate-limit pools.
  const host = (symbol.charCodeAt(0) % 2 === 0) ? "query1" : "query2";
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=${interval}`;
  return yahooScheduled(async () => {
  try {
    // Plain fetch — Yahoo is a public endpoint that doesn't need the Finnhub
    // credential proxy. Browser UA avoids Yahoo's basic bot filter.
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!r.ok) {
      if (r.status === 429) {
        // Add 5s of pacing on top of the 1s default. Future calls in the
        // queue will wait ~5s before firing. Keeps trying instead of
        // black-holing all Yahoo traffic.
        yahoo429Until = Date.now() + 5000;
      }
      console.warn(`[yahoo] ${symbol} ${interval} (${host}) HTTP ${r.status} ${r.statusText}`);
      return null;
    }
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }> };
        }>;
        error?: unknown;
      };
    };
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp;
    const closes = res?.indicators?.quote?.[0]?.close;
    const vols = res?.indicators?.quote?.[0]?.volume;
    if (!Array.isArray(ts) || !Array.isArray(closes) || ts.length === 0) return null;
    const out: { time: number; close: number; volume?: number }[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      const c = closes[i];
      const v = Array.isArray(vols) ? vols[i] : undefined;
      if (Number.isFinite(t) && c !== null && c !== undefined && Number.isFinite(c)) {
        out.push({ time: t, close: c as number, volume: Number.isFinite(v as number) ? (v as number) : undefined });
      }
    }
    if (out.length === 0) {
      console.warn(`[yahoo] ${symbol} ${interval} parsed 0 bars from response`);
    }
    return out.length > 0 ? out.slice(-400) : null;
  } catch (e) {
    console.warn(`[yahoo] ${symbol} ${interval} fetch error:`, (e as Error)?.message || e);
    return null;
  }
  });
}
