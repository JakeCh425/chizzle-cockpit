// PR 3e — §Q3/§Q4 Multi-Timeframe Learning Chart.
// Bars come from /api/swing/bars; every marker, level and zone comes from the
// shared SwingDecision.chart overlay (never computed here). Indicators (SMA/BB)
// are plain visual overlays. Analysis / practice only.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import type { ChartMarker, ChartLevel, ChartZone, SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL } from "@shared/swingDecision";
import { DATA_TONE, fmtCT, swingGet, type BarsResp } from "@/lib/swing";
import { expiredExplainer } from "@shared/tradeSummary";

export const TFS = ["15m", "30m", "1H", "4H", "D", "W"] as const;
export type Tf = typeof TFS[number];
const TF_LABEL: Record<Tf, string> = { "15m": "15m", "30m": "30m", "1H": "1H", "4H": "4H", D: "Daily", W: "Weekly" };
const RANGES = ["5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
const DEFAULT_RANGE: Record<Tf, typeof RANGES[number]> = { "15m": "5D", "30m": "5D", "1H": "1M", "4H": "3M", D: "1Y", W: "ALL" };
const TYPES = ["Candles", "Hollow", "Line", "Area"] as const;

export const TF_GUIDE: Record<Tf, string> = {
  W: "Use Weekly to understand the major trend and important long-term support and resistance. A Weekly reclaim is only confirmed after Friday’s close.",
  D: "Use Daily to judge whether a swing trend is healthy, reclaiming support, or pulling back into a potential setup zone.",
  "4H": "Use 4H to identify the actual swing setup: reclaim, base, breakout-retest, higher low, hammer, engulfing, or continuation.",
  "1H": "Use 1H to time the entry trigger: wait for a closed confirmation above the setup high or retest reversal high.",
  "15m": "Use intraday timeframes for visual learning and finer timing only. Do not let a 15m or 30m candle override a missing 1H/4H confirmation unless Intraday Learning Mode is explicitly enabled.",
  "30m": "Use intraday timeframes for visual learning and finer timing only. Do not let a 15m or 30m candle override a missing 1H/4H confirmation unless Intraday Learning Mode is explicitly enabled.",
};

export const MARKER_COLOR: Record<ChartMarker["kind"], string> = {
  FORMING: "#facc15", CONFIRMED: "#3b82f6", READY: "#22c55e", EXTENDED: "#f97316", INVALIDATED: "#f87171", EXPIRED: "#94a3b8",
};
const LEVEL_COLOR: Record<ChartLevel["kind"], string> = { ENTRY: "#22c55e", STOP: "#ef4444", T1: "#14b8a6", T2: "#a855f7" };
const ZONE_COLOR: Record<ChartZone["kind"], string> = { RETEST: "rgba(56,189,248,0.14)", SUPPORT: "rgba(34,197,94,0.08)", RESISTANCE: "rgba(248,113,113,0.08)" };
const ZONE_EDGE: Record<ChartZone["kind"], string> = { RETEST: "#38bdf8", SUPPORT: "#22c55e", RESISTANCE: "#f87171" };

function sma(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = []; let s = 0;
  vals.forEach((v, i) => { s += v; if (i >= n) s -= vals[i - n]; out.push(i >= n - 1 ? s / n : null); });
  return out;
}
function bb(vals: number[], n = 20, k = 2) {
  const m = sma(vals, n);
  return vals.map((_, i) => {
    if (m[i] == null) return null;
    const w = vals.slice(i - n + 1, i + 1), mu = m[i]!;
    const sd = Math.sqrt(w.reduce((a, x) => a + (x - mu) ** 2, 0) / n);
    return { u: mu + k * sd, m: mu, l: mu - k * sd };
  });
}
const ctFmt = (t: number, withTime: boolean) =>
  new Date(t * 1000).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });

type Overlay = "sma20" | "sma50" | "sma200" | "bb" | "volume" | "sr" | "plan" | "markers" | "ext";
const OVERLAY_LABEL: Record<Overlay, string> = { sma20: "SMA20", sma50: "SMA50", sma200: "SMA200", bb: "Bollinger", volume: "Volume", sr: "S/R zones", plan: "Plan levels", markers: "Markers", ext: "Extended hours" };

/** SMA key — colors match the lines drawn on the chart. */
export const SMA_META = [
  { key: "sma20" as const, n: 20, label: "SMA 20", color: "#fbbf24", role: "Short-term trend", desc: "Average close of the last 20 bars. Price holding above it = short-term momentum; the engine uses it as the trailing-stop reference." },
  { key: "sma50" as const, n: 50, label: "SMA 50", color: "#60a5fa", role: "Medium-term trend", desc: "Average close of the last 50 bars. Pullbacks that hold it keep the swing trend intact." },
  { key: "sma200" as const, n: 200, label: "SMA 200", color: "#e879f9", role: "Long-term trend", desc: "Average close of the last 200 bars. Above = long-term uptrend; below = defensive." },
];
type SmaKey = typeof SMA_META[number]["key"];

export interface SwingChartProps {
  decision: SwingDecision | undefined;
  tf: Tf; onTf: (t: Tf) => void;
  scope: "CURRENT" | "LAST5" | "ALL"; onScope: (s: "CURRENT" | "LAST5" | "ALL") => void;
  intradayLearningMode?: boolean;
  onMarker: (m: ChartMarker) => void;
  selectedMarkerId?: string | null;
}

export default function SwingChart({ decision, tf, onTf, scope, onScope, intradayLearningMode, onMarker, selectedMarkerId }: SwingChartProps) {
  const symbol = decision?.symbol;
  const [range, setRange] = useState<typeof RANGES[number]>(DEFAULT_RANGE[tf]);
  const [type, setType] = useState<typeof TYPES[number]>("Candles");
  const [ov, setOv] = useState<Record<Overlay, boolean>>({ sma20: true, sma50: true, sma200: false, bb: false, volume: true, sr: true, plan: true, markers: true, ext: false });
  const [tip, setTip] = useState<{ title: string; lines: string[] } | null>(null);
  // Crosshair readout for the SMA key + hover callout when the cursor is on an SMA line.
  const [smaHover, setSmaHover] = useState<{ vals: Partial<Record<SmaKey, number>>; hit: SmaKey | null; x: number; y: number } | null>(null);
  const [smaLast, setSmaLast] = useState<Partial<Record<SmaKey, number>>>({});
  useEffect(() => { setRange(DEFAULT_RANGE[tf]); }, [tf]);

  const bars = useQuery<BarsResp>({
    queryKey: ["/api/swing/bars", symbol ?? "", tf, range, ov.ext ? "1" : "0"],
    queryFn: () => swingGet<BarsResp>(`/api/swing/bars/${symbol}?tf=${tf}&range=${range}${ov.ext ? "&extended=1" : ""}`),
    enabled: !!symbol, staleTime: 60_000, retry: false,
  });

  const boxRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<any> | null>(null);
  const data = bars.data?.bars ?? [];
  const intraday = tf === "15m" || tf === "30m" || tf === "1H" || tf === "4H";

  // Markers snapped to the nearest displayed bar at or before the marker's bar time.
  const snapped = useMemo(() => {
    const ms = decision?.chart?.markers ?? [];
    if (!data.length) return [] as (ChartMarker & { at: number })[];
    return ms.map((m) => {
      let at = data[0].t;
      for (const b of data) { if (b.t <= m.time) at = b.t; else break; }
      return m.time < data[0].t ? null : { ...m, at };
    }).filter(Boolean) as (ChartMarker & { at: number })[];
  }, [decision, data]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !data.length) return;
    const chart = createChart(el, {
      height: 380, autoSize: true,
      layout: { background: { color: "#050a13" }, textColor: "#94a3b8", fontSize: 11 },
      grid: { vertLines: { color: "#111a2b" }, horzLines: { color: "#111a2b" } },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: intraday, secondsVisible: false,
        tickMarkFormatter: (t: Time) => ctFmt(Number(t), false) },
      localization: { timeFormatter: (t: Time) => ctFmt(Number(t), intraday) + (intraday ? " CT" : "") },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;
    const closes = data.map((b) => b.c);
    const times = data.map((b) => b.t as UTCTimestamp);
    let main: ISeriesApi<any>;
    if (type === "Line") { main = chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2 }); main.setData(data.map((b) => ({ time: b.t as UTCTimestamp, value: b.c }))); }
    else if (type === "Area") { main = chart.addSeries(AreaSeries, { lineColor: "#38bdf8", topColor: "rgba(56,189,248,0.3)", bottomColor: "rgba(56,189,248,0.02)", lineWidth: 2 }); main.setData(data.map((b) => ({ time: b.t as UTCTimestamp, value: b.c }))); }
    else {
      const hollow = type === "Hollow";
      main = chart.addSeries(CandlestickSeries, {
        upColor: hollow ? "rgba(0,0,0,0)" : "#22c55e", downColor: "#ef4444", borderUpColor: "#22c55e", borderDownColor: "#ef4444", wickUpColor: "#22c55e", wickDownColor: "#ef4444", borderVisible: true,
      });
      // The unfinished bar is drawn faded so it is never mistaken for a closed confirmation.
      main.setData(data.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c,
        ...(b.closed ? {} : { color: "rgba(148,163,184,0.35)", borderColor: "#94a3b8", wickColor: "#94a3b8" }) })));
    }
    mainRef.current = main;
    if (ov.volume) {
      const v = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      v.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(data.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: b.c >= b.o ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)" })));
    }
    const line = (vals: (number | null)[], color: string, style = LineStyle.Solid) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(vals.map((v, i) => (v == null ? { time: times[i] } : { time: times[i], value: v })) as any);
    };
    const smaSeries: { key: SmaKey; s: ISeriesApi<any> }[] = [];
    const last: Partial<Record<SmaKey, number>> = {};
    for (const m of SMA_META) {
      if (!ov[m.key]) continue;
      const vals = sma(closes, m.n);
      const sr = chart.addSeries(LineSeries, { color: m.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, crosshairMarkerRadius: 3, title: "" });
      sr.setData(vals.map((v, i) => (v == null ? { time: times[i] } : { time: times[i], value: v })) as any);
      smaSeries.push({ key: m.key, s: sr });
      const lv = [...vals].reverse().find((v) => v != null); if (lv != null) last[m.key] = lv;
    }
    setSmaLast(last);
    chart.subscribeCrosshairMove((p) => {
      if (!p.point || p.time == null) { setSmaHover(null); return; }
      const vals: Partial<Record<SmaKey, number>> = {};
      let hit: SmaKey | null = null, best = 7; // px tolerance for "on the line"
      for (const { key, s: sr } of smaSeries) {
        const v = (p.seriesData.get(sr) as any)?.value;
        if (v == null) continue;
        vals[key] = v;
        const y = sr.priceToCoordinate(v);
        if (y != null && Math.abs(y - p.point.y) < best) { best = Math.abs(y - p.point.y); hit = key; }
      }
      setSmaHover({ vals, hit, x: p.point.x, y: p.point.y });
    });
    if (ov.bb) { const b = bb(closes); line(b.map((x) => x?.u ?? null), "#64748b", LineStyle.Dotted); line(b.map((x) => x?.l ?? null), "#64748b", LineStyle.Dotted); }

    const overlay = decision?.chart;
    if (ov.plan && overlay) for (const l of overlay.levels.filter((x) => x.current)) {
      main.createPriceLine({ price: l.price, color: LEVEL_COLOR[l.kind], lineWidth: l.kind === "ENTRY" ? 2 : 1,
        lineStyle: l.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.label });
    }
    if (overlay) for (const z of overlay.zones.filter((x) => x.current && (x.kind === "RETEST" ? ov.plan : ov.sr))) {
      main.createPriceLine({ price: z.high, color: ZONE_EDGE[z.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: z.kind === "RETEST" ? z.label : "" });
      main.createPriceLine({ price: z.low, color: ZONE_EDGE[z.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    }
    if (ov.markers && snapped.length) {
      // Cluster: one visible marker per bar; the rest stay in the accessible list below.
      const byBar = new Map<number, (ChartMarker & { at: number })[]>();
      for (const m of snapped) byBar.set(m.at, [...(byBar.get(m.at) ?? []), m]);
      const ms: SeriesMarker<Time>[] = Array.from(byBar.entries()).sort((a, b) => a[0] - b[0]).map(([at, g]) => {
        const m = g.find((x) => x.current) ?? g[g.length - 1];
        const up = m.kind === "READY" || m.kind === "CONFIRMED" || m.kind === "FORMING";
        return { time: at as UTCTimestamp, position: up ? "belowBar" : "aboveBar", color: MARKER_COLOR[m.kind],
          shape: m.kind === "READY" ? "arrowUp" : m.kind === "FORMING" ? "circle" : m.kind === "CONFIRMED" ? "square" : "arrowDown",
          text: g.length > 1 ? `${m.label} (+${g.length - 1})` : m.label, size: m.id === selectedMarkerId ? 2 : 1 };
      });
      createSeriesMarkers(main, ms);
    }
    chart.subscribeClick((p) => {
      if (p.time == null) return;
      const hit = snapped.filter((m) => m.at === Number(p.time));
      if (hit.length) onMarker(hit.find((x) => x.current) ?? hit[hit.length - 1]);
    });

    // Translucent zone bands (DOM overlay, repositioned as the scale moves).
    const zones = (overlay?.zones ?? []).filter((x) => x.current && (x.kind === "RETEST" ? ov.plan : ov.sr));
    const drawBands = () => {
      const host = bandRef.current; if (!host) return;
      host.innerHTML = "";
      for (const z of zones) {
        const y1 = main.priceToCoordinate(z.high), y2 = main.priceToCoordinate(z.low);
        if (y1 == null || y2 == null) continue;
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;left:0;right:56px;top:${Math.min(y1, y2)}px;height:${Math.max(2, Math.abs(y2 - y1))}px;background:${ZONE_COLOR[z.kind]};pointer-events:none`;
        host.appendChild(d);
      }
    };
    chart.timeScale().fitContent();
    const raf = () => requestAnimationFrame(drawBands);
    chart.timeScale().subscribeVisibleLogicalRangeChange(raf);
    const ro = new ResizeObserver(raf); ro.observe(el);
    setTimeout(drawBands, 60);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; mainRef.current = null; if (bandRef.current) bandRef.current.innerHTML = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type, ov, decision, snapped, selectedMarkerId, intraday]);

  const b = bars.data;
  const visualOnly = (tf === "15m" || tf === "30m") && !intradayLearningMode;
  const d = decision;
  const chips = d ? [
    { k: "Weekly regime", v: d.weeklyRegime + (d.weeklyReclaimForming ? " (reclaim forming)" : "") },
    { k: "Daily regime", v: d.dailyRegime },
    { k: "4H setup", v: d.setupType ? `${d.setupType.replace(/_/g, " ")} — ${STATUS_LABEL[d.setupStatus]}` : STATUS_LABEL[d.setupStatus] },
    { k: "1H confirmation", v: d.setupStatus === "READY_TO_TRADE" ? "Closed above trigger" : d.lastCompletedBar1H ? `Last closed 1H ${fmtCT(d.lastCompletedBar1H)}` : "—" },
  ] : [];

  const btn = (on: boolean) => `px-2 py-0.5 rounded border text-[11px] font-mono ${on ? "border-neon-blue text-soft-white bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-soft-white"}`;
  return (
    <div className="space-y-2" data-testid="swing-chart">
      {/* Header (§Q3) */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono" data-testid="swing-chart-header">
        <span className="text-soft-white font-bold">{symbol ?? "—"}</span>
        <span className="text-neon-blue font-bold" data-testid="text-chart-tf">{TF_LABEL[tf]}</span>
        <span className="text-slate-gray">{b?.session === "EXTENDED" ? "Extended hours" : "RTH"}</span>
        <span className="text-slate-gray">src {b?.source ?? d?.dataSource ?? "—"}</span>
        <span className="text-slate-gray">{d?.exchange ?? b?.exchange ?? ""}</span>
        <span className="text-slate-gray">quote {fmtCT(d?.quoteTimestamp ?? b?.quoteTimestamp)}</span>
        <span className="text-slate-gray">last closed bar {fmtCT(b?.lastCompletedBar)}</span>
        {(d?.dataStatus || b?.dataStatus) && (
          <span className={`px-1.5 rounded border ${DATA_TONE[d?.dataStatus ?? b!.dataStatus] ?? ""}`} data-testid="badge-chart-data">{d?.dataStatus ?? b?.dataStatus}</span>
        )}
      </div>
      {chips.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5" data-testid="swing-context-chips">
          {chips.map((c) => (
            <div key={c.k} className="rounded border border-ink-line bg-ink-deep px-2 py-1">
              <div className="text-[9.5px] uppercase tracking-wide text-slate-gray font-mono">{c.k}</div>
              <div className="text-[11px] text-soft-white truncate" title={c.v}>{c.v}</div>
            </div>
          ))}
        </div>
      )}
      {d?.setupStatus === "SIGNAL_EXPIRED" && <ExpiredExplainer d={d} />}
      {/* Controls */}
      <div className="flex flex-wrap gap-1 items-center" role="toolbar" aria-label="Chart controls">
        {TFS.map((t) => <button key={t} className={btn(tf === t)} onClick={() => onTf(t)} aria-pressed={tf === t} data-testid={`button-tf-${t}`}>{TF_LABEL[t]}</button>)}
        <span className="w-px h-4 bg-ink-line mx-1" />
        {RANGES.map((r) => <button key={r} className={btn(range === r)} onClick={() => setRange(r)} aria-pressed={range === r} data-testid={`button-range-${r}`}>{r === "ALL" ? "All" : r}</button>)}
        <span className="w-px h-4 bg-ink-line mx-1" />
        {TYPES.map((t) => <button key={t} className={btn(type === t)} onClick={() => setType(t)} aria-pressed={type === t} data-testid={`button-type-${t}`}>{t}</button>)}
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {(Object.keys(OVERLAY_LABEL) as Overlay[]).map((k) => (
          <button key={k} className={`${btn(ov[k])} inline-flex items-center gap-1`} onClick={() => setOv({ ...ov, [k]: !ov[k] })} aria-pressed={ov[k]} data-testid={`toggle-overlay-${k}`}>
            {SMA_META.find((m) => m.key === k) && <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ background: SMA_META.find((m) => m.key === k)!.color }} />}
            {OVERLAY_LABEL[k]}
          </button>
        ))}
        <span className="w-px h-4 bg-ink-line mx-1" />
        <span className="text-[10px] text-slate-gray font-mono">History</span>
        {(["CURRENT", "LAST5", "ALL"] as const).map((s) => (
          <button key={s} className={btn(scope === s)} onClick={() => onScope(s)} aria-pressed={scope === s} data-testid={`button-scope-${s}`}>{s === "CURRENT" ? "Current" : s === "LAST5" ? "Last 5" : "All"}</button>
        ))}
      </div>
      {visualOnly && (
        <div className="rounded border border-signal-amber/40 bg-signal-amber/5 px-2 py-1 text-[11px] text-signal-amber font-mono" role="note" data-testid="note-visual-only">
          {b?.visualOnlyNote ?? "15m / 30m are visual only — they never confirm a setup unless Intraday Learning Mode is on."}
        </div>
      )}
      <div className="relative rounded border border-ink-line overflow-hidden" style={{ height: 380 }}>
        <div ref={boxRef} className="absolute inset-0" />
        <div ref={bandRef} className="absolute inset-0 pointer-events-none" />
        {data.length > 0 && SMA_META.some((m) => ov[m.key]) && (
          <div className="absolute top-1.5 left-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 rounded bg-[#050a13]/85 px-2 py-1 text-[10.5px] font-mono pointer-events-none" data-testid="legend-sma">
            {SMA_META.filter((m) => ov[m.key]).map((m) => {
              const v = smaHover?.vals[m.key] ?? smaLast[m.key];
              const on = smaHover?.hit === m.key;
              return (
                <span key={m.key} className="flex items-center gap-1" style={{ color: on ? "#f1f5f9" : "#94a3b8" }} data-testid={`legend-${m.key}`}>
                  <span className="inline-block w-3 rounded-full" style={{ height: on ? 4 : 2, background: m.color }} />
                  <span style={{ color: m.color }} className="font-bold">{m.label}</span>
                  <span>{m.role.replace(" trend", "")}</span>
                  <span style={{ color: "#f1f5f9" }}>{v != null ? `$${v.toFixed(2)}` : "—"}</span>
                </span>
              );
            })}
          </div>
        )}
        {smaHover?.hit && (() => {
          const m = SMA_META.find((x) => x.key === smaHover.hit)!;
          const v = smaHover.vals[m.key];
          const w = boxRef.current?.clientWidth ?? 800;
          const left = Math.min(Math.max(8, smaHover.x + 14), w - 250);
          const top = Math.max(30, smaHover.y - 70);
          return (
            <div className="absolute z-20 w-[236px] rounded border bg-[#0b1220] px-2 py-1.5 text-[11px] shadow-lg pointer-events-none" style={{ left, top, borderColor: m.color }} role="tooltip" data-testid="tooltip-sma">
              <div className="flex items-center gap-1.5 font-mono font-bold" style={{ color: m.color }}>
                <span className="inline-block w-3 h-1 rounded-full" style={{ background: m.color }} /> {m.label} · {m.role}
              </div>
              <div className="font-mono" style={{ color: "#f1f5f9" }}>{v != null ? `$${v.toFixed(2)}` : "—"} on this {TF_LABEL[tf]} bar</div>
              <div className="leading-snug mt-0.5" style={{ color: "#cbd5e1" }}>{m.desc}</div>
            </div>
          );
        })()}
        {(bars.isLoading || !symbol) && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-gray">Loading bars…</div>}
        {!bars.isLoading && symbol && !data.length && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300" data-testid="text-chart-error">
            {b?.error ?? (bars.error as Error)?.message ?? "Data unavailable"} — {symbol} stays on the watchlist and re-checks on the next closed 1H bar.
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-gray" data-testid="text-tf-guide"><span className="text-soft-white font-mono">{TF_LABEL[tf]} guide:</span> {TF_GUIDE[tf]}</p>
      {/* Accessible marker list — every chart marker is also a keyboard-reachable button */}
      {ov.markers && (decision?.chart?.markers.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Chart markers" data-testid="list-markers">
          {decision!.chart!.markers.map((m) => (
            <button key={m.id} onClick={() => onMarker(m)} onMouseEnter={() => setTip({ title: m.label, lines: m.tooltip })} onMouseLeave={() => setTip(null)}
              onFocus={() => setTip({ title: m.label, lines: m.tooltip })} onBlur={() => setTip(null)}
              className={`px-1.5 py-0.5 rounded border text-[10.5px] font-mono ${m.id === selectedMarkerId ? "bg-white/10" : ""}`}
              style={{ borderColor: MARKER_COLOR[m.kind], color: MARKER_COLOR[m.kind], opacity: m.current ? 1 : 0.65 }}
              aria-label={`${m.label}, ${m.timeframe}, ${ctFmt(m.time, true)}${m.current ? ", current" : ", history"}`} data-testid={`button-marker-${m.id}`}>
              {m.label} · {m.timeframe} · {ctFmt(m.time, m.timeframe === "1H" || m.timeframe === "4H")}
            </button>
          ))}
        </div>
      )}
      {ov.plan && (decision?.chart?.levels.filter((l) => l.current).length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Plan levels">
          {decision!.chart!.levels.filter((l) => l.current).map((l) => (
            <span key={l.id} tabIndex={0} onMouseEnter={() => setTip({ title: l.label, lines: l.tooltip })} onMouseLeave={() => setTip(null)}
              onFocus={() => setTip({ title: l.label, lines: l.tooltip })} onBlur={() => setTip(null)}
              className="px-1.5 py-0.5 rounded border text-[10.5px] font-mono" style={{ borderColor: LEVEL_COLOR[l.kind], color: LEVEL_COLOR[l.kind], borderStyle: l.style === "dashed" ? "dashed" : "solid" }}
              data-testid={`level-${l.kind}`}>{l.label}</span>
          ))}
          {decision!.chart!.zones.filter((z) => z.current && z.kind === "RETEST").map((z) => (
            <span key={z.id} tabIndex={0} onMouseEnter={() => setTip({ title: z.label, lines: z.tooltip })} onMouseLeave={() => setTip(null)}
              className="px-1.5 py-0.5 rounded border border-sky-400/60 text-sky-300 text-[10.5px] font-mono bg-sky-400/10" data-testid="zone-retest">{z.label}</span>
          ))}
        </div>
      )}
      {tip && (
        <div className="rounded border border-ink-line bg-ink-deep px-2 py-1.5 text-[11px]" role="tooltip" data-testid="chart-tooltip">
          <div className="text-soft-white font-mono font-bold">{tip.title}</div>
          <ul className="list-disc pl-4 text-slate-gray">{tip.lines.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** Why a card shows Signal Expired, and when it can reset. */
export function ExpiredExplainer({ d }: { d: SwingDecision }) {
  const ex = expiredExplainer(d, Date.now());
  if (!ex) return null;
  return (
    <div className="rounded border border-slate-500/40 bg-slate-500/5 px-2.5 py-1.5 text-[11px] space-y-0.5" data-testid="explainer-expired">
      <div><span className="font-mono font-bold text-slate-300">WHY EXPIRED:</span> <span className="text-soft-white/90">{ex.why}</span></div>
      <div><span className="font-mono font-bold text-slate-300">WHEN IT RESETS:</span> <span className="text-soft-white/90">{ex.reset}</span></div>
      {ex.whatIf && <div><span className="font-mono font-bold text-neon-blue">3-BAR WHAT-IF:</span> <span className="text-soft-white/90">{ex.whatIf}</span></div>}
      <div className="text-slate-gray">{ex.tip}</div>
    </div>
  );
}
