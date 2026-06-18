// ─────────────────────────────────────────────────────────────────────────────
// ScoringDashboard.tsx
// Sortable scanner table for the entire watchlist. Sort by A-score by default.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useMemo, useState } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import FullChartModal from "@/components/FullChartModal";
import { useWatchlistSymbols, useWatchlistCandles, type WatchlistRow } from "@/lib/useWatchlistCandles";

type SortKey = "symbol" | "aScore" | "dist" | "trend" | "atr" | "lastUpdated";
type SortDir = "asc" | "desc";

const TREND_RANK = (r: WatchlistRow): number => {
  if (r.lastPrice == null || r.sma50 == null || r.sma200 == null) return -99;
  let n = 0;
  if (r.lastPrice > r.sma50)  n += 1;
  if (r.lastPrice > r.sma200) n += 2;
  return n;
};

function trendLabel(r: WatchlistRow): { text: string; tone: string } {
  if (r.lastPrice == null || r.sma50 == null || r.sma200 == null) return { text: "—", tone: "text-slate-gray" };
  const above50 = r.lastPrice > r.sma50;
  const above200 = r.lastPrice > r.sma200;
  if (above50 && above200)   return { text: "Above 50/200",  tone: "text-signal-green" };
  if (!above50 && !above200) return { text: "Below 50/200",  tone: "text-signal-red" };
  if (above200)              return { text: "Above 200",     tone: "text-signal-amber" };
  return                       { text: "Below 50",          tone: "text-signal-amber" };
}

const ASCORE_TONE: Record<string, string> = {
  A4: "bg-signal-green/15 text-signal-green border-signal-green/40",
  A3: "bg-signal-amber/25 text-signal-amber border-signal-amber/50",
  A2: "bg-signal-amber/15 text-signal-amber border-signal-amber/40",
  A1: "bg-slate-gray/15 text-slate-gray border-slate-gray/40",
  A0: "bg-signal-green/8 text-signal-green/80 border-signal-green/30",
  REJECTION: "bg-signal-red/20 text-signal-red border-signal-red/50",
};

function HeaderCell({ k, label, sort, dir, onSort, align = "left" }: {
  k: SortKey; label: string; sort: SortKey; dir: SortDir; onSort: (k: SortKey) => void; align?: "left" | "right";
}) {
  const active = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={`flex items-center gap-1 text-[9px] uppercase tracking-wider transition-colors ${active ? "text-neon-blue" : "text-slate-gray hover:text-soft-white"} ${align === "right" ? "ml-auto" : ""}`}
      data-testid={`button-sort-${k}`}
    >
      <span>{label}</span>
      {active ? (dir === "asc" ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />) : <ChevronsUpDown className="w-2.5 h-2.5 opacity-50" />}
    </button>
  );
}

export default function ScoringDashboard({ className = "" }: { className?: string }) {
  const symbols = useWatchlistSymbols();
  const rows = useWatchlistCandles(symbols, "1D");
  const [sort, setSort] = usePersistentState<SortKey>("scoring-sort-key", "aScore");
  const [dir, setDir] = usePersistentState<SortDir>("scoring-sort-dir", "desc");
  const [modal, setModal] = useState<string | null>(null);

  const onSort = (k: SortKey) => {
    if (k === sort) setDir(d => d === "asc" ? "desc" : "asc");
    else { setSort(k); setDir(k === "symbol" ? "asc" : "desc"); }
  };

  // Strongly-typed sort comparator. `symbol` returns string; every other key
  // returns number. The discriminated return lets us compare without `as any`.
  const sortValue = useCallback((r: WatchlistRow): string | number => {
    switch (sort) {
      case "symbol":      return r.symbol;
      case "aScore":      return r.aScore?.numeric ?? -99;
      case "dist":        return r.distToSma20Pct ?? 0;
      case "trend":       return TREND_RANK(r);
      case "atr":         return r.atr14 ?? 0;
      case "lastUpdated": return r.lastUpdated ?? 0;
    }
  }, [sort]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = sortValue(a);
      const vb = sortValue(b);
      if (typeof va === "string" && typeof vb === "string") {
        return dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = typeof va === "number" ? va : 0;
      const nb = typeof vb === "number" ? vb : 0;
      return dir === "asc" ? na - nb : nb - na;
    });
    return arr;
  }, [rows, dir, sortValue]);

  // Stable handler so memoized rows don't invalidate on every parent render.
  const openModal = useCallback((symbol: string) => setModal(symbol), []);
  const closeModal = useCallback(() => setModal(null), []);

  if (symbols.length === 0) {
    return (
      <div className={`text-[11px] uppercase tracking-wider text-slate-gray py-4 text-center ${className}`}>
        No watchlist tickers yet
      </div>
    );
  }

  return (
    <>
      <div className={`overflow-x-auto ${className}`}>
        <table className="w-full text-[11px] font-mono-num">
          <thead>
            <tr className="border-b border-ink-line/60">
              <th className="text-left  px-2 py-1.5"><HeaderCell k="symbol"      label="Ticker"  sort={sort} dir={dir} onSort={onSort} /></th>
              <th className="text-left  px-2 py-1.5"><HeaderCell k="aScore"      label="A-Score" sort={sort} dir={dir} onSort={onSort} /></th>
              <th className="text-right px-2 py-1.5"><HeaderCell k="dist"        label="Δ SMA20" sort={sort} dir={dir} onSort={onSort} align="right" /></th>
              <th className="text-left  px-2 py-1.5"><HeaderCell k="trend"       label="Trend"   sort={sort} dir={dir} onSort={onSort} /></th>
              <th className="text-right px-2 py-1.5"><HeaderCell k="atr"         label="ATR14"   sort={sort} dir={dir} onSort={onSort} align="right" /></th>
              <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-wider text-slate-gray">Last</th>
              <th className="text-right px-2 py-1.5"><HeaderCell k="lastUpdated" label="Updated" sort={sort} dir={dir} onSort={onSort} align="right" /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <ScoringRow key={r.symbol} row={r} onSelect={openModal} />
            ))}
          </tbody>
        </table>
      </div>
      <FullChartModal
        open={!!modal}
        symbol={modal || ""}
        defaultInterval="1D"
        onClose={closeModal}
      />
    </>
  );
}

// ─── Memoized row ────────────────────────────────────────────────────────────
// Re-renders only when the row's own fields change. The parent passes a
// stable onSelect callback so identity doesn't bust memo.
interface ScoringRowProps { row: WatchlistRow; onSelect: (symbol: string) => void }

const ScoringRow = memo(function ScoringRow({ row: r, onSelect }: ScoringRowProps) {
  const trend = trendLabel(r);
  const score = r.aScore?.score ?? "A1";
  const tone = ASCORE_TONE[score] || ASCORE_TONE.A1;
  const dist = r.distToSma20Pct;
  const distTone =
    dist == null ? "text-slate-gray" :
    Math.abs(dist) <= 0.2 ? "text-signal-amber" :
    dist >= 0 ? "text-signal-green" : "text-signal-red";
  return (
    <tr
      onClick={() => onSelect(r.symbol)}
      className="border-b border-ink-line/30 hover:bg-ink-line/20 cursor-pointer transition-colors"
      data-testid={`scoring-row-${r.symbol}`}
    >
      <td className="px-2 py-1.5 font-semibold uppercase tracking-wider text-soft-white">{r.symbol}</td>
      <td className="px-2 py-1.5">
        <span
          className={`inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider border rounded-sm ${tone}`}
          title={r.aScore?.tooltip}
        >{r.aScore?.label ?? "—"}</span>
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${distTone}`} title="Distance from SMA20 — negative means price is below the 20-day moving average.">
        {dist == null ? "—" : `${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%`}
      </td>
      <td className={`px-2 py-1.5 text-[10px] uppercase tracking-wider ${trend.tone}`}>{trend.text}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-soft-white/70" title="Average True Range (14) — typical daily move in dollars.">
        {r.atr14 != null ? r.atr14.toFixed(2) : "—"}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-soft-white">{r.lastPrice != null ? `$${r.lastPrice.toFixed(2)}` : "—"}</td>
      <td className="px-2 py-1.5 text-right text-[10px] text-slate-gray">
        {r.lastUpdated ? new Date(r.lastUpdated).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
      </td>
    </tr>
  );
});
