import { useSyncExternalStore } from "react";
import { isMarketOpen, reconnectPriceFeed, type LiveQuote, type ConnState } from "./priceFeed";

/**
 * Valid tick payload structure for incoming market events.
 * Supports standard `price`, Finnhub `c`, Yahoo `regularMarketPrice`, and raw trade `p` / `close`.
 */
export interface MarketTick {
  symbol: string;
  price?: number;
  c?: number;
  regularMarketPrice?: number;
  last?: number;
  close?: number;
  p?: number;
  currentPrice?: number;
  timestamp?: number;
  ts?: number;
  t?: number;
  regularMarketTime?: number;
  prevClose?: number;
  pc?: number;
  volume?: number;
  source?: string;
  forceAuthoritative?: boolean;
  isMarketOpen?: boolean;
}

export interface LastValidTick {
  price: number;
  timestamp: number;
  prevClose?: number;
}

export interface MarketDataState {
  activeTicker: string;
  currentPrice: number | null;
  isLoadingTicker: boolean;
  prices: Record<string, number>;
  quotes: Record<string, LiveQuote>;
  lastValidTicks: Record<string, LastValidTick>;
  previousClose: Record<string, number>;
  status: ConnState | "DELAYED" | "RECONNECTING";
  isDelayed: boolean;
  isReconnecting: boolean;
  lastEventAt: number;
  lastTickTimestamp: number;
  lastError: string | null;
  dataFeedError: string | null;
  staleQuoteRejected: boolean;
}

type Listener = () => void;

export const STALE_TICK_THRESHOLD_MS = 15_000; // 15 seconds max silence while market is OPEN
export const MAX_QUOTE_AGE_OPEN_MARKET_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms) max quote age when market is OPEN
export const STALE_QUOTE_ERROR_MESSAGE = "[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]";
export const SYNCING_LIVE_DATA_BADGE = "[ 🔄 SYNCING LIVE DATA... ]";

/**
 * Normalizes incoming quote payloads across Finnhub (`data.c`), Yahoo (`data.regularMarketPrice`),
 * Polygon/TwelveData (`data.close` / `data.last`), and internal (`data.price`).
 */
export function extractQuotePrice(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw =
    payload.price ??
    payload.c ??
    payload.regularMarketPrice ??
    payload.last ??
    payload.close ??
    payload.p ??
    payload.currentPrice;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Normalizes quote timestamps (seconds or milliseconds) into epoch milliseconds.
 */
export function normalizeQuoteTimestampMs(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw =
    payload.timestamp ??
    payload.ts ??
    payload.t ??
    payload.regularMarketTime;
  if (raw == null) return null;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Unix seconds are < 1e11; convert to milliseconds
  return num < 1e11 ? num * 1000 : num;
}

/**
 * Purges stale cached price states from localStorage on boot so old static prices
 * never persist across page reloads.
 */
export function clearStaleCachedPrices(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const priceCacheKeys = [
      "chizzle-cached-prices",
      "chizzle-price-cache",
      "chizzle-last-prices",
      "chizzle-market-prices",
      "chizzle-live-prices",
    ];
    for (const key of priceCacheKeys) {
      localStorage.removeItem(key);
    }

    const savedWatchlist = localStorage.getItem("chizzle-wealth-watchlist");
    if (savedWatchlist) {
      const parsed = JSON.parse(savedWatchlist);
      if (Array.isArray(parsed)) {
        const sanitized = parsed.map((item: any) =>
          item && typeof item === "object"
            ? { ...item, price: 0, sparkline: [] }
            : item
        );
        localStorage.setItem("chizzle-wealth-watchlist", JSON.stringify(sanitized));
      }
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
}

/**
 * Strict initial state: `currentPrice` is strictly `null` (never a fake historical price),
 * and `prices`, `lastValidTicks`, `previousClose` start empty until verified live quotes arrive.
 */
export const initialState: MarketDataState = {
  activeTicker: "NVDA",
  currentPrice: null,
  isLoadingTicker: true,
  prices: {},
  quotes: {},
  lastValidTicks: {},
  previousClose: {},
  status: "CONNECTING",
  isDelayed: false,
  isReconnecting: false,
  lastEventAt: 0,
  lastTickTimestamp: 0,
  lastError: null,
  dataFeedError: null,
  staleQuoteRejected: false,
};

/**
 * Singleton Market Data Store (Single Source of Truth)
 *
 * Centralizes all real-time market data ticks and REST fallbacks.
 * Subscribed to simultaneously by:
 *   1. Wealth Studio Chart & Multi-Timeframe Learning Chart
 *   2. Top Header & Nav Pills
 *   3. Watchlist
 *   4. Action Center & Trading Setup Cards
 */
class MarketDataStore {
  private state: MarketDataState;
  private listeners = new Set<Listener>();
  private readonly BAD_TICK_THRESHOLD = 0.05; // 5% max instantaneous jump

  constructor() {
    clearStaleCachedPrices();
    this.state = {
      ...initialState,
      prices: {},
      quotes: {},
      lastValidTicks: {},
      previousClose: {},
    };
  }

  public getState(): MarketDataState {
    return this.state;
  }

  /**
   * Direct accessor for the Single Source of Truth currentPrice
   * (`globalStore.currentPrice`)
   */
  public get currentPrice(): number | null {
    return this.state.currentPrice;
  }

  public set currentPrice(price: number | null) {
    if (price == null) {
      this.state = {
        ...this.state,
        currentPrice: null,
      };
      this.notify();
      return;
    }
    this.setCurrentPrice(price, this.state.activeTicker);
  }

  public get activeTicker(): string {
    return this.state.activeTicker;
  }

  public get lastTickTimestamp(): number {
    return this.state.lastTickTimestamp;
  }

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * 1. Cross-Component Data Bleed Prevention:
   * Explicitly clears the active ticker's transient chart/header display state BEFORE fetching new data.
   * Forces the chart and header to show a momentary loading state / blank slate (`isLoadingTicker = true`, `currentPrice = null`),
   * preventing the previous ticker's numbers (e.g., XLV at $190) or stale cached prices from masquerading as the new ticker's data.
   */
  public clearData(nextTicker?: string): void {
    const cleanNext = nextTicker ? nextTicker.toUpperCase().trim().split(":").pop()! : this.state.activeTicker;
    const nextLastValid = { ...this.state.lastValidTicks };
    const nextPrevClose = { ...this.state.previousClose };
    const nextPrices = { ...this.state.prices };
    if (cleanNext) {
      // Clear stale cached tick/seed references for the newly focused ticker so fresh authoritative REST/WS data is never blocked by old seed values
      delete nextLastValid[cleanNext];
      delete nextPrevClose[cleanNext];
      delete nextPrices[cleanNext];
    }

    this.state = {
      ...this.state,
      activeTicker: cleanNext || this.state.activeTicker,
      currentPrice: null,
      isLoadingTicker: true,
      prices: nextPrices,
      lastValidTicks: nextLastValid,
      previousClose: nextPrevClose,
    };
    this.notify();
  }

  /**
   * Strictly enforces `activeTicker` globally:
   * Fires `clearData(ticker)` BEFORE resolving and fetching the new ticker's authoritative price.
   */
  public setActiveTicker(ticker: string): void {
    const sym = ticker ? ticker.toUpperCase().trim().split(":").pop()! : "";
    if (!sym) return;

    // Step 1: Explicitly clear previous ticker display state BEFORE loading new ticker data
    this.clearData(sym);

    // Step 2: Hydrate with known price for `sym` (if available) and mark ready while background fetch refreshes
    const knownPrice = this.state.prices[sym] ?? null;
    this.state = {
      ...this.state,
      activeTicker: sym,
      currentPrice: knownPrice,
      isLoadingTicker: knownPrice == null,
    };
    this.notify();
  }

  /**
   * 2. Enforce 'Single Source of Truth' for Current Price:
   * Directly updates `globalStore.currentPrice` and `prices[sym]` simultaneously so Header, Watchlist, Setup Cards, and Chart update in lockstep.
   */
  public setCurrentPrice(price: number, symbol?: string): void {
    if (!Number.isFinite(price) || price <= 0) return;
    const sym = (symbol || this.state.activeTicker || "NVDA").toUpperCase().trim().split(":").pop()!;
    const now = Date.now();
    const prevClose = this.state.previousClose[sym] ?? price;

    this.state = {
      ...this.state,
      activeTicker: symbol ? sym : this.state.activeTicker,
      currentPrice: price,
      isLoadingTicker: false,
      prices: {
        ...this.state.prices,
        [sym]: price,
      },
      lastValidTicks: {
        ...this.state.lastValidTicks,
        [sym]: {
          price,
          timestamp: now,
          prevClose,
        },
      },
      lastEventAt: now,
      lastTickTimestamp: now,
      isDelayed: false,
      isReconnecting: false,
      lastError: null,
      dataFeedError: null,
      staleQuoteRejected: false,
      status: "LIVE",
    };
    this.notify();
  }

  /**
   * Triggers UI error state `[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]` and attempts to reconnect
   * to the primary data source without updating the global store price.
   */
  public rejectStaleQuote(symbol: string, payload?: any): void {
    console.warn(
      `[MarketDataStore:StaleQuote] ${STALE_QUOTE_ERROR_MESSAGE} for ${symbol}`,
      payload
    );
    this.state = {
      ...this.state,
      status: "DELAYED",
      isDelayed: true,
      isReconnecting: true,
      lastError: STALE_QUOTE_ERROR_MESSAGE,
      dataFeedError: STALE_QUOTE_ERROR_MESSAGE,
      staleQuoteRejected: true,
    };
    this.notify();
    try {
      reconnectPriceFeed();
    } catch {
      // Ignore reconnect errors in headless test environments
    }
  }

  /**
   * Outlier Rejection Sandbox / Bad Tick Filter:
   * Validates incoming tick against previousClose or lastValidTick.
   * If percentage difference exceeds 5%, classifies as BAD TICK and drops it.
   */
  public isBadTick(symbol: string, newPrice: number, referencePrice?: number): boolean {
    if (!Number.isFinite(newPrice) || newPrice <= 0) return true;
    const sym = symbol.toUpperCase().split(":").pop()!;
    const ref =
      referencePrice ??
      this.state.lastValidTicks[sym]?.price ??
      this.state.previousClose[sym] ??
      this.state.prices[sym];

    if (ref && ref > 0) {
      const pctDiff = Math.abs((newPrice - ref) / ref);
      if (pctDiff > this.BAD_TICK_THRESHOLD) {
        console.warn(
          `[BadTick:Sandbox] Dropped outlier tick for ${sym}: $${newPrice} vs lastValid $${ref} (${(
            pctDiff * 100
          ).toFixed(1)}% jump > 5% threshold)`
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Validates and applies an incoming tick to the Single Source of Truth store.
   * - Logs `LIVE TICK RECEIVED:` for browser console verification.
   * - Maps `data.c` (Finnhub), `data.price`, `data.regularMarketPrice` directly to `currentPrice`.
   * - Rejects quotes > 5 minutes old when the market is OPEN and triggers `[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]`.
   * - Drops bad ticks (> 5% jump) without updating candlestickSeries or global currentPrice.
   */
  public validateAndApplyTick(rawTick: MarketTick): boolean {
    const payload = rawTick;
    console.log('LIVE TICK RECEIVED:', payload);

    const mappedPrice = extractQuotePrice(rawTick);
    if (!rawTick || !rawTick.symbol || mappedPrice == null || !Number.isFinite(mappedPrice) || mappedPrice <= 0) {
      return false;
    }

    const tick = { ...rawTick, price: mappedPrice };
    const sym = tick.symbol.toUpperCase().split(":").pop()!;

    // 4. Timestamp Validation (Stale Data Rejection):
    // When a quote is received from the API, check its timestamp.
    // If the market is OPEN and the quote timestamp is more than 5 minutes old, reject it.
    const quoteTsMs = normalizeQuoteTimestampMs(rawTick);
    const marketOpenNow = rawTick.isMarketOpen != null ? rawTick.isMarketOpen : isMarketOpen();
    if (marketOpenNow && quoteTsMs != null && quoteTsMs > 0) {
      const ageMs = Date.now() - quoteTsMs;
      if (ageMs > MAX_QUOTE_AGE_OPEN_MARKET_MS) {
        this.rejectStaleQuote(sym, rawTick);
        return false;
      }
    }

    const lastValid =
      this.state.lastValidTicks[sym]?.price ??
      this.state.previousClose[sym] ??
      this.state.prices[sym];

    // Outlier check: Math.abs((liveTick.price - lastValidTick.price) / lastValidTick.price)
    if (!tick.forceAuthoritative && lastValid && lastValid > 0) {
      const pctDiff = Math.abs((tick.price - lastValid) / lastValid);
      if (pctDiff > this.BAD_TICK_THRESHOLD) {
        console.warn(
          `[BAD TICK] Dropped outlier tick for ${sym}: $${tick.price} vs lastValid $${lastValid} (${(
            pctDiff * 100
          ).toFixed(1)}% jump). Candlestick and currentPrice NOT updated.`
        );
        return false;
      }
    }

    const now = quoteTsMs || Date.now();
    const prevClose = tick.prevClose ?? tick.pc ?? this.state.previousClose[sym] ?? lastValid ?? tick.price;
    const isActiveSym = sym === this.state.activeTicker;

    this.state = {
      ...this.state,
      currentPrice: isActiveSym ? tick.price : (this.state.currentPrice ?? this.state.prices[this.state.activeTicker] ?? null),
      isLoadingTicker: isActiveSym ? false : this.state.isLoadingTicker,
      prices: {
        ...this.state.prices,
        [sym]: tick.price,
      },
      lastValidTicks: {
        ...this.state.lastValidTicks,
        [sym]: {
          price: tick.price,
          timestamp: now,
          prevClose,
        },
      },
      previousClose: {
        ...this.state.previousClose,
        [sym]: prevClose,
      },
      lastEventAt: Date.now(),
      lastTickTimestamp: now,
      isDelayed: false,
      isReconnecting: false,
      lastError: null,
      dataFeedError: null,
      staleQuoteRejected: false,
      status: this.state.status === "CONNECTING" || this.state.status === "RECONNECTING" || this.state.status === "DELAYED" || this.state.status === "STALE" ? "LIVE" : this.state.status,
    };

    this.notify();
    return true;
  }

  /**
   * Fetches a live quote for a single symbol, maps `data.c` / `data.price` / `data.regularMarketPrice`,
   * logs `LIVE TICK RECEIVED:`, validates the 5-minute timestamp threshold, and updates `currentPrice`.
   */
  public async fetchLiveQuote(symbol?: string, marketOpenOverride?: boolean): Promise<number | null> {
    const sym = (symbol || this.state.activeTicker || "NVDA").toUpperCase().trim().split(":").pop()!;
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(sym)}`).catch(() => null);
      if (res && res.ok) {
        const payload = await res.json();
        console.log('LIVE TICK RECEIVED:', payload);
        const mappedPrice = extractQuotePrice(payload);
        if (mappedPrice != null && mappedPrice > 0) {
          const applied = this.validateAndApplyTick({
            ...payload,
            symbol: sym,
            price: mappedPrice,
            isMarketOpen: marketOpenOverride,
          });
          return applied ? mappedPrice : null;
        }
      }
    } catch (e) {
      console.warn(`[MarketDataStore] fetchLiveQuote failed for ${sym}:`, e);
    }
    return null;
  }

  /**
   * Sets entire quotes snapshot (filtering each quote through Bad Tick sandbox and 5-minute timestamp check)
   */
  public setSnapshot(quotes: Record<string, LiveQuote>) {
    const nextPrices = { ...this.state.prices };
    const nextQuotes = { ...this.state.quotes };
    const nextLastValid = { ...this.state.lastValidTicks };
    const nextPrevClose = { ...this.state.previousClose };
    let changed = false;
    const marketOpenNow = isMarketOpen();

    for (const [s, rawQ] of Object.entries(quotes || {})) {
      if (!rawQ) continue;
      console.log('LIVE TICK RECEIVED:', rawQ);
      const mappedPrice = extractQuotePrice(rawQ);
      if (mappedPrice == null || !Number.isFinite(mappedPrice) || mappedPrice <= 0) continue;
      const q: LiveQuote = { ...rawQ, price: mappedPrice };
      const sym = s.toUpperCase().split(":").pop()!;

      const quoteTsMs = normalizeQuoteTimestampMs(rawQ);
      if (marketOpenNow && quoteTsMs != null && quoteTsMs > 0) {
        if (Date.now() - quoteTsMs > MAX_QUOTE_AGE_OPEN_MARKET_MS) {
          this.rejectStaleQuote(sym, rawQ);
          continue;
        }
      }

      const ref = nextLastValid[sym]?.price ?? q.prevClose ?? nextPrices[sym];

      if (ref && ref > 0 && Math.abs((q.price - ref) / ref) > this.BAD_TICK_THRESHOLD) {
        console.warn(
          `[BAD TICK] Dropped snapshot outlier for ${sym}: $${q.price} vs ref $${ref}`
        );
        continue;
      }

      nextPrices[sym] = q.price;
      nextQuotes[sym] = q;
      if (q.prevClose) nextPrevClose[sym] = q.prevClose;
      nextLastValid[sym] = {
        price: q.price,
        timestamp: quoteTsMs || q.receivedAt || Date.now(),
        prevClose: q.prevClose ?? nextPrevClose[sym],
      };
      changed = true;
    }

    if (changed) {
      const now = Date.now();
      const activeSym = this.state.activeTicker;
      this.state = {
        ...this.state,
        currentPrice: nextPrices[activeSym] ?? this.state.currentPrice,
        isLoadingTicker: false,
        prices: nextPrices,
        quotes: nextQuotes,
        lastValidTicks: nextLastValid,
        previousClose: nextPrevClose,
        lastEventAt: now,
        lastTickTimestamp: now,
        isDelayed: false,
        isReconnecting: false,
        lastError: null,
        dataFeedError: null,
        staleQuoteRejected: false,
      };
      this.notify();
    }
  }

  /**
   * Update connection / feed status
   */
  public setStatus(status: ConnState | "DELAYED" | "RECONNECTING") {
    const isReconnecting = status === "CONNECTING" || status === "RECONNECTING";
    const isDelayed = status === "STALE" || status === "DELAYED" || status === "DISCONNECTED";

    if (
      this.state.status === status &&
      this.state.isReconnecting === isReconnecting &&
      this.state.isDelayed === isDelayed
    ) {
      return;
    }

    this.state = {
      ...this.state,
      status,
      isReconnecting,
      isDelayed,
    };
    this.notify();
  }

  /**
   * 3. Implement "Stale State" Auto-Recovery:
   * Checks the last tick timestamp (`lastTickTimestamp`).
   * If the market is OPEN and no new data has been received for > 15 seconds,
   * automatically triggers a background REST API call to fetch a fresh quote and
   * marks `isDelayed = true` so the UI displays `[ ⚠️ DELAYED DATA ]`.
   */
  public async checkStaleState(isMarketOpenNow = true): Promise<boolean> {
    if (!isMarketOpenNow) return false;
    const elapsedMs = Date.now() - this.state.lastTickTimestamp;
    if (elapsedMs > STALE_TICK_THRESHOLD_MS) {
      this.setStatus("DELAYED");
      await this.fetchLastClose(this.state.activeTicker);
      // If no fresh tick updated lastTickTimestamp within the threshold, keep DELAYED warning active
      if (Date.now() - this.state.lastTickTimestamp > STALE_TICK_THRESHOLD_MS) {
        this.setStatus("DELAYED");
      }
      return true;
    }
    return false;
  }

  /**
   * Helper to set `lastTickTimestamp` (useful for testing or external heartbeat tracking)
   */
  public setLastTickTimestamp(ts: number) {
    this.state = {
      ...this.state,
      lastEventAt: ts,
      lastTickTimestamp: ts,
    };
    this.notify();
  }

  /**
   * Graceful 'Stale Data' Fallback & Auto-Refresh:
   * REST API call to fetch the definitive "Last Close" / fresh quote price to synchronize the entire application.
   */
  public async fetchLastClose(symbol?: string): Promise<Record<string, number>> {
    try {
      const url = symbol
        ? `/api/quote/${encodeURIComponent(symbol.toUpperCase().split(":").pop()!)}`
        : "/api/prices";
      const res = await fetch(url).catch(() => null);

      if (res && res.ok) {
        const payload = await res.json();
        console.log('LIVE TICK RECEIVED:', payload);
        const data = payload;
        if (data && typeof data === "object") {
          const quotesToApply: Record<string, LiveQuote> = {};
          const singlePrice = extractQuotePrice(data);

          if (symbol && singlePrice != null) {
            const sym = symbol.toUpperCase().split(":").pop()!;
            quotesToApply[sym] = {
              symbol: sym,
              price: singlePrice,
              change: (data as any).change ?? (data as any).d ?? 0,
              changePct: (data as any).changePct ?? (data as any).dp ?? 0,
              prevClose: (data as any).prevClose ?? (data as any).pc,
              source: (data as any).source || "REST_FALLBACK",
              ts: Number((data as any).ts ?? (data as any).t ?? Math.floor(Date.now() / 1000)),
              receivedAt: Date.now(),
            };
          } else {
            for (const [k, v] of Object.entries(data as Record<string, any>)) {
              const p = extractQuotePrice(v);
              if (v && p != null) {
                quotesToApply[k] = {
                  ...(v as LiveQuote),
                  symbol: v.symbol || k,
                  price: p,
                };
              }
            }
          }

          if (Object.keys(quotesToApply).length > 0) {
            this.setSnapshot(quotesToApply);
          }
        }
      }
    } catch (e) {
      console.warn("[MarketDataStore] Fallback REST fetch error:", e);
    }
    return this.state.prices;
  }
}

export const marketDataStore = new MarketDataStore();
export const globalStore = marketDataStore;

/**
 * Primary React Hook: useMarketDataStore
 * Subscribes to the single Global Store with optional selector.
 */
export function useMarketDataStore<T = MarketDataState>(
  selector?: (state: MarketDataState) => T
): T {
  const getSelectedState = () => {
    const s = marketDataStore.getState();
    return selector ? selector(s) : (s as unknown as T);
  };

  return useSyncExternalStore(
    marketDataStore.subscribe,
    getSelectedState,
    getSelectedState
  );
}

/**
 * Convenience hook to get a single symbol's price from the single source of truth
 */
export function useMarketPrice(symbol?: string | null): number | null {
  const clean = symbol ? symbol.toUpperCase().split(":").pop()! : "";
  return useMarketDataStore((s) =>
    clean
      ? (clean === s.activeTicker && s.currentPrice != null ? s.currentPrice : s.prices[clean] ?? null)
      : s.currentPrice
  );
}

/**
 * Convenience hook to inspect market data feed status
 */
export function useMarketStatus() {
  return useMarketDataStore((s) => ({
    status: s.status,
    isDelayed: s.isDelayed,
    isReconnecting: s.isReconnecting,
    lastEventAt: s.lastEventAt,
    lastTickTimestamp: s.lastTickTimestamp,
  }));
}
