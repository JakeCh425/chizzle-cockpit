import { useSyncExternalStore } from "react";
import { isMarketOpen, reconnectPriceFeed, type LiveQuote, type ConnState } from "./priceFeed";

/**
 * Valid tick payload structure for incoming market events.
 * Supports standard `price`, Finnhub `c`, Yahoo `regularMarketPrice`, and raw trade `p` / `close`.
 */
export interface MarketTick {
  symbol: string;
  price?: number;
  p?: number;
  lastPrice?: number;
  c?: number;
  regularMarketPrice?: number;
  last?: number;
  close?: number;
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

export interface SetupAlertState {
  symbol: string;
  alertSent: boolean;
  lastAlertTimestamp: number | null;
  tradingDay: string;
  stopLoss?: number;
  status?: string;
}

export interface MarketDataState {
  activeTicker: string;
  currentPrice: number | null;
  isLoading: boolean;
  isLoadingTicker: boolean;
  isStaticLastClose: boolean;
  latencyMs: number;
  lastSyncTime: string;
  prices: Record<string, number>;
  quotes: Record<string, LiveQuote>;
  lastValidTicks: Record<string, LastValidTick>;
  previousClose: Record<string, number>;
  setupAlerts: Record<string, SetupAlertState>;
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
export const LIVE_EXCHANGE_TIMEOUT_MS = 10_000; // 10 seconds timeout fallback to Last Official Close
export const MAX_QUOTE_AGE_OPEN_MARKET_MS = 5 * 60 * 1000; // 5 minutes (300,000 ms) max quote age when market is OPEN
export const MAX_CACHE_AGE_OPEN_MARKET_MS = 15 * 60 * 1000; // 15 minutes (900,000 ms) max localStorage cache age when market is OPEN
export const CACHE_TIMESTAMP_KEY = "chizzle-cache-timestamp";
export const CACHE_VERSION_KEY = "chizzle-store-version";
export const CACHE_VERSION = "v3-live-pipeline";
export const STALE_QUOTE_ERROR_MESSAGE = "[ ⚠️ DATA FEED ERROR: STALE QUOTE REJECTED ]";
export const SYNCING_LIVE_DATA_BADGE = "[ 🔄 SYNCING LIVE DATA... ]";
export const CONNECTING_TO_EXCHANGE_BADGE = "[ 🔄 CONNECTING TO EXCHANGE... ]";
export const STATIC_LAST_CLOSE_BADGE = "[ ⏸️ STATIC: LAST CLOSE ]";

/**
 * Normalizes incoming quote payloads across Finnhub (`data.c`), Yahoo (`data.regularMarketPrice`),
 * Polygon/TwelveData (`data.close` / `data.last` / `data.p` / `data.lastPrice`), and internal (`data.price`).
 */
export function extractQuotePrice(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null;
  const raw =
    payload.price ??
    payload.p ??
    payload.lastPrice ??
    payload.c ??
    payload.regularMarketPrice ??
    payload.last ??
    payload.close ??
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
 * 2. Purge Stale LocalStorage on Boot (Cache Invalidation):
 * Checks cache version and timestamp on mount.
 * If the cached data is older than 15 minutes and the market is OPEN, executes a strict
 * `localStorage.removeItem(...)` on store keys to wipe the slate clean before initializing the WebSocket.
 */
export function purgeStaleLocalStorageOnBoot(options?: {
  nowMs?: number;
  marketOpenOverride?: boolean;
}): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return false;
  let purged = false;
  try {
    const nowMs = options?.nowMs ?? Date.now();
    const marketOpenNow = options?.marketOpenOverride ?? isMarketOpen(new Date(nowMs));
    const cachedTsRaw = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
    const cachedTs = cachedTsRaw ? Number(cachedTsRaw) : 0;
    const isOlderThan15Min = !cachedTs || !Number.isFinite(cachedTs) || (nowMs - cachedTs > MAX_CACHE_AGE_OPEN_MARKET_MS);
    const isVersionMismatch = cachedVersion !== CACHE_VERSION;

    const priceCacheKeys = [
      "your_store_key",
      "chizzle-cached-prices",
      "chizzle-price-cache",
      "chizzle-last-prices",
      "chizzle-market-prices",
      "chizzle-live-prices",
    ];
    for (const key of priceCacheKeys) {
      localStorage.removeItem(key);
    }

    if ((marketOpenNow && isOlderThan15Min) || isVersionMismatch) {
      localStorage.removeItem("your_store_key");
      localStorage.removeItem("chizzle-wealth-watchlist");
      purged = true;
    } else {
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
    }

    localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
    localStorage.setItem(CACHE_TIMESTAMP_KEY, String(nowMs));
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return purged;
}

/**
 * Purges stale cached price states from localStorage on boot so old static prices
 * never persist across page reloads.
 */
export function clearStaleCachedPrices(): void {
  purgeStaleLocalStorageOnBoot();
}

/**
 * Strict initial state: `currentPrice` is strictly `null` (never a fake historical price),
 * and `prices`, `lastValidTicks`, `previousClose` start empty until verified live quotes arrive.
 */
export const initialState: MarketDataState = {
  activeTicker: "NVDA",
  currentPrice: null,
  isLoading: true,
  isLoadingTicker: true,
  isStaticLastClose: false,
  latencyMs: 18,
  lastSyncTime: "00:00:00",
  prices: {},
  quotes: {},
  lastValidTicks: {},
  previousClose: {},
  setupAlerts: {},
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
      setupAlerts: {},
    };
  }

  public getTradingDayKey(now: Date | number = Date.now()): string {
    const d = typeof now === "number" ? new Date(now) : now;
    try {
      return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }

  public getSetupAlertState(symbol: string, now: Date | number = Date.now()): SetupAlertState {
    const sym = (symbol || this.state.activeTicker || "NVDA").toUpperCase().trim().split(":").pop()!;
    const todayKey = this.getTradingDayKey(now);
    const existing = this.state.setupAlerts[sym];
    if (!existing) {
      return {
        symbol: sym,
        alertSent: false,
        lastAlertTimestamp: null,
        tradingDay: todayKey,
      };
    }
    if (existing.tradingDay !== todayKey) {
      const resetDay: SetupAlertState = {
        ...existing,
        alertSent: false,
        lastAlertTimestamp: null,
        tradingDay: todayKey,
      };
      this.state = {
        ...this.state,
        setupAlerts: {
          ...this.state.setupAlerts,
          [sym]: resetDay,
        },
      };
      this.notify();
      return resetDay;
    }
    return existing;
  }

  /**
   * Updates a setup's alert deduplication state in the Global Store:
   *   `updateSetup({ alertSent: true })` or `updateSetup(symbol, { alertSent: true })`
   */
  public updateSetup(
    symbolOrPatch: string | ({ symbol?: string } & Partial<SetupAlertState>),
    patch?: Partial<SetupAlertState>
  ): SetupAlertState {
    const symRaw =
      typeof symbolOrPatch === "string"
        ? symbolOrPatch
        : symbolOrPatch.symbol || this.state.activeTicker || "NVDA";
    const sym = symRaw.toUpperCase().trim().split(":").pop()!;
    const resolvedPatch = typeof symbolOrPatch === "string" ? (patch || {}) : symbolOrPatch;
    const prev = this.getSetupAlertState(sym);
    const nextAlertSent = resolvedPatch.alertSent !== undefined ? Boolean(resolvedPatch.alertSent) : prev.alertSent;
    const nextTimestamp =
      resolvedPatch.lastAlertTimestamp !== undefined
        ? resolvedPatch.lastAlertTimestamp
        : nextAlertSent
        ? prev.lastAlertTimestamp ?? Date.now()
        : null;

    const updated: SetupAlertState = {
      ...prev,
      ...resolvedPatch,
      symbol: sym,
      alertSent: nextAlertSent,
      lastAlertTimestamp: nextTimestamp,
    };

    this.state = {
      ...this.state,
      setupAlerts: {
        ...this.state.setupAlerts,
        [sym]: updated,
      },
    };
    this.notify();
    return updated;
  }

  /**
   * Resets `alertSent` to `false` only when the setup invalidates (< stopLoss),
   * gets closed out, or a new trading day begins.
   */
  public resetSetupAlert(
    symbol: string,
    reason: "INVALIDATED" | "CLOSED" | "NEW_TRADING_DAY" = "INVALIDATED",
    now: Date | number = Date.now()
  ): SetupAlertState {
    const sym = (symbol || this.state.activeTicker || "NVDA").toUpperCase().trim().split(":").pop()!;
    const reset: SetupAlertState = {
      symbol: sym,
      alertSent: false,
      lastAlertTimestamp: null,
      tradingDay: this.getTradingDayKey(now),
      status: reason,
    };
    this.state = {
      ...this.state,
      setupAlerts: {
        ...this.state.setupAlerts,
        [sym]: reset,
      },
    };
    this.notify();
    return reset;
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
      isLoading: true,
      isLoadingTicker: true,
      isStaticLastClose: false,
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
      isLoading: knownPrice == null,
      isLoadingTicker: knownPrice == null,
    };
    this.notify();
  }

  public formatSyncTime(ts: number = Date.now()): string {
    try {
      return new Date(ts).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return "00:00:00";
    }
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
      isLoading: false,
      isLoadingTicker: false,
      isStaticLastClose: false,
      latencyMs: 14,
      lastSyncTime: this.formatSyncTime(now),
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
    const msg = { symbol: sym, price: mappedPrice };
    console.log('🟢 LIVE TICK OVERRIDE:', { ticker: msg.symbol, price: msg.price });

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
    const computedLatency = Math.max(8, Math.min(250, Math.abs(Date.now() - now) || 16));

    this.state = {
      ...this.state,
      currentPrice: isActiveSym ? tick.price : (this.state.currentPrice ?? this.state.prices[this.state.activeTicker] ?? null),
      isLoading: isActiveSym ? false : this.state.isLoading,
      isLoadingTicker: isActiveSym ? false : this.state.isLoadingTicker,
      isStaticLastClose: false,
      latencyMs: computedLatency,
      lastSyncTime: this.formatSyncTime(Date.now()),
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
      status: this.state.status === "CONNECTING" || this.state.status === "RECONNECTING" || this.state.status === "DELAYED" || this.state.status === "STALE" || this.state.status === "STATIC" ? "LIVE" : this.state.status,
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
        isLoading: false,
        isLoadingTicker: false,
        lastSyncTime: this.formatSyncTime(now),
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
   * Populates a ticker with its Last Official Close price when the live exchange
   * times out (> 10 seconds with no valid ticks) or when the market is closed.
   * Sets `isLoading = false` (`isLoadingTicker = false`), `isStaticLastClose = true`,
   * and updates the badge state to `[ ⏸️ STATIC: LAST CLOSE ]`.
   */
  public applyStaticLastClose(symbol: string, price: number, prevClose?: number): boolean {
    if (!symbol || !Number.isFinite(price) || price <= 0) return false;
    const sym = symbol.toUpperCase().trim().split(":").pop()!;
    const now = Date.now();
    const resolvedPrev = prevClose && prevClose > 0 ? prevClose : (this.state.previousClose[sym] ?? price);
    const isActiveSym = sym === this.state.activeTicker;

    this.state = {
      ...this.state,
      currentPrice: isActiveSym
        ? price
        : (this.state.currentPrice ?? this.state.prices[this.state.activeTicker] ?? price),
      isLoading: false,
      isLoadingTicker: false,
      isStaticLastClose: true,
      lastSyncTime: this.formatSyncTime(now),
      prices: {
        ...this.state.prices,
        [sym]: price,
      },
      lastValidTicks: {
        ...this.state.lastValidTicks,
        [sym]: {
          price,
          timestamp: now,
          prevClose: resolvedPrev,
        },
      },
      previousClose: {
        ...this.state.previousClose,
        [sym]: resolvedPrev,
      },
      status: "STATIC",
      isDelayed: false,
      isReconnecting: false,
      staleQuoteRejected: false,
      dataFeedError: null,
      lastError: null,
    };
    this.notify();
    return true;
  }

  /**
   * 1. Fix Infinite Loading Loop (10-Second Timeout Fallback):
   * If the app attempts to connect to the live exchange and receives no valid ticks
   * for > 10 seconds (`LIVE_EXCHANGE_TIMEOUT_MS`), automatically executes a REST API call
   * to fetch the 'Last Official Close', sets `isLoading = false`, and marks `isStaticLastClose = true`
   * so cards display `[ ⏸️ STATIC: LAST CLOSE ]` instead of spinning forever.
   */
  public async triggerTimeoutFallback(symbol?: string, fallbackClosePrice?: number): Promise<number | null> {
    const sym = (symbol || this.state.activeTicker || "NVDA").toUpperCase().trim().split(":").pop()!;
    await this.fetchLastClose(sym, true);
    const resolved =
      this.state.prices[sym] ??
      (sym === this.state.activeTicker && this.state.currentPrice != null ? this.state.currentPrice : null) ??
      (fallbackClosePrice && fallbackClosePrice > 0 ? fallbackClosePrice : null);

    if (resolved != null && resolved > 0) {
      this.applyStaticLastClose(sym, resolved);
      return resolved;
    }
    return null;
  }

  /**
   * Updates round-trip network latency measurement (ms) from WebSocket heartbeat
   */
  public setLatency(latencyMs: number): void {
    if (typeof latencyMs !== "number" || latencyMs < 0) return;
    const rounded = Math.round(latencyMs);
    if (this.state.latencyMs === rounded) return;
    this.state = {
      ...this.state,
      latencyMs: rounded,
    };
    this.notify();
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
  public async fetchLastClose(symbol?: string, markStaticFallback = false): Promise<Record<string, number>> {
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
            if (markStaticFallback) {
              this.applyStaticLastClose(sym, singlePrice, (data as any).prevClose ?? (data as any).pc);
              return this.state.prices;
            }
            quotesToApply[sym] = {
              symbol: sym,
              price: singlePrice,
              change: (data as any).change ?? (data as any).d ?? 0,
              changePct: (data as any).changePct ?? (data as any).dp ?? 0,
              prevClose: (data as any).prevClose ?? (data as any).pc,
              source: (data as any).source || "LAST_CLOSE",
              ts: Math.floor(Date.now() / 1000),
              receivedAt: Date.now(),
            };
          } else {
            for (const [k, v] of Object.entries(data as Record<string, any>)) {
              const p = extractQuotePrice(v);
              if (v && p != null) {
                const symKey = (v.symbol || k).toUpperCase().split(":").pop()!;
                if (markStaticFallback) {
                  this.applyStaticLastClose(symKey, p, v.prevClose ?? v.pc);
                } else {
                  quotesToApply[symKey] = {
                    ...(v as LiveQuote),
                    symbol: symKey,
                    price: p,
                    ts: Math.floor(Date.now() / 1000),
                    receivedAt: Date.now(),
                  };
                }
              }
            }
          }

          if (Object.keys(quotesToApply).length > 0) {
            this.setSnapshot(quotesToApply);
            if (!isMarketOpen()) {
              this.state = {
                ...this.state,
                isLoading: false,
                isLoadingTicker: false,
                isStaticLastClose: true,
                status: "STATIC",
              };
              this.notify();
            }
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
