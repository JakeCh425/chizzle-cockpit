// ─────────────────────────────────────────────────────────────────────────────
// MiniChartWidget.tsx
// Compact ticker chart with SMA20/50/200 overlays + proximity signal.
// Uses Recharts (already in deps) + backend /api/candles proxy (Stooq, cached).
// Styled to match the cockpit's Bloomberg-neon aesthetic.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ───────────────────────────────────────────────────────────────────
type Candle = { time: number; close: number };
type Signal = "BOUNCE" | "REJECTION" | "AT_SMA" | "APPROACHING" | "NEUTRAL";
type SignalColor = "green" | "amber" | "red" | "slate";

interface Props {
  ticker?: string;
  /** 1D = daily candles (default; required for SMA200). 1H = hourly. */
  interval?: "1D" | "1H";
  /** Refresh cadence in ms. Default 60s (matches backend cache TTL). 0 = off. */
  refreshMs?: number;
  height?: number;
  /** Optional override label; defaults to ticker uppercase. */
  title?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DATA FETCHER — backend proxy, TanStack Query handles dedupe + caching
// ─────────────────────────────────────────────────────────────────────────────
function useCandles(ticker: string, interval: "1D" | "1H", refreshMs: number) {
  return useQuery<Candle[]>({
    queryKey: ["/api/candles", ticker, interval],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/candles/${ticker}?interval=${interval}`);
      return res.json();
    },
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    refetchIntervalInBackground: false, // skip refresh when tab is hidden
    staleTime: 30_000,
    enabled: !!ticker,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SMA CALCULATOR — O(n) rolling window
// ─────────────────────────────────────────────────────────────────────────────
function rollingSMA(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SIGNAL LOGIC — proximity + cross detection vs SMA20
//    Tiers: AT (0.2%) > APPROACHING (1%) > NEUTRAL. Cross last 2 closes.
// ─────────────────────────────────────────────────────────────────────────────
function computeSignal(
  closes: number[],
  sma20: (number | null)[],
  sma50: (number | null)[],
  sma200: (number | null)[]
): { signal: Signal; color: SignalColor; note: string } {
  const n = closes.length;
  if (n < 2) return { signal: "NEUTRAL", color: "slate", note: "Loading" };

  const price = closes[n - 1];
  const prevPrice = closes[n - 2];
  const s20 = sma20[n - 1];
  const s20Prev = sma20[n - 2];
  const s50 = sma50[n - 1];
  const s200 = sma200[n - 1];

  // Cross detection vs SMA20 (priority signals)
  if (s20 != null && s20Prev != null) {
    const crossedUp = prevPrice < s20Prev && price >= s20;
    const crossedDn = prevPrice > s20Prev && price <= s20;
    if (crossedUp) return { signal: "BOUNCE", color: "green", note: "Bounce off SMA20" };
    if (crossedDn) return { signal: "REJECTION", color: "red", note: "Rejected at SMA20" };
  }

  // Proximity scan across all three SMAs — closest wins
  const targets = [
    { name: "SMA20", val: s20 },
    { name: "SMA50", val: s50 },
    { name: "SMA200", val: s200 },
  ].filter((t): t is { name: string; val: number } => t.val != null && Number.isFinite(t.val));

  if (targets.length === 0) return { signal: "NEUTRAL", color: "slate", note: "Insufficient data" };

  let nearest = { name: "", dist: Infinity };
  for (const t of targets) {
    const d = Math.abs(price - t.val) / t.val;
    if (d < nearest.dist) nearest = { name: t.name, dist: d };
  }

  if (nearest.dist <= 0.002) return { signal: "AT_SMA", color: "amber", note: `At ${nearest.name}` };
  if (nearest.dist <= 0.01) return { signal: "APPROACHING", color: "amber", note: `Near ${nearest.name}` };
  return { signal: "NEUTRAL", color: "green", note: "Clear" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CHART RENDERER — Recharts, no animations for fast re-renders
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. COMPONENT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
export default function MiniChartWidget({
  ticker = "SMH",
  interval = "1D",
  refreshMs = 60_000,
  height = 120,
  title,
}: Props) {
  const [symbol, setSymbol] = useState(ticker.toUpperCase());
  const [input, setInput] = useState(symbol);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external ticker prop change → internal state
  useEffect(() => {
    const t = ticker.toUpperCase();
    setSymbol(t);
    setInput(t);
  }, [ticker]);

  const { data: candles = [], isLoading, error } = useCandles(symbol, interval, refreshMs);

  // ── Derived data (memoized — only recomputes when candles change)
  const { rows, signal, lastPrice, lastChange } = useMemo(() => {
    const closes = candles.map(c => c.close);
    const sma20 = rollingSMA(closes, 20);
    const sma50 = rollingSMA(closes, 50);
    const sma200 = rollingSMA(closes, 200);
    const rows: ChartRow[] = closes.map((p, i) => ({
      i,
      price: p,
      sma20: sma20[i],
      sma50: sma50[i],
      sma200: sma200[i],
    }));
    const signal = computeSignal(closes, sma20, sma50, sma200);
    const lastPrice = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const lastChange = lastPrice != null && prev != null ? ((lastPrice - prev) / prev) * 100 : null;
    return { rows, signal, lastPrice, lastChange };
  }, [candles]);

  // ── Handlers
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

  const changeColor = lastChange == null ? "text-slate-gray" : lastChange >= 0 ? "text-signal-green" : "text-signal-red";

  return (
    <div className="border border-ink-line/80 bg-ink-deep/40 rounded-sm p-3 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass[signal.color]}`} title={signal.note} aria-label={signal.note} />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); inputRef.current?.blur(); } }}
            spellCheck={false}
            className="w-16 bg-transparent text-[14px] font-mono-num font-semibold uppercase tracking-wider outline-none focus:text-neon-blue text-soft-white"
            data-testid={`input-minichart-ticker-${title ?? symbol}`}
            aria-label="Ticker symbol"
          />
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {lastPrice != null && (
            <>
              <span className="font-mono-num tabular-nums text-soft-white">${lastPrice.toFixed(2)}</span>
              {lastChange != null && (
                <span className={`font-mono-num tabular-nums ${changeColor}`}>{lastChange >= 0 ? "+" : ""}{lastChange.toFixed(2)}%</span>
              )}
            </>
          )}
          <a
            href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors"
            title="Open in TradingView"
            data-testid={`link-tv-${symbol}`}
          >TV</a>
          <a
            href={`https://finviz.com/quote.ashx?t=${symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-wider text-slate-gray hover:text-neon-blue transition-colors"
            title="Open in Finviz"
            data-testid={`link-fv-${symbol}`}
          >FV</a>
        </div>
      </div>

      {/* Chart */}
      <div style={{ height }} className="relative">
        {isLoading && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-slate-gray">Loading…</div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-signal-red">{(error as any)?.message || "Fetch error"}</div>
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
        <span className="text-soft-white/70">{signal.note}</span>
      </div>
    </div>
  );
}
