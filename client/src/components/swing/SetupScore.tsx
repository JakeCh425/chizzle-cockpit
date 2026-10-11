// Setup Score UI — the Swing Setup Board's 0–100 score inside the cockpit (ENABLE_SETUP_SCORE).
// Information only: the score ranks setups; Ready, levels and locked trades still come from the engine.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { Gauge, Maximize2 } from "lucide-react";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import { rankScores, SCORE_RULES as R, type SetupScore } from "@shared/setupScore";
import { Section } from "./TradingCard";
import { saveSwingSettings } from "./PlanRefresh";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const xs = { fontSize: "var(--ac-fs-xs)" } as const, sm = { fontSize: "var(--ac-fs-sm)" } as const;
const toneOf = (s: SetupScore) => (s.error ? "var(--ac-bad)" : s.grade === "PRIORITY" ? "var(--ac-good)" : s.grade === "WATCH" ? "var(--ac-accent)" : "var(--ac-muted)");
const pts = (v: number, max: number) => `${Math.round(v)}/${max}`;
export const SCORE_NOTE = "Score ranks setups only — Ready still comes from the engine's rules.";

/** Compact chip for card headers and collapsed rows. */
export function ScoreChip({ d }: { d: SwingDecision }) {
  const s = d.setupScore;
  if (!s) return null;
  const tone = toneOf(s);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ac-num whitespace-nowrap" style={{ ...xs, color: tone, border: `1.5px solid ${tone}` }}
      title={`Setup Score ${s.score}/100 — Trend ${pts(s.trendPts, R.TREND_MAX)} · Volume ${pts(s.volumePts, R.VOLUME_MAX)} · R:R ${pts(s.rrPts, R.RR_MAX)}. ${SCORE_NOTE}`}
      data-testid={`chip-score-${d.symbol}`} data-score={s.score}>
      <Gauge className="h-3.5 w-3.5" aria-hidden /> {s.error ? "Score n/a" : `Score ${s.score} · ${s.grade}`}
    </span>
  );
}

function Bar({ v, max, tone }: { v: number; max: number; tone: string }) {
  return (
    <span className="inline-block h-1.5 w-16 rounded-full align-middle" style={{ background: "var(--ac-border)" }} aria-hidden>
      <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: tone }} />
    </span>
  );
}

/** Full breakdown inside the Trading Card. */
export function ScoreSection({ d, scope }: { d: SwingDecision; scope: string }) {
  const s = d.setupScore;
  if (!s) return null;
  const tone = toneOf(s);
  return (
    <Section id={`${scope}:score`} title="Setup Score" def={false} testId={`sec-score-${d.symbol}`}
      summary={s.error ? `n/a — ${s.error}` : `${s.score}/100 · ${s.grade} · Trend ${pts(s.trendPts, R.TREND_MAX)} · Volume ${pts(s.volumePts, R.VOLUME_MAX)} · R:R ${pts(s.rrPts, R.RR_MAX)}`}>
      <div className="space-y-2" style={sm}>
        <div className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          <div><b>Trend (Daily)</b> <Bar v={s.trendPts} max={R.TREND_MAX} tone={tone} /> <span className="ac-num">{pts(s.trendPts, R.TREND_MAX)}</span>
            <div className="ac-muted ac-num" style={xs}>close {$(s.lastClose)} · 10 EMA {$(s.ema10)} · 20 EMA {$(s.ema20)}</div></div>
          <div><b>Volume</b> <Bar v={s.volumePts} max={R.VOLUME_MAX} tone={tone} /> <span className="ac-num">{pts(s.volumePts, R.VOLUME_MAX)}</span>
            <div className="ac-muted ac-num" style={xs}>{s.volRatio != null ? `${s.volRatio.toFixed(2)}× prior-20 average (needs ${R.VOL_MULT_REQ}×)` : "no trigger candle yet"}</div></div>
          <div><b>Reward-to-risk</b> <Bar v={s.rrPts} max={R.RR_MAX} tone={tone} /> <span className="ac-num">{pts(s.rrPts, R.RR_MAX)}</span>
            <div className="ac-muted ac-num" style={xs}>{s.rr != null ? `${s.rr.toFixed(2)} : 1 to ceiling ${$(s.resistance)} (needs ${R.RR_REQ} : 1)` : s.trigger ? "no overhead ceiling to measure" : "no trigger candle yet"}</div></div>
        </div>
        {s.trigger && (
          <div className="ac-num flex flex-wrap gap-x-4 gap-y-0.5" data-testid={`text-score-levels-${d.symbol}`}>
            <span>Trigger <b>{s.trigger}</b> ({s.timeframe})</span><span>Score entry <b>{$(s.entry)}</b></span>
            <span>Pattern low <b>{$(s.patternLow)}</b></span><span>Score stop <b>{$(s.stop)}</b> <span className="ac-muted">(low − {R.STOP_ATR_MULT}×ATR {$(s.atr)})</span></span>
            <span className="ac-muted">{s.status}</span>
          </div>
        )}
        <ul className="ac-muted list-disc pl-5" style={xs}>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <div className="ac-muted" style={xs}>
          Setup Board rules: Hammer or Bullish Engulfing near the 10/20 EMA in the last {R.TRIGGER_LOOKBACK} closed {s.timeframe} bars · score entry = trigger high · score stop = pattern low − {R.STOP_ATR_MULT}×ATR(14).
          The score's entry/stop are for scoring only; the card's plan levels above are the engine's. {SCORE_NOTE}
        </div>
      </div>
    </Section>
  );
}

/** Ranked list of every scanned symbol — "RANK #1 SEED" first. */
export function PriorityBoard({ rows, settings, onOpen }: { rows: SwingDecision[]; settings: SwingSettings | undefined; onOpen: (sym: string) => void }) {
  const scored = rankScores(rows.filter((d) => d.setupScore));
  if (!scored.length) return null;
  const tf = settings?.scoreTimeframe ?? "Daily", strict = !!settings?.scoreStrict;
  const top = scored.slice(0, 3).map((d, i) => `#${i + 1} ${d.symbol} ${d.setupScore!.error ? "n/a" : d.setupScore!.score}`).join(" · ");
  return (
    <Section id="priority-board" title="Setup Priority Board" def={false} testId="sec-priority-board" summary={top}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1" style={xs}>
          <label className="inline-flex items-center gap-1.5"><span className="font-semibold">Trigger timeframe</span>
            <select className="ac-input !w-auto !py-0.5" style={xs} value={tf} onChange={(e) => void saveSwingSettings({ scoreTimeframe: e.target.value as any })} data-testid="select-score-timeframe">
              <option value="Daily">Daily</option><option value="4H">4H</option><option value="1H">1H</option>
            </select></label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={strict} onChange={(e) => void saveSwingSettings({ scoreStrict: e.target.checked })} data-testid="check-score-strict" />
            <span>Strict scoring (all-or-nothing)</span></label>
          <span className="ac-muted">Trend {R.TREND_MAX} · Volume ≥{R.VOL_MULT_REQ}× → {R.VOLUME_MAX} · R:R ≥{R.RR_REQ}:1 → {R.RR_MAX} · trend always Daily · closed candles only</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full ac-num" style={sm} data-testid="table-priority-board">
            <thead className="ac-muted text-left" style={xs}>
              <tr><th className="py-1 pr-3">Rank</th><th className="pr-3">Ticker</th><th className="pr-3">Score</th><th className="pr-3">Trend</th><th className="pr-3">Volume</th><th className="pr-3">R:R</th><th className="pr-3">Trigger</th><th className="pr-3">Score entry / stop</th><th className="pr-3">Engine status</th><th /></tr>
            </thead>
            <tbody>
              {scored.map((d, i) => { const s = d.setupScore!, tone = toneOf(s); return (
                <tr key={d.symbol} className="border-t" style={{ borderColor: "var(--ac-border)" }} data-testid={`row-priority-${d.symbol}`}>
                  <td className="py-1.5 pr-3 font-bold whitespace-nowrap" data-testid={`text-rank-${d.symbol}`}>RANK #{i + 1} SEED</td>
                  <td className="pr-3 font-extrabold">{d.symbol}</td>
                  <td className="pr-3 whitespace-nowrap"><Bar v={s.score} max={100} tone={tone} /> <b style={{ color: tone }}>{s.error ? "n/a" : s.score}</b> <span className="ac-muted" style={xs}>{s.error ? s.error : s.grade}</span></td>
                  <td className="pr-3">{pts(s.trendPts, R.TREND_MAX)}</td>
                  <td className="pr-3 whitespace-nowrap">{pts(s.volumePts, R.VOLUME_MAX)}{s.volRatio != null && <span className="ac-muted" style={xs}> {s.volRatio.toFixed(2)}×</span>}</td>
                  <td className="pr-3 whitespace-nowrap">{pts(s.rrPts, R.RR_MAX)}{s.rr != null && <span className="ac-muted" style={xs}> {s.rr.toFixed(2)}:1</span>}</td>
                  <td className="pr-3 whitespace-nowrap">{s.trigger ?? "—"}{s.trigger && <span className="ac-muted" style={xs}> · {s.status}</span>}</td>
                  <td className="pr-3 whitespace-nowrap">{s.entry != null ? `${$(s.entry)} / ${$(s.stop)}` : "—"}</td>
                  <td className="pr-3 ac-muted whitespace-nowrap" style={xs}>{d.setupStatus.replace(/_/g, " ").toLowerCase()}</td>
                  <td><button className="ac-btn !py-0.5" style={xs} onClick={() => onOpen(d.symbol)} data-testid={`button-priority-open-${d.symbol}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden /> Card</button></td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <div className="ac-muted" style={xs}>PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · {SCORE_NOTE} · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.</div>
      </div>
    </Section>
  );
}
