// ─── FLEX Swing Scanner Panel ─────────────────────────────────────────
// Renders the /api/flex-scan four-tier state machine as Bloomberg-style
// desk cards. Day-type + SMH context header up top, cards grouped by state
// (STANDARD_READY / FLEX_READY / FLEX_WATCH / STANDBY) below, and a
// "Save to Active Setups" action on every STANDARD/FLEX_READY tile.

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Radar, AlertTriangle, XCircle, CheckCircle2, Eye, Zap, RefreshCw, Save, Check,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  FlexScanResult, FlexDeskCard, FlexState,
} from "@shared/flexScanTypes";

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
    STANDBY: false,
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
  const grouped: Record<FlexState, FlexDeskCard[]> = {
    STANDARD_READY: cards.filter((c) => c.state === "STANDARD_READY"),
    FLEX_READY:     cards.filter((c) => c.state === "FLEX_READY"),
    FLEX_WATCH:     cards.filter((c) => c.state === "FLEX_WATCH"),
    STANDBY:        cards.filter((c) => c.state === "STANDBY"),
  };

  return (
    <div className="bg-ink-black rounded-lg border border-ink-line p-3 space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-neon-blue" />
          <div className="text-xs font-bold text-soft-white tracking-wider">FLEX SWING SCANNER</div>
          {result && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
              result.day_type === "PRACTICE_SWING_DAY" ? "bg-signal-green/20 text-signal-green" :
              result.day_type === "ETF_EXPOSURE_DAY"   ? "bg-neon-blue/20 text-neon-blue" :
                                                        "bg-signal-red/20 text-signal-red"
            }`} data-testid="badge-day-type">
              {result.day_type.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <button
          onClick={() => scanQ.refetch()}
          disabled={scanQ.isFetching}
          className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue disabled:opacity-40 flex items-center gap-1"
          data-testid="button-rescan"
        >
          <RefreshCw className={`h-3 w-3 ${scanQ.isFetching ? "animate-spin" : ""}`} />
          {scanQ.isFetching ? "Scanning…" : "Rescan"}
        </button>
      </div>

      {/* ── SMH + summary strip ── */}
      {result && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div className={`rounded border p-2 ${
            result.smh_context.state === "GREEN"  ? "border-signal-green" :
            result.smh_context.state === "YELLOW" ? "border-signal-amber" :
                                                    "border-signal-red"
          }`}>
            <div className="text-[9px] text-slate-gray font-bold uppercase">SMH regime</div>
            <div className={`font-mono text-sm ${
              result.smh_context.state === "GREEN"  ? "text-signal-green" :
              result.smh_context.state === "YELLOW" ? "text-signal-amber" :
                                                      "text-signal-red"
            }`}>{result.smh_context.state}</div>
            <div className="text-[9px] text-slate-gray leading-tight">{result.smh_context.note}</div>
          </div>
          <div className="rounded border border-ink-line p-2 sm:col-span-2">
            <div className="text-[9px] text-slate-gray font-bold uppercase">Desk summary</div>
            <div className="text-[11px] text-soft-white leading-tight">{result.one_sentence_summary}</div>
            <div className="text-[9px] text-slate-gray mt-1 space-y-0.5">
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
        <div className="rounded border border-signal-red bg-signal-red/5 p-2 text-[10px] text-signal-red font-mono">
          Scan failed: {String(scanQ.error?.message ?? "unknown")}
        </div>
      )}

      {/* ── State groups ── */}
      {result && (["STANDARD_READY", "FLEX_READY", "FLEX_WATCH", "STANDBY"] as FlexState[]).map((s) => {
        const meta = STATE_META[s];
        const list = grouped[s];
        if (list.length === 0) return null;
        return (
          <div key={s} className="space-y-2" data-testid={`group-${s.toLowerCase()}`}>
            <button
              onClick={() => setExpandedState((p) => ({ ...p, [s]: !p[s] }))}
              className="flex items-center gap-1 text-[10px] font-bold tracking-wider hover:text-soft-white"
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
  return (
    <div className={`rounded border-2 ${meta.border} bg-ink-black p-2 space-y-1 text-[10px]`} data-testid={`card-${card.ticker}`}>
      {/* Row 1: ticker + state + setup */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`font-mono text-sm font-bold ${meta.text}`}>{card.ticker}</span>
          <span className={`text-[9px] px-1 py-0.5 rounded ${meta.bg} ${meta.text} font-bold`}>
            {meta.label}
          </span>
        </div>
        <span className="text-[9px] text-slate-gray italic">{card.setup}</span>
      </div>

      {/* Compact metric row */}
      {card.metrics && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-mono text-slate-gray border-t border-ink-line pt-1">
          <span>Px <span className="text-soft-white">{fmt$(card.metrics.price)}</span></span>
          <span>20 <span className="text-soft-white">{fmt$(card.metrics.sma20)}</span></span>
          <span>50 <span className="text-soft-white">{fmt$(card.metrics.sma50)}</span></span>
          <span>200 <span className="text-soft-white">{fmt$(card.metrics.sma200)}</span></span>
          {card.metrics.relative_volume != null && (
            <span>vol <span className={card.metrics.relative_volume >= 1 ? "text-signal-green" : "text-signal-amber"}>{card.metrics.relative_volume.toFixed(2)}x</span></span>
          )}
        </div>
      )}

      {/* Trend / structure / trigger */}
      <div className="text-[10px] text-slate-gray leading-tight">
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
          <div className="col-span-3 text-[9px] text-slate-gray italic">
            {card.stop.reason}
          </div>
        </div>
      )}

      {/* Fakeout check */}
      <div className={`rounded p-1 text-[9px] ${
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
      <div className="text-[9px] text-slate-gray italic border-t border-ink-line pt-1">
        {card.smh_market_context}
      </div>

      {/* Action + save */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className={`text-[9px] font-bold ${meta.text}`}>{card.action}</span>
        <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${meta.border} ${meta.text}`}>
          {card.risk_grade}
        </span>
      </div>

      {onSave && (
        <button
          onClick={onSave}
          disabled={saving || saved}
          className={`w-full py-1 rounded font-bold text-[10px] flex items-center justify-center gap-1 ${
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
      <div className="text-[8px] text-slate-gray font-bold">{label}</div>
      <div className={`font-mono text-[11px] ${toneClass}`}>{value}</div>
    </div>
  );
}
