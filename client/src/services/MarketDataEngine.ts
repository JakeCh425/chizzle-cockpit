import React, { useEffect } from "react";
import { isMarketOpen, reconnectPriceFeed, subscribeSymbols } from "@/lib/priceFeed";
import { globalStore } from "@/lib/useMarketDataStore";
import { queryClient } from "@/lib/queryClient";

declare global {
  interface Window {
    __ENGINE_SESSION_ID__?: string;
  }
}

const STALE_GAP_RECOVERY_MS = 15_000;

/**
 * Persistent Root-Level Market Data Singleton (`MarketDataEngine`).
 * Lives outside React component lifecycles so route transitions never disconnect
 * the WebSocket, drop ticks, or trigger reconnect cycles.
 */
class MarketDataEngineService {
  private started = false;
  private visibilityListenerAttached = false;
  private lastRecoveryAt = 0;
  private hourlyCloseTimer: ReturnType<typeof setInterval> | null = null;
  private lastTriggeredHourKey = "";

  public getSessionId(): string {
    if (typeof window === "undefined") return "ssr";
    if (!window.__ENGINE_SESSION_ID__) {
      window.__ENGINE_SESSION_ID__ = `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }
    return window.__ENGINE_SESSION_ID__;
  }

  public start(): void {
    this.getSessionId();
    if (this.started) return;
    this.started = true;

    reconnectPriceFeed();

    if (typeof document !== "undefined" && !this.visibilityListenerAttached) {
      this.visibilityListenerAttached = true;
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    // Trigger an immediate forced refresh at :00 of every hour when 1H candles close
    if (!this.hourlyCloseTimer) {
      this.hourlyCloseTimer = setInterval(() => {
        const now = new Date();
        if (now.getMinutes() === 0 && now.getSeconds() < 20) {
          const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
          if (this.lastTriggeredHourKey !== hourKey) {
            this.lastTriggeredHourKey = hourKey;
            void queryClient.invalidateQueries({ queryKey: ["/api/swing/scan"] });
          }
        }
      }, 15_000);
    }
  }

  public subscribe(symbols: string[]): void {
    subscribeSymbols(symbols);
  }

  public async recoverMissedTicks(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecoveryAt < 3_000) return;
    this.lastRecoveryAt = now;

    try {
      const res = await fetch("/api/prices");
      if (res.ok) {
        const payload = await res.json();
        if (payload && typeof payload === "object") {
          globalStore.setSnapshot(payload);
        }
      }
    } catch {
      // Ignore transient catch-up fetch error
    }

    if (isMarketOpen()) {
      reconnectPriceFeed();
    }
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    const state = globalStore.getState();
    const lastTickTs = state.lastTickTimestamp || state.lastEventAt || 0;
    if (isMarketOpen() && Date.now() - lastTickTs > STALE_GAP_RECOVERY_MS) {
      void this.recoverMissedTicks();
    }
  };
}

export const MarketDataEngine = new MarketDataEngineService();

/**
 * Root-level provider mounted OUTSIDE <Switch> / routes in App.tsx.
 * Initializes the singleton MarketDataEngine once for the entire SPA session.
 */
export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    MarketDataEngine.start();
  }, []);

  return React.createElement(React.Fragment, null, children);
}
