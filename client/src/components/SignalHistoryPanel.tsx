// ─────────────────────────────────────────────────────────────────────────────
// SignalHistoryPanel.tsx
//
// Logs every Hammer / Engulfing confirmation event detected by the backend
// confirmation detector. This is a LOGGING + ANALYTICS panel — not a buy/sell
// signal feed.
//
// Data source: GET /api/signal-history (server-persisted via Neon Postgres).
// Persistence is server-side so the log survives page refreshes and is shared
// across devices. Stores up to 500 most recent signals.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Sparkline from "@/components/charts/Sparkline";
import type { SignalHistory } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Eye, Download } from "lucide-react";

const FullChartModal = lazy(() => import("@/components/FullChartModal"));

type SortKey = "timestamp" | "score" | "patternType";
type SortDir = "asc" | "desc";

function fmtDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-signal-green";
  if (score >= 60) return "text-signal-amber";
  return "text-slate-gray";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-signal-green/15 border-signal-green/40";
  if (score >= 60) return "bg-signal-amber/15 border-signal-amber/40";
  return "bg-slate-gray/15 border-slate-gray/40";
}

function parseBreakdown(raw: string): string[] {
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.map(String) : []; }
  catch { return []; }
}

export default function SignalHistoryPanel() {
  const { toast } = useToast();

  // ── Server data ─────────────────────────────────────────────────────────
  const { data: signals = [], isLoading, error, refetch, isFetching } = useQuery<SignalHistory[]>({
    queryKey: ["/api/signal-history"],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", "/api/signal-history?limit=500", undefined, signal);
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Filters / sort / search state ───────────────────────────────────────
  // Filter / sort prefs persist; search + expanded set stay session-local.
  const [filterTicker, setFilterTicker] = usePersistentState<string>("signal-history-ticker", "ALL");
  const [filterPattern, setFilterPattern] = usePersistentState<"ALL" | "Hammer" | "Engulfing">("signal-history-pattern", "ALL");
  const [minScore, setMinScore] = usePersistentState<number>("signal-history-min-score", 0);
  const [dateFrom, setDateFrom] = usePersistentState<string>("signal-history-date-from", "");
  const [dateTo, setDateTo] = usePersistentState<string>("signal-history-date-to", "");
  const [sortKey, setSortKey] = usePersistentState<SortKey>("signal-history-sort-key", "timestamp");
  const [sortDir, setSortDir] = usePersistentState<SortDir>("signal-history-sort-dir", "desc");
  const [search, setSearch] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // ── Chart modal state (View on Chart) ───────────────────────────────────
  const [chartSym, setChartSym] = useState<string | null>(null);

  // ── Derived: ticker options + filtered + sorted ─────────────────────────
  const tickerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) set.add(s.ticker);
    return Array.from(set).sort();
  }, [signals]);

  const filtered = useMemo(() => {
    const lcSearch = search.trim().toLowerCase();
    const fromTs = dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000) : null;
    // dateTo is inclusive — push to end of day.
    const toTs = dateTo ? Math.floor(new Date(dateTo).getTime() / 1000) + 86400 : null;
    return signals.filter(s => {
      if (filterTicker !== "ALL" && s.ticker !== filterTicker) return false;
      if (filterPattern !== "ALL" && s.patternType !== filterPattern) return false;
      if (s.score < minScore) return false;
      if (fromTs && s.timestamp < fromTs) return false;
      if (toTs && s.timestamp >= toTs) return false;
      if (lcSearch) {
        const dateStr = fmtDate(s.timestamp).toLowerCase();
        if (!s.ticker.toLowerCase().includes(lcSearch) && !dateStr.includes(lcSearch)) return false;
      }
      return true;
    });
  }, [signals, filterTicker, filterPattern, minScore, dateFrom, dateTo, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "timestamp") cmp = a.timestamp - b.timestamp;
      else if (sortKey === "score") cmp = a.score - b.score;
      else if (sortKey === "patternType") cmp = a.patternType.localeCompare(b.patternType);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // ── Actions ─────────────────────────────────────────────────────────────
  async function triggerScan() {
    try {
      await apiRequest("POST", "/api/signal-history/scan", {});
      toast({ title: "Scan started", description: "Confirmation detector is running across your watchlist. Results appear here within ~30s." });
      // Auto-refresh after a beat so freshly persisted entries show up.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/signal-history"] }), 8000);
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message || String(e), variant: "destructive" });
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(sorted, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chizzle-signal-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toggleExpanded(id: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setFilterTicker("ALL");
    setFilterPattern("ALL");
    setMinScore(0);
    setDateFrom("");
    setDateTo("");
    setSearch("");
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Panel title="Signal History" hint={`${sorted.length} of ${signals.length} confirmations · Hammer & Engulfing detector`}>
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            onClick={triggerScan}
            disabled={isFetching}
            data-testid="button-scan-confirmations"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono-num uppercase tracking-wider bg-neon-blue/15 text-neon-blue border border-neon-blue/40 hover:bg-neon-blue/25 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Scan now
          </button>
          <button
            onClick={exportJSON}
            disabled={sorted.length === 0}
            data-testid="button-export-signal-history"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-mono-num uppercase tracking-wider bg-ink-line/40 text-soft-white border border-ink-line hover:bg-ink-line/60 transition-colors disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Export JSON
          </button>
          <div className="flex-1" />
          <button
            onClick={() => refetch()}
            className="text-[11px] text-slate-gray hover:text-soft-white transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3 p-2 bg-ink-line/20 border border-ink-line/40">
          {/* Search */}
          <div className="col-span-2 relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-gray pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ticker or date…"
              data-testid="input-search-signals"
              className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white placeholder:text-slate-gray focus:outline-none focus:border-neon-blue/60"
            />
          </div>

          {/* Ticker filter */}
          <select
            value={filterTicker}
            onChange={e => setFilterTicker(e.target.value)}
            data-testid="select-filter-ticker"
            className="px-2 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
          >
            <option value="ALL">All tickers</option>
            {tickerOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Pattern filter */}
          <select
            value={filterPattern}
            onChange={e => setFilterPattern(e.target.value as any)}
            data-testid="select-filter-pattern"
            className="px-2 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
          >
            <option value="ALL">All patterns</option>
            <option value="Hammer">Hammer</option>
            <option value="Engulfing">Engulfing</option>
          </select>

          {/* Score min */}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Min</label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={e => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              data-testid="input-min-score"
              className="w-12 px-1.5 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
            />
            <span className="text-[10px] text-slate-gray">score</span>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-1">
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              data-testid="select-sort-key"
              className="flex-1 px-2 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
            >
              <option value="timestamp">Time</option>
              <option value="score">Score</option>
              <option value="patternType">Pattern</option>
            </select>
            <button
              onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
              data-testid="button-sort-dir"
              className="px-1.5 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white hover:bg-ink-line/40"
              title={sortDir === "asc" ? "Ascending" : "Descending"}
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>

          {/* Date range */}
          <div className="col-span-2 flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              data-testid="input-date-from"
              className="flex-1 px-1.5 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
            />
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              data-testid="input-date-to"
              className="flex-1 px-1.5 py-1.5 text-[11px] bg-ink-bg border border-ink-line text-soft-white focus:outline-none focus:border-neon-blue/60"
            />
          </div>

          <div className="md:col-span-2 flex items-center justify-end">
            <button
              onClick={clearFilters}
              data-testid="button-clear-filters"
              className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-soft-white transition-colors"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* ── List ── */}
        {isLoading ? (
          <div className="p-6 text-center text-[11px] text-slate-gray">Loading…</div>
        ) : error ? (
          <div className="p-6 text-center text-[11px] text-signal-red">Failed to load signal history.</div>
        ) : sorted.length === 0 ? (
          <div className="p-6 text-center text-[11px] text-slate-gray">
            {signals.length === 0
              ? "No confirmations logged yet. The detector scans every 30 minutes — or click \"Scan now\"."
              : "No signals match the current filters."}
          </div>
        ) : (
          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1" data-testid="list-signal-history">
            {sorted.map(s => {
              const isExpanded = expanded.has(s.id);
              const breakdown = parseBreakdown(s.scoreBreakdown);
              // Sparkline source: build a tiny series around setup→confirmation prices.
              // Real OHLC isn't stored per-bar in this row, so we use the key price
              // levels we DO have, which produces a faithful 4-point context curve.
              const spark = [s.setupCandleLow, s.confirmationCandleLow, s.retestZoneUpper, s.confirmationClose];
              return (
                <div
                  key={s.id}
                  className={`border ${scoreBg(s.score)} p-2.5 transition-colors`}
                  data-testid={`card-signal-${s.id}`}
                >
                  <div className="flex items-start gap-3">
                    {/* Left: ticker + pattern + date */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-num text-sm font-semibold text-soft-white" data-testid={`text-ticker-${s.id}`}>
                          {s.ticker}
                        </span>
                        <Chip tone={s.patternType === "Engulfing" ? "blue" : "amber"}>
                          {s.patternType}
                        </Chip>
                        <span className={`font-mono-num text-sm font-semibold ${scoreColor(s.score)}`} data-testid={`text-score-${s.id}`}>
                          {Math.round(s.score)}
                        </span>
                        <span className="text-[10px] text-slate-gray">/100</span>
                        {s.smaProximity && (
                          <span className="text-[10px] text-slate-gray font-mono-num">· {s.smaProximity}</span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-gray mt-0.5 font-mono-num">
                        {fmtDate(s.timestamp)} · close {s.confirmationClose.toFixed(2)} · vol {(s.volumeVsAverage20).toFixed(2)}× avg
                      </div>
                    </div>

                    {/* Middle: sparkline */}
                    <div className="w-20 shrink-0">
                      <Sparkline data={spark} height={28} stroke={s.color || "#00E5A8"} />
                    </div>

                    {/* Right: actions */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => setChartSym(s.ticker)}
                        data-testid={`button-view-chart-${s.id}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono-num uppercase tracking-wider bg-neon-blue/15 text-neon-blue border border-neon-blue/40 hover:bg-neon-blue/25 transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </button>
                      <button
                        onClick={() => toggleExpanded(s.id)}
                        data-testid={`button-toggle-details-${s.id}`}
                        className="text-[10px] text-slate-gray hover:text-soft-white transition-colors"
                      >
                        {isExpanded ? "Hide" : "Details"}
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-2 pt-2 border-t border-ink-line/40 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                      <div>
                        <div className="text-slate-gray uppercase tracking-wider">Setup low</div>
                        <div className="font-mono-num text-soft-white">{s.setupCandleLow.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-slate-gray uppercase tracking-wider">Confirm low</div>
                        <div className="font-mono-num text-soft-white">{s.confirmationCandleLow.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-slate-gray uppercase tracking-wider">Retest zone</div>
                        <div className="font-mono-num text-soft-white">{s.retestZoneLower.toFixed(2)} – {s.retestZoneUpper.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-slate-gray uppercase tracking-wider">Volume</div>
                        <div className="font-mono-num text-soft-white">{Math.round(s.volume).toLocaleString()}</div>
                      </div>
                      <div className="col-span-2 md:col-span-4">
                        <div className="text-slate-gray uppercase tracking-wider mb-1">Score breakdown</div>
                        <ul className="space-y-0.5">
                          {breakdown.map((b, i) => (
                            <li key={i} className="font-mono-num text-soft-white">• {b}</li>
                          ))}
                          {breakdown.length === 0 && <li className="text-slate-gray italic">No breakdown stored.</li>}
                        </ul>
                      </div>
                      <div className="col-span-2 md:col-span-4 text-slate-gray font-mono-num">
                        Sound: {s.soundPlayed ? "yes" : "no"} · Notification: {s.notificationSent ? "yes" : "no"} · Marker: {s.markerType} @ {s.markerPosition.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ── View-on-Chart modal ── */}
      <Suspense fallback={null}>
        {chartSym && (
          <FullChartModal
            open={!!chartSym}
            symbol={chartSym}
            defaultInterval="1D"
            onClose={() => setChartSym(null)}
          />
        )}
      </Suspense>
    </div>
  );
}
