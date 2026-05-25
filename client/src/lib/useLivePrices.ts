import { useEffect, useState } from "react";
import { ensurePriceFeed, subscribe, getSnapshot, type LiveQuote } from "./priceFeed";
import type { Ticker } from "@shared/schema";

/**
 * Returns a symbol → live price map. Manual override on a ticker wins.
 * Sourced from the server-side Finnhub poller via SSE (with REST fallback).
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
