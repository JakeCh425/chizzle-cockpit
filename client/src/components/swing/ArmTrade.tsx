// Part 4 — Arm Trade dialog (also the Edit dialog from a card or My Trades). Two steps: editable pre-filled form
// with live recalculation and soft risk warnings → confirm summary → "Confirm & add to My Trades".
// PRACTICE ONLY — this records a practice plan. There is no broker, no order, and no button that sends one.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Settings } from "@shared/schema";
import type { OpenPositionRisk } from "@shared/risk";
import { buildRiskStatus } from "@/lib/risk";
import { setupIdOf } from "@shared/practicePlan";
import { editedFields, sharesForRisk, softWarnings, tradeMath, type ArmTradeInput, type RiskContext, type SoftWarning, type SwingTrade } from "@shared/swingTrades";
import { snapshotOf } from "@/lib/journal";
import { TRADE_DIALOG_EVENT, tradeApi, useTradesSummary, type TradeDialogRequest } from "@/lib/swingTrades";

export const PRACTICE_LABEL = "PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE";
export const GAP_RISK = "OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.";
const field = "w-full rounded border border-ink-line bg-ink-black px-2 py-1 text-[12px] font-mono text-soft-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue disabled:opacity-60";
const lab = "block text-[10px] font-mono font-bold uppercase tracking-wide text-neon-blue mb-1";
const fmt = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d));
const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(2)}`);

/** Same inputs the header risk bar uses, so the dialog's warnings match what the cockpit shows. */
export function useRiskContext(): RiskContext | null {
  const { data: settings } = useQuery<Settings>({ queryKey: ["/api/settings"] });
  const { data: regime } = useQuery<{ effective: { code: "green" | "yellow" | "red" } }>({ queryKey: ["/api/regime"] });
  const { data: closed } = useQuery<{ closedAt: string | null; netPnl: number | null; rMultiple: number | null }[]>({ queryKey: ["/api/analytics/trades", null, null], queryFn: async () => { const r = await fetch("/api/analytics/trades"); if (!r.ok) throw new Error("closed trades"); return r.json(); } });
  const { data: open } = useQuery<OpenPositionRisk[]>({ queryKey: ["/api/risk/open-positions"] });
  const summary = useTradesSummary();
  // Drawdown the same way the cockpit header shows it (peak of equity history) so the warning matches what the user sees.
  const { data: eq } = useQuery<any[]>({ queryKey: ["/api/equity-history"] });
  return useMemo(() => {
    if (!settings || !regime) return null;
    const s = buildRiskStatus({ settings, activeRegime: regime.effective.code.toUpperCase() as any, closedTrades: closed ?? [], closedTradesWithR: closed ?? [], openPositions: open ?? [] });
    // ARMED practice plans are not in /api/risk/open-positions yet (no fill) — include their planned risk here.
    const vals = (eq ?? []).map((e: any) => Number(e.equity ?? e.value ?? 0)).filter((v) => v > 0);
    const ddHeader = vals.length ? ((vals[vals.length - 1] - Math.max(...vals)) / Math.max(...vals)) * 100 : null;
    const armedRisk = Math.max(0, (summary.data?.openRiskDollars ?? 0) - (open ?? []).filter((p) => p.source === "swing").reduce((a, p) => a + p.riskDollars, 0));
    return {
      equity: s.equity, maxDailyLossAmount: s.rules.maxDailyLossAmount, maxWeeklyLossAmount: s.rules.maxWeeklyLossAmount, maxDrawdownPercent: s.rules.maxDrawdownPercent,
      maxOpenRiskPercent: s.rules.maxOpenRiskPercent, maxRiskPerTradePercent: s.rules.maxRiskPerTradePercent,
      openRiskDollars: s.openRiskDollars + armedRisk, dailyPnl: s.dailyPnl, weeklyPnl: s.weeklyPnl, drawdownPercent: ddHeader ?? s.drawdownPercent,
    };
  }, [settings, regime, closed, open, summary.data, eq]);
}

export function TradeDialogHost() {
  const [req, setReq] = useState<TradeDialogRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent).detail as TradeDialogRequest);
    window.addEventListener(TRADE_DIALOG_EVENT, on);
    return () => window.removeEventListener(TRADE_DIALOG_EVENT, on);
  }, []);
  return (
    <Dialog open={!!req} onOpenChange={(o) => { if (!o) setReq(null); }}>
      <DialogContent className="max-w-2xl bg-ink-panel border-ink-line text-soft-white max-h-[92vh] overflow-y-auto" data-testid="dialog-arm-trade">
        {req && <TradeForm req={req} onDone={() => setReq(null)} />}
      </DialogContent>
    </Dialog>
  );
}

type Raw = { entry: string; stop: string; stopLimit: string; t1: string; t2: string; shares: string; risk: string; timeframe: string; setupType: string; notes: string };
const s2 = (n: number | null | undefined) => (n == null ? "" : n.toFixed(2));
function initialRaw(req: TradeDialogRequest): Raw {
  if (req.mode === "edit") { const t = req.trade; return { entry: s2(t.entry), stop: s2(t.stop), stopLimit: s2(t.stopLimit), t1: s2(t.t1), t2: s2(t.t2), shares: String(t.shares), risk: s2(t.riskDollars), timeframe: t.timeframe ?? "", setupType: t.setupType ?? "", notes: t.notes }; }
  const p = req.plan, d = req.decision;
  const risk = p.entry != null && p.stop != null && p.shares != null ? (p.entry - p.stop) * p.shares : null;
  return { entry: s2(p.entry), stop: s2(p.stop), stopLimit: s2(p.stopLimit), t1: s2(p.t1), t2: s2(p.t2), shares: String(p.shares ?? 0), risk: s2(risk), timeframe: d.setupTimeframe ?? "", setupType: d.setupType ?? "", notes: "" };
}
const num = (s: string): number | null => { const n = Number(s); return s.trim() === "" || !Number.isFinite(n) ? null : n; };

function TradeForm({ req, onDone }: { req: TradeDialogRequest; onDone: () => void }) {
  const { toast } = useToast();
  const ctx = useRiskContext();
  const [raw, setRaw] = useState<Raw>(() => initialRaw(req));
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [override, setOverride] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const isEdit = req.mode === "edit";
  const symbol = isEdit ? req.trade.symbol : req.decision.symbol;
  const needsOverride = !isEdit && req.overrideRequired;
  const active = isEdit && req.trade.status === "ACTIVE";

  const levels = { entry: num(raw.entry), stop: num(raw.stop), stopLimit: num(raw.stopLimit), t1: num(raw.t1), t2: num(raw.t2), shares: num(raw.shares) ?? 0 };
  const m = tradeMath(levels as any);
  const warnings: SoftWarning[] = ctx ? softWarnings(m, ctx) : [];
  const set = (k: keyof Raw) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setRaw((r) => {
      const next = { ...r, [k]: v };
      // $ risk ↔ shares stay in sync: typing $ risk sizes shares; typing shares/entry/stop refreshes $ risk.
      const en = num(next.entry), st = num(next.stop);
      if (k === "risk") { const rk = num(v); if (en != null && st != null && rk != null) next.shares = String(sharesForRisk(en, st, rk)); }
      else if (["shares", "entry", "stop"].includes(k)) { const sh = num(next.shares) ?? 0; if (en != null && st != null && st < en) next.risk = s2((en - st) * sh); }
      return next;
    });
  };
  const original = isEdit ? req.trade.originalLevels : { entry: req.plan.entry ?? undefined, stop: req.plan.stop ?? undefined, stopLimit: req.plan.stopLimit, t1: req.plan.t1 ?? undefined, t2: req.plan.t2, shares: req.plan.shares ?? undefined };
  const edited = editedFields({ ...(levels as any), originalLevels: original });
  const canContinue = m.problems.length === 0 && (!needsOverride || override.trim().length >= 3);

  const submit = async () => {
    if (busy) return; setBusy(true);
    try {
      if (isEdit) {
        const t = await tradeApi.edit(req.trade.id, { entry: levels.entry!, stop: levels.stop!, stopLimit: levels.stopLimit, t1: levels.t1!, t2: levels.t2, shares: levels.shares, notes: raw.notes, reason: reason || undefined });
        toast({ title: `Practice trade #${t.id} updated — ${t.symbol}`, description: "Levels saved to My Trades. The engine's own levels are unchanged. Practice only — not an order." });
      } else {
        const d = req.decision;
        const body: ArmTradeInput = {
          symbol: d.symbol, exchange: (d as any).exchange ?? "", setupKey: setupIdOf(d), setupType: raw.setupType || d.setupType || null, timeframe: raw.timeframe || d.setupTimeframe || null,
          entry: levels.entry!, stop: levels.stop!, stopLimit: levels.stopLimit, t1: levels.t1!, t2: levels.t2, shares: levels.shares, notes: raw.notes,
          originalLevels: { entry: req.plan.entry ?? undefined, stop: req.plan.stop ?? undefined, stopLimit: req.plan.stopLimit, t1: req.plan.t1 ?? undefined, t2: req.plan.t2, shares: req.plan.shares ?? undefined },
          decisionSnapshot: { ...snapshotOf(d), planSource: req.plan.source, planVersion: req.plan.version, liveAllowed: req.liveAllowed },
          overrideReason: needsOverride ? override.trim() : null, acknowledgedWarnings: warnings.map((w) => w.id),
        };
        const t = await tradeApi.arm(body);
        toast({ title: `Armed — ${t.symbol} added to My Trades (#${t.id})`, description: "Status ARMED. Mark it filled when (and if) you take it in your practice account. A journal entry was added. Practice only — nothing was sent to a broker." });
      }
      onDone();
    } catch (e: any) {
      toast({ title: isEdit ? "Not updated" : "Not armed", description: e?.body?.error ?? e?.message ?? "Request failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const rowProps = { raw, edited, set };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-[15px]" data-testid="text-arm-trade-title">
          {isEdit ? `Edit Practice Trade #${req.trade.id} — ${symbol}` : `Arm Practice Trade — ${symbol}`}
          {isEdit && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-ink-line text-slate-gray">{req.trade.status}</span>}
        </DialogTitle>
        <DialogDescription className="text-[11px] font-mono font-bold text-signal-amber">{PRACTICE_LABEL}</DialogDescription>
      </DialogHeader>
      <div className="text-[11px] font-mono font-bold text-signal-amber border border-signal-amber/40 bg-signal-amber/10 rounded-sm px-2 py-1" data-testid="text-gap-risk">{GAP_RISK}</div>

      {step === "edit" ? (
        <div className="space-y-3 text-[12px]">
          {needsOverride && (
            <div className="border border-signal-red/40 bg-signal-red/10 rounded-sm p-2 space-y-1" data-testid="box-override">
              <div className="flex items-center gap-1.5 text-signal-red font-bold"><AlertTriangle className="w-3.5 h-3.5" /> This setup is not Ready to Trade right now</div>
              <div className="text-slate-gray">Engine status: {req.decision.setupStatus.replace(/_/g, " ")}. You can still arm a practice plan, but say why — the reason is saved with the trade and in the journal.</div>
              <input className={field} placeholder="Reason for arming without READY (required)" value={override} onChange={(e) => setOverride(e.target.value)} data-testid="input-override-reason" />
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Row {...rowProps} k="entry" label="Entry" disabled={active} hint={active ? "Fixed — this trade is filled" : undefined} />
            <Row {...rowProps} k="stop" label="Stop loss" hint="Planned R uses this price" />
            <Row {...rowProps} k="stopLimit" label="Stop limit (optional)" hint="Below the stop; not used for R" />
            <Row {...rowProps} k="t1" label="Target 1" />
            <Row {...rowProps} k="t2" label="Target 2 (optional)" />
            <Row {...rowProps} k="shares" label="Shares" />
            <Row {...rowProps} k="risk" label="$ risk (sizes shares)" />
            <div>
              <label className={lab} htmlFor="trade-timeframe">Timeframe</label>
              <select id="trade-timeframe" className={field} value={raw.timeframe} onChange={set("timeframe")} data-testid="select-arm-timeframe">
                <option value="">—</option><option value="1H">1H</option><option value="4H">4H</option><option value="D">Daily</option><option value="W">Weekly</option>
              </select>
            </div>
            <div>
              <label className={lab} htmlFor="trade-setupType">Setup type</label>
              <input id="trade-setupType" className={field} value={raw.setupType} onChange={set("setupType")} data-testid="input-arm-setupType" />
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 border border-ink-line rounded-sm p-2 bg-ink-black/40" data-testid="box-trade-math">
            <Stat label="Risk / share" value={usd(m.riskPerShare)} />
            <Stat label="$ at risk" value={usd(m.riskDollars)} tone={m.riskDollars && ctx && m.riskDollars > ctx.maxDailyLossAmount ? "amber" : undefined} />
            <Stat label="R:R to T1" value={m.rrT1 != null ? `${fmt(m.rrT1)}R` : "—"} tone={m.rrT1 != null && m.rrT1 < 1.5 ? "amber" : "green"} />
            <Stat label="R:R to T2" value={m.rrT2 != null ? `${fmt(m.rrT2)}R` : "—"} />
            <Stat label="Reward at T1" value={usd(m.rewardT1Dollars)} />
            <Stat label="Position" value={usd(m.positionDollars)} />
          </div>
          {m.problems.length > 0 && <ul className="text-signal-red text-[11px] list-disc pl-4" data-testid="list-trade-problems">{m.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <Warnings warnings={warnings} />
          <div>
            <label className={lab} htmlFor="trade-notes">Notes</label>
            <textarea id="trade-notes" className={field + " min-h-[56px]"} value={raw.notes} onChange={set("notes")} placeholder="Why this plan? What would make you skip it?" data-testid="input-arm-notes" />
          </div>
          {isEdit && (
            <div>
              <label className={lab} htmlFor="trade-reason">Why are you changing it? (saved in edit history)</label>
              <input id="trade-reason" className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. raised stop under yesterday's low" data-testid="input-edit-reason" />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[10px] text-slate-gray">Targets are plan levels, not promises. Manual edits never change the engine's readiness.</div>
            <button className="px-3 py-1.5 rounded-sm text-[11px] font-mono font-bold uppercase tracking-wide bg-neon-blue text-ink-black disabled:opacity-40" disabled={!canContinue} onClick={() => setStep("confirm")} data-testid="button-trade-review">Review →</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-[12px]" data-testid="box-trade-confirm">
          <div className="font-bold">{isEdit ? "Confirm these changes" : "Confirm this practice plan"} — {symbol}</div>
          <table className="w-full text-[12px] font-mono">
            <tbody>
              {([["Entry", "entry"], ["Stop loss", "stop"], ["Stop limit", "stopLimit"], ["Target 1", "t1"], ["Target 2", "t2"], ["Shares", "shares"]] as const).map(([l, k]) => (
                <tr key={k} className="border-b border-ink-line/50"><td className="py-1 text-slate-gray">{l}</td>
                  <td className="py-1 text-right">{k === "shares" ? raw.shares : raw[k] ? `$${raw[k]}` : "—"}</td>
                  <td className="py-1 text-right text-[10px] text-slate-gray w-40">{edited.includes(k as any) ? `was ${k === "shares" ? (original as any)[k] : "$" + fmt((original as any)[k])}` : isEdit ? "" : "engine level"}</td></tr>
              ))}
              <tr><td className="py-1 text-slate-gray">$ at risk · R:R</td><td className="py-1 text-right" colSpan={2}>{usd(m.riskDollars)} · {m.rrT1 != null ? `${fmt(m.rrT1)}R to T1` : "—"}{m.rrT2 != null ? ` · ${fmt(m.rrT2)}R to T2` : ""}</td></tr>
              {!isEdit && needsOverride && <tr><td className="py-1 text-slate-gray">Override reason</td><td className="py-1 text-right text-signal-amber" colSpan={2}>{override}</td></tr>}
              {raw.notes && <tr><td className="py-1 text-slate-gray">Notes</td><td className="py-1 text-right" colSpan={2}>{raw.notes}</td></tr>}
            </tbody>
          </table>
          <Warnings warnings={warnings} />
          {warnings.length > 0 && (
            <label className="flex items-start gap-2 text-[11px]"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="check-ack-warnings" className="mt-0.5" /> I have read the risk warnings above and still want to record this practice plan.</label>
          )}
          <div className="text-[10px] text-slate-gray">Confirming saves the plan with status {isEdit ? req.trade.status : "ARMED"} in My Trades and writes a journal entry. It does not place, send or manage any broker order.</div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button className="px-3 py-1.5 rounded-sm text-[11px] font-mono uppercase tracking-wide border border-ink-line text-soft-white inline-flex items-center gap-1" onClick={() => setStep("edit")} data-testid="button-trade-back"><ArrowLeft className="w-3 h-3" /> Back to edit</button>
            <button className="px-3 py-1.5 rounded-sm text-[11px] font-mono font-bold uppercase tracking-wide bg-signal-green text-ink-black disabled:opacity-40 inline-flex items-center gap-1" disabled={busy || (warnings.length > 0 && !ack)} onClick={submit} data-testid="button-trade-confirm">
              {isEdit ? <><Pencil className="w-3 h-3" /> {busy ? "Saving…" : "Save changes"}</> : <><Check className="w-3 h-3" /> {busy ? "Adding…" : "Confirm & add to My Trades"}</>}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Hoisted so inputs keep focus across re-renders (an inline component would remount on every keystroke).
function Row({ k, label, hint, disabled, raw, edited, set }: { k: keyof Raw; label: string; hint?: string; disabled?: boolean; raw: Raw; edited: string[]; set: (k: keyof Raw) => (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div>
      <label className={lab} htmlFor={`trade-${k}`}>{label}{edited.includes(k) && <span className="ml-1 text-signal-amber normal-case tracking-normal">· edited</span>}</label>
      <input id={`trade-${k}`} className={field} type="number" step={k === "shares" ? "1" : "0.01"} inputMode="decimal" value={raw[k]} onChange={set(k)} disabled={disabled} data-testid={`input-arm-${k}`} />
      {hint && <div className="text-[10px] text-slate-gray mt-0.5">{hint}</div>}
    </div>
  );
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  return <div><div className="text-[9px] uppercase tracking-wider text-slate-gray">{label}</div><div className={`font-mono text-[13px] ${tone === "amber" ? "text-signal-amber" : tone === "green" ? "text-signal-green" : "text-soft-white"}`}>{value}</div></div>;
}
function Warnings({ warnings }: { warnings: SoftWarning[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1" data-testid="list-trade-warnings">
      {warnings.map((w) => (
        <li key={w.id} className={`flex items-start gap-1.5 text-[11px] rounded-sm px-2 py-1 border ${w.severity === "high" ? "border-signal-red/40 bg-signal-red/10 text-signal-red" : "border-signal-amber/40 bg-signal-amber/10 text-signal-amber"}`} data-testid={`warning-${w.id}`}>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> <span>{w.text} <span className="opacity-70">(soft warning — your call)</span></span>
        </li>
      ))}
    </ul>
  );
}
