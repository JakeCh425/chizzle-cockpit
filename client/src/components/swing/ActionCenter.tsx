// Section R5 — Action Center: the top-of-Cockpit summary of every watchlist symbol,
// ordered Ready > Confirmed > Forming > Retest > Extended > R:R/stop > Data > No trade.
// Reads the SAME scan + selected plan versions as the workspace. Practice / analysis only.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, BookOpen, CheckCircle2, Eye, Hourglass, LineChart, MinusCircle, Pencil, RotateCcw, ShieldAlert, Sprout, WifiOff } from "lucide-react";
import type { ScanSelection, SwingDecision, SwingSettings } from "@shared/swingDecision";
import { ACTION_GROUP_LABEL, actionGroupOf, canEditPlan, sortForActionCenter, type ActionGroup } from "@shared/practicePlan";
import { fmt$, fmtCT, swingGet, swingSend } from "@/lib/swing";
import { activeVersion, effectivePlan, focusSymbol, openPlanEditor, staleVersion, useSelectedPlans } from "@/lib/plans";
import { RefreshDataButton } from "./DataStatus";
import { useScan } from "./SwingWorkspace";
import { AlertsPanel, SetAlertButton } from "./PriceAlerts";
import { defaultAlertFor } from "@/lib/alerts";

const TONE: Record<ActionGroup, { box: string; head: string; Icon: typeof CheckCircle2 }> = {
  READY: { box: "border-emerald-500 bg-emerald-500/[0.09] border-2", head: "text-signal-green", Icon: CheckCircle2 },
  CONFIRMED: { box: "border-teal-400/70 bg-teal-400/[0.07]", head: "text-neon-blue", Icon: Hourglass },
  FORMING: { box: "border-amber-400/70 bg-amber-400/[0.07]", head: "text-signal-amber", Icon: Sprout },
  RETEST: { box: "border-sky-400/60 bg-sky-400/[0.06]", head: "text-neon-blue", Icon: RotateCcw },
  EXTENDED: { box: "border-orange-500/70 bg-orange-500/[0.07]", head: "text-signal-amber", Icon: ShieldAlert },
  RR_STOP: { box: "border-rose-400/60 bg-rose-400/[0.06]", head: "text-signal-red", Icon: Ban },
  DATA: { box: "border-rose-600/60 bg-slate-500/[0.10]", head: "text-signal-red", Icon: WifiOff },
  NO_TRADE: { box: "border-ink-line bg-ink-black/40", head: "text-slate-gray", Icon: MinusCircle },
};
const GRADE: Record<string, string> = { A4_CORE: "Core grade", A3_SWING: "Standard grade", A2_PRACTICE: "Practice grade (half size)" };
const btn = "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue motion-safe:transition-colors";
const btnMain = `${btn} border-neon-blue/60 text-neon-blue hover:bg-neon-blue/10`;
const btnSub = `${btn} border-ink-line text-slate-gray hover:text-soft-white`;

function Lv({ k, v, tone }: { k: string; v: string; tone: string }) {
  return (
    <div className="rounded border bg-[#050a13] px-2 py-1" style={{ borderColor: `${tone}66` }}>
      <div className="text-[9.5px] uppercase tracking-wide font-mono" style={{ color: tone }}>{k}</div>
      <div className="font-mono font-bold text-[14px] text-[#f1f5f9]">{v}</div>
    </div>
  );
}

function Buttons({ d, group, ver }: { d: SwingDecision; group: ActionGroup; ver: ReturnType<typeof activeVersion> }) {
  const [saved, setSaved] = useState<string | null>(null);
  const editable = canEditPlan(d);
  const journal = async () => {
    try { await swingSend("POST", "/api/swing/journal", { action: "PRACTICE_TRADE", symbol: d.symbol, notes: "Saved from Action Center (practice plan, not an order)." }); setSaved("Saved to journal"); }
    catch (e: any) { setSaved(e?.message ?? "Save failed"); }
  };
  const chart = <button className={btnMain} onClick={() => focusSymbol(d.symbol)} data-testid={`button-ac-chart-${d.symbol}`} aria-label={`Open ${d.symbol} chart`}><LineChart className="h-3 w-3" aria-hidden /> {group === "FORMING" ? "Watch Setup" : "Open Chart"}</button>;
  const why = (label: string) => <button className={btnSub} onClick={() => focusSymbol(d.symbol, "why")} data-testid={`button-ac-why-${d.symbol}`}><BookOpen className="h-3 w-3" aria-hidden /> {label}</button>;
  const edit = editable && <button className={btnMain} onClick={() => openPlanEditor(d.symbol)} data-testid={`button-edit-plan-${d.symbol}`}><Pencil className="h-3 w-3" aria-hidden /> Edit Practice Plan</button>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {chart}
      {group === "READY" && why("Review Why It Confirmed")}
      {group === "CONFIRMED" && why("Learn Why")}
      {group === "FORMING" && why("Learn Pattern")}
      {(group === "EXTENDED" || group === "RETEST") && why("View Original Setup")}
      {group === "RR_STOP" && why("See why")}
      {group === "DATA" && <><RefreshDataButton symbols={[d.symbol]} /><button className={btnSub} onClick={() => focusSymbol(d.symbol, "why")} data-testid={`button-ac-data-${d.symbol}`}><Eye className="h-3 w-3" aria-hidden /> View Data Details</button></>}
      {edit}
      {group !== "NO_TRADE" && <SetAlertButton draft={defaultAlertFor(d, group, effectivePlan(d, ver))} label={group === "DATA" ? "Set Data-Recovery Alert" : "Set Alert"} />}
      {group === "READY" && <button className={btnSub} onClick={journal} data-testid={`button-ac-journal-${d.symbol}`}>Save to Journal</button>}
      {saved && <span className="text-[10.5px] text-slate-gray" role="status">{saved}</span>}
    </div>
  );
}

function Card({ d, group, expiryBars, ver }: { d: SwingDecision; group: ActionGroup; expiryBars: number; ver: ReturnType<typeof activeVersion> }) {
  const t = TONE[group];
  const p = effectivePlan(d, ver);
  const trig = d.currentTrigger ?? d.originalTrigger;
  const planLabel = p.source === "USER" ? `Practice Plan v${p.version} (user-adjusted)` : "System plan";
  return (
    <article className={`rounded-lg border px-3 py-2.5 ${t.box}`} aria-label={`${d.symbol}: ${ACTION_GROUP_LABEL[group]}`} data-testid={`card-ac-${d.symbol}`} data-group={group}>
      <div className="flex flex-wrap items-center gap-2">
        <t.Icon className={`h-4 w-4 ${t.head}`} aria-hidden />
        <span className="font-mono font-bold text-[15px] text-soft-white">{d.symbol}</span>
        <span className={`font-mono font-bold text-[11.5px] ${t.head}`} data-testid={`text-ac-status-${d.symbol}`}>{ACTION_GROUP_LABEL[group]}</span>
        {group === "READY" && <span className="px-1.5 rounded bg-emerald-500 text-[#03130b] text-[10px] font-mono font-bold" data-testid={`badge-practice-available-${d.symbol}`}>PRACTICE PLAN AVAILABLE</span>}
        <span className="text-[10.5px] font-mono text-slate-gray">{GRADE[d.cardGrade] ? `${GRADE[d.cardGrade]} · ` : ""}{d.setupType?.replace(/_/g, " ") ?? "no setup"}{d.setupTimeframe ? ` · ${d.setupTimeframe}` : ""}</span>
        <span className="ml-auto text-[11px] font-mono text-soft-white">{fmt$(d.currentPrice)} <span className="text-slate-gray">· {fmtCT(d.quoteTimestamp)} · {d.dataStatus}</span></span>
      </div>

      {(group === "READY" || group === "RETEST" || group === "EXTENDED" || group === "CONFIRMED") && p.entry != null && (
        <>
          <div className="mt-1 text-[10px] font-mono text-slate-gray" data-testid={`text-ac-plan-source-${d.symbol}`}>{planLabel}{p.source === "USER" ? " — dashed lines on the chart" : ""}</div>
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5 mt-1">
            <Lv k="Entry" v={fmt$(p.entry)} tone="#22c55e" />
            <Lv k="Stop" v={fmt$(p.stop)} tone="#ef4444" />
            <Lv k="Stop limit" v={fmt$(p.stopLimit)} tone="#f87171" />
            <Lv k="Target 1" v={fmt$(p.t1)} tone="#14b8a6" />
            <Lv k="Target 2" v={fmt$(p.t2)} tone="#a855f7" />
            <Lv k="R:R T1" v={p.rrT1 != null ? `${p.rrT1.toFixed(2)}R` : "—"} tone="#cbd5e1" />
            <Lv k="Practice size" v={p.shares != null ? `${p.shares} sh` : "—"} tone="#cbd5e1" />
          </div>
        </>
      )}

      <div className="mt-1.5 text-[11.5px] text-soft-white/90 space-y-0.5">
        {group === "READY" && (
          <div data-testid={`text-ac-why-${d.symbol}`}><span className="font-mono font-bold text-signal-green">WHY THIS CONFIRMS: </span>{d.passedRules.slice(0, 4).join(" · ") || d.nextAction}</div>
        )}
        {group === "CONFIRMED" && (
          <div data-testid={`text-ac-wait-${d.symbol}`}>Waiting for a closed 1H bar above <b className="font-mono">{fmt$(trig)}</b>. Expires after {expiryBars} completed 4H bar{expiryBars === 1 ? "" : "s"}{d.expiryTime ? ` (${fmtCT(d.expiryTime)})` : ""}.</div>
        )}
        {group === "FORMING" && (
          <>
            <div><span className="font-mono text-signal-green">Passed: </span>{d.passedRules.slice(0, 4).join(" · ") || "—"}</div>
            <div><span className="font-mono text-signal-amber">Still needs: </span>{(d.missingConditions.length ? d.missingConditions : d.whyNotReady).slice(0, 3).join(" · ") || "A closed 4H bar to confirm."}</div>
            <div className="font-mono text-[11px]">Estimated trigger {fmt$(trig)}{d.supportZone ? ` · support ${fmt$(d.supportZone.low)}–${fmt$(d.supportZone.high)}` : ""}</div>
          </>
        )}
        {group === "EXTENDED" && (
          <div className="font-mono text-[11px]">Original trigger {fmt$(d.originalTrigger)} · now {d.extensionPercentAboveTrigger != null ? `${d.extensionPercentAboveTrigger.toFixed(1)}% above` : "extended"}{d.retestLevel ? ` · retest zone ${fmt$(d.retestLevel.low)}–${fmt$(d.retestLevel.high)}` : ""}</div>
        )}
        {group === "RETEST" && d.retestLevel && <div className="font-mono text-[11px]">Retest zone {fmt$(d.retestLevel.low)}–{fmt$(d.retestLevel.high)} · trigger {fmt$(trig)}</div>}
        {group === "RR_STOP" && <div>{d.whyNotReady[0] ?? d.riskLabel}</div>}
        {group === "DATA" && (
          <div className="font-mono text-[11px]" data-testid={`text-ac-data-${d.symbol}`}>
            DATA {d.dataStatus} — VERIFY · vendor {d.dataSource ?? "—"} · quote {fmtCT(d.quoteTimestamp)} · last 1H bar {fmtCT(d.lastCompletedBar1H)}
            {d.dataMismatchReason ? ` · ${d.dataMismatchReason}` : ""}
          </div>
        )}
        <div className="text-slate-gray"><span className="font-mono text-[10px] uppercase">Next: </span>{d.nextAction}</div>
      </div>

      {group === "READY" && <div className="mt-1.5 text-[13px] font-bold text-signal-green" data-testid={`text-ac-review-${d.symbol}`}>Review before deciding — practice plan only.</div>}
      <Buttons d={d} group={group} ver={ver} />
    </article>
  );
}

export default function ActionCenter() {
  const req = { selection: "DEFAULT_PLUS_CUSTOM" as ScanSelection, symbols: [], force: 0 };
  const scan = useScan(req);
  const plans = useSelectedPlans();
  const settings = useQuery<SwingSettings>({ queryKey: ["/api/swing/settings"], queryFn: () => swingGet("/api/swing/settings") });
  const [showQuiet, setShowQuiet] = useState(false);
  const rows = sortForActionCenter((scan.data?.rows ?? []).map((r) => r.decision));
  const loud = rows.filter((d) => actionGroupOf(d) !== "NO_TRADE");
  const quiet = rows.filter((d) => actionGroupOf(d) === "NO_TRADE");
  const counts = rows.reduce<Record<string, number>>((m, d) => { const g = actionGroupOf(d); m[g] = (m[g] ?? 0) + 1; return m; }, {});
  const sel = plans.data?.selected;

  return (
    <section className="rounded-lg border border-ink-line bg-ink-panel px-3 py-2.5 space-y-2" aria-label="Action Center" data-testid="action-center">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-bold text-[12px] tracking-wider text-soft-white">ACTION CENTER</span>
        <span className="text-[10.5px] font-mono text-slate-gray" data-testid="text-ac-counts">
          {scan.isLoading ? "Evaluating watchlist…" : `${counts.READY ?? 0} ready · ${counts.CONFIRMED ?? 0} confirmed · ${counts.FORMING ?? 0} forming · ${(counts.RETEST ?? 0) + (counts.EXTENDED ?? 0) + (counts.RR_STOP ?? 0)} watch · ${counts.DATA ?? 0} data · ${counts.NO_TRADE ?? 0} no trade`}
        </span>
        <span className="ml-auto text-[10px] font-mono text-signal-amber">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE</span>
      </div>
      {scan.data?.emptyReason && <div className="text-xs text-signal-amber flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden /> {scan.data.emptyReason}</div>}
      {!scan.isLoading && !loud.length && (
        <div className="rounded border border-ink-line bg-ink-black/40 px-3 py-2 text-[12px] text-soft-white/90" data-testid="text-ac-nothing">
          Nothing ready, confirmed or forming right now. That is a valid answer — no trade is a position. Next conditions are listed below.
        </div>
      )}
      <div className="space-y-2">
        {loud.map((d) => {
          const stale = staleVersion(d, sel);
          return (
            <div key={d.symbol}>
              <Card d={d} group={actionGroupOf(d)} expiryBars={settings.data?.expiryBars4h ?? 2} ver={activeVersion(d, sel)} />
              {stale && <div className="text-[10px] font-mono text-slate-gray mt-0.5 pl-1">Your Plan v{stale.version} was for an older {d.symbol} setup — kept in history, not used.</div>}
            </div>
          );
        })}
      </div>
      {quiet.length > 0 && (
        <div>
          <button className={btnSub} onClick={() => setShowQuiet(!showQuiet)} aria-expanded={showQuiet} data-testid="button-ac-toggle-quiet">
            {showQuiet ? "Hide" : "Show"} no-trade symbols ({quiet.length})
          </button>
          {showQuiet && (
            <ul className="mt-1.5 space-y-1">
              {quiet.map((d) => (
                <li key={d.symbol} className="flex flex-wrap items-baseline gap-2 text-[11.5px]" data-testid={`row-ac-quiet-${d.symbol}`}>
                  <MinusCircle className="h-3 w-3 text-slate-gray self-center" aria-hidden />
                  <span className="font-mono font-bold text-soft-white">{d.symbol}</span>
                  <span className="font-mono text-[10px] text-slate-gray">NO TRADE — NEXT CONDITION</span>
                  <span className="text-slate-gray">{d.nextAction}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <AlertsPanel />
    </section>
  );
}
