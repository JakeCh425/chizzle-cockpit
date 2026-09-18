// TradingViewChart — TradingView-style chart panel powered by lightweight-charts.
//
// Features:
//   • Chart styles: Candles / Hollow / Line / Area / Volume-emphasized
//   • Overlay indicators: SMA(20/50/200), EMA(10/20/50), Bollinger(20,2), VWAP
//   • Sub-pane indicators: Volume, RSI(14), MACD(12,26,9)
//   • Live crosshair with OHLC + change % + volume + all indicator values
//   • Drawing tools: trendline, horizontal price line, vertical time line, ruler
//   • Color theme presets: Bloomberg neon / TradingView dark / TradingView light / Solarized
//   • Custom colors: bull, bear, grid, text, indicator-per-line
//   • Insights: rule-based bullets computed from bars + regime
//   • Reflections: chart-local per-ticker text log
//   • Layout persistence: PUT /api/chart-layouts/:ticker (Neon Postgres)
//
// Design notes:
//   • Uses lightweight-charts (~45kB). The one exception to "no new deps".
//   • The overlay <canvas> for drawings is absolutely positioned above the chart
//     and shares its coordinate space via priceToCoordinate() / timeToCoordinate().
//   • ResizeObserver keeps chart + overlay in sync.
//   • Deterministic insights only — no LLM calls.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  HistogramSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from "lightweight-charts";
import {
  SlidersHorizontal, Palette, Pencil, Trash2, Plus, Save, Check,
  TrendingUp, Minus, Play, Ruler, X, Eye, EyeOff, RefreshCw, MessageSquare,
  Lightbulb, ChevronDown, ChevronRight,
} from "lucide-react";
import { rsi as rsiSeries } from "@/lib/rsi";

// The candles API returns `time` as unix seconds. We accept either `time`
// (canonical, from /api/candles-ohlc) or `date` (YYYY-MM-DD) for callers that
// pre-format bars. Volume is optional; missing volume is treated as 0.
interface OHLCBar { time?: number; date?: string; open: number; high: number; low: number; close: number; volume?: number }

// ── Types ────────────────────────────────────────────────────────────────────
type ChartStyle = "candles" | "hollow" | "line" | "area" | "volume";

type OverlayKind = "SMA" | "EMA" | "BB" | "VWAP";
type PaneKind = "VOLUME" | "RSI" | "MACD";
type IndicatorKind = OverlayKind | PaneKind;

interface IndicatorConfig {
  id: string;              // uuid-ish local id
  kind: IndicatorKind;
  enabled: boolean;
  period?: number;         // SMA/EMA/RSI/BB length
  fast?: number;           // MACD fast
  slow?: number;           // MACD slow
  signal?: number;         // MACD signal
  mult?: number;           // Bollinger std dev
  color: string;           // main color
  color2?: string;         // for BB upper, MACD signal, etc
  color3?: string;         // BB middle
}

type ThemeKey = "bloomberg" | "tv-dark" | "tv-light" | "solarized";

interface Theme {
  background: string;
  text: string;
  grid: string;
  bull: string;
  bear: string;
  crosshair: string;
  volumeUp: string;
  volumeDown: string;
}

const THEMES: Record<ThemeKey, Theme> = {
  bloomberg: {
    background: "#0a0a0a",
    text: "#e2e8f0",
    grid: "rgba(148, 163, 184, 0.08)",
    bull: "#22d3ee",  // neon-blue-ish
    bear: "#f472b6",  // neon-pink
    crosshair: "#94a3b8",
    volumeUp: "rgba(34, 211, 238, 0.4)",
    volumeDown: "rgba(244, 114, 182, 0.4)",
  },
  "tv-dark": {
    background: "#131722",
    text: "#d1d4dc",
    grid: "rgba(240, 243, 250, 0.06)",
    bull: "#26a69a",
    bear: "#ef5350",
    crosshair: "#758696",
    volumeUp: "rgba(38, 166, 154, 0.5)",
    volumeDown: "rgba(239, 83, 80, 0.5)",
  },
  "tv-light": {
    background: "#ffffff",
    text: "#131722",
    grid: "rgba(70, 130, 180, 0.1)",
    bull: "#26a69a",
    bear: "#ef5350",
    crosshair: "#758696",
    volumeUp: "rgba(38, 166, 154, 0.5)",
    volumeDown: "rgba(239, 83, 80, 0.5)",
  },
  solarized: {
    background: "#002b36",
    text: "#93a1a1",
    grid: "rgba(147, 161, 161, 0.08)",
    bull: "#859900",
    bear: "#dc322f",
    crosshair: "#93a1a1",
    volumeUp: "rgba(133, 153, 0, 0.5)",
    volumeDown: "rgba(220, 50, 47, 0.5)",
  },
};

// Default indicator preset — TradingView-like, but Bloomberg-toned.
function defaultIndicators(): IndicatorConfig[] {
  return [
    { id: "sma20",  kind: "SMA",  enabled: true,  period: 20,  color: "#38bdf8" },
    { id: "sma50",  kind: "SMA",  enabled: true,  period: 50,  color: "#facc15" },
    { id: "sma200", kind: "SMA",  enabled: true,  period: 200, color: "#c084fc" },
    { id: "ema10",  kind: "EMA",  enabled: false, period: 10,  color: "#34d399" },
    { id: "ema20",  kind: "EMA",  enabled: false, period: 20,  color: "#f472b6" },
    { id: "bb20",   kind: "BB",   enabled: false, period: 20,  mult: 2, color: "#93c5fd", color2: "#93c5fd", color3: "#60a5fa" },
    { id: "vwap",   kind: "VWAP", enabled: false, color: "#fb923c" },
    { id: "vol",    kind: "VOLUME", enabled: true, color: "#22d3ee" },
    { id: "rsi14",  kind: "RSI",  enabled: true,  period: 14, color: "#a78bfa" },
    { id: "macd",   kind: "MACD", enabled: false, fast: 12, slow: 26, signal: 9, color: "#22d3ee", color2: "#f97316" },
  ];
}

interface Drawing {
  id: string;
  kind: "trendline" | "horizontal" | "vertical" | "ruler";
  color: string;
  points: { time: number; price?: number }[]; // time in seconds; price for trendline/horizontal/ruler
}

interface Reflection {
  id: string;
  ts: number;      // unix ms
  text: string;
  ticker: string;
}

// ── Indicator math ───────────────────────────────────────────────────────────
function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = i >= period - 1 ? prev : null;
  }
  return out;
}

function bollinger(values: number[], period: number, mult: number): { upper: (number|null)[]; middle: (number|null)[]; lower: (number|null)[] } {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - (middle[i] as number);
      sq += d * d;
    }
    const sd = Math.sqrt(sq / period);
    upper[i] = (middle[i] as number) + mult * sd;
    lower[i] = (middle[i] as number) - mult * sd;
  }
  return { upper, middle, lower };
}

function vwap(bars: OHLCBar[]): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const tp = (bars[i].high + bars[i].low + bars[i].close) / 3;
    const v = bars[i].volume || 0;
    cumPV += tp * v;
    cumV += v;
    out[i] = cumV > 0 ? cumPV / cumV : null;
  }
  return out;
}

function macd(values: number[], fast: number, slow: number, signal: number) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const lineDense = line.map((v) => (v == null ? 0 : v));
  const sig = ema(lineDense, signal).map((v, i) => (line[i] == null ? null : v));
  const hist: (number | null)[] = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

function barTime(b: OHLCBar): number {
  // Prefer the numeric `time` field (unix seconds) from /api/candles-ohlc.
  // Fall back to parsing `date` (YYYY-MM-DD) as UTC midnight so
  // lightweight-charts orders bars monotonically.
  if (typeof b.time === "number" && isFinite(b.time)) return b.time;
  if (b.date) return Math.floor(new Date(b.date + "T00:00:00Z").getTime() / 1000);
  return 0;
}

// ── Insights engine (rule-based) ─────────────────────────────────────────────
interface Insight { kind: "bull" | "bear" | "info"; text: string }

function computeInsights(bars: OHLCBar[], indicators: IndicatorConfig[], regime?: string): Insight[] {
  const out: Insight[] = [];
  if (!bars || bars.length < 30) return out;
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  // SMA crosses.
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const n = closes.length - 1;
  const c = closes[n];
  const cPrev = closes[n - 1];

  const crossedAbove = (arr: (number | null)[], name: string) => {
    if (arr[n] == null || arr[n - 1] == null) return null;
    const now = c > (arr[n] as number);
    const before = cPrev > (arr[n - 1] as number);
    if (now && !before) return `Price crossed above ${name} today`;
    if (!now && before) return `Price crossed below ${name} today`;
    return null;
  };
  for (const [arr, name, kind] of [[sma20Arr,"SMA20","info"], [sma50Arr,"SMA50","info"], [sma200Arr,"SMA200","info"]] as const) {
    const msg = crossedAbove(arr as any, name);
    if (msg) out.push({ kind: msg.includes("above") ? "bull" : "bear", text: msg });
  }

  // Golden / death cross (SMA50 vs SMA200).
  if (sma50Arr[n] != null && sma200Arr[n] != null && sma50Arr[n - 1] != null && sma200Arr[n - 1] != null) {
    const nowGold = (sma50Arr[n] as number) > (sma200Arr[n] as number);
    const beforeGold = (sma50Arr[n - 1] as number) > (sma200Arr[n - 1] as number);
    if (nowGold && !beforeGold) out.push({ kind: "bull", text: "Golden cross: SMA50 crossed above SMA200" });
    if (!nowGold && beforeGold) out.push({ kind: "bear", text: "Death cross: SMA50 crossed below SMA200" });
  }

  // Volume spike (z-score vs trailing 20).
  const vols = bars.slice(-20).map((b) => b.volume || 0);
  const mean = vols.reduce((a, b) => a + b, 0) / vols.length;
  const varr = vols.reduce((a, v) => a + (v - mean) * (v - mean), 0) / vols.length;
  const sd = Math.sqrt(varr);
  if (sd > 0 && (last.volume - mean) / sd >= 2) {
    out.push({ kind: "info", text: `Volume spike +${((last.volume - mean) / sd).toFixed(1)}\u03c3 vs 20-day avg` });
  }

  // RSI extremes + divergence.
  const rsiArr = rsiSeries(closes, 14);
  const rN = rsiArr[rsiArr.length - 1];
  if (rN != null) {
    if (rN >= 70) out.push({ kind: "bear", text: `RSI 14 = ${rN.toFixed(1)} \u2014 overbought (>70)` });
    else if (rN <= 30) out.push({ kind: "bull", text: `RSI 14 = ${rN.toFixed(1)} \u2014 oversold (<30)` });
  }

  // Bollinger squeeze release.
  const bb = bollinger(closes, 20, 2);
  const bwNow = bb.upper[n] != null && bb.lower[n] != null ? ((bb.upper[n] as number) - (bb.lower[n] as number)) / (bb.middle[n] as number) : null;
  const bwPrev5 = (() => {
    const idx = n - 5;
    if (idx < 0 || bb.upper[idx] == null) return null;
    return ((bb.upper[idx] as number) - (bb.lower[idx] as number)) / (bb.middle[idx] as number);
  })();
  if (bwNow != null && bwPrev5 != null && bwNow > bwPrev5 * 1.5) {
    out.push({ kind: "info", text: "Bollinger squeeze expanding \u2014 volatility breakout underway" });
  }

  // Regime alignment.
  if (regime === "GREEN") out.push({ kind: "bull", text: "Regime is GREEN \u2014 breakouts have edge" });
  else if (regime === "RED") out.push({ kind: "bear", text: "Regime is RED \u2014 defense over offense" });

  return out.slice(0, 6);
}

// ── Chart component ──────────────────────────────────────────────────────────
interface Props {
  ticker: string;
  bars: OHLCBar[] | undefined;
  isLoading?: boolean;
  regime?: string;
  height?: number;
}

export default function TradingViewChart({ ticker, bars, isLoading, regime, height = 380 }: Props) {
  // Persisted layout (per ticker, from Neon).
  const qc = useQueryClient();
  const { data: layout } = useQuery<any>({
    queryKey: ["/api/chart-layouts", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chart-layouts/${ticker}`);
      return await res.json();
    },
    staleTime: 60_000,
  });

  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [theme, setTheme] = useState<ThemeKey>("bloomberg");
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(defaultIndicators);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [drawTool, setDrawTool] = useState<Drawing["kind"] | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showInsights, setShowInsights] = useState(true);
  const [showReflections, setShowReflections] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingDraw, setPendingDraw] = useState<Drawing | null>(null);

  const t = THEMES[theme];

  // Load layout from server once on ticker change.
  useEffect(() => {
    if (!layout) return;
    if (layout.chart_style) setChartStyle(layout.chart_style as ChartStyle);
    if (layout.theme && THEMES[layout.theme as ThemeKey]) setTheme(layout.theme as ThemeKey);
    if (Array.isArray(layout.indicators) && layout.indicators.length > 0) {
      // Merge with defaults so newly-added indicator types still show up.
      const byId = new Map<string, IndicatorConfig>(defaultIndicators().map((d) => [d.id, d]));
      for (const saved of layout.indicators) if (saved?.id) byId.set(saved.id, { ...byId.get(saved.id), ...saved });
      setIndicators(Array.from(byId.values()));
    }
    if (Array.isArray(layout.drawings)) setDrawings(layout.drawings);
    if (Array.isArray(layout.reflections)) setReflections(layout.reflections);
    setDirty(false);
  }, [layout, ticker]);

  // Save mutation.
  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/chart-layouts/${ticker}`, {
        chart_style: chartStyle,
        theme,
        indicators,
        drawings,
        reflections,
      });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chart-layouts", ticker] });
      setDirty(false);
    },
  });

  // Auto-mark dirty when user changes config.
  useEffect(() => { setDirty(true); }, [chartStyle, theme, indicators, drawings, reflections]);

  // ── Chart lifecycle ────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const paneSeriesRef = useRef<Map<string, ISeriesApi<any>>>(new Map());
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);

  const [crosshair, setCrosshair] = useState<{
    time?: number;
    o?: number; h?: number; l?: number; c?: number; v?: number;
    changePct?: number;
    indicators: Record<string, number>;
  }>({ indicators: {} });

  // Build main chart once container is ready.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: t.background },
        textColor: t.text,
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: t.crosshair, style: LineStyle.Dashed, width: 1 },
        horzLine: { color: t.crosshair, style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: { borderColor: t.grid, textColor: t.text },
      timeScale: { borderColor: t.grid, timeVisible: false, secondsVisible: false, rightOffset: 4 },
      autoSize: false,
    });
    chartRef.current = chart;

    // Resize on container change.
    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.resize(containerRef.current.clientWidth, height);
      // Resize overlay canvas.
      if (overlayCanvasRef.current) {
        const w = containerRef.current.clientWidth;
        overlayCanvasRef.current.width = w * (window.devicePixelRatio || 1);
        overlayCanvasRef.current.height = height * (window.devicePixelRatio || 1);
        overlayCanvasRef.current.style.width = `${w}px`;
        overlayCanvasRef.current.style.height = `${height}px`;
        redrawOverlay();
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      overlaySeriesRef.current.clear();
      volumeSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, theme]);

  // Update main price series when bars or style changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars || bars.length === 0) return;

    // Remove old series if any.
    if (priceSeriesRef.current) {
      try { chart.removeSeries(priceSeriesRef.current); } catch {}
      priceSeriesRef.current = null;
    }

    const style: ChartStyle = chartStyle;
    let series: ISeriesApi<any>;
    if (style === "line") {
      series = chart.addSeries(LineSeries, { color: t.bull, lineWidth: 2 });
      series.setData(bars.map((b) => ({ time: barTime(b) as UTCTimestamp, value: b.close })));
    } else if (style === "area") {
      series = chart.addSeries(AreaSeries, {
        lineColor: t.bull,
        topColor: `${t.bull}40`,
        bottomColor: `${t.bull}00`,
        lineWidth: 2,
      });
      series.setData(bars.map((b) => ({ time: barTime(b) as UTCTimestamp, value: b.close })));
    } else {
      const hollow = style === "hollow";
      // Hollow candles: transparent body for up bars (only border shows).
      // Filled body only for down bars. All wicks and borders use theme colors.
      series = chart.addSeries(CandlestickSeries, {
        upColor: hollow ? "rgba(0,0,0,0)" : t.bull,
        downColor: hollow ? t.bear : t.bear,
        borderVisible: true,
        borderUpColor: t.bull,
        borderDownColor: t.bear,
        wickUpColor: t.bull,
        wickDownColor: t.bear,
      });
      series.setData(bars.map((b) => ({
        time: barTime(b) as UTCTimestamp,
        open: b.open, high: b.high, low: b.low, close: b.close,
      })));
    }
    priceSeriesRef.current = series;

    chart.timeScale().fitContent();
  }, [bars, chartStyle, t.bull, t.bear]);

  // Manage overlay indicator series (SMA/EMA/BB/VWAP + volume histogram).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars || bars.length === 0) return;
    const closes = bars.map((b) => b.close);
    const times = bars.map((b) => barTime(b));

    // Volume as histogram — priced on a secondary scale so it sits at the bottom.
    if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current); } catch {}
      volumeSeriesRef.current = null;
    }
    const volCfg = indicators.find((i) => i.id === "vol");
    if (volCfg?.enabled || chartStyle === "volume") {
      const vs = chart.addSeries(HistogramSeries, {
        color: t.volumeUp,
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vs.setData(bars.map((b) => ({
        time: barTime(b) as UTCTimestamp,
        value: b.volume || 0,
        color: b.close >= b.open ? t.volumeUp : t.volumeDown,
      })));
      volumeSeriesRef.current = vs;
    }

    // Clear existing overlay lines.
    overlaySeriesRef.current.forEach((s) => { try { chart.removeSeries(s); } catch {} });
    overlaySeriesRef.current.clear();

    for (const ind of indicators) {
      if (!ind.enabled) continue;
      if (ind.kind === "SMA") {
        const arr = sma(closes, ind.period || 20);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        s.setData(arr.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        overlaySeriesRef.current.set(ind.id, s);
      } else if (ind.kind === "EMA") {
        const arr = ema(closes, ind.period || 20);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false });
        s.setData(arr.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        overlaySeriesRef.current.set(ind.id, s);
      } else if (ind.kind === "BB") {
        const b = bollinger(closes, ind.period || 20, ind.mult || 2);
        const cfg = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };
        const u = chart.addSeries(LineSeries, { ...cfg, color: ind.color });
        const m = chart.addSeries(LineSeries, { ...cfg, color: ind.color3 || ind.color, lineStyle: LineStyle.Dashed });
        const l = chart.addSeries(LineSeries, { ...cfg, color: ind.color2 || ind.color });
        u.setData(b.upper.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        m.setData(b.middle.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        l.setData(b.lower.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        overlaySeriesRef.current.set(`${ind.id}-u`, u);
        overlaySeriesRef.current.set(`${ind.id}-m`, m);
        overlaySeriesRef.current.set(`${ind.id}-l`, l);
      } else if (ind.kind === "VWAP") {
        const arr = vwap(bars);
        const s = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        s.setData(arr.map((v, i) => (v == null ? null : { time: times[i] as UTCTimestamp, value: v })).filter(Boolean) as any);
        overlaySeriesRef.current.set(ind.id, s);
      }
    }

    chart.timeScale().fitContent();
  }, [bars, indicators, chartStyle, t.volumeUp, t.volumeDown]);

  // Sub-panes for RSI / MACD (rendered as separate mini-charts, time-synced).
  useEffect(() => {
    // RSI mini-chart.
    const rsiCfg = indicators.find((i) => i.kind === "RSI" && i.enabled);
    if (rsiCfg && bars && bars.length > 15 && rsiContainerRef.current && !rsiChartRef.current) {
      const c = createChart(rsiContainerRef.current, {
        width: rsiContainerRef.current.clientWidth,
        height: 90,
        layout: { background: { color: t.background }, textColor: t.text, fontSize: 10 },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.grid, textColor: t.text },
        timeScale: { borderColor: t.grid, timeVisible: false, visible: false },
      });
      const s = c.addSeries(LineSeries, { color: rsiCfg.color, lineWidth: 1 });
      const closes = bars.map((b) => b.close);
      const arr = rsiSeries(closes, rsiCfg.period || 14);
      s.setData(arr.map((v, i) => (v == null ? null : { time: barTime(bars[i]) as UTCTimestamp, value: v })).filter(Boolean) as any);
      // 30/70 reference lines.
      s.createPriceLine({ price: 70, color: t.bear, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "70" });
      s.createPriceLine({ price: 30, color: t.bull, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "30" });
      c.timeScale().fitContent();
      rsiChartRef.current = c;
    }
    if ((!rsiCfg || !bars || bars.length <= 15) && rsiChartRef.current) {
      try { rsiChartRef.current.remove(); } catch {}
      rsiChartRef.current = null;
    }

    // MACD mini-chart.
    const macdCfg = indicators.find((i) => i.kind === "MACD" && i.enabled);
    if (macdCfg && bars && bars.length > 30 && macdContainerRef.current && !macdChartRef.current) {
      const c = createChart(macdContainerRef.current, {
        width: macdContainerRef.current.clientWidth,
        height: 90,
        layout: { background: { color: t.background }, textColor: t.text, fontSize: 10 },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.grid, textColor: t.text },
        timeScale: { borderColor: t.grid, timeVisible: false, visible: false },
      });
      const closes = bars.map((b) => b.close);
      const m = macd(closes, macdCfg.fast || 12, macdCfg.slow || 26, macdCfg.signal || 9);
      const lineS = c.addSeries(LineSeries, { color: macdCfg.color, lineWidth: 1 });
      lineS.setData(m.line.map((v, i) => (v == null ? null : { time: barTime(bars[i]) as UTCTimestamp, value: v })).filter(Boolean) as any);
      const sigS = c.addSeries(LineSeries, { color: macdCfg.color2 || t.bear, lineWidth: 1 });
      sigS.setData(m.signal.map((v, i) => (v == null ? null : { time: barTime(bars[i]) as UTCTimestamp, value: v })).filter(Boolean) as any);
      const histS = c.addSeries(HistogramSeries, {});
      histS.setData(m.hist.map((v, i) => (v == null ? null : {
        time: barTime(bars[i]) as UTCTimestamp,
        value: v,
        color: v >= 0 ? t.volumeUp : t.volumeDown,
      })).filter(Boolean) as any);
      c.timeScale().fitContent();
      macdChartRef.current = c;
    }
    if ((!macdCfg || !bars || bars.length <= 30) && macdChartRef.current) {
      try { macdChartRef.current.remove(); } catch {}
      macdChartRef.current = null;
    }
  }, [bars, indicators, theme]);

  // Crosshair subscription for the live tooltip.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    const handler = (param: any) => {
      if (!param.time || !param.point) {
        setCrosshair({ indicators: {} });
        return;
      }
      const idx = bars.findIndex((b) => barTime(b) === param.time);
      if (idx < 0) return;
      const b = bars[idx];
      const changePct = idx > 0 ? ((b.close - bars[idx - 1].close) / bars[idx - 1].close) * 100 : 0;
      const closes = bars.map((x) => x.close);
      const ind: Record<string, number> = {};
      for (const cfg of indicators) {
        if (!cfg.enabled) continue;
        if (cfg.kind === "SMA") {
          const v = sma(closes, cfg.period || 20)[idx];
          if (v != null) ind[`SMA${cfg.period}`] = v;
        } else if (cfg.kind === "EMA") {
          const v = ema(closes, cfg.period || 20)[idx];
          if (v != null) ind[`EMA${cfg.period}`] = v;
        } else if (cfg.kind === "VWAP") {
          const v = vwap(bars)[idx];
          if (v != null) ind["VWAP"] = v;
        } else if (cfg.kind === "RSI") {
          const v = rsiSeries(closes, cfg.period || 14)[idx];
          if (v != null) ind["RSI"] = v;
        }
      }
      setCrosshair({ time: Number(param.time), o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, changePct, indicators: ind });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [bars, indicators]);

  // ── Overlay canvas (drawings) ──────────────────────────────────────────────
  const redrawOverlay = useCallback(() => {
    const chart = chartRef.current;
    const series = priceSeriesRef.current;
    const canvas = overlayCanvasRef.current;
    if (!chart || !series || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const timeToX = (t: number): number | null => {
      const x = chart.timeScale().timeToCoordinate(t as Time);
      return x == null ? null : x;
    };
    const priceToY = (p: number): number | null => {
      const y = series.priceToCoordinate(p);
      return y == null ? null : y;
    };

    const drawLineSeg = (x1: number, y1: number, x2: number, y2: number, color: string, dash?: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    for (const d of drawings) {
      if (d.kind === "trendline" && d.points.length >= 2) {
        const x1 = timeToX(d.points[0].time); const y1 = priceToY(d.points[0].price!);
        const x2 = timeToX(d.points[1].time); const y2 = priceToY(d.points[1].price!);
        if (x1 != null && y1 != null && x2 != null && y2 != null) drawLineSeg(x1, y1, x2, y2, d.color);
      } else if (d.kind === "horizontal" && d.points.length >= 1) {
        const y = priceToY(d.points[0].price!);
        if (y != null) drawLineSeg(0, y, canvas.width / dpr, y, d.color, [4, 4]);
      } else if (d.kind === "vertical" && d.points.length >= 1) {
        const x = timeToX(d.points[0].time);
        if (x != null) drawLineSeg(x, 0, x, canvas.height / dpr, d.color, [4, 4]);
      } else if (d.kind === "ruler" && d.points.length >= 2) {
        const x1 = timeToX(d.points[0].time); const y1 = priceToY(d.points[0].price!);
        const x2 = timeToX(d.points[1].time); const y2 = priceToY(d.points[1].price!);
        if (x1 != null && y1 != null && x2 != null && y2 != null) {
          drawLineSeg(x1, y1, x2, y2, d.color, [2, 3]);
          // Label with delta price + delta%.
          const dp = d.points[1].price! - d.points[0].price!;
          const dpp = (dp / d.points[0].price!) * 100;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          ctx.fillStyle = "rgba(10,10,10,0.85)";
          const label = `${dp >= 0 ? "+" : ""}${dp.toFixed(2)} (${dpp >= 0 ? "+" : ""}${dpp.toFixed(2)}%)`;
          const w = ctx.measureText(label).width + 10;
          ctx.fillRect(midX - w / 2, midY - 18, w, 16);
          ctx.strokeStyle = d.color;
          ctx.strokeRect(midX - w / 2, midY - 18, w, 16);
          ctx.fillStyle = t.text;
          ctx.font = "10px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(label, midX, midY - 10);
        }
      }
    }

    // In-progress drawing preview.
    if (pendingDraw && pendingDraw.points.length >= 1) {
      const p0 = pendingDraw.points[0];
      const x1 = timeToX(p0.time);
      const y1 = priceToY(p0.price!);
      if (x1 != null && y1 != null) {
        ctx.fillStyle = pendingDraw.color;
        ctx.beginPath();
        ctx.arc(x1, y1, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [drawings, pendingDraw, t.text]);

  useEffect(() => {
    redrawOverlay();
    const chart = chartRef.current;
    if (!chart) return;
    const sub = () => redrawOverlay();
    chart.timeScale().subscribeVisibleTimeRangeChange(sub);
    chart.timeScale().subscribeVisibleLogicalRangeChange(sub);
    return () => {
      try { chart.timeScale().unsubscribeVisibleTimeRangeChange(sub); } catch {}
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(sub); } catch {}
    };
  }, [redrawOverlay]);

  // Click on overlay canvas → drawing input.
  const onOverlayClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawTool) return;
    const chart = chartRef.current;
    const series = priceSeriesRef.current;
    if (!chart || !series) return;
    const rect = (ev.target as HTMLCanvasElement).getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null) return;
    const point = { time: Number(time), price: price as number };
    const color = t.bull;

    if (drawTool === "horizontal" || drawTool === "vertical") {
      const d: Drawing = {
        id: `dr_${Date.now()}`,
        kind: drawTool,
        color,
        points: [point],
      };
      setDrawings((prev) => [...prev, d]);
      setDrawTool(null);
      return;
    }
    // Two-point tools: collect first point, then complete.
    if (!pendingDraw) {
      setPendingDraw({ id: `dr_${Date.now()}`, kind: drawTool, color, points: [point] });
    } else {
      const d: Drawing = { ...pendingDraw, points: [...pendingDraw.points, point] };
      setDrawings((prev) => [...prev, d]);
      setPendingDraw(null);
      setDrawTool(null);
    }
  };

  // ── Insights + reflections ─────────────────────────────────────────────────
  const insights = useMemo(() => (bars ? computeInsights(bars, indicators, regime) : []), [bars, indicators, regime]);
  const [reflectionText, setReflectionText] = useState("");
  const addReflection = () => {
    const txt = reflectionText.trim();
    if (!txt) return;
    setReflections((prev) => [{ id: `r_${Date.now()}`, ts: Date.now(), text: txt, ticker }, ...prev].slice(0, 50));
    setReflectionText("");
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const chartStyles: { key: ChartStyle; label: string }[] = [
    { key: "candles", label: "Candles" },
    { key: "hollow",  label: "Hollow" },
    { key: "line",    label: "Line" },
    { key: "area",    label: "Area" },
    { key: "volume",  label: "Volume" },
  ];

  return (
    <div className="rounded-md border border-ink-line bg-ink-black" data-testid="panel-tv-chart">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-line flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-soft-white uppercase tracking-wider">{ticker}</span>
          {crosshair.changePct != null && (
            <span className={`text-[10px] font-mono ${crosshair.changePct >= 0 ? "text-signal-green" : "text-signal-red"}`}>
              {crosshair.changePct >= 0 ? "+" : ""}{crosshair.changePct.toFixed(2)}%
            </span>
          )}
        </div>

        {/* Chart style */}
        <div className="flex items-center rounded border border-ink-line overflow-hidden ml-2">
          {chartStyles.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setChartStyle(s.key)}
              data-testid={`chart-style-${s.key}`}
              className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${
                chartStyle === s.key ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:text-soft-white"
              } ${i > 0 ? "border-l border-ink-line" : ""}`}
            >{s.label}</button>
          ))}
        </div>

        {/* Indicators */}
        <button
          onClick={() => setShowIndicators((v) => !v)}
          data-testid="button-indicators"
          className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded border flex items-center gap-1 ${
            showIndicators ? "border-neon-blue text-neon-blue bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-soft-white"
          }`}
        >
          <SlidersHorizontal className="w-3 h-3" /> Indicators
          <span className="text-[9px] opacity-80">({indicators.filter((i) => i.enabled).length})</span>
        </button>

        {/* Theme */}
        <button
          onClick={() => setShowThemePicker((v) => !v)}
          data-testid="button-theme"
          className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded border flex items-center gap-1 ${
            showThemePicker ? "border-neon-blue text-neon-blue bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-soft-white"
          }`}
        >
          <Palette className="w-3 h-3" /> Theme
        </button>

        {/* Drawing tools */}
        <div className="flex items-center rounded border border-ink-line overflow-hidden">
          {[
            { k: "trendline" as const,  icon: <TrendingUp className="w-3 h-3" />, title: "Trendline" },
            { k: "horizontal" as const, icon: <Minus className="w-3 h-3" />,      title: "Horizontal line" },
            { k: "vertical" as const,   icon: <Play className="w-3 h-3 rotate-90" />, title: "Vertical line" },
            { k: "ruler" as const,      icon: <Ruler className="w-3 h-3" />,      title: "Ruler / measure" },
          ].map((tool, i) => (
            <button
              key={tool.k}
              onClick={() => { setDrawTool(drawTool === tool.k ? null : tool.k); setPendingDraw(null); }}
              data-testid={`draw-${tool.k}`}
              title={tool.title}
              className={`p-1 ${drawTool === tool.k ? "bg-neon-blue/15 text-neon-blue" : "text-slate-gray hover:text-soft-white"} ${i > 0 ? "border-l border-ink-line" : ""}`}
            >{tool.icon}</button>
          ))}
          {drawings.length > 0 && (
            <button
              onClick={() => { if (confirm("Clear all drawings?")) setDrawings([]); }}
              data-testid="draw-clear"
              title="Clear all drawings"
              className="p-1 border-l border-ink-line text-slate-gray hover:text-signal-red"
            ><Trash2 className="w-3 h-3" /></button>
          )}
        </div>

        <div className="flex-1" />

        {/* Save */}
        <button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          data-testid="button-save-layout"
          className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded border flex items-center gap-1 ${
            dirty ? "border-signal-green text-signal-green bg-signal-green/10" : "border-ink-line text-slate-gray"
          } ${(!dirty || saveMut.isPending) ? "opacity-60 cursor-default" : "hover:brightness-125"}`}
        >
          {saveMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : dirty ? <Save className="w-3 h-3" /> : <Check className="w-3 h-3" />}
          {saveMut.isPending ? "Saving" : dirty ? "Save" : "Saved"}
        </button>
      </div>

      {/* Indicators panel */}
      {showIndicators && (
        <div className="border-b border-ink-line bg-ink-deep/40 p-2" data-testid="panel-indicators">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {indicators.map((ind) => (
              <div key={ind.id} className="flex items-center gap-2 px-2 py-1 rounded border border-ink-line bg-ink-black/60">
                <input
                  type="checkbox"
                  checked={ind.enabled}
                  onChange={(e) => setIndicators((prev) => prev.map((x) => x.id === ind.id ? { ...x, enabled: e.target.checked } : x))}
                  data-testid={`ind-toggle-${ind.id}`}
                  className="accent-neon-blue"
                />
                <span className="text-[11px] font-mono text-soft-white min-w-[70px]">
                  {ind.kind}{ind.period ? ` ${ind.period}` : ind.fast ? ` ${ind.fast}/${ind.slow}/${ind.signal}` : ""}
                </span>
                <input
                  type="color"
                  value={ind.color}
                  onChange={(e) => setIndicators((prev) => prev.map((x) => x.id === ind.id ? { ...x, color: e.target.value } : x))}
                  data-testid={`ind-color-${ind.id}`}
                  className="w-5 h-5 rounded border border-ink-line bg-transparent cursor-pointer"
                />
                {ind.period != null && (
                  <input
                    type="number"
                    value={ind.period}
                    min={2}
                    max={400}
                    onChange={(e) => setIndicators((prev) => prev.map((x) => x.id === ind.id ? { ...x, period: parseInt(e.target.value) || 20 } : x))}
                    className="w-12 px-1 py-0.5 text-[10px] font-mono bg-ink-black border border-ink-line rounded text-soft-white"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Theme picker */}
      {showThemePicker && (
        <div className="border-b border-ink-line bg-ink-deep/40 p-2 flex items-center gap-2 flex-wrap" data-testid="panel-theme">
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setTheme(k)}
              data-testid={`theme-${k}`}
              className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded border ${
                theme === k ? "border-neon-blue text-neon-blue bg-neon-blue/10" : "border-ink-line text-slate-gray hover:text-soft-white"
              }`}
            >{k}</button>
          ))}
          <span className="text-[9px] text-slate-gray/70 ml-2">
            Custom colors: change per-indicator in the Indicators panel. Bull/bear/grid follow the theme.
          </span>
        </div>
      )}

      {/* Chart + overlay canvas */}
      <div className="relative">
        <div ref={containerRef} style={{ height }} className="w-full" data-testid="tv-chart-container" />
        <canvas
          ref={overlayCanvasRef}
          onClick={onOverlayClick}
          style={{ height, cursor: drawTool ? "crosshair" : "default" }}
          className="absolute inset-0 w-full pointer-events-auto"
          data-testid="overlay-canvas"
        />

        {/* Live tooltip */}
        {crosshair.time != null && crosshair.o != null && (
          <div className="absolute top-2 left-2 rounded border border-ink-line bg-ink-black/85 backdrop-blur px-2 py-1.5 text-[10px] font-mono text-soft-white space-y-0.5 pointer-events-none" data-testid="chart-tooltip">
            <div className="flex items-center gap-2">
              <span className="text-slate-gray">O</span><span>{crosshair.o?.toFixed(2)}</span>
              <span className="text-slate-gray">H</span><span className="text-signal-green">{crosshair.h?.toFixed(2)}</span>
              <span className="text-slate-gray">L</span><span className="text-signal-red">{crosshair.l?.toFixed(2)}</span>
              <span className="text-slate-gray">C</span><span>{crosshair.c?.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-gray">Vol</span>
              <span>{crosshair.v ? (crosshair.v >= 1_000_000 ? `${(crosshair.v/1_000_000).toFixed(1)}M` : `${(crosshair.v/1_000).toFixed(0)}k`) : "-"}</span>
              {crosshair.changePct != null && (
                <span className={crosshair.changePct >= 0 ? "text-signal-green" : "text-signal-red"}>
                  {crosshair.changePct >= 0 ? "+" : ""}{crosshair.changePct.toFixed(2)}%
                </span>
              )}
            </div>
            {Object.entries(crosshair.indicators).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-slate-gray">{k}</span>
                <span>{Number(v).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {(!bars || bars.length === 0) && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-gray pointer-events-none">
            {isLoading ? "Loading chart data\u2026" : `No chart data for ${ticker}.`}
          </div>
        )}
      </div>

      {/* RSI pane */}
      {indicators.find((i) => i.kind === "RSI" && i.enabled) && (
        <div ref={rsiContainerRef} style={{ height: 90 }} className="w-full border-t border-ink-line" data-testid="rsi-pane" />
      )}

      {/* MACD pane */}
      {indicators.find((i) => i.kind === "MACD" && i.enabled) && (
        <div ref={macdContainerRef} style={{ height: 90 }} className="w-full border-t border-ink-line" data-testid="macd-pane" />
      )}

      {/* Insights */}
      <div className="border-t border-ink-line">
        <button
          onClick={() => setShowInsights((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-soft-white hover:bg-ink-deep/40"
          data-testid="button-insights"
        >
          <span className="flex items-center gap-1.5">
            {showInsights ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Lightbulb className="w-3 h-3 text-signal-amber" /> Insights ({insights.length})
          </span>
        </button>
        {showInsights && (
          <div className="px-3 pb-2 space-y-1" data-testid="panel-insights">
            {insights.length === 0 ? (
              <div className="text-[11px] text-slate-gray italic py-1">No standout signals right now.</div>
            ) : insights.map((ins, i) => (
              <div key={i} className={`text-[11px] flex items-start gap-1.5 ${
                ins.kind === "bull" ? "text-signal-green" : ins.kind === "bear" ? "text-signal-red" : "text-soft-white"
              }`}>
                <span className="mt-0.5">{ins.kind === "bull" ? "\u25b2" : ins.kind === "bear" ? "\u25bc" : "\u2022"}</span>
                <span>{ins.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reflections */}
      <div className="border-t border-ink-line">
        <button
          onClick={() => setShowReflections((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-soft-white hover:bg-ink-deep/40"
          data-testid="button-reflections"
        >
          <span className="flex items-center gap-1.5">
            {showReflections ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <MessageSquare className="w-3 h-3 text-neon-blue" /> Reflections ({reflections.length})
          </span>
        </button>
        {showReflections && (
          <div className="px-3 pb-2 space-y-2" data-testid="panel-reflections">
            <div className="flex items-start gap-1.5">
              <textarea
                value={reflectionText}
                onChange={(e) => setReflectionText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addReflection(); }}
                placeholder={`What's the setup? Invalidation? Aligned with regime ${regime || "?"}?`}
                className="flex-1 min-h-[60px] px-2 py-1.5 text-[11px] bg-ink-black border border-ink-line rounded text-soft-white placeholder:text-slate-gray/60 resize-none"
                data-testid="input-reflection"
              />
              <button
                onClick={addReflection}
                disabled={!reflectionText.trim()}
                className="px-2 py-1.5 text-[10px] font-mono uppercase text-neon-blue border border-neon-blue/40 rounded hover:bg-neon-blue/10 disabled:opacity-40"
                data-testid="button-add-reflection"
              ><Plus className="w-3 h-3" /></button>
            </div>
            {reflections.length === 0 ? (
              <div className="text-[10px] text-slate-gray italic">No reflections for {ticker} yet. \u2318+Enter to save.</div>
            ) : reflections.map((r) => (
              <div key={r.id} className="rounded border border-ink-line bg-ink-black/60 p-2 space-y-1">
                <div className="flex items-center justify-between text-[9px] font-mono text-slate-gray">
                  <span>{new Date(r.ts).toLocaleString()}</span>
                  <button
                    onClick={() => setReflections((prev) => prev.filter((x) => x.id !== r.id))}
                    className="text-slate-gray hover:text-signal-red"
                  ><X className="w-3 h-3" /></button>
                </div>
                <div className="text-[11px] text-soft-white whitespace-pre-wrap leading-snug">{r.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
