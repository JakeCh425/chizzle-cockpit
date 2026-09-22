// ─── MultiTimeframeContext ───────────────────────────────────────────────
// Read-only strip that reports the selected ticker's trend character on
// 30m / 1H / 4H / 1D at a glance, so the user can spot alignment before
// pulling the trigger. Fetches four small candle series in parallel; each
// query is cached by TanStack so switching tickers or timeframes doesn't
// refire until the cache goes stale.
//
// Does NOT emit trade signals, override the scanner, or feed the trade
// planner — display-only, exactly as spec'd.

import { useQueries } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { TIMEFRAMES, maybeAggregate, type Timeframe } from "@/lib/timeframes";

interface OHLCBar { time?: number; date?: string; open: number; high: number; low: number; close: number; volume?: number }

// Swing-trader multi-timeframe alignment view. 30m/1H = intraday context,
// 4H = swing timing, 1D = primary trend, 1W = swing trend, 1M = macro tape.
// 1W and 1M reuse the 1D fetch and aggregate client-side (no extra network).
const CONTEXT_TFS: Timeframe[] = ["30m", "1H", "4H", "1D", "1W", "1M"];

// ── Trend classification ─────────────────────────────────────────────────
// Uses only material already on the chart (20/50 SMAs + up/down bias).
// Not a signal generator — a color-coded shorthand for "which direction
// is this timeframe leaning right now?" so alignment is visible at a glance.
type Verdict = "BULLISH" | "IMPROVING" | "NEUTRAL" | "WEAKENING" | "BEARISH" | "NA";
const VERDICT_STYLE: Record<Verdict, { text: string; bg: string; border: string; label: string }> = {
  BULLISH:    { text: "text-signal-green", bg: "bg-signal-green/10", border: "border-signal-green/40", label: "Bullish" },
  IMPROVING:  { text: "text-signal-green", bg: "bg-signal-green/5",  border: "border-signal-green/25", label: "Improving" },
  NEUTRAL:    { text: "text-slate-gray",   bg: "bg-ink-panel/40",    border: "border-ink-line",       label: "Neutral" },
  WEAKENING:  { text: "text-signal-amber", bg: "bg-signal-amber/10", border: "border-signal-amber/40", label: "Weakening" },
  BEARISH:    { text: "text-signal-red",   bg: "bg-signal-red/10",   border: "border-signal-red/40",   label: "Bearish" },
  NA:         { text: "text-slate-gray",   bg: "bg-ink-panel/40",    border: "border-ink-line/60",    label: "Not available" },
};

function sma(vals: number[], period: number): number | null {
  if (vals.length < period) return null;
  let s = 0;
  for (let i = vals.length - period; i < vals.length; i++) s += vals[i];
  return s / period;
}

function classify(bars: OHLCBar[] | undefined): Verdict {
  if (!bars || bars.length < 25) return "NA";
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  if (s20 == null) return "NA";
  const upDay = last >= prev;

  if (s50 != null && last > s20 && s20 > s50) return upDay ? "BULLISH" : "IMPROVING";
  if (last > s20) return "IMPROVING";
  if (s50 != null && last < s20 && last > s50) return "WEAKENING";
  if (s50 != null && last < s20 && s20 < s50) return upDay ? "WEAKENING" : "BEARISH";
  return "NEUTRAL";
}

interface Props {
  ticker: string;
  /** The active chart timeframe — its cell is highlighted. */
  activeTf: Timeframe;
}

export default function MultiTimeframeContext({ ticker, activeTf }: Props) {
  // Parallel fetch, one per unique apiValue. 1W and 1M both map to 1D,
  // and the main chart also fetches 1D — TanStack dedupes on queryKey so
  // this whole strip issues at most 4 requests (30M/1H/4H/1D), not 6.
  const queries = useQueries({
    // NOTE: this queryKey is intentionally NOT shared with CockpitWorkspace
    // (which uses a "withMeta" suffix) — sharing the key caused shape
    // collisions that crashed the workspace with "t.map is not a function".
    queries: CONTEXT_TFS.map((tf) => ({
      queryKey: ["/api/candles-ohlc", ticker, TIMEFRAMES[tf].apiValue],
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=${TIMEFRAMES[tf].apiValue}`);
        const json = await res.json();
        // Defensive normalizer — always return an array so downstream .map()
        // / .slice() cannot throw regardless of endpoint response shape.
        return (Array.isArray(json) ? json : json?.bars || []) as OHLCBar[];
      },
      staleTime: 60_000,
      // Keep previous MTF cells visible while a new fetch resolves.
      placeholderData: (prev: OHLCBar[] | undefined) => prev,
    })),
  });

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="mtf-context-strip"
      title="Multi-timeframe trend context. Display-only — does not affect trade plans or scanner."
    >
      <span className="text-[10px] uppercase tracking-wider text-slate-gray font-bold flex-shrink-0">
        Context
      </span>
      {CONTEXT_TFS.map((tf, i) => {
        const q = queries[i];
        // For 1W/1M we aggregate the fetched 1D bars into weekly/monthly
        // before classifying, so the verdict reflects the actual swing tape.
        const bars = maybeAggregate(q.data as OHLCBar[] | undefined, tf);
        const verdict: Verdict = q.isLoading ? "NA" : classify(bars);
        const style = VERDICT_STYLE[verdict];
        const isActive = tf === activeTf;
        // 4H/1D/1W get heavier emphasis — those are the primary swing
        // decision timeframes (1M is macro context only).
        const emphasize = tf === "4H" || tf === "1D" || tf === "1W";
        return (
          <div
            key={tf}
            data-testid={`mtf-cell-${tf}`}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${style.bg} ${style.border} ${
              isActive ? "ring-1 ring-neon-blue/60" : ""
            }`}
          >
            <span className={`text-[10px] font-mono ${emphasize ? "font-bold text-soft-white" : "text-slate-gray"}`}>
              {TIMEFRAMES[tf].label}
            </span>
            <span className={`text-[10px] font-mono ${style.text}`}>{style.label}</span>
          </div>
        );
      })}
    </div>
  );
}
