// Part 4 — My Trades: the single list of practice trades (ARMED → ACTIVE → CLOSED / CANCELLED) with edit, fill, close,
// cancel and edit history. Same rows the trading card and header read. PRACTICE ONLY — no broker, no orders.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { fmtCT } from "@/lib/swing";
import { openTradeDialog, tradeApi, useSwingTrades, useTradeEvents, useTradesSummary } from "@/lib/swingTrades";
import { editedFields, unrealizedR, type ExitReason, type SwingTrade } from "@shared/swingTrades";
import { GAP_RISK, PRACTICE_LABEL } from "./ArmTrade";

const usd = (n: number | null | undefined, sign = false) => (n == null || !Number.isFinite(n) ? "—" : `${sign && n > 0 ? "+" : ""}${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`);
const px = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const field = "rounded border border-ink-line bg-ink-black px-2 py-1 text-[12px] font-mono text-soft-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue";
const btn = "px-2 py-1 rounded-sm text-[10px] font-mono font-bold uppercase tracking-wide border border-ink-line text-soft-white hover:bg-ink-deep disabled:opacity-40 inline-flex items-center gap-1";

export function StatusBadge({ status }: { status: SwingTrade["status"] }) {
  const cls = status === "ARMED" ? "border-neon-blue/60 text-neon-blue bg-neon-blue/10" : status === "ACTIVE" ? "border-signal-green/60 text-signal-green bg-signal-green/10" : status === "CLOSED" ? "border-ink-line text-slate-gray" : "border-ink-line text-slate-gray line-through";
  return <span className={`px-1.5 py-0.5 rounded-sm border text-[10px] font-mono font-bold tracking-wider ${cls}`} data-testid={`badge-trade-status-${status}`}>{status}</span>;
}

export function MyTrades({ compact = false }: { compact?: boolean }) {
  const q = useSwingTrades();
  const summary = useTradesSummary();
  const { data: prices } = useQuery<Record<string, { price: number }>>({ queryKey: ["/api/prices"], refetchInterval: 30_000 });
  const [showDone, setShowDone] = usePersistentState<boolean>("my-trades-show-done", false);
  const all = q.data?.trades ?? [];
  const open = all.filter((t) => t.status === "ARMED" || t.status === "ACTIVE");
  const done = all.filter((t) => t.status === "CLOSED" || t.status === "CANCELLED");
  return (
    <div className="space-y-2" data-testid="section-my-trades">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono">
        <span className="font-bold text-signal-amber">{PRACTICE_LABEL}</span>
        {summary.data && (
          <span className="text-slate-gray" data-testid="text-my-trades-summary">
            {summary.data.armed} armed · {summary.data.active} active · open risk {usd(summary.data.openRiskDollars)} · today {usd(summary.data.dailyPnl, true)} · week {usd(summary.data.weeklyPnl, true)}
          </span>
        )}
      </div>
      <div className="text-[10px] font-mono font-bold text-signal-amber" data-testid="text-my-trades-gap">{GAP_RISK}</div>
      {q.isLoading && <div className="text-[11px] text-slate-gray">Loading practice trades…</div>}
      {q.isError && <div className="text-[11px] text-signal-red">Could not load practice trades: {(q.error as any)?.message}</div>}
      {!q.isLoading && open.length === 0 && <div className="text-[11px] text-slate-gray border border-dashed border-ink-line rounded-sm p-3" data-testid="text-my-trades-empty">No armed or active practice trades. Use <b>Arm Trade</b> on a Ready trading card to add one here.</div>}
      {open.map((t) => <TradeRow key={t.id} t={t} price={prices?.[t.symbol]?.price ?? null} compact={compact} />)}
      {done.length > 0 && (
        <button className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-gray hover:text-soft-white" onClick={() => setShowDone(!showDone)} data-testid="button-toggle-done-trades">
          {showDone ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} Closed & cancelled ({done.length})
        </button>
      )}
      {showDone && done.map((t) => <TradeRow key={t.id} t={t} price={null} compact={compact} />)}
    </div>
  );
}

function TradeRow({ t, price, compact }: { t: SwingTrade; price: number | null; compact: boolean }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<null | "fill" | "close" | "cancel" | "history">(null);
  const [fillPrice, setFillPrice] = useState(t.entry.toFixed(2));
  const [exitPrice, setExitPrice] = useState(price?.toFixed(2) ?? "");
  const [exitReason, setExitReason] = useState<ExitReason>("MANUAL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const edited = editedFields(t);
  const uR = t.status === "ACTIVE" ? unrealizedR(t, price) : null;
  const run = async (fn: () => Promise<SwingTrade>, title: string) => {
    if (busy) return; setBusy(true);
    try { const r = await fn(); toast({ title: `${title} — ${r.symbol} #${r.id}`, description: `Status ${r.status}. Journal entry added. Practice only — not an order.` }); setMode(null); setNote(""); }
    catch (e: any) { toast({ title: "Not saved", description: e?.body?.error ?? e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const closed = t.status === "CLOSED" || t.status === "CANCELLED";
  return (
    <div className={`rounded-sm border ${t.status === "ACTIVE" ? "border-signal-green/40" : t.status === "ARMED" ? "border-neon-blue/40" : "border-ink-line/60"} bg-ink-black/40 p-2 space-y-1.5`} data-testid={`row-trade-${t.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-mono">
        <span className="font-display tracking-widest text-soft-white">{t.symbol}</span>
        <StatusBadge status={t.status} />
        <span className="text-slate-gray text-[10px]">#{t.id}{t.timeframe ? ` · ${t.timeframe}` : ""}{t.setupType ? ` · ${t.setupType}` : ""}</span>
        <span>E {px(t.entry)}</span><span>S {px(t.stop)}</span><span>T1 {px(t.t1)}</span>{t.t2 != null && <span>T2 {px(t.t2)}</span>}
        <span>{t.shares} sh · risk {usd(t.riskDollars)}{t.rrT1 != null ? ` · ${t.rrT1}R` : ""}</span>
        {t.status === "ACTIVE" && <span className="text-signal-green">filled {px(t.fillPrice)}</span>}
        {price != null && !closed && <span className="text-slate-gray">now {px(price)}{uR != null ? <span className={uR >= 0 ? " text-signal-green" : " text-signal-red"}> · {uR >= 0 ? "+" : ""}{uR}R</span> : null}</span>}
        {t.status === "CLOSED" && <span className={(t.pnl ?? 0) >= 0 ? "text-signal-green" : "text-signal-red"} data-testid={`text-trade-pnl-${t.id}`}>{t.exitReason} @ {px(t.exitPrice)} · {usd(t.pnl, true)}{t.rMultiple != null ? ` · ${t.rMultiple > 0 ? "+" : ""}${t.rMultiple}R` : ""}</span>}
        {edited.length > 0 && <span className="text-[10px] text-signal-amber" title={`Edited from engine levels: ${edited.join(", ")}`}>edited: {edited.join(", ")}</span>}
        {t.overrideReason && <span className="text-[10px] text-signal-amber" title={t.overrideReason}>override</span>}
        <span className="ml-auto text-[10px] text-slate-gray">{t.status === "CLOSED" && t.closedAt ? `closed ${fmtCT(t.closedAt)}` : t.status === "CANCELLED" && t.cancelledAt ? `cancelled ${fmtCT(t.cancelledAt)}` : `armed ${fmtCT(t.armedAt)}`}</span>
      </div>
      {!compact && t.notes && <div className="text-[11px] text-slate-gray">{t.notes}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        {!closed && <button className={btn} onClick={() => openTradeDialog({ mode: "edit", trade: t })} data-testid={`button-trade-edit-${t.id}`}><Pencil className="w-3 h-3" /> Edit</button>}
        {t.status === "ARMED" && <button className={btn} onClick={() => setMode(mode === "fill" ? null : "fill")} data-testid={`button-trade-fill-${t.id}`}>Mark filled</button>}
        {t.status === "ARMED" && <button className={btn} onClick={() => setMode(mode === "cancel" ? null : "cancel")} data-testid={`button-trade-cancel-${t.id}`}>Cancel plan</button>}
        {t.status === "ACTIVE" && <button className={btn} onClick={() => setMode(mode === "close" ? null : "close")} data-testid={`button-trade-close-${t.id}`}>Record close</button>}
        <button className={btn} onClick={() => setMode(mode === "history" ? null : "history")} data-testid={`button-trade-history-${t.id}`}><History className="w-3 h-3" /> History</button>
      </div>
      {mode === "fill" && (
        <div className="flex flex-wrap items-end gap-2 text-[11px]" data-testid={`form-trade-fill-${t.id}`}>
          <label>Fill price<br /><input className={field} type="number" step="0.01" value={fillPrice} onChange={(e) => setFillPrice(e.target.value)} data-testid={`input-fill-price-${t.id}`} /></label>
          <label className="flex-1 min-w-[140px]">Note<br /><input className={field + " w-full"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
          <button className={btn + " border-signal-green/60 text-signal-green"} disabled={busy || !Number(fillPrice)} onClick={() => run(() => tradeApi.fill(t.id, { fillPrice: Number(fillPrice), note: note || undefined }), "Recorded fill")} data-testid={`button-confirm-fill-${t.id}`}>Save fill → ACTIVE</button>
          <span className="text-[10px] text-slate-gray basis-full">Records the price you got in your practice account. It does not send anything anywhere.</span>
        </div>
      )}
      {mode === "close" && (
        <div className="flex flex-wrap items-end gap-2 text-[11px]" data-testid={`form-trade-close-${t.id}`}>
          <label>Exit price<br /><input className={field} type="number" step="0.01" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} data-testid={`input-exit-price-${t.id}`} /></label>
          <label>Reason<br /><select className={field} value={exitReason} onChange={(e) => setExitReason(e.target.value as ExitReason)} data-testid={`select-exit-reason-${t.id}`}><option value="STOP">Stop hit</option><option value="T1">Target 1</option><option value="T2">Target 2</option><option value="MANUAL">Manual exit</option></select></label>
          <label className="flex-1 min-w-[140px]">Note<br /><input className={field + " w-full"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="what did you learn?" /></label>
          <button className={btn + " border-signal-amber/60 text-signal-amber"} disabled={busy || !Number(exitPrice)} onClick={() => run(() => tradeApi.close(t.id, { exitPrice: Number(exitPrice), exitReason, note: note || undefined }), "Closed")} data-testid={`button-confirm-close-${t.id}`}>Save close → CLOSED</button>
          {Number(exitPrice) > 0 && t.fillPrice != null && <span className="text-[10px] text-slate-gray basis-full">P&L would be {usd((Number(exitPrice) - t.fillPrice) * t.shares, true)} ({unrealizedR(t, Number(exitPrice))}R).</span>}
        </div>
      )}
      {mode === "cancel" && (
        <div className="flex flex-wrap items-end gap-2 text-[11px]" data-testid={`form-trade-cancel-${t.id}`}>
          <label className="flex-1 min-w-[140px]">Why cancel?<br /><input className={field + " w-full"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" /></label>
          <button className={btn + " border-signal-red/60 text-signal-red"} disabled={busy} onClick={() => run(() => tradeApi.cancel(t.id, { note: note || undefined }), "Cancelled")} data-testid={`button-confirm-cancel-${t.id}`}>Cancel plan → CANCELLED</button>
        </div>
      )}
      {mode === "history" && <TradeHistory id={t.id} />}
    </div>
  );
}

function TradeHistory({ id }: { id: number }) {
  const q = useTradeEvents(id);
  const ev = q.data?.events ?? [];
  const keys = ["entry", "stop", "stopLimit", "t1", "t2", "shares", "notes", "status", "fillPrice", "exitPrice"] as const;
  return (
    <div className="border-t border-ink-line/60 pt-1.5 space-y-1 text-[11px] font-mono" data-testid={`list-trade-events-${id}`}>
      {q.isLoading && <div className="text-slate-gray">Loading history…</div>}
      {ev.map((e) => {
        const diffs = e.before && e.after ? keys.filter((k) => JSON.stringify((e.before as any)[k]) !== JSON.stringify((e.after as any)[k])) : [];
        return (
          <div key={e.id} className="flex flex-wrap gap-x-2 gap-y-0.5" data-testid={`event-${e.id}`}>
            <span className="text-slate-gray w-[160px] shrink-0 whitespace-nowrap">{fmtCT(e.at)}</span>
            <span className="font-bold">{e.kind}</span>
            <span className="text-slate-gray">{e.note}</span>
            {diffs.length > 0 && <span className="basis-full pl-[168px] text-slate-gray">{diffs.map((k) => `${k}: ${String((e.before as any)[k] ?? "—")} → ${String((e.after as any)[k] ?? "—")}`).join(" · ")}</span>}
          </div>
        );
      })}
      {!q.isLoading && ev.length === 0 && <div className="text-slate-gray">No events yet.</div>}
    </div>
  );
}
