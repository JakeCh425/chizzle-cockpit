import { useEffect, useRef, useCallback, useState } from "react";
import { globalStore, useMarketDataStore, type MarketTick } from "@/lib/useMarketDataStore";
import { isMarketOpen, reconnectPriceFeed, subscribeSymbol } from "@/lib/priceFeed";

/**
 * Singleton Root WebSocket Pipeline Manager (Single Source of Truth)
 * 
 * Enforces:
 * 1. Singleton connection to reliable primary feed (Polygon.io or Primary Markets v2 upstream).
 * 2. Ingests all ticks into `useMarketDataStore` (initial prices set to null, never mock).
 * 3. Cross-component subscription: All components read exclusively from globalStore.tickers[symbol].price.
 * 4. Bad-Tick Rejection Layer: Drops > 5.0% instantaneous price jumps during regular market hours with diagnostic warning.
 * 5. State Wiping on Selection: Cleans up transient chart/order lines before mounting a new asset.
 */

class MarketDataPipelineManager {
  private static instance: MarketDataPipelineManager;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private subscribedSymbols = new Set<string>();
  private isConnecting = false;
  private listeners = new Set<() => void>();

  private constructor() {
    // Singleton
  }

  public static getInstance(): MarketDataPipelineManager {
    if (!MarketDataPipelineManager.instance) {
      MarketDataPipelineManager.instance = new MarketDataPipelineManager();
    }
    return MarketDataPipelineManager.instance;
  }

  /**
   * Delegates to the single root MarketDataService in priceFeed.ts (no duplicate WebSocket).
   */
  public connect(): void {
    if (typeof window === "undefined") return;
    reconnectPriceFeed();
    this.notifyListeners();
  }

  /**
   * Bad-Tick Rejection Layer:
   * Validates each incoming tick against the prior verified tick.
   * If an instantaneous price movement exceeds 5.0% for mega-caps/ETFs during regular market hours,
   * drop the tick and log a diagnostic warning.
   */
  public handleIncomingTick(tick: any): boolean {
    if (!tick || !tick.symbol) return false;
    const sym = String(tick.symbol).toUpperCase().trim().split(":").pop()!;
    const price = Number(tick.price ?? tick.p ?? tick.c ?? tick.close ?? tick.regularMarketPrice);

    if (!Number.isFinite(price) || price <= 0) return false;

    // Bad-Tick Rejection check
    const lastValid = globalStore.tickers[sym]?.price ?? globalStore.prices[sym];
    if (lastValid && lastValid > 0 && isMarketOpen()) {
      const pctDiff = Math.abs((price - lastValid) / lastValid);
      if (pctDiff > 0.05) {
        console.warn(
          `[useMarketDataPipeline:BadTick] Dropped ${sym} outlier: $${price} vs last verified $${lastValid} (${(pctDiff * 100).toFixed(1)}% jump > 5.0% gate).`
        );
        return false;
      }
    }

    const marketTick: MarketTick = {
      symbol: sym,
      price,
      p: price,
      c: price,
      regularMarketPrice: price,
      timestamp: tick.timestamp ?? tick.t ?? tick.ts ?? Date.now(),
      isMarketOpen: isMarketOpen(),
    };

    return globalStore.validateAndApplyTick(marketTick);
  }

  public subscribe(symbols: string[]): void {
    for (const s of symbols) {
      const clean = (s ?? "").toString().toUpperCase().trim().split(":").pop()!;
      if (clean && !this.subscribedSymbols.has(clean)) {
        this.subscribedSymbols.add(clean);
        subscribeSymbol(clean);
      }
    }
  }

  private sendSubscriptions(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.subscribedSymbols.size > 0) {
      try {
        this.ws.send(JSON.stringify({
          action: "subscribe",
          symbols: Array.from(this.subscribedSymbols),
        }));
      } catch {}
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.retryCount++;
    const delay = Math.min(3000 * Math.pow(2, this.retryCount - 1), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public addListener(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch {}
    }
  }

  public isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  public reconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.retryCount = 0;
    this.isConnecting = false;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connect();
  }

  /**
   * State Wiping on Selection:
   * When switching active tickers in Wealth Studio or expanding a card, immediately execute a state cleanup
   * so previous target lines, Y-axis domains, and order parameters are reset before the new asset mounts.
   */
  public wipeTickerState(ticker: string): void {
    globalStore.clearData(ticker);
  }
}

export const marketDataPipeline = MarketDataPipelineManager.getInstance();

/**
 * Root React hook to maintain single-connection market pipeline.
 */
export function useMarketDataPipeline(watchlist?: string[]) {
  const store = useMarketDataStore();
  const [usingBackup, setUsingBackup] = useState(false);
  const backupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopBackup = useCallback(() => {
    if (backupTimerRef.current) {
      clearInterval(backupTimerRef.current);
      backupTimerRef.current = null;
    }
    setUsingBackup(false);
    globalStore.setPollingBackup(false);
  }, []);

  const connectBackup = useCallback(() => {
    setUsingBackup(true);
    globalStore.setPollingBackup(true);
    if (backupTimerRef.current) return;

    const pollBackupOnce = async () => {
      try {
        const res = await fetch("/api/prices");
        if (!res.ok) return;
        const payload = await res.json();
        if (payload && typeof payload === "object") {
          for (const tick of Object.values(payload)) {
            if (tick) marketDataPipeline.handleIncomingTick(tick);
          }
        }
      } catch {
        // Silently catch backup polling errors
      }
    };

    void pollBackupOnce();
    backupTimerRef.current = setInterval(() => {
      void pollBackupOnce();
    }, 5000);
  }, []);

  useEffect(() => {
    let failoverTimeout: ReturnType<typeof setTimeout> | null = null;

    // Step 1: Default strictly to primary WebSocket connection with 3000ms failover timeout
    try {
      marketDataPipeline.connect();
    } catch {
      connectBackup();
    }

    failoverTimeout = setTimeout(() => {
      if (!marketDataPipeline.isConnected()) {
        connectBackup();
      }
    }, 3000);

    const unsub = marketDataPipeline.addListener(() => {
      if (marketDataPipeline.isConnected()) {
        if (failoverTimeout) {
          clearTimeout(failoverTimeout);
          failoverTimeout = null;
        }
        stopBackup();
      }
    });

    const abortController = new AbortController();

    const fetchLatestRestQuotes = async () => {
      try {
        const res = await fetch("/api/prices", { signal: abortController.signal });
        if (!res.ok) return;
        const payload = await res.json();
        if (payload && typeof payload === "object") {
          for (const tick of Object.values(payload)) {
            if (tick) marketDataPipeline.handleIncomingTick(tick);
          }
        }
      } catch {
        // Ignore transient REST wake-up fetch errors or aborts
      }
    };

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        // Tab Wake-Up Sync: reconnect WebSocket AND force immediate REST quote re-fetch
        try {
          marketDataPipeline.reconnect();
        } catch {
          connectBackup();
        }
        void fetchLatestRestQuotes();
      }
    };

    const handleFocus = () => {
      if (!marketDataPipeline.isConnected()) {
        try {
          marketDataPipeline.reconnect();
        } catch {
          connectBackup();
        }
      }
      void fetchLatestRestQuotes();
    };

    window.addEventListener("focus", handleFocus);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      abortController.abort();
      if (failoverTimeout) clearTimeout(failoverTimeout);
      if (backupTimerRef.current) {
        clearInterval(backupTimerRef.current);
        backupTimerRef.current = null;
      }
      unsub();
      window.removeEventListener("focus", handleFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [connectBackup, stopBackup]);

  useEffect(() => {
    if (watchlist && watchlist.length > 0) {
      marketDataPipeline.subscribe(watchlist);
    }
  }, [watchlist]);

  const wipeTickerState = useCallback((ticker: string) => {
    marketDataPipeline.wipeTickerState(ticker);
  }, []);

  return {
    isConnected: marketDataPipeline.isConnected(),
    usingBackup,
    tickers: store.tickers,
    prices: store.prices,
    activeTicker: store.activeTicker,
    currentPrice: store.currentPrice,
    wipeTickerState,
  };
}

export default useMarketDataPipeline;
