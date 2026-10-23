import { useEffect, useState, useRef, useCallback } from "react";
import {
  ensurePriceFeed,
  subscribe,
  getSnapshot,
  subscribeSymbol,
  forceRefreshPrice,
  isMarketHours,
  type LiveQuote,
} from "./priceFeed";
import type { Ticker } from "@shared/schema";

/**
 * Returns a symbol → live price map. Manual override on a ticker wins.
 * Sourced from the server-side streaming feed (WebSocket with SSE/REST fallback).
 */
export function useLivePrices(tickers: Ticker[] | undefined): Record<string, number> {
  const [snap, setSnap] = useState<Record<string, LiveQuote>>(getSnapshot());

  useEffect(() => {
    ensurePriceFeed();
    return subscribe(setSnap);
  }, []);

  const prices: Record<string, number> = {};
  for (const sym of Object.keys(snap)) prices[sym] = snap[sym].price;
  // Apply overrides + pass through DB-only symbols
  for (const t of tickers || []) {
    const live = snap[t.symbol]?.price;
    if (t.manualOverride != null) {
      prices[t.symbol] = t.manualOverride;
    } else if (live != null) {
      prices[t.symbol] = live;
    } else {
      prices[t.symbol] = t.currentPrice;
    }
  }
  return prices;
}

/**
 * Returns the full live quote map (sym → LiveQuote) so callers can render
 * drift, change %, high/low, etc. — without losing the manual-override layer.
 */
export function useLiveQuotes(): Record<string, LiveQuote> {
  const [snap, setSnap] = useState<Record<string, LiveQuote>>(getSnapshot());
  useEffect(() => {
    ensurePriceFeed();
    return subscribe(setSnap);
  }, []);
  return snap;
}

export interface LiveQuoteStatus {
  quote: LiveQuote | null;
  price: number | null;
  ageSec: number | null;
  isLive: boolean;
  isDelayed: boolean;
  isSyncing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Hook for a single symbol's live quote, data age, and data status.
 * If data is older than 1 minute during market hours, automatically triggers a
 * manual refresh and indicates the 'Syncing...' state.
 */
export function useLiveQuote(symbol?: string | null): LiveQuoteStatus {
  const sym = (symbol ?? "").toUpperCase().split(":").pop()!;
  const [snap, setSnap] = useState<Record<string, LiveQuote>>(getSnapshot());
  const [isSyncing, setIsSyncing] = useState(false);
  const lastAutoRefreshRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    ensurePriceFeed();
    if (sym) {
      subscribeSymbol(sym);
    }
    const unsub = subscribe(setSnap);
    return () => {
      isMountedRef.current = false;
      unsub();
    };
  }, [sym]);

  const quote = sym ? snap[sym] ?? null : null;
  const price = quote?.price ?? null;

  // Calculate age in seconds from local receive time or timestamp
  const now = Date.now();
  const quoteTimeMs = quote ? (quote.receivedAt || quote.ts * 1000) : null;
  const ageSec = quoteTimeMs ? Math.max(0, Math.round((now - quoteTimeMs) / 1000)) : null;

  const inMkt = isMarketHours();
  // Live if received within 60s (1 min); delayed if > 60s or quote is missing
  const isLive = ageSec != null && ageSec <= 60;
  const isDelayed = ageSec == null || ageSec > 60;

  const refresh = useCallback(async () => {
    if (!sym || isSyncing) return;
    setIsSyncing(true);
    try {
      await forceRefreshPrice(sym);
    } catch {}
    finally {
      if (isMountedRef.current) {
        setTimeout(() => {
          if (isMountedRef.current) setIsSyncing(false);
        }, 600);
      }
    }
  }, [sym, isSyncing]);

  // If data is older than 1 minute during market hours, force an auto-refresh
  useEffect(() => {
    if (!sym || !inMkt || !isDelayed || isSyncing) return;
    const timeSinceLast = Date.now() - lastAutoRefreshRef.current;
    if (timeSinceLast < 15_000) return; // 15s cooldown to prevent redundant requests
    lastAutoRefreshRef.current = Date.now();
    refresh();
  }, [sym, inMkt, isDelayed, isSyncing, refresh]);

  return { quote, price, ageSec, isLive, isDelayed, isSyncing, refresh };
}
