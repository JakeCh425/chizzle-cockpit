// ─────────────────────────────────────────────────────────────────────────────
// MiniChartWidget.tsx
// Compact ticker chart with SMA20/50/200 overlays + proximity signal.
// Uses Recharts + backend /api/candles?interval=1D|1H|30M|5M (60s server cache).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
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

// ─── Data fetcher ────────────────────────────────────────────────────────────
function useCandles(ticker: string, interval: Interval, refreshMs: number) {
  return useQuery<Candle[]>({
    queryKey: ["/api/candles", ticker, interval],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles/${ticker}?interval=${interval}`);
      return res.json();
    },
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    refetchIntervalInBackground: false,
    staleTime: Math.max(5_000, refreshMs / 2),
    enabled: !!ticker,
  });
}

// ─── Chart view (memoized at parent via useMemo on rows) ────────────────────
interface ChartRow {
  i: number;
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
}

function ChartView({ rows, height }: { rows: ChartRow[]; height: number }) {
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
          formatter={(v: any, name: string) => [Number(v).toFixed(2), name]}
        />
        <Line type="monotone" dataKey="sma200" stroke="hsl(var(--signal-red))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="sma50" stroke="hsl(var(--signal-amber))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="sma20" stroke="hsl(var(--neon-blue))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        <Line type="monotone" dataKey="price" stroke="hsl(var(--soft-white))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
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
  const { rows, signal, aScore, lastPrice, lastChange } = useMemo(() => {
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
    return { rows, signal, aScore, lastPrice, lastChange };
  }, [candles]);

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
  // A-score badge color tokens (border + bg + text per color family).
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
            aria-label={`A-score ${aScore.label}`}
            data-testid={`badge-ascore-${symbol}`}
          >{aScore.label}</button>
          <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass[signal.color]}`} title={signal.note} aria-label={signal.note} />
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
              aria-label="Open full chart"
              data-testid={`button-expand-${symbol}`}
            ><Maximize2 className="w-3 h-3" /></button>
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
            title="Open in TradingView" data-testid={`link-tv-${symbol}`}
          >TV</a>
          <a
            href={`https://finviz.com/quote.ashx?t=${symbol}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors"
            title="Open in Finviz" data-testid={`link-fv-${symbol}`}
          >FV</a>
        </div>
      </div>

      {/* Chart */}
      <div
        style={{ height }}
        className={`relative ${onExpand ? "cursor-zoom-in" : ""}`}
        onClick={onExpand ? expand : undefined}
        role={onExpand ? "button" : undefined}
        aria-label={onExpand ? "Open full chart" : undefined}
      >
        {isLoading && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-slate-gray">Loading…</div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-signal-red text-center px-2">
            {(error as any)?.message?.slice(0, 80) || "Fetch error"}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[10px] uppercase tracking-wider text-slate-gray text-center px-2">
            {interval === "5M" || interval === "30M" ? (
              <>
                <span>Intraday data warming up</span>
                <span className="text-[9px] normal-case tracking-normal text-slate-gray/70">
                  Ticks populate as the market trades.
                </span>
              </>
            ) : (
              <span>No {interval} data yet</span>
            )}
          </div>
        )}
        {rows.length > 0 && <ChartView rows={rows} height={height} />}
      </div>

      {/* Legend + signal */}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-gray">
        <div className="flex gap-2.5">
          <span className="flex items-center gap-1"><i className="w-2 h-px bg-neon-blue inline-block" />20</span>
          <span className="flex items-center gap-1"><i className="w-2 h-px bg-signal-amber inline-block" />50</span>
          <span className="flex items-center gap-1"><i className="w-2 h-px bg-signal-red inline-block" />200</span>
        </div>
        <span className="text-soft-white/70" title={`Score ${signal.score}`}>{signal.note}</span>
      </div>
    </div>
  );
}
