// ─── FLEX Swing Scanner Panel ─────────────────────────────────────────
// Renders the /api/flex-scan four-tier state machine as Bloomberg-style
// desk cards. Day-type + SMH context header up top, cards grouped by state
// (STANDARD_READY / FLEX_READY / FLEX_WATCH / STANDBY) below, and a
// "Save to Active Setups" action on every STANDARD/FLEX_READY tile.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Radar, AlertTriangle, XCircle, CheckCircle2, Eye, Zap, RefreshCw, Save, Check,
  ChevronDown, ChevronRight, Pin, Shield,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  FlexScanResult, FlexDeskCard, FlexState,
} from "@shared/flexScanTypes";
import { useAutoRescan } from "@/hooks/useAutoRescan";
import AutoRescanPill from "@/components/AutoRescanPill";

const STATE_META: Record<FlexState, {
  label: string; border: string; bg: string; text: string; icon: JSX.Element;
}> = {
  STANDARD_READY: {
    label: "STANDARD READY",
    border: "border-signal-green",
    bg: "bg-signal-green/10",
    text: "text-signal-green",
    icon: <CheckCircle2 className="h-4 w-4 text-signal-green flex-shrink-0" />,
  },
  FLEX_READY: {
    label: "FLEX READY",
    border: "border-signal-amber",
    bg: "bg-signal-amber/10",
    text: "text-signal-amber",
    icon: <Zap className="h-4 w-4 text-signal-amber flex-shrink-0" />,
  },
  FLEX_WATCH: {
    label: "FLEX WATCH",
    border: "border-neon-blue",
    bg: "bg-neon-blue/10",
    text: "text-neon-blue",
    icon: <Eye className="h-4 w-4 text-neon-blue flex-shrink-0" />,
  },
  STANDBY: {
    label: "STANDBY",
    border: "border-ink-line",
    bg: "bg-ink-panel",
    text: "text-slate-gray",
    icon: <XCircle className="h-4 w-4 text-slate-gray flex-shrink-0" />,
  },
};

function fmt$(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, signed = false): string {
  if (n == null) return "—";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-signal-green";
  if (score >= 60) return "text-neon-blue";
  if (score >= 40) return "text-signal-amber";
  return "text-signal-red";
}

// ─── Save mapper: FlexDeskCard → active-setups POST body ────────────────
function cardToActiveSetup(c: FlexDeskCard) {
  return {
    ticker: c.ticker,
    sector: c.state === "STANDARD_READY" ? "trend" : "flex-recovery",
    theme: `${c.state.replace("_", " ")} · ${c.risk_grade}`.slice(0, 60),
    thesis: [
      `${c.state.replace("_", " ")}: ${c.setup} on ${c.ticker}.`,
      `Trend: ${c.trend}`,
      `Structure: ${c.structure}`,
      `Trigger: ${c.trigger}`,
      `Fakeout: ${c.fakeout_check.result}${c.fakeout_check.reasons.length ? " — " + c.fakeout_check.reasons.join("; ") : ""}.`,
      c.smh_market_context,
    ].join(" ").slice(0, 2000),
    entry: c.entry_zone.low ?? 0,
    stop: c.stop.price ?? 0,
    targetT1: c.target_1.price ?? 0,
    targetT2: c.target_2?.price ?? undefined,
    riskPercent: c.risk_grade === "STANDARD SMALL" ? 0.75 : 0.5,
    regime: "GREEN" as const,
    structureVerdict: c.structure.slice(0, 200),
    rrRatio: c.target_1.r_multiple ?? 0,
    status: "planned" as const,
    pinned: false,
    notes: `Auto-saved from FLEX Scanner on ${new Date().toISOString().slice(0, 10)}.`,
  };
}

export default function FlexScannerPanel() {
  const [expandedState, setExpandedState] = useState<Record<FlexState, boolean>>({
    STANDARD_READY: true,
    FLEX_READY: true,
    FLEX_WATCH: true,
    STANDBY: true,  // now shown by default — STANDBY carries readiness score + distance-to-ready detail
  });
  const [savedTickers, setSavedTickers] = useState<Set<string>>(new Set());

  const scanQ = useQuery<FlexScanResult>({
    queryKey: ["/api/flex-scan"],
    queryFn: async () => {
      const r = await apiRequest("POST", "/api/flex-scan", {});
      return r.json();
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  // Auto-rescan every 5 minutes during NYSE regular hours. Pill in the
  // header shows the status and lets the operator cycle cadence (5/10/15/off).
  const autoRescan = useAutoRescan(() => {
    scanQ.refetch();
    // Also nudge the top-of-page regime panels and downstream payloads so the
    // whole cockpit stays in sync on the same tick.
    queryClient.invalidateQueries({ queryKey: ["/api/regime"] });
    queryClient.invalidateQueries({ queryKey: ["/api/regime-v2"] });
    queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] });
    queryClient.invalidateQueries({ queryKey: ["/api/proximity-watch"] });
  }, 5 * 60_000, true);

  const saveMut = useMutation<any, Error, FlexDeskCard>({
    mutationFn: async (card) => {
      const r = await apiRequest("POST", "/api/active-setups", cardToActiveSetup(card));
      return r.json();
    },
    onSuccess: (_data, card) => {
      setSavedTickers((prev) => new Set([...prev, card.ticker]));
      queryClient.invalidateQueries({ queryKey: ["/api/active-setups"] });
    },
  });

  const result = scanQ.data;
  const cards = result?.cards ?? [];
  // Pinned tickers (SMH/QQQ/SPY) get their own "Trading Vehicles" section at
  // the top so they're always visible, whatever their state that day. The
  // remaining tickers still group by state below.
  const pinnedCards = cards.filter((c) => c.pinned);
  const restCards = cards.filter((c) => !c.pinned);
  const grouped: Record<FlexState, FlexDeskCard[]> = {
    STANDARD_READY: restCards.filter((c) => c.state === "STANDARD_READY"),
    FLEX_READY:     restCards.filter((c) => c.state === "FLEX_READY"),
    FLEX_WATCH:     restCards.filter((c) => c.state === "FLEX_WATCH"),
    STANDBY:        restCards.filter((c) => c.state === "STANDBY"),
  };

  // Counts derived from existing cards — display-only.
  const readyCount = cards.filter((c) => c.state === "STANDARD_READY").length;
  const flexCount  = cards.filter((c) => c.state === "FLEX_READY").length;
  const watchCount = cards.filter((c) => c.state === "FLEX_WATCH").length;
  const standbyCount = cards.filter((c) => c.state === "STANDBY").length;
  const totalCount = cards.length;

  const fmtClock = (d: Date | null | undefined): string => {
    if (!d) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="bg-ink-black rounded-lg border border-ink-line p-3 space-y-3">
      {/* ── Header (visual reading order: state · last · next · rescan · counts) ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Radar className="h-4 w-4 text-neon-blue" />
            <div className="text-xs font-bold text-soft-white tracking-wider">FLEX SWING SCANNER</div>
            {/* 1. State / day type — the market condition */}
            {result && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
                result.day_type === "PRACTICE_SWING_DAY" ? "bg-signal-green/20 text-signal-green" :
                result.day_type === "ETF_EXPOSURE_DAY"   ? "bg-neon-blue/20 text-neon-blue" :
                                                          "bg-signal-red/20 text-signal-red"
              }`} data-testid="badge-day-type">
                {result.day_type.replace(/_/g, " ")}
              </span>
            )}
          </div>
          {/* 4. Rescan control on the right */}
          <div className="flex items-center gap-2 flex-wrap">
            <AutoRescanPill state={autoRescan} />
            <button
              onClick={() => scanQ.refetch()}
              disabled={scanQ.isFetching}
              className="text-[12px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue disabled:opacity-40 flex items-center gap-1"
              data-testid="button-rescan"
            >
              <RefreshCw className={`h-3 w-3 ${scanQ.isFetching ? "animate-spin" : ""}`} />
              {scanQ.isFetching ? "Scanning…" : "Rescan"}
            </button>
          </div>
        </div>

        {/* Sub-row: 2. Last · 3. Next · 5. Counts (all derived from existing state) */}
        {result && (
          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-mono border border-ink-line/60 rounded bg-ink-deep/50 px-2 py-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-slate-gray">
                Last <span className="text-soft-white" data-testid="scanner-last-run">{fmtClock(autoRescan.lastRunAt)}</span>
              </span>
              <span className="text-slate-gray">
                Next <span className="text-neon-blue" data-testid="scanner-next-run">{fmtClock(autoRescan.nextRunAt)}</span>
              </span>
              <span className="text-slate-gray">
                Market <span className={autoRescan.marketOpen ? "text-signal-green" : "text-slate-gray"}>{autoRescan.marketOpen ? "OPEN" : "closed"}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap" data-testid="scanner-counts">
              <span className="text-slate-gray">Candidates <span className="text-soft-white">{totalCount}</span></span>
              <span className="text-signal-green" title="Standard-ready setups">Ready {readyCount}</span>
              <span className="text-signal-amber" title="Flex half-size setups">Flex {flexCount}</span>
              <span className="text-neon-blue" title="Watch / alert only">Watch {watchCount}</span>
              <span className="text-slate-gray" title="Standby — not qualified">Standby {standbyCount}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── SMH + summary strip ── */}
      {result && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[13px]">
          <div className={`rounded border p-2 ${
            result.smh_context.state === "GREEN"  ? "border-signal-green" :
            result.smh_context.state === "YELLOW" ? "border-signal-amber" :
                                                    "border-signal-red"
          }`}>
            <div className="text-[11px] text-slate-gray font-bold uppercase">SMH regime</div>
            <div className={`font-mono text-sm ${
              result.smh_context.state === "GREEN"  ? "text-signal-green" :
              result.smh_context.state === "YELLOW" ? "text-signal-amber" :
                                                      "text-signal-red"
            }`}>{result.smh_context.state}</div>
            <div className="text-[11px] text-slate-gray leading-tight">{result.smh_context.note}</div>
          </div>
          <div className="rounded border border-ink-line p-2 sm:col-span-2">
            <div className="text-[11px] text-slate-gray font-bold uppercase">Desk summary</div>
            <div className="text-[13px] text-soft-white leading-tight">{result.one_sentence_summary}</div>
            <div className="text-[11px] text-slate-gray mt-1 space-y-0.5">
              <div><span className="text-neon-blue font-bold">Swing:</span> {result.account_instructions.swing}</div>
              <div><span className="text-neon-blue font-bold">ETF:</span> {result.account_instructions.etf}</div>
              <div><span className="text-neon-blue font-bold">Single stock:</span> {result.account_instructions.single_stock}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty / loading / error ── */}
      {scanQ.isLoading && (
        <div className="border border-dashed border-ink-line rounded p-6 text-center text-slate-gray text-xs flex items-center justify-center gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" /> Scanning universe…
        </div>
      )}
      {scanQ.isError && (
        <div className="rounded border border-signal-red bg-signal-red/5 p-2 text-[12px] text-signal-red font-mono">
          Scan failed: {String(scanQ.error?.message ?? "unknown")}
        </div>
      )}

      {/* ── Trading Vehicles (pinned SMH / QQQ / SPY) ── */}
      {result && pinnedCards.length > 0 && (
        <div className="space-y-2" data-testid="group-trading-vehicles">
          <div className="flex items-center gap-1 text-[12px] font-bold tracking-wider text-neon-blue">
            <Pin className="h-3 w-3" />
            <span>TRADING VEHICLES ({pinnedCards.length})</span>
            <span className="text-slate-gray font-normal ml-1 italic">always visible</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {pinnedCards.map((c) => (
              <DeskCard
                key={c.ticker}
                card={c}
                onSave={c.state === "STANDARD_READY" || c.state === "FLEX_READY"
                  ? () => saveMut.mutate(c)
                  : undefined}
                saved={savedTickers.has(c.ticker)}
                saving={saveMut.isPending && saveMut.variables?.ticker === c.ticker}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── State groups (non-pinned tickers) ── */}
      {result && (["STANDARD_READY", "FLEX_READY", "FLEX_WATCH", "STANDBY"] as FlexState[]).map((s) => {
        const meta = STATE_META[s];
        const list = grouped[s];
        if (list.length === 0) return null;
        return (
          <div key={s} className="space-y-2" data-testid={`group-${s.toLowerCase()}`}>
            <button
              onClick={() => setExpandedState((p) => ({ ...p, [s]: !p[s] }))}
              className="flex items-center gap-1 text-[12px] font-bold tracking-wider hover:text-soft-white"
            >
              {expandedState[s] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {meta.icon}
              <span className={meta.text}>{meta.label} ({list.length})</span>
            </button>
            {expandedState[s] && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {list.map((c) => (
                  <DeskCard
                    key={c.ticker}
                    card={c}
                    onSave={c.state === "STANDARD_READY" || c.state === "FLEX_READY"
                      ? () => saveMut.mutate(c)
                      : undefined}
                    saved={savedTickers.has(c.ticker)}
                    saving={saveMut.isPending && saveMut.variables?.ticker === c.ticker}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Single desk card ──────────────────────────────────────────────────
function DeskCard({ card, onSave, saved, saving }: {
  card: FlexDeskCard;
  onSave?: () => void;
  saved: boolean;
  saving: boolean;
}) {
  const meta = STATE_META[card.state];
  const verdict = deriveVerdict(card);
  return (
    <div className={`rounded border-2 ${meta.border} bg-ink-black p-2 space-y-1 text-[12px]`} data-testid={`card-${card.ticker}`}>
      {/* Verdict strip — the "is this move worth taking?" summary at the very
          top so the eye lands on the answer before any of the diagnostics. */}
      <div className={`rounded ${verdict.bg} border ${verdict.border} p-1.5 space-y-1`} data-testid={`verdict-${card.ticker}`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[13px] font-bold ${verdict.text}`}>
            {verdict.label}
          </span>
          {verdict.badges.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 justify-end">
              {verdict.badges.map((b, i) => (
                <span
                  key={i}
                  className={`text-[10px] font-mono px-1 py-0.5 rounded border ${b.cls}`}
                  title={b.tip}
                >
                  {b.text}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="text-[11px] text-soft-white leading-tight">
          {verdict.rationale}
        </div>
      </div>

      {/* Row 1: pin + ticker + state + score */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {card.pinned && <Pin className="h-3 w-3 text-neon-blue flex-shrink-0" />}
          <span className={`font-mono text-sm font-bold ${meta.text}`}>{card.ticker}</span>
          <span className={`text-[11px] px-1 py-0.5 rounded ${meta.bg} ${meta.text} font-bold`}>
            {meta.label}
          </span>
          {card.vehicle_class && (
            <span
              className={`text-[10px] font-mono px-1 py-0.5 rounded border ${
                card.vehicle_class === "GROWTH_TECH"  ? "border-neon-blue text-neon-blue"        :
                card.vehicle_class === "BROAD_MARKET" ? "border-signal-green text-signal-green" :
                card.vehicle_class === "NON_GROWTH"   ? "border-signal-amber text-signal-amber" :
                                                        "border-slate-gray text-slate-gray"
              }`}
              title="Vehicle class"
            >
              {card.vehicle_class.replace("_", " ")}
            </span>
          )}
          {card.permission && (
            <span
              className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                card.permission === "STANDARD_OR_FLEX" ? "bg-signal-green/20 text-signal-green" :
                card.permission === "FLEX_ONLY"        ? "bg-signal-amber/20 text-signal-amber" :
                                                         "bg-signal-red/20 text-signal-red"
              }`}
              title="Per-vehicle permission (SMH regime override)"
            >
              {card.permission.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-gray italic">{card.setup}</span>
          <span
            className={`font-mono text-[13px] font-bold ${scoreColor(card.readiness_score)} border border-current rounded px-1`}
            title="Readiness score (0-100)"
            data-testid={`score-${card.ticker}`}
          >
            {card.readiness_score}
          </span>
        </div>
      </div>

      {/* Compact metric row */}
      {card.metrics && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-mono text-slate-gray border-t border-ink-line pt-1">
          <span>Px <span className="text-soft-white">{fmt$(card.metrics.price)}</span></span>
          {card.metrics.day_change_pct != null && (
            <span>chg <span className={card.metrics.day_change_pct >= 0 ? "text-signal-green" : "text-signal-red"}>{fmtPct(card.metrics.day_change_pct, true)}</span></span>
          )}
          <span>20 <span className="text-soft-white">{fmt$(card.metrics.sma20)}</span> {fmtPct(card.metrics.sma20_slope_pct, true)}</span>
          <span>50 <span className="text-soft-white">{fmt$(card.metrics.sma50)}</span> {fmtPct(card.metrics.sma50_slope_pct, true)}</span>
          <span>200 <span className="text-soft-white">{fmt$(card.metrics.sma200)}</span> {fmtPct(card.metrics.sma200_slope_pct, true)}</span>
          {card.metrics.relative_volume != null && (
            <span>vol <span className={card.metrics.relative_volume >= 1 ? "text-signal-green" : "text-signal-amber"}>{card.metrics.relative_volume.toFixed(2)}x</span></span>
          )}
          {card.metrics.confirmed_higher_low != null && (
            <span>HL <span className={card.metrics.confirmed_higher_low ? "text-signal-green" : "text-slate-gray"}>{card.metrics.confirmed_higher_low ? "YES" : "no"}</span></span>
          )}
        </div>
      )}

      {/* Support / Resistance / distance-to-trigger row */}
      {card.metrics && (card.metrics.nearest_support != null || card.metrics.nearest_resistance != null || card.metrics.dist_to_trigger_pct != null) && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-mono text-slate-gray">
          {card.metrics.nearest_support != null && (
            <span>sup <span className="text-signal-green">{fmt$(card.metrics.nearest_support)}</span></span>
          )}
          {card.metrics.nearest_resistance != null && (
            <span>res <span className="text-signal-red">{fmt$(card.metrics.nearest_resistance)}</span></span>
          )}
          {card.metrics.dist_to_trigger_pct != null && (
            <span>d2trg <span className={card.metrics.dist_to_trigger_pct === 0 ? "text-signal-green" : "text-neon-blue"}>{fmtPct(card.metrics.dist_to_trigger_pct)}</span></span>
          )}
        </div>
      )}

      {/* Hard-block callout */}
      {card.hard_blocks && card.hard_blocks.length > 0 && (
        <div className="rounded border border-signal-red bg-signal-red/10 p-1 text-[11px] text-signal-red">
          <div className="font-bold flex items-center gap-1">
            <Shield className="h-2.5 w-2.5" />
            HARD BLOCK
          </div>
          <ul className="list-disc list-inside ml-1 mt-0.5">
            {card.hard_blocks.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* Distance-to-ready (only when there are unmet conditions) */}
      {card.distance_to_ready && card.distance_to_ready.length > 0 && card.state !== "STANDBY" && (
        <div className="rounded border border-neon-blue/40 bg-neon-blue/5 p-1 text-[11px]">
          <div className="font-bold text-neon-blue mb-0.5">DISTANCE TO READY</div>
          <div className="space-y-0.5">
            {card.distance_to_ready.slice(0, 4).map((item, i) => (
              <div key={i} className="text-slate-gray">
                <span className="text-soft-white font-bold">{item.name}:</span> <span className="text-signal-amber">{item.current}</span> → <span className="text-signal-green">{item.next_action}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend / structure / trigger */}
      <div className="text-[12px] text-slate-gray leading-tight">
        <div><span className="text-neon-blue font-bold">TREND:</span> {card.trend}</div>
        <div><span className="text-neon-blue font-bold">STRUCT:</span> {card.structure}</div>
        <div><span className="text-neon-blue font-bold">TRIG:</span> {card.trigger}</div>
      </div>

      {/* Plan geometry (only when actionable) */}
      {card.entry_zone.low != null && card.stop.price != null && (
        <div className="grid grid-cols-3 gap-1 border-t border-ink-line pt-1">
          <PlanCell label="ENTRY" value={`${fmt$(card.entry_zone.low)}–${fmt$(card.entry_zone.high)}`} />
          <PlanCell label="STOP"  value={fmt$(card.stop.price)} tone="red" />
          <PlanCell
            label={`T1 (${card.target_1.r_multiple?.toFixed(2) ?? "—"}R)`}
            value={fmt$(card.target_1.price)}
            tone="green"
          />
          {card.target_2 && card.target_2.price != null && (
            <PlanCell
              label={`T2 (${card.target_2.r_multiple?.toFixed(2) ?? "—"}R)`}
              value={fmt$(card.target_2.price)}
              tone="green"
            />
          )}
          <div className="col-span-3 text-[11px] text-slate-gray italic">
            {card.stop.reason}
          </div>
        </div>
      )}

      {/* Fakeout check */}
      <div className={`rounded p-1 text-[11px] ${
        card.fakeout_check.result === "PASS"
          ? "bg-signal-green/10 text-signal-green"
          : "bg-signal-amber/10 text-signal-amber"
      }`}>
        <div className="font-bold flex items-center gap-1">
          {card.fakeout_check.result === "PASS" ? <Check className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
          FAKEOUT: {card.fakeout_check.result}
        </div>
        {card.fakeout_check.reasons.length > 0 && (
          <ul className="list-disc list-inside ml-1 mt-0.5">
            {card.fakeout_check.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      {/* Market context */}
      <div className="text-[11px] text-slate-gray italic border-t border-ink-line pt-1">
        {card.smh_market_context}
      </div>

      {/* Action + save + market confirmation */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-ink-line">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {/* Direction pill — display-only translation of existing verdict/state */}
          <span className={`text-[10px] font-mono px-1 py-0.5 rounded uppercase tracking-wider ${
            card.state === "STANDARD_READY" ? "bg-signal-green/15 text-signal-green" :
            card.state === "FLEX_READY"     ? "bg-signal-amber/15 text-signal-amber" :
            card.state === "FLEX_WATCH"     ? "bg-neon-blue/15 text-neon-blue" :
                                              "bg-ink-line text-slate-gray"
          }`} title="Trade direction">
            {card.state === "STANDBY" ? "No Trade" : "Long"}
          </span>
          <span className={`text-[11px] font-bold ${meta.text} truncate`}>{card.action}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-mono px-1 rounded ${
            card.market_confirmation === "CONFIRMED"   ? "bg-signal-green/20 text-signal-green" :
            card.market_confirmation === "INVALIDATED" ? "bg-signal-red/20 text-signal-red" :
                                                         "bg-signal-amber/20 text-signal-amber"
          }`} title={`Market confirmation: ${card.market_confirmation}`}>
            MKT {card.market_confirmation}
          </span>
          <span className={`text-[11px] font-mono px-1 py-0.5 rounded border ${meta.border} ${meta.text}`}>
            {card.risk_grade}
          </span>
        </div>
      </div>

      {onSave && (
        <button
          onClick={onSave}
          disabled={saving || saved}
          className={`w-full py-1 rounded font-bold text-[12px] flex items-center justify-center gap-1 ${
            saved
              ? "bg-signal-green/20 border border-signal-green text-signal-green cursor-default"
              : "bg-signal-green text-ink-black hover:brightness-110 disabled:opacity-40"
          }`}
          data-testid={`button-save-${card.ticker}`}
        >
          {saving ? (
            <><RefreshCw className="h-2.5 w-2.5 animate-spin" /> Saving…</>
          ) : saved ? (
            <><Check className="h-2.5 w-2.5" /> Saved</>
          ) : (
            <><Save className="h-2.5 w-2.5" /> Save to Active Setups</>
          )}
        </button>
      )}
    </div>
  );
}

function PlanCell({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" | "amber" }) {
  const toneClass = tone === "green" ? "text-signal-green"
                  : tone === "red"   ? "text-signal-red"
                  : tone === "amber" ? "text-signal-amber"
                  : "text-soft-white";
  return (
    <div>
      <div className="text-[10px] text-slate-gray font-bold">{label}</div>
      <div className={`font-mono text-[13px] ${toneClass}`}>{value}</div>
    </div>
  );
}

// ─── Verdict strip helpers ─────────────────────────────────────────────────
// Compact "should I take this trade right now?" summary the eye sees first.
// Reads the same card state + metrics the diagnostics below expand on, so
// no new server field is introduced — this is a pure presentational digest.
interface VerdictBadge {
  text: string;
  cls: string;   // tailwind color classes for the pill
  tip: string;   // native tooltip
}
interface Verdict {
  label: string;         // big verb: STANDARD ENTER / FLEX HALF-SIZE / SET ALERT / STAND DOWN
  rationale: string;     // one-line why-now / why-not
  bg: string;
  border: string;
  text: string;
  badges: VerdictBadge[];
}
function deriveVerdict(card: FlexDeskCard): Verdict {
  const m = card.metrics;
  const permBlocked = card.permission === "NO_LONG";
  const hardBlocked = (card.hard_blocks?.length ?? 0) > 0;

  // Verdict verb + palette by (state, permission, hard_blocks).
  let label: string;
  let bg: string;
  let border: string;
  let text: string;
  let rationale: string;

  if (hardBlocked || permBlocked || card.state === "STANDBY") {
    label = "STAND DOWN";
    bg = "bg-signal-red/10";
    border = "border-signal-red/40";
    text = "text-signal-red";
    rationale = hardBlocked
      ? `Blocked: ${card.hard_blocks[0]}`
      : permBlocked
        ? `SMH regime denies longs on this vehicle — capital protection only.`
        : `No qualifying setup this bar. Wait for structure to repair.`;
  } else if (card.state === "STANDARD_READY") {
    label = "STANDARD ENTER";
    bg = "bg-signal-green/10";
    border = "border-signal-green/50";
    text = "text-signal-green";
    rationale = `${card.trigger}. Full-size entry inside the plan geometry below.`;
  } else if (card.state === "FLEX_READY") {
    label = "FLEX HALF-SIZE";
    bg = "bg-signal-amber/10";
    border = "border-signal-amber/50";
    text = "text-signal-amber";
    rationale = `${card.trigger}. Half-size — trigger is armed but structure has a caveat.`;
  } else {
    // FLEX_WATCH
    label = "SET ALERT · WAIT";
    bg = "bg-neon-blue/10";
    border = "border-neon-blue/40";
    text = "text-neon-blue";
    rationale = card.distance_to_ready?.[0]?.next_action
      ?? `Watch-only until the trigger arms. No entry yet.`;
  }

  // Momentum badges — high-signal, one glance. Only add if actually true.
  const badges: VerdictBadge[] = [];
  // Bounce-reclaim trigger sits FIRST when armed — it's the highest-signal
  // event on the card. Green pill with a subtle pulse animation via ring.
  if (m?.bounce_reclaim_trigger) {
    badges.push({
      text: `Bounce reclaim`,
      cls: "border-signal-green text-signal-green bg-signal-green/20 ring-1 ring-signal-green/40",
      tip: `Bounce-reclaim trigger armed: ≥3% off 3-day low, rel-vol ≥1.2x, within 2% of 20-SMA. Half-size entry, stop below last swing low.`,
    });
  }
  if (m?.off_low_pct != null && m.off_low_pct >= 3) {
    badges.push({
      text: `+${m.off_low_pct.toFixed(1)}% off 3d low`,
      cls: "border-signal-green text-signal-green bg-signal-green/10",
      tip: `Current close is ${m.off_low_pct.toFixed(2)}% above the 3-day low $${(m.three_day_low ?? 0).toFixed(2)}`,
    });
  }
  if (m?.relative_volume != null && m.relative_volume >= 1.2) {
    badges.push({
      text: `Rel-vol ${m.relative_volume.toFixed(2)}x`,
      cls: "border-signal-green text-signal-green bg-signal-green/10",
      tip: `Today's volume is ${m.relative_volume.toFixed(2)}× the 20-day average`,
    });
  } else if (m?.relative_volume != null && m.relative_volume < 0.8) {
    badges.push({
      text: `Low vol ${m.relative_volume.toFixed(2)}x`,
      cls: "border-signal-amber text-signal-amber bg-signal-amber/10",
      tip: `Volume is only ${m.relative_volume.toFixed(2)}× the 20-day average — moves without volume are suspect`,
    });
  }
  if (m?.reclaim_trigger) {
    badges.push({
      text: `Reclaimed 20-SMA`,
      cls: "border-neon-blue text-neon-blue bg-neon-blue/10",
      tip: `Price closed back above the 20-SMA this bar`,
    });
  }
  if (m?.confirmed_higher_low) {
    badges.push({
      text: `HL confirmed`,
      cls: "border-signal-green text-signal-green bg-signal-green/10",
      tip: `A confirmed higher-low pivot printed — structure is improving`,
    });
  }
  if (m?.sma50_slope_pct != null && m.sma50_slope_pct > 0 && m?.sma200_slope_pct != null && m.sma200_slope_pct > 0) {
    badges.push({
      text: `Trend up`,
      cls: "border-signal-green text-signal-green bg-signal-green/10",
      tip: `Both 50-SMA and 200-SMA are sloping up`,
    });
  } else if (m?.sma50_slope_pct != null && m.sma50_slope_pct < 0) {
    badges.push({
      text: `50-SMA falling`,
      cls: "border-signal-red text-signal-red bg-signal-red/10",
      tip: `50-SMA slope is ${m.sma50_slope_pct.toFixed(2)}% — near-term trend is not repaired`,
    });
  }

  return { label, rationale, bg, border, text, badges };
}
