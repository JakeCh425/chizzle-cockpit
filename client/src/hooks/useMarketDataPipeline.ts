import { useEffect, useRef, useCallback } from "react";
import { globalStore, useMarketDataStore, type MarketTick } from "@/lib/useMarketDataStore";
import { isMarketOpen } from "@/lib/priceFeed";

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
  private reconnectTimer: NodeJS.Timeout | null = null;
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
   * Initializes root connection to primary live feed.
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/prices/ws`;

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.isConnecting = false;
        console.log("[useMarketDataPipeline] Connected to primary live market stream.");
        // Resubscribe active watchlist
        this.sendSubscriptions();
        this.notifyListeners();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            for (const item of data) {
              this.handleIncomingTick(item);
            }
          } else if (data && typeof data === "object") {
            this.handleIncomingTick(data);
          }
        } catch (err) {
          console.warn("[useMarketDataPipeline] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
        this.notifyListeners();
      };

      ws.onerror = (err) => {
        this.isConnecting = false;
        console.warn("[useMarketDataPipeline] WebSocket error:", err);
        try { ws.close(); } catch {}
      };
    } catch (e) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
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
    let hasNew = false;
    for (const s of symbols) {
      const clean = s.toUpperCase().trim().split(":").pop()!;
      if (clean && !this.subscribedSymbols.has(clean)) {
        this.subscribedSymbols.add(clean);
        hasNew = true;
      }
    }
    if (hasNew) {
      this.sendSubscriptions();
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
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

  useEffect(() => {
    marketDataPipeline.connect();
  }, []);

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
    tickers: store.tickers,
    prices: store.prices,
    activeTicker: store.activeTicker,
    currentPrice: store.currentPrice,
    wipeTickerState,
  };
}

export default useMarketDataPipeline;
