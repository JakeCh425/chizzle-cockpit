import { useSyncExternalStore } from "react";
import type { LiveQuote, ConnState } from "./priceFeed";
import { DEFAULT_WATCHLIST } from "./wealthWatchlist";

/**
 * Valid tick payload structure for incoming market events
 */
export interface MarketTick {
  symbol: string;
  price: number;
  timestamp?: number;
  prevClose?: number;
  volume?: number;
  source?: string;
}

export interface LastValidTick {
  price: number;
  timestamp: number;
  prevClose?: number;
}

export interface MarketDataState {
  prices: Record<string, number>;
  quotes: Record<string, LiveQuote>;
  lastValidTicks: Record<string, LastValidTick>;
  previousClose: Record<string, number>;
  status: ConnState | "DELAYED" | "RECONNECTING";
  isDelayed: boolean;
  isReconnecting: boolean;
  lastEventAt: number;
  lastError: string | null;
}

type Listener = () => void;

/**
 * Singleton Market Data Store (Single Source of Truth)
 *
 * Centralizes all real-time market data ticks and REST fallbacks.
 * Subscribed to simultaneously by:
 *   1. Wealth Studio Chart
 *   2. Top Header & Nav Pills
 *   3. Action Center & Trading Setup Cards
 */
class MarketDataStore {
  private state: MarketDataState;
  private listeners = new Set<Listener>();
  private readonly BAD_TICK_THRESHOLD = 0.05; // 5% max instantaneous jump

  constructor() {
    const initialPrices: Record<string, number> = {};
    const initialTicks: Record<string, LastValidTick> = {};
    const initialPrevClose: Record<string, number> = {};

    for (const item of DEFAULT_WATCHLIST || []) {
      if (item?.symbol && item?.price != null && item.price > 0) {
        initialPrices[item.symbol] = item.price;
        const prev = item.todayOpen ?? (item.price - (item.change ?? 0));
        initialPrevClose[item.symbol] = prev > 0 ? prev : item.price;
        initialTicks[item.symbol] = {
          price: item.price,
          timestamp: Date.now(),
          prevClose: initialPrevClose[item.symbol],
        };
      }
    }

    this.state = {
      prices: initialPrices,
      quotes: {},
      lastValidTicks: initialTicks,
      previousClose: initialPrevClose,
      status: "LIVE",
      isDelayed: false,
      isReconnecting: false,
      lastEventAt: Date.now(),
      lastError: null,
    };
  }

  public getState(): MarketDataState {
    return this.state;
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
   * Drops bad ticks without updating candlestickSeries or global currentPrice.
   */
  public validateAndApplyTick(tick: MarketTick): boolean {
    if (!tick || !tick.symbol || !Number.isFinite(tick.price) || tick.price <= 0) {
      return false;
    }

    const sym = tick.symbol.toUpperCase().split(":").pop()!;
    const lastValid =
      this.state.lastValidTicks[sym]?.price ??
      this.state.previousClose[sym] ??
      this.state.prices[sym];

    // Outlier check: Math.abs((liveTick.price - lastValidTick.price) / lastValidTick.price)
    if (lastValid && lastValid > 0) {
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

    const now = tick.timestamp || Date.now();
    const prevClose = tick.prevClose ?? this.state.previousClose[sym] ?? lastValid ?? tick.price;

    this.state = {
      ...this.state,
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
      lastEventAt: now,
      isDelayed: false,
      isReconnecting: false,
      status: this.state.status === "CONNECTING" || this.state.status === "RECONNECTING" ? "LIVE" : this.state.status,
    };

    this.notify();
    return true;
  }

  /**
   * Sets entire quotes snapshot (filtering each quote through Bad Tick sandbox)
   */
  public setSnapshot(quotes: Record<string, LiveQuote>) {
    const nextPrices = { ...this.state.prices };
    const nextQuotes = { ...this.state.quotes };
    const nextLastValid = { ...this.state.lastValidTicks };
    const nextPrevClose = { ...this.state.previousClose };
    let changed = false;

    for (const [s, q] of Object.entries(quotes || {})) {
      if (!q || !Number.isFinite(q.price) || q.price <= 0) continue;
      const sym = s.toUpperCase().split(":").pop()!;
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
        timestamp: q.receivedAt || q.ts * 1000 || Date.now(),
        prevClose: q.prevClose ?? nextPrevClose[sym],
      };
      changed = true;
    }

    if (changed) {
      this.state = {
        ...this.state,
        prices: nextPrices,
        quotes: nextQuotes,
        lastValidTicks: nextLastValid,
        previousClose: nextPrevClose,
        lastEventAt: Date.now(),
        isDelayed: false,
        isReconnecting: false,
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
   * Graceful 'Stale Data' Fallback & Auto-Refresh:
   * REST API call to fetch the definitive "Last Close" price to synchronize the entire application.
   */
  public async fetchLastClose(symbol?: string): Promise<Record<string, number>> {
    try {
      const url = symbol
        ? `/api/quote/${encodeURIComponent(symbol.toUpperCase().split(":").pop()!)}`
        : "/api/prices";
      const res = await fetch(url).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          const quotesToApply: Record<string, LiveQuote> = {};

          if (symbol && typeof (data as any).price === "number") {
            const sym = symbol.toUpperCase().split(":").pop()!;
            quotesToApply[sym] = {
              symbol: sym,
              price: (data as any).price,
              change: (data as any).change ?? 0,
              changePct: (data as any).changePct ?? 0,
              prevClose: (data as any).prevClose,
              source: (data as any).source || "REST_FALLBACK",
              ts: Math.floor(Date.now() / 1000),
              receivedAt: Date.now(),
            };
          } else {
            for (const [k, v] of Object.entries(data as Record<string, any>)) {
              if (v && typeof v.price === "number") {
                quotesToApply[k] = v as LiveQuote;
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
  return useMarketDataStore((s) => (clean ? s.prices[clean] ?? null : null));
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
  }));
}

