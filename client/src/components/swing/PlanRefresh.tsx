// Plan refresh — "Refresh Plan Now", opt-in Auto Refresh, freshness, and the default target method.
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

export async function saveSwingSettings(p: Partial<SwingSettings>) {
  await swingSend("PUT", "/api/swing/settings", p);
  await invalidateSwing();
}
export const saveTargetDefault = (t: TargetDefault) => saveSwingSettings({ targetDefault: t });

const INTERVALS: { v: 0 | 15 | 30 | 60; label: string }[] = [
  { v: 0, label: "Off" }, { v: 15, label: "15 min" }, { v: 30, label: "30 min (suggested)" }, { v: 60, label: "60 min" },
];

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
  const xs = { fontSize: "var(--ac-fs-xs)" } as const;
  return (
    <div className="ac-tile rounded-xl px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={xs} data-testid="bar-plan-refresh">
      <button className="ac-btn ac-btn-primary !py-1" style={xs} onClick={run} disabled={running} aria-busy={running} data-testid="button-refresh-plan">
        <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} aria-hidden /> {running ? "Analyzing…" : "Refresh Plan"}
      </button>
      <label className="inline-flex items-center gap-1.5">
        <span className="font-semibold">Auto Refresh</span>
        <select className="ac-input !w-auto !py-0.5" style={xs} value={String(settings?.planAutoRefreshMin ?? 0)} aria-label="Auto refresh interval"
          onChange={(e) => void saveSwingSettings({ planAutoRefreshMin: Number(e.target.value) as 0 | 15 | 30 | 60 })} data-testid="select-auto-refresh">
          {INTERVALS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
      </label>
      <span className="inline-flex items-center gap-1" data-testid="text-last-analysis">
        {s?.lastError ? <AlertTriangle className="h-3.5 w-3.5 ac-warn" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 ac-good" aria-hidden />}
        <span className="ac-muted">{s?.lastError ? "Last confirmed snapshot:" : "Last successful analysis:"}</span> <b className="ac-num">{s?.lastOkAt ? fmtCT(s.lastOkAt) : "first run pending"}</b>
      </span>
      <span className="inline-flex items-center gap-1 ac-muted" data-testid="text-next-refresh">
        <Clock className="h-3.5 w-3.5" aria-hidden /> Next: <b className="ac-num">{s?.nextAt ? fmtCT(s.nextAt) : "manual only"}</b>
        {s?.nextAt && <span>({s.nextKind === "HOURLY_CLOSE" ? "after the 1H close" : `every ${s.intervalMin} min`}{s.marketOpen ? "" : ", market closed"})</span>}
      </span>
      {(s?.lastError || msg) && (
        <span className={`basis-full ${s?.lastError ? "ac-warn font-semibold" : "ac-muted"}`} role={s?.lastError ? "alert" : "status"} data-testid="text-refresh-message">
          {s?.lastError ? `${s.lastError.replace(/ — showing the last successful snapshot\.?$/, "")} — showing the last confirmed snapshot${s.lastOkAt ? ` from ${fmtCT(s.lastOkAt)}` : ""}${s.lastAttemptAt ? ` (attempt ${fmtCT(s.lastAttemptAt)})` : ""}.` : msg}
        </span>
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
