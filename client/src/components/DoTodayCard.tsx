// ─── DoTodayCard (v2 Overhaul) ─────────────────────────────────────────────
// One compact guidance row. Answers "What should I do today?" based on
// current regime, flex-scan counts, and unified swing engine status.
// MUTATES NOTHING. This is a display-only translation layer.

import { emptyStateText, useFreshness } from "@/lib/freshness";
import type { FreshnessResult } from "@shared/cardFreshness";
import { activeVersion, useSelectedPlans } from "@/lib/plans";
import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { FlexScanResult } from "@shared/flexScanTypes";
import type { ScanSelection, SwingDecision } from "@shared/swingDecision";
import { readyStatusLabel, sortForCockpit, type LivePermission } from "@shared/readyAlerts";
import { useSwingEnabled } from "@/lib/swing";
import { openTradingCard } from "@/lib/alerts";
import { useScan } from "@/components/swing/SwingWorkspace";

// ─── TYPES ─────────────────────────────────────────────────────────────────

type Band = "GREEN" | "YELLOW" | "RED" | "UNKNOWN";
interface RegimeSnap {
  day_class: Band;
  reason?: string;
  vix?: { last: number | null };
}

interface Verdict {
  tone: "green" | "amber" | "red" | "blue" | "gray";
  headline: string;
  detail: string;
}

// ─── DESIGN SYSTEM CONSTANTS ───────────────────────────────────────────────

const TONE_STYLES: Record<Verdict["tone"], { border: string; bg: string; text: string; chip: string }> = {
  green: { border: "border-signal-green/40", bg: "bg-signal-green/10", text: "text-signal-green", chip: "bg-signal-green/20" },
  amber: { border: "border-signal-amber/40", bg: "bg-signal-amber/10", text: "text-signal-amber", chip: "bg-signal-amber/20" },
  red:   { border: "border-signal-red/40",   bg: "bg-signal-red/10",   text: "text-signal-red",   chip: "bg-signal-red/20" },
  blue:  { border: "border-neon-blue/40",    bg: "bg-neon-blue/10",    text: "text-neon-blue",    chip: "bg-neon-blue/20" },
  gray:  { border: "border-ink-line",        bg: "bg-ink-deep/40",     text: "text-slate-gray",   chip: "bg-ink-panel" },
};

// ─── LEGACY LOGIC (FLEX SCAN / REGIME) ─────────────────────────────────────

function pickVerdict(regime: RegimeSnap | undefined, scan: FlexScanResult | undefined): Verdict {
  const band: Band = regime?.day_class ?? "UNKNOWN";
  const cards = scan?.cards ?? [];
  const readyCount = cards.filter((c) => c.state === "STANDARD_READY").length;
  const flexReadyCount = cards.filter((c) => c.state === "FLEX_READY").length;
  const watchCount = cards.filter((c) => c.state === "FLEX_WATCH").length;
  const dayType = scan?.day_type;

  if (band === "RED" || dayType === "STAND_DOWN_DAY") {
    return {
      tone: "red",
      headline: "Stand down — capital protection",
      detail: "Regime is RED. No new long risk today. Manage existing positions to plan; do not add.",
    };
  }
  if (band === "YELLOW" && readyCount === 0) {
    return {
      tone: "amber",
      headline: "Highest-quality only, half size",
      detail: "Mixed regime — focus on the strongest setup, take half size, and skip anything extended.",
    };
  }
  const readyNames = cards.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY").map((c) => c.ticker);
  if (readyNames.length > 0 && cards.some((c: any) => c.unified)) {
    return {
      tone: "green",
      headline: `${readyNames.join(", ")} ${readyNames.length === 1 ? "is" : "are"} ready — practice plan below`,
      detail: "The swing engine lines up on trend, structure and a closed 1H trigger. Review the plan card, then open the chart to check it yourself.",
    };
  }
  if (readyCount > 0) {
    return {
      tone: "green",
      headline: `${readyCount} STANDARD READY — take the best`,
      detail: "Trend, structure, and volume line up. Enter the top-graded setup at listed trigger and stop.",
    };
  }
  if (flexReadyCount > 0) {
    return {
      tone: "green",
      headline: `${flexReadyCount} FLEX READY — half size on best`,
      detail: "One factor is soft. Take half size only, and confirm the trigger bar closes before entering.",
    };
  }
  if (watchCount > 0) {
    return {
      tone: "blue",
      headline: `${watchCount} on watch — alerts only`,
      detail: "Patterns forming. Set trigger alerts; don't front-run. Wait for the setup to arm.",
    };
  }
  return {
    tone: "gray",
    headline: "Quiet day — no qualifying setups",
    detail: "No qualifying long setups right now. Continue watching regime, breadth, and volume — no new risk.",
  };
}

// ─── UNIFIED SWING ENGINE LOGIC ────────────────────────────────────────────

const REQ = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [] as string[], force: 0 };
const usable = (d: SwingDecision) => d.dataStatus !== "STALE" && d.dataStatus !== "ERROR" && !d.evalPending; 

function swingGuidance(rows: SwingDecision[], live: LivePermission | null, fOf?: (d: SwingDecision) => FreshnessResult): (Verdict & { primary: string | null; others: string[] }) | null {
  const sorted = sortForCockpit(rows);
  const readyAll = sorted.filter((d) => d.setupStatus === "READY_TO_TRADE" && usable(d));
  
  const ready = fOf ? readyAll.filter((d) => fOf(d).isTradeable) : readyAll;
  const blocked = !!live && !live.allowed;
  
  if (!ready.length && fOf) {
    const older = sorted.map((d) => ({ symbol: d.symbol, f: fOf(d), d }))
      .filter(({ d, f }) => f.hasLevels && !f.isTradeable && (d.setupStatus === "READY_TO_TRADE" || f.state === "MISSED_ENTRY" || f.state === "STALE"));
    const txt = emptyStateText(older);
    if (txt) return { 
      tone: "amber", primary: older[0].symbol, others: older.slice(1).map((o) => o.symbol), headline: txt.replace(/^⚡ /, ""),
      detail: older[0].f.resetConditionText ? `${older[0].symbol} resets when: ${older[0].f.resetConditionText}. Don't chase.` : "Don't chase — wait for a fresh setup." 
    };
  }
  
  if (ready.length) {
    const p = ready[0];
    return {
      tone: blocked ? "amber" : "green", primary: p.symbol, others: ready.slice(1).map((d) => d.symbol),
      headline: blocked ? `${p.symbol} is Practice Ready — live entry not permitted.` : `${p.symbol} is ${readyStatusLabel(p.setupStatus, live).toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} (practice plan).`,
      detail: "Review its plan and chart before taking any action.",
    };
  }
  
  const conf = sorted.filter((d) => d.setupStatus === "SETUP_CONFIRMED" && usable(d));
  if (conf.length) return { tone: "blue", primary: conf[0].symbol, others: conf.slice(1).map((d) => d.symbol), headline: `${conf[0].symbol}: setup confirmed — awaiting 1H close.`, detail: "Nothing to act on yet; the plan becomes Ready only after a closed 1H trigger." };
  
  if (blocked) return { tone: "red", primary: null, others: [], headline: "Stand down — capital protection.", detail: "Regime is RED: no new live risk. Watch the forming setups below." };
  
  const forming = sorted.filter((d) => ["WATCH_RETEST", "SETUP_FORMING"].includes(d.setupStatus));
  if (forming.length) return { tone: "gray", primary: null, others: forming.map((d) => d.symbol), headline: "Nothing ready — watch only.", detail: "Forming setups need more closed candles; set alerts instead of front-running." };
  
  return { tone: "gray", primary: null, others: [], headline: "Quiet day — no qualifying setups.", detail: "No trade is a position." };
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────

export default function DoTodayCard() {
  const swingOn = useSwingEnabled();
  
  const regimeQ = useQuery<RegimeSnap>({ queryKey: ["/api/regime-v2"], refetchInterval: 60_000, enabled: !swingOn });
  const flexQ = useQuery<FlexScanResult>({
    queryKey: ["/api/flex-scan-cached"],
    queryFn: async () => (await apiRequest("POST", "/api/flex-scan", { include_tech_concentrated: true })).json(),
    staleTime: 60_000, enabled: !swingOn,
  });
  
  const scan = useScan(REQ, swingOn);
  const fresh = useFreshness();
  const plans = useSelectedPlans();
  
  const g = swingOn ? swingGuidance((scan.data?.rows ?? []).map((r) => r.decision), scan.data?.livePermission ?? null, (d) => fresh(d, activeVersion(d, plans.data?.selected))) : null;
  const v: Verdict & { primary?: string | null; others?: string[] } = g ?? pickVerdict(regimeQ.data, flexQ.data);
  const style = TONE_STYLES[v.tone];
  
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center items-start gap-4 rounded-lg border p-4 shadow-sm ${style.border} ${style.bg}`} data-testid="card-do-today">
      
      {/* Icon & Text Block */}
      <div className="flex min-w-0 flex-1 items-start sm:items-center gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${style.chip}`}>
          <Compass className={`h-5 w-5 ${style.text}`} aria-hidden />
        </div>
        
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">What should I do today?</span>
            <span className={`truncate text-sm font-bold ${style.text}`} data-testid="text-do-today-headline">
              {swingOn && scan.isLoading ? "Checking the watchlist…" : v.headline}
            </span>
          </div>
          <span className="text-xs font-medium leading-relaxed text-soft-white/80" data-testid="text-do-today-detail">
            {v.detail}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex w-full shrink-0 flex-wrap items-center gap-3 pt-2 sm:ml-auto sm:w-auto sm:pt-0">
        {(v.others ?? []).map((sym) => (
          <button 
            key={sym} 
            onClick={() => openTradingCard(sym)} 
            className="rounded-md border border-ink-line bg-ink-black/40 px-3 py-1.5 text-xs font-mono font-medium text-slate-gray transition-colors hover:border-neon-blue hover:bg-ink-deep hover:text-neon-blue" 
            data-testid={`chip-today-${sym}`}
          >
            {sym}
          </button>
        ))}
        
        {v.primary && (
          <button 
            onClick={() => openTradingCard(v.primary!)} 
            className="inline-flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-4 py-2 text-xs font-mono font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" 
            data-testid={`button-today-open-plan-${v.primary}`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> OPEN {v.primary} PLAN
          </button>
        )}
      </div>

    </div>
  );
}
