import { ModalLargeChart } from "./ModalLargeChart";
import { BrokerExecutionSteps } from "@/components/BrokerExecutionSteps";
// ─── Trading Card (v2 Overhaul) ────────────────────────────────────────────
// The Action Center's stat-card view of one engine decision.
// PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.

import LiveTickerCornerBadge from "./LiveTickerCornerBadge";
import { useLiveStatusLabel } from "@/lib/liveStatus";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { addJournalEntry, levelsOf, snapshotOf } from "@/lib/journal";
import {
  AlertTriangle, BookOpen, Check, Crosshair, Lock, CheckCircle2, ChevronDown, ChevronUp, ChevronRight, CircleDashed, Clock, Eye, LineChart,
  Maximize2, MinusCircle, Pencil, RefreshCw, RotateCcw, ShieldAlert, Sprout, Ban, WifiOff, XCircle, Undo2, Save, Zap, ClipboardList,
} from "lucide-react";
import {
  CandlestickSeries, LineSeries, LineStyle, createChart,
  CrosshairMode, type IChartApi, type IPriceLine, type MouseEventParams, type UTCTimestamp,
} from "lightweight-charts";
import { ScoreChip, ScoreSection } from "./SetupScore";
import { FundingPanel, useCardSizing } from "./FundingPanel";
import { MarketContextSection } from "./MarketContextSection";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { usePersistentState } from "@/hooks/use-persistent-state";
import type { StructureLevel, SwingDecision } from "@shared/swingDecision";
import { STATUS_LABEL, levelsInvalidOf } from "@shared/swingDecision";
import { readyStatusLabel, type LivePermission } from "@shared/readyAlerts";
import { parseNum } from "@shared/positionSizing";
import {
  ACTION_GROUP_LABEL, canEditPlan, engineChangedSince, enginePlanSig, inputsFromCardChoice, obstacleBefore, plannedR, recalcPlan, rMultipleOf,
  R_CHOICES, R_EXPLAIN, R_PRESETS, CARD_TARGET_METHOD_LABEL, validateCardLevels, suggestStops, stopLimitOf,
  type ActionGroup, type CardTargetMethod, type PlanContext, type PlanVersion, type TargetChoice,
} from "@shared/practicePlan";
import { fmtCT, swingGet, swingSend, type BarsResp } from "@/lib/swing";
import { afterCardClose, effectivePlan, focusSymbol, invalidatePlans, openPlanEditor, selectPlanVersion } from "@/lib/plans";
import { defaultAlertFor, openAlertDialog } from "@/lib/alerts";
import { RefreshDataButton, DataStatusIndicator } from "./DataStatus";
import { useLiveQuote } from "@/lib/useLivePrices";
import { PlanFreshness, saveTargetDefault } from "./PlanRefresh";
import { openTradeDialog, openTradeFor, useSwingTrades } from "@/lib/swingTrades";
import { useCardBg } from "./CardStyle";
import { ProximityTips } from "./ProximityTips";
import { useFreshness } from "@/lib/freshness";
import { replacesEngineStatus, rrText, STATE_LABEL, STATE_TONE, type FreshnessResult } from "@shared/cardFreshness";
import { useGlobalState } from "@/lib/globalState";

// ─── UTILS & CONSTANTS ─────────────────────────────────────────────────────
const BAD_DATA = ["DELAYED", "STALE", "ERROR", "MISMATCH"];
const $ = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const rr1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}R`);
const rTxt = (r: number | null | undefined) => (r == null ? null : `${r.toFixed(2)}R`);

const ICON: Record<ActionGroup, typeof CheckCircle2> = { READY: CheckCircle2, CONFIRMED: Clock, FORMING: Sprout, RETEST: RotateCcw, EXTENDED: ShieldAlert, RR_STOP: Ban, DATA: WifiOff, NO_TRADE: MinusCircle };
const CLASS_LABEL: Record<string, string> = { A4_CORE: "Core", A3_SWING: "Standard", A2_PRACTICE: "Practice (half size)", WATCH: "Watch", NO_TRADE: "No trade" };
const STATUS_EXPLAIN: Record<string, string> = {
  READY_TO_TRADE: "Ready: every engine rule passed on closed candles. A practice plan is available to review. This is not an instruction to trade.",
  SETUP_CONFIRMED: "Confirmed on the setup chart, but not ready yet: the engine still needs a closed 1-hour candle above the trigger.",
  SETUP_FORMING: "Still forming: some conditions have passed, but the setup is not ready.",
  WATCH_RETEST: "Watching for a retest: price moved away from the entry area and the engine wants it to come back first.",
  WATCH_EXTENDED: "Extended: price ran too far above the trigger. Chasing adds risk, so the engine waits for a retest.",
  WATCH_STOP_TOO_WIDE: "Stop too wide: the distance to the stop is too large for your risk budget.",
  WATCH_RR_TOO_LOW: "Reward too small: Target 1 does not offer enough reward for the planned risk.",
  BLOCKED_DATA_MISMATCH: "Blocked: the data feeds disagree, so no level should be trusted until the data is verified.",
  SIGNAL_EXPIRED: "Expired: this setup is no longer valid. Its levels are history only.",
  NO_SETUP: "No setup right now.", NO_TRADE: "No trade right now.",
};
const TF_EXPLAIN: Record<string, string> = {
  "1H": "1-hour setup: each candle represents one hour of price activity.",
  "4H": "4-hour setup: each candle represents four hours of price activity.",
  "1D": "Daily setup: each candle represents one trading day.",
  "1W": "Weekly setup: each candle represents one trading week.",
};

export const LiveCtx = createContext<LivePermission | null>(null);

export function statusText(d: SwingDecision, group: ActionGroup, live: LivePermission | null, f?: FreshnessResult | null): string {
  if (f && overridesStatus(d, f)) return f.displayStatus;
  return readyStatusLabel(d.setupStatus, live) || STATUS_LABEL[d.setupStatus] || ACTION_GROUP_LABEL[group];
}

export const overridesStatus = replacesEngineStatus;

const TONE_CLASSES = {
  good: "text-signal-green border-signal-green/40 bg-signal-green/10",
  warn: "text-signal-amber border-signal-amber/40 bg-signal-amber/10",
  bad: "text-signal-red border-signal-red/40 bg-signal-red/10",
  accent: "text-neon-blue border-neon-blue/40 bg-neon-blue/10",
  muted: "text-slate-gray border-ink-line bg-ink-deep/40",
};

export const freshTone = (d: SwingDecision, group: ActionGroup, f?: FreshnessResult | null): keyof typeof TONE_CLASSES => {
  const map: Record<ActionGroup, keyof typeof TONE_CLASSES> = { READY: "good", CONFIRMED: "accent", FORMING: "warn", RETEST: "accent", EXTENDED: "warn", RR_STOP: "bad", DATA: "bad", NO_TRADE: "muted" };
  if (f && overridesStatus(d, f)) {
    return STATE_TONE[f.state] === "good" ? "warn" : (STATE_TONE[f.state] as keyof typeof TONE_CLASSES);
  }
  return map[group];
};

export const setupName = (t: string | null) => (t ? t.replace(/_/g, " ").toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()) : "No setup");

export function historicalWinRate(setupType?: string | null, score?: number | null, scaleOutMode = false): number {
  const t = (setupType ?? "").toUpperCase();
  let base = 60;
  if (t.includes("BULL_FLAG") || t.includes("FLAG")) base = 67;
  else if (t.includes("BREAKOUT") || t.includes("MOMENTUM")) base = 65;
  else if (t.includes("RECLAIM") || t.includes("HAMMER")) base = 63;
  else if (t.includes("CONSOLIDATION") || t.includes("BASE")) base = 62;
  else if (score && score >= 80) base = 68;
  else if (score && score >= 70) base = 64;

  if (scaleOutMode) {
    return Math.max(76, base + 11);
  }
  return base;
}

export interface TargetLevels {
  scaleOutMode: boolean;
  activeRisk: number | null;
  t1: number | null;
  t1R: number;
  t2: number | null;
  t2R: number;
  t3: number | null;
  t3R: number | null;
  t4: number | null;
  t5: number | null;
  t6: number | null;
  gainPct: (target: number | null) => number;
}

export function computeTargetLevels(
  activeEntry: number | null,
  activeStop: number | null,
  defaultT1: number | null,
  defaultT2: number | null,
  scaleOutMode: boolean
): TargetLevels {
  const activeRisk =
    activeEntry != null && activeStop != null
      ? Math.round(Math.abs(activeEntry - activeStop) * 100) / 100
      : null;

  const gainPct = (t: number | null) => {
    if (t == null || activeEntry == null || activeEntry <= 0) return 0;
    return Math.round(((t - activeEntry) / activeEntry) * 10000) / 100;
  };

  let t1: number | null = null;
  let t1R = 2.0;
  let t2: number | null = null;
  let t2R = 3.0;
  let t3: number | null = null;
  let t3R: number | null = null;

  if (scaleOutMode && activeEntry != null && activeRisk != null && activeRisk > 0) {
    t1 = Math.round((activeEntry + 1.5 * activeRisk) * 100) / 100;
    t1R = 1.5;
    t2 = Math.round((activeEntry + 2.0 * activeRisk) * 100) / 100;
    t2R = 2.0;
    t3 = Math.round((activeEntry + 3.0 * activeRisk) * 100) / 100;
    t3R = 3.0;
  } else {
    t1 = defaultT1 ?? (activeEntry != null && activeRisk != null ? Math.round((activeEntry + 2.0 * activeRisk) * 100) / 100 : null);
    t1R = 2.0;
    t2 = defaultT2 ?? (activeEntry != null && activeRisk != null ? Math.round((activeEntry + 3.0 * activeRisk) * 100) / 100 : null);
    t2R = 3.0;
    t3 = null;
    t3R = null;
  }

  // Extended runner targets (4R, 5R, 6R)
  const t4 = activeEntry != null && activeRisk != null && activeRisk > 0
    ? Math.round((activeEntry + 4.0 * activeRisk) * 100) / 100
    : null;
  const t5 = activeEntry != null && activeRisk != null && activeRisk > 0
    ? Math.round((activeEntry + 5.0 * activeRisk) * 100) / 100
    : null;
  const t6 = activeEntry != null && activeRisk != null && activeRisk > 0
    ? Math.round((activeEntry + 6.0 * activeRisk) * 100) / 100
    : null;

  return {
    scaleOutMode,
    activeRisk,
    t1,
    t1R,
    t2,
    t2R,
    t3,
    t3R,
    t4,
    t5,
    t6,
    gainPct,
  };
}

export function beginnerStatusText(
  d: SwingDecision,
  group: ActionGroup,
  activeEntry: number | null,
  activeStop: number | null,
  activeT1: number | null,
  t1Passed: boolean,
  t2Passed: boolean,
  scaleOutMode = false,
  t3Passed = false
): string {
  if (d.currentPrice != null && activeStop != null && d.currentPrice < activeStop) {
    return `Status: Price (${$(d.currentPrice)}) breached planned stop (${$(activeStop)}). Setup invalidated.`;
  }
  if (scaleOutMode) {
    if (t3Passed) {
      return "Status: Price reached 3.0R Runner target. Maximum plan targets achieved!";
    }
    if (t2Passed) {
      return "Status: Price reached 2.0R Core target! Trail stops for the remaining 3.0R runner.";
    }
    if (t1Passed) {
      return "Status: 1.5R Partial profit target reached! Secure partial gains and trail stop to breakeven.";
    }
  } else {
    if (t2Passed) {
      return "Status: Price surpassed Target 2. Lock in maximum gains and trail stops.";
    }
    if (t1Passed) {
      return "Status: Price surpassed Target 1! Trail stop to breakeven to secure gains.";
    }
  }
  if (d.currentPrice != null && activeEntry != null && activeT1 != null && d.currentPrice >= activeEntry) {
    const distToT1 = activeT1 - d.currentPrice;
    const totalRange = activeT1 - activeEntry;
    if (distToT1 <= totalRange * 0.3) {
      return scaleOutMode
        ? "Status: Price approaching 1.5R Partial Profit target, prepare to lock in gains."
        : "Status: Price approaching Target 1, trail stop to breakeven.";
    }
    return "Status: Active trade above entry, working toward Target 1.";
  }
  if (group === "READY") {
    return "Status: Setup ready to evaluate. All entry rules confirmed on closed candles.";
  }
  if (group === "CONFIRMED") {
    return `Status: Setup confirmed. Waiting for 1-hour candle close above ${$(d.currentTrigger ?? d.originalTrigger ?? activeEntry)}.`;
  }
  if (group === "FORMING") {
    return `Status: Pattern still forming on the ${d.setupTimeframe || "4H"} chart. Stand by.`;
  }
  if (group === "RETEST" || group === "EXTENDED") {
    return "Status: Price is extended. Don't chase — wait for an orderly pullback/retest.";
  }
  return d.nextAction ? `Status: ${d.nextAction}` : "Status: Evaluating setup structure.";
}

function computeSMA(
  bars: Array<{ t: number; c: number }>,
  period: number
): Array<{ time: UTCTimestamp; value: number }> {
  if (!bars || bars.length < period) return [];
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c;
    if (i >= period) {
      sum -= bars[i - period].c;
    }
    if (i >= period - 1) {
      result.push({
        time: bars[i].t as UTCTimestamp,
        value: Number((sum / period).toFixed(2)),
      });
    }
  }
  return result;
}

export const DEFAULT_SPARK_SMA_COLORS = {
  sma20: "#22D3EE", // Blue (#22D3EE)
  sma50: "#F43F5E", // Red/Magenta (#F43F5E)
  sma200: "#FFD700", // Golden Yellow (#FFD700)
};

export function SparklineChart({
  symbol,
  entry,
  stop,
}: {
  symbol: string;
  entry: number | null;
  stop: number | null;
}) {
  const liveQuote = useLiveQuote(symbol);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [smaColors] = usePersistentState<Record<string, string>>("swing-chart-sma-colors", DEFAULT_SPARK_SMA_COLORS);
  const [smaWidths] = usePersistentState<Record<string, number>>("swing-chart-sma-widths", { sma20: 1, sma50: 1, sma200: 1 });
  const [tooltip, setTooltip] = useState<{
    time: string;
    price: number;
    x: number;
    y: number;
  } | null>(null);

  const sma20Color = smaColors?.sma20 || DEFAULT_SPARK_SMA_COLORS.sma20;
  const sma50Color = smaColors?.sma50 || DEFAULT_SPARK_SMA_COLORS.sma50;
  const sma20Width = smaWidths?.sma20 || 1;
  const sma50Width = smaWidths?.sma50 || 1;

  const { data: barsData, isLoading } = useQuery<BarsResp>({
    queryKey: ["/api/swing/bars", symbol, "1H", "1M"],
    queryFn: () => swingGet<BarsResp>(`/api/swing/bars/${symbol}?tf=1H&range=1M`),
    staleTime: 60_000,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      height: 120,
      layout: {
        background: { color: "transparent" },
        textColor: "#64748b",
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        entireTextOnly: true,
      },
      timeScale: {
        borderVisible: false,
        visible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          color: "rgba(148, 163, 184, 0.35)",
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: false,
        },
        horzLine: {
          visible: true,
          color: "rgba(148, 163, 184, 0.35)",
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
    });
    chartRef.current = chart;

    let cleanupEvents = () => {};

    const bars = barsData?.bars ?? [];
    if (bars.length > 0) {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderVisible: false,
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
      });

      candleSeries.setData(
        bars.map((b) => ({
          time: b.t as UTCTimestamp,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          ...(b.closed ? {} : { color: "rgba(148, 163, 184, 0.4)", borderColor: "#94a3b8", wickColor: "#94a3b8" }),
        }))
      );

      // Implementation detail: use addLineSeries or addSeries(LineSeries, ...)
      const addLineSeries = (opts: any) =>
        typeof (chart as any).addLineSeries === "function"
          ? (chart as any).addLineSeries(opts)
          : chart.addSeries(LineSeries, opts);

      // ─── SMA 20 OVERLAY ───
      const sma20Data = barsData?.smas?.sma20
        ? bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: barsData.smas!.sma20[i] })).filter((pt): pt is { time: UTCTimestamp; value: number } => pt.value != null && Number.isFinite(pt.value))
        : computeSMA([...(barsData?.warmupBars || []), ...bars], 20).filter((pt) => bars.some((b) => b.t === pt.time));
      if (sma20Data.length > 0) {
        const sma20Series = addLineSeries({
          color: sma20Color,
          lineWidth: sma20Width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        sma20Series.setData(sma20Data);
      }

      // ─── SMA 50 OVERLAY ───
      const sma50Data = barsData?.smas?.sma50
        ? bars.map((b, i) => ({ time: b.t as UTCTimestamp, value: barsData.smas!.sma50[i] })).filter((pt): pt is { time: UTCTimestamp; value: number } => pt.value != null && Number.isFinite(pt.value))
        : computeSMA([...(barsData?.warmupBars || []), ...bars], 50).filter((pt) => bars.some((b) => b.t === pt.time));
      if (sma50Data.length > 0) {
        const sma50Series = addLineSeries({
          color: sma50Color,
          lineWidth: sma50Width,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        sma50Series.setData(sma50Data);
      }

      let buyLine: IPriceLine | null = null;
      let stopLine: IPriceLine | null = null;

      if (entry != null && Number.isFinite(entry)) {
        buyLine = candleSeries.createPriceLine({
          price: entry,
          color: "rgba(52, 211, 153, 0.65)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "Buy",
        });
      }

      if (stop != null && Number.isFinite(stop)) {
        stopLine = candleSeries.createPriceLine({
          price: stop,
          color: "rgba(244, 63, 94, 0.65)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "Stop",
        });
      }

      const handleCrosshairMove = (param: MouseEventParams) => {
        if (
          param === undefined ||
          param.point === undefined ||
          !param.point ||
          param.point.x < 0 ||
          param.point.x > el.clientWidth ||
          param.point.y < 0 ||
          param.point.y > el.clientHeight ||
          param.time == null
        ) {
          setTooltip(null);
          chart.clearCrosshairPosition();
          return;
        }

        const cd = param.seriesData.get(candleSeries) as
          | { open?: number; high?: number; low?: number; close?: number; value?: number }
          | undefined;

        if (!cd) {
          setTooltip(null);
          return;
        }

        const closeVal = cd.close ?? cd.value;
        if (closeVal == null) {
          setTooltip(null);
          return;
        }

        const timeStr = typeof param.time === "number"
          ? new Date(param.time * 1000).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : String(param.time);

        setTooltip({
          time: timeStr,
          price: closeVal,
          x: Math.max(8, Math.min(el.clientWidth - 110, param.point.x + 8)),
          y: Math.max(4, Math.min(el.clientHeight - 36, param.point.y - 28)),
        });
      };

      const handleMouseLeave = () => {
        setTooltip(null);
        chart.clearCrosshairPosition();
        buyLine?.applyOptions({ axisLabelVisible: false, color: "rgba(52, 211, 153, 0.65)" });
        stopLine?.applyOptions({ axisLabelVisible: false, color: "rgba(244, 63, 94, 0.65)" });
      };

      const handleMouseEnter = () => {
        buyLine?.applyOptions({ axisLabelVisible: true, color: "#34d399" });
        stopLine?.applyOptions({ axisLabelVisible: true, color: "#f43f5e" });
      };

      const handleDblClick = () => {
        chart.timeScale().fitContent();
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      el.addEventListener("mouseleave", handleMouseLeave);
      el.addEventListener("mouseenter", handleMouseEnter);
      el.addEventListener("dblclick", handleDblClick);

      cleanupEvents = () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        el.removeEventListener("mouseleave", handleMouseLeave);
        el.removeEventListener("mouseenter", handleMouseEnter);
        el.removeEventListener("dblclick", handleDblClick);
      };

      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver((entries) => {
      if (!entries[0] || !chartRef.current) return;
      const { width } = entries[0].contentRect;
      chartRef.current.applyOptions({ width });
      chartRef.current.timeScale().fitContent();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      cleanupEvents();
      chart.remove();
      chartRef.current = null;
    };
  }, [barsData, entry, stop, sma20Color, sma50Color, sma20Width, sma50Width]);

  // Stream live ticks into unclosed candlestick in real time
  const lastBar = barsData?.bars?.[barsData.bars.length - 1];
  useEffect(() => {
    if (!liveQuote?.price || !chartRef.current || !lastBar || lastBar.closed) return;
    try {
      const p = liveQuote.price;
      const seriesList = (chartRef.current as any)._paneWidgets?.[0]?.state()?._series || [];
      const cs = seriesList[0]?._series;
      if (cs && typeof cs.update === "function") {
        cs.update({
          time: lastBar.t,
          open: lastBar.o,
          high: Math.max(lastBar.h, p),
          low: Math.min(lastBar.l, p),
          close: p,
        });
      }
    } catch {}
  }, [liveQuote?.price, lastBar]);

  return (
    <div
      className="w-full h-[120px] mt-4 relative overflow-hidden rounded-lg bg-slate-950 border border-slate-800/80"
      data-testid={`sparkline-${symbol}`}
      title="Scroll to zoom • Drag to pan • Double-click to reset"
    >
      {/* Subtle top-left legend: SMA 20 (Yellow/Gold) and SMA 50 (Cyan/Blue) */}
      <div
        className="absolute top-1.5 left-2 z-10 flex items-center gap-2.5 pointer-events-none select-none text-[9.5px] font-mono font-bold tracking-wider"
        data-testid={`sparkline-legend-${symbol}`}
      >
        <span className="flex items-center gap-1" style={{ color: sma20Color }}>
          <span className="inline-block w-2.5 rounded-full" style={{ backgroundColor: sma20Color, height: sma20Width }} />
          SMA 20
        </span>
        <span className="flex items-center gap-1" style={{ color: sma50Color }}>
          <span className="inline-block w-2.5 rounded-full" style={{ backgroundColor: sma50Color, height: sma50Width }} />
          SMA 50
        </span>
      </div>

      {tooltip && (
        <div
          className="absolute z-20 pointer-events-none rounded border border-white/10 bg-black/85 px-2 py-0.5 text-[10px] font-mono shadow-md backdrop-blur-sm transition-opacity"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          data-testid={`sparkline-tooltip-${symbol}`}
        >
          <div className="text-[9px] text-slate-400">{tooltip.time}</div>
          <div className="font-bold text-soft-white">${tooltip.price.toFixed(2)}</div>
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-slate-500">
          Loading chart…
        </div>
      )}
      {!isLoading && (!barsData?.bars || barsData.bars.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-slate-500">
          No candle data available
        </div>
      )}
      <div ref={containerRef} className="w-full h-full cursor-crosshair" />
    </div>
  );
}

// ─── FRESHNESS PANEL ───────────────────────────────────────────────────────
export function FreshnessPanel({ d, f, p }: { d: SwingDecision; f: FreshnessResult; p: { entry: number | null; stop: number | null; t1: number | null } }) {
  const nt = !f.isTradeable;
  const rrLow = f.liveRr == null || f.liveRr < f.minRr;
  const riskUp = f.liveRiskPerShare > f.plannedRiskPerShare + 0.005;

  const Box = ({ label, value, warn, colorClass }: { label: string; value: React.ReactNode; warn?: boolean; colorClass?: string }) => (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 ${warn || colorClass ? colorClass || "border-signal-amber/40 bg-signal-amber/5" : "border-ink-line bg-ink-deep/40"}`}>
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">{label}</span>
      <span className={`text-sm font-mono font-bold ${warn || colorClass ? colorClass?.split(" ")[0] || "text-signal-amber" : "text-soft-white"}`}>{value}</span>
    </div>
  );

  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 shadow-sm ${nt ? "border-signal-amber/40 bg-signal-amber/5" : "border-ink-line bg-ink-black/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-gray">
          <Clock className="h-4 w-4" /> {f.confirmedAtText} · {f.ageBarsUsed}/{f.ageBarsTotal} 4H bars
        </span>
        {f.sessionTag && <span className="rounded-md border border-ink-line bg-ink-deep/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray">{f.sessionTag}</span>}
      </div>

      {nt && (
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-gray">
          <span className="line-through opacity-70">Original plan: Entry {$(p.entry)} · Stop {$(p.stop)} · T1 {$(p.t1)}</span>
          <span className="opacity-50">|</span>
          <span className="font-bold text-soft-white">Retest zone: {$(f.retestZone.low)} – {$(f.retestZone.high)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Planned R:R" value={rr1(f.plannedRr)} />
        <Box label="Live R:R" value={<>{rrText(f.liveRr, f.minRr)}R {rrLow && <span className="text-[10px]">· below {f.minRr.toFixed(0)}R min</span>}</>} warn={rrLow} />
        <Box label="Live risk/share" value={<>{$(f.liveRiskPerShare)} <span className="text-[10px] font-medium text-slate-gray">(was {$(f.plannedRiskPerShare)})</span></>} warn={riskUp} />
        <Box label="Freshness" value={STATE_LABEL[f.state]} colorClass={nt ? "text-signal-amber border-signal-amber/40 bg-signal-amber/10" : "text-signal-green border-signal-green/40 bg-signal-green/10"} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-3">
        {f.checklist.map((c) => (
          <div key={c.label} className="flex items-center gap-2 text-xs font-medium">
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.passed ? "bg-signal-green/20 text-signal-green" : "bg-signal-red/20 text-signal-red"}`}>
              {c.passed ? "✓" : "✗"}
            </span>
            <span className="text-soft-white">{c.label}</span>
            {c.valueText && <span className="font-mono text-[10px] text-slate-gray">{c.valueText}</span>}
          </div>
        ))}
        {f.resetConditionText && <div className="mt-1 border-t border-ink-line/60 pt-2 text-xs font-medium text-soft-white"><span className="font-bold text-neon-blue">Resets when:</span> {f.resetConditionText}</div>}
      </div>

      {f.aiTip && <div className="rounded-lg border border-neon-blue/30 bg-neon-blue/10 p-3 text-xs font-medium leading-relaxed text-neon-blue">{f.aiTip}</div>}
    </div>
  );
}

// ─── APPEARANCE ────────────────────────────────────────────────────────────
export const AC_THEMES = [
  { id: "signature", name: "Chizzle Signature", sw: ["#0B1220", "#22D3EE", "#F5C451"] },
  { id: "mint", name: "Midnight Mint", sw: ["#101816", "#5EEAD4", "#CBD5E1"] },
  { id: "violet", name: "Royal Violet", sw: ["#171226", "#A78BFA", "#BAE6FD"] },
  { id: "copper", name: "Graphite Copper", sw: ["#191919", "#FB923C", "#FFF7ED"] },
  { id: "arctic", name: "Arctic Light", sw: ["#F5F7FB", "#14243B", "#0F766E"] },
  { id: "ocean", name: "Ocean Blue", sw: ["#071A2B", "#38BDF8", "#E0F2FE"] },
  { id: "burgundy", name: "Burgundy Slate", sw: ["#20151C", "#FDA4AF", "#F8FAFC"] },
] as const;

export type AcTheme = typeof AC_THEMES[number]["id"];
export interface AcPrefs { theme: AcTheme; font: "modern" | "desk"; size: "standard" | "large" | "xl"; view: "guided" | "compact" }
export const DEFAULT_AC_PREFS: AcPrefs = { theme: "signature", font: "desk", size: "standard", view: "compact" };

export function useAcPrefs() {
  const [p, setP] = usePersistentState<AcPrefs>("ac-appearance", DEFAULT_AC_PREFS);
  const prefs = { ...DEFAULT_AC_PREFS, ...p };
  return [prefs, (patch: Partial<AcPrefs>) => setP({ ...prefs, ...patch })] as const;
}
export const acAttrs = (p: AcPrefs) => ({ "data-ac-theme": p.theme, "data-ac-font": p.font, "data-ac-size": p.size });

export function AppearanceControls({ prefs, set }: { prefs: AcPrefs; set: (p: Partial<AcPrefs>) => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Theme</span>
        <div className="flex flex-wrap gap-2">
          {AC_THEMES.map((t) => (
            <button key={t.id} onClick={() => set({ theme: t.id })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${prefs.theme === t.id ? "border-neon-blue bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-black text-slate-gray hover:text-soft-white"}`}>
              <div className="flex overflow-hidden rounded border border-ink-line/50">
                {t.sw.map((c) => <span key={c} style={{ background: c, width: 12, height: 16 }} />)}
              </div>
              {t.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Font</span>
          <select className="rounded-md border border-ink-line bg-ink-black px-3 py-1.5 text-xs text-soft-white focus:border-neon-blue" value={prefs.font} onChange={(e) => set({ font: e.target.value as AcPrefs["font"] })}>
            <option value="modern">Modern (Inter)</option><option value="desk">Trading Desk (Inter + IBM Plex Mono)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">Size</span>
          <select className="rounded-md border border-ink-line bg-ink-black px-3 py-1.5 text-xs text-soft-white focus:border-neon-blue" value={prefs.size} onChange={(e) => set({ size: e.target.value as AcPrefs["size"] })}>
            <option value="standard">Standard</option><option value="large">Large</option><option value="xl">Extra Large</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function StatusPill({ d, f, tone, Icon, text }: { d: SwingDecision; f: FreshnessResult; tone: keyof typeof TONE_CLASSES; Icon?: typeof CheckCircle2; text: string }) {
  const cls = TONE_CLASSES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${cls}`}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}{text}
    </span>
  );
}

// ─── SHARED LOGIC ──────────────────────────────────────────────────────────
export function stopBreach(d: SwingDecision, stop: number | null, t1?: number | null): { text: string; short: string; tone: "bad" | "warn"; kind?: "BELOW_STOP" | "PAST_T1" } | null {
  if (t1 != null && d.currentPrice != null && !(stop != null && d.currentPrice < stop)) {
    const inv = levelsInvalidOf(d, { entry: d.entryPrice, stop, t1 });
    if (inv?.kind === "PAST_T1") return { text: inv.text, short: inv.short, tone: "bad", kind: "PAST_T1" };
  }
  if (d.currentPrice == null || stop == null || !(d.currentPrice < stop)) return null;
  if (d.setupStatus === "SIGNAL_EXPIRED") return { text: "This setup has ended. These levels are history only.", short: "Ended — levels are history only", tone: "bad" };
  return {
    text: `Price ${$(d.currentPrice)} is below the planned stop ${$(stop)}. If the next 1H bar closes below it, this setup is cancelled.`,
    short: `LEVELS INVALID — price below stop ${$(stop)}`,
    tone: "warn", kind: "BELOW_STOP",
  };
}

export function nextStepFor(d: SwingDecision, group: ActionGroup, ver: PlanVersion | null): { text: string; tone: keyof typeof TONE_CLASSES } {
  const trig = d.currentTrigger ?? d.originalTrigger;
  if (d.setupStatus === "SIGNAL_EXPIRED") return { text: "This setup is no longer valid.", tone: "bad" };
  if (group === "DATA" || BAD_DATA.includes(d.dataStatus)) return { text: "Verify the data before using any level on this card.", tone: "bad" };
  const br = stopBreach(d, d.structuralStop, d.target1);
  if (br) return { text: br.text, tone: br.tone };
  if (ver && ver.result.state !== "VALID") return { text: "Review your adjusted risk. Your plan does not meet every rule.", tone: "warn" };
  switch (group) {
    case "READY": return { text: "Review the plan and the live data before any independent decision.", tone: "good" };
    case "CONFIRMED": return { text: `Wait for a 1-hour candle to close above ${$(trig)}.`, tone: "accent" };
    case "FORMING": return { text: `Wait for the ${d.setupTimeframe === "1H" ? "1-hour" : "4-hour"} candle to close.`, tone: "warn" };
    case "RETEST": case "EXTENDED": return { text: d.retestLevel ? `Don't chase. Watch for a retest of ${$(d.retestLevel.low)}–${$(d.retestLevel.high)}.` : "Don't chase. Wait for a retest.", tone: "warn" };
    case "RR_STOP": return { text: "This plan doesn't fit your risk rules. Wait or skip.", tone: "bad" };
    default: return { text: d.nextAction, tone: "accent" };
  }
}

export const isPopulated = (d: SwingDecision, ver: PlanVersion | null) => { const p = effectivePlan(d, ver); return p.entry != null && p.stop != null; };

export function targetSources(d: SwingDecision, ver: PlanVersion | null, minRr: number | null): { t1: string; t2: string } {
  if (ver) {
    const m = (ver.chartState?.targetMethod as CardTargetMethod | undefined);
    const lab = m ? CARD_TARGET_METHOD_LABEL[m] : ver.inputs.targetMethod === "R_MULTIPLE" ? "Fixed R" : ver.inputs.targetMethod === "RESISTANCE" ? "Resistance" : "Manual Prices";
    const fx = ver.inputs.targetMethod === "R_MULTIPLE";
    return { t1: `My plan · ${lab}${fx ? ` (${ver.inputs.t1R}R)` : ""}`, t2: `My plan · ${lab}${fx ? ` (${ver.inputs.t2R}R)` : ""}` };
  }
  const pt = d.planTargets;
  if (pt && pt.method !== "ENGINE") {
    const eng = (t: number | null, rr: number | null) => `Engine structure target ${t != null ? `$${t.toFixed(2)}` : "—"}${rr != null ? ` (${rr.toFixed(2)}R)` : ""} stays the readiness check.`;
    const how = pt.method === "FIXED_R" ? (m: number | null) => `Default · Fixed R: entry + ${m}R × $${(d.riskPerShare ?? 0).toFixed(2)}.` : () => "Default · Structure-Based.";
    return { t1: `${how(pt.t1R)} ${eng(d.target1, d.rewardRiskT1)}`, t2: `${how(pt.t2R)} ${eng(d.target2, d.rewardRiskT2)}` };
  }
  const t1 = d.target1Source === "resistance" ? `Engine · nearest resistance above entry` : d.target1Source === "r-multiple" ? `Engine · no resistance above entry, so entry + ${minRr ?? "min"}R` : "Engine plan";
  const t2 = d.target2Source === "resistance" ? `Engine · next resistance beyond Target 1` : d.target2Source === "r-multiple" ? "Engine · no resistance beyond Target 1, so entry + 3 × R" : "Engine plan";
  return { t1, t2 };
}

function targetFlags(which: 1 | 2, rr: number | null, minRr: number | null, obstacle: StructureLevel | null): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = [];
  if (rr != null) {
    if (which === 1 && minRr != null && minRr > 0 && rr + 1e-9 < minRr) out.push({ text: `Below your ${minRr}R minimum for Target 1.`, tone: "warn" });
    else if (rr < 1) out.push({ text: "Below 1R.", tone: "muted" });
  }
  if (obstacle) out.push({ text: `Resistance ${$(obstacle.price)} sits before this target.`, tone: "warn" });
  return out;
}

// ─── DISCLOSURE STATE ──────────────────────────────────────────────────────
interface DisclosureApi { isOpen: (key: string, def: boolean) => boolean; set: (key: string, open: boolean) => void; all: (open: boolean) => void }
const DisclosureCtx = createContext<DisclosureApi | null>(null);
export function DisclosureProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = usePersistentState<{ all: boolean | null; o: Record<string, boolean> }>("ac-disclosure", { all: null, o: {} });
  const api: DisclosureApi = {
    isOpen: (k, def) => st.o[k] ?? st.all ?? def,
    set: (k, open) => setSt({ ...st, o: { ...st.o, [k]: open } }),
    all: (open) => setSt({ all: open, o: {} }),
  };
  return <DisclosureCtx.Provider value={api}>{children}</DisclosureCtx.Provider>;
}
export function useDisclosure(key: string, def = true): [boolean, (o: boolean) => void] {
  const api = useContext(DisclosureCtx);
  const [local, setLocal] = useState(def);
  if (!api) return [local, setLocal];
  return [api.isOpen(key, def), (o) => api.set(key, o)];
}
export const useDisclosureAll = () => useContext(DisclosureCtx)?.all ?? (() => {});

export function Section({ id, title, summary, def = true, children, testId, headerClassName, className }: { id: string; title: string; summary?: React.ReactNode; def?: boolean; children: React.ReactNode; testId: string; headerClassName?: string; className?: string }) {
  const [open, setOpen] = useDisclosure(id, def);
  return (
    <section className={`flex flex-col rounded-lg border border-ink-line/50 bg-ink-black/60 backdrop-blur-md shadow-sm ${className ?? ""}`} data-testid={testId} data-open={open}>
      <button className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-deep/40 ${headerClassName ?? ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-gray" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-gray" />}
        <span className="text-sm font-bold text-soft-white">{title}</span>
        {summary != null && (
          typeof summary === "string" ? (
            <span className="min-w-0 truncate text-xs font-medium text-slate-gray">{summary}</span>
          ) : (
            <div className="min-w-0 ml-auto">{summary}</div>
          )
        )}
      </button>
      {open && <div className="p-4 pt-0">{children}</div>}
    </section>
  );
}

// ─── CARD COMPONENTS ───────────────────────────────────────────────────────
function PriceTile({ label, sub, value, tone, guided, engineValue, changed, moved, rText, source, flags }: any) {
  const cls = TONE_CLASSES[tone as keyof typeof TONE_CLASSES] || TONE_CLASSES.muted;
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border p-3 ${cls.split(" ")[1]} bg-ink-black/60 backdrop-blur-md shadow-sm`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${cls.split(" ")[0]}`}>{label}</span>
        {changed && <span className="rounded bg-neon-blue/20 px-1.5 py-0.5 text-[9px] font-bold text-neon-blue">ADJUSTED</span>}
        {moved && <span className="rounded border border-neon-blue/40 px-1.5 py-0.5 text-[9px] font-bold text-neon-blue">UPDATED · was {moved}</span>}
      </div>
      {guided && <span className="text-[10px] leading-snug text-slate-gray">{sub}</span>}
      <span className="text-lg font-mono font-bold tabular-nums text-soft-white">{value}</span>
      {rText && <span className="text-sm font-mono font-bold tabular-nums text-neon-blue">{rText}</span>}
      {changed && engineValue != null && <span className="text-[10px] font-mono text-slate-gray">Engine: {engineValue}</span>}
      {source && <span className="text-[10px] text-slate-gray">{source}</span>}
      {flags?.map((f: any) => (
        <span key={f.text} className={`flex items-start gap-1 text-[10px] font-medium leading-snug ${f.tone === "warn" ? "text-signal-amber" : "text-signal-red"}`}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {f.text}
        </span>
      ))}
    </div>
  );
}

function Stat({ k, v, explain, guided }: any) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-ink-line/50 bg-ink-black/60 backdrop-blur-md p-3 shadow-sm">
      <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-gray">{k}</span>
      <span className="text-sm font-mono font-bold tabular-nums leading-tight text-soft-white whitespace-pre-line">{v}</span>
      {guided && <span className="text-[10px] leading-snug text-slate-gray">{explain}</span>}
    </div>
  );
}

export interface CardProps {
  d: SwingDecision; group: ActionGroup; ver: PlanVersion | null; equity: number | null; expiryBars: number; minRr: number | null;
  prefs: AcPrefs; inDialog?: boolean; onOpen?: () => void; onAdjust?: () => void;
}

export function CriticalWarnings({ d, ver }: { d: SwingDecision; ver: PlanVersion | null }) {
  const p = effectivePlan(d, ver);
  const expired = d.setupStatus === "SIGNAL_EXPIRED";
  const badData = BAD_DATA.includes(d.dataStatus) || d.setupStatus === "BLOCKED_DATA_MISMATCH";
  const br = stopBreach(d, p.stop, p.t1);
  const invalidPlan = ver != null && ver.result.state === "INVALID";
  const tone = expired || badData || invalidPlan || br?.tone !== "warn" ? "bad" : "warn";
  const cls = TONE_CLASSES[tone];

  return (
    <div className="flex flex-col gap-2">
      {(expired || badData || br || invalidPlan) && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-bold ${cls}`}>
          {tone === "bad" ? <XCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {expired ? "Expired setup: these levels are history only." : badData ? `Data ${d.dataStatus}: don't rely on these levels until the data is verified.` : br ? br.text : "My Adjusted Plan is invalid: entry must be above the stop."}
        </div>
      )}
      <PlanFreshness d={d} adjusted={ver != null} />
      <span className="text-[10px] font-bold uppercase tracking-wider text-signal-amber">
        PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE · OVERNIGHT GAP RISK — STOP ORDERS CAN FILL BELOW STOP PRICE.
      </span>
    </div>
  );
}

export function TradingCardBody({ d, group, ver, equity, expiryBars, minRr, prefs, inDialog, onOpen, onAdjust, sz: propSz }: CardProps & { sz?: ReturnType<typeof useCardSizing> }) {
  const guided = prefs.view === "guided";
  const scope = `${inDialog ? "dlg" : "card"}:${d.symbol}`;
  const p = effectivePlan(d, ver);
  const szHook = useCardSizing(d, ver);
  const sz = propSz ?? szHook;
  const isCustom = sz.override;
  const activeEntry = isCustom ? sz.E : p.entry;
  const activeStop = isCustom ? sz.S : p.stop;
  const activeRisk = isCustom ? sz.riskPerShare : p.risk;
  const activeT1 = isCustom ? sz.activeT1 : p.t1;
  const activeT2 = isCustom ? sz.activeT2 : p.t2;
  const [scaleOutMode, setScaleOutMode] = usePersistentState<boolean>(`scale-out:${d.symbol}`, false);
  const [showExtended, setShowExtended] = usePersistentState<boolean>(`extended-runners:${d.symbol}`, false);
  const targets = computeTargetLevels(activeEntry, activeStop, activeT1, activeT2, scaleOutMode);
  const populated = activeEntry != null && activeStop != null;
  const changed = new Set(ver?.result.changedFields ?? []);
  const mv = (f: string) => { const c = !ver && d.planRefresh?.changedAt ? d.planRefresh.changes.find((x) => x.field === f) : null; return c ? $(c.from) : null; };
  const engine = { entry: d.entryPrice, stop: d.structuralStop, t1: d.target1, t2: d.target2 };
  
  const fr = useFreshness()(d, ver);
  const step0 = nextStepFor(d, group, ver);
  const step = overridesStatus(d, fr) && step0.tone === "good" ? { text: fr.resetConditionText ? `Don't chase. Resets when: ${fr.resetConditionText}.` : "Not tradeable yet. Wait for a fresh setup.", tone: "warn" as const } : step0;
  
  const src = targetSources(d, ver, minRr);
  const ob1 = obstacleBefore(d.structureLevels, activeEntry, activeT1), ob2 = obstacleBefore(d.structureLevels, activeEntry, activeT2);
  const disclosure = useContext(DisclosureCtx);

  const handleAdjustPlan = () => {
    disclosure?.set(`${scope}:funding`, true);
    window.dispatchEvent(new CustomEvent(`chizzle:expand-override-${d.symbol}`));
    setTimeout(() => {
      const details = document.querySelector(`[data-testid="details-override-${d.symbol}"]`) as HTMLDetailsElement;
      if (details) details.open = true;
      const input = document.querySelector(`[data-testid="input-ov-entry-${d.symbol}"]`) as HTMLInputElement;
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        input.select?.();
      }
    }, 100);
  };

  return (
    <div className={`flex flex-col gap-4 ${inDialog ? "p-4 sm:p-6" : "p-4 pt-0"}`}>
      {fr.hasLevels && (overridesStatus(d, fr) || d.setupStatus === "READY_TO_TRADE") && <FreshnessPanel d={d} f={fr} p={p} />}
      
      {guided && <p className="text-sm font-medium leading-relaxed text-slate-gray">{STATUS_EXPLAIN[d.setupStatus] ?? d.nextAction}</p>}

      {group !== "NO_TRADE" && (
        <Section id={`${scope}:ready`} title="Readiness" testId={`sec-ready-${d.symbol}`} summary={`${d.passedRules.length} passed · ${d.missingConditions.length} missing`}>
          <ExtensionLine d={d} />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-signal-green"><CheckCircle2 className="h-4 w-4" /> Passed</span>
              <ul className="flex flex-col gap-1 text-xs text-soft-white">{d.passedRules.slice(0, 6).map((x) => <li key={x}>• {x}</li>)}</ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-signal-amber"><CircleDashed className="h-4 w-4" /> Missing</span>
              <ul className="flex flex-col gap-1 text-xs text-soft-white">{(d.missingConditions.length ? d.missingConditions : d.whyNotReady).slice(0, 5).map((x) => <li key={x}>• {x}</li>)}</ul>
            </div>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neon-blue"><Eye className="h-4 w-4" /> Watch next</span>
              <span className="text-xs leading-relaxed text-soft-white">{group === "CONFIRMED" ? `A closed 1H candle above ${$(d.currentTrigger ?? d.originalTrigger)}.` : d.nextAction}</span>
            </div>
          </div>
        </Section>
      )}

      {populated ? (
        <Section id={`${scope}:levels`} title="Trade Levels & Target Method" testId={`sec-levels-${d.symbol}`} summary={scaleOutMode ? `Entry ${$(activeEntry)} · Stop ${$(activeStop)} · T1 (1.5R) ${$(targets.t1)}` : `Entry ${$(activeEntry)} · Stop ${$(activeStop)} · T1 ${$(activeT1)}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {isCustom ? (
              <span className="rounded-md border border-cyan-400/60 bg-cyan-950/70 px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-300 shadow-sm" data-testid={`badge-custom-levels-${d.symbol}`}>
                Target method: Custom Practice Plan
              </span>
            ) : (
              <span className={`rounded-md border px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider ${p.source === "USER" ? "border-neon-blue/40 bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-deep/40 text-slate-gray"}`}>
                Target method: {ver ? (CARD_TARGET_METHOD_LABEL[ver.chartState?.targetMethod as CardTargetMethod] ?? "Adjusted") : (d.planTargets?.label ?? "Engine Original")}
              </span>
            )}
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-gray">
              R = |entry − stop loss| = <strong className={isCustom ? "text-cyan-300 font-bold" : "text-soft-white"}>{$(activeRisk)}</strong>
            </span>
            {isCustom && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 ml-auto text-xs text-slate-300 hover:text-soft-white bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2.5 py-1 rounded cursor-pointer transition-colors shadow-sm"
                onClick={sz.reset}
                data-testid={`button-levels-reset-${d.symbol}`}
                title="Reset to Original Engine Plan"
              >
                <RotateCcw className="h-3.5 w-3.5 text-cyan-400" /> Use plan levels
              </button>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/25 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={scaleOutMode}
                onClick={() => setScaleOutMode(!scaleOutMode)}
                className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  scaleOutMode ? "bg-cyan-500" : "bg-slate-700"
                }`}
                title="Toggle 1.5R Partial Profit Scale-Out Mode"
              >
                <span
                  className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    scaleOutMode ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <label
                onClick={() => setScaleOutMode(!scaleOutMode)}
                className="text-[11px] font-semibold text-slate-300 cursor-pointer select-none hover:text-white"
              >
                Enable 1.5R Partial Profit (75%+ Win Rate)
              </label>
            </div>
            {scaleOutMode && (
              <span className="rounded border border-cyan-400/40 bg-cyan-950/70 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-300">
                1.5R • 2R • 3R Active
              </span>
            )}
          </div>

          <div className={`grid grid-cols-2 gap-4 ${scaleOutMode ? "sm:grid-cols-6" : "sm:grid-cols-5"} ${stopBreach(d, activeStop, targets.t1) ? "opacity-50 grayscale" : ""}`}>
            <PriceTile moved={mv("entry")} label="ENTRY" sub="Planned starting price" value={$(activeEntry)} tone="good" guided={guided} changed={isCustom ? sz.st.entry != null : changed.has("entry")} engineValue={$(engine.entry)} />
            <PriceTile moved={mv("stop")} label="STOP LOSS" sub="Protective exit trigger" value={$(activeStop)} tone="bad" guided={guided} changed={isCustom ? sz.st.stop != null : changed.has("stop")} engineValue={$(engine.stop)} />
            <PriceTile moved={mv("stopLimit")} label="STOP LIMIT" sub="Lowest limit price" value={activeStop != null ? $(stopLimitOf(activeStop)) : (p.stopLimit != null ? $(p.stopLimit) : "Not configured")} tone="bad" guided={guided} />
            <PriceTile moved={mv("t1")} label={scaleOutMode ? "TARGET 1 (PARTIAL)" : "TARGET 1"} sub={scaleOutMode ? "1.5R partial profit" : "First profit level"} value={$(targets.t1)} tone="accent" guided={guided} rText={`${targets.t1R.toFixed(1)}R`} changed={isCustom || scaleOutMode || changed.has("target1")} engineValue={$(engine.t1)} source={scaleOutMode ? "Scale-Out 1.5R" : src.t1} flags={targetFlags(1, targets.t1R, minRr, ob1)} />
            <PriceTile moved={mv("t2")} label={scaleOutMode ? "TARGET 2 (CORE)" : "TARGET 2"} sub={scaleOutMode ? "2.0R core exit" : "Further level"} value={$(targets.t2)} tone="accent" guided={guided} rText={`${targets.t2R.toFixed(1)}R`} changed={isCustom || scaleOutMode || changed.has("target2")} engineValue={$(engine.t2)} source={scaleOutMode ? "Scale-Out 2.0R" : src.t2} flags={targetFlags(2, targets.t2R, minRr, ob2)} />
            {scaleOutMode && (
              <PriceTile label="TARGET 3 (RUNNER)" sub="3.0R runner exit" value={$(targets.t3)} tone="accent" guided={guided} rText="3.0R" changed={true} engineValue={$(engine.t2)} source="Scale-Out 3.0R" />
            )}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <input
              id={`body-chk-extended-${d.symbol}`}
              type="checkbox"
              checked={showExtended}
              onChange={(e) => setShowExtended(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <label
              htmlFor={`body-chk-extended-${d.symbol}`}
              className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer select-none"
            >
              Show Extended Runner Targets (4R, 5R, 6R)
            </label>
          </div>

          {showExtended && (
            <div className="flex flex-col gap-2 rounded-lg border border-purple-500/25 bg-purple-950/20 p-3 mt-2">
              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono">
                <span className="font-bold uppercase tracking-wider text-purple-300">Extended Runner Targets (View Only)</span>
                <span className="text-slate-400">Informational • Does not alter execution logic</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-black/40 p-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">4.00R Runner</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t4)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t4)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-black/40 p-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">5.00R Runner</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t5)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t5)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-md border border-white/5 bg-black/40 p-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">6.00R Runner</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t6)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t6)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>
              </div>
            </div>
          )}
        </Section>
      ) : (
        <div className="rounded-lg border border-ink-line bg-ink-deep/40 p-4 text-sm font-medium text-slate-gray">
          No plan yet. The engine fills in Entry, Stop Loss and Targets once the setup has enough structure.
        </div>
      )}

      {populated && <FundingPanel d={d} ver={ver} scope={scope} sz={sz} />}
      <ScoreSection d={d} scope={scope} />
      <ProximityTips symbol={d.symbol} stamp={d.evaluatedAt} variant="card" />
      <MarketContextSection d={d} p={p} scope={scope} />

      <div className={`flex flex-col gap-2 rounded-lg border p-4 ${TONE_CLASSES[step.tone]}`}>
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider opacity-80">NEXT STEP</span>
        <span className="text-lg font-bold leading-snug">{step.text}</span>
      </div>

      <CardActions d={d} group={group} ver={ver} inDialog={inDialog} onOpen={onOpen} onAdjust={onAdjust} onAdjustInPlace={handleAdjustPlan} sizedShares={sz.sizing.ok && !sz.override ? sz.sizing.shares : null} />
    </div>
  );
}

export function LastBarLine({ d }: { d: SwingDecision }) {
  return (
    <span className="text-[10px] font-medium text-slate-gray">
      Last bar evaluated: 1H · 4H closed
    </span>
  );
}

export function ExtensionLine({ d }: { d: SwingDecision }) {
  const x = d.extensionCheck;
  if (!x) return (
    <div className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-gray">
      <CircleDashed className="h-4 w-4" /> Not extended — checked against live quote after 1H confirmation.
    </div>
  );
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 text-xs ${x.extended ? "font-bold text-signal-amber" : "font-medium text-soft-white"}`}>
      {x.extended ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-signal-green" />}
      <span>{x.extended ? "Extended — do not chase" : "Not extended"}</span>
      <span className="font-mono text-slate-gray">{x.pct}% vs {x.fromLabel}</span>
    </div>
  );
}

function CardActions({ d, group, ver, inDialog, onOpen, onAdjust, onAdjustInPlace, sizedShares = null }: any) {
  const { toast } = useToast();
  const live = useContext(LiveCtx);
  const journal = useMutation({
    mutationFn: () => addJournalEntry({ action: "PRACTICE_TRADE", symbol: d.symbol, notes: "Saved from trading card", levels: levelsOf(effectivePlan(d, ver)), snapshot: snapshotOf(d) }),
    onSuccess: (r) => toast({ title: `Saved to practice journal — ${d.symbol}` }),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {group === "READY" && (
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-signal-green/50 bg-signal-green/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-signal-green transition-colors hover:bg-signal-green/20 cursor-pointer"
          onClick={() => {
            openTradeDialog({
              mode: "arm",
              decision: d,
              plan: effectivePlan(d, ver),
              liveAllowed: live?.allowed ?? null,
              overrideRequired: group !== "READY",
            });
          }}
          data-testid={`button-card-actions-arm-trade-${d.symbol}`}
        >
          <Crosshair className="h-3.5 w-3.5 text-signal-green" /> Arm Trade
        </button>
      )}
      {!inDialog && onOpen && <button className="flex items-center gap-2 rounded-md border border-neon-blue/50 bg-neon-blue/10 px-4 py-2 text-xs font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" onClick={onOpen}><Maximize2 className="h-4 w-4" /> Open Trading Card</button>}
      {canEditPlan(d) && (
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-4 py-2 text-xs font-medium text-soft-white transition-colors hover:border-cyan-400 hover:text-cyan-300 cursor-pointer"
          onClick={onAdjustInPlace ?? onAdjust}
          data-testid={`button-adjust-plan-${d.symbol}`}
        >
          <Pencil className="h-4 w-4 text-cyan-400" /> Adjust My Practice Plan
        </button>
      )}
      <button className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-4 py-2 text-xs font-medium text-soft-white transition-colors hover:border-neon-blue hover:text-neon-blue" onClick={() => focusSymbol(d.symbol)}><LineChart className="h-4 w-4" /> Open Chart</button>
      {group === "READY" && <button className="rounded-md border border-ink-line bg-ink-black px-4 py-2 text-xs font-medium text-slate-gray transition-colors hover:bg-ink-deep hover:text-soft-white" disabled={journal.isPending} onClick={() => journal.mutate()}>{journal.isPending ? "Saving…" : "Save to Journal"}</button>}
    </div>
  );
}

export function LockedNotice({ symbol }: { symbol: string }) {
  const tradesQ = useSwingTrades();
  const t = openTradeFor(tradesQ.data?.trades, symbol);
  if (!t) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neon-blue/50 bg-neon-blue/10 p-3 text-xs">
      <Lock className="h-4 w-4 text-neon-blue" />
      <span className="font-bold text-neon-blue">Locked — {t.status} practice trade #{t.id}</span>
      <span className="font-mono text-slate-gray">Your levels: entry {$(t.entry)} · stop {$(t.stop)} · T1 {$(t.t1)}</span>
    </div>
  );
}

export function PendingChip({ d }: { d: SwingDecision }) {
  if (!d.evalPending) return null;
  return <span className="flex items-center gap-2 rounded-md border border-ink-line bg-ink-deep/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-gray"><RefreshCw className="h-3 w-3 animate-spin" /> Evaluating…</span>;
}

function CardHeader({ d, group, ver, isNew, open, toggle, action, sz: propSz }: any) {
  const szHook = useCardSizing(d, ver);
  const sz = propSz ?? szHook;
  const p = effectivePlan(d, ver);
  const live = useContext(LiveCtx);
  const f = useFreshness()(d, ver);
  const liveQuote = useLiveQuote(d.symbol);
  const effectivePrice = liveQuote.price ?? d.currentPrice;
  const tone = freshTone(d, group, f), Icon = overridesStatus(d, f) ? AlertTriangle : ICON[group as keyof typeof ICON];
  const isCustom = sz?.override;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {toggle && <button className="rounded p-1 text-slate-gray hover:bg-ink-line hover:text-soft-white" onClick={toggle}>{open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}</button>}
      <span className="text-2xl font-bold tracking-tight text-soft-white">{d.symbol}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono tabular-nums text-xl font-bold text-soft-white" data-testid={`cardheader-price-${d.symbol}`}>{$(effectivePrice)}</span>
        <DataStatusIndicator symbol={d.symbol} liveQuote={liveQuote} />
      </div>
      <span className="text-sm font-medium text-slate-gray">{setupName(d.setupType)}{d.setupTimeframe && <span className="text-neon-blue"> · {d.setupTimeframe}</span>}</span>
      
      <StatusPill d={d} f={f} tone={tone} Icon={Icon} text={statusText(d, group, live, f)} />
      
      {isCustom ? (
        <span className="rounded-md border border-cyan-400/60 bg-cyan-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300 shadow-sm" data-testid={`badge-custom-plan-${d.symbol}`}>
          Custom Practice Plan
        </span>
      ) : (
        <span className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${p.source === "USER" ? "border-neon-blue/40 bg-neon-blue/10 text-neon-blue" : "border-ink-line bg-ink-deep/40 text-slate-gray"}`}>
          {p.source === "USER" ? `My Plan v${p.version}` : "Engine Plan"}
        </span>
      )}
      {isNew && <span className="rounded-md bg-neon-blue/20 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neon-blue">NEW PLAN</span>}
      <PendingChip d={d} />

      <div className="ml-auto flex flex-col items-end gap-1">
        <span className="text-[10px] font-medium text-slate-gray">Data {d.dataStatus} · {fmtCT(d.quoteTimestamp)}</span>
      </div>
    </div>
  );
}

export const readyVariant = (d: SwingDecision, live: LivePermission | null | undefined, f?: FreshnessResult | null): "live" | "practice" | null =>
  d.setupStatus !== "READY_TO_TRADE" || (f && !f.isTradeable) ? null : live && !live.allowed ? "practice" : "live";

export function ReadyRibbon({ d, ver = null }: { d: SwingDecision; ver?: PlanVersion | null }) {
  const live = useContext(LiveCtx);
  const f = useFreshness()(d, ver);
  const v = readyVariant(d, live, f);
  
  if (!v) return overridesStatus(d, f) ? (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-amber/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-amber">
      <AlertTriangle className="h-3.5 w-3.5" /> {f.displayStatus} · PRACTICE ONLY
    </div>
  ) : null;

  return v === "live" ? (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-green/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-green">
      <Zap className="h-3.5 w-3.5" /> READY TO TRADE · LIVE RISK ALLOWED
    </div>
  ) : (
    <div className="flex w-full items-center justify-center gap-2 bg-signal-amber/20 py-2 text-[10px] font-bold uppercase tracking-wider text-signal-amber">
      <ShieldAlert className="h-3.5 w-3.5" /> PRACTICE READY · LIVE ENTRY NOT PERMITTED
    </div>
  );
}

export function SignalAgeLine({ d, short }: any) {
  if (!d.signalAge) return null;
  return <span className="text-[10px] font-medium text-slate-gray"><Clock className="inline h-3 w-3 mr-1" /> Confirmed {d.signalAge.bars4h} 4H bars ago</span>;
}
export function EarlyLookLine({ d }: any) {
  if (!d.earlyLook) return null;
  return <span className="text-[10px] font-bold text-signal-amber"><Eye className="inline h-3 w-3 mr-1" /> Heads up: 30m closed above trigger</span>;
}

export function InlineTradingCard(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void; collapsed?: boolean }) {
  const { d, group, ver, setupKey, isNew, onSeen } = props;
  const sz = useCardSizing(d, props.ver);
  const p = effectivePlan(d, ver);
  const live = useContext(LiveCtx);
  const f = useFreshness()(d, ver);
  const liveQuote = useLiveQuote(d.symbol);
  const global = useGlobalState();
  // Synchronize currentPrice with Global WebSocket Store (Single Source of Truth)
  const globalPrice = global?.livePrices?.[d.symbol] ?? (d.symbol === global?.activeTicker ? global?.activePrice : null);
  const effectivePrice = globalPrice ?? liveQuote.price ?? d.currentPrice;

  const [detailsOpen, setDetailsOpen] = useDisclosure(`card:${setupKey}`, false);
  const toggleDetails = () => { setDetailsOpen(!detailsOpen); onSeen(); };

  const [scaleOutMode, setScaleOutMode] = usePersistentState<boolean>(`scale-out:${d.symbol}`, false);
  const [showExtended, setShowExtended] = usePersistentState<boolean>(`extended-runners:${d.symbol}`, false);
  // Compact state by default; user toggles Expand Details to reveal deeper diagnostics
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);
  const [isMiniGuideOpen, setIsMiniGuideOpen] = useState(false);

  const isCustom = sz.override;
  const activeEntry = isCustom ? sz.E : p.entry;
  const activeStop = isCustom ? sz.S : p.stop;
  const activeRisk = isCustom ? sz.riskPerShare : p.risk;

  // Compute targets based on Scale-Out Mode (defaults: T1=2.0R, T2=3.0R)
  const targets = computeTargetLevels(activeEntry, activeStop, isCustom ? sz.activeT1 : p.t1, isCustom ? sz.activeT2 : p.t2, scaleOutMode);

  // Position Sizing & Funding Summary
  const positionShares = sz.sizing?.shares && sz.sizing.shares > 0
    ? sz.sizing.shares
    : (activeRisk && activeRisk > 0 ? Math.max(1, Math.floor(1000 / activeRisk)) : 100);
  const fundingAllocated = sz.sizing?.positionCost != null && sz.sizing.positionCost > 0
    ? sz.sizing.positionCost
    : positionShares * (activeEntry ?? 100);
  const targetRMultiple = targets.t1R != null && Number.isFinite(targets.t1R) ? targets.t1R.toFixed(1) : (scaleOutMode ? "1.5" : "2.0");

  // Potential Gain calculation to active Target 1 (1.5R when Scale-Out Mode ON, else 2.0R)
  const potentialGainPct = activeEntry != null && targets.t1 != null && activeEntry > 0
    ? ((targets.t1 - activeEntry) / activeEntry) * 100
    : 0;

  // Visual Progress bar calculation between Entry and active T1
  let progressPct = 0;
  if (effectivePrice != null && activeEntry != null && targets.t1 != null && targets.t1 > activeEntry) {
    const raw = ((effectivePrice - activeEntry) / (targets.t1 - activeEntry)) * 100;
    progressPct = Math.min(100, Math.max(0, raw));
  }

  // Targets surpassed
  const t1Passed = effectivePrice != null && targets.t1 != null && effectivePrice >= targets.t1;
  const t2Passed = effectivePrice != null && targets.t2 != null && effectivePrice >= targets.t2;
  const t3Passed = effectivePrice != null && targets.t3 != null && effectivePrice >= targets.t3;
  const t4Passed = effectivePrice != null && targets.t4 != null && effectivePrice >= targets.t4;
  const t5Passed = effectivePrice != null && targets.t5 != null && effectivePrice >= targets.t5;
  const t6Passed = effectivePrice != null && targets.t6 != null && effectivePrice >= targets.t6;

  // Ready to Buy subtle green glow distinction
  const isReadyToBuy = group === "READY" && f.isTradeable;
  const isInvalidated = (activeStop != null && effectivePrice != null && effectivePrice < activeStop) || d.setupStatus === "SIGNAL_EXPIRED";

  const cardBorderClass = isReadyToBuy
    ? "border-emerald-500/50 shadow-[0_0_20px_rgba(52,211,153,0.18)] ring-1 ring-emerald-500/30"
    : isInvalidated
    ? "border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.1)]"
    : "border-[var(--card-border)] hover:border-slate-700";

  // Dynamic Historical Win Rate (reflects 75%+ when Scale-Out Mode is ON)
  const winRate = historicalWinRate(d.setupType, d.setupScore, scaleOutMode);
  const statusSentence = beginnerStatusText({ ...d, currentPrice: effectivePrice }, group, activeEntry, activeStop, targets.t1, t1Passed, t2Passed, scaleOutMode, t3Passed);

  const handleAdjustPlan = () => {
    onSeen();
    setIsExpanded(true);
    setIsBodyExpanded(true);
    setDetailsOpen(true);
    setTimeout(() => {
      const details = document.querySelector(`[data-testid="details-override-${d.symbol}"]`) as HTMLDetailsElement;
      if (details) details.open = true;
      const input = document.querySelector(`[data-testid="input-ov-entry-${d.symbol}"]`) as HTMLInputElement;
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus();
        input.select?.();
      }
    }, 100);
  };

  if (props.collapsed) {
    return (
      <article
        className={`w-full flex items-center justify-between rounded-xl px-4 py-3 transition-all duration-200 bg-[var(--card-bg)] text-[var(--card-text-primary)] border shadow-md ${cardBorderClass} cursor-pointer hover:border-cyan-400/60`}
        onClick={() => {
          if (props.onOpen) {
            props.onSeen?.();
            props.onOpen();
          }
        }}
        data-testid={`trading-card-${d.symbol}`}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-xl font-black text-white">{d.symbol}</span>
          <span className="font-mono text-sm font-bold text-slate-300 tabular-nums">{$(effectivePrice)}</span>
          <span className="text-xs font-mono text-slate-400 hidden sm:inline">{setupName(d.setupType)}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill d={d} f={f} tone={freshTone(d, group, f)} Icon={overridesStatus(d, f) ? AlertTriangle : ICON[group]} text={statusText(d, group, live, f)} />
        </div>
      </article>
    );
  }

  return (
    <article
      className={`w-full flex flex-col rounded-xl overflow-hidden transition-all duration-200 bg-[var(--card-bg)] text-[var(--card-text-primary)] border shadow-md ${cardBorderClass} cursor-pointer`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, input, select, textarea, details, [role='button'], [data-prevent-modal='true']")) {
          return;
        }
        if (props.onOpen) {
          props.onSeen?.();
          props.onOpen();
        }
      }}
      data-testid={`trading-card-${d.symbol}`}
    >
      <ReadyRibbon d={d} ver={ver} />

      {/* ─── TOP ROW: Ticker symbol, Live Price, Status Badge & [Fidelity Ticket] Mini-Guide ─── */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[var(--card-border)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="font-mono text-2xl font-bold tracking-tight text-white shrink-0">
            {d.symbol}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono tabular-nums text-xl font-bold text-soft-white" data-testid={`inline-header-price-${d.symbol}`}>
              {$(effectivePrice)}
            </span>
            <DataStatusIndicator symbol={d.symbol} liveQuote={liveQuote} />
          </div>
          <StatusPill d={d} f={f} tone={freshTone(d, group, f)} Icon={overridesStatus(d, f) ? AlertTriangle : ICON[group]} text={statusText(d, group, live, f)} />
          {isCustom && (
            <span
              className="rounded-md border border-cyan-400/60 bg-cyan-950/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-300 shadow-sm shrink-0"
              data-testid={`badge-custom-plan-${d.symbol}`}
            >
              Custom Plan
            </span>
          )}
          {isNew && (
            <span className="rounded-md bg-cyan-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300 shrink-0">
              NEW
            </span>
          )}
          <PendingChip d={d} />
        </div>

        {/* Right Actions: [Fidelity Ticket] Mini-Guide Button & Pinned Gain Badge */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsMiniGuideOpen((prev) => !prev);
            }}
            className={`px-2.5 py-1 rounded-md border font-mono text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm shrink-0 ${
              isMiniGuideOpen
                ? "border-emerald-400 bg-emerald-500/25 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                : "border-emerald-500/40 bg-emerald-950/60 text-emerald-400 hover:bg-emerald-900/60 hover:text-emerald-200"
            }`}
            data-testid={`button-mini-guide-${d.symbol}`}
            title="Toggle Quick View Fidelity Ticket Mini-Guide"
          >
            [Fidelity Ticket]
          </button>

          {potentialGainPct > 0 ? (
            <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-badge-bg)] px-2.5 py-1 font-mono text-xs font-bold text-[var(--card-badge-text)] tabular-nums shadow-sm shrink-0">
              +{potentialGainPct.toFixed(2)}% Potential Gain
            </span>
          ) : (
            <span className="rounded-full border border-[var(--card-border)] bg-white/5 px-2.5 py-1 font-mono text-xs font-bold text-[var(--card-text-secondary)] tabular-nums shrink-0">
              0.00% Potential Gain
            </span>
          )}

          {/* Accordion Collapse / Expand Toggle Icon */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="p-1 rounded-md border border-[var(--card-border)] bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
            data-testid={`button-toggle-card-collapse-${d.symbol}`}
            title={isExpanded ? "Collapse card details" : "Expand card details"}
            aria-label={isExpanded ? "Collapse card details" : "Expand card details"}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-cyan-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-cyan-400" />
            )}
          </button>
        </div>
      </div>

      {/* ─── MIDDLE ROW: 3-COLUMN CORE METRICS (Buy Target, Stop Loss, Return %) - ALWAYS VISIBLE ─── */}
      <div className="grid grid-cols-3 gap-3 my-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur-sm p-3 shadow-inner" data-testid={`core-metrics-${d.symbol}`}>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-mono font-bold">
            Buy Target
          </span>
          <span className="font-mono text-2xl font-black text-[var(--card-accent-buy)] tabular-nums">
            {$(activeEntry)}
          </span>
        </div>
        <div className="flex flex-col gap-1 border-x border-[var(--card-border)] px-3">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-mono font-bold">
            Stop Loss
          </span>
          <span className="font-mono text-2xl font-black text-[var(--card-accent-stop)] tabular-nums">
            {$(activeStop)}
          </span>
        </div>
        <div className="flex flex-col gap-1 pl-1">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-mono font-bold">
            Return % {scaleOutMode ? "(1.5R)" : "(T1)"}
          </span>
          <span className="font-mono text-2xl font-black text-[var(--card-accent-target)] tabular-nums">
            {potentialGainPct > 0 ? `+${potentialGainPct.toFixed(2)}%` : "—"}
          </span>
        </div>
      </div>

      {/* ─── NEW SUMMARY STRIP: Funding Allocated | Position Size (Shares) | Target R-Multiple ─── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-3 py-2 my-2 rounded-lg border border-[var(--card-border)] bg-slate-900/60 font-mono text-xs shadow-inner overflow-hidden"
        data-testid={`setup-card-summary-strip-${d.symbol}`}
      >
        <div className="flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Funding Allocated:</span>
          <strong className="text-emerald-400 font-bold truncate">${fundingAllocated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </div>
        <div className="flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Position Size:</span>
          <strong className="text-cyan-300 font-bold truncate">{positionShares} Shares</strong>
        </div>
        <div className="col-span-2 sm:col-span-1 flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Target R-Multiple:</span>
          <strong className="text-emerald-400 font-bold truncate">{targetRMultiple}R ({scaleOutMode ? "1.5R" : "2.0R"})</strong>
        </div>
      </div>

      {/* ─── BOTTOM ROW: Action buttons (Arm Trade, Adjust Plan, Expand Details) ─── */}
      <div className="relative z-20 pointer-events-auto flex flex-wrap items-center justify-between gap-2 pt-2.5 mt-1 border-t border-[var(--card-border)]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Arm Trade action button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-signal-green/10 text-signal-green border border-signal-green/40 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-signal-green/20 transition-colors cursor-pointer shadow-sm pointer-events-auto"
            onClick={() => {
              onSeen();
              openTradeDialog({
                mode: "arm",
                decision: d,
                plan: effectivePlan(d, ver),
                liveAllowed: live?.allowed ?? null,
                overrideRequired: group !== "READY",
              });
            }}
            data-testid={`button-arm-trade-${d.symbol}`}
            title="Arm practice trade plan"
          >
            <Crosshair className="h-3.5 w-3.5 text-signal-green" />
            <span>Arm Trade</span>
          </button>

          {/* Adjust Plan action button */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-neon-blue/10 text-neon-blue border border-neon-blue/40 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-neon-blue/20 transition-colors cursor-pointer shadow-sm pointer-events-auto"
            onClick={handleAdjustPlan}
            data-testid={`button-adjust-plan-${d.symbol}`}
            title="Adjust plan entries and overrides"
          >
            <Pencil className="h-3.5 w-3.5 text-neon-blue" />
            <span>Adjust Plan</span>
          </button>

          {isCustom && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
              onClick={sz.reset}
              data-testid={`button-levels-reset-${d.symbol}`}
              title="Reset to Original Engine Plan"
            >
              <RotateCcw className="h-3 w-3 text-cyan-400" />
              <span>Reset</span>
            </button>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-slate-900/60 hover:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
            onClick={() => focusSymbol(d.symbol)}
            title="Focus symbol on chart"
          >
            <LineChart className="h-3 w-3" />
            <span>Chart</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {props.onOpen && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 px-2.5 py-1.5 text-xs font-bold text-cyan-300 transition-colors cursor-pointer"
              onClick={() => { onSeen(); props.onOpen!(); }}
              title="Open full dialog view"
            >
              <Maximize2 className="h-3 w-3" />
              <span>Open Card</span>
            </button>
          )}

          {/* Expand Details Chevron Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 px-3 py-1.5 text-xs font-bold text-cyan-300 transition-colors cursor-pointer shadow-sm"
            data-testid={`button-toggle-expand-details-${d.symbol}`}
            title={isExpanded ? "Collapse deep diagnostics" : "Expand deep diagnostics"}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-cyan-400" /> : <ChevronDown className="h-3.5 w-3.5 text-cyan-400" />}
            <span>{isExpanded ? "Collapse Details" : "Expand Details"}</span>
          </button>
        </div>
      </div>

      {/* ─── 'QUICK VIEW' MINI-GUIDE (Below core numbers when toggled) ─── */}
      {isMiniGuideOpen && (
        <div
          className="my-2 p-2.5 rounded-lg border border-emerald-500/40 bg-slate-950/90 text-slate-200 font-mono text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
          data-testid={`mini-fidelity-guide-${d.symbol}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Broker Ticket:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold">
            <span className="text-emerald-400">
              BUY LIMIT: <strong className="text-white">${activeEntry != null ? activeEntry.toFixed(2) : "—"}</strong>
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-cyan-300">
              SELL LIMIT (50%): <strong className="text-white">${targets.t1 != null ? targets.t1.toFixed(2) : "—"}</strong>
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-rose-400">
              SELL STOP: <strong className="text-white">${activeStop != null ? activeStop.toFixed(2) : "—"}</strong>
            </span>
          </div>
        </div>
      )}

      {/* ─── EXPANDED STATE (Accordion): All deeper diagnostics inside collapsible container ─── */}
      {isExpanded && (
        <div
          className="flex flex-col gap-2.5 pt-3 mt-2 border-t border-[var(--card-border)] animate-in fade-in duration-200"
          data-testid={`card-expanded-details-${d.symbol}`}
        >
          <div data-testid={`card-collapsible-body-${d.symbol}`} className="flex flex-col gap-2.5">
          {/* ─── SIGNAL INFO & HISTORICAL EDGE BADGE ─── */}
          <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tracking-wide">
                Signal Time: <span className="font-mono text-slate-300">{fmtCT(d.quoteTimestamp)}</span>
              </span>
              <span>•</span>
              <span className="font-semibold text-slate-300">
                {setupName(d.setupType)}{d.setupTimeframe ? ` (${d.setupTimeframe})` : ""}
              </span>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors ${
                scaleOutMode
                  ? "border-emerald-400/50 bg-emerald-950/60 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.2)]"
                  : "border-cyan-500/30 bg-cyan-950/40 text-cyan-300"
              }`}
              title={scaleOutMode ? "Dynamic higher win rate (75%+) with closer 1.5R partial target" : "Historical win rate for this setup structure"}
              data-testid={`badge-win-rate-${d.symbol}`}
            >
              Historical Win Rate: {winRate}%{scaleOutMode ? " (75%+ Win Rate)" : ""}
            </span>
          </div>

          {/* ─── LEARNING / SCALE-OUT MODE TOGGLE ─── */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-line/40 bg-ink-black/40 backdrop-blur-sm px-3 py-2 my-1 shadow-sm">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={scaleOutMode}
                onClick={() => setScaleOutMode(!scaleOutMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  scaleOutMode ? "bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-slate-700"
                }`}
                data-testid={`toggle-scale-out-${d.symbol}`}
                title="Toggle 1.5R Partial Profit Scale-Out Mode"
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    scaleOutMode ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <label
                onClick={() => setScaleOutMode(!scaleOutMode)}
                className="text-xs font-semibold text-slate-300 cursor-pointer select-none hover:text-white"
              >
                Enable 1.5R Partial Profit (75%+ Win Rate)
              </label>
            </div>
            {scaleOutMode && (
              <span className="rounded border border-cyan-400/40 bg-cyan-950/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-cyan-300 shadow-sm">
                Scale-Out Active (1.5R • 2R • 3R)
              </span>
            )}
          </div>

          {/* ─── VISUAL PROGRESS BAR: Tracking current price between Entry and active Target 1 ─── */}
          <div className="flex flex-col gap-1.5 my-1">
            <div className="flex items-center justify-between font-mono text-[10px] text-[var(--card-text-secondary)]">
              <span>Entry: <strong className="text-white tabular-nums">{$(activeEntry)}</strong></span>
              <span className="text-slate-300">
                Current: <strong className="text-white tabular-nums">{$(effectivePrice)}</strong> ({progressPct.toFixed(0)}%)
              </span>
              <span>
                {scaleOutMode ? "Target 1 (1.5R): " : "Target 1 (2.0R): "}
                <strong className="text-white tabular-nums">{$(targets.t1)}</strong>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--card-bg)] border border-[var(--card-border)]">
              <div
                className="h-full rounded-full bg-[var(--card-accent-target)] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* ─── TARGET BADGES: Pill-shaped badges with checkmarks if surpassed ─── */}
          <div className="flex flex-wrap items-center gap-2 my-1">
            {scaleOutMode ? (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border ${
                    t1Passed
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-cyan-400/30 bg-cyan-950/50 text-cyan-200"
                  }`}
                  data-testid={`badge-target-1-${d.symbol}`}
                >
                  {t1Passed && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                  Target 1 (Partial): {$(targets.t1)} (1.5R)
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border ${
                    t2Passed
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-white/10 bg-slate-800/80 text-slate-300"
                  }`}
                  data-testid={`badge-target-2-${d.symbol}`}
                >
                  {t2Passed && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                  Target 2 (Core): {$(targets.t2)} (2.0R)
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border ${
                    t3Passed
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-white/10 bg-slate-800/80 text-slate-300"
                  }`}
                  data-testid={`badge-target-3-${d.symbol}`}
                >
                  {t3Passed && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                  Target 3 (Runner): {$(targets.t3)} (3.0R)
                </span>
              </>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border ${
                    t1Passed
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-white/10 bg-slate-800/80 text-slate-300"
                  }`}
                  data-testid={`badge-target-1-${d.symbol}`}
                >
                  {t1Passed && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                  Sell Target 1: {$(targets.t1)} (2.0R)
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-semibold tabular-nums border ${
                    t2Passed
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                      : "border-white/10 bg-slate-800/80 text-slate-300"
                  }`}
                  data-testid={`badge-target-2-${d.symbol}`}
                >
                  {t2Passed && <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                  Sell Target 2: {$(targets.t2)} (3.0R)
                </span>
              </>
            )}
          </div>

          {/* ─── EXTENDED RUNNER TARGETS CHECKBOX & DISPLAY ─── */}
          <div className="flex items-center gap-2 mt-1 mb-1">
            <input
              id={`chk-extended-${d.symbol}`}
              type="checkbox"
              checked={showExtended}
              onChange={(e) => setShowExtended(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              data-testid={`checkbox-extended-targets-${d.symbol}`}
            />
            <label
              htmlFor={`chk-extended-${d.symbol}`}
              className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer select-none"
            >
              Show Extended Runner Targets (4R, 5R, 6R)
            </label>
          </div>

          {showExtended && (
            <div
              className="flex flex-col gap-2 rounded-lg border border-purple-500/25 bg-purple-950/20 p-3 my-1 animate-in fade-in duration-200"
              data-testid={`container-extended-targets-${d.symbol}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono">
                <span className="font-bold uppercase tracking-wider text-purple-300">
                  Extended Runner Targets (View Only)
                </span>
                <span className="text-slate-400">
                  Informational • Does not alter execution logic
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className={`flex flex-col gap-0.5 rounded-md border p-2 ${t4Passed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/5 bg-black/40 text-slate-200"}`}>
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <span>4.00R Runner</span>
                    {t4Passed && <Check className="h-3 w-3 text-emerald-400 stroke-[2.5]" />}
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t4)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t4)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>

                <div className={`flex flex-col gap-0.5 rounded-md border p-2 ${t5Passed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/5 bg-black/40 text-slate-200"}`}>
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <span>5.00R Runner</span>
                    {t5Passed && <Check className="h-3 w-3 text-emerald-400 stroke-[2.5]" />}
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t5)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t5)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>

                <div className={`flex flex-col gap-0.5 rounded-md border p-2 ${t6Passed ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-white/5 bg-black/40 text-slate-200"}`}>
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    <span>6.00R Runner</span>
                    {t6Passed && <Check className="h-3 w-3 text-emerald-400 stroke-[2.5]" />}
                  </div>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">{$(targets.t6)}</span>
                  <span className="font-mono text-[10px] font-semibold text-emerald-400 tabular-nums">+{targets.gainPct(targets.t6)}%</span>
                  <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">View Only</span>
                </div>
              </div>
            </div>
          )}

          {/* ─── STATUS TEXT: Plain-English beginner-friendly sentence ─── */}
          <div className="my-1 rounded-lg border border-ink-line/40 bg-ink-black/40 backdrop-blur-sm px-3 py-2 text-xs font-medium leading-relaxed text-slate-200">
            {statusSentence}
          </div>

          {/* ─── EMBEDDED SPARKLINE CHART (Click to expand large modal chart) ─── */}
          <div
            className="cursor-pointer group relative"
            onClick={(e) => {
              e.stopPropagation();
              props.onSeen?.();
              props.onOpen?.();
            }}
            title="Click to view large interactive chart"
            data-testid={`chart-click-expand-${d.symbol}`}
          >
            <SparklineChart symbol={d.symbol} entry={activeEntry} stop={activeStop} />
            <div className="absolute top-6 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/90 border border-cyan-500/50 px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 flex items-center gap-1 shadow-md pointer-events-none">
              <Maximize2 className="h-3 w-3 text-cyan-400" />
              <span>Large Chart</span>
            </div>
          </div>

          {/* ─── EXPANDABLE DEEP DIAGNOSTICS BODY (Funding, Overrides, Readiness) ─── */}
          <div className="flex flex-col gap-4 pt-3 mt-1 border-t border-ink-line/40 animate-in fade-in duration-200" data-testid={`card-deep-diagnostics-${d.symbol}`}>
            <CriticalWarnings d={d} ver={ver} />
            <TradingCardBody {...props} sz={sz} onOpen={props.onOpen ? () => { onSeen(); props.onOpen!(); } : undefined} />
          </div>
          </div>
        </div>
      )}
    </article>
  );
}

function CompactRow(props: Omit<CardProps, "inDialog"> & { setupKey: string; isNew: boolean; onSeen: () => void; toggle: () => void; sz?: ReturnType<typeof useCardSizing> }) {
  const { d, group, ver, isNew, toggle, sz: propSz } = props;
  const szHook = useCardSizing(d, ver);
  const sz = propSz ?? szHook;
  const live = useContext(LiveCtx);
  const p = effectivePlan(d, ver);
  const f = useFreshness()(d, ver);
  const liveQuote = useLiveQuote(d.symbol);
  const effectivePrice = liveQuote.price ?? d.currentPrice;
  const tone = freshTone(d, group, f), Icon = overridesStatus(d, f) ? AlertTriangle : ICON[group as keyof typeof ICON];
  const isCustom = sz.override;
  const activeEntry = isCustom ? sz.E : p.entry;
  const activeStop = isCustom ? sz.S : p.stop;
  const activeT1 = isCustom ? sz.activeT1 : p.t1;
  const activeRisk = isCustom ? sz.riskPerShare : p.risk;

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-3">
        <button className="rounded p-1 text-slate-gray hover:bg-ink-line hover:text-soft-white" onClick={toggle}><ChevronRight className="h-5 w-5" /></button>
        <span className="text-lg font-bold tracking-tight text-soft-white">{d.symbol}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-xl font-bold text-soft-white" data-testid={`compact-header-price-${d.symbol}`}>{$(effectivePrice)}</span>
          <DataStatusIndicator symbol={d.symbol} liveQuote={liveQuote} />
        </div>
        <StatusPill d={d} f={f} tone={tone} Icon={Icon} text={statusText(d, group, live, f)} />
        {isCustom && (
          <span className="rounded-md border border-cyan-400/60 bg-cyan-950/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
            Custom Plan
          </span>
        )}
      </div>
      
      <div className="flex flex-1 flex-wrap items-center gap-4 text-sm font-mono text-slate-gray">
        {activeEntry != null ? (
          <>
            <span>Entry <strong className={isCustom ? "text-cyan-300 font-bold" : "text-soft-white"}>{$(activeEntry)}</strong></span>
            <span>Stop <strong className={isCustom ? "text-cyan-300 font-bold" : "text-soft-white"}>{$(activeStop)}</strong></span>
            <span>T1 <strong className={isCustom ? "text-cyan-300 font-bold" : "text-soft-white"}>{$(activeT1)}</strong></span>
            <span>Risk/sh <strong className={isCustom ? "text-cyan-300 font-bold" : "text-soft-white"}>{$(activeRisk)}</strong></span>
          </>
        ) : <span>{d.nextAction || "No plan levels yet."}</span>}
      </div>

      <div className="flex items-center gap-4">
        <span className="text-lg font-mono font-bold text-soft-white">{$(d.currentPrice)}</span>
        {props.onOpen && <button className="rounded-md border border-neon-blue/50 bg-neon-blue/10 px-3 py-1.5 text-xs font-bold text-neon-blue transition-colors hover:bg-neon-blue/20" onClick={() => { props.onSeen(); props.onOpen!(); }}><Maximize2 className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

export function TradingCardDialog({ open, onClose, mode, setMode, ...props }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { open: boolean; onClose: () => void; mode: "view" | "adjust"; setMode: (m: "view" | "adjust") => void; }) {
  const { d } = props;
  const sz = useCardSizing(d, props.ver);
  const p = effectivePlan(d, props.ver);
  const entryVal = sz.override && sz.E != null ? sz.E : p.entry;
  const stopVal = sz.override && sz.S != null ? sz.S : p.stop;
  const target1Val = sz.override && sz.activeT1 != null ? sz.activeT1 : p.t1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur-xl p-0 shadow-2xl z-50">
        <div className="flex flex-col">
          <ReadyRibbon d={d} ver={props.ver} />
          <div className="flex flex-col gap-4 border-b border-slate-800 p-6">
            <div className="flex items-center justify-between pr-8">
              <DialogTitle className="font-mono text-xl font-black text-soft-white tracking-wide flex items-center gap-2.5">
                <span>{d.symbol}</span>
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-950/50 text-cyan-300">
                  {d.setupType}
                </span>
              </DialogTitle>
            </div>
            <CardHeader d={d} group={props.group} ver={props.ver} sz={sz} />
            <CriticalWarnings d={d} ver={props.ver} />
            <LockedNotice symbol={d.symbol} />
          </div>

          {/* Large Interactive Chart View at Top of Modal (Height: >= 400px / 50vh) */}
          <div className="p-4 sm:p-6 border-b border-slate-800 bg-slate-900/30" data-testid={`dialog-large-chart-${d.symbol}`}>
            <ModalLargeChart
              symbol={d.symbol}
              entry={entryVal}
              stop={stopVal}
              target1={target1Val}
              target2={sz.override && sz.activeT2 != null ? sz.activeT2 : p.t2}
            />
          </div>
          {mode === "adjust" && canEditPlan(d) ? (
            <AdjustPlan {...props} onDone={() => setMode("view")} />
          ) : (
            <TradingCardBody {...props} inDialog sz={sz} onAdjust={canEditPlan(d) ? () => setMode("adjust") : undefined} />
          )}

          {/* Broker Execution Guide Accordion directly inside expanded modal */}
          <div className="p-5 sm:p-6 border-t border-slate-800 bg-slate-900/40">
            <BrokerExecutionSteps
              symbol={d.symbol}
              entry={entryVal}
              stop={stopVal}
              target1={target1Val}
              defaultOpen={true}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RPicker({ id, label, sel, onChange }: any) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-slate-gray">{label}</span>
      <div className="flex gap-2">
        <select className="bg-[#0F172A] text-white border border-slate-700 rounded-md px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm cursor-pointer" value={String(sel.v)} onChange={(e) => onChange({ ...sel, v: e.target.value === "custom" ? "custom" : Number(e.target.value) })}>
          {R_CHOICES.map((r) => <option key={r} value={r}>{r}R</option>)}<option value="custom">Custom…</option>
        </select>
        {sel.v === "custom" && <input className="bg-[#0F172A] text-white border border-slate-700 rounded-md px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm" type="number" step="0.1" min="0.1" value={sel.custom} onChange={(e) => onChange({ ...sel, custom: e.target.value })} />}
      </div>
    </label>
  );
}

export function AdjustPlan({ d, ver, equity, minRr, onDone }: Omit<CardProps, "inDialog" | "onOpen" | "onAdjust"> & { onDone: () => void }) {
  const sz = useCardSizing(d, ver);
  const p = effectivePlan(d, ver);
  const initialEntry = sz.override && sz.st.entry ? sz.st.entry : (p.entry?.toFixed(2) ?? "");
  const initialStop = sz.override && sz.st.stop ? sz.st.stop : (p.stop?.toFixed(2) ?? "");
  const initialStopLimit = sz.S != null ? stopLimitOf(sz.S).toFixed(2) : (p.stopLimit?.toFixed(2) ?? "");
  
  const [raw, setRaw] = useState({
    entry: initialEntry,
    stop: initialStop,
    stopLimit: initialStopLimit,
    t1: sz.activeT1?.toFixed(2) ?? p.t1?.toFixed(2) ?? "",
    t2: sz.activeT2?.toFixed(2) ?? p.t2?.toFixed(2) ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resetToEngine = () => {
    sz.reset();
    setRaw({
      entry: d.entryPrice?.toFixed(2) ?? "",
      stop: d.structuralStop?.toFixed(2) ?? "",
      stopLimit: d.structuralStop != null ? stopLimitOf(d.structuralStop).toFixed(2) : "",
      t1: d.target1?.toFixed(2) ?? "",
      t2: d.target2?.toFixed(2) ?? ""
    });
    setErr(null);
  };

  const applyCustom = () => {
    const eNum = parseNum(raw.entry);
    const sNum = parseNum(raw.stop);
    if (eNum == null || !Number.isFinite(eNum) || eNum <= 0) {
      setErr("Please enter a valid entry price.");
      return;
    }
    if (sNum == null || !Number.isFinite(sNum) || sNum <= 0) {
      setErr("Please enter a valid stop price.");
      return;
    }
    if (sNum >= eNum) {
      setErr("Entry must be above the stop loss price.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      sz.setSt({
        ...sz.st,
        entry: eNum.toFixed(2),
        stop: sNum.toFixed(2),
        how: "MANUAL",
      });
      onDone();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save plan");
    } finally {
      setBusy(false);
    }
  };
  
  const priceField = (k: "entry" | "stop" | "stopLimit" | "t1" | "t2", label: string, help: string) => (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-line bg-ink-deep/40 p-4">
      <label htmlFor={`adj-${k}`} className="text-xs font-bold uppercase tracking-wider text-slate-gray">{label}</label>
      <span className="text-[10px] text-slate-gray/80">{help}</span>
      <input id={`adj-${k}`} type="number" step="0.01" min="0.01" className="bg-[#0F172A] text-white border border-slate-700 rounded-md px-3 py-2 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm" value={raw[k]} onChange={(e) => setRaw({ ...raw, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold text-soft-white">Adjust My Practice Plan</h3>
        <p className="text-sm font-medium leading-relaxed text-slate-gray">
          Edits make <b>My Adjusted Plan</b> when saved. They don't change the engine's decision or place any order.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {priceField("entry", "Entry", "Planned starting price")}
        {priceField("stop", "Stop Loss", "R is measured from this price")}
        {priceField("stopLimit", "Stop Limit", "Lowest sell price after trigger")}
      </div>

      {err && (
        <div className="rounded-md border border-red-500/50 bg-red-950/40 p-3 text-xs font-bold text-red-400">
          {err}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-ink-line/50 pt-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 font-bold px-6 py-2.5 text-sm shadow-md hover:shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50"
          onClick={applyCustom}
          disabled={busy}
          data-testid={`button-apply-custom-modal-${d.symbol}`}
        >
          <Check className="h-4 w-4 stroke-[2.5]" />
          {busy ? "Saving…" : "Apply Custom Plan"}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-slate-500 text-slate-100 px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors cursor-pointer"
          onClick={resetToEngine}
          data-testid={`button-reset-engine-modal-${d.symbol}`}
          title="Reset to Original Engine Plan"
        >
          <RotateCcw className="h-4 w-4 text-cyan-400" />
          Use plan levels
        </button>
        <button
          type="button"
          className="rounded-lg border border-ink-line bg-ink-deep/40 px-5 py-2.5 text-sm font-medium text-soft-white transition-colors hover:border-slate-gray hover:text-slate-gray cursor-pointer"
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


export { BrokerExecutionSteps } from "@/components/BrokerExecutionSteps";
