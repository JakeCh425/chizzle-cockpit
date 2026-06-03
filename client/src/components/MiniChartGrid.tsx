// ─────────────────────────────────────────────────────────────────────────────
// MiniChartGrid.tsx
// Watchlist-driven grid of MiniChartWidget. Joins /api/watchlist to /api/tickers
// to resolve symbols, falls back to a static list if watchlist is empty.
//
// Hosts shared FullChartModal state — clicking any mini chart's badge, expand
// button, or chart area opens the modal for that symbol/interval.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Ticker, WatchlistItem } from "@shared/schema";
import MiniChartWidget, { type Interval } from "@/components/MiniChartWidget";
import FullChartModal from "@/components/FullChartModal";

interface Props {
  /** Fallback symbols when /api/watchlist is empty. */
  fallback?: string[];
  /** Hard cap on how many widgets render at once (perf). */
  max?: number;
  /** Shared default interval applied to every widget. Each can be switched independently. */
  defaultInterval?: Interval;
}

export default function MiniChartGrid({
  fallback = ["SMH", "QQQ", "SPY"],
  max = 12,
  defaultInterval = "1D",
}: Props) {
  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });

  // Resolve symbols: watchlist.ticker_id → tickers.symbol. De-dupe, preserve order.
  const symbols = useMemo(() => {
    const byId = new Map<number, string>();
    for (const t of tickers || []) byId.set(t.id, t.symbol);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const w of watchlist || []) {
      const sym = byId.get(w.tickerId);
      if (sym && !seen.has(sym)) { seen.add(sym); out.push(sym); }
    }
    return out.length > 0 ? out.slice(0, max) : fallback.slice(0, max);
  }, [tickers, watchlist, fallback, max]);

  // Full-chart modal state — symbol + interval are remembered while the
  // modal is open so the user can step through intervals without closing.
  const [modal, setModal] = useState<{ symbol: string; interval: Interval } | null>(null);
  const openFullChart = (symbol: string, interval: Interval) => setModal({ symbol, interval });

  // Live "last updated" tick — second-resolution clock, paused when tab hidden.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const stamp = new Date(now).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Chicago",
  });

  if (symbols.length === 0) {
    return (
      <div className="text-[11px] uppercase tracking-wider text-slate-gray py-4 text-center">
        No watchlist tickers yet
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {symbols.map(sym => (
          <MiniChartWidget
            key={sym}
            ticker={sym}
            defaultInterval={defaultInterval}
            editableTicker={false}
            onExpand={openFullChart}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] uppercase tracking-wider text-slate-gray" data-testid="text-last-updated">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-green shadow-[0_0_6px_hsl(var(--signal-green)/0.7)] animate-pulse" />
        Updated {stamp} CT · Live
      </div>
      <FullChartModal
        open={!!modal}
        symbol={modal?.symbol || ""}
        defaultInterval={modal?.interval || defaultInterval}
        onClose={() => setModal(null)}
      />
    </>
  );
}
