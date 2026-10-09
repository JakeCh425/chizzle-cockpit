// ─── DoTodayCard ──────────────────────────────────────────────────────────
// One compact guidance row (≈50–70px). With the Unified Swing Engine on it reads the SAME scan as
// the Action Center (no competing readiness source) and points at the existing trading card; the
// full entry/stop/target layout lives only in that card. Otherwise: one plain-English sentence answering "What should I do today?" derived
// entirely from existing regime-v2 output + flex-scan counts. No new signals
// are invented — this is a translation layer over rules we already publish.
//
// Read order of authority (highest wins):
//   1. regime day_class = RED       -> capital protection, stand down
//   2. flex-scan day_type STAND_DOWN-> stand down
//   3. regime YELLOW + no STANDARD  -> highest-quality only, half size
//   4. STANDARD_READY count > 0     -> take the best; standard size
//   5. FLEX_READY count > 0         -> half size, best only
//   6. FLEX_WATCH count > 0         -> alerts only, don't front-run
//   7. otherwise                    -> quiet day, no new risk

import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { FlexScanResult } from "@shared/flexScanTypes";
import type { ScanSelection, SwingDecision } from "@shared/swingDecision";
import { readyStatusLabel, sortForCockpit, type LivePermission } from "@shared/readyAlerts";
import { useSwingEnabled } from "@/lib/swing";
import { openTradingCard } from "@/lib/alerts";
import { useScan } from "@/components/swing/SwingWorkspace";

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
      detail:
        "Regime is RED. No new long risk today. Manage existing positions to plan; do not add.",
    };
  }
  if (band === "YELLOW" && readyCount === 0) {
    return {
      tone: "amber",
      headline: "Highest-quality only, half size",
      detail:
        "Mixed regime — focus on the strongest setup, take half size, and skip anything extended.",
    };
  }
  const readyNames = cards.filter((c) => c.state === "STANDARD_READY" || c.state === "FLEX_READY").map((c) => c.ticker);
  if (readyNames.length > 0 && cards.some((c: any) => c.unified)) {
    return {
      tone: "green",
      headline: `${readyNames.join(", ")} ${readyNames.length === 1 ? "is" : "are"} ready — practice plan below`,
      detail:
        "The swing engine lines up on trend, structure and a closed 1H trigger. Review the plan card, then open the chart to check it yourself.",
    };
  }
  if (readyCount > 0) {
    return {
      tone: "green",
      headline: `${readyCount} STANDARD READY — take the best`,
      detail:
        "Trend, structure, and volume line up. Enter the top-graded setup at listed trigger and stop.",
    };
  }
  if (flexReadyCount > 0) {
    return {
      tone: "green",
      headline: `${flexReadyCount} FLEX READY — half size on best`,
      detail:
        "One factor is soft. Take half size only, and confirm the trigger bar closes before entering.",
    };
  }
  if (watchCount > 0) {
    return {
      tone: "blue",
      headline: `${watchCount} on watch — alerts only`,
      detail:
        "Patterns forming. Set trigger alerts; don't front-run. Wait for the setup to arm.",
    };
  }
  return {
    tone: "gray",
    headline: "Quiet day — no qualifying setups",
    detail:
      "No qualifying long setups right now. Continue watching regime, breadth, and volume — no new risk.",
  };
}

const TONE_STYLES: Record<Verdict["tone"], { border: string; bg: string; text: string; chip: string }> = {
  green: { border: "border-signal-green/40", bg: "bg-signal-green/8", text: "text-signal-green", chip: "bg-signal-green/15" },
  amber: { border: "border-signal-amber/40", bg: "bg-signal-amber/8", text: "text-signal-amber", chip: "bg-signal-amber/15" },
  red:   { border: "border-signal-red/40",   bg: "bg-signal-red/8",   text: "text-signal-red",   chip: "bg-signal-red/15" },
  blue:  { border: "border-neon-blue/40",    bg: "bg-neon-blue/8",    text: "text-neon-blue",    chip: "bg-neon-blue/15" },
  gray:  { border: "border-ink-line",        bg: "bg-ink-panel/40",   text: "text-slate-gray",   chip: "bg-ink-line" },
};


const REQ = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [] as string[], force: 0 };
const usable = (d: SwingDecision) => d.dataStatus !== "STALE" && d.dataStatus !== "ERROR" && !d.evalPending; // Part 3: a saved snapshot is never "Ready now"

/** Guidance from the swing engine's decisions + separate live-risk permission. Never upgrades a status. */
function swingGuidance(rows: SwingDecision[], live: LivePermission | null): (Verdict & { primary: string | null; others: string[] }) | null {
  const sorted = sortForCockpit(rows);
  const ready = sorted.filter((d) => d.setupStatus === "READY_TO_TRADE" && usable(d));
  const blocked = !!live && !live.allowed;
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

export default function DoTodayCard() {
  const swingOn = useSwingEnabled();
  const regimeQ = useQuery<RegimeSnap>({ queryKey: ["/api/regime-v2"], refetchInterval: 60_000, enabled: !swingOn });
  const flexQ = useQuery<FlexScanResult>({
    queryKey: ["/api/flex-scan-cached"],
    queryFn: async () => (await apiRequest("POST", "/api/flex-scan", { include_tech_concentrated: true })).json(),
    staleTime: 60_000, enabled: !swingOn,
  });
  const scan = useScan(REQ, swingOn);
  const g = swingOn ? swingGuidance((scan.data?.rows ?? []).map((r) => r.decision), scan.data?.livePermission ?? null) : null;
  const v: Verdict & { primary?: string | null; others?: string[] } = g ?? pickVerdict(regimeQ.data, flexQ.data);
  const style = TONE_STYLES[v.tone];
  return (
    <div className={`rounded-md border ${style.border} ${style.bg} px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5`} data-testid="card-do-today">
      <Compass className={`h-4 w-4 shrink-0 ${style.text}`} aria-hidden />
      <span className="text-[10px] uppercase tracking-wider text-slate-gray">What should I do today?</span>
      <span className={`text-[13px] font-bold ${style.text}`} data-testid="text-do-today-headline">{swingOn && scan.isLoading ? "Checking the watchlist…" : v.headline}</span>
      <span className="text-[11.5px] text-soft-white/85" data-testid="text-do-today-detail">{v.detail}</span>
      <span className="ml-auto flex flex-wrap items-center gap-1.5">
        {(v.others ?? []).map((sym) => (
          <button key={sym} className="rounded-full border border-ink-line px-2 py-0.5 font-mono text-[11px] text-soft-white hover:border-neon-blue" onClick={() => openTradingCard(sym)} data-testid={`chip-today-${sym}`}>{sym}</button>
        ))}
        {v.primary && (
          <button className="inline-flex items-center gap-1 rounded border border-neon-blue/60 px-2.5 py-1 font-mono text-[11.5px] font-bold text-neon-blue hover:bg-neon-blue/10" onClick={() => openTradingCard(v.primary!)} data-testid={`button-today-open-plan-${v.primary}`}>
            <ExternalLink className="h-3 w-3" aria-hidden /> OPEN {v.primary} PLAN
          </button>
        )}
      </span>
    </div>
  );
}
