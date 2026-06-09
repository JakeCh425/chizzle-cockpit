// ─────────────────────────────────────────────────────────────────────────────
// FullChartModal.tsx
// Full-screen chart inspector — larger Recharts ComposedChart with SMA20/50/200
// overlays, volume bars, interval switching, and A-score badge.
//
// Opens from MiniChartWidget when the user clicks the badge or chart area.
// Mirrors CloseModal's container pattern (fixed inset, backdrop, click-outside).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart, Line, Bar, ResponsiveContainer, YAxis, XAxis, Tooltip,
  CartesianGrid, ReferenceDot,
} from "recharts";
import { X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { computeSMAs, getAScore, type SignalColor } from "@/lib/sma";

// SMA hex tokens (mirrors MiniChartWidget).
const SMA_LABEL_COLOR = {
  sma20: "#22C55E",
  sma50: "#F59E0B",
  sma200: "#EF4444",
} as const;

interface SmaVisibility { sma20: boolean; sma50: boolean; sma200: boolean }
// Recharts' Formatter accepts ValueType = string | number | (string|number)[].
function fmtTooltip(v: number | string | Array<number | string>, name: unknown): [string, string] {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return [Number.isFinite(n) ? n.toFixed(2) : String(v), String(name ?? "")];
}
function fmtVolume(v: number | string | Array<number | string>): [string, string] {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v);
  return [Number.isFinite(n) ? n.toLocaleString() : String(v), "Vol"];
}

type Candle = { time: number; close: number; volume?: number };
export type Interval = "1D" | "4H" | "1H" | "30M" | "5M";

interface Props {
  open: boolean;
  symbol: string;
  defaultInterval?: Interval;
  onClose: () => void;
}

const INTERVALS: Interval[] = ["5M", "30M", "1H", "4H", "1D"];

// Window of bars rendered. The user can pinch to fewer via the buttons.
const WINDOW_PRESETS: { key: string; label: string; bars: number }[] = [
  { key: "30",  label: "30D",  bars: 30 },
  { key: "60",  label: "60D",  bars: 60 },
  { key: "90",  label: "90D",  bars: 90 },
  { key: "all", label: "All",  bars: 400 },
];

function badgeBg(color: SignalColor): string {
  switch (color) {
    case "green": return "bg-signal-green/20 text-signal-green border-signal-green/40";
    case "amber": return "bg-signal-amber/20 text-signal-amber border-signal-amber/40";
    case "red":   return "bg-signal-red/20 text-signal-red border-signal-red/40";
    default:      return "bg-slate-gray/20 text-slate-gray border-slate-gray/40";
  }
}

export default function FullChartModal({ open, symbol, defaultInterval = "1D", onClose }: Props) {
  const [interval, setInterval] = useState<Interval>(defaultInterval);
  const [windowBars, setWindowBars] = useState<number>(60);
  const [visible, setVisible] = useState<SmaVisibility>({ sma20: true, sma50: true, sma200: true });
  const chartHostRef = useRef<HTMLDivElement>(null);

  // Refresh interval when reopening with a different default.
  useEffect(() => { if (open) setInterval(defaultInterval); }, [open, defaultInterval]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { data: candles = [], isLoading, error } = useQuery<Candle[]>({
    queryKey: ["/api/candles", symbol, interval, "full"],
    queryFn: async ({ signal }) => {
      const res = await apiRequest("GET", `/api/candles/${symbol}?interval=${interval}`, undefined, signal);
      return res.json();
    },
    enabled: open && !!symbol,
    staleTime: 30_000,
    refetchInterval: open ? 60_000 : false,
  });

  const { rows, aScore, lastPrice, lastChange, signalMarkers, sma20Last, sma50Last, sma200Last } = useMemo(() => {
    const closes = candles.map(c => c.close);
    const { sma20, sma50, sma200 } = computeSMAs(closes);
    const fullRows = candles.map((c, i) => ({
      i,
      time: c.time,
      price: c.close,
      sma20: sma20[i],
      sma50: sma50[i],
      sma200: sma200[i],
      volume: c.volume ?? 0,
      dateLabel: new Date(c.time * 1000).toLocaleDateString(undefined, {
        month: "short", day: "numeric",
        ...(interval !== "1D" ? { hour: "2-digit", minute: "2-digit" } : {}),
      }),
    }));
    const slice = fullRows.slice(-windowBars);

    // Re-index so XAxis labels still line up.
    const rows = slice.map((r, i) => ({ ...r, i }));

    // Signal markers: scan the window for crosses + at-SMA touches.
    const markers: { i: number; price: number; kind: "A4" | "REJ" | "A3" }[] = [];
    for (let k = 1; k < rows.length; k++) {
      const r = rows[k];
      const p = rows[k - 1];
      if (r.sma20 == null || p.sma20 == null) continue;
      if (p.price < p.sma20 && r.price >= r.sma20) {
        markers.push({ i: r.i, price: r.price, kind: "A4" });
      } else if (p.price > p.sma20 && r.price <= r.sma20) {
        markers.push({ i: r.i, price: r.price, kind: "REJ" });
      } else if (Math.abs(r.price - r.sma20) / r.sma20 <= 0.002) {
        markers.push({ i: r.i, price: r.price, kind: "A3" });
      }
    }

    const aScore = getAScore(closes, sma20);
    const lastPrice = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const lastChange = lastPrice != null && prev != null ? ((lastPrice - prev) / prev) * 100 : null;
    const last = (arr: (number | null)[]) => {
      for (let k = arr.length - 1; k >= 0; k--) if (arr[k] != null) return arr[k] as number;
      return null;
    };
    return {
      rows, aScore, lastPrice, lastChange, signalMarkers: markers,
      sma20Last: last(sma20), sma50Last: last(sma50), sma200Last: last(sma200),
    };
  }, [candles, windowBars, interval]);

  const labelItems = useMemo(() => {
    const out: { key: keyof SmaVisibility; label: string; value: number; color: string }[] = [];
    if (sma20Last != null) out.push({ key: "sma20", label: "SMA20", value: sma20Last, color: SMA_LABEL_COLOR.sma20 });
    if (sma50Last != null) out.push({ key: "sma50", label: "SMA50", value: sma50Last, color: SMA_LABEL_COLOR.sma50 });
    if (sma200Last != null) out.push({ key: "sma200", label: "SMA200", value: sma200Last, color: SMA_LABEL_COLOR.sma200 });
    return out.filter(d => visible[d.key]);
  }, [sma20Last, sma50Last, sma200Last, visible]);

  const toggleSma = (key: keyof SmaVisibility) =>
    setVisible(v => ({ ...v, [key]: !v[key] }));

  const errMsg = error instanceof Error ? error.message : "";

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="modal-fullchart-backdrop"
    >
      <div
        className="bg-ink-panel border border-ink-line rounded-sm w-full max-w-6xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-line">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[18px] font-mono-num font-semibold uppercase tracking-wider text-soft-white">
              {symbol}
            </span>
            <span
              className={`px-1.5 py-0.5 text-[10px] font-mono-num uppercase tracking-wider border rounded-sm ${badgeBg(aScore.color)}`}
              title={aScore.tooltip}
              data-testid={`badge-ascore-modal-${symbol}`}
            >{aScore.label}</span>
            {lastPrice != null && (
              <span className="text-[14px] font-mono-num tabular-nums text-soft-white">
                ${lastPrice.toFixed(2)}
                {lastChange != null && (
                  <span className={`ml-2 ${lastChange >= 0 ? "text-signal-green" : "text-signal-red"}`}>
                    {lastChange >= 0 ? "+" : ""}{lastChange.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-gray hover:text-soft-white transition-colors p-1"
            aria-label="Close full chart"
            data-testid="button-close-fullchart"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Toolbar: interval + window pickers */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-ink-line/60 text-[10px] uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <span className="text-slate-gray">Interval</span>
            <div className="flex items-center border border-ink-line/80 rounded-sm overflow-hidden">
              {INTERVALS.map(iv => {
                const active = iv === interval;
                return (
                  <button
                    key={iv}
                    onClick={() => setInterval(iv)}
                    data-testid={`button-modal-interval-${iv}`}
                    className={`px-2 py-1 font-mono-num tracking-wider transition-colors ${
                      active ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
                    }`}
                  >{iv}</button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-gray">Window</span>
            <div className="flex items-center border border-ink-line/80 rounded-sm overflow-hidden">
              {WINDOW_PRESETS.map(w => {
                const active = (w.key === "all" ? rows.length >= 200 : windowBars === w.bars);
                return (
                  <button
                    key={w.key}
                    onClick={() => setWindowBars(w.bars)}
                    data-testid={`button-modal-window-${w.key}`}
                    className={`px-2 py-1 font-mono-num tracking-wider transition-colors ${
                      active ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:bg-ink-line/40 hover:text-soft-white"
                    }`}
                  >{w.label}</button>
                );
              })}
            </div>
          </div>
          <div className="ml-auto flex gap-4 text-slate-gray">
            <button
              type="button"
              onClick={() => toggleSma("sma20")}
              aria-pressed={visible.sma20}
              aria-label={`Toggle SMA20 line ${visible.sma20 ? "off" : "on"}`}
              className={`flex items-center gap-1 transition-opacity ${visible.sma20 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma20`}
            ><i className="w-2 h-px bg-neon-blue inline-block" aria-hidden="true" />20</button>
            <button
              type="button"
              onClick={() => toggleSma("sma50")}
              aria-pressed={visible.sma50}
              aria-label={`Toggle SMA50 line ${visible.sma50 ? "off" : "on"}`}
              className={`flex items-center gap-1 transition-opacity ${visible.sma50 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma50`}
            ><i className="w-2 h-px bg-signal-amber inline-block" aria-hidden="true" />50</button>
            <button
              type="button"
              onClick={() => toggleSma("sma200")}
              aria-pressed={visible.sma200}
              aria-label={`Toggle SMA200 line ${visible.sma200 ? "off" : "on"}`}
              className={`flex items-center gap-1 transition-opacity ${visible.sma200 ? "opacity-100" : "opacity-40"} hover:text-soft-white`}
              data-testid={`button-modal-legend-sma200`}
            ><i className="w-2 h-px bg-signal-red inline-block" aria-hidden="true" />200</button>
          </div>
        </div>

        {/* Chart body */}
        <div className="flex-1 min-h-0 p-4 flex flex-col gap-2">
          {isLoading && rows.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[11px] uppercase tracking-wider text-slate-gray">
              Loading chart…
            </div>
          )}
          {error && (
            <div className="flex-1 flex items-center justify-center text-[11px] uppercase tracking-wider text-signal-red">
              {errMsg.slice(0, 120) || "Fetch error"}
            </div>
          )}
          {rows.length > 0 && (
            <>
              {/* Price + SMAs (main pane) */}
              <div
                ref={chartHostRef}
                className="flex-1 min-h-[260px] relative"
                role="img"
                aria-label={`${symbol} price chart, ${interval} timeframe, ${rows.length} bars` + (lastPrice != null ? `, last ${lastPrice.toFixed(2)}` : "")}
                data-testid={`chart-fullchart-${symbol}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="hsl(var(--ink-line))" strokeOpacity={0.4} vertical={false} />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      yAxisId="price"
                      domain={["auto", "auto"]}
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 10, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      width={48}
                      orientation="right"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--ink-panel))",
                        border: "1px solid hsl(var(--ink-line))",
                        borderRadius: 2,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                      }}
                      formatter={fmtTooltip}
                    />
                    {visible.sma200 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma200" name="SMA200" stroke="hsl(var(--signal-red))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    {visible.sma50 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma50"  name="SMA50"  stroke="hsl(var(--signal-amber))" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    {visible.sma20 && (
                      <Line yAxisId="price" type="monotone" dataKey="sma20"  name="SMA20"  stroke="hsl(var(--neon-blue))"   strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                    )}
                    <Line yAxisId="price" type="monotone" dataKey="price"  name="Price"  stroke="hsl(var(--soft-white))"  strokeWidth={1.75} dot={false} isAnimationActive={false} />
                    {signalMarkers.map((m, idx) => (
                      <ReferenceDot
                        key={idx}
                        yAxisId="price"
                        x={rows[m.i]?.dateLabel}
                        y={m.price}
                        r={4}
                        fill={
                          m.kind === "A4" ? "hsl(var(--signal-green))" :
                          m.kind === "REJ" ? "hsl(var(--signal-red))" :
                          "hsl(var(--signal-amber))"
                        }
                        stroke="hsl(var(--ink-panel))"
                        strokeWidth={1}
                        ifOverflow="hidden"
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                {/* Floating right-edge SMA value pills */}
                <FullChartSmaLabels items={labelItems} />
              </div>

              {/* Volume bars pane */}
              <div className="h-20">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 0, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid stroke="hsl(var(--ink-line))" strokeOpacity={0.3} vertical={false} />
                    <XAxis
                      dataKey="dateLabel"
                      tick={false}
                      stroke="hsl(var(--ink-line))"
                      axisLine={false}
                    />
                    <YAxis
                      yAxisId="vol"
                      domain={[0, "auto"]}
                      tick={{ fill: "hsl(var(--slate-gray))", fontSize: 9, fontFamily: "var(--font-mono)" }}
                      stroke="hsl(var(--ink-line))"
                      width={48}
                      orientation="right"
                      tickFormatter={(v: number) => {
                        if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
                        if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
                        if (v >= 1e3) return (v / 1e3).toFixed(0) + "K";
                        return String(v);
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--ink-panel))",
                        border: "1px solid hsl(var(--ink-line))",
                        borderRadius: 2,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                      }}
                      formatter={fmtVolume}
                    />
                    <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="hsl(var(--slate-gray))" fillOpacity={0.5} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-ink-line/60 text-[10px] uppercase tracking-wider text-slate-gray flex items-center justify-between gap-2">
          <span title={aScore.tooltip}>{aScore.tooltip}</span>
          <div className="flex items-center gap-4">
            <a
              href={`https://www.tradingview.com/chart/?symbol=${symbol}`}
              target="_blank" rel="noopener noreferrer"
              className="hover:text-neon-blue transition-colors"
              data-testid={`link-tv-fullchart-${symbol}`}
            >Open in TradingView</a>
            <a
              href={`https://finviz.com/quote.ashx?t=${symbol}`}
              target="_blank" rel="noopener noreferrer"
              className="hover:text-neon-blue transition-colors"
              data-testid={`link-fv-fullchart-${symbol}`}
            >Finviz</a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Floating right-edge SMA labels (modal version) ─────────────────────────
// Uses absolute top:N% based on price ranking. Since the modal chart has a
// YAxis on the right at width=48, we offset right by ~52px so labels clear it.
function FullChartSmaLabels({
  items,
}: {
  items: { key: string; label: string; value: number; color: string }[];
}) {
  if (items.length === 0) return null;
  // Sort by value desc so the largest sits at the top of the stack.
  const sorted = [...items].sort((a, b) => b.value - a.value);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {sorted.map((d, idx) => (
        <div
          key={d.key}
          className="absolute font-mono-num tabular-nums"
          style={{
            top: `${10 + idx * 18}px`,
            right: "56px",
            fontSize: "11px",
            color: d.color,
            background: "rgba(0,0,0,0.65)",
            borderRadius: "4px",
            padding: "1px 6px",
            lineHeight: "14px",
            whiteSpace: "nowrap",
          }}
        >
          {d.label} · {d.value.toFixed(2)}
        </div>
      ))}
    </div>
  );
}
