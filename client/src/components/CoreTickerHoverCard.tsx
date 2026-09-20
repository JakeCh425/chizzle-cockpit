// ─── CoreTickerHoverCard ─────────────────────────────────────────────────
// Rich hover-only card for Core rows in Market Pulse. Shows:
//   • Trade idea = existing FLEX-scan verdict + plan levels (entry/stop/T1/T2)
//   • Readiness meter (0-100) with the remaining checklist items ("distance
//     to ready") so you can see *how close* the setup is to being pushable
//     without actually pushing it. This card never calls /api/trade-plans.
//   • Fundamentals snapshot from Finnhub (sector, industry, mkt cap, P/E,
//     52w range, dividend, earnings) — pulled from our new passthrough
//     /api/finnhub-profile endpoint. All fields degrade to "—" on miss.
//
// This is display-only; the user can promote to a real trade plan via the
// existing Setup / Trade Planner buttons on other panels.

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Target, TrendingUp, AlertTriangle, Zap } from "lucide-react";

interface FlexScanResp {
  cards?: any[];
}
interface FinnhubResp {
  profile: {
    name?: string;
    finnhubIndustry?: string;
    gicsSector?: string;
    exchange?: string;
    marketCapitalization?: number; // millions of USD
    shareOutstanding?: number;
    weburl?: string;
    ipo?: string;
  } | null;
  metric: Record<string, number | null> | null;
}

function fmt2(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toFixed(2);
}
function fmtPct(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}%`;
}
function fmtMktCap(m?: number | null): string {
  // Finnhub returns marketCapitalization in millions.
  if (!m || !Number.isFinite(m)) return "—";
  if (m >= 1_000_000) return `$${(m / 1_000_000).toFixed(2)}T`;
  if (m >= 1_000) return `$${(m / 1_000).toFixed(1)}B`;
  return `$${m.toFixed(0)}M`;
}

interface Props {
  ticker: string;
}

export default function CoreTickerHoverCard({ ticker }: Props) {
  // Flex-scan: primary source of readiness + trade plan. This queryKey is
  // shared with TechnicalSnapshot & TickerStrengthGauge — TanStack dedupes
  // the network call automatically.
  const flexQ = useQuery<FlexScanResp>({
    queryKey: ["/api/flex-scan", ticker],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", { universe: [ticker], include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
  });

  // Finnhub passthrough. 10-min server cache; short client staleTime so it
  // stays quiet on hover-hover-hover.
  const fundQ = useQuery<FinnhubResp>({
    queryKey: ["/api/finnhub-profile", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/finnhub-profile/${ticker}`);
      return await res.json();
    },
    staleTime: 10 * 60_000,
  });

  const cards = flexQ.data?.cards || [];
  const card = cards.find((c: any) => c?.ticker === ticker) || cards[0];
  const readiness: number | null = card?.readiness_score ?? null;
  const state: string = card?.state ?? "STANDBY";
  const hardBlocks: string[] = Array.isArray(card?.hard_blocks) ? card.hard_blocks : [];
  const distance: Array<{ name: string; current?: string; needed?: string; next_action?: string }> =
    Array.isArray(card?.distance_to_ready) ? card.distance_to_ready : [];
  const plan = card?.plan || card?.trade_plan || {};
  const metrics = card?.metrics || {};

  // Verdict tone maps to Snapshot tones — same visual grammar as elsewhere.
  const stateTone =
    hardBlocks.length > 0 ? { label: "STAND DOWN",     bg: "bg-signal-red/10",   text: "text-signal-red",   border: "border-signal-red/40" } :
    state === "STANDARD_READY" ?  { label: "READY \u00b7 STANDARD", bg: "bg-signal-green/10", text: "text-signal-green", border: "border-signal-green/40" } :
    state === "FLEX_READY" ?      { label: "READY \u00b7 FLEX",     bg: "bg-signal-green/10", text: "text-signal-green", border: "border-signal-green/30" } :
    state === "FLEX_WATCH" ?      { label: "WATCH \u00b7 FLEX",     bg: "bg-signal-amber/10", text: "text-signal-amber", border: "border-signal-amber/40" } :
                                  { label: "STANDBY",           bg: "bg-ink-panel/50",    text: "text-slate-gray",   border: "border-ink-line" };

  const readinessColor =
    readiness == null ? "bg-slate-gray/40" :
    readiness >= 80 ? "bg-signal-green" :
    readiness >= 65 ? "bg-signal-green/70" :
    readiness >= 45 ? "bg-signal-amber" :
    "bg-signal-red/70";

  const p = fundQ.data?.profile;
  const m = fundQ.data?.metric || {};

  return (
    <div
      className="w-[340px] rounded-md border border-ink-line bg-ink-black shadow-2xl p-3 space-y-2.5 text-[11px] text-soft-white"
      data-testid={`core-hover-${ticker}`}
    >
      {/* Header — ticker + state + readiness meter */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-[14px] text-neon-blue">{ticker}</span>
            {p?.name && <span className="text-[10px] text-slate-gray truncate">{p.name}</span>}
          </div>
          {(p?.gicsSector || p?.finnhubIndustry) && (
            <div className="text-[9px] uppercase tracking-wider text-slate-gray/80 mt-0.5">
              {p.gicsSector || ""}{p.gicsSector && p.finnhubIndustry ? " \u00b7 " : ""}{p.finnhubIndustry || ""}
            </div>
          )}
        </div>
        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${stateTone.bg} ${stateTone.border} ${stateTone.text} flex-shrink-0`}>
          {stateTone.label}
        </span>
      </div>

      {/* Readiness meter */}
      <div>
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-slate-gray mb-0.5">
          <span>Readiness</span>
          <span className="font-mono text-soft-white">{readiness == null ? "\u2014" : `${Math.round(readiness)}/100`}</span>
        </div>
        <div className="h-1.5 w-full rounded bg-ink-panel/60 overflow-hidden">
          <div
            className={`h-full ${readinessColor} transition-all`}
            style={{ width: `${Math.max(0, Math.min(100, readiness ?? 0))}%` }}
          />
        </div>
      </div>

      {/* Trade idea = existing plan levels. Never modifies the actual plan. */}
      {(plan.entry != null || plan.stop != null || plan.t1 != null || plan.t2 != null) && (
        <div className="rounded border border-ink-line bg-ink-panel/30 p-2">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-gray mb-1">
            <Target className="w-2.5 h-2.5" /> Trade idea (not pushed)
          </div>
          <div className="grid grid-cols-4 gap-1.5 font-mono text-[10.5px]">
            <div><div className="text-[8.5px] text-slate-gray/80">ENTRY</div><div className="text-soft-white">{fmt2(plan.entry)}</div></div>
            <div><div className="text-[8.5px] text-slate-gray/80">STOP</div><div className="text-signal-red">{fmt2(plan.stop)}</div></div>
            <div><div className="text-[8.5px] text-slate-gray/80">T1</div><div className="text-signal-green">{fmt2(plan.t1)}</div></div>
            <div><div className="text-[8.5px] text-slate-gray/80">T2</div><div className="text-signal-green">{fmt2(plan.t2)}</div></div>
          </div>
          {(metrics.rr_t1 != null || metrics.rel_vol != null) && (
            <div className="text-[9.5px] text-slate-gray mt-1.5 flex gap-2 font-mono">
              {metrics.rr_t1 != null && <span>R:R {metrics.rr_t1.toFixed(2)}</span>}
              {metrics.rel_vol != null && <span>Rel Vol {metrics.rel_vol.toFixed(2)}x</span>}
              {metrics.rsi != null && <span>RSI {metrics.rsi.toFixed(0)}</span>}
            </div>
          )}
        </div>
      )}

      {/* Distance-to-ready checklist — what's still gating this setup */}
      {(hardBlocks.length > 0 || distance.length > 0) && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-slate-gray">
            <Zap className="w-2.5 h-2.5" /> What\u2019s gating it
          </div>
          {hardBlocks.slice(0, 3).map((b, i) => (
            <div key={`hb-${i}`} className="flex items-start gap-1 text-[10px] leading-tight text-signal-red">
              <AlertTriangle className="w-2.5 h-2.5 flex-shrink-0 mt-0.5" />
              <span>{b}</span>
            </div>
          ))}
          {distance.slice(0, 3).map((d, i) => (
            <div key={`dr-${i}`} className="text-[10px] leading-tight">
              <div className="text-slate-gray">
                <span className="text-soft-white/90 font-medium">{d.name}</span>
                {d.current ? ` \u2014 ${d.current}` : ""}
              </div>
              {d.next_action && <div className="text-signal-amber/90">{d.next_action}</div>}
            </div>
          ))}
          {(distance.length === 0 && hardBlocks.length === 0) && (
            <div className="text-[10px] text-signal-green flex items-center gap-1">
              <TrendingUp className="w-2.5 h-2.5" /> All readiness checks pass.
            </div>
          )}
        </div>
      )}

      {/* Fundamentals row */}
      <div className="pt-1.5 border-t border-ink-line/60">
        <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-1">Fundamentals</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
          <div><span className="text-slate-gray/80">Mkt Cap</span> <span className="text-soft-white">{fmtMktCap(p?.marketCapitalization)}</span></div>
          <div><span className="text-slate-gray/80">P/E</span> <span className="text-soft-white">{fmt2(m["peInclExtraTTM"] ?? m["peBasicExclExtraTTM"])}</span></div>
          <div><span className="text-slate-gray/80">52W High</span> <span className="text-soft-white">{fmt2(m["52WeekHigh"])}</span></div>
          <div><span className="text-slate-gray/80">52W Low</span> <span className="text-soft-white">{fmt2(m["52WeekLow"])}</span></div>
          <div><span className="text-slate-gray/80">Beta</span> <span className="text-soft-white">{fmt2(m["beta"])}</span></div>
          <div><span className="text-slate-gray/80">Div Yld</span> <span className="text-soft-white">{fmtPct(m["dividendYieldIndicatedAnnual"])}</span></div>
        </div>
        {(fundQ.isLoading || flexQ.isLoading) && (
          <div className="text-[9px] text-slate-gray/60 mt-1 italic">Refreshing…</div>
        )}
      </div>

      {/* Push to Active Setup — per user contract: enabled whenever
          hard_blocks is empty. Ignores fundamentals + regime by design.
          Sends the scanner card AS-IS via the same shape FlexScannerPanel
          uses, so identical to hitting Save on the FLEX Scanner card. */}
      <div className="pt-1.5 border-t border-ink-line/60 pointer-events-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canPush) pushMut.mutate(); }}
          disabled={!canPush}
          data-testid={`core-hover-push-${ticker}`}
          className={`w-full flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            pushed
              ? "bg-signal-green/15 text-signal-green border border-signal-green/40 cursor-default"
              : hardBlocks.length > 0
                ? "bg-signal-red/10 text-signal-red/70 border border-signal-red/30 cursor-not-allowed"
                : pushMut.isPending
                  ? "bg-neon-blue/10 text-neon-blue border border-neon-blue/40 cursor-wait"
                  : "bg-neon-blue/15 text-neon-blue border border-neon-blue/50 hover:bg-neon-blue/25"
          }`}
          title={
            hardBlocks.length > 0 ? `Blocked: ${hardBlocks.join("; ")}` :
            pushed ? "Pushed to Active Setups" :
            "Send this scanner card to Active Setups as-is"
          }
        >
          {pushed ? (<><Check className="w-3 h-3" /> Pushed to Active Setup</>) :
           pushMut.isPending ? (<><Loader2 className="w-3 h-3 animate-spin" /> Pushing…</>) :
           hardBlocks.length > 0 ? (<><AlertTriangle className="w-3 h-3" /> Blocked — hard blocks</>) :
                                    (<><Rocket className="w-3 h-3" /> Push to Active Setup</>)}
        </button>
        {pushMut.isError && (
          <div className="text-[9.5px] text-signal-red mt-1 leading-tight">
            Push failed: {(pushMut.error as any)?.message || "unknown error"}
          </div>
        )}
      </div>
    </div>
  );
}
