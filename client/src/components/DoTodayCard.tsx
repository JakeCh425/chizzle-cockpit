// ─── DoTodayCard ──────────────────────────────────────────────────────────
// One plain-English sentence answering "What should I do today?" derived
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
import { Compass } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { FlexScanResult } from "@shared/flexScanTypes";

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

export default function DoTodayCard() {
  const regimeQ = useQuery<RegimeSnap>({
    queryKey: ["/api/regime-v2"],
    refetchInterval: 60_000,
  });
  const scanQ = useQuery<FlexScanResult>({
    queryKey: ["/api/flex-scan-cached"],
    queryFn: async () => {
      // Use the same POST endpoint the scanner uses. Empty universe = defaults.
      const res = await apiRequest("POST", "/api/flex-scan", { include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const v = pickVerdict(regimeQ.data, scanQ.data);
  const style = TONE_STYLES[v.tone];

  return (
    <div
      className={`rounded-md border ${style.border} ${style.bg} p-3.5 flex items-start gap-3`}
      data-testid="card-do-today"
    >
      <div className={`rounded-md ${style.chip} p-2 flex-shrink-0`}>
        <Compass className={`h-4 w-4 ${style.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">What should I do today?</span>
          <span className={`text-[13px] font-bold ${style.text}`} data-testid="text-do-today-headline">
            {v.headline}
          </span>
        </div>
        <div className="text-[11.5px] text-soft-white/90 leading-snug mt-1">{v.detail}</div>
      </div>
    </div>
  );
}
