// Chart Ecosystem — Part 1: client hook for the Shared Market Context.
// One query per symbol + timeframe; every panel that needs indicators, day levels, S/R or the
// combined plan/trade/alert levels reads THIS (never its own copy). The key carries the engine
// snapshot stamp, so when the scan shows a new decision the context refetches the same snapshot.
// `invalidateSwing()` (prefix /api/swing) refreshes it together with every other swing view.
import { useQuery } from "@tanstack/react-query";
import { swingGet } from "@/lib/swing";
import type { ContextTf, MarketContext } from "@shared/marketContext";
import { CONTEXT_TFS } from "@shared/marketContext";
import { usePersistentState } from "@/hooks/use-persistent-state";

export type { MarketContext, ContextTf };
export const isContextTf = (tf: string): tf is ContextTf => (CONTEXT_TFS as readonly string[]).includes(tf);

/** UI toggle (default ON). Off = panels use their previous local sources. */
export function useContextUiEnabled(): [boolean, (v: boolean) => void] {
  return usePersistentState<boolean>("market-context", true);
}

export function useMarketContext(symbol: string | undefined, tf: string = "D", opts: { series?: boolean; stamp?: string | null; enabled?: boolean; params?: unknown } = {}) {
  const sym = (symbol ?? "").toUpperCase();
  const ok = !!sym && isContextTf(tf) && opts.enabled !== false;
  // Part 3: custom indicator params (only sent when they differ from defaults — default URL is unchanged).
  const pj = opts.params ? JSON.stringify(opts.params) : "";
  return useQuery<MarketContext>({
    queryKey: ["/api/swing/context", sym, tf, opts.series ? "series" : "lean", opts.stamp ?? "", pj],
    queryFn: () => swingGet<MarketContext>(`/api/swing/context/${sym}?tf=${tf}${opts.series ? "&series=1" : ""}${pj ? `&params=${encodeURIComponent(pj)}` : ""}`),
    enabled: ok, staleTime: 60_000, retry: 1,
    // Part 2: day levels move with the quote during RTH → refresh every 60 s while the session is live.
    refetchInterval: (q) => ((q.state.data as MarketContext | undefined)?.day?.state === "LIVE" ? 60_000 : false),
    placeholderData: (prev, q) => (q?.queryKey?.[1] === sym && q?.queryKey?.[2] === tf ? prev : undefined),
  });
}
