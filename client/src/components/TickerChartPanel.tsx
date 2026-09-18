// ─── TickerChartPanel ────────────────────────────────────────────────────────
// Cockpit v2 refinement (RSI + Focus/Comparison views).
// Fills the horizontal space next to the FLEX scanner with a focused chart +
// plain-English technical snapshot for one ticker at a time, or a small
// market-comparison grid.
//
// Data:
//   - GET /api/candles-ohlc/:ticker?interval=1D (daily OHLC, cached server-side)
//   - POST /api/flex-scan { universe: [ticker] } (metrics + state + verdict)
//
// No new dependencies. Candles + SMA + RSI are all hand-rolled SVG.
//
// This file used to own the chip / active-ticker state via usePersistentState.
// That state was lifted into CockpitTickerContext so external components
// (Market Pulse, scanner rows, etc.) can drive it. Legacy behavior preserved
// as fallback via useCockpitTicker() so this component still works standalone.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { apiRequest } from "@/lib/queryClient";
import { Plus, X, Maximize2, Minimize2, LayoutGrid, Focus } from "lucide-react";
import { rsi, rsiZone } from "@/lib/rsi";
import { useCockpitTicker, DEFAULT_CHIPS } from "@/components/CockpitTickerContext";
import { useLiveQuotes } from "@/lib/useLivePrices";

// ── Types ────────────────────────────────────────────────────────────────────
interface OHLCBar {
  time: number;
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

type ViewMode = "focus" | "compare";
interface OverlayToggles {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  rsi: boolean;
}
const DEFAULT_TOGGLES: OverlayToggles = { sma20: true, sma50: true, sma200: true, rsi: true };

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

// ── Ticker chip row ──────────────────────────────────────────────────────────
function TickerChips() {
  const { chips, active, select, add, remove, isDefault } = useCockpitTicker();
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState("");

  function submit() {
    const t = input.trim().toUpperCase();
    if (!t || !/^[A-Z0-9.\-]{1,10}$/.test(t)) { setInput(""); setAdding(false); return; }
    add(t);
    setInput("");
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((t) => {
        const isActive = t === active;
        const canRemove = !isDefault(t);
        return (
          <div key={t} className="group relative">
            <button
              onClick={() => select(t)}
              data-testid={`chip-ticker-${t}`}
              className={`px-2 py-1 text-[11px] font-mono font-bold rounded border transition-colors ${
                isActive
                  ? "bg-neon-blue/20 border-neon-blue text-neon-blue"
                  : "bg-ink-panel border-ink-line text-slate-gray hover:text-soft-white hover:border-slate-gray"
              }`}
            >
              {t}
            </button>
            {canRemove && (
              <button
                onClick={(e) => { e.stopPropagation(); remove(t); }}
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

// ── Candlestick + SMA chart ──────────────────────────────────────────────────
interface CandleProps {
  bars: OHLCBar[];
  height: number;
  width: number;
  toggles: OverlayToggles;
}
function CandlestickChart({ bars, height, width, toggles }: CandleProps) {
  const rightAxisW = 46;
  const bottomAxisH = 18;
  const chartW = Math.max(60, width - rightAxisW);
  const chartH = Math.max(40, height - bottomAxisH);

  const closes = bars.map((b) => b.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);

  const yMin = Math.min(...bars.map((b) => b.low));
  const yMax = Math.max(...bars.map((b) => b.high));
  const yPad = (yMax - yMin) * 0.05 || 1;
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;
  const yScale = (v: number) => chartH - ((v - yLo) / (yHi - yLo)) * chartH;

  const n = bars.length;
  const barW = chartW / n;
  const bodyW = Math.max(1.2, barW * 0.65);
  const xCenter = (i: number) => i * barW + barW / 2;

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
            <rect x={x - bodyW / 2} y={yBodyTop} width={bodyW} height={bodyH} fill={color} opacity={isUp ? 0.85 : 0.9} />
          </g>
        );
      })}
      {toggles.sma20 && <path d={smaPath(sma20)} fill="none" stroke="rgb(56 189 248)" strokeWidth={1.2} opacity={0.9} />}
      {toggles.sma50 && <path d={smaPath(sma50)} fill="none" stroke="rgb(251 191 36)" strokeWidth={1.2} opacity={0.9} />}
      {toggles.sma200 && <path d={smaPath(sma200)} fill="none" stroke="rgb(168 85 247)" strokeWidth={1.2} opacity={0.9} />}
      <g transform="translate(6, 10)">
        {toggles.sma20  && <text x={0}  fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(56 189 248)">SMA20</text>}
        {toggles.sma50  && <text x={44} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(251 191 36)">SMA50</text>}
        {toggles.sma200 && <text x={88} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(168 85 247)">SMA200</text>}
      </g>
    </svg>
  );
}

// ── RSI mini-panel ───────────────────────────────────────────────────────────
interface RsiProps {
  bars: OHLCBar[];
  width: number;
  height: number;
}
function RsiPanel({ bars, width, height }: RsiProps) {
  const rightAxisW = 46;
  const chartW = Math.max(40, width - rightAxisW);
  const chartH = height;
  const closes = bars.map((b) => b.close);
  const series = rsi(closes, 14);
  const n = bars.length;
  const barW = chartW / n;
  const xCenter = (i: number) => i * barW + barW / 2;
  const yScale = (v: number) => chartH - (v / 100) * chartH;

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

  const y30 = yScale(30);
  const y50 = yScale(50);
  const y70 = yScale(70);
  const last = series.length ? series[series.length - 1] : null;

  return (
    <svg width={width} height={height} className="block" data-testid="chart-rsi">
      {/* Fill for the 30–70 band, subtle */}
      <rect x={0} y={y70} width={chartW} height={y30 - y70} fill="rgb(56 189 248 / 0.03)" />
      {/* Reference lines */}
      <line x1={0} x2={chartW} y1={y30} y2={y30} stroke="rgb(148 163 184 / 0.35)" strokeWidth={0.5} strokeDasharray="2 3" />
      <line x1={0} x2={chartW} y1={y50} y2={y50} stroke="rgb(148 163 184 / 0.25)" strokeWidth={0.5} strokeDasharray="1 3" />
      <line x1={0} x2={chartW} y1={y70} y2={y70} stroke="rgb(148 163 184 / 0.35)" strokeWidth={0.5} strokeDasharray="2 3" />
      {/* RSI line */}
      <path d={d} fill="none" stroke="rgb(129 140 248)" strokeWidth={1.2} opacity={0.9} />
      {/* Axis labels */}
      <text x={chartW + 4} y={y70 + 3} fontSize={8} fontFamily="ui-monospace, monospace" fill="rgb(148 163 184 / 0.7)">70</text>
      <text x={chartW + 4} y={y50 + 3} fontSize={8} fontFamily="ui-monospace, monospace" fill="rgb(148 163 184 / 0.6)">50</text>
      <text x={chartW + 4} y={y30 + 3} fontSize={8} fontFamily="ui-monospace, monospace" fill="rgb(148 163 184 / 0.7)">30</text>
      {/* Header + last value */}
      <g transform="translate(6, 10)">
        <text fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(129 140 248)">RSI 14</text>
        {last != null && (
          <text x={44} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgb(226 232 240 / 0.85)">
            {last.toFixed(1)}
          </text>
        )}
      </g>
    </svg>
  );
}

// ── Overlay toggle row ───────────────────────────────────────────────────────
function OverlayToggleRow({ toggles, onChange }: { toggles: OverlayToggles; onChange: (t: OverlayToggles) => void }) {
  const items: { key: keyof OverlayToggles; label: string; color: string }[] = [
    { key: "sma20", label: "SMA20",  color: "text-sky-400" },
    { key: "sma50", label: "SMA50",  color: "text-amber-400" },
    { key: "sma200", label: "SMA200", color: "text-purple-400" },
    { key: "rsi",   label: "RSI",    color: "text-indigo-400" },
  ];
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {items.map((it) => {
        const on = toggles[it.key];
        return (
          <button
            key={it.key}
            onClick={() => onChange({ ...toggles, [it.key]: !on })}
            data-testid={`toggle-${it.key}`}
            className={`px-1.5 py-0.5 text-[9.5px] font-mono uppercase tracking-wider rounded border transition-colors ${
              on
                ? `border-current ${it.color} bg-current/10`
                : "border-ink-line text-slate-gray/60 hover:text-slate-gray"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Technical snapshot (metrics + verdict) ───────────────────────────────────
interface SnapProps { ticker: string; bars: OHLCBar[] | undefined }
function TechnicalSnapshot({ ticker, bars }: SnapProps) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/flex-scan", ticker],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flex-scan", { universe: [ticker], include_tech_concentrated: true });
      return await res.json();
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="text-[11px] text-slate-gray py-3 text-center" data-testid="tech-snapshot-loading">
        Reading {ticker} tape…
      </div>
    );
  }

  const cards: any[] = Array.isArray(data.cards) ? data.cards : [];
  const card = cards.find((c) => c?.ticker === ticker) || cards[0];
  if (!card) {
    return <div className="text-[11px] text-slate-gray py-3 text-center">No data for {ticker}.</div>;
  }

  const m = card.metrics || {};
  const state: string = card.state || "STANDBY";
  const hardBlocks: string[] = Array.isArray(card.hard_blocks) ? card.hard_blocks : [];

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

  const rows: { label: string; value: string; meaning: string; tone?: "green" | "red" | "amber" | "gray" | "blue" }[] = [];
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

  // RSI row derived from local bars (no server round-trip).
  const rsiVal: number | null = (() => {
    if (!bars || bars.length < 15) return null;
    const series = rsi(bars.map((b) => b.close), 14);
    const last = series[series.length - 1];
    return last == null ? null : Number(last);
  })();
  const rsiInfo = rsiZone(rsiVal);
  if (rsiVal != null) {
    const toneMap: Record<string, "green" | "amber" | "red" | "blue" | "gray"> = {
      green: "green", amber: "amber", red: "red", blue: "blue", gray: "gray",
    };
    rows.push({
      label: "RSI 14",
      value: `${rsiVal.toFixed(1)} · ${rsiInfo.label}`,
      meaning: rsiInfo.meaning,
      tone: toneMap[rsiInfo.tone] ?? "gray",
    });
  }

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
      <div className={`rounded border ${toneCls} p-2.5`}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[13px] font-bold flex items-center gap-1.5">
            <span className="text-[14px]">{arrow}</span> {verdict.label}
          </div>
          <div className="text-[10px] font-mono opacity-80">${fmt2(price)}</div>
        </div>
        <div className="text-[10.5px] text-soft-white/85 mt-1 leading-snug">{verdict.message}</div>
      </div>

      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const dot =
            r.tone === "green" ? "bg-signal-green" :
            r.tone === "red"   ? "bg-signal-red" :
            r.tone === "amber" ? "bg-signal-amber" :
            r.tone === "blue"  ? "bg-neon-blue" : "bg-slate-gray/60";
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

      <div className="rounded border border-ink-line bg-ink-black/60 p-2">
        <div className="text-[9px] uppercase tracking-wider text-slate-gray mb-0.5">Next Step</div>
        <div className="text-[11px] text-soft-white leading-snug">{suggestedAction}</div>
      </div>
    </div>
  );
}

// ── Market comparison mini card ──────────────────────────────────────────────
function CompareCard({ ticker, width, height, onSelect, active }: {
  ticker: string; width: number; height: number; onSelect: () => void; active: boolean;
}) {
  const quotes = useLiveQuotes();
  const q = quotes[ticker];
  const barsQ = useQuery<OHLCBar[]>({
    queryKey: ["/api/candles-ohlc", ticker, "1D"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles-ohlc/${ticker}?interval=1D`);
      return await res.json();
    },
    staleTime: 5 * 60_000,
  });
  const bars = (barsQ.data ?? []).slice(-60);
  const closes = bars.map((b) => b.close);

  // Derive a simple bullish/neutral/bearish status from SMA structure.
  const s20 = closes.length >= 20 ? sma(closes, 20).slice(-1)[0] : null;
  const s50 = closes.length >= 50 ? sma(closes, 50).slice(-1)[0] : null;
  const last = closes[closes.length - 1] ?? null;
  let status: "Bullish" | "Neutral" | "Bearish" = "Neutral";
  let statusCls = "text-slate-gray border-ink-line bg-ink-panel/50";
  if (last != null && s20 != null) {
    if (last > s20 && (s50 == null || s20 >= s50)) { status = "Bullish"; statusCls = "text-signal-green border-signal-green/40 bg-signal-green/8"; }
    else if (last < s20 && (s50 == null || s20 <= s50)) { status = "Bearish"; statusCls = "text-signal-red border-signal-red/40 bg-signal-red/8"; }
  }

  const chgPct = q?.changePct ?? null;
  const chgTone =
    chgPct == null ? "text-slate-gray" :
    chgPct > 0 ? "text-signal-green" :
    chgPct < 0 ? "text-signal-red" : "text-slate-gray";
  const price = q?.price ?? null;

  // Compact SVG sparkline for the compare card. Zero deps.
  const sparkH = Math.max(28, height - 44);
  const sparkW = width - 20;
  let path = "";
  if (closes.length > 1) {
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    for (let i = 0; i < closes.length; i++) {
      const x = (i / (closes.length - 1)) * sparkW;
      const y = sparkH - ((closes[i] - min) / range) * sparkH;
      path += (i === 0 ? "M" : "L") + `${x.toFixed(1)} ${y.toFixed(1)} `;
    }
  }
  const sparkColor = chgPct == null || chgPct >= 0 ? "rgb(34 197 94)" : "rgb(239 68 68)";

  return (
    <button
      onClick={onSelect}
      data-testid={`compare-card-${ticker}`}
      className={`rounded-md border p-2 text-left transition-colors ${
        active ? "border-neon-blue bg-neon-blue/8" : "border-ink-line bg-ink-panel/30 hover:border-slate-gray"
      }`}
      style={{ width, minHeight: height }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className={`text-[12px] font-mono font-bold ${active ? "text-neon-blue" : "text-soft-white"}`}>{ticker}</span>
        <span className={`text-[10px] font-mono ${chgTone}`}>{chgPct == null ? "—" : `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`}</span>
      </div>
      <div className="text-[10px] font-mono text-slate-gray">${price == null ? "—" : price.toFixed(2)}</div>
      <svg width={sparkW} height={sparkH} className="block my-1">
        <path d={path} fill="none" stroke={sparkColor} strokeWidth={1.2} />
      </svg>
      <div className="flex items-center justify-end">
        <span className={`text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusCls}`}>
          {status}
        </span>
      </div>
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function TickerChartPanel() {
  const { chips, active, select } = useCockpitTicker();
  const [timeframe, setTimeframe] = usePersistentState<Timeframe>("cockpit.tickerChart.timeframe", "3M");
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = usePersistentState<ViewMode>("cockpit.tickerChart.view", "focus");
  const [toggles, setToggles] = usePersistentState<OverlayToggles>("cockpit.tickerChart.toggles", DEFAULT_TOGGLES);

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

  const chartWidth = 460 - 32; // panel px-4
  const priceChartHeight = expanded ? 340 : 200;
  const rsiChartHeight = expanded ? 90 : 66;

  // Comparison view: SMH + SPY + QQQ + first user-added ticker (if any).
  const compareTickers = [
    ...DEFAULT_CHIPS.filter((d) => chips.includes(d)),
    ...chips.filter((c) => !DEFAULT_CHIPS.includes(c)).slice(0, 1),
  ];
  const cellW = Math.floor((chartWidth - 8) / 2); // 2×2 grid
  const cellH = 120;

  return (
    <div
      className="rounded-md border border-ink-line bg-ink-black p-4 space-y-3 sticky top-16"
      data-testid="panel-ticker-chart"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-soft-white">
            {view === "focus" ? activeTicker : "Market Comparison"}
          </h3>
          <span className="text-[10px] uppercase tracking-wider text-slate-gray">
            {view === "focus" ? "Chart · Snapshot" : "click a card to focus"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* View toggle */}
          <div className="flex items-center rounded border border-ink-line overflow-hidden">
            <button
              onClick={() => setView("focus")}
              data-testid="button-view-focus"
              title="Focus Chart"
              className={`px-1.5 py-1 text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 ${
                view === "focus" ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:text-soft-white"
              }`}
            >
              <Focus className="w-3 h-3" /> Focus
            </button>
            <button
              onClick={() => setView("compare")}
              data-testid="button-view-compare"
              title="Market Comparison"
              className={`px-1.5 py-1 text-[10px] font-mono uppercase tracking-wider flex items-center gap-1 border-l border-ink-line ${
                view === "compare" ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:text-soft-white"
              }`}
            >
              <LayoutGrid className="w-3 h-3" /> Compare
            </button>
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
      </div>

      {/* Ticker chips */}
      <TickerChips />

      {view === "focus" ? (
        <>
          {/* Timeframe + overlay toggles */}
          <div className="flex items-center gap-2 flex-wrap">
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
            </div>
            <span className="text-[9px] uppercase tracking-wider text-slate-gray/70">Daily</span>
            <div className="ml-auto">
              <OverlayToggleRow toggles={toggles} onChange={setToggles} />
            </div>
          </div>

          {/* Price chart */}
          <div className="rounded border border-ink-line bg-ink-panel/30" style={{ minHeight: priceChartHeight + 20 }}>
            {isLoading ? (
              <div className="flex items-center justify-center text-[11px] text-slate-gray" style={{ height: priceChartHeight }}>
                Loading chart…
              </div>
            ) : error || !visibleBars.length ? (
              <div className="flex items-center justify-center text-[11px] text-slate-gray" style={{ height: priceChartHeight }}>
                No chart data for {activeTicker}.
              </div>
            ) : (
              <div className="p-2">
                <CandlestickChart bars={visibleBars} width={chartWidth} height={priceChartHeight} toggles={toggles} />
              </div>
            )}
          </div>

          {/* RSI mini-panel */}
          {toggles.rsi && visibleBars.length > 15 && (
            <div className="rounded border border-ink-line bg-ink-panel/30">
              <div className="p-2">
                <RsiPanel bars={visibleBars} width={chartWidth} height={rsiChartHeight} />
              </div>
            </div>
          )}

          {/* Technical snapshot */}
          <TechnicalSnapshot ticker={activeTicker} bars={allBars} />
        </>
      ) : (
        // ── Comparison view ────────────────────────────────────────────────
        <div className="grid grid-cols-2 gap-2">
          {compareTickers.map((t) => (
            <CompareCard
              key={t}
              ticker={t}
              width={cellW}
              height={cellH}
              active={t === activeTicker}
              onSelect={() => { select(t); setView("focus"); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
