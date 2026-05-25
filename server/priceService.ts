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
async function proxiedFetch(url: string, init: any = {}) {
  if (proxyDispatcher) {
    return undiciFetch(url, { ...init, dispatcher: proxyDispatcher });
  }
  return fetch(url, init);
}

export type FeedSource = "FINNHUB" | "SIMULATOR" | "OVERRIDE";

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

// Cadence (seconds) — staggered across the cycle to stay under 60 req/min.
function activeCadenceSec(now = new Date()): number {
  // Translate to America/New_York to classify the session.
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return 300; // weekend
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 5;   // regular session
  if ((minutes >= 4 * 60 && minutes < 9 * 60 + 30) || (minutes >= 16 * 60 && minutes < 20 * 60)) return 60; // pre/post
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
async function fetchQuote(symbol: string): Promise<Quote | null> {
  if (USE_SIMULATOR) return simulatorQuote(symbol);
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
  try {
    const res = await proxiedFetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
      pushError();
      console.warn(`[priceService] ${symbol} HTTP ${res.status}`);
      return null;
    }
    const j: any = await res.json();
    if (j?.c == null || j.c === 0) {
      // Finnhub returns c:0 for unknown / no-data symbols
      pushError();
      console.warn(`[priceService] ${symbol} empty quote`, j);
      return null;
    }
    const q: Quote = {
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
    return q;
  } catch (e: any) {
    pushError();
    console.warn(`[priceService] ${symbol} fetch error: ${e?.message || e}`);
    return null;
  }
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
  // Persist tick history (best-effort)
  try {
    storage.appendPriceTick({ symbol: q.symbol, price: q.price, ts: q.receivedAt });
  } catch (e) { /* ignore */ }
  // Update tickers table currentPrice so other pages without SSE still see fresh values.
  // VIXY is an internal regime input and is NOT in the tickers table.
  if (WATCHLIST_SYMS.includes(q.symbol)) {
    try {
      const t = storage.getTickerBySymbol(q.symbol);
      if (t) storage.updateTicker(t.id, { currentPrice: q.price });
    } catch (e) { /* ignore */ }
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
// Polling loop with staggered single-symbol fetches.
// In active mode (5s cycle, 6 symbols) → 1 request every 833ms → 60/min total.
let symbolIdx = 0;
async function pollOnce() {
  if (pollerStoppedFlag) return;
  const cadenceSec = activeCadenceSec();
  const symbol = SYMBOLS[symbolIdx % SYMBOLS.length];
  symbolIdx++;
  const q = await fetchQuote(symbol);
  if (q) commitQuote(q);
  // Schedule next: stagger requests evenly across the cycle window.
  const intervalMs = Math.floor((cadenceSec * 1000) / SYMBOLS.length);
  setTimeout(pollOnce, Math.max(250, intervalMs));
}

export function startPricePoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  pollerStoppedFlag = false;
  console.log(`[priceService] poller starting; simulator=${USE_SIMULATOR}`);
  // Kick off immediately
  pollOnce().catch(e => console.warn("[priceService] poll error", e));
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
  provider: "Finnhub";
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
    provider: "Finnhub",
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
