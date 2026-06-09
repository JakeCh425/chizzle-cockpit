// ─────────────────────────────────────────────────────────────────────────────
// useWatchlistCandles — shared batch loader for heatmap + scanner.
//
// Joins /api/watchlist → /api/tickers and fans out one /api/candles request
// per symbol via TanStack Query. Shares cache keys with MiniChartWidget so
// these components add zero extra network traffic.
//
// Foreground-only refresh, identical TTL ladder as MiniChartWidget.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Ticker, WatchlistItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { computeSMAs, getAScore, type AScoreResult } from "@/lib/sma";
import { useLiveQuotes } from "@/lib/useLivePrices";

export type Interval = "1D" | "4H" | "1H" | "30M" | "5M";

export interface Candle { time: number; close: number; volume?: number }

export interface WatchlistRow {
  symbol: string;
  candles: Candle[];
  /** True while the first response for this symbol is in flight. */
  loading: boolean;
  /** True if the query has resolved without producing the data needed for metrics. */
  empty: boolean;
  lastPrice?: number;
  prevPrice?: number;
  changePct?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  distToSma20Pct?: number;
  atr14?: number;
  aScore?: AScoreResult;
  /** ms epoch of last successful fetch — undefined until first success. */
  lastUpdated?: number;
}

const REFRESH_BY_INTERVAL: Record<Interval, number> = {
  "1D": 60_000, "4H": 60_000, "1H": 60_000, "30M": 20_000, "5M": 10_000,
};

// Wilder ATR-14 approximation from close-only data.
// Returns undefined when we don't have 15+ bars.
function atr14FromCloses(closes: number[]): number | undefined {
  const n = closes.length;
  if (n < 15) return undefined;
  let sum = 0;
  for (let i = n - 14; i < n; i++) {
    sum += Math.abs(closes[i] - closes[i - 1]);
  }
  return sum / 14;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Joined, de-duplicated watchlist symbols in display order. */
export function useWatchlistSymbols(): string[] {
  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  return useMemo(() => {
    if (!tickers || !watchlist) return [];
    const byId = new Map<number, string>();
    for (const t of tickers) byId.set(t.id, t.symbol);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const w of watchlist) {
      const s = byId.get(w.tickerId);
      if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
    return out;
  }, [tickers, watchlist]);
}

/**
 * Batch candle fetcher.
 *
 * Returns one WatchlistRow per symbol with all derived metrics memoized.
 * The returned array reference is stable when neither symbols nor any
 * underlying query result has changed — important so downstream
 * `useMemo`/`useQueries` consumers don't churn.
 */
export function useWatchlistCandles(symbols: string[], interval: Interval = "1D"): WatchlistRow[] {
  const refresh = REFRESH_BY_INTERVAL[interval];

  const results = useQueries({
    queries: symbols.map(sym => ({
      queryKey: ["/api/candles", sym, interval],
      queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<Candle[]> => {
        const r = await apiRequest("GET", `/api/candles/${sym}?interval=${interval}`, undefined, signal);
        return r.json();
      },
      staleTime: Math.max(5_000, refresh / 2),
      refetchInterval: refresh,
      refetchIntervalInBackground: false,
      enabled: !!sym,
    })),
  });

  // Live tick stream — SSE-backed. Used to overlay the current intraday price
  // on top of the last-candle close so heatmap + scanner update in real time
  // instead of showing yesterday's close all session.
  const liveQuotes = useLiveQuotes();

  // Pull only the primitives we need for memo deps — keeps reference identity
  // stable even when TanStack re-creates the wrapping result objects.
  const fingerprints = results.map(q => `${q.status}:${q.dataUpdatedAt ?? 0}`).join("|");
  // Live-quote fingerprint — changes whenever any watched symbol gets a fresh tick.
  const liveFingerprint = symbols
    .map(s => `${s}:${liveQuotes[s]?.price ?? ""}:${liveQuotes[s]?.ts ?? ""}`)
    .join("|");

  return useMemo<WatchlistRow[]>(() => {
    return symbols.map((symbol, i) => {
      const q = results[i];
      const candles = (q?.data ?? []) as Candle[];
      const loading = q?.isLoading ?? true;
      const live = liveQuotes[symbol];

      if (candles.length < 2) {
        // Even without candles we can still surface the live price so the
        // heatmap cell shows a number instead of a dash.
        if (live?.price != null) {
          return {
            symbol, candles, loading, empty: !loading,
            lastPrice: live.price,
            changePct: live.changePct ?? undefined,
            lastUpdated: live.ts ? live.ts * 1000 : Date.now(),
          };
        }
        return { symbol, candles, loading, empty: !loading };
      }

      const closes = candles.map(c => c.close);
      const { sma20: s20Arr, sma50: s50Arr, sma200: s200Arr } = computeSMAs(closes);

      // Prefer the live intraday tick over the last candle close. The last 1D
      // candle close = yesterday's session close; using it during RTH freezes
      // the price all day until the next daily snapshot.
      const candleLastPrice = closes[closes.length - 1];
      const candlePrevClose = closes[closes.length - 2];
      const lastPrice = live?.price ?? candleLastPrice;
      const prevPrice = candleLastPrice; // yesterday's close for change-vs-prior
      const changePct =
        live?.changePct != null
          ? live.changePct
          : prevPrice
          ? ((lastPrice - prevPrice) / prevPrice) * 100
          : undefined;

      const s20 = s20Arr[s20Arr.length - 1] ?? undefined;
      const s50 = s50Arr[s50Arr.length - 1] ?? undefined;
      const s200 = s200Arr[s200Arr.length - 1] ?? undefined;

      const distToSma20Pct = s20 != null ? ((lastPrice - s20) / s20) * 100 : undefined;

      // A-score needs the live tick too — splice it onto the close series so
      // phase detection (APPROACHING / TOUCHING / BOUNCE / REJECTION) reflects
      // the actual current price rather than yesterday's close.
      const closesForScore =
        live?.price != null ? [...closes.slice(0, -1), live.price] : closes;

      return {
        symbol, candles, loading: false, empty: false,
        lastPrice, prevPrice, changePct,
        sma20: s20, sma50: s50, sma200: s200,
        distToSma20Pct,
        atr14: atr14FromCloses(closes),
        aScore: getAScore(closesForScore, s20Arr),
        lastUpdated: live?.ts ? live.ts * 1000 : (q?.dataUpdatedAt || undefined),
      };
    });
    // `fingerprints` covers candle refreshes; `liveFingerprint` covers SSE ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, fingerprints, liveFingerprint]);
}
