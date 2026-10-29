// Plan refresh — "Refresh Plan Now", the one hourly sync line (Part 2), freshness, and the default target method.
// All recalculation happens on the server from one analysis snapshot; this file only triggers and reports it.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { fmtCT, swingGet, swingSend } from "@/lib/swing";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import { DEFAULT_TARGET_DEFAULT, PLAN_FIELD_LABEL, R_PRESETS, targetDefaultError, targetDefaultLabel, type TargetDefault } from "@shared/practicePlan";

export interface RefreshStatus {
  running: boolean; trigger: string | null; lastTrigger: string | null;
  lastOkAt: string | null; lastAttemptAt: string | null; lastError: string | null; failedSymbols: string[];
  intervalMin: 0 | 15 | 30 | 60; hourly: boolean; nextAt: string | null; nextKind: string | null; marketOpen: boolean; runs: number;
  lastSyncAt: string | null; symbols: SymbolSync[]; schedule: string;
}
export interface SymbolSync { symbol: string; source: string | null; quoteAt: string | null; dataStatus: string; analysisAt: string | null; lastBar1H: string | null }
export const NEXT_KIND_LABEL: Record<string, string> = { HOURLY_CLOSE: "after the 1H close", AFTER_CLOSE: "after the 3:00 PM close", PRE_MARKET: "pre-market pass", MANUAL: "manual", INTERVAL: "interval" };
const SRC_LABEL: Record<string, string> = { twelvedata: "Twelve Data", yahoo: "Yahoo", finnhub: "Finnhub", tiingo: "Tiingo", nasdaq: "Nasdaq", tradingview: "TradingView" };
export const sourceLabel = (s: string | null | undefined) => (s ? SRC_LABEL[s.toLowerCase()] ?? s : "—");

/** Part 2 — ONE "Last sync / Next sync" line, driven by the server scheduler (no client-side clock math).
 *  Used by the header SyncClock and the Action Center bar so every panel reports the same times. */
export function SyncLine({ compact, showSymbols, testId = "text-sync-line" }: { compact?: boolean; showSymbols?: boolean; testId?: string }) {
  const { data: s } = usePlanRefresh();
  const [open, setOpen] = useState(false);
  const last = s?.lastSyncAt ?? s?.lastOkAt ?? null;
  return (
    <div className="inline-flex flex-wrap items-center gap-2" data-testid={testId}>
      {/* Telemetry Badge: Last Sync */}
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-mono text-slate-400 backdrop-blur-md shadow-inner" data-testid="text-sync-last">
        <span className="flex h-2 w-2 relative">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s?.running ? "bg-cyan-400" : "bg-emerald-400"} opacity-75`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${s?.running ? "bg-cyan-500" : "bg-emerald-500"}`}></span>
        </span>
        <span className="font-mono uppercase tracking-widest text-[10px] text-slate-400 font-semibold">Last sync</span>
        <b className="font-mono font-bold text-soft-white tabular-nums">{last ? fmtCT(last) : "pending"}</b>
        {s?.running && <span className="font-mono text-[10px] text-cyan-400 animate-pulse">(syncing…)</span>}
      </div>

      {/* Telemetry Badge: Next Sync */}
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-mono text-slate-400 backdrop-blur-md shadow-inner" data-testid="text-sync-next">
        <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" aria-hidden />
        <span className="font-mono uppercase tracking-widest text-[10px] text-slate-400 font-semibold">Next sync</span>
        <b className="font-mono font-bold text-cyan-300 tabular-nums">{s?.nextAt ? fmtCT(s.nextAt) : s ? "manual only" : "…"}</b>
        {s?.nextAt && !compact && (
          <span className="hidden sm:inline text-[10px] text-slate-500 font-mono">
            ({NEXT_KIND_LABEL[s.nextKind ?? ""] ?? s.nextKind}{s.marketOpen ? "" : ", market closed"})
          </span>
        )}
      </div>

      {/* Symbol Telemetry Toggle */}
      {showSymbols && s?.symbols?.length ? (
        <button
          className="flex items-center gap-1 rounded-full border border-white/10 bg-black/30 hover:bg-white/5 hover:border-cyan-500/40 px-2.5 py-1 text-[10.5px] font-mono font-semibold text-cyan-300 transition-colors"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="button-sync-symbols"
        >
          {open ? "Hide symbols" : "Data by symbol"}
        </button>
      ) : null}

      {showSymbols && open && s?.symbols && (
        <div className="basis-full flex flex-wrap gap-2 pt-2 mt-1 border-t border-white/10 text-xs font-mono text-slate-400" data-testid="list-sync-symbols">
          {s.symbols.map((x) => (
            <span
              key={x.symbol}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[11px] shadow-sm"
              data-testid={`text-sync-symbol-${x.symbol}`}
              data-status={x.dataStatus}
            >
              <b className="font-bold text-soft-white">{x.symbol}</b>
              <span className="text-slate-400">{sourceLabel(x.source)}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400 font-mono text-[10px]">{x.quoteAt ? fmtCT(x.quoteAt) : "—"}</span>
              <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold uppercase ${x.dataStatus === "LIVE" ? "text-emerald-400 bg-emerald-950/60 border border-emerald-500/30" : x.dataStatus === "PENDING" ? "text-cyan-300" : "text-amber-400 bg-amber-950/60 border border-amber-500/30"}`}>
                {x.dataStatus}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Re-read every swing panel together so the card, chart, scanner and workspace show the same snapshot. */
export const invalidateSwing = () =>
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("/api/swing") || q.queryKey[0] === "/api/flex-scan-cached" });

export function usePlanRefresh() {
  const q = useQuery<RefreshStatus>({
    queryKey: ["/api/swing/plan-refresh"], queryFn: () => swingGet("/api/swing/plan-refresh"),
    refetchInterval: (s) => ((s.state.data as RefreshStatus | undefined)?.running ? 5_000 : 60_000),
  });
  // A scheduled run finished on the server → pull the new snapshot into every panel once.
  const runs = useRef<number | null>(null);
  useEffect(() => {
    const n = q.data?.runs; if (n == null) return;
    if (runs.current != null && n !== runs.current && !q.data?.running) void invalidateSwing();
    runs.current = n;
  }, [q.data?.runs, q.data?.running]);
  return q;
}

let pending: Promise<RefreshStatus> | null = null;
/** Manual full recalculation. Repeat clicks join the request already in flight. */
export function refreshPlanNow(): Promise<RefreshStatus> {
  if (pending) return pending;
  pending = swingSend<RefreshStatus>("POST", "/api/swing/plan-refresh")
    .then(async (s) => { queryClient.setQueryData(["/api/swing/plan-refresh"], s); await invalidateSwing(); return s; })
    .finally(() => { pending = null; });
  return pending;
}

export async function saveSwingSettings(p: Partial<SwingSettings>, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Save request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    await swingSend("PUT", "/api/swing/settings", p);
    await invalidateSwing();
  } catch (err: any) {
    if (controller.signal.aborted || err?.name === "AbortError") {
      throw new Error(`Save trade config timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
export const saveTargetDefault = (t: TargetDefault) => saveSwingSettings({ targetDefault: t });


/** One compact row in the Action Center: refresh button, analysis time, next run, Auto Refresh, default targets. */
export function PlanRefreshBar({ settings }: { settings: SwingSettings | undefined }) {
  const st = usePlanRefresh();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = st.data;
  const running = busy || !!s?.running;
  const run = async () => {
    setBusy(true); setMsg(null);
    try { const r = await refreshPlanNow(); setMsg(r.lastError ? null : "Plan refreshed from the latest closed candles."); }
    catch (e: any) { setMsg(`Refresh failed: ${e?.message ?? "error"}. Showing the last confirmed snapshot.`); }
    finally { setBusy(false); }
  };
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 backdrop-blur-md bg-ink-black/40 p-3 sm:p-4 shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all"
      data-testid="bar-plan-refresh"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* The Glowing Primary Action Button */}
        <button
          onClick={run}
          disabled={running}
          aria-busy={running}
          data-testid="button-refresh-plan"
          className={`relative inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all duration-300 select-none ${
            running
              ? "bg-cyan-950/80 text-cyan-300 border border-cyan-500/50 shadow-[0_0_15px_rgba(34,211,238,0.3)] animate-pulse"
              : "bg-gradient-to-r from-cyan-500 to-blue-600 text-white border border-cyan-400/60 shadow-[0_0_12px_rgba(34,211,238,0.3)] hover:shadow-[0_0_10px_rgba(34,211,238,0.4)] hover:border-cyan-300 hover:scale-[1.02] active:scale-[0.98]"
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin text-cyan-200" : "text-white"}`} aria-hidden />
          <span>{running ? "Analyzing…" : "Refresh Plan"}</span>
        </button>

        {/* Sync Telemetry Badges (Last sync & Next sync) */}
        <SyncLine showSymbols />

        {/* Telemetry Badge: Hourly sync */}
        <div
          className="flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs font-mono text-slate-400 backdrop-blur-md shadow-inner"
          data-testid="text-last-analysis"
          title={s?.schedule ?? ""}
        >
          {s?.lastError ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden />
          )}
          <span className="font-mono uppercase tracking-widest text-[10px] text-slate-400 font-semibold">
            {s?.lastError ? "Snapshot:" : "Hourly sync on"}
          </span>
          <span className={`font-mono font-bold tabular-nums ${s?.lastError ? "text-amber-300" : "text-emerald-400"}`}>
            {s?.lastError ? (s?.lastOkAt ? fmtCT(s.lastOkAt) : "first run pending") : "ACTIVE"}
          </span>
        </div>
      </div>

      {/* Status / Alert notification banner */}
      {(s?.lastError || msg) && (
        <div
          className={`basis-full mt-1 flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs ${
            s?.lastError
              ? "border-amber-500/40 bg-amber-950/40 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
              : "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.1)]"
          }`}
          role={s?.lastError ? "alert" : "status"}
          data-testid="text-refresh-message"
        >
          {s?.lastError ? (
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" aria-hidden />
          )}
          <span>
            {s?.lastError
              ? `${s.lastError.replace(/ — showing the last successful snapshot\.?$/, "")} — showing the last confirmed snapshot${s.lastOkAt ? ` from ${fmtCT(s.lastOkAt)}` : ""}${s.lastAttemptAt ? ` (attempt ${fmtCT(s.lastAttemptAt)})` : ""}.`
              : msg}
          </span>
        </div>
      )}
    </div>
  );
}

/** Default target method for unedited plans (lives in the Action Center "More" menu). */
export function TargetDefaultControl({ settings }: { settings: SwingSettings | undefined }) {
  const td = settings?.targetDefault ?? DEFAULT_TARGET_DEFAULT;
  const tdKey = td.method === "FIXED_R" ? `R:${td.t1R}:${td.t2R}` : td.method;
  const isStd = td.method === "FIXED_R" && td.t1R === 2 && td.t2R === 3;
  const [custom, setCustom] = useState<{ a: string; b: string } | null>(null);
  const setDefault = (v: string) => {
    if (v === "custom") { setCustom({ a: String(td.t1R), b: String(td.t2R) }); return; }
    setCustom(null);
    if (v === "ENGINE" || v === "STRUCTURE") void saveTargetDefault({ ...td, method: v });
    else { const [, a, b] = v.split(":"); void saveTargetDefault({ method: "FIXED_R", t1R: Number(a), t2R: Number(b) }); }
  };
  const customErr = custom ? targetDefaultError({ method: "FIXED_R", t1R: Number(custom.a), t2R: Number(custom.b) }) : null;
  const xs = { fontSize: "var(--ac-fs-xs)" } as const;
  return (
    <div className="flex flex-col gap-1.5" style={xs} data-testid="control-target-default">
      <label className="inline-flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold">Default targets</span>
        <select className="ac-input !w-auto !py-0.5" style={xs} value={custom ? "custom" : R_PRESETS.some(([a, b]) => tdKey === `R:${a}:${b}`) || td.method !== "FIXED_R" ? tdKey : "custom"}
          aria-label="Default target method for new plans" onChange={(e) => setDefault(e.target.value)} data-testid="select-target-default">
          {R_PRESETS.map(([a, b]) => <option key={`${a}-${b}`} value={`R:${a}:${b}`}>Fixed R {a}R / {b}R{a === 2 && b === 3 ? " (default)" : ""}</option>)}
          <option value="custom">Custom R…{td.method === "FIXED_R" && !R_PRESETS.some(([a, b]) => tdKey === `R:${a}:${b}`) ? ` (${td.t1R}R / ${td.t2R}R)` : ""}</option>
          <option value="STRUCTURE">Structure-Based</option>
          <option value="ENGINE">Engine Original</option>
        </select>
        {!isStd && !custom && <button className="ac-btn !py-1" style={xs} onClick={() => void saveTargetDefault(DEFAULT_TARGET_DEFAULT)} data-testid="button-use-2r3r-default">Use 2R/3R as my default</button>}
      </label>
      {custom && (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          T1 <input className="ac-input !w-16 !py-0.5" type="number" min="0.1" step="0.1" value={custom.a} aria-label="Target 1 multiple" onChange={(e) => setCustom({ ...custom, a: e.target.value })} data-testid="input-default-t1r" />R
          T2 <input className="ac-input !w-16 !py-0.5" type="number" min="0.1" step="0.1" value={custom.b} aria-label="Target 2 multiple" onChange={(e) => setCustom({ ...custom, b: e.target.value })} data-testid="input-default-t2r" />R
          <button className="ac-btn !py-1" style={xs} disabled={!!customErr} onClick={() => { void saveTargetDefault({ method: "FIXED_R", t1R: Number(custom.a), t2R: Number(custom.b) }); setCustom(null); }} data-testid="button-save-default-custom">Save</button>
          <button className="ac-btn !py-1" style={xs} onClick={() => setCustom(null)}>Cancel</button>
          {customErr && <span className="ac-bad font-semibold" role="alert">{customErr}</span>}
        </span>
      )}
      <span className="ac-muted" data-testid="text-refresh-rules">
        Levels are recalculated from closed candles only; a newer quote alone never confirms a setup or moves a level. Targets use {targetDefaultLabel(td)} for unedited plans; your adjusted plans are never overwritten.
      </span>
    </div>
  );
}

/** Per-card freshness: plan-analysis time vs quote time, and what (if anything) changed. Never hidden in Compact View. */
export function PlanFreshness({ d, adjusted }: { d: SwingDecision; adjusted: boolean }) {
  const r = d.planRefresh;
  if (!r) return null;
  const xs = { fontSize: "var(--ac-fs-xs)" } as const;
  const times = <span className="ac-muted ac-num">Plan analyzed {r.analysisAt ? fmtCT(r.analysisAt) : "—"} · Quote {fmtCT(d.quoteTimestamp)}</span>;
  if (!r.ok) return (
    <div className="ac-warn font-semibold flex flex-wrap items-center gap-x-2" role="alert" style={xs} data-testid={`text-plan-fresh-${d.symbol}`} data-kind="FAILED">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Last confirmed snapshot{r.analysisAt ? ` · ${fmtCT(r.analysisAt)}` : ""} — analysis failed at {fmtCT(r.attemptAt)} ({r.failed.join(", ") || "data"}). Levels shown are not newer than that snapshot. {times}
    </div>
  );
  const changes = r.changes.length && r.changedAt
    ? r.changes.map((c) => `${PLAN_FIELD_LABEL[c.field]} ${c.from != null ? `$${c.from.toFixed(2)}` : "—"} → ${c.to != null ? `$${c.to.toFixed(2)}` : "—"}`).join(" · ") : null;
  const text = r.kind === "UNCHANGED" ? "Analysis refreshed; levels unchanged."
    : r.kind === "UPDATED" ? "Engine levels updated from the latest closed candles."
    : r.kind === "NEW_SETUP" ? "New setup found — fresh levels from this setup only."
    : r.kind === "INVALIDATED" ? "Setup invalidated — the previous levels are not reused as a new plan."
    : r.kind === "EXPIRED" ? "Setup expired — levels are history only."
    : r.kind === "NO_PLAN" ? "No plan levels for the current setup." : "Analysis complete.";
  const on = r.changedOn && r.changedAt
    ? `${r.changedOn.tf === "RECHECK" ? "on a same-bar recheck" : `at the ${r.changedOn.tf} close`} ${r.changedOn.barEnd ? fmtCT(r.changedOn.barEnd) : fmtCT(r.changedAt)}` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5" style={xs} data-testid={`text-plan-fresh-${d.symbol}`} data-kind={r.kind}>
      <span className={r.kind === "INVALIDATED" || r.kind === "EXPIRED" ? "ac-warn font-semibold" : "font-semibold"}>{text}</span>
      {times}
      {on && (r.kind === "UPDATED" || r.kind === "NEW_SETUP" || r.kind === "UNCHANGED") && (
        <span className="ac-accent ac-num" data-testid={`text-plan-changed-on-${d.symbol}`} data-tf={r.changedOn!.tf}>
          {r.kind === "NEW_SETUP" ? "Levels set" : "Levels last changed"} {on}
        </span>
      )}
      {changes && (r.kind === "UPDATED" || r.kind === "UNCHANGED") && (
        <span className="ac-accent ac-num" data-testid={`text-plan-changes-${d.symbol}`}>
          {r.kind === "UNCHANGED" && !on ? `Last change ${fmtCT(r.changedAt)}: ` : on ? "— " : ""}{changes}{adjusted ? " (engine plan — your adjusted plan is unchanged)" : ""}
        </span>
      )}
    </div>
  );
}
