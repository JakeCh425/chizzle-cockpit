// ─────────────────────────────────────────────────────────────────────────────
// MultiPatternMonitor.tsx
//
// Scans the watchlist for 4 reversal patterns on 1H or 4H bars:
//   - Hammer  (Core)
//   - Bullish Engulfing  (Core)
//   - Strong Bull Bar after cluster of lows  (Flexible)
//   - Aggressive Bounce / V-reversal after sharp selloff  (Aggressive)
//
// Each row shows pattern status, near-SMA20 location flag, the trigger /
// invalidation levels, and a live share count using the existing day-color
// risk profile.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatShares } from "@/lib/engine";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";

type Timeframe = "1h" | "4h";
type Mode = "conservative" | "aggressive";
type Rr = 2 | 3 | 4 | 5;

type EntryMode = "Core" | "Flexible" | "Aggressive";
type PatternType = "Hammer" | "Bullish Engulfing" | "Strong Bull Bar" | "Aggressive Bounce";

interface SymbolState {
  symbol: string;
  timeframe: Timeframe;
  mode: Mode;
  price: number;
  daily_sma20: number;
  distance_from_sma20_percent: number;
  near_support: boolean;
  short_term_decline: boolean;
  cluster_of_lows: boolean;
  sharp_selloff: boolean;
  elevated_volume: boolean;
  pattern_status: string;
  pattern: PatternType | null;
  entry_mode: EntryMode | null;
  trigger_price: number | null;
  invalidation_price: number | null;
  notes: string;
  trade_plan: {
    entry: number;
    stop_loss: number;
    risk_per_share: number;
    target: number;
    reward_per_share: number;
    risk_reward: number;
  } | null;
  asof: string;
  bar_count: number;
}

interface Response {
  timeframe: Timeframe;
  mode: Mode;
  rr: number;
  asof: string;
  symbols: SymbolState[];
}

const DEFAULT_SYMBOLS = "SMH,QQQ,SPY,AAPL";

function statusColor(s: string): string {
  if (s === "Ready to Trade") return "bg-signal-green/20 text-signal-green border-signal-green/40";
  if (s.startsWith("Confirmed")) return "bg-signal-blue/20 text-signal-blue border-signal-blue/40";
  if (s.endsWith("Forming")) return "bg-signal-amber/20 text-signal-amber border-signal-amber/40";
  if (s === "Signal Expired") return "bg-slate-gray/20 text-slate-gray border-slate-gray/40";
  return "bg-slate-gray/10 text-slate-gray border-slate-gray/30";
}

function entryModeBadge(m: EntryMode | null): string {
  if (m === "Core") return "bg-signal-blue/15 text-signal-blue border-signal-blue/40";
  if (m === "Flexible") return "bg-signal-amber/15 text-signal-amber border-signal-amber/40";
  if (m === "Aggressive") return "bg-signal-red/15 text-signal-red border-signal-red/40";
  return "bg-slate-gray/10 text-slate-gray border-slate-gray/30";
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function MultiPatternMonitor() {
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [mode, setMode] = useState<Mode>("conservative");
  const [rr, setRr] = useState<Rr>(2);
  const sharesCtx = useSharesContext();

  const { data, isLoading, error, isFetching, refetch } = useQuery<Response>({
    queryKey: ["/api/multi-pattern-monitor", timeframe, mode, rr],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/multi-pattern-monitor?timeframe=${timeframe}&mode=${mode}&rr=${rr}&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 90_000,
  });

  if (isLoading) return <div className="text-xs text-slate-gray py-3">Loading multi-pattern monitor…</div>;
  if (error) return <div className="text-xs text-signal-red py-3">Error: {String((error as Error).message)}</div>;
  if (!data) return <div className="text-xs text-slate-gray py-3">No data.</div>;

  return (
    <div className="space-y-3" data-testid="multi-pattern-monitor">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1" role="tablist" aria-label="Timeframe">
          <span className="text-slate-gray uppercase tracking-wide mr-1">TF</span>
          {(["1h", "4h"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTimeframe(t)}
              className={`px-2 py-0.5 rounded border ${timeframe === t ? "bg-signal-blue/20 text-signal-blue border-signal-blue/50" : "bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"}`}
              data-testid={`btn-mp-tf-${t}`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-gray uppercase tracking-wide mr-1">Mode</span>
          {(["conservative", "aggressive"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded border ${mode === m ? "bg-signal-blue/20 text-signal-blue border-signal-blue/50" : "bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"}`}
              data-testid={`btn-mp-mode-${m}`}
            >
              {m === "conservative" ? "Cons." : "Agg."}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-gray uppercase tracking-wide mr-1">Target R:R</span>
          {[2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRr(n as Rr)}
              className={`px-2 py-0.5 rounded border ${rr === n ? "bg-signal-blue/20 text-signal-blue border-signal-blue/50" : "bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"}`}
              data-testid={`btn-mp-rr-${n}`}
            >
              1:{n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto px-2 py-0.5 rounded border text-xs bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"
          data-testid="btn-mp-refresh"
        >
          {isFetching ? "…" : "Refresh"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" data-testid="table-multi-pattern">
          <thead>
            <tr className="text-slate-gray text-[10px] uppercase tracking-wide border-b border-slate-gray/30">
              <th className="text-left py-1 pr-2">Ticker</th>
              <th className="text-right py-1 px-2">Price</th>
              <th className="text-right py-1 px-2">SMA20</th>
              <th className="text-right py-1 px-2">Δ%</th>
              <th className="text-left py-1 px-2">Status</th>
              <th className="text-left py-1 px-2">Entry Mode</th>
              <th className="text-right py-1 px-2">Trigger</th>
              <th className="text-right py-1 px-2">Stop</th>
              <th className="text-right py-1 px-2">Target</th>
              <th className="text-right py-1 px-2">Shares</th>
              <th className="text-left py-1 pl-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.symbols.map((s) => {
              const rps = s.trade_plan?.risk_per_share ?? 0;
              const shares = sharesForPlan(sharesCtx, rps);
              const sharesVal = sharesCtx.equity > 0 && rps > 0 ? formatShares(shares) : "—";
              const sharesTitle = rps > 0
                ? `${sharesCtx.regime} day · ${(sharesCtx.riskPct * 100).toFixed(2)}% of $${sharesCtx.equity.toFixed(2)} ÷ $${rps.toFixed(2)}/sh`
                : undefined;
              const distCls = s.near_support ? "text-signal-green" : "text-slate-gray";
              return (
                <tr
                  key={s.symbol}
                  className="border-b border-slate-gray/15 hover:bg-pearl/5"
                  data-testid={`row-mp-${s.symbol}`}
                >
                  <td className="py-1 pr-2 font-semibold text-soft-white">{s.symbol}</td>
                  <td className="text-right px-2">${fmt(s.price)}</td>
                  <td className="text-right px-2">${fmt(s.daily_sma20)}</td>
                  <td className={`text-right px-2 ${distCls}`} title={s.near_support ? "Within SMA20 band" : "Outside SMA20 band"}>
                    {fmt(s.distance_from_sma20_percent)}%
                  </td>
                  <td className="px-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${statusColor(s.pattern_status)}`}>
                      {s.pattern_status}
                    </span>
                  </td>
                  <td className="px-2">
                    {s.entry_mode ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${entryModeBadge(s.entry_mode)}`}>
                        {s.entry_mode}
                      </span>
                    ) : (
                      <span className="text-slate-gray">—</span>
                    )}
                  </td>
                  <td className="text-right px-2 text-signal-green">{s.trade_plan ? `$${fmt(s.trade_plan.entry)}` : "—"}</td>
                  <td className="text-right px-2 text-signal-red">{s.trade_plan ? `$${fmt(s.trade_plan.stop_loss)}` : "—"}</td>
                  <td className="text-right px-2 text-signal-green">{s.trade_plan ? `$${fmt(s.trade_plan.target)}` : "—"}</td>
                  <td className="text-right px-2 text-signal-blue font-semibold" title={sharesTitle} data-testid={`text-mp-shares-${s.symbol}`}>
                    {sharesVal}
                  </td>
                  <td className="pl-2 text-slate-gray text-[11px] max-w-[280px] truncate" title={s.notes}>{s.notes}</td>
                </tr>
              );
            })}
            {data.symbols.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center text-slate-gray py-4">No data returned.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-gray uppercase tracking-wide">
        <span>
          Location filter: ±2% from daily SMA20 · Patterns: Hammer · Engulfing · Bull Bar · Aggressive Bounce
        </span>
        <span>asof {new Date(data.asof).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
