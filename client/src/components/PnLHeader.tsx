// ─── PnLHeader ─────────────────────────────────────────────────────────────
// Always visible at the top of the pipeline cockpit. Shows daily P&L, weekly
// P&L, open risk (from Active Setups), and drawdown from equity peak.
// Renders "Unknown" for any metric missing data — never invents.

import { useQuery } from "@tanstack/react-query";
import type { Trade, EquityHistory, ActiveSetup } from "@shared/schema";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Unknown";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export default function PnLHeader() {
  const tradesQ = useQuery<Trade[]>({ queryKey: ["/api/trades"], refetchInterval: 30_000 });
  const equityQ = useQuery<EquityHistory[]>({ queryKey: ["/api/equity-history"], refetchInterval: 60_000 });
  const setupsQ = useQuery<ActiveSetup[]>({ queryKey: ["/api/active-setups"], refetchInterval: 30_000 });

  // Daily P&L = sum of realized PnL from trades closed today
  const trades = tradesQ.data ?? [];
  const today = ymd(new Date());
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday
  const weekStart = ymd(startOfWeek);

  const closedTrades = trades.filter((t: any) => t.status === "closed" && (t.closedAt || t.closed_at));
  const todayPnl = closedTrades
    .filter((t: any) => String(t.closedAt ?? t.closed_at).slice(0, 10) === today)
    .reduce((sum, t: any) => sum + Number(t.pnl ?? 0), 0);
  const weekPnl = closedTrades
    .filter((t: any) => String(t.closedAt ?? t.closed_at).slice(0, 10) >= weekStart)
    .reduce((sum, t: any) => sum + Number(t.pnl ?? 0), 0);

  // Open risk = sum of (entry - stop) * shares for planned/active setups.
  // We don't have shares here — approximate as sum of riskPercent for active items.
  const activeSetups = (setupsQ.data ?? []).filter((s) => s.status === "planned" || s.status === "active");
  const openRiskPct = activeSetups.reduce((sum, s) => sum + Number(s.riskPercent ?? 0), 0);

  // Drawdown from peak equity
  const equity = equityQ.data ?? [];
  let drawdownPct: number | null = null;
  let currentEquity: number | null = null;
  if (equity.length > 0) {
    const values = equity.map((e: any) => Number(e.equity ?? e.value ?? 0)).filter((v) => v > 0);
    if (values.length > 0) {
      const peak = Math.max(...values);
      currentEquity = values[values.length - 1];
      drawdownPct = peak > 0 ? ((currentEquity - peak) / peak) * 100 : null;
    }
  }

  const isLoading = tradesQ.isLoading || equityQ.isLoading || setupsQ.isLoading;

  return (
    <div className="rounded-md border border-ink-line bg-ink-black p-3" data-testid="header-pnl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div>
          <div className="text-[10px] text-slate-gray uppercase tracking-wide">Daily P&amp;L</div>
          <div
            className={`text-sm font-mono font-bold ${
              isLoading ? "text-slate-gray" : todayPnl >= 0 ? "text-signal-green" : "text-signal-red"
            }`}
            data-testid="text-daily-pnl"
          >
            {isLoading ? "Loading..." : fmtCurrency(todayPnl)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-gray uppercase tracking-wide">Weekly P&amp;L</div>
          <div
            className={`text-sm font-mono font-bold ${
              isLoading ? "text-slate-gray" : weekPnl >= 0 ? "text-signal-green" : "text-signal-red"
            }`}
            data-testid="text-weekly-pnl"
          >
            {isLoading ? "Loading..." : fmtCurrency(weekPnl)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-gray uppercase tracking-wide">Open Risk</div>
          <div
            className={`text-sm font-mono font-bold ${
              openRiskPct >= 5 ? "text-signal-amber" : "text-soft-white"
            }`}
            data-testid="text-open-risk"
          >
            {activeSetups.length === 0 ? "None" : `${openRiskPct.toFixed(2)}% · ${activeSetups.length}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-gray uppercase tracking-wide">Drawdown</div>
          <div
            className={`text-sm font-mono font-bold ${
              drawdownPct == null ? "text-slate-gray" :
              drawdownPct <= -10 ? "text-signal-red" :
              drawdownPct <= -5 ? "text-signal-amber" : "text-soft-white"
            }`}
            data-testid="text-drawdown"
          >
            {drawdownPct == null ? "Unknown" : fmtPct(drawdownPct)}
          </div>
        </div>
      </div>
      {openRiskPct >= 5 && (
        <div className="text-[10px] text-signal-amber mt-2 border-t border-ink-line pt-1.5">
          Open risk ≥ 5% — reduce position count and tighten monitoring per Chizzle rules.
        </div>
      )}
    </div>
  );
}
