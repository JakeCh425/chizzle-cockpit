import React, { useEffect } from "react";
import { isMarketOpen, reconnectPriceFeed, subscribeSymbols, type LiveQuote } from "@/lib/priceFeed";
import { globalStore, extractQuotePrice } from "@/lib/useMarketDataStore";
import { queryClient } from "@/lib/queryClient";

declare global {
  interface Window {
    __ENGINE_SESSION_ID__?: string;
  }
}

const WAKE_CATCHUP_THRESHOLD_MS = 5_000;

/**
 * Persistent Root-Level Market Data Singleton (`MarketDataEngine`).
 * Runs the WebSocket + 20s heartbeat + REST fallback inside a dedicated Web Worker
 * (`src/workers/marketFeed.worker.ts`) so background browser tabs never throttle
 * or drop the live market stream.
 */
class MarketDataEngineService {
  private started = false;
  private worker: Worker | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private wakeLockSentinel: any = null;
  private visibilityListenerAttached = false;
  private lastRecoveryAt = 0;
  private hourlyCloseTimer: ReturnType<typeof setInterval> | null = null;
  private marketOpenSyncTimer: ReturnType<typeof setInterval> | null = null;
  private lastTriggeredHourKey = "";
  private pendingSymbols = new Set<string>();

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

    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" && !this.broadcastChannel) {
      try {
        this.broadcastChannel = new BroadcastChannel("chizzle_live_sync");
        this.broadcastChannel.onmessage = (ev: MessageEvent) => {
          const msg = ev.data;
          if (msg?.type === "SNAPSHOT" && msg.snapshot) {
            globalStore.setSnapshot(msg.snapshot);
            if (typeof msg.lastTickTs === "number") {
              globalStore.setBackendLastTickTs(msg.lastTickTs);
            }
          }
        };
      } catch {}
    }

    // Immediate non-blocking state snapshot hydration on boot
    void this.silentSnapshotPatch();

    if (typeof window !== "undefined" && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(new URL("../workers/marketFeed.worker.ts", import.meta.url), {
          type: "module",
        });
        this.worker.onmessage = (ev: MessageEvent) => this.handleWorkerMessage(ev.data);
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${window.location.host}/ws/prices`;
        this.worker.postMessage({
          type: "INIT",
          wsUrl,
          apiBase: "",
          marketOpen: isMarketOpen(),
          symbols: Array.from(this.pendingSymbols),
        });
      } catch {
        this.worker = null;
        reconnectPriceFeed();
      }
    } else {
      reconnectPriceFeed();
    }

    if (typeof document !== "undefined" && !this.visibilityListenerAttached) {
      this.visibilityListenerAttached = true;
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }

    if (!this.marketOpenSyncTimer) {
      this.marketOpenSyncTimer = setInterval(() => {
        if (this.worker) {
          this.worker.postMessage({ type: "MARKET_OPEN", marketOpen: isMarketOpen() });
        }
      }, 30_000);
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

  private handleWorkerMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "TICKS" && Array.isArray(msg.ticks)) {
      const snapshot: Record<string, LiveQuote> = {};
      for (const q of msg.ticks) {
        const sym = String(q?.symbol || "").toUpperCase().trim();
        const price = extractQuotePrice(q);
        if (sym && price != null && price > 0) {
          snapshot[sym] = {
            ...q,
            symbol: sym,
            price,
            receivedAt: msg.ts || Date.now(),
          } as LiveQuote;
        }
      }
      if (Object.keys(snapshot).length > 0) {
        globalStore.setSnapshot(snapshot);
        globalStore.setDisconnectedSinceMs(null);
        const ts = msg.ts || Date.now();
        globalStore.setBackendLastTickTs(ts);
        try {
          this.broadcastChannel?.postMessage({ type: "SNAPSHOT", snapshot, lastTickTs: ts });
        } catch {}
      }
      if (typeof msg.latencyMs === "number") {
        globalStore.setLatency(msg.latencyMs);
      }
    } else if (msg.type === "STATUS") {
      if (typeof msg.latencyMs === "number") {
        globalStore.setLatency(msg.latencyMs);
      }
      if (msg.status === "LIVE") {
        globalStore.setPollingBackup(false);
        globalStore.setDisconnectedSinceMs(null);
        globalStore.setStatus("LIVE");
      } else if (msg.status === "STATIC") {
        globalStore.setPollingBackup(false);
        globalStore.setDisconnectedSinceMs(null);
        globalStore.setStatus("STATIC");
      } else if (msg.status === "POLLING_BACKUP" || msg.status === "RECONNECTING") {
        globalStore.setPollingBackup(Boolean(msg.isPollingBackup));
        globalStore.setDisconnectedSinceMs(msg.disconnectedSinceMs ?? Date.now());
        globalStore.setStatus(msg.status);
      }
    }
  }

  public isWorkerActive(): boolean {
    return this.worker !== null;
  }

  public subscribe(symbols: string[]): void {
    const cleaned: string[] = [];
    for (const s of symbols) {
      const c = (s ?? "").toString().trim().toUpperCase();
      if (c) {
        this.pendingSymbols.add(c);
        cleaned.push(c);
      }
    }
    if (cleaned.length === 0) return;
    if (this.worker) {
      this.worker.postMessage({ type: "SUBSCRIBE", symbols: cleaned });
    } else {
      subscribeSymbols(cleaned);
    }
  }

  /**
   * Silent State Patching (< 50ms):
   * Fetches GET /api/state/snapshot and patches useMarketDataStore in place without
   * setting isLoading=true or triggering a full historical rescan.
   */
  public async silentSnapshotPatch(): Promise<void> {
    try {
      const res = await fetch("/api/state/snapshot");
      if (!res.ok) return;
      const snap = await res.json();
      if (snap && typeof snap === "object") {
        if (typeof snap.lastTickTs === "number" && snap.lastTickTs > 0) {
          globalStore.setBackendLastTickTs(snap.lastTickTs);
        }
        if (snap.tickers && typeof snap.tickers === "object") {
          const quotePatch: Record<string, LiveQuote> = {};
          for (const [sym, t] of Object.entries<any>(snap.tickers)) {
            if (t && typeof t.price === "number" && t.price > 0) {
              quotePatch[sym] = {
                symbol: sym,
                price: t.price,
                prevClose: t.prevClose ?? t.price,
                change: 0,
                changePct: t.changePct ?? 0,
                high: t.price,
                low: t.price,
                open: t.price,
                ts: Math.floor((t.lastTickTs || Date.now()) / 1000),
                receivedAt: t.lastTickTs || Date.now(),
                source: t.source || "FINNHUB",
              };
            }
          }
          if (Object.keys(quotePatch).length > 0) {
            globalStore.setSnapshot(quotePatch);
          }
        }
      }
    } catch {
      // Silent fail on transient network hiccup
    }
  }

  /**
   * Request Screen Wake Lock when ACTIVE EXECUTION setups are armed so the
   * workstation does not sleep mid-trade.
   */
  public async syncWakeLock(hasArmedSetups: boolean): Promise<void> {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      if (hasArmedSetups && !this.wakeLockSentinel) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
        this.wakeLockSentinel?.addEventListener?.("release", () => {
          this.wakeLockSentinel = null;
        });
      } else if (!hasArmedSetups && this.wakeLockSentinel) {
        await this.wakeLockSentinel.release();
        this.wakeLockSentinel = null;
      }
    } catch {
      // Wake Lock not supported or blocked by battery saver — safe fallback
    }
  }

  public async recoverMissedTicks(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecoveryAt < 3_000) return;
    this.lastRecoveryAt = now;
    await this.silentSnapshotPatch();
    if (this.worker) {
      this.worker.postMessage({ type: "REST_CATCHUP" });
    }
  }

  private handleVisibilityChange = (): void => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    // Zero-Rescan Instant Tab Return: silently patch state from backend snapshot
    void this.silentSnapshotPatch();
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
