// ─────────────────────────────────────────────────────────────────────────────
// useWatchlistCandles — shared batch loader for heatmap + scanner.
// Joins /api/watchlist to /api/tickers, then fans out one /api/candles request
// per symbol via TanStack Query. Shares cache with the mini-charts (same key).
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Ticker, WatchlistItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { computeSMAs, getAScore, type AScoreResult } from "@/lib/sma";

type Candle = { time: number; close: number; volume?: number };
export type Interval = "1D" | "1H" | "30M" | "5M";

export interface WatchlistRow {
  symbol: string;
  candles: Candle[];
  loading: boolean;
  // Derived metrics — undefined while loading.
  lastPrice?: number;
  prevPrice?: number;
  changePct?: number;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  distToSma20Pct?: number;
  atr14?: number;
  aScore?: AScoreResult;
  lastUpdated?: number;
}

const REFRESH_BY_INTERVAL: Record<Interval, number> = {
  "1D": 60_000, "1H": 60_000, "30M": 20_000, "5M": 10_000,
};

// O(n) Wilder ATR-14 from close-only data (proxy: |close_i - close_{i-1}|).
function atr14FromCloses(closes: number[]): number | undefined {
  if (closes.length < 15) return undefined;
  let prev = closes[closes.length - 15];
  let atr = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    atr += Math.abs(closes[i] - prev);
    prev = closes[i];
  }
  return atr / 14;
}

export function useWatchlistSymbols(): string[] {
  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  return useMemo(() => {
    const byId = new Map<number, string>();
    for (const t of tickers || []) byId.set(t.id, t.symbol);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of watchlist || []) {
      const s = byId.get(w.tickerId);
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
    return out;
  }, [tickers, watchlist]);
}

export function useWatchlistCandles(symbols: string[], interval: Interval = "1D"): WatchlistRow[] {
  const refresh = REFRESH_BY_INTERVAL[interval];

  // Shares cache key with MiniChartWidget — zero duplicate requests.
  const results = useQueries({
    queries: symbols.map(sym => ({
      queryKey: ["/api/candles", sym, interval],
      queryFn: async () => {
        const r = await apiRequest("GET", `/api/candles/${sym}?interval=${interval}`);
        return (await r.json()) as Candle[];
      },
      staleTime: Math.max(5_000, refresh / 2),
      refetchInterval: refresh,
      refetchIntervalInBackground: false,
      enabled: !!sym,
    })),
  });

  return useMemo<WatchlistRow[]>(() => symbols.map((symbol, i) => {
    const q = results[i];
    const candles = (q?.data || []) as Candle[];
    const loading = !!q?.isLoading;
    if (candles.length < 2) return { symbol, candles, loading };

    const closes = candles.map(c => c.close);
    const { sma20, sma50, sma200 } = computeSMAs(closes);
    const lastPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2];
    const changePct = ((lastPrice - prevPrice) / prevPrice) * 100;
    const s20 = sma20[sma20.length - 1];
    const s50 = sma50[sma50.length - 1];
    const s200 = sma200[sma200.length - 1];
    const distToSma20Pct = s20 != null ? ((lastPrice - s20) / s20) * 100 : undefined;
    const aScore = getAScore(closes, sma20);

    return {
      symbol, candles, loading,
      lastPrice, prevPrice, changePct,
      sma20: s20, sma50: s50, sma200: s200,
      distToSma20Pct,
      atr14: atr14FromCloses(closes),
      aScore,
      lastUpdated: q?.dataUpdatedAt,
    };
  }), [symbols, results]);
}
