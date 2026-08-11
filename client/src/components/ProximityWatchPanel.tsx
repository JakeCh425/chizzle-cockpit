// ─── ProximityWatchPanel ───────────────────────────────────────────────────
// Pinned at the top of the cockpit. Shows tickers moving through the Chizzle
// proximity pipeline: REACHING → TOUCHING → READY → REJECTED.
// - REJECTED items fade out ~10s after first render so the user sees the
//   "no trade" reason briefly, then the list clears down to real signal.
// - Clicking a READY tile emits a "prefill PLAN" event with the suggested
//   entry/stop/T1/T2 so the trade check form auto-fills.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

export type ProximityStatus = "REACHING" | "TOUCHING" | "READY" | "REJECTED";

export interface ProximityCandidate {
  ticker: string;
  status: ProximityStatus;
  last: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr14: number | null;
  distance_from_sma20_pct: number | null;
  in_band: boolean;
  above_50sma: boolean;
  above_200sma: boolean;
  suggested_entry: number | null;
  suggested_stop: number | null;
  suggested_t1: number | null;
  suggested_t2: number | null;
  suggested_rr: number | null;
  reason: string;
  computed_at: string;
}

export interface ProximityScan {
  universe_size: number;
  candidates: ProximityCandidate[];
  computed_at: string;
}

// Global event so PipelineCockpit / TradeCheckPanel can react without prop drilling.
export const PROXIMITY_PREFILL_EVENT = "chizzle:prefill-plan";
export interface PrefillPayload {
  ticker: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number | null;
}

const STATUS_META: Record<ProximityStatus, { bg: string; text: string; border: string; label: string; priority: number }> = {
  READY:    { bg: "bg-signal-green/10", text: "text-signal-green", border: "border-signal-green", label: "READY",    priority: 0 },
  TOUCHING: { bg: "bg-signal-amber/10", text: "text-signal-amber", border: "border-signal-amber", label: "TOUCHING", priority: 1 },
  REACHING: { bg: "bg-neon-blue/10",    text: "text-neon-blue",    border: "border-neon-blue",    label: "REACHING", priority: 2 },
  REJECTED: { bg: "bg-signal-red/10",   text: "text-signal-red",   border: "border-signal-red",   label: "NO TRADE", priority: 3 },
};

// Time in ms a REJECTED tile stays visible before fading out (spec: "fades away after showing no trade").
const REJECTED_FADE_MS = 10_000;

function fmtPrice(n: number | null | undefined): string {
  return n == null ? "-" : `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined, dp = 1): string {
  return n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

interface Props {
  onPrefillPlan?: (payload: PrefillPayload) => void;
}

export default function ProximityWatchPanel({ onPrefillPlan }: Props) {
  const scanQ = useQuery<ProximityScan>({
    queryKey: ["/api/proximity-watch"],
    refetchInterval: 60_000,
  });

  // Track when each REJECTED ticker was first observed so we can fade it out.
  // Keyed by ticker + computed_at so a re-scan resets the fade timer.
  const [firstSeenRejected, setFirstSeenRejected] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!scanQ.data) return;
    setFirstSeenRejected((prev) => {
      const next = { ...prev };
      for (const c of scanQ.data!.candidates) {
        if (c.status === "REJECTED") {
          const key = `${c.ticker}:${c.computed_at}`;
          if (!(key in next)) next[key] = Date.now();
        }
      }
      // Garbage-collect keys not present in the latest scan
      const validKeys = new Set(
        scanQ.data!.candidates
          .filter((c) => c.status === "REJECTED")
          .map((c) => `${c.ticker}:${c.computed_at}`),
      );
      for (const k of Object.keys(next)) {
        if (!validKeys.has(k)) delete next[k];
      }
      return next;
    });
  }, [scanQ.data]);

  // Tick the clock every second so faded tiles disappear smoothly.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const visibleCandidates = useMemo(() => {
    if (!scanQ.data) return [];
    return scanQ.data.candidates.filter((c) => {
      if (c.status !== "REJECTED") return true;
      const key = `${c.ticker}:${c.computed_at}`;
      const seenAt = firstSeenRejected[key];
      if (!seenAt) return true;
      return now - seenAt < REJECTED_FADE_MS;
    });
  }, [scanQ.data, firstSeenRejected, now]);

  // Group by status for cleaner rendering.
  const grouped = useMemo(() => {
    const by: Record<ProximityStatus, ProximityCandidate[]> = { READY: [], TOUCHING: [], REACHING: [], REJECTED: [] };
    for (const c of visibleCandidates) by[c.status].push(c);
    return by;
  }, [visibleCandidates]);

  function handleClickReady(c: ProximityCandidate) {
    if (c.suggested_entry == null || c.suggested_stop == null || c.suggested_t1 == null) return;
    const payload: PrefillPayload = {
      ticker: c.ticker,
      entry: c.suggested_entry,
      stop: c.suggested_stop,
      t1: c.suggested_t1,
      t2: c.suggested_t2,
    };
    // Fire the global event so any listener (TradeCheckPanel, PipelineCockpit) can consume it.
    window.dispatchEvent(new CustomEvent(PROXIMITY_PREFILL_EVENT, { detail: payload }));
    onPrefillPlan?.(payload);
  }

  const total = scanQ.data?.universe_size ?? 0;
  const readyCount = grouped.READY.length;
  const touchingCount = grouped.TOUCHING.length;
  const reachingCount = grouped.REACHING.length;
  const rejectedCount = grouped.REJECTED.length;

  return (
    <div className="rounded-md border border-ink-line bg-ink-black" data-testid="section-proximity-watch">
      <div className="flex items-center justify-between p-3 border-b border-ink-line">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-soft-white uppercase tracking-wide">Proximity Watch</h3>
          <div className="hidden sm:flex items-center gap-2 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-signal-green/10 text-signal-green font-bold">READY {readyCount}</span>
            <span className="px-1.5 py-0.5 rounded bg-signal-amber/10 text-signal-amber font-bold">TOUCHING {touchingCount}</span>
            <span className="px-1.5 py-0.5 rounded bg-neon-blue/10 text-neon-blue font-bold">REACHING {reachingCount}</span>
            {rejectedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-signal-red/10 text-signal-red font-bold">NO TRADE {rejectedCount}</span>
            )}
            <span className="text-slate-gray">· {total} symbols</span>
          </div>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/proximity-watch"] })}
          className="text-xs px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue flex items-center gap-1"
          data-testid="button-refresh-proximity"
          disabled={scanQ.isFetching}
        >
          <RefreshCw className={`h-3 w-3 ${scanQ.isFetching ? "animate-spin" : ""}`} />
          {scanQ.isFetching ? "Scanning..." : "Rescan"}
        </button>
      </div>

      {scanQ.isLoading ? (
        <div className="p-6 text-center text-xs text-slate-gray">Scanning universe...</div>
      ) : visibleCandidates.length === 0 ? (
        <div className="p-6 text-center text-xs text-slate-gray">
          No candidates in range — all filters passed nothing this scan.
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {(["READY", "TOUCHING", "REACHING", "REJECTED"] as ProximityStatus[]).map((status) => {
            const items = grouped[status];
            if (items.length === 0) return null;
            const meta = STATUS_META[status];
            return (
              <div key={status}>
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${meta.text}`}>
                  {meta.label} · {items.length}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {items.map((c) => (
                    <ProximityTile
                      key={`${c.ticker}:${c.computed_at}`}
                      candidate={c}
                      onClickReady={handleClickReady}
                      fadeAt={
                        status === "REJECTED"
                          ? (firstSeenRejected[`${c.ticker}:${c.computed_at}`] ?? Date.now()) + REJECTED_FADE_MS
                          : null
                      }
                      now={now}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tile ────────────────────────────────────────────────────────────────────
function ProximityTile({
  candidate,
  onClickReady,
  fadeAt,
  now,
}: {
  candidate: ProximityCandidate;
  onClickReady: (c: ProximityCandidate) => void;
  fadeAt: number | null;
  now: number;
}) {
  const meta = STATUS_META[candidate.status];
  const clickable = candidate.status === "READY";

  // Compute fade opacity for REJECTED tiles (last 3s of REJECTED_FADE_MS window).
  let opacity = 1;
  if (fadeAt != null) {
    const remaining = fadeAt - now;
    if (remaining <= 0) opacity = 0;
    else if (remaining <= 3000) opacity = Math.max(0, remaining / 3000);
  }

  return (
    <button
      type="button"
      onClick={() => clickable && onClickReady(candidate)}
      disabled={!clickable}
      style={{ opacity, transition: "opacity 300ms linear" }}
      className={`text-left rounded-md border ${meta.border} ${meta.bg} p-2 space-y-1 ${
        clickable ? "hover:brightness-125 cursor-pointer" : "cursor-default"
      }`}
      data-testid={`proximity-tile-${candidate.ticker}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-soft-white font-mono">{candidate.ticker}</span>
        <span className={`text-[9px] font-bold ${meta.text}`}>{meta.label}</span>
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono text-soft-white">{fmtPrice(candidate.last)}</span>
        <span
          className={`font-mono text-[10px] ${
            candidate.distance_from_sma20_pct == null
              ? "text-slate-gray"
              : candidate.distance_from_sma20_pct > 0
              ? "text-signal-green"
              : "text-signal-red"
          }`}
        >
          {fmtPct(candidate.distance_from_sma20_pct)} vs 20SMA
        </span>
      </div>
      <div className="text-[10px] text-slate-gray leading-snug min-h-[24px]" data-testid={`proximity-reason-${candidate.ticker}`}>
        {candidate.reason || "\u00A0"}
      </div>
      {clickable && (
        <div className="flex items-center justify-between pt-1 border-t border-ink-line/60">
          <span className="text-[10px] font-mono text-slate-gray">
            E {fmtPrice(candidate.suggested_entry)} · S {fmtPrice(candidate.suggested_stop)}
          </span>
          <ArrowRight className="h-3 w-3 text-signal-green" />
        </div>
      )}
    </button>
  );
}
