import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Panel, StatRow, Chip } from "@/components/Panel";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Cpu, AlertTriangle, AlertCircle, Info as InfoIcon, Sparkles as SparklesIcon, Inbox, X as XIcon, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Settings, Ticker, WatchlistItem, Trade, Alert, ChizzleScore, EquityHistory, LeapPosition, LeapReserve, RegimeState, RegimeInputsRow, SetupCandidateRow } from "@shared/schema";
import { decideDiscipline, defaultQualityFallback, type RegimeCode, type Quality } from "@shared/discipline";
import { useLivePrices } from "@/lib/useLivePrices";
import {
  regimeLabel, identityState, openRiskPct, expectancy, drawdown,
  rrRatio, fmtPct, fmtR, MAX_OPEN_RISK_PCT, MAX_POSITIONS, RISK_PCT,
  riskPctFromSettings,
  formatSetupState, setupStateColor, setupStatePriority, formatSetupKind,
  regimeAllowedSetupsLabel,
} from "@/lib/engine";
import { TermTooltip } from "@/components/TermTooltip";
import { RiskChipPopover } from "@/components/RiskChipPopover";

import { LineChart, Line, AreaChart, Area, ComposedChart, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, BarChart, Bar, CartesianGrid } from "recharts";
import Sparkline from "@/components/charts/Sparkline";
import ZonePositionBar from "@/components/charts/ZonePositionBar";

interface RegimePayload {
  state: RegimeState;
  latestInputs: RegimeInputsRow | null;
  effective: { code: "green" | "yellow" | "red"; source: "AUTO" | "MANUAL" };
}

export default function Cockpit() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: tickers } = useQuery<Ticker[]>({ queryKey: ["/api/tickers"] });
  const { data: watchlist } = useQuery<WatchlistItem[]>({ queryKey: ["/api/watchlist"] });
  const { data: setupsByTicker } = useQuery<Record<string, SetupCandidateRow[]>>({ queryKey: ["/api/setups"] });
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: alerts } = useQuery<Alert[]>({ queryKey: ["/api/alerts"] });
  const { data: scores } = useQuery<ChizzleScore[]>({ queryKey: ["/api/chizzle-scores"] });
  const { data: equityHistory } = useQuery<EquityHistory[]>({ queryKey: ["/api/equity-history"] });
  const { data: leap } = useQuery<LeapPosition[]>({ queryKey: ["/api/leap"] });
  const { data: leapReserve } = useQuery<LeapReserve>({ queryKey: ["/api/leap-reserve"] });

  const { data: regimePayload } = useQuery<RegimePayload>({
    queryKey: ["/api/regime"],
  });
  const { data: regimeHistory } = useQuery<RegimeInputsRow[]>({
    queryKey: ["/api/regime/history"],
  });

  const livePrices = useLivePrices(tickers);
  const effectiveCode = regimePayload?.effective?.code ?? "yellow";
  const regime = effectiveCode.toUpperCase() as "GREEN" | "YELLOW" | "RED";
  const equity = settings?.equity ?? 1000;
  const openTrades = (trades || []).filter(t => t.status === "OPEN");
  const openRisk = openRiskPct(openTrades.map(t => ({ entry: t.entry, stop: t.stop, shares: t.shares })), equity);
  const todayRiskAtRisk = (openRisk / 100) * equity;
  const riskMap = riskPctFromSettings(settings);
  const allowedRiskPct = riskMap[regime] * 100;
  const allowed$ = equity * (allowedRiskPct / 100);

  const todayScore = scores?.[0]?.total ?? 0;
  const last7 = (scores || []).slice(0, 7);
  const rolling = last7.length ? Math.round(last7.reduce((s, x) => s + x.total, 0) / last7.length) : 0;
  const istate = identityState(rolling);

  const closedTrades = (trades || []).filter(t => t.status === "CLOSED");
  const exp = expectancy(closedTrades);
  const dd = drawdown(equityHistory || []);

  // Watchlist computed view — driven by auto-detected setups + discipline gating.
  // Per regime_gate_spec.md: RED hides all, YELLOW dims non-A grades, GREEN shows all.
  const regimeCodeLower = (effectiveCode || "green") as RegimeCode;
  const wlRows: Array<{ ticker: Ticker; candidate: SetupCandidateRow; lp: number; pctToZone: number; discipline: ReturnType<typeof decideDiscipline> }> = [];
  let wlHiddenCount = 0;
  for (const t of tickers || []) {
    const lp = livePrices[t.symbol] ?? t.currentPrice;
    const cands = setupsByTicker?.[t.symbol] || [];
    for (const c of cands) {
      const quality = ((c as any).quality as Quality | null) || defaultQualityFallback();
      const d = decideDiscipline(regimeCodeLower, quality);
      if (d.visibility === "hidden") {
        wlHiddenCount++;
        continue;
      }
      const pctToZone = c.entryZoneLow != null ? ((c.entryZoneLow - lp) / lp) * 100 : 0;
      wlRows.push({ ticker: t, candidate: c, lp, pctToZone, discipline: d });
    }
  }
  // Sort: regime-eligible setups first (ARMED > IN_ZONE > APPROACHING > BUILDING),
  // then regime-blocked setups (any state), then DORMANT/INVALIDATED.
  function eligibilityRank(c: SetupCandidateRow): number {
    const elig = (c as any).regimeEligible !== false;
    if (elig) return 2;
    return 1; // blocked but otherwise tracked
  }
  wlRows.sort((a, b) => {
    const er = eligibilityRank(b.candidate) - eligibilityRank(a.candidate);
    if (er !== 0) return er;
    return setupStatePriority(b.candidate.state) - setupStatePriority(a.candidate.state);
  });

  // Equity chart data
  const eqData = (equityHistory || []).map(e => ({ date: e.date, equity: e.equity, dd: e.drawdownPct }));
  if (eqData.length === 1) eqData.push({ ...eqData[0] });

  // Leap totals
  const leapValue = (leap || []).reduce((s, p) => s + p.currentPremium * p.contracts * 100, 0);
  const leapPct = equity > 0 ? (leapValue / equity) * 100 : 0;

  // alerts feed (latest 10) + category filter
  const [alertFilter, setAlertFilter] = useState<"all" | "critical" | "action" | "info">("all");
  const feed = useMemo(() => {
    const f = (alerts || []);
    return (alertFilter === "all" ? f : f.filter(a => a.severity === alertFilter)).slice(0, 10);
  }, [alerts, alertFilter]);

  // Today's Opportunities — high-conviction shortlist:
  // visible (not hidden by discipline), state IN_ZONE or LIVE/ARMED, quality A or B,
  // sorted by quality (A first) then by % to zone (closest to entry first).
  const todaysOpportunities = useMemo(() => {
    const out: typeof wlRows = [];
    for (const r of wlRows) {
      const q = ((r.candidate as any).quality as Quality | null) || defaultQualityFallback();
      const s = (r.candidate.state || "").toLowerCase();
      const triggered = (r.candidate as any).triggerFired === true;
      const isLive = s === "in_zone" || s === "live" || s === "armed" || triggered;
      if (isLive && (q === "A" || q === "B")) {
        out.push(r);
      }
    }
    out.sort((a, b) => {
      const qa = ((a.candidate as any).quality === "A" ? 0 : 1);
      const qb = ((b.candidate as any).quality === "A" ? 0 : 1);
      if (qa !== qb) return qa - qb;
      return Math.abs(a.pctToZone) - Math.abs(b.pctToZone);
    });
    return out.slice(0, 5);
  }, [wlRows]);

  // Off-process banner
  const offProcess = rolling > 0 && rolling < 60;

  const refreshAll = () => {
    const keys = [
      "/api/settings", "/api/tickers", "/api/watchlist", "/api/setups",
      "/api/trades", "/api/alerts", "/api/chizzle-scores",
      "/api/equity-history", "/api/leap", "/api/leap-reserve",
      "/api/regime", "/api/regime/history",
    ];
    for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
    toast({ title: "Refreshed", description: "Cockpit data re-fetched." });
  };

  const [recomputing, setRecomputing] = useState(false);
  const recomputeAll = async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      await apiRequest("POST", "/api/recompute-all", {});
      const keys = [
        "/api/settings", "/api/watchlist", "/api/setups", "/api/trades",
        "/api/alerts", "/api/chizzle-scores", "/api/regime",
      ];
      for (const k of keys) queryClient.invalidateQueries({ queryKey: [k] });
      toast({ title: "Recomputed", description: "Engine re-evaluated regime + setups." });
    } catch (e: any) {
      toast({ title: "Recompute failed", description: String(e?.message || e) });
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-center justify-between pb-1 border-b border-ink-line/60">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Cockpit</h1>
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Low-Credit · Manual</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={recomputeAll}
            disabled={recomputing}
            data-testid="button-recompute-all"
            title="Manually recompute regime + all setups (low-credit safe)"
            className="flex items-center gap-1.5 px-2.5 py-1 border border-neon-blue/60 text-neon-blue bg-neon-blue/10 text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/20 disabled:opacity-40"
          >
            <Cpu className={`w-3 h-3 ${recomputing ? "animate-pulse" : ""}`} />
            {recomputing ? "Computing" : "Recompute"}
          </button>
          <button
            onClick={refreshAll}
            data-testid="button-refresh"
            title="Re-fetch all cockpit data (no backend recompute)"
            className="flex items-center gap-1.5 px-2.5 py-1 border border-soft-white/30 text-soft-white bg-transparent text-[11px] uppercase tracking-wider rounded-sm hover:bg-soft-white/10"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>
      {offProcess && (
        <div className="bg-signal-red/15 border-l-4 border-signal-red border-y border-r border-y-signal-red/40 border-r-signal-red/40 px-4 py-2.5 flex items-center gap-3 rounded-sm">
          <span className="inline-block w-2 h-2 bg-signal-red rounded-full animate-pulse" />
          <span className="font-display text-[12px] tracking-widest uppercase text-signal-red">OFF-PROCESS</span>
          <span className="text-[12px] text-soft-white">7-day Chizzle Score &lt; 60 — no new entries until score recovers.</span>
        </div>
      )}

      {/* Row 1: regime / risk / chizzle */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RegimePanel regime={regime} payload={regimePayload} history={regimeHistory || []} />
        <RiskPanel openRisk={openRisk} todayRiskAtRisk={todayRiskAtRisk} allowed$={allowed$} positions={openTrades.length} maxPositions={MAX_POSITIONS[regime]} regime={regime} allowedSetupsLabel={regimeAllowedSetupsLabel(regime)} riskMap={riskMap} />
        <ChizzleScorePanel today={todayScore} rolling={rolling} istate={istate} scores={scores || []} />
      </div>

      {/* Row 1.5: Today's Opportunities (A/B-grade setups currently live/in-zone) */}
      {todaysOpportunities.length > 0 && (
        <Panel title="Today's Opportunities" hint={`${todaysOpportunities.length} high-conviction`}>
          <TodaysOpportunities rows={todaysOpportunities} />
        </Panel>
      )}

      {/* Row 2: watchlist + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="Watchlist · Auto Setups" hint={`${wlRows.length} setups · Tier ${settings?.watchlistTier ?? 1}`} className="lg:col-span-8">
          <WatchlistTable rows={wlRows} hiddenCount={wlHiddenCount} />
        </Panel>
        <Panel
          title="Alerts Feed"
          hint={`${feed.length} recent`}
          className="lg:col-span-4"
          action={
            (alerts?.length || 0) > 0 ? (
              <button
                onClick={async () => {
                  if (!confirm(`Clear all ${alerts!.length} alerts? This cannot be undone.`)) return;
                  await apiRequest("DELETE", "/api/alerts", undefined);
                  queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
                }}
                className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-signal-red transition-colors flex items-center gap-1"
                title="Delete all alerts"
                data-testid="button-clear-alerts"
              >
                <Trash2 className="w-3 h-3" />
                Clear all
              </button>
            ) : null
          }
        >
          <AlertFilterChips current={alertFilter} onChange={setAlertFilter} alerts={alerts || []} />
          <AlertsFeed alerts={feed} />
        </Panel>
      </div>

      {/* Row 3: open positions + equity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <Panel title="Open Positions" hint={`${openTrades.length} / ${MAX_POSITIONS[regime]}`} className="lg:col-span-6">
          <OpenPositionsTable trades={openTrades} livePrices={livePrices} />
        </Panel>
        <Panel title="Equity Curve · Drawdown" hint={`MaxDD ${dd.max.toFixed(2)}%`} className="lg:col-span-6">
          <EquityChart data={eqData} />
        </Panel>
      </div>

      {/* Row 4: leap / expectancy / journal queue */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Panel title="LEAP Ladder" hint={`Reserve $${(leapReserve?.balance ?? 0).toFixed(2)}`}>
          <LeapSummary positions={leap || []} reserve={leapReserve?.balance ?? 0} equity={equity} leapPct={leapPct} leapValue={leapValue} />
        </Panel>
        <Panel title="Expectancy" hint={`${exp.n} closed`}>
          <ExpectancyPanel expectancyValue={exp.value} closed={closedTrades} />
        </Panel>
        <Panel title="Journal Queue">
          <JournalQueue openTrades={openTrades} closedTrades={closedTrades} />
        </Panel>
      </div>
    </div>
  );
}

// ─── Regime Panel ───────────────────────────────────────────────────────────
function RegimePanel({ regime, payload, history }: { regime: "GREEN" | "YELLOW" | "RED"; payload?: RegimePayload; history: RegimeInputsRow[] }) {
  const tone = regime === "GREEN" ? "green" : regime === "YELLOW" ? "amber" : "red";
  const source = payload?.effective?.source ?? "AUTO";
  const state = payload?.state;
  const latest = payload?.latestInputs ?? null;

  // history is newest-first from API → reverse for ascending sparklines
  const series = [...(history || [])].reverse();
  const spyCloses = series.map(r => r.spyPrice);
  const spy50 = series.map(r => r.spySma50);
  const qqqCloses = series.map(r => r.qqqPrice);
  const qqq50 = series.map(r => r.qqqSma50);
  const vixSeries = series.map(r => r.vixLevel);
  const breadthSeries = series.map(r => r.breadthProxyPct);

  const spyTone: SparkTone = latest?.spyAbove50 && latest?.spySma50Rising ? "green" : latest?.spyAbove50 ? "amber" : "red";
  const qqqTone: SparkTone = latest?.qqqAbove50 && latest?.qqqSma50Rising ? "green" : latest?.qqqAbove50 ? "amber" : "red";
  const vixVal = latest?.vixLevel ?? 0;
  const vixTone: SparkTone = vixVal > 25 ? "red" : vixVal > 20 ? "amber" : "green";
  const breadthVal = latest?.breadthProxyPct ?? 50;
  const breadthTone: SparkTone = breadthVal >= 55 ? "green" : breadthVal >= 45 ? "amber" : "red";

  const lastClassifiedAt = state?.lastClassifiedAt
    ? new Date(state.lastClassifiedAt).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";
  const autoRegimeUpper = state ? state.currentRegime.toUpperCase() : "—";
  const pending = state?.pendingRegime && state.pendingRegime !== state.currentRegime
    ? { code: state.pendingRegime.toUpperCase(), n: state.pendingConsecutiveCount }
    : null;

  return (
    <Panel title="Regime" hint={regime === "GREEN" ? "Risk-On" : regime === "YELLOW" ? "Mixed/Chop" : "Risk-Off"}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Chip tone={tone as any} className="text-[11px] px-2 py-1" data-testid="text-regime-effective">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current heartbeat mr-1.5" />
            {regimeLabel(regime)}
          </Chip>
          <span
            data-testid="pill-regime-source"
            className={`inline-flex items-center px-1.5 py-0.5 border text-[9px] tracking-widest uppercase font-display rounded-sm ${
              source === "MANUAL"
                ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                : "border-neon-blue/40 bg-neon-blue/10 text-neon-blue"
            }`}
          >
            {source}
          </span>
          {state?.stale && (
            <span className="inline-flex items-center px-1.5 py-0.5 border border-signal-amber/40 bg-signal-amber/10 text-signal-amber text-[9px] tracking-widest uppercase font-display rounded-sm">
              STALE
            </span>
          )}
        </div>

        {source === "MANUAL" && (
          <div data-testid="text-manual-override-note" className="text-[10px] text-signal-amber">
            Manual override · auto-engine says {autoRegimeUpper}
          </div>
        )}

        {pending && (
          <div data-testid="text-pending-regime" className="text-[10px] text-slate-gray font-mono">
            → pending {pending.code} · {pending.n}/2 closes
          </div>
        )}

        <div className="text-[11px] text-slate-gray font-mono">Last classified · {lastClassifiedAt}</div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ink-line">
          <DualSpark
            label={`SPY ${latest ? latest.spyPrice.toFixed(2) : "—"} / 50 ${latest ? latest.spySma50.toFixed(2) : "—"}`}
            tone={spyTone}
            primary={spyCloses}
            secondary={spy50}
          />
          <DualSpark
            label={`QQQ ${latest ? latest.qqqPrice.toFixed(2) : "—"} / 50 ${latest ? latest.qqqSma50.toFixed(2) : "—"}`}
            tone={qqqTone}
            primary={qqqCloses}
            secondary={qqq50}
          />
          <SingleSpark
            label={`VIX (VIXY proxy) ${vixVal ? vixVal.toFixed(2) : "—"}`}
            tone={vixTone}
            data={vixSeries}
          />
          <SingleSpark
            label={`BREADTH ${breadthVal ? Math.round(breadthVal) : "—"}%`}
            tone={breadthTone}
            data={breadthSeries}
          />
        </div>
        {latest?.distributionDays != null && latest.distributionDays > 0 && (
          <div className="text-[10px] text-slate-gray font-mono">
            Distribution days · {latest.distributionDays} (last 25)
          </div>
        )}
      </div>
    </Panel>
  );
}

type SparkTone = "green" | "amber" | "red" | "blue";
function toneColor(tone: SparkTone): string {
  return tone === "green" ? "hsl(var(--signal-green))"
    : tone === "amber" ? "hsl(var(--signal-amber))"
    : tone === "red" ? "hsl(var(--signal-red))"
    : "hsl(var(--neon-blue))";
}

function SingleSpark({ label, tone, data }: { label: string; tone: SparkTone; data: number[] }) {
  const color = toneColor(tone);
  const pts = (data || []).filter(v => Number.isFinite(v));
  const chartData = pts.length
    ? pts.map((y, x) => ({ x, y }))
    : Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0 }));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-slate-gray truncate">{label}</span>
      <div className="h-7">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <Line type="monotone" dataKey="y" stroke={color} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DualSpark({ label, tone, primary, secondary }: { label: string; tone: SparkTone; primary: number[]; secondary: number[] }) {
  const color = toneColor(tone);
  const smaColor = "hsl(var(--slate-gray))";
  const len = Math.min(primary.length, secondary.length);
  const chartData = len
    ? Array.from({ length: len }, (_, i) => ({ x: i, p: primary[i], s: secondary[i] }))
    : Array.from({ length: 8 }, (_, i) => ({ x: i, p: 0, s: 0 }));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-slate-gray truncate">{label}</span>
      <div className="h-7">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <Line type="monotone" dataKey="s" stroke={smaColor} strokeWidth={1} strokeDasharray="2 2" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="p" stroke={color} strokeWidth={1.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Risk Panel ─────────────────────────────────────────────────────────────
function RiskPanel({ openRisk, todayRiskAtRisk, allowed$, positions, maxPositions, regime, allowedSetupsLabel, riskMap }: any) {
  const pct = Math.min(100, (openRisk / MAX_OPEN_RISK_PCT) * 100);
  const gaugeTone = openRisk >= 6 ? "signal-red" : openRisk >= 5 ? "signal-amber" : "neon-blue";
  const map = (riskMap || { GREEN: 0.05, YELLOW: 0.03, RED: 0.01 }) as Record<string, number>;
  const riskPctNum = (map[regime as string] ?? 0.02) * 100;
  return (
    <Panel title="Risk" hint={`${riskPctNum.toFixed(1)}% per trade · click to change`}>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <RiskChipPopover valuePct={riskPctNum} regime={regime} testId="chip-risk-pct" />
          <span className="sr-only">risk pct chip</span>
        </div>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Open Risk</div>
            <div className="font-mono-num text-[28px] leading-none tabular-nums text-soft-white">{openRisk.toFixed(2)}<span className="text-slate-gray text-[14px] ml-1">%</span></div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-gray">Positions</div>
            <div className="font-mono-num text-[16px] tabular-nums">{positions} <span className="text-slate-gray">/ {maxPositions}</span></div>
          </div>
        </div>
        {/* Gauge */}
        <div className="space-y-1">
          <div className="h-2 bg-ink-line rounded-sm overflow-hidden relative">
            <div className={`absolute inset-y-0 left-0 bg-${gaugeTone}`} style={{ width: `${pct}%` }} />
            <div className="absolute inset-y-0" style={{ left: `${(5 / 6) * 100}%`, width: 1, background: "hsl(var(--signal-amber))" }} />
            <div className="absolute inset-y-0" style={{ left: "100%", width: 1, background: "hsl(var(--signal-red))" }} />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-slate-gray tabular-nums">
            <span>0%</span><span>5%</span><span>6% cap</span>
          </div>
        </div>
        <div className="pt-1 border-t border-ink-line space-y-0">
          <StatRow label="$ at risk today" value={`$${todayRiskAtRisk.toFixed(2)}`} />
          <StatRow label="Allowed (per trade)" value={`$${allowed$.toFixed(2)}`} />
          <StatRow label="Allowed setups" value={
            <span
              data-testid="text-allowed-setups"
              className={regime === "RED" ? "text-[#F59E0B]" : "text-soft-white"}
            >
              {allowedSetupsLabel}
            </span>
          } />
          <StatRow label="Risk profile" value={
            <span className="text-slate-gray">
              <span className={regime === "GREEN" ? "text-signal-green" : ""}>{(map.GREEN * 100).toFixed(1)}%</span> /{" "}
              <span className={regime === "YELLOW" ? "text-signal-amber" : ""}>{(map.YELLOW * 100).toFixed(1)}%</span> /{" "}
              <span className={regime === "RED" ? "text-signal-red" : ""}>{(map.RED * 100).toFixed(1)}%</span>
            </span>
          } />
        </div>
      </div>
    </Panel>
  );
}

// ─── Chizzle Score Panel ───────────────────────────────────────────────────
function ChizzleScorePanel({ today, rolling, istate, scores }: any) {
  const isOperator = rolling >= 90;
  const istateLabel = istate.replace("_", "-");
  // lowest component bar — synthesize from latest
  const latest = scores[0]?.components ? JSON.parse(scores[0].components) : null;
  let lowestLabel = "—";
  let lowestVal: number | null = null;
  if (latest) {
    const entries = Object.entries(latest) as [string, number][];
    if (entries.length) {
      const min = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
      lowestLabel = min[0];
      lowestVal = min[1];
    }
  }
  return (
    <Panel title="Chizzle Score" hint="0–100 identity">
      <div className="grid grid-cols-2 gap-3 items-start">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">Today</div>
          <div className={`font-display font-semibold text-[44px] leading-none tabular-nums ${isOperator ? "text-gold-lux" : "text-soft-white"}`}>{today}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">7-Day</div>
          <div className={`font-mono-num text-[24px] tabular-nums ${rolling >= 90 ? "text-gold-lux" : rolling >= 75 ? "text-neon-blue" : rolling >= 60 ? "text-soft-white" : "text-signal-red"}`}>{rolling}</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-ink-line space-y-2">
        <Chip tone={rolling >= 90 ? "gold" : rolling >= 75 ? "blue" : rolling >= 60 ? "neutral" : "red"}>
          {istateLabel}
        </Chip>
        <div>
          <div className="flex justify-between text-[10px] text-slate-gray uppercase tracking-wider">
            <span>Lowest · {lowestLabel}</span>
            <span className="font-mono tabular-nums">{lowestVal ?? "—"}</span>
          </div>
          <div className="h-1.5 bg-ink-line mt-1">
            <div className="h-full bg-signal-amber" style={{ width: `${lowestVal ?? 0}%` }} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── Watchlist Table (cockpit version) ─────────────────────────────────────
function WatchlistTable({ rows, hiddenCount }: {
  rows: Array<{ ticker: Ticker; candidate: SetupCandidateRow; lp: number; pctToZone: number; discipline?: ReturnType<typeof decideDiscipline> }>;
  hiddenCount?: number;
}) {
  if (!rows.length) {
    if (hiddenCount && hiddenCount > 0) {
      return (
        <div className="flex flex-col items-center justify-center py-6 gap-2 text-slate-gray">
          <AlertTriangle className="w-5 h-5 opacity-50 text-signal-amber" />
          <div className="text-[12px] text-center">All {hiddenCount} candidate setup(s) hidden by regime gate. <span className="text-soft-white/80">Open Watchlist to override.</span></div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2 text-slate-gray">
        <Inbox className="w-5 h-5 opacity-40" />
        <div className="text-[12px] text-center">No setup candidates yet — manually refresh setups from the Watchlist page.</div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -m-3.5">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
            <th className="text-left px-3.5 py-2 font-medium"><TermTooltip term="Ticker" /></th>
            <th className="text-left px-2 py-2 font-medium"><TermTooltip term="Setup" /></th>
            <th className="text-left px-2 py-2 font-medium"><TermTooltip term="State" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="Quals" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="Entry Zone" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="Stop" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="T1" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="RR→T1" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="LP" /></th>
            <th className="text-right px-3.5 py-2 font-medium"><TermTooltip term="% to Zone" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ ticker, candidate, lp, pctToZone, discipline }) => {
            const stateClass = setupStateColor(candidate.state);
            const zoneText = candidate.entryZoneLow != null && candidate.entryZoneHigh != null
              ? `${candidate.entryZoneLow.toFixed(2)}–${candidate.entryZoneHigh.toFixed(2)}`
              : "—";
            const regimeEligible = (candidate as any).regimeEligible !== false;
            const regimeBlockedReason = (candidate as any).regimeBlockedReason as string | null | undefined;
            const isDimmed = discipline?.visibility === "dimmed";
            const dimStyle = isDimmed ? { opacity: 0.55 } : undefined;
            return (
              <tr key={`${ticker.symbol}:${candidate.setup}`} className={`border-t border-ink-line/60 ${stateClass} hover:bg-ink-line/30 ${regimeEligible ? "" : "opacity-70"}`}
                  style={dimStyle}
                  data-testid={`cockpit-row-${ticker.symbol}-${candidate.setup}`}>
                <td className="px-3.5 py-2 font-mono-num tabular-nums">{ticker.symbol}</td>
                <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-gray">{formatSetupKind(candidate.setup)}</td>
                <td className="px-2 py-2 text-[10px] uppercase tracking-wider">
                  <div className="flex flex-col gap-1">
                    <span className={regimeEligible ? "" : "opacity-70"}>{formatSetupState(candidate.state)}</span>
                    {!regimeEligible && (
                      <span
                        title={regimeBlockedReason || "Regime gate blocks this setup"}
                        data-testid={`cockpit-pill-blocked-${ticker.symbol}-${candidate.setup}`}
                        className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-[#F59E0B]/50 bg-[#F59E0B]/10 text-[#F59E0B] font-mono-num tracking-tight text-[9px] uppercase whitespace-nowrap"
                      >
                        BLOCKED
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{candidate.qualificationsPassed}/{candidate.qualificationsTotal}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-slate-gray">{zoneText}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-red/80">{candidate.stop != null ? candidate.stop.toFixed(2) : "—"}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-green/80">{candidate.t1 != null ? candidate.t1.toFixed(2) : "—"}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{candidate.rrToT1 != null ? candidate.rrToT1.toFixed(2) : "—"}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-soft-white">{lp.toFixed(2)}</td>
                <td className="px-3.5 py-2 text-right font-mono-num tabular-nums">{candidate.entryZoneLow != null ? fmtPct(pctToZone) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Alerts Feed ────────────────────────────────────────────────────────────
function AlertFilterChips({
  current,
  onChange,
  alerts,
}: {
  current: "all" | "critical" | "action" | "info";
  onChange: (v: "all" | "critical" | "action" | "info") => void;
  alerts: Alert[];
}) {
  const counts = useMemo(() => {
    const c = { all: alerts.length, critical: 0, action: 0, info: 0 };
    for (const a of alerts) {
      if (a.severity === "critical") c.critical++;
      else if (a.severity === "action") c.action++;
      else c.info++;
    }
    return c;
  }, [alerts]);
  const cats: Array<{ key: "all" | "critical" | "action" | "info"; label: string; dot: string }> = [
    { key: "all", label: "All", dot: "bg-slate-gray" },
    { key: "critical", label: "Critical", dot: "bg-signal-red" },
    { key: "action", label: "Action", dot: "bg-signal-amber" },
    { key: "info", label: "Info", dot: "bg-neon-blue" },
  ];
  return (
    <div className="flex gap-1.5 flex-wrap mb-2">
      {cats.map(c => {
        const active = current === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            data-testid={`chip-alert-filter-${c.key}`}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-sm flex items-center gap-1 border ${
              active
                ? "bg-soft-white/10 border-soft-white/40 text-soft-white"
                : "border-ink-line text-slate-gray hover:text-soft-white hover:border-slate-gray"
            }`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
            <span>{c.label}</span>
            <span className="font-mono-num tabular-nums opacity-70">{counts[c.key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function TodaysOpportunities({
  rows,
}: {
  rows: Array<{ ticker: Ticker; candidate: SetupCandidateRow; lp: number; pctToZone: number; discipline: ReturnType<typeof decideDiscipline> }>;
}) {
  if (!rows.length) {
    return <div className="text-[12px] text-slate-gray py-4">No high-conviction setups today.</div>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
      {rows.map(({ ticker, candidate, lp, pctToZone }) => {
        const q = ((candidate as any).quality as string) || "B";
        const qTone = q === "A" ? "green" : q === "B" ? "amber" : "red";
        const stateRaw = (candidate.state || "").toLowerCase();
        const stateLabel = formatSetupState(stateRaw);
        const stateTextClass = setupStateColor(stateRaw);
        return (
          <div
            key={`${ticker.symbol}-${candidate.setup}`}
            data-testid={`card-opportunity-${ticker.symbol}-${candidate.setup}`}
            className={`border border-ink-line/80 bg-ink-deep/40 rounded-sm p-2.5 flex flex-col gap-1.5 border-l-2 ${q === "A" ? "border-l-signal-green" : q === "B" ? "border-l-signal-amber" : "border-l-signal-red"}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono-num text-[13px] text-soft-white">{ticker.symbol}</span>
              <Chip tone={qTone as any} className="text-[10px] px-1.5 py-0">{q}</Chip>
            </div>
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider">
              <span className="text-slate-gray">{formatSetupKind(candidate.setup)}</span>
              <span className={stateTextClass}>{stateLabel}</span>
            </div>
            <div className="flex items-baseline justify-between text-[11px]">
              <TermTooltip term="LP" className="text-slate-gray" />
              <span className="font-mono-num tabular-nums text-soft-white">{lp.toFixed(2)}</span>
            </div>
            {candidate.entryZoneLow != null && candidate.entryZoneHigh != null && (
              <>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-slate-gray">Zone</span>
                  <span className="font-mono-num tabular-nums text-soft-white/80">{candidate.entryZoneLow.toFixed(2)}–{candidate.entryZoneHigh.toFixed(2)}</span>
                </div>
                <div className="mt-0.5">
                  <ZonePositionBar
                    low={candidate.entryZoneLow}
                    high={candidate.entryZoneHigh}
                    current={lp}
                    stopLevel={(candidate as any).stopLevel ?? null}
                    t1={(candidate as any).t1 ?? null}
                    width={210}
                    height={22}
                  />
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-slate-gray">% to zone</span>
              <span className={`font-mono-num tabular-nums ${Math.abs(pctToZone) < 1 ? "text-signal-green" : "text-soft-white/80"}`}>{fmtPct(pctToZone)}</span>
            </div>
            {candidate.rrToT1 != null && (
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-slate-gray">R:R</span>
                <span className="font-mono-num tabular-nums text-soft-white/80">{candidate.rrToT1.toFixed(2)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AlertsFeed({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2 text-slate-gray">
        <Inbox className="w-5 h-5 opacity-50" />
        <div className="text-[12px]">No alerts yet. Cockpit is quiet.</div>
      </div>
    );
  }
  const deleteAlert = async (id: number) => {
    await apiRequest("DELETE", `/api/alerts/${id}`, undefined);
    queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
  };
  return (
    <ul className="space-y-1.5">
      {alerts.map(a => {
        const isCrit = a.severity === "critical";
        const isAction = a.severity === "action";
        const Icon = isCrit ? AlertCircle : isAction ? AlertTriangle : InfoIcon;
        const tone = isCrit ? "text-signal-red" : isAction ? "text-signal-amber" : "text-neon-blue";
        return (
          <li key={a.id} className="group flex gap-2 items-start py-1.5 border-b border-ink-line/60 last:border-0">
            <Icon className={`mt-0.5 w-3 h-3 flex-shrink-0 ${tone}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="font-mono-num text-slate-gray tabular-nums">{new Date(a.firedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="font-mono-num text-neon-blue">{a.ticker}</span>
                <span className={`text-[10px] uppercase tracking-wider ${tone} opacity-80`}>{a.type}</span>
              </div>
              <div className="text-[12px] text-soft-white">{a.message}</div>
            </div>
            <button
              onClick={() => deleteAlert(a.id)}
              className="mt-0.5 p-1 -mr-1 rounded-sm text-slate-gray hover:text-signal-red hover:bg-signal-red/10 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              title="Delete alert"
              aria-label={`Delete alert ${a.id}`}
              data-testid={`button-delete-alert-${a.id}`}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Open Positions Table ───────────────────────────────────────────────────
function OpenPositionsTable({ trades, livePrices }: { trades: Trade[]; livePrices: Record<string, number> }) {
  if (!trades.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-gray">
        <SparklesIcon className="w-7 h-7 opacity-40" />
        <div className="text-[12px] tracking-wide">No open positions. Standing by for trigger.</div>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -m-3.5">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
            <th className="text-left px-3.5 py-2 font-medium"><TermTooltip term="Ticker" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="Entry" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="Stop" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="T1" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="LP" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="R" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="P/L $" /></th>
            <th className="text-right px-2 py-2 font-medium"><TermTooltip term="% to T1" /></th>
            <th className="text-right px-3.5 py-2 font-medium"><TermTooltip term="Days" /></th>
          </tr>
        </thead>
        <tbody>
          {trades.map(t => {
            const lp = livePrices[t.ticker] ?? t.entry;
            const r = (lp - t.entry) / (t.entry - t.stop);
            const pnl = (lp - t.entry) * t.shares;
            const pctToT1 = ((t.t1 - lp) / lp) * 100;
            const days = Math.floor((Date.now() - new Date(t.openedAt).getTime()) / 86400000);
            return (
              <tr key={t.id} className="border-t border-ink-line/60 state-live">
                <td className="px-3.5 py-2 font-mono-num">{t.ticker}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{t.entry.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-red/80">{t.stop.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums text-signal-green/80">{t.t1.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{lp.toFixed(2)}</td>
                <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${r >= 0 ? "text-signal-green" : "text-signal-red"}`}>{fmtR(r)}</td>
                <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${pnl >= 0 ? "text-signal-green" : "text-signal-red"}`}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</td>
                <td className="px-2 py-2 text-right font-mono-num tabular-nums">{fmtPct(pctToT1)}</td>
                <td className="px-3.5 py-2 text-right font-mono-num tabular-nums text-slate-gray">{days}d</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Equity Chart ───────────────────────────────────────────────────────────
function EquityChart({ data }: { data: any[] }) {
  if (!data.length) return <div className="text-[12px] text-slate-gray">No equity data yet.</div>;
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="hsl(var(--ink-line))" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="date" stroke="hsl(var(--slate-gray))" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" stroke="hsl(var(--slate-gray))" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--slate-gray))" fontSize={10} tickLine={false} axisLine={false} domain={[-30, 0]} hide />
          <Tooltip contentStyle={{ background: "hsl(var(--ink-panel))", border: "1px solid hsl(var(--ink-line))", fontSize: 11, fontFamily: "JetBrains Mono" }} />
          <Area yAxisId="right" type="monotone" dataKey="dd" stroke="hsl(var(--signal-red))" fill="hsl(var(--signal-red) / 0.15)" strokeWidth={1} dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="equity" stroke="hsl(var(--neon-blue))" strokeWidth={1.5} dot={{ r: 2, fill: "hsl(var(--neon-blue))", strokeWidth: 0 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── LEAP Summary ───────────────────────────────────────────────────────────
function LeapSummary({ positions, reserve, equity, leapPct, leapValue }: any) {
  const nextTrigger = 500;
  const pctToTrigger = Math.min(100, (reserve / nextTrigger) * 100);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">Book Value</div>
          <div className="font-mono-num text-[18px] tabular-nums">${leapValue.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray">% Portfolio</div>
          <div className="font-mono-num text-[18px] tabular-nums">{leapPct.toFixed(2)}%</div>
        </div>
      </div>
      <div className="pt-2 border-t border-ink-line">
        <div className="text-[10px] uppercase tracking-wider text-slate-gray flex justify-between">
          <span>Reserve · next contract</span>
          <span className="font-mono tabular-nums">${reserve.toFixed(2)} / $500</span>
        </div>
        <div className="h-1.5 bg-ink-line mt-1.5 overflow-hidden">
          <div className="h-full bg-gold-lux" style={{ width: `${pctToTrigger}%` }} />
        </div>
      </div>
      <div className="text-[10px] text-slate-gray">
        {positions.length === 0 ? "No LEAP positions yet. Funded by 25% of every realized swing win." : `${positions.length} LEAP positions open.`}
      </div>
    </div>
  );
}

// ─── Expectancy ─────────────────────────────────────────────────────────────
function ExpectancyPanel({ expectancyValue, closed }: { expectancyValue: number; closed: Trade[] }) {
  const last20 = closed.slice(0, 20);
  const data = last20.map((t, i) => ({ i, r: t.rMultiple ?? 0 })).reverse();
  if (!last20.length) {
    return (
      <div className="space-y-3">
        <div className="font-mono-num text-[24px] tabular-nums">+0.00R</div>
        <div className="text-[11px] text-slate-gray">No closed trades yet. Target ≥ +0.35R per trade.</div>
        <div className="h-20 bg-ink-line/40 rounded-sm flex items-center justify-center text-[10px] text-slate-gray uppercase tracking-wider">
          Awaiting first closed trade
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className={`font-mono-num text-[24px] tabular-nums ${expectancyValue >= 0.35 ? "text-signal-green" : expectancyValue >= 0 ? "text-soft-white" : "text-signal-red"}`}>
        {fmtR(expectancyValue)}
      </div>
      <div className="text-[10px] text-slate-gray uppercase tracking-wider">20-trade rolling · target +0.35R</div>
      <div className="h-20">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <ReferenceLine y={0.35} stroke="hsl(var(--signal-green))" strokeDasharray="2 2" />
            <ReferenceLine y={0} stroke="hsl(var(--ink-line))" />
            <Bar dataKey="r" fill="hsl(var(--neon-blue))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Journal Queue ──────────────────────────────────────────────────────────
function JournalQueue({ openTrades, closedTrades }: { openTrades: Trade[]; closedTrades: Trade[] }) {
  const preTradePending = openTrades.filter(t => !t.thesis || t.thesis.length < 10);
  const postTradePending = closedTrades.filter(t => {
    if (!t.closedAt) return false;
    const hoursSince = (Date.now() - new Date(t.closedAt).getTime()) / 3600000;
    return hoursSince < 24 && (t.planFollowed == null || !t.lessonTag);
  });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-signal-red" />
        <span className="text-[12px]">Pre-trade pending</span>
        <span className="ml-auto font-mono-num tabular-nums">{preTradePending.length}</span>
      </div>
      <div className="flex items-center gap-2 py-1">
        <span className="inline-block w-2 h-2 rounded-full bg-signal-amber" />
        <span className="text-[12px]">Post-trade pending</span>
        <span className="ml-auto font-mono-num tabular-nums">{postTradePending.length}</span>
      </div>
      <div className="pt-2 border-t border-ink-line text-[10px] text-slate-gray">
        {preTradePending.length + postTradePending.length === 0 ? "Journal queue clear." : "Complete pending entries before next session."}
      </div>
    </div>
  );
}
