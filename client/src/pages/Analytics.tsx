// ─── Phase 4: Analytics dashboard ────────────────────────────────────────────
// Reads the unified closed-trades feed from /api/analytics/trades. Server
// applies the date filter; everything else is filtered + computed client-side.
//
// Layout:
//   1. Header + filter bar
//   2. 13 KPI cards (2 rows)
//   3. Equity curve + drawdown (recharts, area + line)
//   4. R-distribution histogram
//   5. Four breakdown tables (ticker / setup / tag / followedPlan)
//   6. Time-bucket breakdown (month / week / day toggle)

import { useMemo, useState } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";
import { Panel } from "@/components/Panel";
import { AnalyticsFilters } from "@/components/AnalyticsFilters";
import {
  applyFilters,
  computeCoreMetrics,
  computeEquityCurve,
  computeRDistribution,
  computeBreakdown,
  fmtUsd, fmtPct, fmtR, fmtFactor, fmtDays,
} from "@/lib/analytics";
import type {
  UnifiedTrade,
  AnalyticsFilters as AnalyticsFiltersT,
  BreakdownDimension,
  BreakdownRow,
} from "@shared/analytics";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const [filters, setFilters] = useState<AnalyticsFiltersT>({});

  // Server-side filter only carries the date range; other filters apply
  // client-side without a refetch. The query key includes from/to so date
  // changes trigger a refetch.
  const qs = new URLSearchParams();
  if (filters.from) qs.set("from", filters.from);
  if (filters.to)   qs.set("to", filters.to);
  const queryString = qs.toString();

  const { data: trades = [], isLoading, isError } = useQuery<UnifiedTrade[]>({
    queryKey: ["/api/analytics/trades", filters.from ?? null, filters.to ?? null],
    queryFn: async () => {
      const res = await fetch("/api/analytics/trades" + (queryString ? `?${queryString}` : ""));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  // Distinct values for selects — taken from the loaded dataset so we never
  // present a filter value that yields zero rows.
  const options = useMemo(() => {
    const tickers = new Set<string>();
    const setupMap = new Map<string, string>();
    const tags = new Set<string>();
    for (const t of trades) {
      if (t.ticker) tickers.add(t.ticker);
      if (t.setupType) setupMap.set(t.setupType, t.setupTypeRaw || t.setupType);
      for (const tag of t.tags) tags.add(tag);
    }
    return {
      tickers: Array.from(tickers).sort(),
      setups: Array.from(setupMap.entries()).map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      tags: Array.from(tags).sort(),
    };
  }, [trades]);

  // The filtered dataset is the input to every calc on the page.
  const filtered = useMemo(() => applyFilters(trades, filters), [trades, filters]);
  const metrics  = useMemo(() => computeCoreMetrics(filtered), [filtered]);
  const curve    = useMemo(() => computeEquityCurve(filtered), [filtered]);
  const rDist    = useMemo(() => computeRDistribution(filtered), [filtered]);
  const byTicker = useMemo(() => computeBreakdown(filtered, "ticker"), [filtered]);
  const bySetup  = useMemo(() => computeBreakdown(filtered, "setup"), [filtered]);
  const byTag    = useMemo(() => computeBreakdown(filtered, "tag"), [filtered]);
  const byPlan   = useMemo(() => computeBreakdown(filtered, "followedPlan"), [filtered]);

  return (
    <div className="p-3 md:p-4 space-y-4" data-testid="page-analytics">
      <div className="flex flex-wrap items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Analytics</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray" data-testid="text-analytics-count">
          {isLoading ? "loading…" : isError ? "error" : `${filtered.length} of ${trades.length} closed trades`}
        </span>
      </div>

      <Panel title="Filters">
        <AnalyticsFilters
          filters={filters}
          onChange={setFilters}
          options={options}
          onReset={Object.keys(filters).length ? () => setFilters({}) : undefined}
        />
      </Panel>

      {/* ─── KPI grid: 7 cards row 1, 6 cards row 2 ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPI label="Total Trades"  value={metrics.totalTrades.toString()} testId="kpi-total" />
        <KPI label="Win Rate"      value={metrics.totalTrades ? fmtPct(metrics.winRate) : "—"}
             tone={!metrics.totalTrades ? "empty" : metrics.winRate >= 0.5 ? "green" : metrics.winRate >= 0.35 ? "neutral" : "red"}
             testId="kpi-winrate" />
        <KPI label="Avg Win"       value={metrics.wins ? fmtUsd(metrics.avgWin) : "—"} tone={metrics.wins ? "green" : "empty"} testId="kpi-avgwin" />
        <KPI label="Avg Loss"      value={metrics.losses ? `−${fmtUsd(metrics.avgLoss).replace(/^[−-]/, "")}` : "—"} tone={metrics.losses ? "red" : "empty"} testId="kpi-avgloss" />
        <KPI label="Avg R:R"       value={metrics.avgRR ? metrics.avgRR.toFixed(2) : "—"} tone={metrics.avgRR >= 1.5 ? "green" : metrics.avgRR > 0 ? "neutral" : "empty"} testId="kpi-rr" />
        <KPI label="Expectancy"    value={metrics.totalTrades ? fmtUsd(metrics.expectancy, { sign: true }) : "—"} tone={metrics.expectancy > 0 ? "green" : metrics.expectancy < 0 ? "red" : "empty"} testId="kpi-expectancy" />
        <KPI label="Profit Factor" value={metrics.totalTrades ? fmtFactor(metrics.profitFactor) : "—"} tone={metrics.profitFactor >= 1.5 ? "green" : metrics.profitFactor >= 1 ? "neutral" : metrics.profitFactor > 0 ? "red" : "empty"} testId="kpi-pf" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI label="Gross P&L"     value={fmtUsd(metrics.grossPnl)} tone={metrics.grossPnl > 0 ? "green" : "empty"} testId="kpi-gross" />
        <KPI label="Net P&L"       value={fmtUsd(metrics.netPnl, { sign: true })} tone={metrics.netPnl > 0 ? "green" : metrics.netPnl < 0 ? "red" : "empty"} testId="kpi-net" />
        <KPI label="Max Drawdown"  value={metrics.maxDrawdown < 0 ? `${fmtUsd(metrics.maxDrawdown)} (${metrics.maxDrawdownPct.toFixed(1)}%)` : "—"} tone={metrics.maxDrawdown < 0 ? "red" : "empty"} testId="kpi-dd" />
        <KPI label="Avg Hold"      value={metrics.totalTrades ? fmtDays(metrics.avgHoldDays) : "—"} testId="kpi-hold" />
        <KPI label="Avg R"         value={metrics.rCounted ? fmtR(metrics.avgR) : "—"} tone={!metrics.rCounted ? "empty" : metrics.avgR >= 0.35 ? "green" : metrics.avgR >= 0 ? "neutral" : "red"} testId="kpi-avgr" />
        <KPI label="Streaks (W/L)" value={`${metrics.longestWinStreak} / ${metrics.longestLossStreak}`} testId="kpi-streaks" />
      </div>

      {/* ─── Equity + drawdown curve ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Cumulative Net P&L · Drawdown" hint={curve.length ? `${curve.length} points` : ""}>
          {curve.length === 0 ? (
            <Empty label="No closed trades in range." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={curve.map((p) => ({
                  date: p.date.slice(0, 10),
                  cum: p.cumulativePnl,
                  dd:  p.drawdown,
                }))} margin={{ top: 4, right: 12, left: -4, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                  <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${Number(v).toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--ink-panel))", border: "1px solid hsl(var(--ink-line))", fontSize: 11 }}
                    formatter={(v: number, k) => [fmtUsd(v, { sign: k === "cum" }), k === "cum" ? "Cumulative" : "Drawdown"]}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--ink-line))" />
                  <Area type="monotone" dataKey="cum" stroke="hsl(var(--neon-blue))" fill="hsl(var(--neon-blue) / 0.15)" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="dd"  stroke="hsl(var(--signal-red))" strokeWidth={1} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="R-Multiple Distribution" hint={metrics.rCounted ? `${metrics.rCounted} with R` : "no R data"}>
          {metrics.rCounted === 0 ? (
            <Empty label="No closed trades with computable R in range." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rDist}>
                  <CartesianGrid stroke="hsl(var(--ink-line))" vertical={false} />
                  <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--ink-panel))", border: "1px solid hsl(var(--ink-line))", fontSize: 11 }}
                    formatter={(v: number) => [`${v} trade${v === 1 ? "" : "s"}`, "Count"]}
                  />
                  <Bar dataKey="count" fill="hsl(var(--neon-blue))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
      </div>

      {/* ─── Breakdowns ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownPanel title="Performance by Ticker"         rows={byTicker} dim="ticker" />
        <BreakdownPanel title="Performance by Setup"          rows={bySetup}  dim="setup" />
        <BreakdownPanel title="Performance by Tag"            rows={byTag}    dim="tag" />
        <BreakdownPanel title="Performance by Plan Adherence" rows={byPlan}   dim="followedPlan" />
      </div>

      <TimeBreakdownPanel trades={filtered} />
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function KPI({
  label, value, tone, testId,
}: {
  label: string;
  value: string;
  tone?: "green" | "red" | "neutral" | "empty";
  testId?: string;
}) {
  const color =
    tone === "green" ? "text-signal-green"
    : tone === "red" ? "text-signal-red"
    : tone === "empty" ? "text-slate-gray/60"
    : "text-soft-white";
  return (
    <Panel title={label}>
      <div className={`font-mono-num text-[20px] tabular-nums leading-none ${color}`} data-testid={testId}>
        {value}
      </div>
    </Panel>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="text-[12px] text-slate-gray py-8 text-center">{label}</div>;
}

function BreakdownPanel({
  title, rows, dim,
}: {
  title: string;
  rows: BreakdownRow[];
  dim: BreakdownDimension;
}) {
  return (
    <Panel title={title} hint={rows.length ? `${rows.length} group${rows.length === 1 ? "" : "s"}` : ""}>
      {rows.length === 0 ? (
        <Empty label="No data in range." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-0" data-testid={`table-breakdown-${dim}`}>
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                <th className="text-left py-1.5 pr-2 font-normal">{labelFor(dim)}</th>
                <th className="text-right py-1.5 px-2 font-normal">N</th>
                <th className="text-right py-1.5 px-2 font-normal">Win %</th>
                <th className="text-right py-1.5 px-2 font-normal">Avg R</th>
                <th className="text-right py-1.5 px-2 font-normal">Total R</th>
                <th className="text-right py-1.5 pl-2 font-normal">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-ink-line/40">
                  <td className="py-1.5 pr-2 text-soft-white truncate max-w-[200px]" title={r.label}>{r.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-gray">{r.n}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.n ? fmtPct(r.winRate, 0) : "—"}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${r.avgR > 0 ? "text-signal-green" : r.avgR < 0 ? "text-signal-red" : ""}`}>{fmtR(r.avgR)}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${r.totalR > 0 ? "text-signal-green" : r.totalR < 0 ? "text-signal-red" : ""}`}>{fmtR(r.totalR)}</td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums ${r.netPnl > 0 ? "text-signal-green" : r.netPnl < 0 ? "text-signal-red" : ""}`}>{fmtUsd(r.netPnl, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function labelFor(dim: BreakdownDimension): string {
  switch (dim) {
    case "ticker": return "Ticker";
    case "setup": return "Setup";
    case "tag": return "Tag";
    case "followedPlan": return "Plan adherence";
    case "month": return "Month";
    case "week": return "Week";
    case "day": return "Day";
  }
}

function TimeBreakdownPanel({ trades }: { trades: UnifiedTrade[] }) {
  const [granularity, setGranularity] = usePersistentState<"month" | "week" | "day">("analytics-granularity", "month");
  const rows = useMemo(() => computeBreakdown(trades, granularity), [trades, granularity]);

  return (
    <Panel
      title="Performance Over Time"
      action={
        <div className="flex items-center gap-1">
          {(["day", "week", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`px-2 py-1 text-[10px] uppercase tracking-wider rounded-sm border ${granularity === g ? "border-neon-blue text-neon-blue" : "border-ink-line text-slate-gray hover:text-soft-white"}`}
              data-testid={`button-granularity-${g}`}
            >
              {g}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty label="No data in range." />
      ) : (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-[12px] min-w-0">
            <thead className="sticky top-0 bg-ink-panel">
              <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
                <th className="text-left py-1.5 pr-2 font-normal">{labelFor(granularity)}</th>
                <th className="text-right py-1.5 px-2 font-normal">N</th>
                <th className="text-right py-1.5 px-2 font-normal">Win %</th>
                <th className="text-right py-1.5 px-2 font-normal">Total R</th>
                <th className="text-right py-1.5 pl-2 font-normal">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-ink-line/40">
                  <td className="py-1.5 pr-2 text-soft-white">{r.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-gray">{r.n}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(r.winRate, 0)}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${r.totalR > 0 ? "text-signal-green" : r.totalR < 0 ? "text-signal-red" : ""}`}>{fmtR(r.totalR)}</td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums ${r.netPnl > 0 ? "text-signal-green" : r.netPnl < 0 ? "text-signal-red" : ""}`}>{fmtUsd(r.netPnl, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

