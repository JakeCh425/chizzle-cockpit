// Section R1–R3 — "Recalculate Practice Plan — SYMBOL". The system plan is shown read-only;
// edits are recalculated live (shared pure math) and saved as a NEW version on the server,
// which recomputes them itself. PRACTICE ONLY — no broker order is ever created.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { swingGet, swingSend, fmtCT, DATA_TONE } from "@/lib/swing";
import { invalidatePlans, selectPlanVersion } from "@/lib/plans";
import {
  ENTRY_METHODS, ENTRY_METHOD_LABEL, STOP_METHODS, STOP_METHOD_LABEL, TARGET_METHODS, TARGET_METHOD_LABEL,
  ORIGINAL_STATUS_LABEL, PLAN_STATE_LABEL, PLAN_WARNINGS, defaultInputs, originalPlanStatus, recalcPlan,
  type PlanContext, type PlanInputs, type PlanResult, type PlanVersion,
} from "@shared/practicePlan";

interface CtxResp { setupId: string; context: PlanContext; swingLows1h: { price: number; time: string }[]; swingLows4h: { price: number; time: string }[]; maxDollarRisk: number; minRrT1: number }
interface VersionsResp { symbol: string; versions: PlanVersion[]; selected: number }

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);
const rr = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)}R`);
const STATE_TONE: Record<string, string> = {
  VALID: "bg-emerald-600 text-white", LATE_ENTRY: "bg-sky-600 text-white",
  PULLBACK_NOT_FILLED: "bg-amber-400 text-[#1a1200]", BREAKOUT_NOT_TRIGGERED: "bg-amber-400 text-[#1a1200]",
  RR_TOO_LOW: "bg-rose-600 text-white", STOP_TOO_WIDE: "bg-rose-600 text-white",
  EXTENDED: "bg-orange-500 text-[#1a0a00]", INVALID: "bg-rose-700 text-white",
};

const fieldCls = "w-full rounded border border-ink-line bg-ink-black px-2 py-1 text-[12px] font-mono text-soft-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue";
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-[10px] uppercase tracking-wide font-mono text-slate-gray">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-gray">{hint}</span>}
    </label>
  );
}
const numOr = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** Mount once: opens for whichever symbol fires `chizzle:edit-plan`. */
export function PlanEditorHost() {
  const [sym, setSym] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setSym(String((e as CustomEvent).detail ?? "").toUpperCase() || null);
    window.addEventListener("chizzle:edit-plan", on);
    return () => window.removeEventListener("chizzle:edit-plan", on);
  }, []);
  return (
    <Dialog open={!!sym} onOpenChange={(o) => { if (!o) setSym(null); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto bg-ink-panel border-ink-line text-soft-white" data-testid="dialog-plan-editor">
        {sym && <PlanEditor symbol={sym} onClose={() => setSym(null)} />}
      </DialogContent>
    </Dialog>
  );
}

function PlanEditor({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const ctxQ = useQuery<CtxResp>({ queryKey: ["/api/swing/plan-context", symbol], queryFn: () => swingGet(`/api/swing/plan-context/${encodeURIComponent(symbol)}`), staleTime: 30_000 });
  const verQ = useQuery<VersionsResp>({ queryKey: ["/api/swing/plans", symbol], queryFn: () => swingGet(`/api/swing/plans/${encodeURIComponent(symbol)}`) });
  const [view, setView] = useState<number | "NEW">("NEW");

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-[15px]" data-testid="text-plan-editor-title">Recalculate Practice Plan — {symbol}</DialogTitle>
        <DialogDescription className="text-[11px] font-mono text-signal-amber">
          PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE. Recalculated levels are practice-plan estimates. The original system plan is never changed.
        </DialogDescription>
      </DialogHeader>
      {ctxQ.isLoading && <div className="text-xs text-slate-gray" data-testid="text-plan-loading">Loading {symbol} plan context…</div>}
      {ctxQ.error && <div className="text-xs text-rose-300" role="alert">{(ctxQ.error as Error).message.replace(/^\d{3}: /, "")}</div>}
      {ctxQ.data && (
        <div className="space-y-3">
          <OriginalBlock c={ctxQ.data.context} />
          <VersionTabs versions={verQ.data?.versions ?? []} selected={verQ.data?.selected ?? 0} view={view} setView={setView} symbol={symbol} currentSetup={ctxQ.data.setupId} />
          {view === "NEW"
            ? <EditorForm data={ctxQ.data} nextVersion={(verQ.data?.versions[0]?.version ?? 0) + 1} onSaved={(v) => setView(v)} />
            : (() => { const v = verQ.data?.versions.find((x) => x.version === view); return v ? <SavedVersion v={v} current={ctxQ.data!.setupId === v.setupId} onClose={onClose} /> : null; })()}
        </div>
      )}
    </>
  );
}

function OriginalBlock({ c }: { c: PlanContext }) {
  const st = originalPlanStatus(c), o = c.original;
  const cells: [string, string][] = [
    ["Setup", c.setupType ? c.setupType.replace(/_/g, " ") : "None"], ["Setup time", fmtCT(c.setupTimestamp)],
    ["Entry", $(o.entry)], ["Structural stop", $(o.stop)], ["Stop-limit", $(o.stopLimit)],
    ["Target 1", $(o.t1)], ["Target 2", $(o.t2)], ["Risk / share", $(o.riskPerShare)], ["R:R (T1 / T2)", `${rr(o.rrT1)} / ${rr(o.rrT2)}`],
  ];
  return (
    <section className="rounded border border-ink-line bg-ink-black p-2.5" aria-label="Original system plan" data-testid="section-original-plan">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[11px] font-mono font-bold">ORIGINAL PLAN — SYSTEM GENERATED (read-only)</span>
        <span className="px-1.5 rounded border border-ink-line text-[10px] font-mono" data-testid="text-original-status">Status: {ORIGINAL_STATUS_LABEL[st]}</span>
        <span className={`px-1.5 rounded border text-[10px] font-mono ${DATA_TONE[c.dataStatus] ?? "border-ink-line"}`} data-testid="text-plan-data-status">
          Data {c.dataStatus} · {c.dataSource ?? "—"} · {fmtCT(c.quoteTimestamp)}
        </span>
        <span className="ml-auto text-[12px] font-mono" data-testid="text-plan-current-price">Current {$(c.currentPrice)}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5">
        {cells.map(([k, v]) => (
          <div key={k} className="rounded border border-ink-line px-1.5 py-1"><div className="text-[9px] uppercase font-mono text-slate-gray">{k}</div><div className="text-[12px] font-mono">{v}</div></div>
        ))}
      </div>
    </section>
  );
}

function VersionTabs({ versions, selected, view, setView, symbol, currentSetup }: { versions: PlanVersion[]; selected: number; view: number | "NEW"; setView: (v: number | "NEW") => void; symbol: string; currentSetup: string }) {
  const btn = (on: boolean) => `px-2 py-0.5 rounded border text-[10.5px] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue ${on ? "border-neon-blue text-neon-blue bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-soft-white"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Plan versions" data-testid="tabs-plan-versions">
      <span className="text-[10px] font-mono text-slate-gray mr-1">Versions:</span>
      <span className={`${btn(false)} cursor-default`} data-testid="tab-version-0">Original Plan{selected === 0 ? " · in use" : ""}</span>
      {[...versions].reverse().map((v) => (
        <button key={v.id} role="tab" aria-selected={view === v.version} className={btn(view === v.version)} onClick={() => setView(v.version)} data-testid={`tab-version-${v.version}`}>
          Recalculated Plan v{v.version}{v.selected ? " · in use" : ""}{v.setupId !== currentSetup ? " · older setup" : ""}
        </button>
      ))}
      <button role="tab" aria-selected={view === "NEW"} className={btn(view === "NEW")} onClick={() => setView("NEW")} data-testid="tab-version-new">+ New version</button>
      {selected > 0 && (
        <button className="ml-auto px-2 py-0.5 rounded border border-ink-line text-[10.5px] font-mono text-slate-gray hover:text-soft-white" onClick={() => void selectPlanVersion(symbol, 0)} data-testid="button-use-system-plan">
          Use original system plan everywhere
        </button>
      )}
    </div>
  );
}

function EditorForm({ data, nextVersion, onSaved }: { data: CtxResp; nextVersion: number; onSaved: (v: number) => void }) {
  const c = data.context;
  const [inp, setInp] = useState<PlanInputs>(() => defaultInputs(c, data.maxDollarRisk, data.minRrT1));
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof PlanInputs>(k: K, v: PlanInputs[K]) => { setInp((p) => ({ ...p, [k]: v })); setAck(false); };
  const numField = (k: keyof PlanInputs, step = "0.01") => ({
    type: "number", step, inputMode: "decimal" as const, className: fieldCls,
    value: raw[k] ?? (inp[k] == null ? "" : String(inp[k])),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { const s = e.target.value; setRaw((r) => ({ ...r, [k]: s })); set(k, numOr(s) as any); },
  });
  const lows = inp.stopMethod === "SWING_1H" ? data.swingLows1h : inp.stopMethod === "SWING_4H" ? data.swingLows4h : [];
  // Picking a swing-low method preselects the most recent low below price.
  useEffect(() => { if ((inp.stopMethod === "SWING_1H" || inp.stopMethod === "SWING_4H") && inp.stopLevel == null && lows[0]) set("stopLevel", lows[0].price); }, [inp.stopMethod]);
  useEffect(() => { if (inp.entryMethod === "CURRENT" && c.currentPrice != null) { setRaw((r) => ({ ...r, entry: String(c.currentPrice) })); set("entry", c.currentPrice); } }, [inp.entryMethod]);

  const ready = Number.isFinite(inp.entry) && inp.entry > 0 && (inp.stopMethod === "ORIGINAL" || inp.stopLevel != null);
  const res = useMemo(() => (ready ? recalcPlan(c, inp) : null), [c, inp, ready]);
  const entryEdited = c.original.entry != null && Math.abs(inp.entry - c.original.entry) >= 0.005;
  const needsAck = !!res?.originalMathInvalid;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const out = await swingSend<{ version: PlanVersion }>("POST", `/api/swing/plans/${encodeURIComponent(c.symbol)}`, {
        inputs: inp, reason, chartState: { tf: "4H", currentPrice: c.currentPrice, dataStatus: c.dataStatus, quoteTimestamp: c.quoteTimestamp },
      });
      invalidatePlans(c.symbol); onSaved(out.version.version);
    } catch (e: any) { setErr(e?.message ?? "Save failed"); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <section className="space-y-2" aria-label="Plan inputs" data-testid="section-plan-inputs">
        <Field label="Entry method">
          <select className={fieldCls} value={inp.entryMethod} onChange={(e) => set("entryMethod", e.target.value as any)} data-testid="select-entry-method">
            {ENTRY_METHODS.map((m) => <option key={m} value={m}>{ENTRY_METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        <Field label="Proposed entry price" hint={c.originalTrigger != null ? `Original trigger ${$(c.originalTrigger)} · current ${$(c.currentPrice)}` : undefined}>
          <input {...numField("entry")} data-testid="input-entry" />
        </Field>
        {entryEdited && inp.stopMethod === "ORIGINAL" && (
          <div className="rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1 text-[10.5px] text-yellow-200" role="alert" data-testid="warn-entry-changed">
            You changed the entry but kept the original stop. Risk, targets and share size are recalculated from the new entry — the old numbers no longer apply.
          </div>
        )}
        <Field label="Stop method">
          <select className={fieldCls} value={inp.stopMethod} onChange={(e) => { set("stopMethod", e.target.value as any); set("stopLevel", null); }} data-testid="select-stop-method">
            {STOP_METHODS.map((m) => <option key={m} value={m}>{STOP_METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        {(inp.stopMethod === "SWING_1H" || inp.stopMethod === "SWING_4H") && (
          <Field label={`Recent ${inp.stopMethod === "SWING_1H" ? "1H" : "4H"} swing low`} hint={lows.length ? undefined : "No swing lows below price found — use a manual level."}>
            <select className={fieldCls} value={inp.stopLevel ?? ""} onChange={(e) => set("stopLevel", numOr(e.target.value))} data-testid="select-swing-low">
              <option value="">Pick a swing low…</option>
              {lows.map((l) => <option key={l.time} value={l.price}>{$(l.price)} · {fmtCT(l.time)}</option>)}
            </select>
          </Field>
        )}
        {inp.stopMethod === "MANUAL" && <Field label="Chart level for the stop"><input {...numField("stopLevel")} data-testid="input-stop-level" /></Field>}
        {inp.stopMethod !== "ORIGINAL" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stop buffer">
              <select className={fieldCls} value={inp.bufferMethod} onChange={(e) => set("bufferMethod", e.target.value as any)} data-testid="select-buffer-method">
                <option value="AUTO">Auto volatility buffer</option><option value="MANUAL">Manual $ buffer</option>
              </select>
            </Field>
            {inp.bufferMethod === "MANUAL" && <Field label="Buffer ($)"><input {...numField("manualBuffer")} data-testid="input-buffer" /></Field>}
          </div>
        )}
        <Field label="Target method">
          <select className={fieldCls} value={inp.targetMethod} onChange={(e) => set("targetMethod", e.target.value as any)} data-testid="select-target-method">
            {TARGET_METHODS.map((m) => <option key={m} value={m}>{TARGET_METHOD_LABEL[m]}</option>)}
          </select>
        </Field>
        {inp.targetMethod === "R_MULTIPLE" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="T1 (R)"><input {...numField("t1R", "0.1")} data-testid="input-t1r" /></Field>
            <Field label="T2 (R)"><input {...numField("t2R", "0.1")} data-testid="input-t2r" /></Field>
          </div>
        )}
        {inp.targetMethod === "MANUAL" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target 1"><input {...numField("manualT1")} data-testid="input-manual-t1" /></Field>
            <Field label="Target 2"><input {...numField("manualT2")} data-testid="input-manual-t2" /></Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max $ risk"><input {...numField("maxDollarRisk", "1")} data-testid="input-max-risk" /></Field>
          <Field label="Min T1 R:R"><input {...numField("minRrT1", "0.1")} data-testid="input-min-rr" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Share quantity">
            <select className={fieldCls} value={inp.shareMethod} onChange={(e) => set("shareMethod", e.target.value as any)} data-testid="select-share-method">
              <option value="AUTO">Auto from max risk</option><option value="MANUAL">Manual practice shares</option>
            </select>
          </Field>
          {inp.shareMethod === "MANUAL" && <Field label="Shares"><input {...numField("manualShares", "1")} data-testid="input-shares" /></Field>}
        </div>
        <Field label="Why are you changing the plan?">
          <textarea className={`${fieldCls} min-h-[48px]`} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Missed the entry — modeling a pullback to the retest zone" data-testid="input-reason" />
        </Field>
      </section>

      <section aria-label="Recalculated plan" data-testid="section-plan-result">
        {res ? <PlanResultView r={res} c={c} version={nextVersion} draft /> : <div className="text-xs text-slate-gray">Enter an entry and pick a stop level to see the recalculated plan.</div>}
        {res && (
          <div className="mt-2 space-y-1.5">
            {needsAck && (
              <label className="flex items-start gap-2 text-[11px] text-soft-white" data-testid="label-ack">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="checkbox-ack" />
                I reviewed the recalculated risk, targets and size. Original plan math no longer applies.
              </label>
            )}
            {err && <div className="text-[11px] text-rose-300" role="alert">{err}</div>}
            <button
              className="rounded border border-neon-blue bg-neon-blue/10 px-3 py-1 text-[12px] font-mono text-neon-blue hover:bg-neon-blue/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue"
              disabled={busy || res.state === "INVALID" || (needsAck && !ack)} onClick={save} data-testid="button-save-plan"
            >
              {busy ? "Saving…" : `Save as Practice Plan v${nextVersion}`}
            </button>
            <div className="text-[10px] text-slate-gray">Saving creates a new version and uses it on the chart, Action Center, trade card and scanner. It never changes the original plan and never sends anything to a broker.</div>
          </div>
        )}
      </section>
    </div>
  );
}

function SavedVersion({ v, current, onClose }: { v: PlanVersion; current: boolean; onClose: () => void }) {
  return (
    <div className="space-y-2" data-testid={`section-saved-version-${v.version}`}>
      <div className="text-[10.5px] font-mono text-slate-gray">
        Saved {fmtCT(v.createdAt)} · created by: User adjusted · data vendor {v.dataVendor ?? "—"} · changed: {v.result.changedFields.join(", ") || "nothing"}
        {v.reason ? <> · reason: <span className="text-soft-white">{v.reason}</span></> : null}
      </div>
      {!current && <div className="rounded border border-slate-500/50 bg-slate-500/10 px-2 py-1 text-[11px] text-soft-white">This version was made for an older setup. It is kept for your history but is not used on the chart.</div>}
      <PlanResultView r={v.result} c={v.context} version={v.version} />
      <div className="flex gap-2">
        {current && !v.selected && (
          <button className="rounded border border-neon-blue px-3 py-1 text-[12px] font-mono text-neon-blue hover:bg-neon-blue/10" onClick={async () => { await selectPlanVersion(v.symbol, v.version); onClose(); }} data-testid={`button-use-version-${v.version}`}>
            Use v{v.version} everywhere
          </button>
        )}
        {v.selected && <span className="text-[11px] font-mono text-signal-green" data-testid="text-version-in-use">In use on the chart, Action Center, trade card and scanner.</span>}
      </div>
    </div>
  );
}

export function PlanResultView({ r, c, version, draft }: { r: PlanResult; c: PlanContext; version: number; draft?: boolean }) {
  const levels: [string, string, string][] = [
    ["Proposed entry", $(r.entry), "#22c55e"], ["Stop loss", $(r.stop), "#ef4444"], ["Stop limit", $(r.stopLimit), "#f87171"],
    ["Target 1", $(r.t1), "#14b8a6"], ["Target 2", $(r.t2), "#a855f7"], ["Risk / share", $(r.riskPerShare), "#64748b"],
    ["R:R T1 / T2", `${rr(r.rrT1)} / ${rr(r.rrT2)}`, "#64748b"], ["Practice shares", `${r.shares}${r.shares !== r.suggestedShares ? ` (auto ${r.suggestedShares})` : ""}`, "#64748b"],
    ["Max practice risk", $(r.totalRisk), "#64748b"], ["Capital required", $(r.capital), "#64748b"],
  ];
  const ex = r.explain;
  return (
    <div className="rounded border border-dashed border-neon-blue/60 bg-ink-black p-2.5 space-y-2" data-testid="card-plan-result">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold text-[12px]">PRACTICE PLAN — USER-ADJUSTED</span>
        <span className="px-1.5 rounded border border-neon-blue/60 text-neon-blue text-[10px] font-mono" data-testid="text-plan-version">{draft ? `draft v${version}` : `v${version}`}</span>
        <span className="text-[10.5px] font-mono text-slate-gray">{c.symbol} · {c.exchange} · {c.setupType?.replace(/_/g, " ") ?? "no setup"} · original: {ORIGINAL_STATUS_LABEL[originalPlanStatus(c)]}</span>
        <span className="ml-auto text-[10.5px] font-mono text-slate-gray">{$(c.currentPrice)} · {fmtCT(c.quoteTimestamp)} · data {c.dataStatus}</span>
      </div>
      <div className={`rounded border px-2 py-1 text-[11.5px] font-mono font-bold ${STATE_TONE[r.state]}`} role="status" data-testid="text-plan-state">
        {PLAN_STATE_LABEL[r.state]}
        {r.states.length > 1 && <span className="font-normal"> · also: {r.states.slice(1).map((s) => PLAN_STATE_LABEL[s].replace(/\.$/, "")).join(" · ")}</span>}
      </div>
      {r.messages.length > 0 && <ul className="list-disc pl-4 text-[11px] text-soft-white/90" data-testid="list-plan-messages">{r.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>}
      {r.originalMathInvalid && <div className="text-[11px] font-mono font-bold text-signal-amber" data-testid="text-original-math-invalid">Original plan math no longer applies.</div>}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {levels.map(([k, v, tone]) => (
          <div key={k} className="rounded border bg-ink-black/60 px-1.5 py-1" style={{ borderColor: `${tone}55` }}>
            <div className="text-[9px] uppercase font-mono" style={{ color: tone }}>{k}</div>
            <div className="text-[13px] font-mono font-bold text-soft-white" data-testid={`text-result-${k.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{v}</div>
          </div>
        ))}
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        {([["What changed from original plan", ex.whatChanged], ["Why the new stop was chosen", ex.whyStop], ["Why targets changed", ex.whyTargets],
          ["Does the plan still meet selected R:R?", ex.meetsRr], ["Is price currently extended?", ex.extended], ["What must happen before this plan is valid?", ex.mustHappen]] as const).map(([q, a]) => (
          <div key={q}><dt className="font-mono text-[10px] uppercase text-slate-gray">{q}</dt><dd className="text-soft-white/90">{a}</dd></div>
        ))}
      </dl>
      <div className="text-[10px] text-slate-gray">A stop-limit may not fill during a fast decline or gap. No stop type protects against all loss.</div>
      <ul className="text-[10px] font-mono text-signal-amber space-y-0.5" data-testid="list-plan-warnings">{PLAN_WARNINGS.map((w) => <li key={w}>{w}</li>)}</ul>
    </div>
  );
}
