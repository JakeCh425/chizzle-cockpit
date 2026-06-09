import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface PatternFormingStatus {
  symbol: string;
  status: "forming" | "confirmed" | "invalid" | "none";
  label: string;
  pattern: "Hammer" | "Engulfing" | null;
  severity: "watch" | "warm" | "hot" | "invalid" | "none";
  candleProgress: number;
  currentBar: { open: number; high: number; low: number; close: number };
  context: {
    lowerLow: boolean;
    aboveSMA20: boolean | null;
    distPctFromSMA20: number | null;
    setupHigh: number | null;
    targetClose: number | null;
  };
  asOf: number;
}

const severityClass: Record<PatternFormingStatus["severity"], string> = {
  hot: "border-signal-green/60 bg-signal-green/10 text-signal-green animate-pulse",
  warm: "border-signal-amber/60 bg-signal-amber/10 text-signal-amber",
  watch: "border-neon-blue/60 bg-neon-blue/10 text-neon-blue",
  invalid: "border-signal-red/60 bg-signal-red/10 text-signal-red",
  none: "border-ink-line/60 bg-ink-deep/20 text-slate-gray",
};

const statusGlyph: Record<PatternFormingStatus["status"], string> = {
  forming: "◐",
  confirmed: "●",
  invalid: "○",
  none: "·",
};

/**
 * PatternFormingBadge — small live indicator that polls /api/pattern-forming/:symbol
 * every 45 seconds. Renders nothing for "none" status to avoid noise.
 *
 * Variants:
 *   - "chip" (default): inline pill with glyph + short label
 *   - "row": full-width row used in Cockpit / dashboards
 */
export function PatternFormingBadge({
  symbol,
  variant = "chip",
  hideWhenNone = true,
}: {
  symbol: string;
  variant?: "chip" | "row";
  hideWhenNone?: boolean;
}) {
  const sym = symbol.toUpperCase();
  const { data, isLoading } = useQuery<PatternFormingStatus>({
    queryKey: ["/api/pattern-forming", sym],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pattern-forming/${sym}`);
      return res.json();
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  });

  if (isLoading || !data) return null;
  if (hideWhenNone && data.status === "none") return null;

  const cls = severityClass[data.severity] ?? severityClass.none;
  const glyph = statusGlyph[data.status] ?? "·";

  if (variant === "row") {
    return (
      <div
        className={`flex items-center gap-2 px-2 py-1 border rounded-sm text-[11px] font-mono-num ${cls}`}
        title={data.label}
        data-testid={`pattern-forming-row-${sym}`}
      >
        <span className="text-base leading-none" aria-hidden="true">{glyph}</span>
        <span className="uppercase tracking-wider text-[10px] opacity-80">{data.pattern ?? "Setup"}</span>
        <span className="flex-1 truncate">{data.label}</span>
        {data.candleProgress > 0 && data.candleProgress < 1 && (
          <span className="text-[9px] opacity-60">{Math.round(data.candleProgress * 100)}%</span>
        )}
      </div>
    );
  }

  // Chip variant
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono-num uppercase tracking-wider border rounded-sm ${cls}`}
      title={data.label}
      data-testid={`pattern-forming-chip-${sym}`}
    >
      <span aria-hidden="true">{glyph}</span>
      <span>
        {data.status === "confirmed" ? "CONFIRMED" :
         data.status === "forming" ? `${data.pattern ?? "Setup"} forming` :
         data.status === "invalid" ? "Invalid" : ""}
      </span>
    </span>
  );
}
