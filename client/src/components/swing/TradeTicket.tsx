// Beginner trade card — pinned at the top of the Unified Swing Engine.
// Shows every symbol whose engines are firing (READY_TO_TRADE) as a big card; when
// nothing is firing it shows the focused symbol's potential plan in a muted style.
// Numbers come straight from the shared SwingDecision (never recomputed), except the
// stop-limit price, which is a simple display helper. Practice / analysis only.
import type { SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import { DataVerifyBlock, ReferenceOnlyTag, isUnverified } from "./DataStatus";
import { STATUS_TONE } from "@/lib/swing";
import { Pencil } from "lucide-react";
import { canEditPlan, type PlanVersion } from "@shared/practicePlan";
import { activeVersion, effectivePlan, openPlanEditor } from "@/lib/plans";

const $ = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `$${n.toFixed(2)}`);
/** Limit price for a stop-limit sell: a small cushion under the stop (0.2%, min $0.05). */
export const stopLimitFor = (stop: number | null | undefined) =>
  stop == null ? null : Math.round((stop - Math.max(0.05, stop * 0.002)) * 100) / 100;

export const hasPlan = (d: SwingDecision | undefined) => !!d && d.entryPrice != null && d.structuralStop != null && d.target1 != null;

export function ticketRows(d: SwingDecision, v: PlanVersion | null = null) {
  const p = effectivePlan(d, v);
  const entry = p.entry, stop = p.stop, risk = entry != null && stop != null ? entry - stop : null;
  const pct = (t: number | null) => (t != null && entry ? `+${(((t - entry) / entry) * 100).toFixed(1)}%` : "");
  const r = (t: number | null) => (t != null && risk && risk > 0 ? `${((t - entry!) / risk).toFixed(1)}R` : "");
  return [
    { k: "Entry", v: $(entry), sub: "buy only after a closed 1H above the trigger", tone: "#22c55e", id: "entry" },
    { k: "Stop loss", v: $(stop), sub: risk != null ? `risk ${$(risk)} / share` : "", tone: "#ef4444", id: "stop" },
    { k: "Stop limit", v: $(p.stopLimit ?? stopLimitFor(stop)), sub: "lowest sell price if the stop triggers", tone: "#f87171", id: "stoplimit" },
    { k: "Target 1", v: $(p.t1), sub: [pct(p.t1), r(p.t1)].filter(Boolean).join(" · "), tone: "#14b8a6", id: "t1" },
    { k: "Target 2", v: $(p.t2), sub: [pct(p.t2), r(p.t2)].filter(Boolean).join(" · "), tone: "#a855f7", id: "t2" },
  ];
}

/** Plain-English state line: forming waits for a bar close; extended waits for a retest. */
function StateLine({ d }: { d: SwingDecision }) {
  if (d.setupStatus === "SETUP_FORMING" || d.setupStatus === "SETUP_CONFIRMED") {
    const tf = d.setupStatus === "SETUP_CONFIRMED" ? "1H" : (d.setupTimeframe === "1H" ? "1H" : "4H");
    return <div className="text-[10.5px] font-mono font-bold text-yellow-600 dark:text-yellow-300" data-testid={`ticket-state-${d.symbol}`}>{d.setupStatus === "SETUP_FORMING" ? "SETUP FORMING" : "SETUP CONFIRMED"} — WAIT FOR {tf} BAR CLOSE.</div>;
  }
  if (d.setupStatus === "SIGNAL_EXPIRED") {
    return <div className="text-[10.5px] font-mono" data-testid={`ticket-state-${d.symbol}`}><span className="font-bold text-slate-gray">SIGNAL EXPIRED — OLD SETUP{d.setupTimestamp ? ` FROM ${new Date(d.setupTimestamp).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }).toUpperCase()}` : ""}.</span> <span className="text-slate-gray">Levels below are history only — wait for a new setup.</span></div>;
  }
  if (d.setupStatus === "WATCH_EXTENDED") {
    return (
      <div className="text-[10.5px] font-mono" data-testid={`ticket-state-${d.symbol}`}>
        <span className="font-bold text-orange-600 dark:text-orange-300">WATCH — EXTENDED / AWAIT RETEST.</span>{" "}
        <span className="text-slate-gray">Original trigger {$(d.originalTrigger)} · {d.extensionPercentAboveTrigger != null ? `${d.extensionPercentAboveTrigger.toFixed(1)}%` : "—"} above · {d.extensionAtr != null ? `${d.extensionAtr.toFixed(2)} ATR` : "—"} · retest zone {d.retestLevel ? `${$(d.retestLevel.low)}–${$(d.retestLevel.high)}` : "—"} · needs a closed bullish 1H from the retest zone for a new plan.</span>
      </div>
    );
  }
  return null;
}

function Ticket({ d, firing, active, onFocus, onHover, ver }: { d: SwingDecision; firing: boolean; active: boolean; onFocus: (s: string) => void; onHover: (s: string | null) => void; ver: PlanVersion | null }) {
  const rows = ticketRows(d, ver);
  const unverified = isUnverified(d.dataStatus);
  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onFocus(d.symbol)} onKeyDown={(e) => { if (e.key === "Enter") onFocus(d.symbol); }}
      onMouseEnter={() => onHover(d.symbol)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(d.symbol)} onBlur={() => onHover(null)}
      className={`rounded border px-2.5 py-2 cursor-pointer transition-colors ${firing ? "border-emerald-500/70 bg-emerald-500/[0.07] hover:bg-emerald-500/[0.12]" : "border-ink-line bg-ink-deep/60 hover:border-neon-blue/50"} ${active ? "ring-1 ring-neon-blue/60" : ""}`}
      data-testid={`ticket-${d.symbol}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="font-mono font-bold text-[13px] text-soft-white">{d.symbol}</span>
        <span className={`px-1.5 rounded border text-[10px] font-mono ${STATUS_TONE[d.setupStatus] ?? "border-ink-line"}`}>{firing ? "ENGINES FIRING · " : ""}{STATUS_LABEL[d.setupStatus]}</span>
        {d.setupType && <span className="text-[10.5px] text-slate-gray font-mono">{d.setupType.replace(/_/g, " ")}</span>}
        {ver && <span className="px-1.5 rounded border border-dashed border-neon-blue/70 text-neon-blue text-[10px] font-mono" data-testid={`ticket-version-${d.symbol}`}>PRACTICE PLAN v{ver.version} — USER-ADJUSTED</span>}
        <span className="ml-auto text-[10.5px] font-mono text-slate-gray" data-testid={`ticket-size-${d.symbol}`}>
          {ver ? `≈ ${ver.result.shares} sh · ${$(ver.result.totalRisk)} practice risk` : d.suggestedShares != null ? `≈ ${d.suggestedShares} sh · ${$(d.maxDollarRisk)} max risk` : `${$(d.maxDollarRisk)} max risk`}
        </span>
        {canEditPlan(d) && (
          <button className="inline-flex items-center gap-1 rounded border border-neon-blue/60 px-1.5 text-[10.5px] font-mono text-neon-blue hover:bg-neon-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-blue"
            onClick={(e) => { e.stopPropagation(); openPlanEditor(d.symbol); }} data-testid={`button-ticket-edit-${d.symbol}`}>
            <Pencil className="h-3 w-3" aria-hidden /> Edit Practice Plan
          </button>
        )}
      </div>
      <div className="space-y-1 mb-1.5">
        <StateLine d={d} />
        <DataVerifyBlock d={d} />
        {unverified && <ReferenceOnlyTag />}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        {rows.map((x) => (
          <div key={x.id} className="rounded border bg-[#050a13] px-2 py-1" style={{ borderColor: `${x.tone}66` }} data-testid={`ticket-${d.symbol}-${x.id}`}>
            <div className="text-[9.5px] uppercase tracking-wide font-mono" style={{ color: x.tone }}>{x.k}</div>
            <div className="font-mono font-bold text-[14px]" style={{ color: "#f1f5f9" }}>{x.v}</div>
            {x.sub && <div className="text-[9.5px] leading-tight" style={{ color: "#94a3b8" }}>{x.sub}</div>}
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10.5px]" style={{ color: firing ? "#6ee7b7" : "#cbd5e1" }} data-testid={`ticket-next-${d.symbol}`}>
        {firing ? "Setup confirmed on closed bars — if you practice it, place the order yourself in your broker. " : d.setupStatus === "SIGNAL_EXPIRED" ? "Expired — not a trade. " : "Potential trade — not ready yet. "}
        <span className="text-slate-gray">{d.nextAction}</span>
      </div>
    </div>
  );
}

export default function TradeTicketBar({ loading, firing, focused, active, onFocus, onHover, plans }: {
  loading?: boolean; firing: SwingDecision[]; focused: SwingDecision | undefined; active: string;
  onFocus: (s: string) => void; onHover: (s: string | null) => void; plans?: Record<string, PlanVersion>;
}) {
  const list = firing.filter(hasPlan);
  const showPotential = list.length === 0 && hasPlan(focused);
  if (!list.length && !showPotential && loading) {
    return <div className="rounded border border-ink-line bg-ink-deep/60 px-2.5 py-1.5 text-[11px] text-slate-gray" data-testid="ticket-loading"><span className="font-mono text-soft-white/80">TRADE CARD</span> · Loading {active} levels…</div>;
  }
  if (!list.length && !showPotential) {
    return (
      <div className="rounded border border-ink-line bg-ink-deep/60 px-2.5 py-1.5 text-[11px] text-slate-gray" data-testid="ticket-empty">
        <span className="font-mono text-soft-white/80">TRADE CARD</span> · No engines firing and no plan on {active} yet. A card with entry, stop, stop limit and targets appears here as soon as a setup has levels.
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="ticket-bar">
      <div className="flex items-center gap-2 text-[10.5px] font-mono">
        <span className="text-soft-white font-bold tracking-wider">{list.length ? `TRADE CARD${list.length > 1 ? "S" : ""} · ENGINES FIRING` : "TRADE CARD · POTENTIAL"}</span>
        <span className="text-slate-gray">hover to show levels on the chart · click to focus</span>
      </div>
      {(list.length ? list : [focused!]).map((d) => (
        <Ticket key={d.symbol} d={d} firing={d.setupStatus === "READY_TO_TRADE"} active={d.symbol === active} onFocus={onFocus} onHover={onHover} ver={activeVersion(d, plans)} />
      ))}
      <div className="text-[9.5px] font-mono text-slate-gray">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE (a stop-limit may not fill at all on a gap).</div>
    </div>
  );
}
