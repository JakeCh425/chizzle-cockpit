// ─────────────────────────────────────────────────────────────────────────────
// ContinuationMonitor.tsx
//
// Catches the rallies the single-bar Multi-Pattern Monitor misses:
//   - Follow-through Green Run  (>=2 green bars from SMA20 touch, rising closes)
//   - V-Bottom Continuation     (reversal bar + follow-through)
//   - SMA20 Bounce              (looser aggressive bounce, no volume gate)
//
// Stop placement uses "whichever gives >=1.5% risk" so the trade isn't
// immediately knocked out by noise.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatShares } from "@/lib/engine";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";
import { buildPlannerHref } from "@/lib/planLink";

type Timeframe = "1h" | "4h";
type Rr = 2 | 3 | 4 | 5;

type ContinuationPattern = "Follow-through Green Run" | "V-Bottom Continuation" | "SMA20 Bounce";

interface SymbolState {
  symbol: string;
  timeframe: Timeframe;
  price: number;
  daily_sma20: number;
  distance_from_sma20_percent: number;
  near_support: boolean;
  sma20_touched_recently: boolean;
  green_run_length: number;
  setup_origin_bars_ago: number | null;
  status: string;
  pattern: ContinuationPattern | null;
  entry_mode: "Flexible" | "Aggressive" | null;
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
}

interface Response {
  timeframe: Timeframe;
  rr: number;
  min_risk_percent: number;
  asof: string;
  symbols: SymbolState[];
}

const DEFAULT_SYMBOLS = "SMH,QQQ,SPY,AAPL";

function statusColor(s: string): string {
  if (s === "Ready to Trade") return "bg-signal-green/20 text-signal-green border-signal-green/40";
  if (s.endsWith("Forming")) return "bg-signal-amber/20 text-signal-amber border-signal-amber/40";
  if (s === "Signal Expired") return "bg-slate-gray/20 text-slate-gray border-slate-gray/40";
  return "bg-slate-gray/10 text-slate-gray border-slate-gray/30";
}

function entryModeBadge(m: "Flexible" | "Aggressive" | null): string {
  if (m === "Flexible") return "bg-signal-amber/15 text-signal-amber border-signal-amber/40";
  if (m === "Aggressive") return "bg-signal-red/15 text-signal-red border-signal-red/40";
  return "bg-slate-gray/10 text-slate-gray border-slate-gray/30";
}

function patternBadge(p: ContinuationPattern | null): string {
  // short label fits in column without truncation
  if (p === "Follow-through Green Run") return "Green Run";
  if (p === "V-Bottom Continuation") return "V-Cont";
  if (p === "SMA20 Bounce") return "SMA20 Bnc";
  return "—";
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function ContinuationMonitor() {
  // Default 4H since Jake's miss was on 4H V-rallies
  const [timeframe, setTimeframe] = useState<Timeframe>("4h");
  const [rr, setRr] = useState<Rr>(2);
  const [minRiskPct, setMinRiskPct] = useState<number>(1.5);
  const sharesCtx = useSharesContext();

  const { data, isLoading, error, isFetching, refetch } = useQuery<Response>({
    queryKey: ["/api/continuation-monitor", timeframe, rr, minRiskPct],
    queryFn: () =>
      apiRequest(
        "GET",
        `/api/continuation-monitor?timeframe=${timeframe}&rr=${rr}&min_risk_pct=${minRiskPct}&symbols=${encodeURIComponent(DEFAULT_SYMBOLS)}`,
      ).then((r) => r.json()),
    refetchInterval: 90_000,
  });

  if (isLoading) return <div className="text-xs text-slate-gray py-3">Loading continuation monitor…</div>;
  if (error) return <div className="text-xs text-signal-red py-3">Error: {String((error as Error).message)}</div>;
  if (!data) return <div className="text-xs text-slate-gray py-3">No data.</div>;

  return (
    <div className="space-y-3" data-testid="continuation-monitor">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-slate-gray uppercase tracking-wide mr-1">TF</span>
          {(["1h", "4h"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTimeframe(t)}
              className={`px-2 py-0.5 rounded border ${timeframe === t ? "bg-signal-blue/20 text-signal-blue border-signal-blue/50" : "bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"}`}
              data-testid={`btn-cm-tf-${t}`}
            >
              {t.toUpperCase()}
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
              data-testid={`btn-cm-rr-${n}`}
            >
              1:{n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-gray uppercase tracking-wide mr-1">Min Risk</span>
          {[1.0, 1.5, 2.0].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setMinRiskPct(v)}
              className={`px-2 py-0.5 rounded border ${minRiskPct === v ? "bg-signal-blue/20 text-signal-blue border-signal-blue/50" : "bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"}`}
              data-testid={`btn-cm-minrisk-${v}`}
            >
              {v.toFixed(1)}%
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto px-2 py-0.5 rounded border text-xs bg-pearl/5 text-slate-gray border-slate-gray/40 hover:bg-pearl/10"
          data-testid="btn-cm-refresh"
        >
          {isFetching ? "…" : "Refresh"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" data-testid="table-continuation">
          <thead>
            <tr className="text-slate-gray text-[10px] uppercase tracking-wide border-b border-slate-gray/30">
              <th className="text-left py-1 pr-2">Ticker</th>
              <th className="text-right py-1 px-2">Price</th>
              <th className="text-right py-1 px-2">SMA20</th>
              <th className="text-right py-1 px-2">Δ%</th>
              <th className="text-center py-1 px-2">Touch?</th>
              <th className="text-right py-1 px-2">Run</th>
              <th className="text-left py-1 px-2">Pattern</th>
              <th className="text-left py-1 px-2">Status</th>
              <th className="text-left py-1 px-2">Mode</th>
              <th className="text-right py-1 px-2">Entry</th>
              <th className="text-right py-1 px-2">Stop</th>
              <th className="text-right py-1 px-2">Target</th>
              <th className="text-right py-1 px-2">Shares</th>
              <th className="text-left py-1 pl-2">Notes</th>
              <th className="text-right py-1 pl-2 pr-1">Plan</th>
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
              const touchCls = s.sma20_touched_recently ? "text-signal-green" : "text-slate-gray";
              return (
                <tr
                  key={s.symbol}
                  className="border-b border-slate-gray/15 hover:bg-pearl/5"
                  data-testid={`row-cm-${s.symbol}`}
                >
                  <td className="py-1 pr-2 font-semibold text-soft-white">{s.symbol}</td>
                  <td className="text-right px-2">${fmt(s.price)}</td>
                  <td className="text-right px-2">${fmt(s.daily_sma20)}</td>
                  <td className={`text-right px-2 ${distCls}`}>{fmt(s.distance_from_sma20_percent)}%</td>
                  <td className={`text-center px-2 ${touchCls}`}>
                    {s.sma20_touched_recently
                      ? (s.setup_origin_bars_ago != null ? `${s.setup_origin_bars_ago}b` : "✓")
                      : "—"}
                  </td>
                  <td className="text-right px-2 text-signal-blue">{s.green_run_length}</td>
                  <td className="px-2 text-soft-white">{patternBadge(s.pattern)}</td>
                  <td className="px-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${statusColor(s.status)}`}>
                      {s.status}
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
                  <td className="text-right px-2 text-signal-blue font-semibold" title={sharesTitle} data-testid={`text-cm-shares-${s.symbol}`}>
                    {sharesVal}
                  </td>
                  <td className="pl-2 text-slate-gray text-[11px] max-w-[260px] truncate" title={s.notes}>{s.notes}</td>
                  <td className="pl-2 pr-1 text-right">
                    {s.trade_plan && s.pattern ? (
                      <Link
                        href={buildPlannerHref({
                          ticker: s.symbol,
                          entry: s.trade_plan.entry,
                          stop: s.trade_plan.stop_loss,
                          target: s.trade_plan.target,
                          setup: s.pattern,
                          direction: "long",
                        })}
                        className="inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wide bg-neon-blue/10 text-neon-blue border-neon-blue/40 hover:bg-neon-blue/20"
                        data-testid={`btn-cm-plan-${s.symbol}`}
                        title="Pre-fill Trade Planner with this setup"
                      >
                        Plan
                      </Link>
                    ) : (
                      <span className="text-slate-gray text-[10px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {data.symbols.length === 0 && (
              <tr><td colSpan={15} className="text-center text-slate-gray py-4">No data returned.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-gray uppercase tracking-wide">
        <span>
          Catches multi-bar V-runs · 5-bar lookback · auto-expires after 4 bars · min risk {data.min_risk_percent.toFixed(1)}%
        </span>
        <span>asof {new Date(data.asof).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
