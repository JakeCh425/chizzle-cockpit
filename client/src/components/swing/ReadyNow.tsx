// READY NOW banner — the strongest status on the Cockpit, directly under the P&L header.
// Reads the SAME scan + selected plan versions as the Action Center (no second source of
// readiness). Hidden entirely when nothing is ready. Buttons open the EXISTING trading card or
// chart; acknowledging only marks the alert read — it never changes the setup's status.
import { CheckCircle2, Check, LineChart, Maximize2, Palette, ShieldAlert, Zap } from "lucide-react";
import type { ScanSelection, SwingDecision } from "@shared/swingDecision";
import { effectivePlan, setupIdOf } from "@shared/practicePlan";
import { readyStatusLabel, sortForCockpit } from "@shared/readyAlerts";
import { activeVersion, focusSymbol, useSelectedPlans } from "@/lib/plans";
import { alertApi, invalidateAlerts, openTradingCard, useAlertEvents } from "@/lib/alerts";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useScan } from "./SwingWorkspace";
import { setupName, stopBreach } from "./TradingCard";

const ctShort = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }) + " CT";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const RN_THEMES = [
  { id: "signal", label: "Signal Green", sw: "linear-gradient(135deg,#10B981,#06140F)" },
  { id: "carbon", label: "Carbon Gold", sw: "linear-gradient(135deg,#E5C158,#0B0B0C)" },
  { id: "midnight", label: "Midnight Neon", sw: "linear-gradient(135deg,#A78BFA,#22D3EE)" },
  { id: "graphite", label: "Graphite Ice", sw: "linear-gradient(135deg,#7DD3FC,#1F2937)" },
  { id: "terminal", label: "Terminal Amber", sw: "linear-gradient(135deg,#F59E0B,#0A0A06)" },
] as const;
type RnTheme = (typeof RN_THEMES)[number]["id"];
const REQ = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [] as string[], force: 0 };

/** Ready = the engine's READY_TO_TRADE with usable data (same rule the Action Center uses for its first group). */
export const isReadyNow = (d: SwingDecision) => d.setupStatus === "READY_TO_TRADE" && d.dataStatus !== "STALE" && d.dataStatus !== "ERROR" && !d.evalPending; // Part 3: never from a pending snapshot

export default function ReadyNow() {
  const scan = useScan(REQ);
  const plans = useSelectedPlans();
  const events = useAlertEvents();
  const [acked, setAcked] = usePersistentState<string[]>("ready-now-acked", []);
  const [theme, setTheme] = usePersistentState<RnTheme>("ready-now-theme", "signal");
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
    <section className="rn-root rounded-2xl overflow-hidden" data-rn-theme={theme}
      aria-label="Ready now" data-testid="section-ready-now" data-count={ready.length}>
      <div className="rn-head flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:px-4">
        <Zap className="h-5 w-5 rn-title" aria-hidden />
        <h2 className="rn-title font-mono font-extrabold tracking-wider text-base" data-testid="text-ready-now-title">
          READY NOW — {ready.length} {blocked ? "PRACTICE " : ""}SETUP{ready.length === 1 ? "" : "S"}
        </h2>
        {blocked
          ? <span className="rn-bad inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold" title={live!.reason} data-testid="text-ready-live-blocked"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> LIVE ENTRY NOT PERMITTED — Capital Protection ({live!.regime})</span>
          : <span className="rn-good inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold" data-testid="text-ready-live-allowed"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Live risk allowed by regime</span>}
        <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="Ready Now theme">
          <Palette className="h-3.5 w-3.5 rn-muted" aria-hidden />
          {RN_THEMES.map((t) => (
            <button key={t.id} className="rn-swatch" style={{ background: t.sw }} aria-pressed={theme === t.id} aria-label={`${t.label} theme`} title={t.label}
              onClick={() => setTheme(t.id)} data-testid={`button-rn-theme-${t.id}`} />
          ))}
        </div>
      </div>
      <ul className="space-y-2 px-3 py-2 sm:px-4">
        {ready.map((d) => {
          const p = effectivePlan(d, activeVersion(d, sel));
          const isAcked = acked.includes(setupIdOf(d)) && !unreadFor(d.symbol).length;
          const a = d.signalAge;
          return (
            <li key={d.symbol} className="rn-ticket rounded-xl grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1.5 pr-3 py-2" data-unread={!isAcked} data-testid={`row-ready-${d.symbol}`}>
              <div className="rn-stub pl-3 pr-4 self-stretch flex flex-col justify-center">
                <span className="font-mono text-2xl font-extrabold leading-none" data-testid={`text-ready-ticker-${d.symbol}`}>{d.symbol}</span>
                <span className="font-mono text-[11px] rn-muted mt-0.5">{$(d.currentPrice)}</span>
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="rn-title font-mono text-[12px] font-bold" data-testid={`text-ready-status-${d.symbol}`}>{readyStatusLabel(d.setupStatus, live)}</span>
                  <span className="text-[12.5px]">{setupName(d.setupType)}{d.setupTimeframe && <span className="rn-chip"> • {d.setupTimeframe}</span>}{p.source === "USER" && <span className="rn-chip"> • My Plan v{p.version}</span>}</span>
                </div>
                <div className="font-mono text-[13px] flex flex-wrap gap-x-3" data-testid={`text-ready-levels-${d.symbol}`}>
                  <span>Entry <b>{$(p.entry)}</b></span><span>Stop <b>{$(p.stop)}</b></span><span>T1 <b>{$(p.t1)}</b></span><span>Risk/sh <b>{$(p.risk)}</b></span>
                </div>
                {a && <div className={`font-mono text-[11.5px] ${a.limit4h && a.bars4h >= a.limit4h - 1 ? "rn-warn" : "rn-muted"}`} data-testid={`text-ready-age-${d.symbol}`}>
                  {a.reconfirmed ? "Re-confirmed" : "Confirmed"} {ctShort(a.lastConfirmedAt)} · {a.bars4h}/{a.limit4h || "∞"} 4H bars old · {a.priceVsEntry === "AT" ? "price AT entry" : a.priceVsEntry === "BELOW" ? "price below entry" : "price above entry"}
                </div>}
                {(() => { const br = stopBreach(d, p.stop, p.t1); return br && <div className="font-mono text-[11.5px] font-bold rn-bad" role="alert" data-testid={`text-ready-below-stop-${d.symbol}`}>{br.text}</div>; })()}
                <div className="font-mono text-[10.5px] font-bold rn-warn">OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
              </div>
              <div className="col-span-2 sm:col-span-1 flex flex-wrap items-center gap-2 sm:justify-end pl-3 sm:pl-0">
                <button className="rn-btn rn-btn-primary px-4 py-2 text-[13px]" onClick={() => openTradingCard(d.symbol)} data-testid={`button-ready-open-card-${d.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> OPEN TRADING CARD</button>
                <button className="rn-btn px-2.5 py-1.5 text-[12px]" onClick={() => focusSymbol(d.symbol, "chart")} data-testid={`button-ready-open-chart-${d.symbol}`}><LineChart className="h-3.5 w-3.5" aria-hidden /> Open Chart</button>
                {isAcked
                  ? <span className="font-mono text-[11px] rn-muted" data-testid={`text-ready-acked-${d.symbol}`}>Acknowledged</span>
                  : <button className="rn-btn px-2 py-1 text-[11px]" onClick={() => ack(d)} data-testid={`button-ready-ack-${d.symbol}`}><Check className="h-3 w-3" aria-hidden /> Acknowledge</button>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="px-3 pb-2 sm:px-4 font-mono text-[10.5px] font-bold rn-warn">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · PRICE ALERT ONLY — VERIFY DATA AND REVIEW THE PLAN BEFORE ACTING.</div>
    </section>
  );
}
