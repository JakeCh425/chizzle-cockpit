// ─── Bull Bar Monitor Panel ─────────────────────────────────────────────────
// Strong Bull Bar After Cluster of Lows — 1H pattern across watchlist symbols.
// Mirrors the SMH Hammer Monitor design language. Pulls from /api/bull-bar-monitor.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatShares } from "@/lib/engine";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";
import { buildPlannerHref } from "@/lib/planLink";

type Phase =
  | "Scanning"
  | "Bull Bar Forming"
  | "Confirmed Bull Bar"
  | "Ready to Trade"
  | "Invalidated";

type TradeMode = "conservative" | "aggressive";

const RR_OPTIONS: Array<{ v: number; label: string; tip: string }> = [
  { v: 2, label: "1:2", tip: "Standard Trend-Pullback — default, highest win rate" },
  { v: 3, label: "1:3", tip: "Strong Trend — use when higher timeframes align" },
  { v: 4, label: "1:4", tip: "Momentum Breakout — only on A+ setups" },
  { v: 5, label: "1:5", tip: "Trend-to-Momentum — rare; only with partials locked" },
];

const SYMBOL_OPTIONS = ["SMH", "QQQ", "SPY", "AAPL"];

interface BullBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  body_pct: number;
  close_position: number;
  is_closed: boolean;
}

interface Cluster {
  swing_low: number;
  bar_count: number;
  red_count: number;
  band_pct: number;
  start_timestamp: string;
}

interface Confirmation {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  broke_high: boolean;
  broke_low: boolean;
  is_closed: boolean;
}

interface TradePlan {
  entry: number;
  stop_loss: number;
  risk_per_share: number;
  target: number;
  reward_per_share: number;
  risk_reward: number;
}

interface MonitorState {
  symbol: string;
  timeframe: "1H";
  phase: Phase;
  mode: TradeMode;
  rr: number;
  price: number;
  asof: string;
  market_open: boolean;
  daily_sma20: number;
  sma20_distance_pct: number;
  in_pullback_band: boolean;
  decline_pct: number;
  has_decline: boolean;
  cluster: Cluster | null;
  bull_bar: BullBar | null;
  confirmation: Confirmation | null;
  trade_plan: TradePlan | null;
  notes: string;
  alert_emitted?: boolean;
}

const phaseStyle: Record<Phase, string> = {
  "Ready to Trade":     "border-signal-green/70 bg-signal-green/15 text-signal-green",
  "Confirmed Bull Bar": "border-signal-blue/60 bg-signal-blue/10 text-signal-blue",
  "Bull Bar Forming":   "border-signal-amber/70 bg-signal-amber/15 text-signal-amber",
  "Scanning":           "border-ink-line/50 bg-ink-deep/20 text-slate-gray",
  "Invalidated":        "border-signal-red/60 bg-signal-red/10 text-signal-red",
};

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function fmtVol(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function BullBarMonitor() {
  const [symbol, setSymbol] = useState<string>("SMH");
  const [mode, setMode] = useState<TradeMode>("conservative");
  const [rr, setRr] = useState<number>(2);

  const { data, isLoading, error, refetch, isFetching } = useQuery<MonitorState>({
    queryKey: ["/api/bull-bar-monitor", symbol, mode, rr],
    queryFn: () =>
      apiRequest("GET", `/api/bull-bar-monitor?symbol=${symbol}&mode=${mode}&rr=${rr}`).then((r) => r.json()),
    refetchInterval: 60_000,
  });

  // Shares-to-buy context: equity × day-color risk % ÷ risk_per_share.
  const sharesCtx = useSharesContext();

  if (isLoading) {
    return <div className="text-xs text-slate-gray py-3">Loading bull bar monitor…</div>;
  }
  if (error || !data) {
    return <div className="text-xs text-signal-red py-3">Failed to load bull bar monitor.</div>;
  }

  const s = data;
  const phaseCls = phaseStyle[s.phase];

  return (
    <div className="space-y-3" data-testid="bull-bar-monitor">
      {/* Header row: symbol selector, phase, price */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="font-mono text-lg font-semibold tracking-wide bg-ink-deep/40 border border-ink-line/40 rounded px-2 py-0.5 hover:border-signal-blue/40 focus:outline-none focus:border-signal-blue/70"
            data-testid="select-bullbar-symbol"
          >
            {SYMBOL_OPTIONS.map((sym) => (
              <option key={sym} value={sym}>{sym}</option>
            ))}
          </select>
          <span className="font-mono text-sm text-slate-gray">${fmt(s.price)}</span>
          <span
            className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${phaseCls}`}
            data-testid="badge-bullbar-phase"
          >
            {s.phase}
          </span>
          <span className="inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium border-signal-blue/40 bg-signal-blue/5 text-signal-blue/80">
            1H
          </span>
          <span className="text-[10px] text-slate-gray">
            {s.market_open ? "● market open" : "○ market closed"}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] px-2 py-1 rounded border border-ink-line/50 hover:border-signal-blue/60 hover:text-signal-blue transition-colors disabled:opacity-50"
          data-testid="button-refresh-bullbar"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4 flex-wrap text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-slate-gray uppercase tracking-wide text-[10px]">Mode</span>
          <label className="inline-flex items-center gap-1 cursor-pointer" data-testid="toggle-bullbar-mode">
            <input
              type="checkbox"
              className="accent-signal-amber"
              checked={mode === "aggressive"}
              onChange={(e) => setMode(e.target.checked ? "aggressive" : "conservative")}
            />
            <span className={mode === "aggressive" ? "text-signal-amber" : "text-slate-gray"}>
              Aggressive (Ready to Trade immediately on confirmed close)
            </span>
          </label>
        </div>

        <div className="flex items-center gap-2" data-testid="selector-bullbar-rr">
          <span className="text-slate-gray uppercase tracking-wide text-[10px]">Target R:R</span>
          {RR_OPTIONS.map(({ v, label, tip }) => (
            <button
              key={v}
              onClick={() => setRr(v)}
              title={tip}
              className={`px-2 py-0.5 rounded border text-[11px] font-mono transition-colors ${
                rr === v
                  ? "border-signal-blue/70 bg-signal-blue/15 text-signal-blue"
                  : "border-ink-line/50 text-slate-gray hover:border-signal-blue/40"
              }`}
              data-testid={`button-bullbar-rr-${v}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="text-xs text-slate-gray leading-relaxed" data-testid="text-bullbar-notes">
        {s.notes}
      </div>

      {/* Grid: gates | cluster | bull bar | trade plan */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Setup Gates */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">Setup Gates</div>
          <div className="space-y-1 text-xs font-mono">
            <Row
              label="SMA20 band"
              value={`${fmtPct(s.sma20_distance_pct)} of $${fmt(s.daily_sma20)}`}
              valueCls={s.in_pullback_band ? "text-signal-green" : "text-signal-red"}
            />
            <Row
              label="Decline"
              value={fmtPct(s.decline_pct)}
              valueCls={s.has_decline ? "text-signal-green" : "text-slate-gray"}
            />
            <Row
              label="In pullback?"
              value={s.in_pullback_band ? "Yes" : "No"}
              valueCls={s.in_pullback_band ? "text-signal-green" : "text-signal-red"}
            />
          </div>
        </div>

        {/* Cluster of Lows */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">Cluster of Lows</div>
          {!s.cluster ? (
            <div className="text-xs text-slate-gray">No qualifying cluster yet.</div>
          ) : (
            <div className="space-y-1 text-xs font-mono" data-testid="block-cluster">
              <Row label="Swing low" value={`$${fmt(s.cluster.swing_low)}`} />
              <Row label="Bars in cluster" value={`${s.cluster.bar_count}`} />
              <Row
                label="Red candles"
                value={`${s.cluster.red_count}`}
                valueCls={s.cluster.red_count >= 2 ? "text-signal-green" : "text-signal-amber"}
              />
              <Row label="Band" value={`±${fmt(s.cluster.band_pct)}%`} />
            </div>
          )}
        </div>

        {/* Bull Bar */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">Bull Bar</div>
          {!s.bull_bar ? (
            <div className="text-xs text-slate-gray">No bull bar detected yet.</div>
          ) : (
            <div className="space-y-1 text-xs font-mono" data-testid="block-bullbar">
              <Row label="Time" value={new Date(s.bull_bar.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
              <Row label="O / H / L / C" value={`${fmt(s.bull_bar.open)} / ${fmt(s.bull_bar.high)} / ${fmt(s.bull_bar.low)} / ${fmt(s.bull_bar.close)}`} />
              <Row
                label="Body %"
                value={`${(s.bull_bar.body_pct * 100).toFixed(0)}%`}
                valueCls={s.bull_bar.body_pct >= 0.60 ? "text-signal-green" : "text-signal-amber"}
              />
              <Row
                label="Close in range"
                value={`top ${(100 - s.bull_bar.close_position * 100).toFixed(0)}%`}
                valueCls={s.bull_bar.close_position >= 0.75 ? "text-signal-green" : "text-signal-amber"}
              />
              <Row label="Volume" value={fmtVol(s.bull_bar.volume)} />
              <Row
                label="Status"
                value={s.bull_bar.is_closed ? "Closed" : "Live"}
                valueCls={s.bull_bar.is_closed ? "text-signal-green" : "text-signal-amber"}
              />
            </div>
          )}
        </div>

        {/* Trade Plan */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">
            Trade Plan (1:{rr} R:R)
          </div>
          {!s.trade_plan ? (
            <div className="text-xs text-slate-gray">
              {s.phase === "Confirmed Bull Bar"
                ? "Awaiting next 1H bar > bull-bar high."
                : s.phase === "Bull Bar Forming"
                ? "Awaiting bar close."
                : s.phase === "Invalidated"
                ? "Setup invalidated."
                : "No active setup."}
            </div>
          ) : (() => {
            const shares = sharesForPlan(sharesCtx, s.trade_plan.risk_per_share);
            const sharesValue = sharesCtx.equity > 0 && s.trade_plan.risk_per_share > 0 ? formatShares(shares) : "—";
            const sharesTitle = `${sharesCtx.regime} day · ${(sharesCtx.riskPct * 100).toFixed(2)}% of $${sharesCtx.equity.toFixed(2)} ÷ $${fmt(s.trade_plan!.risk_per_share)}/sh`;
            return (
              <div className="space-y-1 text-xs font-mono" data-testid="block-bullbar-trade-plan">
                <Row label="Entry" value={`$${fmt(s.trade_plan!.entry)}`} valueCls="text-signal-green" />
                <Row label="Stop" value={`$${fmt(s.trade_plan!.stop_loss)}`} valueCls="text-signal-red" />
                <Row label="Target" value={`$${fmt(s.trade_plan!.target)}`} valueCls="text-signal-green" />
                <Row label="Risk/share" value={`$${fmt(s.trade_plan!.risk_per_share)}`} />
                <Row label="Reward/share" value={`$${fmt(s.trade_plan!.reward_per_share)}`} />
                <Row label="R:R" value={`1:${s.trade_plan!.risk_reward}`} valueCls="text-signal-blue" />
                <Row
                  label="Shares"
                  value={sharesValue}
                  valueCls="text-signal-blue font-semibold"
                  title={sharesTitle}
                  testId="text-bullbar-shares"
                />
                <Link
                  href={buildPlannerHref({
                    ticker: s.symbol,
                    entry: s.trade_plan!.entry,
                    stop: s.trade_plan!.stop_loss,
                    target: s.trade_plan!.target,
                    setup: "Strong Bull Bar",
                    direction: "long",
                  })}
                  className="inline-block mt-2 w-full text-center px-2 py-1 rounded border text-[10px] uppercase tracking-wide bg-signal-blue/10 text-signal-blue border-signal-blue/40 hover:bg-signal-blue/20 transition-colors"
                  data-testid={`btn-bb-plan-${s.symbol}`}
                >
                  Plan this
                </Link>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Confirmation row (only when present) */}
      {s.confirmation && (
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3 text-xs font-mono">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">Confirmation Bar (next 1H)</div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-1" data-testid="block-bullbar-confirmation">
            <Row label="Time" value={new Date(s.confirmation.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
            <Row label="Close" value={`$${fmt(s.confirmation.close)}`} />
            <Row label="High" value={`$${fmt(s.confirmation.high)}`} />
            <Row
              label="Broke high?"
              value={s.confirmation.broke_high ? "Yes" : "No"}
              valueCls={s.confirmation.broke_high ? "text-signal-green" : "text-slate-gray"}
            />
            <Row
              label="Broke low?"
              value={s.confirmation.broke_low ? "Yes" : "No"}
              valueCls={s.confirmation.broke_low ? "text-signal-red" : "text-slate-gray"}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-slate-gray pt-1">
        <span>
          {s.alert_emitted ? "✓ Alert recorded to signal history" : "No new alert this scan"}
        </span>
        <span>asof {new Date(s.asof).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueCls = "",
  title,
  testId,
}: {
  label: string;
  value: string;
  valueCls?: string;
  title?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={title} data-testid={testId}>
      <span className="text-slate-gray text-[10px] uppercase tracking-wide">{label}</span>
      <span className={`text-right ${valueCls}`}>{value}</span>
    </div>
  );
}
