// Part 5 — locked card for a symbol with an ARMED/ACTIVE practice trade. Levels come from the trade (one source of
// truth) and are read-only here; the engine's fresh decision is shown only as an "Engine now says…" info chip.
// Collapsed by default to one line; the choice is remembered (chizzle/v2/ via the Action Center disclosure store).
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { ChevronDown, ChevronRight, Info, LineChart, Lock, Maximize2, Pencil, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import type { SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import { effectivePlan, type PlanVersion } from "@shared/practicePlan";
import { editedFields, engineNowSays, lockedPriceWarning, unrealizedR, type SwingTrade } from "@shared/swingTrades";
import { useDisclosure } from "./TradingCard";
import { focusSymbol } from "@/lib/plans";
import { openTradeDialog } from "@/lib/swingTrades";
import { fmtCT } from "@/lib/swing";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rTxt = (r: number | null) => (r == null ? "—" : `${r > 0 ? "+" : ""}${r.toFixed(2)}R`);

export function LockedTradeCard({ trade: t, d, ver, price, onOpen }: { trade: SwingTrade; d: SwingDecision | null; ver: PlanVersion | null; price: number | null; onOpen?: () => void }) {
  const [open, setOpen] = useDisclosure(`locked:${t.id}`, false);
  const px = price ?? d?.currentPrice ?? null;
  const uR = t.status === "ACTIVE" ? unrealizedR(t, px) : null;
  const plannedR = t.rrT1;
  const engine = d ? effectivePlan(d, ver) : null;
  const says = engineNowSays(t, engine ? { entry: engine.entry, stop: engine.stop, t1: engine.t1, t2: engine.t2 } : null);
  const warn = lockedPriceWarning(t, px);
  const edited = editedFields(t);
  const tone = t.status === "ACTIVE" ? "var(--ac-good)" : "var(--ac-accent)";
  const sm = { fontSize: "var(--ac-fs-sm)" } as const, xs = { fontSize: "var(--ac-fs-xs)" } as const;
  return (
    <article className="ac-card rounded-2xl overflow-hidden" style={{ borderLeft: `5px solid ${tone}` }} aria-label={`${t.symbol} locked practice trade (${t.status})`}
      data-testid={`card-locked-${t.symbol}`} data-status={t.status} data-open={open}>
      {/* One-line row: ticker · badge · entry · stop · T1 · price · unrealized R */}
      <div className="px-3 py-2 sm:px-4 flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid={`row-locked-${t.symbol}`}>
        <button className="ac-btn !px-1.5 !py-0.5" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${t.symbol} locked card`} data-testid={`button-toggle-locked-${t.symbol}`}>
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
        <span className="ac-num font-extrabold leading-none tracking-tight" style={{ fontSize: "calc(var(--ac-ticker) * 0.85)" }}>{t.symbol}</span>
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-bold whitespace-nowrap" style={{ ...xs, color: tone, border: `1.5px solid ${tone}` }} data-testid={`badge-locked-${t.symbol}`}>
          <Lock className="h-3.5 w-3.5" aria-hidden /> {t.status}{t.status === "ACTIVE" && t.fillPrice != null ? ` @ ${$(t.fillPrice)}` : ""}
        </span>
        <span className="ac-num flex flex-wrap items-center gap-x-2.5" style={sm} data-testid={`text-locked-levels-${t.symbol}`}>
          <span>Entry <b>{$(t.entry)}</b></span><span className="ac-muted">|</span>
          <span>Stop <b>{$(t.stop)}</b></span><span className="ac-muted">|</span>
          <span>T1 <b>{$(t.t1)}</b></span>
        </span>
        <span className="ml-auto ac-num font-bold" style={{ fontSize: "calc(var(--ac-fs) * 1.1)" }} data-testid={`text-locked-price-${t.symbol}`}>{$(px)}</span>
        <span className={`ac-num font-bold ${uR == null ? "ac-muted" : uR >= 0 ? "ac-good" : "ac-bad"}`} style={sm} title={t.status === "ACTIVE" ? "Unrealized R vs your fill and stop" : "Not filled yet — planned R to T1"} data-testid={`text-locked-r-${t.symbol}`}>
          {t.status === "ACTIVE" ? rTxt(uR) : `plan ${plannedR != null ? `${plannedR}R` : "—"}`}
        </span>
        <button className="ac-btn !py-1" onClick={() => openTradeDialog({ mode: "edit", trade: t, decision: d })} data-testid={`button-locked-edit-${t.symbol}`}><Pencil className="h-4 w-4" aria-hidden /> Edit</button>
      </div>
      {/* Critical lines never collapse: price past stop/T1, engine disagreement, practice label. */}
      {(warn || says.text) && (
        <div className="px-3 pb-1.5 sm:px-4 pl-12 flex flex-wrap items-center gap-x-3 gap-y-0.5" style={xs}>
          {warn && <span className="ac-bad font-semibold inline-flex items-center gap-1" role="alert" data-testid={`text-locked-warn-${t.symbol}`}><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {warn}</span>}
          {says.text && <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 ac-muted" style={{ border: "1px solid var(--ac-border)" }} data-testid={`chip-engine-says-${t.symbol}`}><Info className="h-3.5 w-3.5" aria-hidden /> {says.text}</span>}
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 sm:px-4 pl-12 space-y-1.5" data-testid={`body-locked-${t.symbol}`}>
          <div className="ac-warn font-semibold" style={xs}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
          <div className="ac-num flex flex-wrap gap-x-4 gap-y-0.5" style={sm}>
            <span>Stop limit <b>{$(t.stopLimit)}</b></span><span>T2 <b>{$(t.t2)}</b></span><span>Shares <b>{t.shares}</b></span><span>$ at risk <b>{$(t.riskDollars)}</b></span>
            <span>R:R to T1 <b>{t.rrT1 != null ? `${t.rrT1}R` : "—"}</b></span>
            {t.timeframe && <span>TF <b>{t.timeframe}</b></span>}{t.setupType && <span className="ac-muted">{t.setupType}</span>}
          </div>
          <div className="ac-muted flex flex-wrap gap-x-3" style={xs}>
            <span><Lock className="inline h-3 w-3 mr-1 align-[-1px]" aria-hidden />Levels locked to practice trade #{t.id} (armed {fmtCT(t.armedAt)}). The engine cannot change them; use Edit.</span>
            {edited.length > 0 && <span className="ac-warn">Edited from engine: {edited.join(", ")}</span>}
            {t.overrideReason && <span className="ac-warn">Override: {t.overrideReason}</span>}
          </div>
          {d && (
            <div className="ac-num flex flex-wrap items-center gap-x-3" style={xs} data-testid={`text-locked-engine-${t.symbol}`}>
              <span className="ac-muted">Engine view: <b>{STATUS_LABEL[d.setupStatus] ?? d.setupStatus}</b>{d.dataStatus !== "LIVE" ? ` · data ${d.dataStatus}` : ""}</span>
              {engine && engine.entry != null && <span className="ac-muted">entry {$(engine.entry)} · stop {$(engine.stop)} · T1 {$(engine.t1)}{engine.t2 != null ? ` · T2 ${$(engine.t2)}` : ""}</span>}
            </div>
          )}
          {t.notes && <div className="ac-muted" style={xs}>{t.notes}</div>}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button className="ac-btn ac-btn-primary" onClick={() => openTradeDialog({ mode: "edit", trade: t, decision: d })} data-testid={`button-locked-edit-body-${t.symbol}`}><Pencil className="h-4 w-4" aria-hidden /> Edit trade</button>
            {d && onOpen && <button className="ac-btn" onClick={onOpen} data-testid={`button-locked-open-card-${t.symbol}`}><Maximize2 className="h-4 w-4" aria-hidden /> Open Trading Card (read-only)</button>}
            <button className="ac-btn" onClick={() => focusSymbol(t.symbol)} data-testid={`button-locked-chart-${t.symbol}`}><LineChart className="h-4 w-4" aria-hidden /> Open Chart</button>
            <Link href="/trades" className="ac-btn" data-testid={`link-locked-my-trades-${t.symbol}`}>My Trades</Link>
          </div>
        </div>
      )}
    </article>
  );
}
