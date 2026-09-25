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
import { usePersistentState } from "@/hooks/use-persistent-state";
import { expiredExplainer } from "@shared/tradeSummary";
import { hasPlan, stopLimitFor } from "./TradeTicket";

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
const GUTTER_W = 132;
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
const OV_DEFAULT: Record<Overlay, boolean> = { sma20: true, sma50: true, sma200: false, bb: false, volume: true, sr: true, plan: true, markers: true, ext: false };
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
  /** Focused symbol — lets bars load in parallel with the decision. */
  symbol?: string;
  tf: Tf; onTf: (t: Tf) => void;
  scope: "CURRENT" | "LAST5" | "ALL"; onScope: (s: "CURRENT" | "LAST5" | "ALL") => void;
  intradayLearningMode?: boolean;
  onMarker: (m: ChartMarker) => void;
  selectedMarkerId?: string | null;
  /** True while the matching trade card is hovered — reveals plan levels on the chart. */
  highlight?: boolean;
}

export default function SwingChart({ symbol: symbolProp, decision, tf, onTf, scope, onScope, intradayLearningMode, onMarker, selectedMarkerId, highlight }: SwingChartProps) {
  const symbol = (symbolProp || decision?.symbol || "").toUpperCase() || undefined;
  // Chart controls remember how you last left them (per timeframe for the range).
  const [rangeByTf, setRangeByTf] = usePersistentState<Partial<Record<Tf, typeof RANGES[number]>>>("swing-chart-range", {});
  const range = (rangeByTf[tf] && (RANGES as readonly string[]).includes(rangeByTf[tf]!)) ? rangeByTf[tf]! : DEFAULT_RANGE[tf];
  const setRange = (r: typeof RANGES[number]) => setRangeByTf((m) => ({ ...m, [tf]: r }));
  const [type, setType] = usePersistentState<typeof TYPES[number]>("swing-chart-type", "Candles");
  const [ovSaved, setOv] = usePersistentState<Record<Overlay, boolean>>("swing-chart-overlays", OV_DEFAULT);
  const ov: Record<Overlay, boolean> = useMemo(() => ({ ...OV_DEFAULT, ...ovSaved }), [JSON.stringify(ovSaved)]);
  const [tip, setTip] = useState<{ title: string; lines: string[] } | null>(null);
  // Crosshair readout for the SMA key + hover callout when the cursor is on an SMA line.
  const [smaHover, setSmaHover] = useState<{ vals: Partial<Record<SmaKey, number>>; hit: SmaKey | null; x: number; y: number } | null>(null);
  const [smaLast, setSmaLast] = useState<Partial<Record<SmaKey, number>>>({});
  // Clean chart by default: plan lines, labels and marker text only appear while the
  // chart (or its trade card) is hovered, or when "Keep levels on" is pinned.
  const [hoverChart, setHoverChart] = useState(false);
  const [pinLevels, setPinLevels] = usePersistentState<boolean>("swing-chart-pin-levels", false);
  const showInfo = ov.plan && (hoverChart || !!highlight || pinLevels);
  const gutterOn = ov.plan && hasPlan(decision);
  const showRef = useRef(showInfo); showRef.current = showInfo;
  const planLinesRef = useRef<{ line: any; title: string; axis: boolean }[]>([]);
  const markerRef = useRef<{ plugin: any; full: SeriesMarker<Time>[]; bare: SeriesMarker<Time>[] } | null>(null);
  const drawRef = useRef<() => void>(() => {});

  const bars = useQuery<BarsResp>({
    queryKey: ["/api/swing/bars", symbol ?? "", tf, range, ov.ext ? "1" : "0"],
    queryFn: () => swingGet<BarsResp>(`/api/swing/bars/${symbol}?tf=${tf}&range=${range}${ov.ext ? "&extended=1" : ""}`),
    enabled: !!symbol, staleTime: 60_000, retry: 1, retryDelay: 1500,
    // Keep the current chart on screen while a new range/timeframe loads (same symbol only).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === (symbol ?? "") ? prev : undefined),
  });
  const [waitSec, setWaitSec] = useState(0);
  useEffect(() => {
    if (!bars.isFetching) { setWaitSec(0); return; }
    const t0 = Date.now(); const id = setInterval(() => setWaitSec(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [bars.isFetching]);

  const boxRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
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
    const vis = showRef.current;
    planLinesRef.current = [];
    if (ov.plan && overlay) for (const l of overlay.levels.filter((x) => x.current)) {
      const line = main.createPriceLine({ price: l.price, color: LEVEL_COLOR[l.kind], lineWidth: l.kind === "ENTRY" ? 2 : 1,
        lineStyle: l.style === "dashed" ? LineStyle.Dashed : LineStyle.Solid, lineVisible: vis, axisLabelVisible: false, title: "" });
      planLinesRef.current.push({ line, title: "", axis: false });
    }
    if (overlay) for (const z of overlay.zones.filter((x) => x.current && (x.kind === "RETEST" ? ov.plan : ov.sr))) {
      const retest = z.kind === "RETEST";
      const hi = main.createPriceLine({ price: z.high, color: ZONE_EDGE[z.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, lineVisible: retest ? vis : true, title: "" });
      const lo = main.createPriceLine({ price: z.low, color: ZONE_EDGE[z.kind], lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, lineVisible: retest ? vis : true, title: "" });
      if (retest) planLinesRef.current.push({ line: hi, title: "", axis: false }, { line: lo, title: "", axis: false });
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
      const bare = ms.map((m) => ({ ...m, text: "" }));
      const plugin = createSeriesMarkers(main, bare);
      markerRef.current = { plugin, full: bare, bare };
    } else markerRef.current = null;
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
        if (z.kind === "RETEST" && !showRef.current) continue;
        const y1 = main.priceToCoordinate(z.high), y2 = main.priceToCoordinate(z.low);
        if (y1 == null || y2 == null) continue;
        const d = document.createElement("div");
        d.style.cssText = `position:absolute;left:0;right:56px;top:${Math.min(y1, y2)}px;height:${Math.max(2, Math.abs(y2 - y1))}px;background:${ZONE_COLOR[z.kind]};pointer-events:none`;
        host.appendChild(d);
      }
    };
    // Right-hand label gutter: plan labels sit beside the price scale (never on candles),
    // stacked without overlap, each with a thin leader line to its exact price.
    const gLevels = ov.plan && overlay ? overlay.levels.filter((x) => x.current).map((l) => {
      const r = /([\d.]+R)/.exec(l.label)?.[1];
      const name = l.kind === "ENTRY" ? "Entry" : l.kind === "STOP" ? "Stop" : l.kind;
      return { price: l.price, color: LEVEL_COLOR[l.kind], text: `${name} $${l.price.toFixed(2)}${r ? ` · ${r}` : ""}` };
    }) : [];
    const stopLv = gLevels.length ? overlay?.levels.find((x) => x.current && x.kind === "STOP") : undefined;
    const sl = stopLv ? stopLimitFor(stopLv.price) : null;
    if (sl != null) gLevels.push({ price: sl, color: "#fca5a5", text: `Stop lmt $${sl.toFixed(2)}` });
    const drawGutter = () => {
      const g = gutterRef.current; if (!g) return;
      g.innerHTML = "";
      if (!showRef.current || !gLevels.length) return;
      const H = g.clientHeight, W = g.clientWidth, ROW = 17, LEAD = 14;
      const pts = gLevels.map((l) => ({ ...l, y: main.priceToCoordinate(l.price) as number | null }))
        .filter((l) => l.y != null && (l.y as number) > -40 && (l.y as number) < H + 40)
        .sort((a, b) => (a.y as number) - (b.y as number)) as (typeof gLevels[number] & { y: number })[];
      const pos = pts.map((p) => Math.min(Math.max(p.y, ROW / 2 + 2), H - 26 - ROW / 2));
      for (let i = 1; i < pos.length; i++) if (pos[i] - pos[i - 1] < ROW) pos[i] = pos[i - 1] + ROW;
      const over = pos.length ? pos[pos.length - 1] - (H - 26 - ROW / 2) : 0;
      if (over > 0) for (let i = pos.length - 1; i >= 0; i--) { pos[i] -= over; if (i && pos[i] - pos[i - 1] >= ROW) break; }
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H));
      svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none";
      g.appendChild(svg);
      pts.forEach((p, i) => {
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "path");
        ln.setAttribute("d", `M0 ${p.y} L4 ${p.y} L${LEAD} ${pos[i]}`);
        ln.setAttribute("stroke", p.color); ln.setAttribute("fill", "none"); ln.setAttribute("stroke-width", "1");
        svg.appendChild(ln);
        const d = document.createElement("div");
        d.textContent = p.text;
        d.setAttribute("data-testid", "gutter-label");
        d.style.cssText = `position:absolute;left:${LEAD}px;right:2px;top:${pos[i] - 8}px;height:16px;line-height:16px;padding:0 4px;border-radius:3px;font:600 10px ui-monospace,monospace;white-space:nowrap;overflow:hidden;color:#050a13;background:${p.color}`;
        g.appendChild(d);
      });
    };
    drawRef.current = () => { drawBands(); drawGutter(); };
    chart.timeScale().fitContent();
    const raf = () => requestAnimationFrame(() => { try { drawBands(); drawGutter(); } catch { /* disposed */ } });
    chart.timeScale().subscribeVisibleLogicalRangeChange(raf);
    const ro = new ResizeObserver(raf); ro.observe(el);
    let alive = true;
    const safeDraw = () => { if (alive) { try { drawBands(); drawGutter(); } catch { /* chart already disposed */ } } };
    const tm = setTimeout(safeDraw, 60);
    return () => { alive = false; clearTimeout(tm); drawRef.current = () => {}; planLinesRef.current = []; ro.disconnect(); chart.timeScale().unsubscribeVisibleLogicalRangeChange(raf); chart.remove(); chartRef.current = null; mainRef.current = null; if (bandRef.current) bandRef.current.innerHTML = ""; if (gutterRef.current) gutterRef.current.innerHTML = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, type, ov, decision, snapped, selectedMarkerId, intraday]);

  // Toggle plan info without rebuilding the chart.
  useEffect(() => {
    for (const p of planLinesRef.current) {
      try { p.line.applyOptions({ lineVisible: showInfo, axisLabelVisible: showInfo && p.axis, title: showInfo ? p.title : "" }); } catch { /* chart rebuilt */ }
    }
    const m = markerRef.current;
    if (m) { try { m.plugin.setMarkers(showInfo ? m.full : m.bare); } catch { /* chart rebuilt */ } }
    try { drawRef.current(); } catch { /* chart rebuilding */ }
  }, [showInfo]);

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
        {ov.plan && (
          <button className={`${btn(pinLevels)} inline-flex items-center gap-1`} onClick={() => setPinLevels(!pinLevels)} aria-pressed={pinLevels} data-testid="toggle-pin-levels"
            title="Off = clean chart; levels show only while you hover the chart or its trade card.">
            {pinLevels ? "Levels: always on" : "Levels: on hover"}
          </button>
        )}
        <span className="w-px h-4 bg-ink-line mx-1" />
        <button className={`${btn(false)} inline-flex items-center gap-1`} onClick={() => bars.refetch()} disabled={bars.isFetching} data-testid="button-refresh-bars" title="Reload bars for this symbol / timeframe">
          {bars.isFetching ? `Loading… ${waitSec}s` : "↻ Refresh"}
        </button>
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
      <div className="relative rounded border border-ink-line overflow-hidden" style={{ height: 380 }}
        onMouseEnter={() => setHoverChart(true)} onMouseLeave={() => setHoverChart(false)} data-testid="chart-hover-area">
        <div ref={boxRef} className="absolute inset-y-0 left-0" style={{ right: gutterOn ? GUTTER_W : 0 }} />
        <div ref={bandRef} className="absolute inset-y-0 left-0 pointer-events-none" style={{ right: gutterOn ? GUTTER_W : 0 }} />
        {gutterOn && (
          <div className="absolute inset-y-0 right-0 border-l border-ink-line bg-[#050a13]" style={{ width: GUTTER_W }} data-testid="chart-label-gutter">
            <div ref={gutterRef} className="absolute inset-0 pointer-events-none" />
            {showInfo && <div className="absolute inset-x-1 bottom-1 text-center text-[9px] font-mono" style={{ color: "#64748b" }}>Practice only · not advice</div>}
            {!showInfo && <div data-testid="chart-hover-hint" className="absolute inset-x-1 top-1/2 -translate-y-1/2 text-center text-[9.5px] font-mono leading-snug" style={{ color: "#64748b" }}>Hover chart for entry · stop · targets</div>}
          </div>
        )}
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
        {(bars.isLoading || !symbol) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-slate-gray" data-testid="chart-loading">
            <span>Loading {symbol ?? ""} {TF_LABEL[tf]} bars… {waitSec > 0 ? `${waitSec}s` : ""}</span>
            {waitSec >= 12 && <span className="text-[10.5px]">Data vendors are slow right now — it keeps trying. You can also press ↻ Refresh.</span>}
          </div>
        )}
        {!bars.isLoading && bars.isFetching && data.length > 0 && (
          <div className="absolute z-10 top-1.5 right-16 rounded bg-[#050a13]/85 px-1.5 py-0.5 text-[9.5px] font-mono pointer-events-none" style={{ color: "#94a3b8" }} data-testid="chart-updating">updating… {waitSec}s</div>
        )}
        {!bars.isLoading && !bars.isFetching && symbol && !data.length && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-rose-300" data-testid="text-chart-error">
            <span>{b?.error ?? (bars.error as Error)?.message ?? "Data unavailable"} — {symbol} stays on the watchlist and re-checks on the next closed 1H bar.</span>
            <button className="ml-2 underline" style={{ pointerEvents: "auto" }} onClick={() => bars.refetch()} data-testid="button-retry-bars">Retry</button>
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
