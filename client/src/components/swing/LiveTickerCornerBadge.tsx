// Live ticker corner badge — symbol · price · session change · market status.
// Display only (PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE). No order actions.
// Data: the shared scan cache (decision.currentPrice — same quote every panel shows) + the shared
// useMarketContext(symbol, "D") query (same cache key the Trade Summary uses), so mounting it in several
// sections never adds network requests. Hidden when the context UI flag is off (flag-off = unchanged).
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SwingDecision } from "@shared/swingDecision";
import { badgeModel, badgeTooltip, type MarketSession } from "@shared/liveBadge";
import { useContextUiEnabled, useMarketContext } from "@/lib/marketContext";

export interface LiveTickerCornerBadgeProps {
  symbol: string;
  className?: string;
  compact?: boolean;
  showDayRange?: boolean;
}

/** Latest decision for `symbol` from any cached scan (no fetch). */
function useCachedDecision(symbol: string): SwingDecision | null {
  const qc = useQueryClient();
  const sym = symbol.toUpperCase();
  const read = () => {
    let best: SwingDecision | null = null;
    for (const [, data] of qc.getQueriesData<{ rows?: { decision: SwingDecision }[] }>({ queryKey: ["/api/swing/scan"] })) {
      for (const r of data?.rows ?? []) {
        if (r.decision?.symbol?.toUpperCase() !== sym) continue;
        if (!best || (r.decision.evaluatedAt ?? "") > (best.evaluatedAt ?? "")) best = r.decision;
      }
    }
    return best;
  };
  const sub = (cb: () => void) => qc.getQueryCache().subscribe(cb);
  // Snapshot = identity string so React only re-renders when the matched decision actually changes.
  const key = useSyncExternalStore(sub, () => { const d = read(); return d ? `${d.symbol}|${d.evaluatedAt}|${d.currentPrice}` : ""; });
  return key ? read() : null;
}

const DOT: Record<MarketSession, string> = { LIVE: "bg-emerald-400 animate-pulse", PRE: "bg-amber-400", POST: "bg-amber-400", CLOSED: "bg-slate-500" };
const TONE = { up: "text-emerald-400", down: "text-rose-400", flat: "text-slate-400" } as const;
const BORDER = { up: "border-emerald-500/40", down: "border-rose-500/40", flat: "border-slate-700" } as const;

function ctTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(t)} CT`;
}

export default function LiveTickerCornerBadge({ symbol, className = "", compact = false, showDayRange = false }: LiveTickerCornerBadgeProps) {
  const ui = useContextUiEnabled();
  const sym = (symbol ?? "").toUpperCase();
  const decision = useCachedDecision(sym);
  const ctx = useMarketContext(sym || undefined, "D", { stamp: decision?.evaluatedAt ?? null, enabled: ui && !!sym });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  if (!ui || !sym) return null;
  const c = ctx.data;
  const price = decision?.currentPrice ?? c?.quote?.price ?? null;
  const m = badgeModel({ symbol: sym, price, priorClose: c?.day?.priorClose ?? null, now, dayState: c?.day?.state ?? null });
  const tip = badgeTooltip({
    lod: c?.day?.lod ?? null, hod: c?.day?.hod ?? null, volume: c?.indicators?.volume ?? null,
    lastBar: ctTime(c?.lastClosedBar ?? null), source: c?.snapshot?.source ?? decision?.dataSource ?? null,
  });
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border ${BORDER[m.tone]} bg-[#050a13]/90 px-1.5 py-0.5 font-mono text-[11px] leading-4 ${className}`}
      title={tip} data-testid={`badge-live-ticker-${sym}`} data-tone={m.tone} data-session={m.session}
    >
      <span className="font-bold text-slate-100" data-testid="text-badge-symbol">{m.symbol}</span>
      <span className="text-slate-100" data-testid="text-badge-price">{m.priceText}</span>
      {!compact && <span className={TONE[m.tone]} data-testid="text-badge-change">{m.chgText}</span>}
      {compact && m.pct != null && <span className={TONE[m.tone]} data-testid="text-badge-change">{m.chgText.replace(/^.*\((.*)\)$/, "$1")}</span>}
      {showDayRange && c?.day?.lod != null && c?.day?.hod != null && (
        <span className="text-slate-400" data-testid="text-badge-range">${c.day.lod.toFixed(2)}–${c.day.hod.toFixed(2)}</span>
      )}
      <span className="inline-flex items-center gap-1 text-[10px] text-slate-400" data-testid="status-badge-session">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[m.session]}`} />{m.sessionText}
      </span>
    </span>
  );
}
