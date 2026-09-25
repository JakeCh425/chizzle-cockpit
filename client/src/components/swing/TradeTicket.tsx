// Beginner trade card — pinned at the top of the Unified Swing Engine.
// Shows every symbol whose engines are firing (READY_TO_TRADE) as a big card; when
// nothing is firing it shows the focused symbol's potential plan in a muted style.
// Numbers come straight from the shared SwingDecision (never recomputed), except the
// stop-limit price, which is a simple display helper. Practice / analysis only.
import type { SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import { STATUS_TONE } from "@/lib/swing";

const $ = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `$${n.toFixed(2)}`);
/** Limit price for a stop-limit sell: a small cushion under the stop (0.2%, min $0.05). */
export const stopLimitFor = (stop: number | null | undefined) =>
  stop == null ? null : Math.round((stop - Math.max(0.05, stop * 0.002)) * 100) / 100;

export const hasPlan = (d: SwingDecision | undefined) => !!d && d.entryPrice != null && d.structuralStop != null && d.target1 != null;

export function ticketRows(d: SwingDecision) {
  const entry = d.entryPrice, stop = d.structuralStop, risk = entry != null && stop != null ? entry - stop : null;
  const pct = (t: number | null) => (t != null && entry ? `+${(((t - entry) / entry) * 100).toFixed(1)}%` : "");
  const r = (t: number | null) => (t != null && risk && risk > 0 ? `${((t - entry!) / risk).toFixed(1)}R` : "");
  return [
    { k: "Entry", v: $(entry), sub: "buy only after a closed 1H above the trigger", tone: "#22c55e", id: "entry" },
    { k: "Stop loss", v: $(stop), sub: risk != null ? `risk ${$(risk)} / share` : "", tone: "#ef4444", id: "stop" },
    { k: "Stop limit", v: $(stopLimitFor(stop)), sub: "lowest sell price if the stop triggers", tone: "#f87171", id: "stoplimit" },
    { k: "Target 1", v: $(d.target1), sub: [pct(d.target1), r(d.target1)].filter(Boolean).join(" · "), tone: "#14b8a6", id: "t1" },
    { k: "Target 2", v: $(d.target2), sub: [pct(d.target2), r(d.target2)].filter(Boolean).join(" · "), tone: "#a855f7", id: "t2" },
  ];
}

function Ticket({ d, firing, active, onFocus, onHover }: { d: SwingDecision; firing: boolean; active: boolean; onFocus: (s: string) => void; onHover: (s: string | null) => void }) {
  const rows = ticketRows(d);
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
        <span className="ml-auto text-[10.5px] font-mono text-slate-gray" data-testid={`ticket-size-${d.symbol}`}>
          {d.suggestedShares != null ? `≈ ${d.suggestedShares} sh · ${$(d.maxDollarRisk)} max risk` : `${$(d.maxDollarRisk)} max risk`}
        </span>
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
        {firing ? "Setup confirmed on closed bars — if you practice it, place the order yourself in your broker. " : "Potential trade — not ready yet. "}
        <span className="text-slate-gray">{d.nextAction}</span>
      </div>
    </div>
  );
}

export default function TradeTicketBar({ loading, firing, focused, active, onFocus, onHover }: {
  loading?: boolean; firing: SwingDecision[]; focused: SwingDecision | undefined; active: string;
  onFocus: (s: string) => void; onHover: (s: string | null) => void;
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
        <Ticket key={d.symbol} d={d} firing={d.setupStatus === "READY_TO_TRADE"} active={d.symbol === active} onFocus={onFocus} onHover={onHover} />
      ))}
      <div className="text-[9.5px] font-mono text-slate-gray">PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE (a stop-limit may not fill at all on a gap).</div>
    </div>
  );
}
