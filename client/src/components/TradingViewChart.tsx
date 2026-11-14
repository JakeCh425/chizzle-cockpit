// TradingViewChart — Decluttered institutional chart powered by lightweight-charts.
//
// Locked strictly to 3 SMAs:
//   - 10-SMA: Amber (#F59E0B)
//   - 20-SMA: Cyan (#06B6D4)
//   - 50-SMA: Purple (#A855F7)
//
// Paired side-by-side with AICoachPanel in a responsive 2-column layout:
//   - Left: Decluttered Chart + Clean Header (Ticker, Live Price, Timeframe) + 3-SMA Legend
//   - Right: AI Candle Coach & In-Chart Trade Card Funnel

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { AICoachPanel } from "@/components/AICoachPanel";
import { useMarketDataStore } from "@/lib/useMarketDataStore";
import type { Timeframe } from "@/lib/timeframes";

export interface OHLCBar {
  time?: number;
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TradingViewChartProps {
  ticker: string;
  bars: OHLCBar[] | undefined;
  isLoading?: boolean;
  barsWarning?: string;
  regime?: string;
  height?: number;
  timeframe?: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  mtfStrip?: React.ReactNode;
  entryPrice?: number;
  stopLoss?: number;
  primaryTarget?: number;
}

function calculateSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function barTimeToUtc(b: OHLCBar): UTCTimestamp {
  if (typeof b.time === "number" && isFinite(b.time)) {
    return (b.time > 1e11 ? Math.floor(b.time / 1000) : Math.floor(b.time)) as UTCTimestamp;
  }
  if (b.date) {
    return Math.floor(new Date(b.date + (b.date.includes("T") ? "" : "T00:00:00Z")).getTime() / 1000) as UTCTimestamp;
  }
  return 0 as UTCTimestamp;
}

export default function TradingViewChart({
  ticker,
  bars: barsRaw,
  isLoading,
  barsWarning,
  regime,
  height = 420,
  timeframe = "1D",
  onTimeframeChange,
  mtfStrip,
  entryPrice,
  stopLoss,
  primaryTarget,
}: TradingViewChartProps) {
  const marketStore = useMarketDataStore();

  // Auto-hiding timeout for chart warning / overlay text
  const [isWarningVisible, setIsWarningVisible] = useState(true);
  const [shouldRenderWarning, setShouldRenderWarning] = useState(true);

  useEffect(() => {
    if (!barsWarning) {
      setShouldRenderWarning(false);
      return;
    }
    setIsWarningVisible(true);
    setShouldRenderWarning(true);

    const fadeTimer = setTimeout(() => {
      setIsWarningVisible(false);
    }, 3500);

    const unmountTimer = setTimeout(() => {
      setShouldRenderWarning(false);
    }, 4500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, [barsWarning, ticker, timeframe]);

  // Defensive array normalization
  const rawBars: OHLCBar[] = Array.isArray(barsRaw)
    ? barsRaw
    : (barsRaw && Array.isArray((barsRaw as any).bars) ? (barsRaw as any).bars : []);

  // Sort and deduplicate bars strictly by timestamp for lightweight-charts
  const sortedBars = useMemo(() => {
    if (!rawBars || rawBars.length === 0) return [];
    const map = new Map<number, OHLCBar>();
    for (const b of rawBars) {
      const t = barTimeToUtc(b);
      if (t > 0 && !isNaN(b.open) && !isNaN(b.close) && !isNaN(b.high) && !isNaN(b.low)) {
        map.set(t, b);
      }
    }
    return Array.from(map.entries())
      .sort(([t1], [t2]) => t1 - t2)
      .map(([_, b]) => b);
  }, [rawBars]);

  // Determine current live price
  const latestBarClose = sortedBars.length > 0 ? sortedBars[sortedBars.length - 1].close : 0;
  const currentLivePrice =
    (marketStore.activeTicker === ticker && marketStore.currentPrice != null)
      ? marketStore.currentPrice
      : (marketStore.prices[ticker] ?? latestBarClose);

  // References for chart container & lightweight-charts instances
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  // State for active / hovered SMA values
  const [activeSMA, setActiveSMA] = useState<{
    sma10: number | null;
    sma20: number | null;
    sma50: number | null;
    close: number | null;
  }>({
    sma10: null,
    sma20: null,
    sma50: null,
    close: null,
  });

  // Calculate the 3 locked SMAs
  const smaCalculations = useMemo(() => {
    const closes = sortedBars.map((b) => b.close);
    const s10 = calculateSMA(closes, 10);
    const s20 = calculateSMA(closes, 20);
    const s50 = calculateSMA(closes, 50);
    return { closes, s10, s20, s50 };
  }, [sortedBars]);

  // Update default SMA display values to the last bar
  useEffect(() => {
    const { closes, s10, s20, s50 } = smaCalculations;
    const len = closes.length;
    if (len > 0) {
      setActiveSMA({
        sma10: s10[len - 1],
        sma20: s20[len - 1],
        sma50: s50[len - 1],
        close: closes[len - 1],
      });
    } else {
      setActiveSMA({ sma10: null, sma20: null, sma50: null, close: null });
    }
  }, [smaCalculations]);

  // Initialize and update Lightweight Charts
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up any previous chart instance
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "#060913" },
        textColor: "#94A3B8",
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(148, 163, 184, 0.4)", style: LineStyle.Dashed, width: 1 },
        horzLine: { color: "rgba(148, 163, 184, 0.4)", style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.08)",
        textColor: "#94A3B8",
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.08)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      autoSize: false,
    });
    chartRef.current = chart;

    // 1. Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10B981",
      downColor: "#EF4444",
      borderVisible: false,
      wickUpColor: "#10B981",
      wickDownColor: "#EF4444",
    });

    if (sortedBars.length > 0) {
      candleSeries.setData(
        sortedBars.map((b) => ({
          time: barTimeToUtc(b),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    }

    // 2. Locked 10-SMA (Amber)
    const sma10Series = chart.addSeries(LineSeries, {
      color: "#F59E0B",
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma10Data = sortedBars
      .map((b, i) => {
        const val = smaCalculations.s10[i];
        return val != null ? { time: barTimeToUtc(b), value: val } : null;
      })
      .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

    if (sma10Data.length > 0) {
      sma10Series.setData(sma10Data);
    }

    // 3. Locked 20-SMA (Cyan)
    const sma20Series = chart.addSeries(LineSeries, {
      color: "#06B6D4",
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma20Data = sortedBars
      .map((b, i) => {
        const val = smaCalculations.s20[i];
        return val != null ? { time: barTimeToUtc(b), value: val } : null;
      })
      .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

    if (sma20Data.length > 0) {
      sma20Series.setData(sma20Data);
    }

    // 4. Locked 50-SMA (Purple)
    const sma50Series = chart.addSeries(LineSeries, {
      color: "#A855F7",
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });

    const sma50Data = sortedBars
      .map((b, i) => {
        const val = smaCalculations.s50[i];
        return val != null ? { time: barTimeToUtc(b), value: val } : null;
      })
      .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

    if (sma50Data.length > 0) {
      sma50Series.setData(sma50Data);
    }

    // 5. Price lines for Entry, Stop Loss, Target if set
    if (entryPrice != null && entryPrice > 0) {
      candleSeries.createPriceLine({
        price: entryPrice,
        color: "#10B981",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "ENTRY",
      });
    }

    if (stopLoss != null && stopLoss > 0) {
      candleSeries.createPriceLine({
        price: stopLoss,
        color: "#EF4444",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "STOP",
      });
    }

    if (primaryTarget != null && primaryTarget > 0) {
      candleSeries.createPriceLine({
        price: primaryTarget,
        color: "#06B6D4",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "TARGET 1",
      });
    }

    // Auto-fit contents
    chart.timeScale().fitContent();

    // Crosshair hover listener to update live readings
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        // Reset to latest bar values
        const { closes, s10, s20, s50 } = smaCalculations;
        const len = closes.length;
        if (len > 0) {
          setActiveSMA({
            sma10: s10[len - 1],
            sma20: s20[len - 1],
            sma50: s50[len - 1],
            close: closes[len - 1],
          });
        }
        return;
      }

      const idx = sortedBars.findIndex((b) => barTimeToUtc(b) === param.time);
      if (idx >= 0) {
        setActiveSMA({
          sma10: smaCalculations.s10[idx],
          sma20: smaCalculations.s20[idx],
          sma50: smaCalculations.s50[idx],
          close: sortedBars[idx].close,
        });
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.resize(containerRef.current.clientWidth, height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [sortedBars, smaCalculations, height, entryPrice, stopLoss, primaryTarget]);

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 items-start w-full"
      data-testid="tradingview-chart-container"
    >
      {/* LEFT COLUMN: Clean Chart Card */}
      <div className="flex flex-col bg-[#0F172A] border border-slate-800 rounded-lg overflow-hidden shadow-xl min-w-0">
        {/* Clean Header: Ticker, Live Price, Timeframe */}
        <div
          className="flex items-center justify-between px-4 py-3 bg-[#0F172A] border-b border-slate-800"
          data-testid="tradingview-chart-header"
        >
          <div className="flex items-center gap-3">
            <span
              className="text-xl font-black tracking-tight text-white uppercase"
              data-testid="chart-ticker-symbol"
            >
              {ticker}
            </span>
            {currentLivePrice > 0 && (
              <span
                className="text-lg font-mono font-bold text-white tracking-tight tabular-nums"
                data-testid="chart-live-price"
              >
                ${currentLivePrice.toFixed(2)}
              </span>
            )}
            {regime && (
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {regime}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {onTimeframeChange && (
              <div
                className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5"
                data-testid="chart-timeframe-selector"
              >
                {(["1H", "4H", "1D"] as const).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => onTimeframeChange(tf as Timeframe)}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                      timeframe === tf
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tf === "1D" ? "Daily" : tf}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Optional MTF context strip if passed by parent */}
        {mtfStrip && (
          <div className="border-b border-slate-800/80 px-3 py-2 bg-slate-900/40">
            {mtfStrip}
          </div>
        )}

        {/* Warning Banner (if any) */}
        {barsWarning && shouldRenderWarning && (
          <div
            className={`px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs font-mono flex items-center justify-between transition-opacity duration-1000 ${
              isWarningVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <span>⚠️ {barsWarning}</span>
          </div>
        )}

        {/* Locked 3-SMA Legend */}
        <div
          className="flex items-center gap-4 px-4 py-2 bg-slate-900/70 border-b border-slate-800/80 text-xs font-mono"
          data-testid="chart-sma-legend"
        >
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
            <span className="text-slate-400 font-bold">10-SMA:</span>
            <span className="text-amber-400 font-semibold tabular-nums">
              {activeSMA.sma10 != null ? `$${activeSMA.sma10.toFixed(2)}` : "—"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#06B6D4]" />
            <span className="text-slate-400 font-bold">20-SMA:</span>
            <span className="text-cyan-400 font-semibold tabular-nums">
              {activeSMA.sma20 != null ? `$${activeSMA.sma20.toFixed(2)}` : "—"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#A855F7]" />
            <span className="text-slate-400 font-bold">50-SMA:</span>
            <span className="text-purple-400 font-semibold tabular-nums">
              {activeSMA.sma50 != null ? `$${activeSMA.sma50.toFixed(2)}` : "—"}
            </span>
          </div>

          {activeSMA.close != null && (
            <div className="ml-auto hidden sm:flex items-center gap-1.5 text-slate-400">
              <span>Close:</span>
              <span className="text-white font-bold tabular-nums">
                ${activeSMA.close.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Lightweight Charts Canvas Viewport */}
        <div
          ref={containerRef}
          className="relative w-full bg-[#060913]"
          style={{ height: `${height}px` }}
          data-testid="lightweight-chart-viewport"
        >
          {isLoading && (
            <div className="absolute inset-0 bg-[#060913]/80 backdrop-blur-sm flex items-center justify-center z-10">
              <span className="text-sm font-bold text-cyan-400 animate-pulse font-mono">
                Loading Chart Data...
              </span>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: AI Candle Coach & In-Chart Trade Card */}
      <div className="w-full" data-testid="chart-ai-coach-column">
        <AICoachPanel
          ticker={ticker}
          bars={sortedBars}
          timeframe={timeframe}
          livePrice={currentLivePrice}
          entryPrice={entryPrice}
          stopLoss={stopLoss}
          primaryTarget={primaryTarget}
        />
      </div>
    </div>
  );
}
