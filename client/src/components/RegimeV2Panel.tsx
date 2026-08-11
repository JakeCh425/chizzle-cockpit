// ─── RegimeV2Panel ─────────────────────────────────────────────────────────
// Displays the Chizzle regime engine v2 output (VIX + breadth + distribution).
// Compact strip: overall band, three sub-bands, and per-symbol breadth chips.
// Renders "Unknown" instead of hiding when data is missing (spec rule).

import { useQuery } from "@tanstack/react-query";

type Band = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";

interface RegimeV2Snapshot {
  day_class: Band;
  reason: string;
  vix: { last: number | null; band: Band };
  breadth: { pct_above_20sma: number | null; universe_size: number; band: Band };
  distribution: { days_last_25: number | null; band: Band };
  detail: Array<{ ticker: string; last: number; sma20: number; above: boolean }>;
  computed_at: string;
}

const BAND_STYLES: Record<Band, { bg: string; text: string; border: string }> = {
  GREEN: { bg: "bg-signal-green/10", text: "text-signal-green", border: "border-signal-green" },
  YELLOW: { bg: "bg-signal-amber/10", text: "text-signal-amber", border: "border-signal-amber" },
  RED: { bg: "bg-signal-red/10", text: "text-signal-red", border: "border-signal-red" },
  UNKNOWN: { bg: "bg-ink-line", text: "text-slate-gray", border: "border-ink-line" },
};

function fmt(v: number | null, dp = 2): string {
  return v == null || !Number.isFinite(v) ? "Unknown" : v.toFixed(dp);
}

export default function RegimeV2Panel() {
  const q = useQuery<RegimeV2Snapshot>({
    queryKey: ["/api/regime-v2"],
    refetchInterval: 60_000,
  });

  const snap = q.data;
  if (q.isLoading || !snap) {
    return (
      <div className="rounded-md border border-ink-line bg-ink-black p-3">
        <div className="text-xs text-slate-gray">Loading regime...</div>
      </div>
    );
  }

  const style = BAND_STYLES[snap.day_class];
  return (
    <div className={`rounded-md border ${style.border} ${style.bg} p-3 space-y-2`} data-testid="section-regime-v2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${style.text}`}>REGIME: {snap.day_class}</span>
        </div>
        <span className="text-[10px] text-slate-gray">
          {new Date(snap.computed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      </div>
      <div className="text-xs text-soft-white leading-snug">{snap.reason}</div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className={`rounded border ${BAND_STYLES[snap.vix.band].border} bg-ink-deep p-2`}>
          <div className="text-slate-gray text-[10px] uppercase">VIX</div>
          <div className={`font-mono font-bold ${BAND_STYLES[snap.vix.band].text}`}>{fmt(snap.vix.last, 2)}</div>
          <div className="text-[10px] text-slate-gray mt-0.5">
            {snap.vix.band === "GREEN" ? "< 22" : snap.vix.band === "YELLOW" ? "22–26" : snap.vix.band === "RED" ? "> 26" : "Unknown"}
          </div>
        </div>
        <div className={`rounded border ${BAND_STYLES[snap.breadth.band].border} bg-ink-deep p-2`}>
          <div className="text-slate-gray text-[10px] uppercase">Breadth</div>
          <div className={`font-mono font-bold ${BAND_STYLES[snap.breadth.band].text}`}>
            {fmt(snap.breadth.pct_above_20sma, 0)}%
          </div>
          <div className="text-[10px] text-slate-gray mt-0.5">
            {snap.breadth.universe_size} symbols
          </div>
        </div>
        <div className={`rounded border ${BAND_STYLES[snap.distribution.band].border} bg-ink-deep p-2`}>
          <div className="text-slate-gray text-[10px] uppercase">Distribution</div>
          <div className={`font-mono font-bold ${BAND_STYLES[snap.distribution.band].text}`}>
            {snap.distribution.days_last_25 ?? "Unknown"}
          </div>
          <div className="text-[10px] text-slate-gray mt-0.5">last 25 SPY days</div>
        </div>
      </div>

      {snap.detail.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {snap.detail.map((d) => (
            <span
              key={d.ticker}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                d.above ? "border-signal-green text-signal-green" : "border-signal-red text-signal-red"
              }`}
              title={`${d.ticker} $${d.last.toFixed(2)} vs 20-SMA $${d.sma20.toFixed(2)}`}
            >
              {d.ticker} {d.above ? "↑" : "↓"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
