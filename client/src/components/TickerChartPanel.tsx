// ─── TickerChartPanel ────────────────────────────────────────────────────────
// Cockpit v2 refinement — fills the previously-wasted horizontal space next
// to the FLEX scanner with a focused chart + plain-English technical snapshot
// for one ticker at a time. Defaults to SMH/SPY/QQQ chips; users can add
// tickers via a small inline input. All data reuses existing endpoints:
//   - GET /api/candles-ohlc/:ticker?interval=1D (daily OHLC, cached server-side)
//   - POST /api/flex-scan { universe: [ticker] } (metrics + state + verdict)
//
// No new dependencies. Candlesticks are rendered as plain SVG on top of a
// numeric price scale we derive ourselves — recharts doesn't support real
// candlesticks and the surface here is small enough that hand-rolled SVG is
// clearer than shoehorning a Bar chart into candle shapes.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { apiRequest } from "@/lib/queryClient";
import { Plus, X, Maximize2, Minimize2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface OHLCBar {
  time: number; // seconds since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type Timeframe = "1M" | "3M" | "6M" | "1Y";
const TIMEFRAMES: { key: Timeframe; label: string; bars: number }[] = [
  { key: "1M", label: "1M", bars: 22 },
  { key: "3M", label: "3M", bars: 66 },
  { key: "6M", label: "6M", bars: 132 },
  { key: "1Y", label: "1Y", bars: 252 },
];

const DEFAULT_CHIPS = ["SMH", "SPY", "QQQ"];

// ── Helpers ──────────────────────────────────────────────────────────────────
function sma(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (vals.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += vals[i];
  out[period - 1] = sum / period;
  for (let i = period; i < vals.length; i++) {
    sum += vals[i] - vals[i - period];
    out[i] = sum / period;
  }
  return out;
}

function fmt2(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}
function fmtPct(n: number | null | undefined, signed = true): string {
  if (n == null || Number.isNaN(n)) return "—";
  const s = n.toFixed(2) + "%";
  return signed && n > 0 ? "+" + s : s;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TickerChips({
  chips, active, onSelect, onRemove, onAdd,
}: {
  chips: string[];
  active: string;
  onSelect: (t: string) => void;
  onRemove: (t: string) => void;
  onAdd: (t: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");

  function submit() {
    const t = input.trim().toUpperCase();
    if (!t || !/^[A-Z0-9.\-]{1,10}$/.test(t)) { setInput(""); setAdding(false); return; }
    onAdd(t);
    setInput("");
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((t) => {
        const isActive = t === active;
        const isDefault = DEFAULT_CHIPS.includes(t);
        return (
          <div key={t} className="group relative">
            <button
              onClick={() => onSelect(t)}
              data-testid={`chip-ticker-${t}`}
              className={`px-2 py-1 text-[11px] font-mono font-bold rounded border transition-colors ${
                isActive
                  ? "bg-neon-blue/20 border-neon-blue text-neon-blue"
                  : "bg-ink-panel border-ink-line text-slate-gray hover:text-soft-white hover:border-slate-gray"
              }`}
            >
              {t}
            </button>
            {!isDefault && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(t); }}
                aria-label={`Remove ${t}`}
                data-testid={`chip-remove-${t}`}
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-ink-black border border-ink-line text-slate-gray hover:text-signal-red"
              >
                <X className="w-2 h-2" />
              </button>
            )}
          </div>
        );
      })}
      {adding ? (
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") { setInput(""); setAdding(false); }
          }}
          placeholder="TICKER"
          className="px-2 py-1 text-[11px] font-mono w-20 bg-ink-panel border border-neon-blue/60 rounded text-soft-white outline-none placeholder:text-slate-gray/50"
          data-testid="input-add-ticker"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          data-testid="button-add-ticker"
          className="px-2 py-1 text-[11px] font-mono rounded border border-dashed border-ink-line text-slate-gray hover:text-neon-blue hover:border-neon-blue flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> ADD
        </button>
      )}
    </div>
  );
}

function CandlestickChart({
  bars, height,
}: {
  bars: OHLCBar[];
  height: number;
}) {
  // Chart dimensions & padding.
  const width = 460 - 32; // panel width minus px-4 padding
  const rightAxisW = 46;
  const bottomAxisH = 18;
  const chartW = width - rightAxisW;
  const chartH = height - bottomAxisH;

  const closes = bars.map((b) => b.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  // Y-scale spans low of lows to high of highs across visible bars.
  const yMin = Math.min(...bars.map((b) => b.low));
  const yMax = Math.max(...bars.map((b) => b.high));
  const yPad = (yMax - yMin) * 0.05;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const yScale = (v: number) => chartH - ((v - yLo) / (yHi - yLo)) * chartH;

  const n = bars.length;
  const barW = chartW / n;
  const bodyW = Math.max(1.2, barW * 0.65);
  const xCenter = (i: number) => i * barW + barW / 2;

  // Y-axis ticks: 4 evenly-spaced levels.
  const yTicks = Array.from({ length: 5 }, (_, i) => yLo + ((yHi - yLo) * i) / 4);

  function smaPath(series: (number | null)[]): string {
    let d = "";
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v == null) continue;
      const x = xCenter(i);
      const y = yScale(v);
      d += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      started = true;
    }
    return d;
  }

  return (
    <svg width={width} height={height} className="block" data-testid="chart-candles">
      {/* Y-axis grid lines + labels */}
      {yTicks.map((v, i) => {
        const y = yScale(v);
        return (
          <g key={i}>
            <line x1={0} x2={chartW} y1={y} y2={y} stroke="rgb(31 38 51 / 0.6)" strokeWidth={0.5} strokeDasharray="2 3" />
            <text x={chartW + 4} y={y + 3} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(148 163 184 / 0.7)">
              {v.toFixed(v >= 100 ? 0 : 1)}
            </text>
          </g>
        );
      })}
      {/* Candles */}
      {bars.map((b, i) => {
        const isUp = b.close >= b.open;
        const color = isUp ? "rgb(34 197 94)" : "rgb(239 68 68)";
        const x = xCenter(i);
        const yHigh = yScale(b.high);
        const yLow = yScale(b.low);
        const yO = yScale(b.open);
        const yC = yScale(b.close);
        const yBodyTop = Math.min(yO, yC);
        const bodyH = Math.max(1, Math.abs(yC - yO));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={0.8} opacity={0.9} />
            <rect
              x={x - bodyW / 2}
              y={yBodyTop}
              width={bodyW}
              height={bodyH}
              fill={isUp ? color : color}
              opacity={isUp ? 0.85 : 0.9}
            />
          </g>
        );
      })}
      {/* SMA overlays */}
      <path d={smaPath(sma20)} fill="none" stroke="rgb(56 189 248)" strokeWidth={1.2} opacity={0.9} />
      <path d={smaPath(sma50)} fill="none" stroke="rgb(251 191 36)" strokeWidth={1.2} opacity={0.9} />
      <path d={smaPath(sma200)} fill="none" stroke="rgb(168 85 247)" strokeWidth={1.2} opacity={0.9} />

      {/* Legend row */}
      <g transform={`translate(6, 10)`}>
        <text fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(56 189 248)">SMA20</text>
        <text x={44} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(251 191 36)">SMA50</text>
        <text x={88} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(168 85 247)">SMA200</text>
      </g>
    </svg>
  );
}

function TechnicalSnapshot({ ticker }: { ticker: string }) {
  // Reuse the flex-scan engine for the classification + metrics the FLEX
  // scanner card shows, then render a beginner-friendly plain-English summary.
  // The scan always evaluates SMH/QQQ/SPY plus whatever ticker we ask for, so
  // we key the query on the ticker (a non-pinned ticker adds a card the shared
  // scan wouldn't include) and reuse React Query's cache to avoid re-firing
  // when the user toggles among tickers we've already scanned.
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/flex-scan", ticker],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", { universe: [ticker], include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // refresh every 5m in the background
  });

  if (isLoading || !data) {
    return (
      <div className="text-[11px] text-slate-gray py-3 text-center" data-testid="tech-snapshot-loading">
        Reading {ticker} tape…
      </div>
    );
  }

  // runFlexScan always evaluates SMH/QQQ/SPY (pinned tickers) even when the
  // caller asks for just one, and returns them first in the sorted cards
  // array. So we can't take cards[0] — we have to find our exact ticker.
  const cards: any[] = Array.isArray(data.cards) ? data.cards : [];
  const card = cards.find((c) => c?.ticker === ticker) || cards[0];
  if (!card) {
    return <div className="text-[11px] text-slate-gray py-3 text-center">No data for {ticker}.</div>;
  }

  const m = card.metrics || {};
  const state: string = card.state || "STANDBY";
  const hardBlocks: string[] = Array.isArray(card.hard_blocks) ? card.hard_blocks : [];

  // Overall verdict — collapses the 4-state machine + hard blocks into one of
  // 4 beginner-friendly labels.
  let verdict: { label: string; tone: "green" | "amber" | "red" | "blue"; icon: "up" | "flat" | "down" | "warn"; message: string };
  if (hardBlocks.length > 0) {
    verdict = { label: "BEARISH — Stand Down", tone: "red", icon: "down",
      message: "Structure or volume rules block a long here. Wait for the setup to repair." };
  } else if (state === "STANDARD_READY") {
    verdict = { label: "BULLISH — Ready", tone: "green", icon: "up",
      message: "Trend, structure, and volume line up. Setup is trigger-armed at standard size." };
  } else if (state === "FLEX_READY") {
    verdict = { label: "BULLISH — Half Size", tone: "green", icon: "up",
      message: "Setup is trigger-armed but one factor is soft. Take half size on entry." };
  } else if (state === "FLEX_WATCH") {
    verdict = { label: "NEUTRAL — Watching", tone: "blue", icon: "flat",
      message: "Trend intact and pattern is forming. Set an alert; don't chase before the trigger." };
  } else {
    verdict = { label: "NEUTRAL — Standby", tone: "amber", icon: "flat",
      message: "No qualifying setup right now. Continue watching regime and volume." };
  }

  const toneCls =
    verdict.tone === "green" ? "bg-signal-green/15 border-signal-green text-signal-green" :
    verdict.tone === "red"   ? "bg-signal-red/15 border-signal-red text-signal-red" :
    verdict.tone === "blue"  ? "bg-neon-blue/15 border-neon-blue text-neon-blue" :
                                "bg-signal-amber/15 border-signal-amber text-signal-amber";
  const arrow = verdict.icon === "up" ? "▲" : verdict.icon === "down" ? "▼" : "▬";

  // Metric rows. Each row: label · value · one-line meaning.
  const rows: { label: string; value: string; meaning: string; tone?: "green" | "red" | "amber" | "gray" }[] = [];
  const price = Number(m.price ?? 0);

  const smaRow = (label: string, key: string, distKey: string, hint: string) => {
    const v = m[key];
    const dist = m[distKey];
    if (v == null) return;
    const above = dist != null && dist >= 0;
    rows.push({
      label,
      value: `$${fmt2(v)}${dist != null ? ` (${fmtPct(dist)})` : ""}`,
      meaning: above ? `Above and supporting — ${hint} intact.` : `Below — ${hint} is broken until reclaimed.`,
      tone: above ? "green" : "red",
    });
  };
  smaRow("20 SMA", "sma20", "dist_from_sma20_pct", "short-term trend");
  smaRow("50 SMA", "sma50", "dist_from_sma50_pct", "medium-term trend");
  smaRow("200 SMA", "sma200", "dist_from_sma200_pct", "primary trend");

  if (m.relative_volume != null) {
    const rv = Number(m.relative_volume);
    const tone: "green" | "amber" | "red" = rv >= 1.2 ? "green" : rv >= 0.8 ? "amber" : "red";
    rows.push({
      label: "Rel Volume",
      value: `${rv.toFixed(2)}x avg`,
      meaning: rv >= 1.2 ? "Above average — buyers are participating."
             : rv >= 0.8 ? "Near average — conviction is neutral."
                         : "Below floor — no participation to fuel a move.",
      tone,
    });
  }

  if (m.sma50_slope_pct != null) {
    const s = Number(m.sma50_slope_pct);
    const tone: "green" | "amber" | "red" = s > 0.05 ? "green" : s < -0.05 ? "red" : "amber";
    rows.push({
      label: "50-SMA slope",
      value: fmtPct(s),
      meaning: s > 0.05 ? "Rising — trend structure is healthy."
             : s < -0.05 ? "Falling — trend is weakening, avoid new longs."
                         : "Flat — trend is neutral.",
      tone,
    });
  }

  if (m.nearest_support != null || m.nearest_resistance != null) {
    rows.push({
      label: "S / R",
      value: `${m.nearest_support != null ? "$" + fmt2(m.nearest_support) : "—"} / ${m.nearest_resistance != null ? "$" + fmt2(m.nearest_resistance) : "—"}`,
      meaning: "Nearest confirmed pivot support and resistance.",
      tone: "gray",
    });
  }

  const action: string = card.action || "STAND DOWN";
  const suggestedAction =
    action === "ENTER — SMALL" ? "Enter standard size on the trigger. Stop at listed invalidation level."
    : action === "ENTER — HALF SIZE" ? "Half-size only. Confirm the trigger bar closes before entering."
    : action === "SET ALERT" ? "Set an alert at the trigger level. Don't front-run it."
    : "No new risk. Wait for the setup to repair.";

  return (
    <div className="space-y-2.5" data-testid={`tech-snapshot-${ticker}`}>
      {/* Verdict header */}
      <div className={`rounded border ${toneCls} p-2.5`}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[13px] font-bold flex items-center gap-1.5">
            <span className="text-[14px]">{arrow}</span> {verdict.label}
          </div>
          <div className="text-[10px] font-mono opacity-80">${fmt2(price)}</div>
        </div>
        <div className="text-[10.5px] text-soft-white/85 mt-1 leading-snug">{verdict.message}</div>
      </div>

      {/* Metric rows */}
      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const dot =
            r.tone === "green" ? "bg-signal-green" :
            r.tone === "red"   ? "bg-signal-red" :
            r.tone === "amber" ? "bg-signal-amber" : "bg-slate-gray/60";
          return (
            <div key={i} className="rounded border border-ink-line bg-ink-panel/40 p-2" data-testid={`tech-row-${r.label}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
                  <span className="text-[10px] uppercase tracking-wider text-slate-gray truncate">{r.label}</span>
                </div>
                <span className="font-mono text-[11px] text-soft-white tabular-nums truncate">{r.value}</span>
              </div>
              <div className="text-[10px] text-slate-gray leading-snug mt-0.5">{r.meaning}</div>
            </div>
          );
        })}
      </div>

      {/* Suggested next action */}
      <div className="rounded border border-ink-line bg-ink-black/60 p-2">
        <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-0.5">Next Step</div>
        <div className="text-[11px] text-soft-white leading-snug">{suggestedAction}</div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function TickerChartPanel() {
  const [chips, setChips] = usePersistentState<string[]>("cockpit.tickerChart.chips", DEFAULT_CHIPS);
  const [active, setActive] = usePersistentState<string>("cockpit.tickerChart.active", "SMH");
  const [timeframe, setTimeframe] = usePersistentState<Timeframe>("cockpit.tickerChart.timeframe", "3M");
  const [expanded, setExpanded] = useState(false);

  // Guard: make sure active is one of the chips.
  const activeTicker = chips.includes(active) ? active : chips[0] || "SMH";

  const { data: allBars, isLoading, error } = useQuery<OHLCBar[]>({
    queryKey: ["/api/candles-ohlc", activeTicker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${activeTicker}?interval=1D`);
      return await res.json();
    },
    staleTime: 5 * 60_000,
  });

  const visibleBars = useMemo(() => {
    if (!allBars || allBars.length === 0) return [] as OHLCBar[];
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    const nBars = tf?.bars ?? 66;
    return allBars.slice(-nBars);
  }, [allBars, timeframe]);

  function addTicker(t: string) {
    if (!chips.includes(t)) setChips([...chips, t]);
    setActive(t);
  }
  function removeTicker(t: string) {
    if (DEFAULT_CHIPS.includes(t)) return;
    const next = chips.filter((c) => c !== t);
    setChips(next);
    if (active === t) setActive(next[0] || "SMH");
  }

  const chartHeight = expanded ? 420 : 240;

  return (
    <div
      className="rounded-md border border-ink-line bg-ink-black p-4 space-y-3 sticky top-16"
      data-testid="panel-ticker-chart"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-soft-white">
            {activeTicker}
          </h3>
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">Chart · Snapshot</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          data-testid="button-chart-expand"
          className="p-1 text-slate-gray hover:text-neon-blue rounded"
          title={expanded ? "Shrink chart" : "Expand chart"}
        >
          {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Ticker chips */}
      <TickerChips
        chips={chips}
        active={activeTicker}
        onSelect={setActive}
        onRemove={removeTicker}
        onAdd={addTicker}
      />

      {/* Timeframe controls */}
      <div className="flex items-center gap-1">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.key}
            onClick={() => setTimeframe(t.key)}
            data-testid={`button-tf-${t.key}`}
            className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
              timeframe === t.key
                ? "border-neon-blue text-neon-blue bg-neon-blue/10"
                : "border-ink-line text-slate-gray hover:text-soft-white"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-gray/70">Daily · SMA 20/50/200</span>
      </div>

      {/* Chart */}
      <div className="rounded border border-ink-line bg-ink-panel/30" style={{ minHeight: chartHeight + 20 }}>
        {isLoading ? (
          <div className="flex items-center justify-center text-[11px] text-slate-gray" style={{ height: chartHeight }}>
            Loading chart…
          </div>
        ) : error || !visibleBars.length ? (
          <div className="flex items-center justify-center text-[11px] text-slate-gray" style={{ height: chartHeight }}>
            No chart data for {activeTicker}.
          </div>
        ) : (
          <div className="p-2">
            <CandlestickChart bars={visibleBars} height={chartHeight} />
          </div>
        )}
      </div>

      {/* Technical snapshot */}
      <TechnicalSnapshot ticker={activeTicker} />
    </div>
  );
}
