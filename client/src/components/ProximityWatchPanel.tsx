// ─── Proximity Watch Panel v3 ─────────────────────────────────────────────
// Full-display dashboard with:
//   - Risk profile selector (LOW / MED / HIGH) + adjustable levers drawer
//   - Pinned READY cards: sticky top, remain until acted-upon (→ Active Setup)
//   - Persistent REACHING: kept all day, only resets at midnight ET or when
//     the ticker's setup grade changes
//   - Gated NO-TRADE and TOUCHING: hidden by default, revealed via checkbox
//   - A+/loose grading with structure pillars visible on every tile
//   - Next-action insight on every card ("Wait for pullback to 566.37" etc)
//   - New display background: deeper ink with subtle grid tex

import { useEffect, useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowRight, RefreshCw, Settings, X, Pin, Sliders, CheckCircle2, Circle,
  ChevronDown, ChevronUp, Zap, AlertTriangle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import ProximityUniverseEditor from "./ProximityUniverseEditor";

export type ProximityStatus = "REACHING" | "TOUCHING" | "READY" | "REJECTED";
export type SetupGrade = "A+" | "A" | "B" | "C" | "NO-TRADE";
export type RiskProfile = "low" | "medium" | "high";

export interface Pillars {
  above_20sma: boolean;
  above_50sma: boolean;
  above_200sma: boolean;
  in_band: boolean;
  rr_ok: boolean;
  volume_ok: boolean;
  momentum_bar: boolean;
}

export interface ProximityCandidate {
  ticker: string;
  status: ProximityStatus;
  setup_grade: SetupGrade;
  structure_score: number;
  distance_to_ready_pct: number | null;
  next_action: string;
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
  pillars: Pillars;
}

export interface ScanLevers {
  band_low: number;
  band_high: number;
  min_rr: number;
  extended_ceiling: number;
  deep_pullback_floor: number;
  require_above_50sma: boolean;
  require_above_200sma: boolean;
}

export interface ProximityScan {
  universe_size: number;
  candidates: ProximityCandidate[];
  computed_at: string;
  risk_profile: RiskProfile | "custom";
  levers: ScanLevers;
}

export const PROXIMITY_PREFILL_EVENT = "chizzle:prefill-plan";
export interface PrefillPayload {
  ticker: string;
  entry: number;
  stop: number;
  t1: number;
  t2: number | null;
}

const STATUS_META: Record<ProximityStatus, { bg: string; text: string; border: string; label: string }> = {
  READY:    { bg: "bg-signal-green/15", text: "text-signal-green", border: "border-signal-green", label: "READY" },
  TOUCHING: { bg: "bg-signal-amber/10", text: "text-signal-amber", border: "border-signal-amber", label: "TOUCHING" },
  REACHING: { bg: "bg-neon-blue/10",    text: "text-neon-blue",    border: "border-neon-blue",    label: "REACHING" },
  REJECTED: { bg: "bg-signal-red/10",   text: "text-signal-red",   border: "border-signal-red",   label: "NO TRADE" },
};

const GRADE_META: Record<SetupGrade, { text: string; bg: string; label: string }> = {
  "A+":       { text: "text-signal-green", bg: "bg-signal-green/20", label: "A+" },
  "A":        { text: "text-signal-green", bg: "bg-signal-green/10", label: "A" },
  "B":        { text: "text-signal-amber", bg: "bg-signal-amber/10", label: "B" },
  "C":        { text: "text-neon-blue",    bg: "bg-neon-blue/10",    label: "C" },
  "NO-TRADE": { text: "text-signal-red",   bg: "bg-signal-red/10",   label: "NO" },
};

function fmtPrice(n: number | null | undefined): string {
  return n == null ? "-" : `$${n.toFixed(2)}`;
}
function fmtPct(n: number | null | undefined, dp = 1): string {
  return n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

interface Props {
  onPrefillPlan?: (payload: PrefillPayload) => void;
  /**
   * When true, the entire panel renders `null` while no ticker is in the READY
   * bucket. Used by PipelineCockpit to keep the top-of-page real estate clean
   * until there's something actionable.
   */
  hideWhenNoReady?: boolean;
}

// LocalStorage is blocked in the sandbox iframe → use in-memory persistence
// keyed by session. Ready-acted set survives re-renders but resets on reload;
// server-side promotion to Active Setup is the durable path.
const actedReadyTickers = new Set<string>();

export default function ProximityWatchPanel({ onPrefillPlan, hideWhenNoReady = false }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [leversOpen, setLeversOpen] = useState(false);
  const [profile, setProfile] = useState<RiskProfile | "custom">("medium");
  const [showNoTrade, setShowNoTrade] = useState(false);
  const [showTouching, setShowTouching] = useState(true);
  const [customLevers, setCustomLevers] = useState<Partial<ScanLevers>>({});
  const [_, forceRerender] = useState(0);

  // Sticky Ready tracking: any ticker that hit READY today stays pinned until
  // user acts (clicks the tile → prefill → promote), even if it drops back to
  // TOUCHING. Cleared at midnight ET.
  const stickyReadyRef = useRef<Map<string, ProximityCandidate>>(new Map());
  // Persistent Reaching: kept all day; only reset at midnight ET or if the
  // ticker's setup_grade changes.
  const stickyReachingRef = useRef<Map<string, ProximityCandidate>>(new Map());

  // Midnight-ET reset watcher
  useEffect(() => {
    const check = () => {
      const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const key = nowET.toISOString().slice(0, 10);
      const lastKey = (window as any).__chizzleResetKey;
      if (lastKey !== key) {
        (window as any).__chizzleResetKey = key;
        stickyReadyRef.current.clear();
        stickyReachingRef.current.clear();
        actedReadyTickers.clear();
      }
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  const scanQ = useQuery<ProximityScan>({
    queryKey: ["/api/proximity-watch", profile, JSON.stringify(customLevers)],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("profile", profile);
      if (profile === "custom") {
        for (const [k, v] of Object.entries(customLevers)) {
          if (v != null) params.set(k, String(v));
        }
      }
      const r = await apiRequest("GET", `/api/proximity-watch?${params.toString()}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 60_000,
  });

  // Dismiss REJECTED ticker until it re-qualifies.
  const dismissMut = useMutation({
    mutationFn: async (payload: { ticker: string; reason: string }) => {
      const r = await apiRequest(
        "POST",
        `/api/proximity-universe/by-ticker/${encodeURIComponent(payload.ticker)}/dismiss`,
        { reason: payload.reason },
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/proximity-watch"] });
      queryClient.invalidateQueries({ queryKey: ["/api/proximity-universe"] });
    },
  });

  // Update sticky maps whenever a new scan lands.
  useEffect(() => {
    if (!scanQ.data) return;
    for (const c of scanQ.data.candidates) {
      if (c.status === "READY" && !actedReadyTickers.has(c.ticker)) {
        stickyReadyRef.current.set(c.ticker, c);
      }
      if (c.status === "REACHING") {
        const prev = stickyReachingRef.current.get(c.ticker);
        if (!prev || prev.setup_grade !== c.setup_grade) {
          stickyReachingRef.current.set(c.ticker, c);
        } else {
          stickyReachingRef.current.set(c.ticker, c); // refresh price
        }
      }
    }
    forceRerender((n) => n + 1);
  }, [scanQ.data]);

  function handleDismiss(c: ProximityCandidate) {
    dismissMut.mutate({ ticker: c.ticker, reason: c.reason || "user dismissed" });
  }

  function handleActReady(c: ProximityCandidate) {
    if (c.suggested_entry == null || c.suggested_stop == null || c.suggested_t1 == null) return;
    actedReadyTickers.add(c.ticker);
    stickyReadyRef.current.delete(c.ticker);
    const payload: PrefillPayload = {
      ticker: c.ticker,
      entry: c.suggested_entry,
      stop: c.suggested_stop,
      t1: c.suggested_t1,
      t2: c.suggested_t2,
    };
    onPrefillPlan?.(payload);
    window.dispatchEvent(new CustomEvent(PROXIMITY_PREFILL_EVENT, { detail: payload }));
    forceRerender((n) => n + 1);
  }

  // Bucket candidates using sticky maps for READY + REACHING, live data for
  // the others. Sticky Ready tiles are shown even if the tick has dropped to
  // TOUCHING — the operator's window to act.
  const buckets = useMemo(() => {
    const live = scanQ.data?.candidates ?? [];
    const liveByTicker = new Map(live.map((c) => [c.ticker, c]));
    const ready: ProximityCandidate[] = [];
    const touching: ProximityCandidate[] = [];
    const reaching: ProximityCandidate[] = [];
    const rejected: ProximityCandidate[] = [];

    // Sticky Ready first
    for (const c of stickyReadyRef.current.values()) {
      const fresh = liveByTicker.get(c.ticker) ?? c;
      ready.push(fresh);
    }
    // Live categorization for anything not already sticky-ready
    for (const c of live) {
      if (stickyReadyRef.current.has(c.ticker)) continue;
      if (c.status === "READY") ready.push(c);
      else if (c.status === "TOUCHING") touching.push(c);
      else if (c.status === "REACHING") reaching.push(c);
      else rejected.push(c);
    }
    // Add persistent Reaching entries not present in live scan (e.g. universe
    // trimmed) — keep for visibility until midnight reset
    for (const c of stickyReachingRef.current.values()) {
      if (!liveByTicker.has(c.ticker) && !reaching.find((r) => r.ticker === c.ticker)) {
        reaching.push(c);
      }
    }
    // Sort each by grade + score desc
    const gradeRank: Record<SetupGrade, number> = { "A+": 0, "A": 1, "B": 2, "C": 3, "NO-TRADE": 4 };
    const sortByGrade = (a: ProximityCandidate, b: ProximityCandidate) =>
      gradeRank[a.setup_grade] - gradeRank[b.setup_grade] || b.structure_score - a.structure_score;
    ready.sort(sortByGrade);
    touching.sort(sortByGrade);
    reaching.sort(sortByGrade);
    rejected.sort(sortByGrade);
    return { ready, touching, reaching, rejected };
  }, [scanQ.data, _]);

  const total = scanQ.data?.candidates.length ?? 0;
  const activeLevers = scanQ.data?.levers;

  // Top-level insight: what the operator should look at first.
  const topInsight = useMemo(() => {
    if (buckets.ready.length > 0) {
      const best = buckets.ready[0];
      return { kind: "act" as const, text: `${best.ticker} ${best.setup_grade} is READY — ${best.next_action}` };
    }
    if (buckets.reaching.length > 0) {
      const closest = [...buckets.reaching].sort((a, b) =>
        (a.distance_to_ready_pct ?? 99) - (b.distance_to_ready_pct ?? 99))[0];
      if (closest && closest.distance_to_ready_pct != null) {
        return {
          kind: "wait" as const,
          text: `Closest to READY: ${closest.ticker} (${closest.setup_grade}) — ${closest.distance_to_ready_pct.toFixed(1)}% away. ${closest.next_action}`,
        };
      }
    }
    if (buckets.touching.length > 0) {
      const best = buckets.touching[0];
      return { kind: "watch" as const, text: `${best.ticker} touching but ${best.next_action}` };
    }
    return { kind: "idle" as const, text: "No qualifying setups. Consider loosening risk profile or adding tickers." };
  }, [buckets]);

  // Hide-until-ready mode: when the operator only wants the panel to appear
  // when there's something actionable, render null until at least one ticker
  // is in the READY bucket.
  if (hideWhenNoReady && buckets.ready.length === 0) {
    return null;
  }

  return (
    <div
      className="bg-ink-black rounded-lg border border-ink-line p-3 space-y-2"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      {/* Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-bold text-soft-white tracking-wider">PROXIMITY WATCH</div>
          <div className="text-[10px] text-slate-gray mt-0.5 flex items-center gap-2">
            {scanQ.data?.computed_at && (
              <span className="font-mono">
                {new Date(scanQ.data.computed_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <span className="text-slate-gray">·</span>
            <span>{total} tracked</span>
            <span className="text-slate-gray">·</span>
            <span className={GRADE_META[profile === "custom" ? "B" : profile === "low" ? "A" : profile === "high" ? "C" : "A"].text + " font-bold"}>
              {String(profile).toUpperCase()} RISK
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {/* Risk profile pills */}
          <div className="flex rounded border border-ink-line overflow-hidden" data-testid="risk-profile-picker">
            {(["low", "medium", "high"] as const).map((p) => (
              <button
                key={p}
                onClick={() => { setProfile(p); setCustomLevers({}); }}
                className={`text-[10px] px-2 py-1 font-bold ${
                  profile === p
                    ? p === "low" ? "bg-signal-green/20 text-signal-green"
                    : p === "high" ? "bg-signal-red/20 text-signal-red"
                    : "bg-signal-amber/20 text-signal-amber"
                    : "text-slate-gray hover:text-soft-white"
                }`}
                data-testid={`risk-${p}`}
              >
                {p === "low" ? "LOW" : p === "medium" ? "MED" : "HIGH"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setLeversOpen((v) => !v)}
            className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1 ${
              leversOpen ? "border-neon-blue text-neon-blue bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-neon-blue"
            }`}
            data-testid="button-toggle-levers"
            title="Adjust individual rules"
          >
            <Sliders className="h-3 w-3" /> Levers
          </button>
          <button
            onClick={() => setEditorOpen(true)}
            className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue flex items-center gap-1"
            data-testid="button-open-universe-editor"
          >
            <Settings className="h-3 w-3" /> Universe
          </button>
          <button
            onClick={() => scanQ.refetch()}
            className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue flex items-center gap-1"
            data-testid="button-refresh-proximity"
            disabled={scanQ.isFetching}
          >
            <RefreshCw className={`h-3 w-3 ${scanQ.isFetching ? "animate-spin" : ""}`} />
            {scanQ.isFetching ? "Scanning" : "Rescan"}
          </button>
        </div>
      </div>

      {/* Insight bar ─────────────────────────────────────────────────────── */}
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs ${
          topInsight.kind === "act" ? "border-signal-green/50 bg-signal-green/5 text-signal-green"
          : topInsight.kind === "wait" ? "border-signal-amber/50 bg-signal-amber/5 text-signal-amber"
          : topInsight.kind === "watch" ? "border-neon-blue/50 bg-neon-blue/5 text-neon-blue"
          : "border-ink-line bg-ink-panel/50 text-slate-gray"
        }`}
        data-testid="insight-bar"
      >
        {topInsight.kind === "act" ? <Zap className="h-3 w-3 flex-shrink-0" />
          : topInsight.kind === "wait" ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
          : topInsight.kind === "watch" ? <ChevronDown className="h-3 w-3 flex-shrink-0" />
          : <AlertTriangle className="h-3 w-3 flex-shrink-0" />}
        <span className="font-mono text-[11px] leading-tight">{topInsight.text}</span>
      </div>

      {/* Levers drawer ──────────────────────────────────────────────────── */}
      {leversOpen && activeLevers && (
        <LeversDrawer
          current={activeLevers}
          onApply={(levers) => { setProfile("custom"); setCustomLevers(levers); }}
          onReset={() => { setCustomLevers({}); setProfile("medium"); }}
        />
      )}

      {scanQ.isLoading ? (
        <div className="p-6 text-center text-xs text-slate-gray">Scanning universe…</div>
      ) : (
        <div className="space-y-3">
          {/* ── READY (pinned top) ──────────────────────────────────── */}
          {buckets.ready.length > 0 && (
            <Section
              label="READY — Sticky (act to promote → Active Setup)"
              icon={<Pin className="h-3 w-3 text-signal-green" />}
              accentClass="text-signal-green"
              count={buckets.ready.length}
            >
              {buckets.ready.map((c) => (
                <BigReadyCard
                  key={`ready-${c.ticker}`}
                  candidate={c}
                  onAct={handleActReady}
                />
              ))}
            </Section>
          )}

          {/* ── REACHING (persistent all day) ──────────────────────── */}
          {buckets.reaching.length > 0 && (
            <Section
              label="REACHING — persistent until midnight ET or grade change"
              accentClass="text-neon-blue"
              count={buckets.reaching.length}
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {buckets.reaching.map((c) => (
                  <Tile key={`reach-${c.ticker}`} candidate={c} onDismiss={handleDismiss} />
                ))}
              </div>
            </Section>
          )}

          {/* ── TOUCHING (gated) ──────────────────────────────────── */}
          <div className="flex items-center gap-2 border-t border-ink-line pt-2">
            <label className="flex items-center gap-1 text-[10px] text-slate-gray cursor-pointer hover:text-soft-white">
              <input
                type="checkbox"
                checked={showTouching}
                onChange={(e) => setShowTouching(e.target.checked)}
                className="accent-signal-amber"
                data-testid="toggle-show-touching"
              />
              Show TOUCHING ({buckets.touching.length})
            </label>
            <label className="flex items-center gap-1 text-[10px] text-slate-gray cursor-pointer hover:text-soft-white">
              <input
                type="checkbox"
                checked={showNoTrade}
                onChange={(e) => setShowNoTrade(e.target.checked)}
                className="accent-signal-red"
                data-testid="toggle-show-notrade"
              />
              Show NO-TRADE ({buckets.rejected.length})
            </label>
          </div>

          {showTouching && buckets.touching.length > 0 && (
            <Section label="TOUCHING" accentClass="text-signal-amber" count={buckets.touching.length}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {buckets.touching.map((c) => (
                  <Tile key={`touch-${c.ticker}`} candidate={c} onDismiss={handleDismiss} />
                ))}
              </div>
            </Section>
          )}
          {showNoTrade && buckets.rejected.length > 0 && (
            <Section label="NO TRADE" accentClass="text-signal-red" count={buckets.rejected.length}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {buckets.rejected.map((c) => (
                  <Tile key={`rej-${c.ticker}`} candidate={c} onDismiss={handleDismiss} />
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      <ProximityUniverseEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}

// ─── Section header wrapper ────────────────────────────────────────────
function Section({
  label, icon, accentClass, count, children,
}: {
  label: string; icon?: React.ReactNode; accentClass: string; count: number; children: React.ReactNode;
}) {
  return (
    <div>
      <div className={`text-[10px] font-bold tracking-wider mb-1.5 flex items-center gap-1 ${accentClass}`}>
        {icon}
        {label}
        <span className="text-slate-gray font-normal ml-1">({count})</span>
      </div>
      {children}
    </div>
  );
}

// ─── Big Ready Card (pinned, hero style) ───────────────────────────────
function BigReadyCard({ candidate, onAct }: { candidate: ProximityCandidate; onAct: (c: ProximityCandidate) => void }) {
  const grade = GRADE_META[candidate.setup_grade];
  return (
    <div
      className="relative rounded-lg border-2 border-signal-green bg-gradient-to-r from-signal-green/15 to-signal-green/5 p-3 mb-2"
      data-testid={`ready-card-${candidate.ticker}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-soft-white font-mono">{candidate.ticker}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${grade.bg} ${grade.text}`}>
              {grade.label} SETUP
            </span>
            <span className="text-[10px] text-slate-gray font-mono">score {candidate.structure_score}/100</span>
          </div>
          <div className="text-[11px] text-slate-gray mt-1">{candidate.reason}</div>
          <div className="text-[11px] text-signal-green mt-1 font-mono">→ {candidate.next_action}</div>
          <PillarStrip pillars={candidate.pillars} />
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div className="text-xl font-mono text-soft-white font-bold">{fmtPrice(candidate.last)}</div>
          <div className="text-[10px] font-mono text-slate-gray">
            E {fmtPrice(candidate.suggested_entry)} · S {fmtPrice(candidate.suggested_stop)}
          </div>
          <div className="text-[10px] font-mono text-slate-gray">
            T1 {fmtPrice(candidate.suggested_t1)} · R:R {candidate.suggested_rr?.toFixed(2) ?? "-"}:1
          </div>
          <button
            onClick={() => onAct(candidate)}
            className="mt-1 px-3 py-1 rounded bg-signal-green text-ink-black text-xs font-bold hover:brightness-110 flex items-center gap-1"
            data-testid={`button-act-${candidate.ticker}`}
          >
            PROMOTE <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Compact Tile (Reaching / Touching / Rejected) ─────────────────────
function Tile({ candidate, onDismiss }: { candidate: ProximityCandidate; onDismiss: (c: ProximityCandidate) => void }) {
  const meta = STATUS_META[candidate.status];
  const grade = GRADE_META[candidate.setup_grade];
  const isRejected = candidate.status === "REJECTED";
  return (
    <div
      className={`relative rounded-md border ${meta.border} ${meta.bg} p-2 space-y-1`}
      data-testid={`proximity-tile-${candidate.ticker}`}
    >
      {isRejected && (
        <button
          type="button"
          onClick={() => onDismiss(candidate)}
          className="absolute top-1 right-1 h-5 w-5 rounded flex items-center justify-center text-signal-red/70 hover:text-signal-red hover:bg-signal-red/20 z-10"
          title="Hide until it re-qualifies"
          data-testid={`button-dismiss-${candidate.ticker}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-soft-white font-mono">{candidate.ticker}</span>
        <div className="flex items-center gap-1">
          <span className={`text-[9px] font-bold px-1 rounded ${grade.bg} ${grade.text}`}>{grade.label}</span>
          <span className={`text-[9px] font-bold ${meta.text} ${isRejected ? "pr-5" : ""}`}>{meta.label}</span>
        </div>
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono text-soft-white">{fmtPrice(candidate.last)}</span>
        <span className={`font-mono text-[10px] ${
          candidate.distance_from_sma20_pct == null ? "text-slate-gray"
          : candidate.distance_from_sma20_pct > 0 ? "text-signal-green" : "text-signal-red"
        }`}>
          {fmtPct(candidate.distance_from_sma20_pct)} vs 20SMA
        </span>
      </div>
      <div className="text-[10px] text-slate-gray leading-snug min-h-[24px]" data-testid={`proximity-reason-${candidate.ticker}`}>
        {candidate.reason}
      </div>
      <div className="text-[10px] font-mono text-neon-blue leading-snug">
        → {candidate.next_action}
      </div>
      <PillarStrip pillars={candidate.pillars} compact />
      {candidate.distance_to_ready_pct != null && candidate.distance_to_ready_pct > 0 && (
        <div className="text-[10px] font-mono text-slate-gray">
          {candidate.distance_to_ready_pct.toFixed(1)}% to READY
        </div>
      )}
    </div>
  );
}

// ─── Pillar checkmark strip ────────────────────────────────────────────
function PillarStrip({ pillars, compact }: { pillars: Pillars; compact?: boolean }) {
  const items: Array<[keyof Pillars, string]> = [
    ["above_20sma", ">20"],
    ["above_50sma", ">50"],
    ["above_200sma", ">200"],
    ["in_band", "band"],
    ["rr_ok", "RR"],
    ["volume_ok", "vol"],
    ["momentum_bar", "mo"],
  ];
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "mt-1" : "mt-2"}`}>
      {items.map(([k, label]) => (
        <span
          key={k}
          className={`text-[9px] font-mono px-1 py-0.5 rounded flex items-center gap-0.5 ${
            pillars[k] ? "text-signal-green bg-signal-green/10" : "text-slate-gray bg-ink-line/50"
          }`}
        >
          {pillars[k] ? <CheckCircle2 className="h-2 w-2" /> : <Circle className="h-2 w-2" />}
          {label}
        </span>
      ))}
    </div>
  );
}

// ─── Levers drawer ─────────────────────────────────────────────────────
function LeversDrawer({
  current, onApply, onReset,
}: {
  current: ScanLevers;
  onApply: (levers: Partial<ScanLevers>) => void;
  onReset: () => void;
}) {
  const [local, setLocal] = useState<ScanLevers>(current);
  useEffect(() => setLocal(current), [current]);

  const set = <K extends keyof ScanLevers>(k: K, v: ScanLevers[K]) => setLocal((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded border border-neon-blue/40 bg-ink-panel p-3 space-y-2" data-testid="levers-drawer">
      <div className="text-[10px] font-bold text-neon-blue tracking-wider">CUSTOM LEVERS</div>
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <NumberLever label="Band low (%)"     value={local.band_low}     step={0.5} onChange={(v) => set("band_low", v)} />
        <NumberLever label="Band high (%)"    value={local.band_high}    step={0.5} onChange={(v) => set("band_high", v)} />
        <NumberLever label="Min R:R"          value={local.min_rr}       step={0.25} onChange={(v) => set("min_rr", v)} />
        <NumberLever label="Extended > (%)"   value={local.extended_ceiling} step={1} onChange={(v) => set("extended_ceiling", v)} />
        <NumberLever label="Deep pullback (%)" value={local.deep_pullback_floor} step={1} onChange={(v) => set("deep_pullback_floor", v)} />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-slate-gray cursor-pointer">
            <input type="checkbox" checked={local.require_above_50sma}
              onChange={(e) => set("require_above_50sma", e.target.checked)}
              className="accent-signal-green" />
            &gt; 50-SMA
          </label>
          <label className="flex items-center gap-1 text-slate-gray cursor-pointer">
            <input type="checkbox" checked={local.require_above_200sma}
              onChange={(e) => set("require_above_200sma", e.target.checked)}
              className="accent-signal-green" />
            &gt; 200-SMA
          </label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onReset}
          className="text-[10px] px-2 py-1 rounded border border-ink-line text-slate-gray hover:text-soft-white"
          data-testid="button-reset-levers"
        >
          Reset to MED
        </button>
        <button
          onClick={() => onApply(local)}
          className="text-[10px] px-2 py-1 rounded bg-neon-blue text-ink-black font-bold hover:brightness-110"
          data-testid="button-apply-levers"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function NumberLever({ label, value, step, onChange }: {
  label: string; value: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-slate-gray">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-20 bg-ink-black border border-ink-line rounded px-1 py-0.5 font-mono text-soft-white text-right"
      />
    </label>
  );
}
