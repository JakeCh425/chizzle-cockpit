// ─────────────────────────────────────────────────────────────────────────────
// MiniChartWidget.tsx
// Compact ticker chart with SMA20/50/200 overlays + proximity signal.
// Uses Recharts + backend /api/candles?interval=1D|1H|30M|5M (60s server cache).
//
// Refinements:
//  • Right-edge floating SMA value labels — appear on hover only (so the lines stay clean)
//  • Legend dots toggle SMA visibility (state per SMA)
//  • In-flight requests abort on unmount via AbortSignal
//  • Strict types (no `any`)
//  • Full a11y: role=img + descriptive aria-label on chart
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Maximize2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { computeSMAs, computeSignal, getAScore, type SignalColor } from "@/lib/sma";

type Candle = { time: number; close: number };
export type Interval = "1D" | "1H" | "30M" | "5M";

interface Props {
  ticker?: string;
  /** Initial interval. Switchable from UI. */
  defaultInterval?: Interval;
  /** Refresh cadence in ms. Default tracks interval cache TTL (foreground only). 0 = off. */
  refreshMs?: number;
  height?: number;
  /** Allow user to retype the ticker. Defaults to true. */
  editableTicker?: boolean;
  /** Click handler — fired when the user clicks the expand affordance, the
   *  A-score badge, or the chart area. Use this to open the full-chart modal. */
  onExpand?: (symbol: string, interval: Interval) => void;
}

// Sensible foreground refresh per interval (matches the server-side cache TTL).
const DEFAULT_REFRESH: Record<Interval, number> = {
  "1D": 60_000,
  "1H": 60_000,
  "30M": 20_000,
  "5M": 10_000,
};

// SMA hex tokens used in the right-edge value labels (text color matches line).
const SMA_LABEL_COLOR = {
  sma20: "#22C55E", // green
  sma50: "#F59E0B", // amber
  sma200: "#EF4444", // red
} as const;

// ─── Data fetcher ────────────────────────────────────────────────────────────
function useCandles(ticker: string, interval: Interval, refreshMs: number) {
  return useQuery<Candle[]>({
    queryKey: ["/api/candles", ticker, interval],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/candles/${ticker}?interval=${interval}`, undefined, signal);
      return res.json();
    },
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    refetchIntervalInBackground: false,
    staleTime: Math.max(5_000, refreshMs / 2),
    enabled: !!ticker,
  });
}

// ─── Chart row + SMA visibility state ───────────────────────────────────────
interface ChartRow {
  i: number;
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
}

interface SmaVisibility {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
}

// ─── Tooltip formatter ──────────────────────────────────────────────────────
// Recharts' Formatter accepts ValueType = string | number | (string|number)[],
// so we widen the input and stringify safely.
function fmtTooltip(v: number | string | Array<number | string>, name: unknown): [string, string] {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return [Number.isFinite(n) ? n.toFixed(2) : String(v), String(name ?? "")];
}

// ─── Chart view (memoized to avoid re-renders when rows are referentially stable) ─
const ChartView = memo(function ChartView({
  rows,
  height,
  visible,
}: {
  rows: ChartRow[];
  height: number;
  visible: SmaVisibility;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="hsl(var(--ink-line))" strokeOpacity={0.25} vertical={false} />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--ink-panel))",
            border: "1px solid hsl(var(--ink-line))",
            borderRadius: 2,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
          labelStyle={{ display: "none" }}
          formatter={fmtTooltip}
        />
        {visible.sma200 && (
          <Line type="monotone" dataKey="sma200" stroke="hsl(var(--signal-red))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        )}
        {visible.sma50 && (
          <Line type="monotone" dataKey="sma50" stroke="hsl(var(--signal-amber))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        )}
        {visible.sma20 && (
          <Line type="monotone" dataKey="sma20" stroke="hsl(var(--neon-blue))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        )}
        <Line type="monotone" dataKey="price" stroke="hsl(var(--soft-white))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

// ─── Floating right-edge SMA labels ─────────────────────────────────────────
// Computes vertical y% positions from the price range and the current SMA
// values, then stacks any pair within 14px by offsetting 18px apart.
interface SmaLabelDatum {
  key: "sma20" | "sma50" | "sma200";
  label: string;
  value: number;
  color: string;
}

function SmaFloatingLabels({
  data,
  rows,
  height,
  visible,
  show,
}: {
  data: SmaLabelDatum[];
  rows: ChartRow[];
  height: number;
  visible: SmaVisibility;
  /** When false, labels are hidden (used to gate visibility to hover only). */
  show: boolean;
}) {
  // Compute min/max across price + visible SMAs to mirror Recharts' YAxis "auto" domain.
  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      if (Number.isFinite(r.price)) { lo = Math.min(lo, r.price); hi = Math.max(hi, r.price); }
      if (visible.sma20 && r.sma20 != null) { lo = Math.min(lo, r.sma20); hi = Math.max(hi, r.sma20); }
      if (visible.sma50 && r.sma50 != null) { lo = Math.min(lo, r.sma50); hi = Math.max(hi, r.sma50); }
      if (visible.sma200 && r.sma200 != null) { lo = Math.min(lo, r.sma200); hi = Math.max(hi, r.sma200); }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return { min: 0, max: 1 };
    return { min: lo, max: hi };
  }, [rows, visible]);

  // Recharts margin in our LineChart: top=4, bottom=4. Usable height shrinks by 8px.
  const PAD_TOP = 4;
  const PAD_BOTTOM = 4;
  const usable = Math.max(1, height - PAD_TOP - PAD_BOTTOM);

  // Map each visible SMA to a pixel y from the top.
  const items = useMemo(() => {
    const visibleData = data.filter(d => visible[d.key]);
    // Sort by value descending so the highest sits at the top.
    visibleData.sort((a, b) => b.value - a.value);
    const placed: { datum: SmaLabelDatum; y: number }[] = [];
    for (const d of visibleData) {
      const norm = (d.value - min) / (max - min); // 0..1, where 1 is top of price range
      let y = PAD_TOP + (1 - norm) * usable;
      // Clamp inside chart bounds.
      y = Math.max(PAD_TOP + 1, Math.min(PAD_TOP + usable - 12, y));
      // Stack: if previous label is within 14px, push this one 18px lower.
      const prev = placed[placed.length - 1];
      if (prev && Math.abs(y - prev.y) < 14) {
        y = prev.y + 18;
      }
      placed.push({ datum: d, y });
    }
    return placed;
  }, [data, visible, min, max, usable]);

  if (items.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 transition-opacity duration-150"
      style={{ opacity: show ? 1 : 0 }}
      aria-hidden="true"
    >
      {items.map(({ datum, y }) => (
        <div
          key={datum.key}
          className="absolute right-1 font-mono-num tabular-nums"
          style={{
            top: `${y}px`,
            fontSize: "11px",
            color: datum.color,
            background: "rgba(0,0,0,0.65)",
            borderRadius: "4px",
            padding: "1px 5px",
            lineHeight: "12px",
            whiteSpace: "nowrap",
          }}
        >
          {datum.label} · {datum.value.toFixed(2)}
        </div>
      ))}
    </div>
  );
}

// ─── Interval pill switcher ──────────────────────────────────────────────────
const INTERVALS: Interval[] = ["5M", "30M", "1H", "1D"];

function IntervalSwitcher({ value, onChange }: { value: Interval; onChange: (i: Interval) => void }) {
  return (
    <div className="flex items-center gap-px border border-ink-line/80 rounded-sm overflow-hidden" role="tablist" aria-label="Chart interval">
      {INTERVALS.map(iv => {
        const active = iv === value;
        return (
          <button
            key={iv}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(iv)}
            data-testid={`button-interval-${iv}`}
            className={`px-1.5 py-0.5 text-[9px] font-mono-num uppercase tracking-wider transition-colors ${
              active
                ? "bg-neon-blue/15 text-neon-blue"
                : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
            }`}
          >{iv}</button>
        );
      })}
    </div>
  );
}

// ─── Component wrapper ──────────────────────────────────────────────────────
export default function MiniChartWidget({
  ticker = "SMH",
  defaultInterval = "1D",
  refreshMs,
  height = 120,
  editableTicker = true,
  onExpand,
}: Props) {
  const [symbol, setSymbol] = useState(ticker.toUpperCase());
  const [input, setInput] = useState(symbol);
  const [interval, setInterval] = useState<Interval>(defaultInterval);
  const [visible, setVisible] = useState<SmaVisibility>({ sma20: true, sma50: true, sma200: true });
  const [hovering, setHovering] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // External ticker prop change → sync internal state
  useEffect(() => {
    const t = ticker.toUpperCase();
    setSymbol(t);
    setInput(t);
  }, [ticker]);

  const effectiveRefresh = refreshMs ?? DEFAULT_REFRESH[interval];
  const { data: candles = [], isLoading, error } = useCandles(symbol, interval, effectiveRefresh);

  // Derived: SMAs + signal + A-score + chart rows. Memoized — recomputes only when candles change.
  const { rows, signal, aScore, lastPrice, lastChange, sma20Last, sma50Last, sma200Last } = useMemo(() => {
    const closes = candles.map(c => c.close);
    const { sma20, sma50, sma200 } = computeSMAs(closes);
    const rows: ChartRow[] = closes.map((p, i) => ({
      i, price: p, sma20: sma20[i], sma50: sma50[i], sma200: sma200[i],
    }));
    const signal = computeSignal(closes, sma20, sma50, sma200);
    const aScore = getAScore(closes, sma20);
    const lastPrice = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const lastChange = lastPrice != null && prev != null ? ((lastPrice - prev) / prev) * 100 : null;
    const last = (arr: (number | null)[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i] as number;
      return null;
    };
    return {
      rows, signal, aScore, lastPrice, lastChange,
      sma20Last: last(sma20),
      sma50Last: last(sma50),
      sma200Last: last(sma200),
    };
  }, [candles]);

  // Floating-label data set — only includes SMAs with a current numeric value.
  const labelData = useMemo<SmaLabelDatum[]>(() => {
    const out: SmaLabelDatum[] = [];
    if (sma20Last != null) out.push({ key: "sma20", label: "SMA20", value: sma20Last, color: SMA_LABEL_COLOR.sma20 });
    if (sma50Last != null) out.push({ key: "sma50", label: "SMA50", value: sma50Last, color: SMA_LABEL_COLOR.sma50 });
    if (sma200Last != null) out.push({ key: "sma200", label: "SMA200", value: sma200Last, color: SMA_LABEL_COLOR.sma200 });
    return out;
  }, [sma20Last, sma50Last, sma200Last]);

  // Ticker input commit
  const commit = () => {
    const t = input.trim().toUpperCase();
    if (t && t !== symbol && /^[A-Z0-9.\-]{1,12}$/.test(t)) setSymbol(t);
    else setInput(symbol);
  };

  const dotClass: Record<SignalColor, string> = {
    green: "bg-signal-green shadow-[0_0_6px_hsl(var(--signal-green)/0.7)]",
    amber: "bg-signal-amber shadow-[0_0_6px_hsl(var(--signal-amber)/0.7)]",
    red: "bg-signal-red shadow-[0_0_6px_hsl(var(--signal-red)/0.7)]",
    slate: "bg-slate-gray",
  };
  const badgeClass: Record<SignalColor, string> = {
    green: "bg-signal-green/15 text-signal-green border-signal-green/40",
    amber: "bg-signal-amber/15 text-signal-amber border-signal-amber/40",
    red: "bg-signal-red/15 text-signal-red border-signal-red/40",
    slate: "bg-slate-gray/15 text-slate-gray border-slate-gray/40",
  };
  const changeColor =
    lastChange == null ? "text-slate-gray" :
    lastChange >= 0 ? "text-signal-green" : "text-signal-red";
  const expand = () => onExpand?.(symbol, interval);

  // Toggle SMA visibility from the legend.
  const toggleSma = (key: keyof SmaVisibility) =>
    setVisible(v => ({ ...v, [key]: !v[key] }));

  // Surface error message safely without `any`.
  const errMsg = error instanceof Error ? error.message : "";

  // Descriptive aria-label for the chart container.
  const chartAriaLabel =
    `${symbol} price chart, ${interval} timeframe` +
    (lastPrice != null ? `, last ${lastPrice.toFixed(2)}` : "") +
    (lastChange != null ? `, change ${lastChange.toFixed(2)} percent` : "") +
    `, signal ${signal.note}`;

  return (
    <div className="border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={expand}
            className={`px-1.5 py-0.5 text-[9px] font-mono-num uppercase tracking-wider border rounded-sm transition-colors hover:brightness-125 ${badgeClass[aScore.color]}`}
            title={aScore.tooltip}
            aria-label={`A-score ${aScore.label}. ${aScore.tooltip}`}
            data-testid={`badge-ascore-${symbol}`}
          >{aScore.label}</button>
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass[signal.color]}`}
            title={signal.note}
            aria-label={signal.note}
            role="img"
          />
          {editableTicker ? (
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onBlur={commit}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); inputRef.current?.blur(); } }}
              spellCheck={false}
              className="w-16 bg-transparent text-[14px] font-mono-num font-semibold uppercase tracking-wider outline-none focus:text-neon-blue text-soft-white"
              data-testid={`input-minichart-ticker-${symbol}`}
              aria-label="Ticker symbol"
            />
          ) : (
            <span className="text-[14px] font-mono-num font-semibold uppercase tracking-wider text-soft-white">{symbol}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <IntervalSwitcher value={interval} onChange={setInterval} />
          {onExpand && (
            <button
              type="button"
              onClick={expand}
              className="p-1 text-slate-gray hover:text-neon-blue transition-colors"
              title="Open full chart"
              aria-label={`Open full chart for ${symbol}`}
              data-testid={`button-expand-${symbol}`}
            ><Maximize2 className="w-3 h-3" aria-hidden="true" /></button>
          )}
        </div>
      </div>

      {/* Price strip */}
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 font-mono-num tabular-nums">
          {lastPrice != null ? (
            <>
              <span className="text-soft-white">${lastPrice.toFixed(2)}</span>
              {lastChange != null && (
                <span className={changeColor}>{lastChange >= 0 ? "+" : ""}{lastChange.toFixed(2)}%</span>
              )}
            </>
          ) : <span className="text-slate-gray">—</span>}
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors"
            title="Open in TradingView"
            aria-label={`Open ${symbol} in TradingView`}
            data-testid={`link-tv-${symbol}`}
          >TV</a>
          <a
            href={`https://finviz.com/quote.ashx?t=${symbol}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors"
            title="Open in Finviz"
            aria-label={`Open ${symbol} in Finviz`}
            data-testid={`link-fv-${symbol}`}
          >FV</a>
        </div>
      </div>

      {/* Chart */}
      <div
        style={{ height }}
        className={`relative ${onExpand ? "cursor-zoom-in" : ""}`}
        onClick={onExpand ? expand : undefined}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        role="img"
        aria-label={chartAriaLabel}
        data-testid={`chart-mini-${symbol}`}
      >
        {isLoading && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-slate-gray">Loading…</div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-signal-red text-center px-2">
            {errMsg.slice(0, 80) || "Fetch error"}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider text-slate-gray text-center px-2">
            {interval === "1H" ? (
              <>
                <span>Hourly bars unavailable</span>
                <span className="text-[9px] normal-case tracking-normal text-slate-gray/70">
                  Free data tier — try 1D, 30M, or 5M.
                </span>
              </>
            ) : interval === "5M" || interval === "30M" ? (
              <>
                <span>Intraday warming up</span>
                <span className="text-[9px] normal-case tracking-normal text-slate-gray/70">
                  Ticks populate as the market trades.
                </span>
              </>
            ) : (
              <span>No {interval} data yet</span>
            )}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <ChartView rows={rows} height={height} visible={visible} />
            <SmaFloatingLabels data={labelData} rows={rows} height={height} visible={visible} show={hovering} />
          </>
        )}
      </div>

      {/* Legend + signal — dots are now toggleable */}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-gray">
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => toggleSma("sma20")}
            aria-pressed={visible.sma20}
            aria-label={`Toggle SMA20 line ${visible.sma20 ? "off" : "on"}`}
            className={`flex items-center gap-1 transition-opacity ${visible.sma20 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
            data-testid={`button-legend-sma20-${symbol}`}
          >
            <i className="w-2 h-px bg-neon-blue inline-block" aria-hidden="true" />20
          </button>
          <button
            type="button"
            onClick={() => toggleSma("sma50")}
            aria-pressed={visible.sma50}
            aria-label={`Toggle SMA50 line ${visible.sma50 ? "off" : "on"}`}
            className={`flex items-center gap-1 transition-opacity ${visible.sma50 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
            data-testid={`button-legend-sma50-${symbol}`}
          >
            <i className="w-2 h-px bg-signal-amber inline-block" aria-hidden="true" />50
          </button>
          <button
            type="button"
            onClick={() => toggleSma("sma200")}
            aria-pressed={visible.sma200}
            aria-label={`Toggle SMA200 line ${visible.sma200 ? "off" : "on"}`}
            className={`flex items-center gap-1 transition-opacity ${visible.sma200 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
            data-testid={`button-legend-sma200-${symbol}`}
          >
            <i className="w-2 h-px bg-signal-red inline-block" aria-hidden="true" />200
          </button>
        </div>
        <span className="text-soft-white/70" title={`Score ${signal.score}`}>{signal.note}</span>
      </div>
    </div>
  );
}
