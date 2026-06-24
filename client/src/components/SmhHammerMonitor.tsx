// ─── SMH Hammer Monitor Panel ───────────────────────────────────────────────
// Dedicated SMH chart monitor. Watches for hammer at support, then confirmation
// with high-volume breakout. Displays state, hammer details, confirmation
// progress, and the 1:2 R:R trade plan.

import { usePersistentState } from "@/hooks/use-persistent-state";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { formatShares } from "@/lib/engine";
import { sharesForPlan, useSharesContext } from "@/lib/useShares";
import { buildPlannerHref } from "@/lib/planLink";

type Phase =
  | "Scanning"
  | "Hammer Forming"
  | "Hammer Confirmed"
  | "Breakout Confirmed"
  | "Invalidated";

type TradeMode = "conservative" | "aggressive";
type SetupType = "none" | "support_hammer" | "post_decline_hammer";

// R:R presets aligned to the user's target map:
//   2R = Standard Trend-Pullback (default, highest win rate)
//   3R = Strong Trend (higher-timeframe alignment)
//   4R = Momentum Breakout (A+ setups only)
//   5R = Trend-to-Momentum (rare; use with partials locked)
const RR_OPTIONS: Array<{ v: number; label: string; tip: string }> = [
  { v: 2, label: "1:2", tip: "Standard Trend-Pullback — default, highest win rate" },
  { v: 3, label: "1:3", tip: "Strong Trend — use when higher timeframes align" },
  { v: 4, label: "1:4", tip: "Momentum Breakout — only on A+ setups" },
  { v: 5, label: "1:5", tip: "Trend-to-Momentum — rare; only with partials locked" },
];

interface SupportLevel {
  type: "swing_low" | "sma20" | "sma50";
  price: number;
  distance_pct: number;
}

interface HammerBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  body_size: number;
  lower_wick: number;
  upper_wick: number;
  is_closed: boolean;
  support_distance_pct: number;
}

interface ConfirmationBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avg_volume_20: number;
  volume_ratio: number;
  high_volume: boolean;
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
  phase: Phase;
  mode: TradeMode;
  rr: number;
  setup_type: SetupType;
  price: number;
  asof: string;
  market_open: boolean;
  preceding_red_count: number;
  nearest_support: SupportLevel | null;
  support_levels: SupportLevel[];
  hammer: HammerBar | null;
  confirmation: ConfirmationBar | null;
  trade_plan: TradePlan | null;
  notes: string;
  alert_emitted?: boolean;
}

const phaseStyle: Record<Phase, string> = {
  "Breakout Confirmed": "border-signal-green/70 bg-signal-green/15 text-signal-green",
  "Hammer Confirmed":   "border-signal-blue/60 bg-signal-blue/10 text-signal-blue",
  "Hammer Forming":     "border-signal-amber/70 bg-signal-amber/15 text-signal-amber",
  "Scanning":           "border-ink-line/50 bg-ink-deep/20 text-slate-gray",
  "Invalidated":        "border-signal-red/60 bg-signal-red/10 text-signal-red",
};

// ─── Tier classification ───────────────────────────────────────────────────
// Maps the engine's internal phase/mode/setup-type into the three-state tier
// the user wants surfaced on every card: A+, RULES-LOOSENED, or REJECTED.
//
// A+              → strict mode + breakout confirmed (textbook setup)
// RULES-LOOSENED  → aggressive mode hit, OR post-decline setup, OR a forming
//                   hammer that hasn't yet earned breakout confirmation
// REJECTED        → explicit invalidation by the engine
// (no badge)      → pure Scanning state — nothing to classify yet
type Tier = "A+" | "RULES-LOOSENED" | "REJECTED" | null;

function classifyTier(
  phase: Phase,
  mode: TradeMode,
  setupType: SetupType,
): Tier {
  if (phase === "Invalidated") return "REJECTED";
  if (phase === "Scanning") return null;
  if (phase === "Breakout Confirmed" && mode === "conservative" && setupType !== "post_decline_hammer") {
    return "A+";
  }
  // Anything firing under aggressive mode, post-decline path, or a still-forming
  // hammer is loosened relative to the textbook A+ definition.
  return "RULES-LOOSENED";
}

const tierStyle: Record<Exclude<Tier, null>, string> = {
  "A+":               "border-signal-green bg-signal-green/20 text-signal-green font-bold",
  "RULES-LOOSENED":   "border-signal-amber bg-signal-amber/15 text-signal-amber font-semibold",
  "REJECTED":         "border-signal-red bg-signal-red/15 text-signal-red font-semibold",
};

const tierTitle: Record<Exclude<Tier, null>, string> = {
  "A+":               "A+ setup — strict rules satisfied (conservative mode, breakout confirmed)",
  "RULES-LOOSENED":   "Rules-loosened setup — aggressive mode, post-decline, or still-forming. Practice-grade.",
  "REJECTED":         "Rejected — invalidated by the engine. Do not enter.",
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

export default function SmhHammerMonitor() {
  const [mode, setMode] = usePersistentState<TradeMode>("smh-mode", "aggressive");
  const [rr, setRr] = usePersistentState<number>("smh-rr", 2);

  const { data, isLoading, error, refetch, isFetching } = useQuery<MonitorState>({
    queryKey: ["/api/smh-hammer-monitor", mode, rr],
    queryFn: () =>
      apiRequest("GET", `/api/smh-hammer-monitor?mode=${mode}&rr=${rr}`).then((r) => r.json()),
    refetchInterval: 60_000, // poll every 60s
  });

  // Shares-to-buy context: equity × day-color risk % ÷ risk_per_share.
  const sharesCtx = useSharesContext();

  if (isLoading) {
    return <div className="text-xs text-slate-gray py-3">Loading SMH monitor…</div>;
  }
  if (error || !data) {
    return <div className="text-xs text-signal-red py-3">Failed to load monitor.</div>;
  }

  const s = data;
  const phase = s.phase;
  const phaseCls = phaseStyle[phase];

  return (
    <div className="space-y-3" data-testid="smh-hammer-monitor">
      {/* Header row: symbol, phase, price */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg font-semibold tracking-wide" data-testid="text-smh-symbol">
            {s.symbol}
          </span>
          <span className="font-mono text-sm text-slate-gray">
            ${fmt(s.price)}
          </span>
          <span
            className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ${phaseCls}`}
            data-testid="badge-phase"
          >
            {phase}
          </span>
          {(() => {
            const tier = classifyTier(phase, s.mode, s.setup_type);
            if (!tier) return null;
            return (
              <span
                className={`inline-flex items-center rounded border px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em] ${tierStyle[tier]}`}
                data-testid="badge-tier"
                title={tierTitle[tier]}
              >
                {tier}
              </span>
            );
          })()}
          {s.setup_type === "post_decline_hammer" && (
            <span
              className="inline-flex items-center rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium border-signal-amber/70 bg-signal-amber/10 text-signal-amber"
              data-testid="badge-setup-type"
              title="Hammer after ≥ 2 red candles — SMA20 gate off"
            >
              post-decline
            </span>
          )}
          <span className="text-[10px] text-slate-gray">
            {s.market_open ? "● market open" : "○ market closed"}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] px-2 py-1 rounded border border-ink-line/50 hover:border-signal-blue/60 hover:text-signal-blue transition-colors disabled:opacity-50"
          data-testid="button-refresh-smh"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Controls row: mode toggle + R:R selector */}
      <div className="flex items-center gap-4 flex-wrap text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-slate-gray uppercase tracking-wide text-[10px]">Mode</span>
          <label className="inline-flex items-center gap-1 cursor-pointer" data-testid="toggle-mode">
            <input
              type="checkbox"
              className="accent-signal-amber"
              checked={mode === "aggressive"}
              onChange={(e) => setMode(e.target.checked ? "aggressive" : "conservative")}
            />
            <span className={mode === "aggressive" ? "text-signal-amber" : "text-slate-gray"}>
              Aggressive (hammer after ≥ 2 red candles, no SMA20 gate)
            </span>
          </label>
        </div>

        <div className="flex items-center gap-2" data-testid="selector-rr">
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
              data-testid={`button-rr-${v}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "aggressive" && (
          <span className="text-[10px] text-slate-gray">
            Red candles before hammer:{" "}
            <span className="text-signal-amber font-mono">{s.preceding_red_count}</span>
          </span>
        )}
      </div>

      {/* Notes */}
      <div className="text-xs text-slate-gray leading-relaxed" data-testid="text-notes">
        {s.notes}
      </div>

      {/* Grid: support levels | hammer | confirmation | trade plan */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Support levels */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">
            Support Levels
          </div>
          {s.support_levels.length === 0 ? (
            <div className="text-xs text-slate-gray">No supports identified.</div>
          ) : (
            <ul className="space-y-1" data-testid="list-supports">
              {s.support_levels.slice(0, 5).map((lvl, i) => (
                <li
                  key={`${lvl.type}-${lvl.price}-${i}`}
                  className="flex items-center justify-between text-xs font-mono"
                >
                  <span className="text-slate-gray uppercase text-[10px]">{lvl.type}</span>
                  <span>
                    ${fmt(lvl.price)}{" "}
                    <span className="text-slate-gray">({lvl.distance_pct >= 0 ? "+" : ""}{fmt(lvl.distance_pct)}%)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Hammer details */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">
            Hammer Candle
          </div>
          {!s.hammer ? (
            <div className="text-xs text-slate-gray">No hammer detected yet.</div>
          ) : (
            <div className="space-y-1 text-xs font-mono" data-testid="block-hammer">
              <Row label="Date" value={s.hammer.timestamp} />
              <Row label="O / H / L / C" value={`${fmt(s.hammer.open)} / ${fmt(s.hammer.high)} / ${fmt(s.hammer.low)} / ${fmt(s.hammer.close)}`} />
              <Row label="Lower wick" value={`$${fmt(s.hammer.lower_wick)}`} />
              <Row label="Body" value={`$${fmt(s.hammer.body_size)}`} />
              <Row label="Δ Support" value={`${fmt(s.hammer.support_distance_pct)}%`} />
              <Row
                label="Status"
                value={s.hammer.is_closed ? "Closed" : "Live"}
                valueCls={s.hammer.is_closed ? "text-signal-green" : "text-signal-amber"}
              />
            </div>
          )}
        </div>

        {/* Confirmation candle */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">
            Confirmation Candle
          </div>
          {!s.confirmation ? (
            <div className="text-xs text-slate-gray">Awaiting next session.</div>
          ) : (
            <div className="space-y-1 text-xs font-mono" data-testid="block-confirmation">
              <Row label="Date" value={s.confirmation.timestamp} />
              <Row label="Close" value={`$${fmt(s.confirmation.close)}`} />
              <Row label="Low" value={`$${fmt(s.confirmation.low)}`} />
              <Row
                label="Vol vs 20-avg"
                value={`${fmt(s.confirmation.volume_ratio)}x`}
                valueCls={s.confirmation.high_volume ? "text-signal-green" : "text-signal-red"}
              />
              <Row label="Volume" value={fmtVol(s.confirmation.volume)} />
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
          )}
        </div>

        {/* Trade plan */}
        <div className="rounded border border-ink-line/40 bg-ink-deep/30 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-gray mb-2">
            Trade Plan (1:{rr} R:R)
          </div>
          {!s.trade_plan ? (
            <div className="text-xs text-slate-gray">
              {phase === "Hammer Confirmed"
                ? "Awaiting confirmed breakout."
                : phase === "Hammer Forming"
                ? "Awaiting hammer close."
                : phase === "Invalidated"
                ? "Setup invalidated."
                : "No active setup."}
            </div>
          ) : (() => {
            const shares = sharesForPlan(sharesCtx, s.trade_plan.risk_per_share);
            const sharesValue = sharesCtx.equity > 0 && s.trade_plan.risk_per_share > 0 ? formatShares(shares) : "—";
            const sharesTitle = `${sharesCtx.regime} day · ${(sharesCtx.riskPct * 100).toFixed(2)}% of $${sharesCtx.equity.toFixed(2)} ÷ $${fmt(s.trade_plan!.risk_per_share)}/sh`;
            return (
              <div className="space-y-1 text-xs font-mono" data-testid="block-trade-plan">
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
                  testId="text-smh-shares"
                />
                <Link
                  href={buildPlannerHref({
                    ticker: s.symbol,
                    entry: s.trade_plan!.entry,
                    stop: s.trade_plan!.stop_loss,
                    target: s.trade_plan!.target,
                    setup: "Hammer",
                    direction: "long",
                  })}
                  className="inline-block mt-2 w-full text-center px-2 py-1 rounded border text-[10px] uppercase tracking-wide bg-signal-blue/10 text-signal-blue border-signal-blue/40 hover:bg-signal-blue/20 transition-colors"
                  data-testid={`btn-smh-plan-${s.symbol}`}
                >
                  Plan this
                </Link>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Footer: alert status + timestamp */}
      <div className="flex items-center justify-between text-[10px] text-slate-gray pt-1">
        <span>
          {s.alert_emitted
            ? "✓ Alert recorded to signal history"
            : "No new alert this scan"}
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
