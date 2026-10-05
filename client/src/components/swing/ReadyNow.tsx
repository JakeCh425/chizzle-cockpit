// READY NOW banner — the strongest status on the Cockpit, directly under the P&L header.
// Reads the SAME scan + selected plan versions as the Action Center (no second source of
// readiness). Hidden entirely when nothing is ready. Buttons open the EXISTING trading card or
// chart; acknowledging only marks the alert read — it never changes the setup's status.
import { CheckCircle2, Check, LineChart, Maximize2, ShieldAlert, Zap } from "lucide-react";
import type { ScanSelection, SwingDecision } from "@shared/swingDecision";
import { effectivePlan, setupIdOf } from "@shared/practicePlan";
import { readyStatusLabel, sortForCockpit } from "@shared/readyAlerts";
import { activeVersion, focusSymbol, useSelectedPlans } from "@/lib/plans";
import { alertApi, invalidateAlerts, openTradingCard, useAlertEvents } from "@/lib/alerts";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { setupName } from "./TradingCard";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const REQ = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [] as string[], force: 0 };

/** Ready = the engine's READY_TO_TRADE with usable data (same rule the Action Center uses for its first group). */
export const isReadyNow = (d: SwingDecision) => d.setupStatus === "READY_TO_TRADE" && d.dataStatus !== "STALE" && d.dataStatus !== "ERROR";

export default function ReadyNow() {
  const scan = useScan(REQ);
  const plans = useSelectedPlans();
  const events = useAlertEvents();
  const [acked, setAcked] = usePersistentState<string[]>("ready-now-acked", []);
  const ready = sortForCockpit((scan.data?.rows ?? []).map((r) => r.decision)).filter(isReadyNow);
  if (!ready.length) return null;
  const live = scan.data?.livePermission ?? null;
  const blocked = !!live && !live.allowed;
  const sel = plans.data?.selected;
  const unreadFor = (sym: string) => (events.data?.events ?? []).filter((e) => e.type === "READY_NOW" && e.symbol === sym && !e.acknowledged);
  const ack = async (d: SwingDecision) => {
    const k = setupIdOf(d);
    if (!acked.includes(k)) setAcked([...acked.slice(-99), k]);
    try { await Promise.all(unreadFor(d.symbol).map((e) => alertApi.ack(e.id))); } finally { invalidateAlerts(); }
  };

  return (
    <section className="rounded-xl border-2 border-emerald-500 dark:border-emerald-400/80 bg-emerald-50/60 dark:bg-ink-panel px-3 py-2 sm:px-4 shadow-[0_0_0_3px_rgba(16,185,129,0.15),0_0_24px_rgba(6,182,212,0.18)]"
      aria-label="Ready now" data-testid="section-ready-now" data-count={ready.length}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-300" aria-hidden />
        <h2 className="font-mono font-extrabold tracking-wide text-emerald-700 dark:text-emerald-300 text-base" data-testid="text-ready-now-title">
          READY NOW — {ready.length} PRACTICE SETUP{ready.length === 1 ? "" : "S"}
        </h2>
        {blocked
          ? <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/70 dark:border-rose-400/70 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-700 dark:text-rose-300" title={live!.reason} data-testid="text-ready-live-blocked"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> LIVE ENTRY NOT PERMITTED — Capital Protection ({live!.regime})</span>
          : <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/60 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300" data-testid="text-ready-live-allowed"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Live risk allowed by regime</span>}
        <span className="ml-auto font-mono text-[10.5px] font-bold text-amber-700 dark:text-signal-amber">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {ready.map((d) => {
          const p = effectivePlan(d, activeVersion(d, sel));
          const isAcked = acked.includes(setupIdOf(d)) && !unreadFor(d.symbol).length;
          return (
            <li key={d.symbol} className={`grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-lg border px-3 py-1.5 bg-white/70 dark:bg-transparent ${isAcked ? "border-emerald-500/30" : "border-cyan-500/70 dark:border-cyan-300/70 dark:bg-cyan-300/5"}`} data-testid={`row-ready-${d.symbol}`}>
              <span className="font-mono text-2xl font-extrabold leading-none text-slate-900 dark:text-soft-white" data-testid={`text-ready-ticker-${d.symbol}`}>{d.symbol}</span>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[12px] font-bold text-emerald-700 dark:text-emerald-300" data-testid={`text-ready-status-${d.symbol}`}>{readyStatusLabel(d.setupStatus, live)}</span>
                  <span className="text-[12.5px] text-slate-800 dark:text-soft-white">{setupName(d.setupType)}{d.setupTimeframe && <span className="text-cyan-700 dark:text-neon-blue"> • {d.setupTimeframe}</span>}{p.source === "USER" && <span className="text-cyan-700 dark:text-neon-blue"> • My Plan v{p.version}</span>}</span>
                </div>
                <div className="font-mono text-[13px] text-slate-900 dark:text-soft-white flex flex-wrap gap-x-3" data-testid={`text-ready-levels-${d.symbol}`}>
                  <span>Entry <b>{$(p.entry)}</b></span><span>Stop <b>{$(p.stop)}</b></span><span>T1 <b>{$(p.t1)}</b></span><span>Risk/sh <b>{$(p.risk)}</b></span>
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1 flex flex-wrap items-center gap-2 sm:justify-end">
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 dark:bg-emerald-400 px-4 py-2 font-mono text-[13px] font-extrabold text-white dark:text-ink-black hover:bg-emerald-600 dark:hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  onClick={() => openTradingCard(d.symbol)} data-testid={`button-ready-open-card-${d.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> OPEN TRADING CARD</button>
                <button className="inline-flex items-center gap-1 rounded-lg border border-cyan-600/60 dark:border-cyan-300/60 px-2.5 py-1.5 font-mono text-[12px] text-cyan-800 dark:text-cyan-200 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  onClick={() => focusSymbol(d.symbol, "chart")} data-testid={`button-ready-open-chart-${d.symbol}`}><LineChart className="h-3.5 w-3.5" aria-hidden /> Open Chart</button>
                {isAcked
                  ? <span className="font-mono text-[11px] text-slate-600 dark:text-slate-gray" data-testid={`text-ready-acked-${d.symbol}`}>Acknowledged</span>
                  : <button className="inline-flex items-center gap-1 rounded border border-slate-400/60 dark:border-ink-line px-2 py-1 font-mono text-[11px] text-slate-700 dark:text-slate-gray hover:text-slate-900 dark:hover:text-soft-white" onClick={() => ack(d)} data-testid={`button-ready-ack-${d.symbol}`}><Check className="h-3 w-3" aria-hidden /> Acknowledge</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
