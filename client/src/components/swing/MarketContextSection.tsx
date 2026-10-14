// Chart Ecosystem — Part 1: "Market Context" section on the Trading Card.
// Read-only view of the Shared Market Context — it computes nothing itself. The same object feeds the
// chart's indicator lines, so the numbers here always match the chart, scan, alerts and trades.
// Analysis / practice only.
import type { SwingDecision } from "@shared/swingDecision";
import type { EffectivePlan } from "@shared/practicePlan";
import { useMarketContext, useContextUiEnabled, type MarketContext } from "@/lib/marketContext";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { fmtCT } from "@/lib/swing";
import { Section } from "./TradingCard";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const f2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(2));
const TF_LABEL: Record<string, string> = { "1H": "1H", "4H": "4H", D: "Daily" };
const xs = { fontSize: "var(--ac-fs-xs)" } as const, sm = { fontSize: "var(--ac-fs-sm)" } as const;
const grid = (min: number) => ({ display: "grid", gap: "0.5rem", gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` });

/** Keys compared between the card's own plan and the shared context (any difference is shown, never hidden). */
const SYNC_KEYS = ["entry", "stop", "t1", "t2"] as const;
export function contextMismatch(ctx: MarketContext | undefined, d: SwingDecision, p: EffectivePlan): string[] {
  if (!ctx) return [];
  const out: string[] = [];
  if (ctx.panel.status !== d.setupStatus) out.push(`status ${ctx.panel.status} vs ${d.setupStatus}`);
  for (const k of SYNC_KEYS) { const a = ctx.panel[k], b = p[k]; if ((a == null) !== (b == null) || (a != null && b != null && Math.abs(a - b) > 0.005)) out.push(`${k} ${$(a)} vs ${$(b)}`); }
  return out;
}

function Tile({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5" style={{ border: "1px solid var(--ac-border)" }} data-testid={testId}>
      <div className="ac-muted font-semibold" style={xs}>{label}</div>
      <div className="ac-num" style={sm}>{children}</div>
    </div>
  );
}
const vs = (price: number | null, lvl: number | null) => (price == null || lvl == null ? "" : price >= lvl ? "above" : "below");

export function MarketContextSection({ d, p, scope }: { d: SwingDecision; p: EffectivePlan; scope: string }) {
  const [ui] = useContextUiEnabled();
  const [tf, setTf] = usePersistentState<"1H" | "4H" | "D">("ctx-card-tf", "D");
  const q = useMarketContext(d.symbol, tf, { stamp: d.evaluatedAt, enabled: ui });
  if (!ui) return null;
  // Server flag off (ENABLE_MARKET_CONTEXT=false) → no section at all; the card looks exactly as before.
  if (q.isError && /ENABLE_MARKET_CONTEXT|context is off|Unified Swing Engine is off/i.test(String((q.error as Error)?.message ?? ""))) return null;
  const c = q.data, sym = d.symbol;
  const ind = c?.indicators, day = c?.day;
  const mism = contextMismatch(c, d, p);
  const summary = c ? `${TF_LABEL[tf]} · HOD ${$(day?.hod)} · LOD ${$(day?.lod)} · ATR ${f2(ind?.atrDaily)} · RSI ${ind?.rsi != null ? ind.rsi.toFixed(0) : "—"}` : q.isError ? "Context unavailable" : "Loading…";
  return (
    <Section id={`${scope}:context`} title="Market Context" def={false} testId={`sec-context-${sym}`} summary={summary}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" style={xs}>
          <span className="ac-muted">Timeframe</span>
          {(["1H", "4H", "D"] as const).map((t) => (
            <button key={t} className="ac-btn" aria-pressed={tf === t} style={tf === t ? { borderColor: "var(--ac-accent)", color: "var(--ac-accent)" } : undefined}
              onClick={() => setTf(t)} data-testid={`button-ctx-tf-${sym}-${t}`}>{TF_LABEL[t]}</button>
          ))}
          <span className="ac-muted ml-auto" data-testid={`text-ctx-snapshot-${sym}`}>
            {c ? `One shared snapshot · analysis ${fmtCT(c.snapshot.analysisAt ?? c.snapshot.evaluatedAt)} · data ${c.snapshot.dataStatus}` : ""}
          </span>
        </div>
        {q.isError && <div className="ac-bad" style={sm} role="alert" data-testid={`text-ctx-error-${sym}`}>Market context could not load. The card's own levels above are unchanged.</div>}
        {mism.length > 0 && (
          <div className="rounded-lg px-2.5 py-1.5 ac-bad font-semibold" role="alert" style={{ ...sm, border: "1.5px solid var(--ac-bad)" }} data-testid={`alert-ctx-mismatch-${sym}`}>
            Out of sync: {mism.join(" · ")}. Refresh data before using these numbers.
          </div>
        )}
        {c && ind && day && (
          <>
            <div style={grid(170)}>
              <Tile label={`Today's range (${day.state === "LIVE" ? "live" : day.state === "FIXED" ? "fixed at close" : "—"})`} testId={`ctx-day-${sym}`}>
                HOD <b data-testid={`ctx-hod-${sym}`}>{$(day.hod)}</b> · LOD <b data-testid={`ctx-lod-${sym}`}>{$(day.lod)}</b>
              </Tile>
              <Tile label={`Prior day${day.priorDate ? ` (${day.priorDate})` : ""}`} testId={`ctx-prior-${sym}`}>
                PDH <b data-testid={`ctx-pdh-${sym}`}>{$(day.pdh)}</b> · PDL <b data-testid={`ctx-pdl-${sym}`}>{$(day.pdl)}</b>
              </Tile>
              <Tile label={`Trend (${TF_LABEL[tf]} SMAs)`} testId={`ctx-sma-${sym}`}>
                20 <b data-testid={`ctx-sma20-${sym}`}>{$(ind.sma20)}</b> · 50 <b data-testid={`ctx-sma50-${sym}`}>{$(ind.sma50)}</b> · 200 <b data-testid={`ctx-sma200-${sym}`}>{$(ind.sma200)}</b>
                <div className="ac-muted" style={xs}>Price {vs(c.quote.price, ind.sma20)} SMA20{ind.sma50 != null ? `, ${vs(c.quote.price, ind.sma50)} SMA50` : ""}{ind.sma200 != null ? `, ${vs(c.quote.price, ind.sma200)} SMA200` : ""}</div>
              </Tile>
              <Tile label="Momentum" testId={`ctx-momentum-${sym}`}>
                RSI(14) <b data-testid={`ctx-rsi-${sym}`}>{ind.rsi != null ? ind.rsi.toFixed(1) : "—"}</b> · MACD hist <b data-testid={`ctx-macd-hist-${sym}`}>{ind.macd ? ind.macd.hist.toFixed(3) : "—"}</b>
                <div className="ac-muted" style={xs}>MACD {ind.macd ? `${ind.macd.macd.toFixed(3)} / signal ${ind.macd.signal.toFixed(3)}` : "—"}</div>
              </Tile>
              <Tile label="Bollinger (20, 2)" testId={`ctx-bb-${sym}`}>
                {ind.bb ? <>{$(ind.bb.l)} – {$(ind.bb.u)}<div className="ac-muted" style={xs}>mid {$(ind.bb.m)}</div></> : "—"}
              </Tile>
              <Tile label="Volatility · volume" testId={`ctx-atr-${sym}`}>
                Daily ATR <b data-testid={`ctx-atr-daily-${sym}`}>{f2(ind.atrDaily)}</b>{tf !== "D" ? <> · {TF_LABEL[tf]} ATR {f2(ind.atr)}</> : null}
                <div className="ac-muted" style={xs}>Latest bar volume (may still be forming) {ind.volRatio != null ? `${ind.volRatio.toFixed(2)}× the 20-bar average` : "—"}</div>
              </Tile>
            </div>
            <div style={grid(220)}>
              <Tile label="Nearest resistance (top 3)" testId={`ctx-res-${sym}`}>
                {c.sr.above.length ? c.sr.above.map((l) => <div key={`${l.source}${l.price}`}>{$(l.price)} <span className="ac-muted" style={xs}>{l.source === "PIVOT" ? `strength ${l.strength} · ${l.label}` : l.label}</span></div>) : <span className="ac-muted">None found in view</span>}
              </Tile>
              <Tile label="Nearest support (top 3)" testId={`ctx-sup-${sym}`}>
                {c.sr.below.length ? c.sr.below.map((l) => <div key={`${l.source}${l.price}`}>{$(l.price)} <span className="ac-muted" style={xs}>{l.source === "PIVOT" ? `strength ${l.strength} · ${l.label}` : l.label}</span></div>) : <span className="ac-muted">None found in view</span>}
              </Tile>
              <Tile label={`Levels every panel uses · ${c.plan.label}${d.setupStatus === "SIGNAL_EXPIRED" || d.setupStatus === "NO_SETUP" ? " · reference only (not tradeable)" : ""}`} testId={`ctx-plan-${sym}`}>
                Entry <b data-testid={`ctx-entry-${sym}`}>{$(c.panel.entry)}</b> · Stop <b data-testid={`ctx-stop-${sym}`}>{$(c.panel.stop)}</b> · T1 <b data-testid={`ctx-t1-${sym}`}>{$(c.panel.t1)}</b> · T2 <b data-testid={`ctx-t2-${sym}`}>{$(c.panel.t2)}</b>
                <div className="ac-muted" style={xs}>{c.trade ? `Practice trade #${c.trade.id} ${c.trade.status.toLowerCase()} · ` : ""}{c.alerts.length ? `${c.alerts.length} alert level${c.alerts.length === 1 ? "" : "s"}` : "no alert levels"}</div>
              </Tile>
            </div>
            <div className="ac-muted" style={xs}>Support/resistance are pivot clusters (within 0.5%) plus the prior-day high/low. Strength combines touches and recency. They are reference levels, not predictions. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.</div>
          </>
        )}
      </div>
    </Section>
  );
}
