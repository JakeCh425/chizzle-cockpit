import { useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, Chip } from "@/components/Panel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Settings, Trade, SetupCandidateRow } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { validateTrade, fmtR, rMultiple, RISK_PCT, riskPctFromSettings, formatShares, type Regime } from "@/lib/engine";
import { TermTooltip } from "@/components/TermTooltip";
import { RiskChipPopover } from "@/components/RiskChipPopover";
import { decideDiscipline, defaultQualityFallback, type Quality, type RegimeCode } from "@shared/discipline";
import { Sparkles, RefreshCw, Trash2, Pencil } from "lucide-react";
import Sparkline from "@/components/charts/Sparkline";
import ZonePositionBar from "@/components/charts/ZonePositionBar";
import CandlestickChart, { type OHLCBar } from "@/components/charts/CandlestickChart";

// Build synthetic OHLC bars from a tick series (low-credit: no separate API call).
function ticksToOHLC(prices: number[], bucketSize = 8): OHLCBar[] {
  if (!prices.length) return [];
  const bars: OHLCBar[] = [];
  for (let i = 0; i < prices.length; i += bucketSize) {
    const slice = prices.slice(i, i + bucketSize);
    if (!slice.length) continue;
    bars.push({
      open: slice[0],
      high: Math.max(...slice),
      low: Math.min(...slice),
      close: slice[slice.length - 1],
    });
  }
  return bars;
}

const SETUPS = [
  { value: "TREND_PULLBACK", label: "Trend-Pullback" },
  { value: "BREAKOUT", label: "Breakout" },
];

const LESSON_TAGS = ["patience", "sizing", "stop-mgmt", "thesis", "regime", "none"];

export default function Trades() {
  const { toast } = useToast();
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: trades } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });
  const { data: setupsByTicker } = useQuery<Record<string, SetupCandidateRow[]>>({ queryKey: ["/api/setups"] });
  const openTrades = (trades || []).filter(t => t.status === "OPEN");
  const pendingTrades = (trades || []).filter(t => t.status === "PENDING");

  // Form state
  const [ticker, setTicker] = useState("");
  const [setup, setSetup] = useState("TREND_PULLBACK");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [t1, setT1] = useState("");
  const [t2, setT2] = useState("");
  const [thesis, setThesis] = useState("");
  const [emotionalState, setEmotionalState] = useState(7);
  const [autoFilledFrom, setAutoFilledFrom] = useState<string | null>(null);

  // Look up the actionable setup for the typed ticker (ARMED or IN_ZONE preferred)
  const tickerKey = ticker.trim().toUpperCase();
  const actionableCandidate: SetupCandidateRow | null = (() => {
    if (!tickerKey || !setupsByTicker) return null;
    const cands = setupsByTicker[tickerKey] || [];
    return (
      cands.find(c => c.state === "armed") ||
      cands.find(c => c.state === "in_zone") ||
      null
    );
  })();

  // Auto-fill on ticker change when an actionable candidate exists
  useEffect(() => {
    if (!actionableCandidate) return;
    if (autoFilledFrom === `${tickerKey}:${actionableCandidate.setup}`) return;
    if (actionableCandidate.entryZoneLow == null || actionableCandidate.entryZoneHigh == null) return;
    const midEntry = (actionableCandidate.entryZoneLow + actionableCandidate.entryZoneHigh) / 2;
    setSetup(actionableCandidate.setup === "breakout" ? "BREAKOUT" : "TREND_PULLBACK");
    setEntry(midEntry.toFixed(2));
    if (actionableCandidate.stop != null) setStop(actionableCandidate.stop.toFixed(2));
    if (actionableCandidate.t1 != null) setT1(actionableCandidate.t1.toFixed(2));
    if (actionableCandidate.t2 != null) setT2(actionableCandidate.t2.toFixed(2));
    setAutoFilledFrom(`${tickerKey}:${actionableCandidate.setup}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey, actionableCandidate?.setup, actionableCandidate?.state]);

  // Clear the auto-fill badge when the user blanks the ticker
  useEffect(() => {
    if (!ticker) setAutoFilledFrom(null);
  }, [ticker]);

  const regime = ((settings?.regime as Regime | undefined) || "GREEN") as Regime;
  const equity = settings?.equity ?? 1000;

  // Discipline preview — regime × quality decides visibility + risk multiplier.
  // Quality is read from the auto-filled candidate if present, otherwise B fallback.
  const candidateQuality = ((actionableCandidate as any)?.quality as Quality | null) || defaultQualityFallback();
  const regimeLower = (regime as string).toLowerCase() as RegimeCode;
  const discipline = decideDiscipline(regimeLower, candidateQuality);

  // Live preview — use customRiskPct from settings so the % the user set actually flows through
  const riskMap = riskPctFromSettings(settings);
  const riskPctNum = riskMap[regime] * 100;
  const e = Number(entry || 0), s = Number(stop || 0), t1n = Number(t1 || 0);
  const preview = entry && stop && t1
    ? validateTrade({
        equity, regime, entry: e, stop: s, t1: t1n,
        existingPositions: openTrades.map(t => ({ entry: t.entry, stop: t.stop, shares: t.shares })),
        customRiskPct: riskMap,
      })
    : null;

  const submit = async () => {
    if (!ticker || !entry || !stop || !t1) {
      toast({ title: "Missing fields", description: "Ticker, entry, stop, T1 required." });
      return;
    }
    const v = validateTrade({
      equity, regime, entry: e, stop: s, t1: t1n,
      existingPositions: openTrades.map(t => ({ entry: t.entry, stop: t.stop, shares: t.shares })),
      customRiskPct: riskMap,
    });
    if (!v.ok) {
      toast({ title: "Trade rejected", description: v.reason });
      return;
    }
    // Armed trades land in PENDING. Confirm later once the order is placed in
    // the broker — only then do they count toward equity / analytics.
    await apiRequest("POST", "/api/trades", {
      ticker: ticker.toUpperCase(),
      setup,
      regimeAtEntry: regime,
      entry: e, stop: s, t1: t1n,
      t2: t2 ? Number(t2) : null,
      shares: v.shares,
      riskDollars: v.riskDollarsValue,
      rr: v.rr,
      thesis,
      emotionalState,
      openedAt: new Date().toISOString(),
    });
    await apiRequest("POST", "/api/alerts", {
      ticker: ticker.toUpperCase(), type: "TRADE ARMED",
      severity: "info",
      message: `${ticker.toUpperCase()} armed @ ${e.toFixed(2)} · stop ${s.toFixed(2)} · T1 ${t1n.toFixed(2)} · RR ${v.rr.toFixed(2)} · ${formatShares(v.shares)} sh — pending broker confirmation`,
      firedAt: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
    queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    toast({ title: "Trade armed", description: `${ticker.toUpperCase()} pending — confirm once placed in broker.` });
    setTicker(""); setEntry(""); setStop(""); setT1(""); setT2(""); setThesis(""); setAutoFilledFrom(null);
  };

  return (
    <div className="p-3 md:p-4 space-y-4">
      <div className="flex items-baseline gap-3 pb-1 border-b border-ink-line/60">
        <h1 className="font-display text-[15px] tracking-[0.2em] uppercase text-soft-white">Trades</h1>
        <span className="text-[10px] uppercase tracking-wider text-slate-gray">{openTrades.length} open · {(trades?.length ?? 0)} total</span>
      </div>
      {/* Form */}
      <Panel
        title="Log New Trade"
        hint={`Regime ${regime} · risk ${riskPctNum.toFixed(1)}% · min RR 2.0`}
        action={
          <div className="flex items-center gap-2">
            {autoFilledFrom && (
              <span
                data-testid="badge-auto-filled"
                className="flex items-center gap-1.5 px-2.5 py-1 border border-signal-green/40 text-signal-green bg-signal-green/10 text-[10px] uppercase tracking-wider rounded-sm font-display"
              >
                <Sparkles className="w-3 h-3" /> Auto-filled from setup detector
              </span>
            )}
            <button
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
                queryClient.invalidateQueries({ queryKey: ["/api/setups"] });
                queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
                queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
                toast({ title: "Refreshed", description: "Trades data re-fetched." });
              }}
              data-testid="button-refresh"
              title="Re-fetch trades + setups (no backend recompute)"
              className="flex items-center gap-1.5 px-2.5 py-1 border border-soft-white/30 text-soft-white bg-transparent text-[11px] uppercase tracking-wider rounded-sm hover:bg-soft-white/10"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Field label="Ticker">
            <input
              type="text" data-testid="input-trade-ticker"
              value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
              className="form-input" placeholder="AAPL"
            />
          </Field>
          <Field label="Setup">
            <select value={setup} onChange={e => setSetup(e.target.value)} className="form-input">
              {SETUPS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Entry">
            <input type="number" step="0.01" data-testid="input-trade-entry" value={entry} onChange={e => setEntry(e.target.value)} className="form-input num" />
          </Field>
          <Field label="Stop">
            <input type="number" step="0.01" data-testid="input-trade-stop" value={stop} onChange={e => setStop(e.target.value)} className="form-input num" />
          </Field>
          <Field label="T1">
            <input type="number" step="0.01" data-testid="input-trade-t1" value={t1} onChange={e => setT1(e.target.value)} className="form-input num" />
          </Field>
          <Field label="T2 (optional)">
            <input type="number" step="0.01" data-testid="input-trade-t2" value={t2} onChange={e => setT2(e.target.value)} className="form-input num" />
          </Field>
          <Field label="Emotional State (1–10)">
            <input type="number" min="1" max="10" data-testid="input-trade-emotion" value={emotionalState} onChange={e => setEmotionalState(Number(e.target.value))} className="form-input num" />
          </Field>
          <div className="col-span-2 md:col-span-5">
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Thesis</label>
            <textarea
              data-testid="input-trade-thesis" value={thesis} onChange={e => setThesis(e.target.value)}
              className="form-input form-textarea mt-1 w-full h-14 resize-none" placeholder="One sentence: why this, why now, what invalidates it."
            />
          </div>
        </div>

        {/* Discipline preview — regime × quality */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span
            data-testid="badge-discipline-grade"
            className="inline-flex items-center px-2 py-0.5 border border-neon-blue/40 bg-neon-blue/10 text-neon-blue text-[10px] uppercase tracking-wider font-display rounded-sm"
          >
            Grade {candidateQuality}
          </span>
          {/* Clickable risk % chip — cycles 1-10%, persists to settings for active regime */}
          <RiskChipPopover valuePct={riskPctNum} regime={regime} testId="chip-trades-risk-pct" />
          <span
            data-testid="badge-discipline-risk"
            className={`inline-flex items-center px-2 py-0.5 border text-[10px] uppercase tracking-wider font-display rounded-sm ${
              discipline.riskMultiplier === 0
                ? "border-signal-red/40 bg-signal-red/10 text-signal-red"
                : discipline.riskMultiplier < 1
                  ? "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"
                  : "border-signal-green/40 bg-signal-green/10 text-signal-green"
            }`}
          >
            Risk × {discipline.riskMultiplier.toFixed(1)}
          </span>
          {discipline.blockedReason && (
            <span data-testid="text-discipline-blocked" className="text-[11px] text-signal-red">
              {discipline.blockedReason}
            </span>
          )}
          {discipline.dimReason && (
            <span data-testid="text-discipline-dim" className="text-[11px] text-signal-amber">
              {discipline.dimReason}
            </span>
          )}
          {!actionableCandidate && (
            <span className="text-[10px] text-slate-gray font-mono">(grade defaults to B until classifier wired)</span>
          )}
        </div>

        {/* Live preview */}
        {preview && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 border-t border-ink-line pt-3">
            <Stat label={<TermTooltip term="Per-Share Risk" />} value={`$${preview.perShareRiskValue.toFixed(2)}`} />
            <Stat
              label={<TermTooltip term="Risk $ (× mult)" />}
              value={`$${(preview.riskDollarsValue * discipline.riskMultiplier).toFixed(2)}`}
              tone={discipline.riskMultiplier === 0 ? "red" : discipline.riskMultiplier < 1 ? "amber" : "neutral"}
            />
            <Stat label={<TermTooltip term="Shares" />} value={formatShares(preview.shares)} />
            <Stat label={<TermTooltip term="Notional" />} value={`$${preview.notional.toFixed(2)}`} />
            <Stat label={<TermTooltip term="RR" />} value={preview.rr.toFixed(2)} tone={preview.rr >= 2 ? "green" : "red"} />
            <Stat label={<TermTooltip term="New Open Risk %" />} value={`${preview.newOpenRiskPct.toFixed(2)}%`} tone={preview.newOpenRiskPct > 6 ? "red" : preview.newOpenRiskPct > 5 ? "amber" : "neutral"} />
            {!preview.ok && (
              <div className="col-span-2 md:col-span-6 bg-signal-red/10 border border-signal-red/40 px-3 py-2 text-[12px] text-signal-red font-display tracking-wider uppercase rounded-sm">
                {preview.reason}
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            onClick={submit}
            data-testid="button-submit-trade"
            disabled={!!(preview && !preview.ok)}
            className="px-4 py-2 border border-neon-blue/60 bg-neon-blue/20 text-neon-blue text-[12px] uppercase tracking-wider font-display rounded-sm hover:bg-neon-blue/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Arm Trade
          </button>
        </div>
      </Panel>

      {/* Pending (armed but not confirmed in broker) */}
      {pendingTrades.length > 0 && (
        <Panel
          title="Pending Confirmation"
          hint={`${pendingTrades.length} awaiting broker fill · Confirm once placed, Discard if not`}
        >
          <PendingTradesList trades={pendingTrades} />
        </Panel>
      )}

      {/* Open Positions Detail with charts */}
      {openTrades.length > 0 && (
        <Panel title="Open Positions" hint={`${openTrades.length} active`}>
          <OpenPositionsDetail trades={openTrades} />
        </Panel>
      )}

      {/* History */}
      <Panel title="Trade History" hint={`${trades?.length ?? 0} total · ${openTrades.length} open`}>
        <TradesTable trades={trades || []} />
      </Panel>

      <style>{`
        .form-input {
          background: hsl(var(--ink-black));
          border: 1px solid hsl(var(--ink-line));
          border-radius: 2px;
          padding: 6px 10px;
          font-size: 13px;
          color: hsl(var(--soft-white));
          width: 100%;
          outline: none;
          margin-top: 4px;
          transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
        }
        .form-input:hover { border-color: hsl(var(--ink-line) / 1.4); }
        .form-input:focus {
          border-color: hsl(var(--neon-blue) / 0.6);
          box-shadow: 0 0 0 1px hsl(var(--neon-blue) / 0.35);
          background: hsl(var(--ink-black));
        }
        .form-input.num { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; text-align: right; }
        .form-textarea { background: hsl(var(--ink-deep) / 0.55); line-height: 1.4; }
        .form-textarea:focus { background: hsl(var(--ink-black)); }
        .form-input::placeholder { color: hsl(var(--slate-gray) / 0.55); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: ReactNode; value: string; tone?: "green" | "amber" | "red" | "neutral" }) {
  const color = tone === "green" ? "text-signal-green" : tone === "amber" ? "text-signal-amber" : tone === "red" ? "text-signal-red" : "text-soft-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-gray">{label}</div>
      <div className={`font-mono-num tabular-nums text-[15px] ${color}`}>{value}</div>
    </div>
  );
}

// ─── open positions detail with charts ──────────────────────────────────────
function OpenPositionsDetail({ trades }: { trades: Trade[] }) {
  const { data: prices } = useQuery<Record<string, { price: number }>>({ queryKey: ["/api/prices"] });
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingTrade = editingId != null ? trades.find(t => t.id === editingId) ?? null : null;
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {trades.map(t => (
          <OpenPositionCard key={t.id} trade={t} livePrice={prices?.[t.ticker]?.price} onEdit={() => setEditingId(t.id)} />
        ))}
      </div>
      {editingTrade && (
        <EditTradeDialog trade={editingTrade} onClose={() => setEditingId(null)} />
      )}
    </>
  );
}

function OpenPositionCard({ trade, livePrice, onEdit }: { trade: Trade; livePrice?: number; onEdit?: () => void }) {
  const lp = livePrice ?? trade.entry;
  const r = (lp - trade.entry) / (trade.entry - trade.stop || 1);
  const pnl = (lp - trade.entry) * trade.shares;
  const days = Math.floor((Date.now() - new Date(trade.openedAt).getTime()) / 86400000);
  // Tick series for sparkline (manual, single fetch on mount; no polling).
  const { data: ticks } = useQuery<Array<{ price: number; ts: number }>>({
    queryKey: [`/api/price-ticks/${trade.ticker}`, 100],
    queryFn: async () => {
      const r = await fetch(`/api/price-ticks/${trade.ticker}?limit=100`);
      if (!r.ok) return [];
      return r.json();
    },
  });
  const series = (ticks || []).map(t => t.price);
  // Zone span — use stop..max(t2,t1,entry) so the bar visually shows the full plan.
  const planHigh = Math.max(trade.t1 ?? trade.entry, trade.t2 ?? trade.t1 ?? trade.entry, trade.entry);
  const planLow = Math.min(trade.stop, trade.entry);
  return (
    <div className="border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-mono-num text-[14px] text-soft-white">{trade.ticker}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">{trade.setup === "BREAKOUT" ? "Breakout" : "Trend"} · {days}d</span>
          {onEdit && (
            <button
              onClick={onEdit}
              data-testid={`button-edit-trade-${trade.id}`}
              title="Edit trade"
              aria-label={`Edit ${trade.ticker}`}
              className="p-1 border border-ink-line rounded-sm hover:bg-neon-blue/10 hover:border-neon-blue/60 hover:text-neon-blue text-slate-gray transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <ZonePositionBar
            low={planLow}
            high={planHigh}
            current={lp}
            stopLevel={trade.stop}
            t1={trade.t1 ?? null}
            t2={trade.t2 ?? null}
            width={260}
            height={26}
            showLabels
          />
        </div>
        <Sparkline data={series} width={80} height={26} stroke="auto" />
      </div>
      {series.length >= 8 && (
        <div className="mt-1">
          <CandlestickChart
            bars={ticksToOHLC(series, 8)}
            width={360}
            height={90}
            levels={[
              { price: trade.entry, color: "#94a3b8", label: "Entry" },
              { price: trade.stop, color: "#ef4444", label: "Stop" },
              ...(trade.t1 != null ? [{ price: trade.t1, color: "#a3e635", label: "T1" }] : []),
              ...(trade.t2 != null ? [{ price: trade.t2, color: "#22c55e", label: "T2" }] : []),
            ]}
          />
        </div>
      )}
      <div className="grid grid-cols-5 gap-2 text-[11px]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="LP" /></div>
          <div className="font-mono-num tabular-nums text-soft-white">{lp.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="Entry" /></div>
          <div className="font-mono-num tabular-nums text-soft-white/80">{trade.entry.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="Stop" /></div>
          <div className="font-mono-num tabular-nums text-signal-red/80">{trade.stop.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="R" /></div>
          <div className={`font-mono-num tabular-nums ${r > 0 ? "text-signal-green" : r < 0 ? "text-signal-red" : "text-soft-white/80"}`}>{fmtR(r)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="P/L $" /></div>
          <div className={`font-mono-num tabular-nums ${pnl > 0 ? "text-signal-green" : pnl < 0 ? "text-signal-red" : "text-soft-white/80"}`}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── trades table with close modal ──────────────────────────────────────────
function PendingTradesList({ trades }: { trades: Trade[] }) {
  const { toast } = useToast();
  const confirmTrade = async (t: Trade) => {
    try {
      await apiRequest("POST", `/api/trades/${t.id}/confirm`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Confirmed", description: `${t.ticker} is now OPEN.` });
    } catch (e: any) {
      toast({ title: "Confirm failed", description: e?.message || String(e) });
    }
  };
  const discardTrade = async (t: Trade) => {
    if (!confirm(`Discard armed ${t.ticker}? It will be archived (not placed in broker).`)) return;
    try {
      await apiRequest("POST", `/api/trades/${t.id}/discard`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      toast({ title: "Discarded", description: `${t.ticker} removed from pending.` });
    } catch (e: any) {
      toast({ title: "Discard failed", description: e?.message || String(e) });
    }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {trades.map(t => (
        <div key={t.id} className="border border-signal-amber/40 bg-signal-amber/5 rounded-sm p-3 flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className="font-mono-num text-[14px] text-soft-white">{t.ticker}</span>
              <Chip tone="amber">PENDING</Chip>
              <Chip tone={t.regimeAtEntry === "GREEN" ? "green" : t.regimeAtEntry === "YELLOW" ? "amber" : "red"}>{t.regimeAtEntry}</Chip>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-slate-gray">{t.setup === "BREAKOUT" ? "Breakout" : "Trend"}</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[11px]">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="Entry" /></div>
              <div className="font-mono-num tabular-nums text-soft-white">{t.entry.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="Stop" /></div>
              <div className="font-mono-num tabular-nums text-signal-red/80">{t.stop.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="T1" /></div>
              <div className="font-mono-num tabular-nums text-soft-white">{t.t1.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-gray"><TermTooltip term="Shares" /></div>
              <div className="font-mono-num tabular-nums text-soft-white">{formatShares(t.shares)}</div>
            </div>
          </div>
          {t.thesis && (
            <div className="text-[11px] text-slate-gray italic border-l border-ink-line/60 pl-2">{t.thesis}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => discardTrade(t)}
              data-testid={`button-discard-trade-${t.id}`}
              className="px-3 py-1 border border-ink-line text-[11px] uppercase tracking-wider rounded-sm hover:bg-ink-line/40 text-slate-gray"
            >
              Discard
            </button>
            <button
              onClick={() => confirmTrade(t)}
              data-testid={`button-confirm-trade-${t.id}`}
              className="px-3 py-1 border border-signal-green/60 bg-signal-green/20 text-signal-green text-[11px] uppercase tracking-wider rounded-sm hover:bg-signal-green/30"
            >
              Confirm Filled
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TradesTable({ trades }: { trades: Trade[] }) {
  const { toast } = useToast();
  const [closingId, setClosingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const archive = async (t: Trade) => {
    if (!confirm(`Archive ${t.ticker}? You can restore it later from Settings.`)) return;
    try {
      await apiRequest("POST", `/api/trades/${t.id}/archive`, {});
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      toast({ title: "Archived", description: `${t.ticker} hidden from main view.` });
    } catch (e: any) {
      toast({ title: "Archive failed", description: e?.message || String(e) });
    }
  };
  if (!trades.length) {
    return <div className="text-[12px] text-slate-gray py-4">No trades logged yet.</div>;
  }
  return (
    <>
      <div className="overflow-x-auto -m-3.5">
        <table className="w-full text-[12px] min-w-0">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-gray">
              <th className="text-left px-3 py-2"><TermTooltip term="Ticker" /></th>
              <th className="text-left px-2"><TermTooltip term="Setup" /></th>
              <th className="text-left px-2"><TermTooltip term="Regime" /></th>
              <th className="text-right px-2"><TermTooltip term="Entry" /></th>
              <th className="text-right px-2"><TermTooltip term="Exit" /></th>
              <th className="text-right px-2"><TermTooltip term="Shares" /></th>
              <th className="text-right px-2"><TermTooltip term="R" /></th>
              <th className="text-right px-2"><TermTooltip term="Hold (d)" /></th>
              <th className="text-left px-2"><TermTooltip term="Plan" /></th>
              <th className="text-left px-2"><TermTooltip term="Lesson" /></th>
              <th className="text-left px-2"><TermTooltip term="Status" /></th>
              <th className="text-right px-2 sticky right-0 bg-ink-panel"><TermTooltip term="Actions" /></th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => {
              const days = t.closedAt
                ? Math.floor((new Date(t.closedAt).getTime() - new Date(t.openedAt).getTime()) / 86400000)
                : Math.floor((Date.now() - new Date(t.openedAt).getTime()) / 86400000);
              const r = t.rMultiple ?? 0;
              return (
                <tr key={t.id} className="border-t border-ink-line/60">
                  <td className="px-3 py-2 font-mono-num">{t.ticker}</td>
                  <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-slate-gray">{t.setup === "BREAKOUT" ? "Breakout" : "Trend"}</td>
                  <td className="px-2 py-2">
                    <Chip tone={t.regimeAtEntry === "GREEN" ? "green" : t.regimeAtEntry === "YELLOW" ? "amber" : "red"}>{t.regimeAtEntry}</Chip>
                  </td>
                  <td className="px-2 py-2 text-right font-mono-num tabular-nums">{t.entry.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right font-mono-num tabular-nums">{t.exit?.toFixed(2) ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-mono-num tabular-nums">{formatShares(t.shares)}</td>
                  <td className={`px-2 py-2 text-right font-mono-num tabular-nums ${r > 0 ? "text-signal-green" : r < 0 ? "text-signal-red" : ""}`}>{t.status === "CLOSED" ? fmtR(r) : "—"}</td>
                  <td className="px-2 py-2 text-right font-mono-num tabular-nums text-slate-gray">{days}</td>
                  <td className="px-2 py-2">{t.planFollowed == null ? "—" : t.planFollowed ? <Chip tone="green">Y</Chip> : <Chip tone="red">N</Chip>}</td>
                  <td className="px-2 py-2 text-[10px] text-slate-gray">{t.lessonTag ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Chip tone={t.status === "OPEN" ? "blue" : t.status === "PENDING" ? "amber" : t.status === "DISCARDED" ? "red" : "neutral"}>{t.status}</Chip>
                  </td>
                  <td className="px-2 py-2 text-right sticky right-0 bg-ink-panel">
                    <div className="flex justify-end gap-1">
                      {t.status === "OPEN" && (
                        <>
                          <button
                            onClick={() => setEditingId(t.id)}
                            data-testid={`button-edit-trade-${t.id}`}
                            title="Edit trade"
                            aria-label={`Edit ${t.ticker}`}
                            className="p-1.5 border border-ink-line rounded-sm hover:bg-neon-blue/10 hover:border-neon-blue/60 hover:text-neon-blue text-slate-gray transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setClosingId(t.id)}
                            data-testid={`button-close-trade-${t.id}`}
                            className="px-2 py-1 border border-ink-line rounded-sm text-[10px] uppercase tracking-wider hover:bg-ink-line/40"
                          >
                            Close
                          </button>
                        </>
                      )}
                      {t.status !== "PENDING" && (
                        <button
                          onClick={() => archive(t)}
                          data-testid={`button-archive-trade-${t.id}`}
                          title="Archive (soft delete — recoverable in Settings)"
                          aria-label={`Archive ${t.ticker}`}
                          className="p-1.5 border border-ink-line rounded-sm hover:bg-signal-red/10 hover:border-signal-red/60 hover:text-signal-red text-slate-gray transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {closingId != null && (
        <CloseModal id={closingId} trade={trades.find(t => t.id === closingId)!} onClose={() => setClosingId(null)} />
      )}
      {editingId != null && trades.find(t => t.id === editingId) && (
        <EditTradeDialog trade={trades.find(t => t.id === editingId)!} onClose={() => setEditingId(null)} />
      )}
    </>
  );
}

function CloseModal({ id, trade, onClose }: { id: number; trade: Trade; onClose: () => void }) {
  const [exit, setExit] = useState("");
  const [reason, setReason] = useState("T1");
  const [planFollowed, setPlanFollowed] = useState(true);
  const [lessonTag, setLessonTag] = useState("none");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const r = exit ? rMultiple(trade.entry, trade.stop, Number(exit)) : 0;

  const submit = async () => {
    if (!exit) {
      toast({ title: "Exit price required" });
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", `/api/trades/${id}/close`, {
        exit: Number(exit), exitReason: reason, planFollowed, lessonTag,
      });
      // Alert is non-critical — don't block on failure
      try {
        await apiRequest("POST", "/api/alerts", {
          ticker: trade.ticker, type: reason === "stop" ? "STOP HIT" : "TRADE CLOSED",
          severity: reason === "stop" ? "critical" : (r > 0 ? "info" : "action"),
          message: `${trade.ticker} closed @ ${Number(exit).toFixed(2)} · R ${r.toFixed(2)} · ${reason}`,
          firedAt: new Date().toISOString(),
        });
      } catch (alertErr) {
        console.warn("alert log failed (non-critical):", alertErr);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equity-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leap-reserve"] });
      toast({ title: "Trade closed", description: `${trade.ticker} R ${r.toFixed(2)}` });
      onClose();
    } catch (err: any) {
      console.error("close trade failed:", err);
      toast({ title: "Close failed", description: err?.message || String(err) });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ink-panel border border-ink-line rounded-sm w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-[13px] uppercase tracking-widest mb-4">Close {trade.ticker}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Exit Price</label>
            <input type="number" step="0.01" value={exit} onChange={e => setExit(e.target.value)} data-testid="input-close-exit" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
            <div className="text-[11px] text-slate-gray mt-1">R = <span className={`font-mono-num ${r > 0 ? "text-signal-green" : r < 0 ? "text-signal-red" : ""}`}>{fmtR(r)}</span></div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Exit Reason</label>
            <select value={reason} onChange={e => setReason(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm text-[13px]">
              <option value="T1">T1</option><option value="T2">T2</option><option value="stop">Stop</option><option value="time">Time</option><option value="manual">Manual</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Plan Followed?</label>
            <div className="mt-1 flex gap-2">
              <button onClick={() => setPlanFollowed(true)} className={`px-3 py-1 border rounded-sm text-[11px] uppercase tracking-wider ${planFollowed ? "bg-signal-green/20 border-signal-green text-signal-green" : "border-ink-line text-slate-gray"}`}>Yes</button>
              <button onClick={() => setPlanFollowed(false)} className={`px-3 py-1 border rounded-sm text-[11px] uppercase tracking-wider ${!planFollowed ? "bg-signal-red/20 border-signal-red text-signal-red" : "border-ink-line text-slate-gray"}`}>No</button>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Lesson Tag</label>
            <select value={lessonTag} onChange={e => setLessonTag(e.target.value)} className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm text-[13px]">
              {LESSON_TAGS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 border border-ink-line text-[11px] uppercase tracking-wider rounded-sm">Cancel</button>
          <button onClick={submit} disabled={submitting} data-testid="button-confirm-close" className="px-3 py-1.5 border border-neon-blue bg-neon-blue text-ink-black font-semibold text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/90 cursor-pointer disabled:opacity-60 disabled:cursor-wait">{submitting ? "Closing..." : "Confirm Close"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── edit trade dialog ──────────────────────────────────────────────────────
function EditTradeDialog({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const [entry, setEntry] = useState(String(trade.entry));
  const [stop, setStop] = useState(String(trade.stop));
  const [t1, setT1] = useState(trade.t1 != null ? String(trade.t1) : "");
  const [t2, setT2] = useState(trade.t2 != null ? String(trade.t2) : "");
  const [shares, setShares] = useState(String(trade.shares));
  const [setupVal, setSetupVal] = useState<string>(trade.setup);
  const [emotionalState, setEmotionalState] = useState<string>(
    trade.emotionalState != null ? String(trade.emotionalState) : ""
  );
  const [thesis, setThesis] = useState(trade.thesis ?? "");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  // Preview R-multiple at T1 / T2 using edited values
  const entryNum = Number(entry);
  const stopNum = Number(stop);
  const t1Num = t1 ? Number(t1) : null;
  const t2Num = t2 ? Number(t2) : null;
  const riskPerShare = Math.abs(entryNum - stopNum);
  const rAtT1 = t1Num != null && riskPerShare > 0 ? (t1Num - entryNum) / (entryNum - stopNum || 1) : null;
  const rAtT2 = t2Num != null && riskPerShare > 0 ? (t2Num - entryNum) / (entryNum - stopNum || 1) : null;

  const submit = async () => {
    // Light validation only — we let the user edit freely. The backend is
    // the source of truth for hard rules (regime gate is intentionally
    // skipped on PATCH so already-open trades can always be adjusted).
    if (!entry || !stop || !shares) {
      toast({ title: "Entry, stop, and shares are required" });
      return;
    }
    if (Number.isNaN(entryNum) || Number.isNaN(stopNum)) {
      toast({ title: "Entry and stop must be numbers" });
      return;
    }
    const sharesNum = Number(shares);
    if (Number.isNaN(sharesNum) || sharesNum <= 0) {
      toast({ title: "Shares must be a positive number" });
      return;
    }
    if (entryNum === stopNum) {
      toast({ title: "Entry and stop must differ" });
      return;
    }
    let emoNum: number | null = null;
    if (emotionalState !== "") {
      emoNum = Number(emotionalState);
      if (Number.isNaN(emoNum) || emoNum < 1 || emoNum > 10) {
        toast({ title: "Emotional state must be 1-10" });
        return;
      }
    }

    if (submitting) return;
    setSubmitting(true);
    try {
      // Note: thesis & emotionalState are NOT NULL in the DB schema (default ""
      // and 5 respectively). Send safe defaults rather than null to avoid
      // a Postgres NOT NULL constraint violation.
      const patch: Record<string, unknown> = {
        entry: entryNum,
        stop: stopNum,
        t1: t1Num,
        // t2 is nullable on the column — null is fine when cleared.
        t2: t2Num,
        shares: Math.round(sharesNum * 100) / 100,
        setup: setupVal,
        thesis: thesis.trim(),
      };
      if (emoNum != null) patch.emotionalState = emoNum;
      await apiRequest("PATCH", `/api/trades/${trade.id}`, patch);
      queryClient.invalidateQueries({ queryKey: ["/api/trades"] });
      toast({ title: "Trade updated", description: `${trade.ticker} saved.` });
      onClose();
    } catch (err: any) {
      console.error("edit trade failed:", err);
      toast({ title: "Edit failed", description: err?.message || String(err) });
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-ink-panel border border-ink-line rounded-sm w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-[13px] uppercase tracking-widest mb-4">Edit {trade.ticker}</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">Entry</label>
              <input type="number" step="0.01" value={entry} onChange={e => setEntry(e.target.value)} data-testid="input-edit-entry" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">Stop</label>
              <input type="number" step="0.01" value={stop} onChange={e => setStop(e.target.value)} data-testid="input-edit-stop" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">T1</label>
              <input type="number" step="0.01" value={t1} onChange={e => setT1(e.target.value)} data-testid="input-edit-t1" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
              {rAtT1 != null && (
                <div className="text-[10px] text-slate-gray mt-1">R @ T1 = <span className={`font-mono-num ${rAtT1 > 0 ? "text-signal-green" : "text-signal-red"}`}>{fmtR(rAtT1)}</span></div>
              )}
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">T2 <span className="text-slate-gray/60 normal-case">(optional)</span></label>
              <input type="number" step="0.01" value={t2} onChange={e => setT2(e.target.value)} data-testid="input-edit-t2" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
              {rAtT2 != null && (
                <div className="text-[10px] text-slate-gray mt-1">R @ T2 = <span className={`font-mono-num ${rAtT2 > 0 ? "text-signal-green" : "text-signal-red"}`}>{fmtR(rAtT2)}</span></div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">Shares</label>
              <input type="number" step="0.01" value={shares} onChange={e => setShares(e.target.value)} data-testid="input-edit-shares" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-gray">Setup</label>
              <select value={setupVal} onChange={e => setSetupVal(e.target.value)} data-testid="select-edit-setup" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm text-[13px]">
                {SETUPS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Emotional State (1-10) <span className="text-slate-gray/60 normal-case">(optional)</span></label>
            <input type="number" min="1" max="10" step="1" value={emotionalState} onChange={e => setEmotionalState(e.target.value)} data-testid="input-edit-emotional-state" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm font-mono-num tabular-nums" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-gray">Thesis</label>
            <textarea value={thesis} onChange={e => setThesis(e.target.value)} rows={3} data-testid="textarea-edit-thesis" className="w-full mt-1 px-3 py-1.5 bg-ink-black border border-ink-line rounded-sm text-[12px] resize-y" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 border border-ink-line text-[11px] uppercase tracking-wider rounded-sm">Cancel</button>
          <button onClick={submit} disabled={submitting} data-testid="button-confirm-edit" className="px-3 py-1.5 border border-neon-blue bg-neon-blue text-ink-black font-semibold text-[11px] uppercase tracking-wider rounded-sm hover:bg-neon-blue/90 cursor-pointer disabled:opacity-60 disabled:cursor-wait">{submitting ? "Saving..." : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}
