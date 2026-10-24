// Setup Score UI — the Swing Setup Board's 0–100 score inside the cockpit (ENABLE_SETUP_SCORE).
// Information only: the score ranks setups; Ready, levels and locked trades still come from the engine.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { Gauge, Maximize2 } from "lucide-react";
import type { SwingDecision, SwingSettings } from "@shared/swingDecision";
import { rankScores, SCORE_RULES as R, SCORE_BANDS, scoreBandOf, scoreBadgeText, scoreLabel, type SetupScore } from "@shared/setupScore";
import { freshnessOf } from "@shared/cardFreshness";
import { Section } from "./TradingCard";
import { saveSwingSettings } from "./PlanRefresh";

const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const xs = { fontSize: "var(--ac-fs-xs)" } as const, sm = { fontSize: "var(--ac-fs-sm)" } as const;
// Never bright green: a high score alone is not Ready (the card's freshness + engine status decide).
const BAND_TONE = { MEETS: "var(--ac-accent)", CLOSE: "var(--ac-warn)", NOT_YET: "var(--ac-muted)" } as const;
const toneOf = (s: SetupScore) => (s.error ? "var(--ac-bad)" : BAND_TONE[scoreBandOf(s.score)]);
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
      <Gauge className="h-3.5 w-3.5" aria-hidden /> {s.error ? "Score n/a" : scoreBadgeText(s.score)}
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
      summary={s.error ? `n/a — ${s.error}` : `${s.score}/100 · ${scoreLabel(s.score)} · Trend ${pts(s.trendPts, R.TREND_MAX)} · Volume ${pts(s.volumePts, R.VOLUME_MAX)} · R:R ${pts(s.rrPts, R.RR_MAX)}`}>
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
        <div style={xs} data-testid={`text-score-legend-${d.symbol}`}><b>Key:</b> 75–100 Meets requirements · 60–74 Close — 1–2 requirements missing · 0–59 Doesn't pass requirements yet · full key on the Setup Priority Board.</div>
        <ul className="ac-muted list-disc pl-5" style={xs}>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <div className="ac-muted" style={xs}>
          Setup Board rules: Hammer or Bullish Engulfing near the 10/20 EMA in the last {R.TRIGGER_LOOKBACK} closed {s.timeframe} bars · score entry = trigger high · score stop = pattern low − {R.STOP_ATR_MULT}×ATR(14).
          The score's entry/stop are for scoring only; the card's plan levels above are the engine's. {SCORE_NOTE}
        </div>
      </div>
    </Section>
  );
}

const GRADES: { band: string; grade: string; tone: string; text: string }[] = [
  ...SCORE_BANDS.map((b) => ({ band: b.range, grade: b.label, tone: BAND_TONE[b.band], text: b.text })),
  { band: "n/a", grade: "Not enough data", tone: "var(--ac-bad)", text: "Not enough closed bars to score. It re-checks on the next refresh." },
];
const STATUSES: [string, string][] = [
  ["NO SETUP", "No Hammer / Bullish Engulfing near the EMAs in the last 5 closed bars. Only trend points count (max 40)."],
  ["AWAITING BREAK", "Trigger candle found. Its high is the score entry; nothing has closed above it yet."],
  ["TRIGGERED", "A close is already above the trigger high. Don't chase if price is extended."],
  ["TARGET REACHED", "Price already reached the ceiling — little reward left in this setup."],
  ["INVALIDATED", "A close fell below the score stop. R:R points are set to 0."],
];

/** "How to read the score" key — grades, points, trigger statuses, and how to use the board. */
export function ScoreKey() {
  const box = { border: "1px solid var(--ac-border)" } as const;
  return (
    <Section id="priority-board:key" title="Score Key — how to read and use it" def={false} testId="sec-score-key"
      summary="75–100 Meets requirements · 60–74 Close · 0–59 Doesn't pass requirements yet · Trend 40 + Volume 30 + R:R 30">
      <div className="grid gap-3" style={{ ...sm, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
        <div className="rounded-xl p-3 space-y-1.5" style={box} data-testid="key-grades">
          <div className="font-bold">What each score means</div>
          {GRADES.map((g) => (
            <div key={g.grade} className="flex gap-2 items-start" data-testid={`key-grade-${g.band}`}>
              <span className="ac-num font-bold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ ...xs, color: g.tone, border: `1.5px solid ${g.tone}` }}>{g.band} {g.grade}</span>
              <span>{g.text}</span>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-3 space-y-1.5" style={box} data-testid="key-points">
          <div className="font-bold">How the 100 points add up</div>
          <div><b>Trend · {R.TREND_MAX}</b> — last closed <b>Daily</b> close above the 10 and 20 EMA, with the 10 above the 20. Partial: EMAs stacked but close under the 10 = 20; close above the 20 only = 10.</div>
          <div><b>Volume · {R.VOLUME_MAX}</b> — trigger candle volume ≥ {R.VOL_MULT_REQ}× its prior 20-bar average. From 1.0× to {R.VOL_MULT_REQ}× scales 0 → {R.VOLUME_MAX}.</div>
          <div><b>Reward-to-risk · {R.RR_MAX}</b> — (ceiling − score entry) ÷ (score entry − score stop) ≥ {R.RR_REQ} : 1. From 1.0 to {R.RR_REQ} scales 0 → {R.RR_MAX}. No ceiling found = 0.</div>
          <div className="ac-muted">Score stop = pattern low − {R.STOP_ATR_MULT} × ATR(14). Ceiling = nearest daily swing high above entry (else the 52-week high). <b>Strict</b> makes each block all-or-nothing, so scores land on 0, 30, 40, 60, 70 or 100.</div>
        </div>
        <div className="rounded-xl p-3 space-y-1.5" style={box} data-testid="key-statuses">
          <div className="font-bold">Trigger status</div>
          {STATUSES.map(([k, v]) => <div key={k}><b className="ac-num">{k}</b> — {v}</div>)}
        </div>
        <div className="rounded-xl p-3 space-y-1.5" style={box} data-testid="key-howto">
          <div className="font-bold">How to use the board</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Start at <b>RANK #1 SEED</b> and press <b>Card</b> to open it.</li>
            <li>Check the card's engine status. <b>Ready still comes from the engine</b> — a high score alone is not Ready.</li>
            <li>Open <b>Setup Score</b> on the card to see what's missing (for example Volume 0/30 = a light trigger candle).</li>
            <li><b>Trigger timeframe:</b> Daily is the slower swing view. 4H and 1H find earlier triggers with tighter stops, so scores can be higher; trend is always judged on Daily.</li>
            <li>A 40 with no trigger means the trend is good but there's no entry candle yet — wait for one.</li>
          </ol>
          <div className="ac-muted" style={xs}>Scores use closed candles only and are not predictions or guaranteed targets. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.</div>
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
  const topChips = (
    <div className="flex flex-wrap items-center gap-2" data-testid="priority-board-chips">
      {scored.slice(0, 3).map((d, i) => (
        <span
          key={d.symbol}
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.2)] backdrop-blur-sm cursor-pointer hover:scale-105 transition-transform" onClick={() => onOpen(d.symbol)}
          data-testid={`chip-priority-${d.symbol}`}
        >
          <span className="font-bold text-slate-400">#{i + 1}</span>
          <span className="font-bold text-soft-white">{d.symbol}</span>
          <span className="font-mono font-bold text-emerald-400">{d.setupScore!.error ? "n/a" : d.setupScore!.score}</span>
        </span>
      ))}
    </div>
  );
  return (
    <Section
      id="priority-board"
      title="Setup Priority Board"
      def={false}
      testId="sec-priority-board"
      headerClassName="bg-gradient-to-r from-ink-deep/50 to-transparent hover:from-ink-deep/70"
      className="border-cyan-500/20 bg-ink-black/60 backdrop-blur-md shadow-[0_0_15px_rgba(34,211,238,0.06)]"
      summary={topChips}
    >
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
        <ScoreKey />
        <div className="overflow-x-auto">
          <table className="w-full ac-num" style={sm} data-testid="table-priority-board">
            <thead className="ac-muted text-left" style={xs}>
              <tr><th className="py-1 pr-3">Rank</th><th className="pr-3">Ticker</th><th className="pr-3">Score</th><th className="pr-3">Trend</th><th className="pr-3">Volume</th><th className="pr-3">R:R</th><th className="pr-3">Trigger</th><th className="pr-3">Score entry / stop</th><th className="pr-3">Engine status</th><th /></tr>
            </thead>
            <tbody>
              {scored.map((d, i) => { const s = d.setupScore!, tone = toneOf(s); return (
                <tr key={d.symbol} className="border-t border-ink-line/50 hover:bg-white/[0.04] cursor-pointer transition-colors" onClick={() => onOpen(d.symbol)} data-testid={`row-priority-${d.symbol}`}>
                  <td className="py-2 pr-3 font-mono font-bold whitespace-nowrap text-cyan-400 text-xs" data-testid={`text-rank-${d.symbol}`}>RANK #{i + 1} SEED</td>
                  <td className="pr-3 font-mono font-black text-sm text-soft-white">{d.symbol}</td>
                  <td className="pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 shadow-sm font-mono text-[11px]">
                      <Bar v={s.score} max={100} tone={tone} />
                      <b style={{ color: tone }}>{s.error ? "n/a" : s.score}</b>
                      <span className="text-slate-400 uppercase tracking-wider text-[9px]">{s.error ? s.error : scoreLabel(s.score)}</span>
                    </span>
                  </td>
                  <td className="pr-3">
                    <span className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10.5px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.15)]">
                      {pts(s.trendPts, R.TREND_MAX)}
                    </span>
                  </td>
                  <td className="pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10.5px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.15)]">
                      {pts(s.volumePts, R.VOLUME_MAX)}
                      {s.volRatio != null && <span className="text-[9.5px] text-slate-400 font-normal">({s.volRatio.toFixed(1)}×)</span>}
                    </span>
                  </td>
                  <td className="pr-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-950/40 px-2 py-0.5 font-mono text-[10.5px] font-bold text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.15)]">
                      {pts(s.rrPts, R.RR_MAX)}
                      {s.rr != null && <span className="text-[9.5px] text-slate-400 font-normal">({s.rr.toFixed(1)}:1)</span>}
                    </span>
                  </td>
                  <td className="pr-3 min-w-[150px] leading-snug font-mono text-xs text-soft-white">{s.trigger ?? "—"}{s.trigger && <span className="text-slate-400 text-[10px]"> · {s.status}</span>}</td>
                  <td className="pr-3 whitespace-nowrap font-mono text-xs tabular-nums text-slate-300">{s.entry != null ? `${$(s.entry)} / ${$(s.stop)}` : "—"}</td>
                  <td className="pr-3 min-w-[180px] max-w-[260px] leading-snug font-mono" style={xs} data-testid={`text-priority-status-${d.symbol}`}>{(() => {
                    const f = freshnessOf(d, { minRrT1: settings?.minRrT1 ?? 2, expiryBars4h: settings?.expiryBars4h ?? 2 });
                    if (f.isTradeable || !f.hasLevels && d.setupStatus === "NO_SETUP") return <span className="text-slate-400">{d.setupStatus.replace(/_/g, " ").toLowerCase()}</span>;
                    return <span className="font-semibold text-amber-300" title={f.displayStatus}>{f.displayStatus.replace(/^NOT TRADEABLE( YET)?/, (m) => m === "NOT TRADEABLE YET" ? "Not tradeable yet" : "Not tradeable")}</span>;
                  })()}</td>
                  <td><button className="flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-950/40 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 transition-colors" style={xs} onClick={() => onOpen(d.symbol)} data-testid={`button-priority-open-${d.symbol}`}><Maximize2 className="h-3.5 w-3.5" aria-hidden /> Card</button></td>
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
