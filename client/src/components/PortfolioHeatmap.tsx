// ─────────────────────────────────────────────────────────────────────────────
// PortfolioHeatmap.tsx
// Compact div-grid heatmap of the entire watchlist. Cell color = A-score tier
// (REJ red · A0 muted · A2 amber · A3 amber-strong · A4 green). Tooltip shows
// ticker, A-score, SMA20 distance %, last price. Click opens FullChartModal.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useState } from "react";
import FullChartModal from "@/components/FullChartModal";
import type { AScore } from "@/lib/sma";
import { useWatchlistSymbols, useWatchlistCandles, type WatchlistRow } from "@/lib/useWatchlistCandles";

// Heatmap color tiers — keyed on A-score for instant scanability.
function cellTone(score: AScore | undefined): string {
  switch (score) {
    case "A4":        return "bg-signal-green/30 border-signal-green/60 text-signal-green hover:bg-signal-green/45";
    case "A3":        return "bg-signal-amber/30 border-signal-amber/60 text-signal-amber hover:bg-signal-amber/45";
    case "A2":        return "bg-signal-amber/15 border-signal-amber/40 text-signal-amber hover:bg-signal-amber/30";
    case "REJECTION": return "bg-signal-red/30 border-signal-red/60 text-signal-red hover:bg-signal-red/45";
    case "A0":        return "bg-signal-green/8 border-ink-line/60 text-soft-white/70 hover:bg-signal-green/15";
    default:          return "bg-ink-line/15 border-ink-line/40 text-slate-gray";
  }
}

// Verbose phase label — mirrors MiniChartWidget so the heatmap reads at a glance.
const PHASE_LABEL: Record<string, string> = {
  A0: "CLEAR",
  A1: "—",
  A2: "APPROACHING",
  A3: "TOUCHING",
  A4: "BOUNCE",
  REJECTION: "REJECTION",
};

// ─── Memoized cell ──────────────────────────────────────────────────
// Only re-renders when one of the props it cares about changes. Identity of
// the click handler is also stable thanks to useCallback in the parent.
interface CellProps {
  symbol: string;
  scoreLabel: string;
  score: AScore | undefined;
  lastPrice: number | undefined;
  sma20: number | undefined;
  distPct: number | undefined;
  tooltip: string;
  onClick: (symbol: string) => void;
}

const HeatmapCell = memo(function HeatmapCell({
  symbol, score, scoreLabel, lastPrice, sma20, distPct, tooltip, onClick,
}: CellProps) {
  const tone = cellTone(score);
  const distStr = distPct != null ? `${distPct >= 0 ? "+" : ""}${distPct.toFixed(1)}%` : null;
  const phase = score ? PHASE_LABEL[score] ?? "" : "";
  return (
    <button
      type="button"
      onClick={() => onClick(symbol)}
      title={tooltip}
      data-testid={`heatmap-cell-${symbol}`}
      className={`flex flex-col items-stretch justify-center gap-0.5 p-2 border rounded-sm transition-colors cursor-pointer text-left ${tone}`}
    >
      {/* Top row: symbol + A-score code */}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[12px] font-mono-num font-semibold uppercase tracking-wider">{symbol}</span>
        <span className="text-[9px] font-mono-num uppercase tracking-wider opacity-90">{scoreLabel}</span>
      </div>
      {/* Phase — the verbose meaning of the A-score */}
      {phase && (
        <div className="text-[8.5px] font-mono-num uppercase tracking-wider opacity-90">{phase}</div>
      )}
      {/* Prices: current price · SMA20 · distance % */}
      <div className="flex items-baseline justify-between gap-1 text-[10px] font-mono-num tabular-nums">
        <span className="opacity-95">{lastPrice != null ? `$${lastPrice.toFixed(2)}` : "—"}</span>
        <span className="opacity-70">SMA20 {sma20 != null ? sma20.toFixed(2) : "—"}</span>
      </div>
      {distStr && (
        <div className="text-[9px] font-mono-num tabular-nums opacity-85">
          {distStr} from SMA20
        </div>
      )}
    </button>
  );
});

function buildTooltip(r: WatchlistRow): string {
  if (r.loading) return `${r.symbol} · loading…`;
  if (r.empty)   return `${r.symbol} · no data`;
  const dist = r.distToSma20Pct;
  const distStr = dist != null ? `${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%` : "—";
  const price = r.lastPrice != null ? `$${r.lastPrice.toFixed(2)}` : "—";
  return `${r.symbol} · ${r.aScore?.label ?? "—"} · ${distStr} from SMA20 · ${price}`;
}

export default function PortfolioHeatmap({ className = "" }: { className?: string }) {
  const symbols = useWatchlistSymbols();
  const rows = useWatchlistCandles(symbols, "1D");
  const [modal, setModal] = useState<string | null>(null);

  // Stable click handler — keeps memoized cells from invalidating.
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
      <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 ${className}`}>
        {rows.map(r => (
          <HeatmapCell
            key={r.symbol}
            symbol={r.symbol}
            score={r.aScore?.score}
            scoreLabel={r.aScore?.label ?? "—"}
            lastPrice={r.lastPrice}
            sma20={r.sma20}
            distPct={r.distToSma20Pct}
            tooltip={buildTooltip(r)}
            onClick={openModal}
          />
        ))}
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
