import React, { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  CrosshairMode,
  type IChartApi,
  type IPriceLine,
  type MouseEventParams,
  type UTCTimestamp,
} from "lightweight-charts";
import { swingGet, type BarsResp } from "@/lib/swing";
import { useLiveQuote } from "@/lib/useLivePrices";
import { RotateCcw, Activity } from "lucide-react";

export interface ModalLargeChartProps {
  symbol: string;
  entry?: number | null;
  stop?: number | null;
  target1?: number | null;
  target2?: number | null;
  defaultTf?: "1H" | "4H" | "1D";
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

export function ModalLargeChart({
  symbol,
  entry,
  stop,
  target1,
  defaultTf = "1H",
}: ModalLargeChartProps) {
  const [tf, setTf] = useState<"1H" | "4H" | "1D">(defaultTf);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const liveQuote = useLiveQuote(symbol);

  const range = tf === "1H" ? "1M" : tf === "4H" ? "3M" : "1Y";

  const { data: barsData, isLoading } = useQuery<BarsResp>({
    queryKey: ["/api/swing/bars", symbol, tf, range],
    queryFn: () => swingGet<BarsResp>(`/api/swing/bars/${symbol}?tf=${tf}&range=${range}`),
    staleTime: 60_000,
  });

  const [tooltip, setTooltip] = useState<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    vol?: number;
    x: number;
    y: number;
  } | null>(null);

  // Compute SMA series
  const bars = barsData?.bars ?? [];
  const warmup = barsData?.warmupBars ?? [];
  const combined = useMemo(() => [...warmup, ...bars], [warmup, bars]);

  const sma20Data = useMemo(() => {
    if (barsData?.smas?.sma20 && bars.length > 0) {
      return bars
        .map((b, i) => ({ time: b.t as UTCTimestamp, value: barsData.smas!.sma20[i] }))
        .filter((pt): pt is { time: UTCTimestamp; value: number } => pt.value != null && Number.isFinite(pt.value));
    }
    return computeSMA(combined, 20).filter((pt) => bars.some((b) => b.t === pt.time));
  }, [barsData, combined, bars]);

  const sma50Data = useMemo(() => {
    if (barsData?.smas?.sma50 && bars.length > 0) {
      return bars
        .map((b, i) => ({ time: b.t as UTCTimestamp, value: barsData.smas!.sma50[i] }))
        .filter((pt): pt is { time: UTCTimestamp; value: number } => pt.value != null && Number.isFinite(pt.value));
    }
    return computeSMA(combined, 50).filter((pt) => bars.some((b) => b.t === pt.time));
  }, [barsData, combined, bars]);

  const sma200Data = useMemo(() => {
    if (barsData?.smas?.sma200 && bars.length > 0) {
      return bars
        .map((b, i) => ({ time: b.t as UTCTimestamp, value: barsData.smas!.sma200[i] }))
        .filter((pt): pt is { time: UTCTimestamp; value: number } => pt.value != null && Number.isFinite(pt.value));
    }
    return computeSMA(combined, 200).filter((pt) => bars.some((b) => b.t === pt.time));
  }, [barsData, combined, bars]);

  const lastSma20 = sma20Data.length > 0 ? sma20Data[sma20Data.length - 1].value : null;
  const lastSma50 = sma50Data.length > 0 ? sma50Data[sma50Data.length - 1].value : null;
  const lastSma200 = sma200Data.length > 0 ? sma200Data[sma200Data.length - 1].value : null;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 800,
      height: el.clientHeight || 400,
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)", style: LineStyle.Dotted },
        horzLines: { color: "rgba(255, 255, 255, 0.05)", style: LineStyle.Dotted },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: true,
        borderColor: "rgba(255, 255, 255, 0.12)",
        scaleMargins: { top: 0.12, bottom: 0.18 },
        entireTextOnly: false,
      },
      timeScale: {
        visible: true,
        borderVisible: true,
        borderColor: "rgba(255, 255, 255, 0.12)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          visible: true,
          color: "rgba(56, 189, 248, 0.5)",
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
        },
        horzLine: {
          visible: true,
          color: "rgba(56, 189, 248, 0.5)",
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

    if (bars.length > 0) {
      // 1. Candlestick Series
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#f43f5e",
        borderUpColor: "#10b981",
        borderDownColor: "#f43f5e",
        wickUpColor: "#10b981",
        wickDownColor: "#f43f5e",
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

      // 2. Volume Series at bottom
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: "rgba(34, 197, 94, 0.25)",
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });

      volumeSeries.setData(
        bars.map((b) => ({
          time: b.t as UTCTimestamp,
          value: b.v ?? 0,
          color: b.c >= b.o ? "rgba(16, 185, 129, 0.25)" : "rgba(244, 63, 94, 0.25)",
        }))
      );

      // Helper to add lines safely
      const addLineSeries = (opts: any) =>
        typeof (chart as any).addLineSeries === "function"
          ? (chart as any).addLineSeries(opts)
          : chart.addSeries(LineSeries, opts);

      // 3. SMA 20 (Yellow)
      if (sma20Data.length > 0) {
        const sma20Series = addLineSeries({
          color: "#fbbf24",
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        sma20Series.setData(sma20Data);
      }

      // 4. SMA 50 (Cyan)
      if (sma50Data.length > 0) {
        const sma50Series = addLineSeries({
          color: "#06b6d4",
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        sma50Series.setData(sma50Data);
      }

      // 5. SMA 200 (Magenta)
      if (sma200Data.length > 0) {
        const sma200Series = addLineSeries({
          color: "#c084fc",
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        sma200Series.setData(sma200Data);
      }

      // 6. Buy / Stop / Target Overlays
      if (entry != null && Number.isFinite(entry)) {
        candleSeries.createPriceLine({
          price: entry,
          color: "#34d399",
          lineWidth: 1.5,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "BUY TARGET",
        });
      }

      if (stop != null && Number.isFinite(stop)) {
        candleSeries.createPriceLine({
          price: stop,
          color: "#f43f5e",
          lineWidth: 1.5,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "STOP LOSS",
        });
      }

      if (target1 != null && Number.isFinite(target1)) {
        candleSeries.createPriceLine({
          price: target1,
          color: "#22c55e",
          lineWidth: 1.5,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "TARGET 1",
        });
      }

      // 7. Interactive Crosshair & Tooltip
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
          | { open?: number; high?: number; low?: number; close?: number }
          | undefined;

        if (!cd || cd.open == null || cd.close == null) {
          setTooltip(null);
          return;
        }

        const vd = param.seriesData.get(volumeSeries) as { value?: number } | undefined;

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
          open: cd.open,
          high: cd.high ?? cd.open,
          low: cd.low ?? cd.close,
          close: cd.close,
          vol: vd?.value,
          x: Math.max(10, Math.min(el.clientWidth - 230, param.point.x + 12)),
          y: Math.max(10, Math.min(el.clientHeight - 110, param.point.y - 40)),
        });
      };

      const handleMouseLeave = () => {
        setTooltip(null);
        chart.clearCrosshairPosition();
      };

      const handleDblClick = () => {
        chart.timeScale().fitContent();
      };

      chart.subscribeCrosshairMove(handleCrosshairMove);
      el.addEventListener("mouseleave", handleMouseLeave);
      el.addEventListener("dblclick", handleDblClick);

      cleanupEvents = () => {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        el.removeEventListener("mouseleave", handleMouseLeave);
        el.removeEventListener("dblclick", handleDblClick);
      };

      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver((entries) => {
      if (!entries[0] || !chartRef.current) return;
      const { width, height } = entries[0].contentRect;
      chartRef.current.applyOptions({ width, height: height || 400 });
      chartRef.current.timeScale().fitContent();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      cleanupEvents();
      chart.remove();
      chartRef.current = null;
    };
  }, [barsData, entry, stop, target1, sma20Data, sma50Data, sma200Data]);

  // Stream live ticks into unclosed candlestick in real time
  const lastBar = bars[bars.length - 1];
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

  const fitView = () => {
    chartRef.current?.timeScale().fitContent();
  };

  return (
    <div
      className="w-full flex flex-col rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl"
      data-testid={`modal-large-chart-container-${symbol}`}
    >
      {/* Chart Top Header & Controls */}
      <div className="px-4 py-2.5 border-b border-slate-800 bg-slate-900/80 flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Left: Ticker & Live Price */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-black text-white">{symbol}</span>
            <span className="font-mono text-xs font-bold text-cyan-400">
              ${liveQuote?.price != null ? liveQuote.price.toFixed(2) : (bars[bars.length - 1]?.c ? bars[bars.length - 1].c.toFixed(2) : "—")}
            </span>
          </div>

          {/* Timeframe Switcher Pills */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-950/80 p-0.5 font-mono text-[11px] font-bold">
            {(["1H", "4H", "1D"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTf(t)}
                className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  tf === t
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
                data-testid={`btn-tf-${t.toLowerCase()}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Right: SMA Badges & Reset View Button */}
        <div className="flex items-center gap-3 font-mono text-xs">
          {/* 20-SMA Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
            <span className="font-bold">20-SMA:</span>
            <span className="tabular-nums text-slate-200">
              ${lastSma20 != null ? lastSma20.toFixed(2) : "—"}
            </span>
          </div>

          {/* 50-SMA Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
            <span className="font-bold">50-SMA:</span>
            <span className="tabular-nums text-slate-200">
              ${lastSma50 != null ? lastSma50.toFixed(2) : "—"}
            </span>
          </div>

          {/* 200-SMA Badge */}
          <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">
            <span className="h-2 w-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(192,132,252,0.8)]" />
            <span className="font-bold">200-SMA:</span>
            <span className="tabular-nums text-slate-200">
              ${lastSma200 != null ? lastSma200.toFixed(2) : "—"}
            </span>
          </div>

          {/* Fit View Button */}
          <button
            type="button"
            onClick={fitView}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer text-[11px] font-semibold shadow-sm"
            title="Reset Zoom / Fit Content"
            data-testid={`btn-fit-chart-${symbol}`}
          >
            <RotateCcw className="h-3 w-3 text-cyan-400" />
            <span>Fit View</span>
          </button>
        </div>
      </div>

      {/* Main Chart Canvas Area (Height: 400px / 50vh) */}
      <div className="relative w-full h-[400px] md:h-[450px] bg-slate-950">
        {/* Hover Crosshair Tooltip */}
        {tooltip && (
          <div
            className="absolute z-30 pointer-events-none rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs font-mono shadow-xl backdrop-blur-md"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
            data-testid={`modal-chart-tooltip-${symbol}`}
          >
            <div className="text-[10px] text-slate-400 font-semibold border-b border-slate-800 pb-1 mb-1">
              {tooltip.time}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              <div><span className="text-slate-500">O:</span> <span className="text-slate-200">${tooltip.open.toFixed(2)}</span></div>
              <div><span className="text-slate-500">H:</span> <span className="text-emerald-400">${tooltip.high.toFixed(2)}</span></div>
              <div><span className="text-slate-500">L:</span> <span className="text-red-400">${tooltip.low.toFixed(2)}</span></div>
              <div><span className="text-slate-500">C:</span> <span className="font-bold text-white">${tooltip.close.toFixed(2)}</span></div>
            </div>
            {tooltip.vol != null && (
              <div className="text-[10px] text-slate-400 pt-1 mt-1 border-t border-slate-800/60">
                Vol: <span className="text-slate-300 tabular-nums">{tooltip.vol.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 z-20 font-mono text-xs text-slate-400 flex-col gap-2">
            <Activity className="h-6 w-6 text-cyan-400 animate-spin" />
            <span>Loading chart data…</span>
          </div>
        )}

        <div ref={containerRef} className="w-full h-full cursor-crosshair" />
      </div>
    </div>
  );
}

export default ModalLargeChart;

