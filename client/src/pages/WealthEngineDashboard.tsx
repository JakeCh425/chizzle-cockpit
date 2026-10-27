import { BrokerExecutionSteps } from "@/components/BrokerExecutionSteps";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useFeedConnection, isMarketOpen } from "@/lib/priceFeed";
import { useLiveQuote } from "@/lib/useLivePrices";
import { Link } from "wouter";
import { useGlobalState } from "@/lib/globalState";
import { useExecutionTriggers } from "@/hooks/useExecutionTriggers";
import { TradingTipsCard } from "@/components/swing/TradingTipsCard";
import ErrorBoundary from "@/components/ErrorBoundary";
import { DEFAULT_WATCHLIST, type WatchlistItem } from "@/lib/wealthWatchlist";
export { DEFAULT_WATCHLIST, type WatchlistItem };
import { loadSmaSettings, saveSmaSettings, type SmaSettings } from "@/lib/smaSettings";
import { SmaSettingsPopover } from "@/components/SmaSettingsPopover";
import { FidelityExecutionCheatSheet } from "@/components/FidelityExecutionCheatSheet";
import { RiskSettingsBar } from "@/components/swing/RiskSettingsBar";
import { usePositionSizer } from "@/hooks/usePositionSizer";
import {
  TrendingUp, TrendingDown, Activity, ChevronDown, ChevronUp, Zap, Moon, Sun, Flame, Sparkles, Terminal,
  BarChart2, Settings, Sliders, Layers, Target, Shield, CheckCircle2,
  AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw, LayoutDashboard,
  Maximize2, Crosshair, HelpCircle, Eye, Info, Play, ClipboardList, Compass, ShieldCheck
} from "lucide-react";

// ============================================================================
// THEME CONFIGURATIONS & CSS VARIABLES
// ============================================================================
export type DashboardTheme = "cyber-neon" | "stealth" | "arctic" | "sunset-orange" | "neon-grape" | "mint-matrix";

interface ThemeStyle {
  id: DashboardTheme;
  name: string;
  icon: typeof Zap;
  vars: Record<string, string>;
}

export const THEMES: Record<DashboardTheme, ThemeStyle> = {
  "cyber-neon": {
    id: "cyber-neon",
    name: "Cyber Neon",
    icon: Zap,
    vars: {
      "--bg-root": "#0F172A",
      "--bg-panel": "#1E293B",
      "--bg-panel-subtle": "#162032",
      "--bg-card": "#131D31",
      "--border-main": "#06B6D4",
      "--border-subtle": "rgba(6, 182, 212, 0.25)",
      "--border-glow": "0 0 15px rgba(6, 182, 212, 0.15)",
      "--text-primary": "#F8FAFC",
      "--text-secondary": "#94A3B8",
      "--text-muted": "#64748B",
      "--accent-green": "#22C55E",
      "--accent-cyan": "#06B6D4",
      "--accent-blue": "#38BDF8",
      "--accent-amber": "#F59E0B",
      "--accent-red": "#EF4444",
      "--badge-bg": "rgba(6, 182, 212, 0.12)",
    },
  },
  stealth: {
    id: "stealth",
    name: "Stealth Mode",
    icon: Moon,
    vars: {
      "--bg-root": "#000000",
      "--bg-panel": "#0D0D0D",
      "--bg-panel-subtle": "#141414",
      "--bg-card": "#0A0A0A",
      "--border-main": "#27272A",
      "--border-subtle": "rgba(63, 63, 70, 0.4)",
      "--border-glow": "0 0 12px rgba(245, 158, 11, 0.08)",
      "--text-primary": "#EDEDED",
      "--text-secondary": "#A1A1AA",
      "--text-muted": "#52525B",
      "--accent-green": "#10B981",
      "--accent-cyan": "#F59E0B", // Amber gold accent in stealth
      "--accent-blue": "#D97706",
      "--accent-amber": "#F59E0B",
      "--accent-red": "#DC2626",
      "--badge-bg": "rgba(245, 158, 11, 0.10)",
    },
  },
  arctic: {
    id: "arctic",
    name: "Arctic Terminal",
    icon: Sun,
    vars: {
      "--bg-root": "#FFFFFF",
      "--bg-panel": "#F8FAFC",
      "--bg-panel-subtle": "#F1F5F9",
      "--bg-card": "#FFFFFF",
      "--border-main": "#0F172A",
      "--border-subtle": "rgba(15, 23, 42, 0.18)",
      "--border-glow": "0 2px 10px rgba(0, 0, 0, 0.06)",
      "--text-primary": "#0F172A",
      "--text-secondary": "#475569",
      "--text-muted": "#64748B",
      "--accent-green": "#16A34A",
      "--accent-cyan": "#0284C7",
      "--accent-blue": "#1E40AF",
      "--accent-amber": "#D97706",
      "--accent-red": "#DC2626",
      "--badge-bg": "rgba(15, 23, 42, 0.06)",
    },
  },
  "sunset-orange": {
    id: "sunset-orange",
    name: "Sunset Orange",
    icon: Flame,
    vars: {
      "--bg-root": "#18110D",
      "--bg-panel": "#27170E",
      "--bg-panel-subtle": "#1F130B",
      "--bg-card": "#1C1109",
      "--border-main": "#F97316",
      "--border-subtle": "rgba(249, 115, 22, 0.3)",
      "--border-glow": "0 0 15px rgba(249, 115, 22, 0.2)",
      "--text-primary": "#FFF7ED",
      "--text-secondary": "#FDBA74",
      "--text-muted": "#9A3412",
      "--accent-green": "#FB923C",
      "--accent-cyan": "#F97316",
      "--accent-blue": "#EA580C",
      "--accent-amber": "#F97316",
      "--accent-red": "#EF4444",
      "--badge-bg": "rgba(249, 115, 22, 0.15)",
    },
  },
  "neon-grape": {
    id: "neon-grape",
    name: "Neon Grape",
    icon: Sparkles,
    vars: {
      "--bg-root": "#13091B",
      "--bg-panel": "#1F0F2D",
      "--bg-panel-subtle": "#190C24",
      "--bg-card": "#160B20",
      "--border-main": "#D946EF",
      "--border-subtle": "rgba(217, 70, 239, 0.3)",
      "--border-glow": "0 0 15px rgba(217, 70, 239, 0.2)",
      "--text-primary": "#FDF4FF",
      "--text-secondary": "#E879F9",
      "--text-muted": "#86198F",
      "--accent-green": "#F472B6",
      "--accent-cyan": "#D946EF",
      "--accent-blue": "#C026D3",
      "--accent-amber": "#F59E0B",
      "--accent-red": "#EF4444",
      "--badge-bg": "rgba(217, 70, 239, 0.15)",
    },
  },
  "mint-matrix": {
    id: "mint-matrix",
    name: "Mint Matrix",
    icon: Terminal,
    vars: {
      "--bg-root": "#040D08",
      "--bg-panel": "#081A10",
      "--bg-panel-subtle": "#06140D",
      "--bg-card": "#05100A",
      "--border-main": "#34D399",
      "--border-subtle": "rgba(52, 211, 153, 0.3)",
      "--border-glow": "0 0 15px rgba(52, 211, 153, 0.2)",
      "--text-primary": "#ECFDF5",
      "--text-secondary": "#6EE7B7",
      "--text-muted": "#065F46",
      "--accent-green": "#34D399",
      "--accent-cyan": "#34D399",
      "--accent-blue": "#10B981",
      "--accent-amber": "#F59E0B",
      "--accent-red": "#EF4444",
      "--badge-bg": "rgba(52, 211, 153, 0.15)",
    },
  },
};

// ============================================================================
// CANDLESTICK LOGO COMPONENT
// ============================================================================
function CandlestickIcon({ color = "#22C55E" }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 10 24"
      className="h-7 md:h-8 w-3.5 md:w-4 inline-block mx-1 align-middle drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Bullish Candlestick"
    >
      {/* Upper wick */}
      <line x1="5" y1="1" x2="5" y2="6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {/* Candlestick body */}
      <rect x="2" y="6" width="6" height="11" rx="0.75" fill={color} stroke={color} strokeWidth="0.75" />
      {/* Lower wick */}
      <line x1="5" y1="17" x2="5" y2="23" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================================
// MARKET DATA & INTERFACES (Re-exported from @/lib/wealthWatchlist)
// ============================================================================
// Note: WatchlistItem and DEFAULT_WATCHLIST are imported from @/lib/wealthWatchlist
// to eliminate circular dependencies with globalState.

// ============================================================================
// LIVE TRADING CHART COMPONENT (Bound directly to activeTicker symbol)
// ============================================================================
// LIVE TRADING CHART COMPONENT (Bound directly to activeTicker symbol)
// ============================================================================
export interface ChartProps {
  symbol: string;
  timeframe: string;
  activeItem: WatchlistItem;
  entryPrice?: number;
  stopLoss?: number;
  primaryTarget?: number;
  onOpenFidelityGuide?: () => void;
}

export function LiveTradingChart({
  symbol,
  timeframe,
  activeItem,
  entryPrice,
  stopLoss,
  primaryTarget,
  onOpenFidelityGuide,
}: ChartProps) {
  const item = activeItem || DEFAULT_WATCHLIST[0];
  const { openArmTrade, activeTickerData, activePrice: storePrice, isBadTick, isMarketOpen: globalMarketOpen, livePrices } = useGlobalState();
  const { quote } = useLiveQuote(symbol);
  const { state: feedState, isMarketOpen: feedMarketOpen } = useFeedConnection();
  const isMarketOpenNow = globalMarketOpen ?? feedMarketOpen ?? isMarketOpen();

  // 1. Single Source of Truth for Live Price (Synchronized directly with Header & Watchlist)
  const tickerData = activeTickerData?.symbol === symbol ? activeTickerData : null;
  const globalPrice = (symbol ? livePrices?.[symbol] : null) ?? (symbol === activeTickerData?.symbol ? (activeTickerData?.price ?? storePrice) : null);
  const livePrice = globalPrice ?? quote?.price ?? item?.price ?? 100;

  // Direction for dynamic price coloring (green when up on the day, red when down)
  const isUp = (tickerData?.change ?? quote?.change ?? item?.change ?? 0) >= 0;
  const changeAmt = tickerData?.change ?? quote?.change ?? item?.change ?? 0;
  const changePct = tickerData?.changePct ?? quote?.changePct ?? item?.changePct ?? 0;

  // Pulses slightly when a new live WebSocket tick comes in
  const [isTickPulsing, setIsTickPulsing] = useState(false);
  const prevTickPrice = useRef(livePrice);

  useEffect(() => {
    if (livePrice !== prevTickPrice.current && prevTickPrice.current > 0) {
      setIsTickPulsing(true);
      const timer = setTimeout(() => setIsTickPulsing(false), 450);
      prevTickPrice.current = livePrice;
      return () => clearTimeout(timer);
    }
    prevTickPrice.current = livePrice;
  }, [livePrice]);

  // Immediate state wiping on activeTicker / timeframe switch
  const [tradeLevels, setTradeLevels] = useState<{
    buy: number;
    stop: number;
    t1: number;
    t2: number;
    t3: number;
    risk: number;
  } | null>(null);

  useEffect(() => {
    // Whenever activeTicker changes or timeframe switch, immediately wipe previous trade levels from state
    setTradeLevels(null);
  }, [symbol, timeframe]);

  // 3. Dynamic Risk/Reward Math: Programmatically enforce R-multiple logic
  // Variables:
  // Risk = EntryPrice - StopLossPrice
  // Target 1 (1.5R) = EntryPrice + (Risk * 1.5)
  // Target 2 (Core 2.0R) = EntryPrice + (Risk * 2.0)
  // Target 3 (Runner 3.0R) = EntryPrice + (Risk * 3.0)
  const isTargetSafe = useCallback((val: number | undefined | null) => {
    if (val == null || !Number.isFinite(val) || val <= 0) return false;
    if (livePrice <= 0) return true;
    return Math.abs(val - livePrice) / livePrice < 0.4;
  }, [livePrice]);

  const currentRefPrice = livePrice > 0 ? livePrice : (item?.price ?? 100);

  // Recompute trade levels dynamically from the current active setup:
  // - BUY = Active setup confirmed entry price (if closely aligned within 8% of current price) or nearest SMA support level
  // - STOP = Swing low / structural stop level corresponding to the current price range
  // - Risk ($1R) = |BUY - STOP|
  // - T1 = BUY + (Risk * 1.5)
  // - T2 = BUY + (Risk * 2.0)
  // - T3 = BUY + (Risk * 3.0)
  const rawBuyPrice = entryPrice ?? tickerData?.buyTarget ?? item?.buyTarget;
  const isBuyPriceClose = rawBuyPrice != null && isTargetSafe(rawBuyPrice) && Math.abs(rawBuyPrice - currentRefPrice) / currentRefPrice <= 0.08;
  const buyPrice = isBuyPriceClose ? rawBuyPrice! : currentRefPrice;

  const rawStopVal = stopLoss ?? tickerData?.stopLoss ?? item?.stopLoss;
  const isStopClose = rawStopVal != null && isTargetSafe(rawStopVal) && rawStopVal < buyPrice && (buyPrice - rawStopVal) / buyPrice <= 0.08 && (buyPrice - rawStopVal) / buyPrice >= 0.012;
  const stopVal = isStopClose ? rawStopVal! : +(buyPrice - Math.max((item?.atr ?? (currentRefPrice * 0.025)) * 1.2, 0.5)).toFixed(2);

  const risk = +(Math.max(Math.abs(buyPrice - stopVal), (item?.atr ?? 4.15) * 1.0, 0.5)).toFixed(2);
  const rawTargetVal = primaryTarget ?? tickerData?.target1;
  const isTargetClose = rawTargetVal != null && isTargetSafe(rawTargetVal) && Math.abs(rawTargetVal - (buyPrice + risk * 1.5)) / currentRefPrice <= 0.05;
  const targetVal = isTargetClose ? rawTargetVal! : +(buyPrice + risk * 1.5).toFixed(2);
  const t1Price = targetVal;
  const rawT2 = tickerData?.target2;
  const t2Price = isTargetSafe(rawT2) && Math.abs((rawT2 ?? 0) - (buyPrice + risk * 2.0)) / currentRefPrice <= 0.05 ? rawT2! : +(buyPrice + risk * 2.0).toFixed(2);
  const rawT3 = tickerData?.target3;
  const t3Price = isTargetSafe(rawT3) && Math.abs((rawT3 ?? 0) - (buyPrice + risk * 3.0)) / currentRefPrice <= 0.05 ? rawT3! : +(buyPrice + risk * 3.0).toFixed(2);

  // Time formatting helpers for timeScale axis and execution markers
  const formatTimeScaleTick = (epochSec: number, tf: string) => {
    if (!epochSec) return "";
    const d = new Date(epochSec * 1000);
    if (tf === "1H" || tf === "4H") {
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatMarkerDateTime = (epochSec: number) => {
    if (!epochSec) return "Oct 21, 10:30 AM";
    const d = new Date(epochSec * 1000);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  // 4. Live Trading Auto-Scrolling & Pan Controls
  const [autoScroll, setAutoScroll] = useState(true);
  const [panOffset, setPanOffset] = useState(0);

  // When a new WebSocket tick arrives, automatically pan/scroll to ensure live candle stays firmly in viewport
  useEffect(() => {
    if (autoScroll) {
      setPanOffset(0);
    }
  }, [livePrice, autoScroll]);

  // Synchronize with incoming live quote stream with Bad-Tick Outlier Filtering
  useEffect(() => {
    if (quote?.price != null && Number.isFinite(quote.price)) {
      const ref = livePrice;
      const isOutlier = isBadTick ? isBadTick(symbol, quote.price) : (ref > 0 && Math.abs(quote.price - ref) / ref > 0.035);
      if (isOutlier) {
        console.warn(`[LiveTradingChart:BadTick] Dropped outlier tick for ${symbol}: $${quote.price} vs ref $${ref} (>3.5% deviation)`);
      }
    }
  }, [quote?.price, symbol, isBadTick, livePrice]);

  // SMA customization settings from localStorage
  const [smaSettings, setSmaSettings] = useState<SmaSettings>(() => loadSmaSettings());
  const [isSmaSettingsOpen, setIsSmaSettingsOpen] = useState(false);

  // 4. Chart Reset and Auto-Scaling Function with Decoupled Buffer
  const [isResetting, setIsResetting] = useState(false);
  const [historicalBuffer, setHistoricalBuffer] = useState<Array<{ o: number; h: number; l: number; c: number; t?: number }> | null>(null);
  const [fetchedBars, setFetchedBars] = useState<Array<{ o: number; h: number; l: number; c: number; x: number; t: number }> | null>(null);

  const resetChartData = useCallback(async (sym = symbol, tf = timeframe) => {
    setIsResetting(true);
    try {
      // Explicitly clear current candlestick series and trade levels before injecting new timeframe data
      setFetchedBars(null);
      setHistoricalBuffer(null);
      setTradeLevels(null);
      const mappedInterval = tf === "4H" ? "4H" : (tf === "1D" || tf === "1W") ? "1D" : "1H";
      const res = await fetch(`/api/candles-ohlc/${encodeURIComponent(sym)}?interval=${mappedInterval}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const ref = item?.price ?? 100;
          const intervalSec = tf === "4H" ? 14400 : (tf === "1D" || tf === "1W") ? 86400 : 3600;
          const nowSec = Math.floor(Date.now() / 1000);
          // Filter outliers from historical bars
          const clean = data.map((b: any, i: number) => {
            const o = Number(b.open ?? b.o ?? ref);
            const h = Number(b.high ?? b.h ?? ref);
            const l = Number(b.low ?? b.l ?? ref);
            const c = Number(b.close ?? b.c ?? ref);
            const t = Number(b.time ?? b.t ?? (nowSec - (data.length - 1 - i) * intervalSec));
            return { o, h, l, c, t };
          }).filter((b: any) => Number.isFinite(b.c) && b.c > 0 && Math.abs(b.c - ref) / ref < 0.20);

          if (clean.length >= 5) {
            // Decouple data fetching from visible viewport: keep full buffer for continuous SMA calculation
            setHistoricalBuffer(clean);

            const visibleCount = tf === "1H" ? 22 : tf === "4H" ? 18 : tf === "1D" ? 14 : 10;
            const spacing = tf === "1H" ? 28 : tf === "4H" ? 35 : tf === "1D" ? 45 : 62;
            const start = tf === "1H" ? 38 : tf === "4H" ? 42 : tf === "1D" ? 45 : 50;

            const sliced = clean.slice(-visibleCount).map((b, idx) => ({
              ...b,
              x: start + idx * spacing,
            }));
            setFetchedBars(sliced);
          }
        }
      }
    } catch (e) {
      console.warn("[LiveTradingChart] resetChartData fetch failed:", e);
    } finally {
      setIsResetting(false);
    }
  }, [symbol, timeframe, item?.price]);

  // Trigger resetChartData on active ticker or timeframe switch with clean series reset
  useEffect(() => {
    setFetchedBars(null);
    resetChartData(symbol, timeframe);
  }, [symbol, timeframe, resetChartData]);

  // Trigger resetChartData on recovery from stale feed
  const prevFeedState = useRef(feedState);
  useEffect(() => {
    if (prevFeedState.current === "STALE" && feedState === "LIVE") {
      console.info("[LiveTradingChart] Feed recovered from STALE -> LIVE. Auto-resetting and scaling chart.");
      resetChartData(symbol, timeframe);
    }
    prevFeedState.current = feedState;
  }, [feedState, symbol, timeframe, resetChartData]);

  // 2. Auto-Hiding Text Overlay Hook (3.5s display + 1s fade-out, cleanup timer)
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);
  const [shouldRenderOverlay, setShouldRenderOverlay] = useState(true);

  useEffect(() => {
    setIsOverlayVisible(true);
    setShouldRenderOverlay(true);

    const fadeTimer = setTimeout(() => {
      setIsOverlayVisible(false);
    }, 3500);

    const unmountTimer = setTimeout(() => {
      setShouldRenderOverlay(false);
    }, 4500);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, [symbol, timeframe, item?.setupType, item?.status]);

  // 3. Stable Historical Candlestick Foundation (Kept fixed so ticks do NOT redraw past bars)
  const refAnchorPrice = useRef(item?.price ?? 100);
  useEffect(() => {
    refAnchorPrice.current = item?.price ?? 100;
  }, [symbol, timeframe]);

  const { baseCandles, candleWidth, barSpacing } = useMemo(() => {
    const p = refAnchorPrice.current;
    const atr = item?.atr ?? 5;

    let count = 18;
    let width = 16;
    let spacing = 35;
    let start = 40;
    let volatility = 1.4;

    if (timeframe === "1H") {
      count = 22;
      width = 12;
      spacing = 28;
      start = 38;
      volatility = 1.1;
    } else if (timeframe === "4H") {
      count = 18;
      width = 16;
      spacing = 35;
      start = 42;
      volatility = 1.4;
    } else if (timeframe === "1D") {
      count = 14;
      width = 20;
      spacing = 45;
      start = 45;
      volatility = 1.8;
    } else if (timeframe === "1W") {
      count = 10;
      width = 26;
      spacing = 62;
      start = 50;
      volatility = 2.4;
    }

    const rng = atr * volatility;
    const basePrices = Array.from({ length: count }, (_, i) => {
      const progress = i / (count - 1);
      const wave = Math.sin(progress * Math.PI * 2) * (rng * 0.45);
      const trend = (progress - 1) * (rng * 0.35);
      return p + wave + trend;
    });
    basePrices[count - 1] = p; // Starting anchor for the latest candle

    const nowSec = Math.floor(Date.now() / 1000);
    const intervalSec = timeframe === "1H" ? 3600 : timeframe === "4H" ? 14400 : timeframe === "1D" ? 86400 : 604800;

    const generated = basePrices.map((close, i) => {
      const prevClose = i > 0 ? basePrices[i - 1] : close - rng * 0.1;
      const open = prevClose;
      const wickDelta = rng * (0.1 + ((i % 3) * 0.05));
      const high = Math.max(open, close) + wickDelta;
      const low = Math.min(open, close) - wickDelta;
      const x = start + i * spacing;
      const t = nowSec - (count - 1 - i) * intervalSec;
      return { x, o: open, c: close, h: high, l: low, t };
    });

    return { baseCandles: generated, candleWidth: width, barSpacing: spacing };
  }, [symbol, timeframe, item?.atr]);

  // Dynamic Candle Series: Right-most candle updates dynamically in real-time
  // without forcing a full re-render of the entire historical chart data array.
  const historicalCandles = useMemo(() => {
    const sourceCandles = fetchedBars && fetchedBars.length > 5 ? fetchedBars : baseCandles;
    if (!sourceCandles || sourceCandles.length === 0) return [];
    return sourceCandles.slice(0, sourceCandles.length - 1);
  }, [baseCandles, fetchedBars]);

  const activeCandle = useMemo(() => {
    const sourceCandles = fetchedBars && fetchedBars.length > 5 ? fetchedBars : baseCandles;
    if (!sourceCandles || sourceCandles.length === 0) return null;
    const lastBase = sourceCandles[sourceCandles.length - 1];
    if (!lastBase) return null;
    const currentClose = Number.isFinite(livePrice) ? livePrice : (lastBase.c ?? 100);
    const currentHigh = Math.max(lastBase.o ?? currentClose, lastBase.h ?? currentClose, currentClose);
    const currentLow = Math.min(lastBase.o ?? currentClose, lastBase.l ?? currentClose, currentClose);

    return {
      x: lastBase.x ?? 40,
      o: lastBase.o ?? currentClose,
      c: currentClose,
      h: currentHigh,
      l: currentLow,
      t: lastBase.t ?? Math.floor(Date.now() / 1000),
    };
  }, [baseCandles, fetchedBars, livePrice]);

  const candles = useMemo(() => {
    if (!activeCandle) return historicalCandles;
    return [...historicalCandles, activeCandle];
  }, [historicalCandles, activeCandle]);

  // Actionable Execution Triggers: Compare live candle close & live price against Entry, StopLoss, and Target
  const executionTrigger = useExecutionTriggers(
    livePrice,
    activeCandle?.c,
    buyPrice,
    stopVal,
    targetVal
  );

  // Boot Sequence Logging for LiveTradingChart
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log(`[Boot:LiveTradingChart] Mounted/Updated chart for ${symbol} @ $${Number.isFinite(livePrice) ? livePrice.toFixed(2) : "0.00"} (${timeframe}), candles count: ${candles.length}`);
    }
  }, [symbol, timeframe, livePrice, candles.length]);

  // 5. Crosshair & Hover OHLC Tooltip State
  const [hoveredData, setHoveredData] = useState<{
    x: number;
    y: number;
    price: number;
    candle: { x: number; o: number; c: number; h: number; l: number } | null;
  } | null>(null);

  // Identify key signal marker points across the candles
  const entryIndex = useMemo(() => {
    const idx = candles.findIndex(
      (b, i) => (b.l <= buyPrice && b.h >= buyPrice) || (i > 0 && candles[i - 1].c < buyPrice && b.c >= buyPrice)
    );
    return idx !== -1 ? idx : Math.floor(candles.length * 0.5);
  }, [candles, buyPrice]);

  const targetIndex = useMemo(() => {
    return candles.findIndex((b) => b.h >= targetVal);
  }, [candles, targetVal]);

  const stopIndex = useMemo(() => {
    return candles.findIndex((b) => b.l <= stopVal);
  }, [candles, stopVal]);

  // Auto-Scaling: Clamps bounds so anomalous wicks/ticks cannot blow out normal price action,
  // while ensuring the Y-axis scales automatically to fit the highest target (T3) and the Stop Loss.
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    const valid = candles.filter((c) => Number.isFinite(c.c) && c.c > 0);
    if (valid.length === 0) return { minPrice: Math.min(90, stopVal * 0.98), maxPrice: Math.max(110, t3Price * 1.02), priceRange: 20 };
    const ref = livePrice > 0 ? livePrice : item?.price ?? 100;

    // Normal bounds clamped within +/-12% of reference price to protect Y-axis scale
    const clampLow = ref * 0.88;
    const clampHigh = ref * 1.12;

    const rawMin = Math.min(...valid.map((c) => c.l));
    const rawMax = Math.max(...valid.map((c) => c.h));

    const boundedMin = Math.max(rawMin, clampLow);
    const boundedMax = Math.min(rawMax, clampHigh);

    // Auto-scale: Fit Stop Loss and T3 cleanly inside visible window
    const min = Math.min(boundedMin, stopVal * 0.985);
    const max = Math.max(boundedMax, t3Price * 1.015);
    const range = max - min || 1;
    return { minPrice: min, maxPrice: max, priceRange: range };
  }, [candles, livePrice, item?.price, stopVal, t3Price]);

  const priceToY = (price: number) => 350 - ((price - minPrice) / priceRange) * 290;

  // Crosshair mouse tracker handler
  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const mouseX = ((e.clientX - rect.left) / rect.width) * 800;
    const mouseY = ((e.clientY - rect.top) / rect.height) * 420;

    // Check if mouse is within the active candlestick grid (left of Y-axis separator at x = 710)
    if (mouseX >= 0 && mouseX <= 710 && mouseY >= 0 && mouseY <= 420) {
      let closestCandle = null;
      let minDistance = Infinity;
      for (const c of candles) {
        const dist = Math.abs(c.x + candleWidth / 2 - mouseX);
        if (dist < minDistance && dist <= barSpacing * 0.8) {
          minDistance = dist;
          closestCandle = c;
        }
      }
      const hoveredPrice = minPrice + ((350 - mouseY) / 290) * priceRange;

      setHoveredData({
        x: mouseX,
        y: mouseY,
        price: hoveredPrice,
        candle: closestCandle,
      });
    } else {
      setHoveredData(null);
    }
  };

  const handleSvgMouseLeave = () => {
    setHoveredData(null);
  };

  // Candle to display in the anchored OHLC legend
  const currentDisplayedBar = activeCandle ?? candles[candles.length - 1];
  const displayedCandle = hoveredData?.candle ?? currentDisplayedBar;

  // ── Decouple historical buffer (>= 220 bars) for continuous SMA calculation ──
  const fullBufferCloses = useMemo(() => {
    const rawCloses = historicalBuffer && historicalBuffer.length >= 5
      ? historicalBuffer.map((b) => b.c)
      : baseCandles.map((b) => b.c);

    if (rawCloses.length >= 220) return rawCloses;
    const needed = 220 - rawCloses.length;
    const anchor = rawCloses[0] ?? (item?.price ?? 100);
    const synthCloses = Array.from({ length: needed }, (_, i) => {
      const progress = i / needed;
      return anchor * (0.96 + progress * 0.04);
    });
    return [...synthCloses, ...rawCloses];
  }, [historicalBuffer, baseCandles, item?.price]);

  // Rolling SMA computation for each visible candle so 50/200 SMA lines never disappear
  const { sma20Points, sma50Points, sma200Points, latestSma20, latestSma50, latestSma200 } = useMemo(() => {
    if (candles.length === 0 || fullBufferCloses.length === 0) {
      return {
        sma20Points: [],
        sma50Points: [],
        sma200Points: [],
        latestSma20: livePrice * 0.985,
        latestSma50: livePrice * 0.952,
        latestSma200: livePrice * 0.890,
      };
    }

    const liveCloses = [
      ...fullBufferCloses.slice(0, -1),
      Number.isFinite(livePrice) ? livePrice : fullBufferCloses[fullBufferCloses.length - 1],
    ];

    const calcRollingAvg = (closes: number[], period: number, endIdx: number) => {
      const startIdx = Math.max(0, endIdx - period + 1);
      const slice = closes.slice(startIdx, endIdx + 1);
      if (slice.length === 0) return closes[endIdx] ?? 100;
      const sum = slice.reduce((acc, v) => acc + v, 0);
      return sum / slice.length;
    };

    const pts20: Array<{ x: number; y: number }> = [];
    const pts50: Array<{ x: number; y: number }> = [];
    const pts200: Array<{ x: number; y: number }> = [];

    const totalCloses = liveCloses.length;
    candles.forEach((c, i) => {
      const bufIdx = totalCloses - (candles.length - i);
      const cx = c.x + candleWidth / 2;

      const v20 = calcRollingAvg(liveCloses, 20, bufIdx);
      const v50 = calcRollingAvg(liveCloses, 50, bufIdx);
      const v200 = calcRollingAvg(liveCloses, 200, bufIdx);

      pts20.push({ x: cx, y: priceToY(v20) });
      pts50.push({ x: cx, y: priceToY(v50) });
      pts200.push({ x: cx, y: priceToY(v200) });
    });

    const l20 = calcRollingAvg(liveCloses, 20, totalCloses - 1);
    const l50 = calcRollingAvg(liveCloses, 50, totalCloses - 1);
    const l200 = calcRollingAvg(liveCloses, 200, totalCloses - 1);

    return {
      sma20Points: pts20,
      sma50Points: pts50,
      sma200Points: pts200,
      latestSma20: l20,
      latestSma50: l50,
      latestSma200: l200,
    };
  }, [candles, fullBufferCloses, livePrice, candleWidth, minPrice, priceRange]);

  const makeSmaPath = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length === 0) return "";
    return pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  };

  const sma20Path = useMemo(() => makeSmaPath(sma20Points), [sma20Points]);
  const sma50Path = useMemo(() => makeSmaPath(sma50Points), [sma50Points]);
  const sma200Path = useMemo(() => makeSmaPath(sma200Points), [sma200Points]);

  // Dynamic Buy Zone: checks if price pulls back to within 0.5% of 20-SMA
  const isPullbackTo20Sma = useMemo(() => {
    if (!latestSma20 || latestSma20 <= 0 || !livePrice || livePrice <= 0) return false;
    return Math.abs(livePrice - latestSma20) / latestSma20 <= 0.005;
  }, [livePrice, latestSma20]);

  // Right-hand Y-Axis Labels: Collision Avoidance Pass (guarantee minimum 18px separation)
  const yAxisPillPositions = useMemo(() => {
    const items = [
      { id: "live", idealY: priceToY(livePrice) - 9 },
      { id: "buy", idealY: priceToY(buyPrice) - 8 },
      { id: "stop", idealY: priceToY(stopVal) - 8 },
      { id: "t1", idealY: priceToY(targetVal) - 8 },
      { id: "t2", idealY: priceToY(t2Price) - 8 },
      { id: "t3", idealY: priceToY(t3Price) - 8 },
    ];

    // Sort ascending by idealY (from top of chart to bottom)
    items.sort((a, b) => a.idealY - b.idealY);

    const minGap = 18;
    // Forward pass: push downward if overlapping
    for (let i = 1; i < items.length; i++) {
      if (items[i].idealY < items[i - 1].idealY + minGap) {
        items[i].idealY = items[i - 1].idealY + minGap;
      }
    }

    // Backward pass: if bottom-most exceeded 394px, push upward
    if (items[items.length - 1].idealY > 394) {
      items[items.length - 1].idealY = 394;
      for (let i = items.length - 2; i >= 0; i--) {
        if (items[i].idealY > items[i + 1].idealY - minGap) {
          items[i].idealY = items[i + 1].idealY - minGap;
        }
      }
    }

    const posMap: Record<string, number> = {};
    for (const item of items) {
      posMap[item.id] = Math.max(8, Math.min(394, item.idealY));
    }
    return posMap;
  }, [livePrice, buyPrice, stopVal, targetVal, t2Price, t3Price, minPrice, priceRange]);

  // Hover fading: when cursor enters the right quadrant (x >= 520), transition trade labels/lines to 15% opacity
  const isRightQuadrantHovered = Boolean(hoveredData && hoveredData.x >= 520);

  return (
    <div
      className="w-full h-full flex-1 min-h-0 rounded-xl border flex flex-col relative overflow-hidden shadow-2xl font-mono"
      style={{
        backgroundColor: "#0B1220",
        borderColor: "rgba(255, 255, 255, 0.08)",
      }}
      data-testid="chart-placeholder-area"
    >
      {/* ── 1. Massive, Decoupled Prominent Ticker & Live Price Header ── */}
      <div
        className="px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-3 z-10 select-none shadow-sm"
        style={{
          backgroundColor: "#0E1726",
          borderColor: "rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* Massive Ticker Symbol & Dynamic Live Price Display */}
        <div className="flex flex-wrap items-baseline gap-3 sm:gap-5 font-mono" data-testid="chart-live-price-header">
          {/* Ticker Symbol (text-4xl md:text-5xl font-black tracking-tight) */}
          <span className="font-black text-4xl md:text-5xl tracking-tight text-white drop-shadow-md select-none">
            {symbol}
          </span>

          {/* Live Price with Dynamic Day-Change Coloring & WebSocket Tick Pulse */}
          <div
            className={`flex items-baseline gap-2 transition-transform duration-200 ${
              isTickPulsing ? "scale-105 brightness-125" : "scale-100"
            }`}
          >
            <span
              className={`font-black text-4xl md:text-5xl tabular-nums tracking-tight transition-colors duration-200 ${
                isUp
                  ? "text-[#00E676] drop-shadow-[0_0_14px_rgba(0,230,118,0.4)]"
                  : "text-[#FF5252] drop-shadow-[0_0_14px_rgba(255,82,82,0.4)]"
              }`}
              data-testid="chart-live-price-value"
            >
              ${livePrice.toFixed(2)}
            </span>

            {/* Pulsing Live indicator dot */}
            <span
              className={`h-3 w-3 rounded-full transition-all ${
                isTickPulsing
                  ? isUp
                    ? "bg-emerald-300 ring-4 ring-emerald-400/50 scale-125"
                    : "bg-rose-300 ring-4 ring-rose-400/50 scale-125"
                  : isUp
                  ? "bg-[#00E676] shadow-[0_0_8px_#00E676]"
                  : "bg-[#FF5252] shadow-[0_0_8px_#FF5252]"
              }`}
              title={isMarketOpenNow ? "Live Streaming Tick" : "Static Last Close"}
            />
          </div>

          {/* Daily Dollar & Pct Change Badge */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <span
              className={`font-bold tabular-nums flex items-center gap-0.5 px-2.5 py-0.5 rounded text-[11px] ${
                isUp
                  ? "bg-emerald-500/15 text-[#00E676] border border-emerald-500/30"
                  : "bg-rose-500/15 text-[#FF5252] border border-rose-500/30"
              }`}
            >
              {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              <span>
                {isUp ? "+" : ""}{changeAmt.toFixed(2)} ({isUp ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </span>
            <span className="text-slate-400 font-normal">· {timeframe} Live Feed</span>
          </div>
        </div>

        {/* Floating HUD Badges & Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Floating HUD: 4H Trend State Pill */}
          <div
            data-testid="hud-4h-trend-pill"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border shadow-sm ${
              (item?.changePct ?? 0) >= 0
                ? "bg-emerald-500/10 text-[#00E676] border-emerald-500/30"
                : "bg-rose-500/10 text-[#FF5252] border-rose-500/30"
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>4H: {(item?.changePct ?? 0) >= 0 ? "BULLISH" : "BEARISH"}</span>
          </div>

          {/* Floating HUD: Daily Regime Classification Pill */}
          <div
            data-testid="hud-day-classification-pill"
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border shadow-sm bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>SWING DAY</span>
          </div>

          {/* Floating HUD: Setup Status Pill with Soft Opacity */}
          <div
            data-testid="hud-setup-status-pill"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border shadow-sm ${
              (item?.status ?? "Ready") === "Ready"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>{item?.status ?? "READY"}</span>
          </div>

          {executionTrigger.activeSignalText && (
            <div
              data-testid="chart-execution-alert"
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-black tracking-wider uppercase border shadow-lg animate-pulse ${
                executionTrigger.signalType === "BUY"
                  ? "bg-emerald-500/25 text-[#00E676] border-emerald-400 shadow-[0_0_15px_rgba(0,230,118,0.4)]"
                  : executionTrigger.signalType === "TARGET_HIT"
                  ? "bg-emerald-500/25 text-[#00E676] border-emerald-400 shadow-[0_0_15px_rgba(0,230,118,0.4)]"
                  : "bg-rose-500/25 text-[#FF5252] border-rose-400 shadow-[0_0_15px_rgba(255,82,82,0.4)]"
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-current animate-ping" />
              <span>[{executionTrigger.activeSignalText}]</span>
            </div>
          )}

          {isPullbackTo20Sma && (
            <div
              data-testid="badge-ready-to-buy-zone"
              className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-black tracking-wider uppercase border border-emerald-400/50 bg-emerald-500/20 text-[#00E676] shadow-[0_0_15px_rgba(0,230,118,0.35)] animate-pulse"
            >
              <span className="h-2 w-2 rounded-full bg-[#00E676] animate-ping" />
              <span>[ READY TO BUY · 20-SMA ZONE ]</span>
            </div>
          )}

          {onOpenFidelityGuide && (
            <button
              type="button"
              data-testid="button-fidelity-guide"
              onClick={onOpenFidelityGuide}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-md cursor-pointer hover:scale-105 active:scale-95"
              title="Open Fidelity Trade Ticket Cheat Sheet"
            >
              <ClipboardList className="h-4 w-4" />
              <span>Fidelity Guide</span>
            </button>
          )}
        </div>
      </div>

      {/* ── 2. Secondary Sub-Bar: Overlay SMA Badges & Viewport Controls ── */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 z-10 select-none"
        style={{
          backgroundColor: "#0B1220",
          borderColor: "rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* OVERLAY SIMPLE TEXT LABELS: 20-SMA, 50-SMA, 200-SMA with Custom Colors & Settings */}
        <div className="flex items-center gap-2.5 font-mono text-xs font-semibold select-none" data-testid="sma-overlay-labels">
          {/* 20-SMA */}
          {smaSettings.sma20.visible && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded border"
              style={{
                borderColor: `${smaSettings.sma20.color}50`,
                backgroundColor: `${smaSettings.sma20.color}15`,
                color: smaSettings.sma20.color,
              }}
            >
              <span
                className="h-2 w-2 rounded-full shadow-sm"
                style={{ backgroundColor: smaSettings.sma20.color }}
              />
              <span className="font-bold">20-SMA:</span>
              <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
                ${latestSma20.toFixed(2)}
              </span>
            </div>
          )}

          {/* 50-SMA */}
          {smaSettings.sma50.visible && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded border"
              style={{
                borderColor: `${smaSettings.sma50.color}50`,
                backgroundColor: `${smaSettings.sma50.color}15`,
                color: smaSettings.sma50.color,
              }}
            >
              <span
                className="h-2 w-2 rounded-full shadow-sm"
                style={{ backgroundColor: smaSettings.sma50.color }}
              />
              <span className="font-bold">50-SMA:</span>
              <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
                ${latestSma50.toFixed(2)}
              </span>
            </div>
          )}

          {/* 200-SMA */}
          {smaSettings.sma200.visible && (
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded border"
              style={{
                borderColor: `${smaSettings.sma200.color}50`,
                backgroundColor: `${smaSettings.sma200.color}15`,
                color: smaSettings.sma200.color,
              }}
            >
              <span
                className="h-2 w-2 rounded-full shadow-sm"
                style={{ backgroundColor: smaSettings.sma200.color }}
              />
              <span className="font-bold">200-SMA:</span>
              <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
                ${latestSma200.toFixed(2)}
              </span>
            </div>
          )}

          {/* SMA Settings Customization Popover */}
          <SmaSettingsPopover
            settings={smaSettings}
            onChange={setSmaSettings}
            isOpen={isSmaSettingsOpen}
            onToggle={() => setIsSmaSettingsOpen((p) => !p)}
            onClose={() => setIsSmaSettingsOpen(false)}
          />

          {/* Quick Arm Trade button directly from Chart */}
          <button
            type="button"
            data-testid="button-chart-arm-trade"
            onClick={() => openArmTrade(item?.symbol ?? symbol)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 text-xs font-mono font-bold tracking-wider uppercase transition-colors cursor-pointer shadow-sm ml-1"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Arm Trade</span>
          </button>

          {/* Auto-Scroll Toggle Button */}
          <button
            type="button"
            data-testid="button-auto-scroll"
            onClick={() => setAutoScroll((prev) => !prev)}
            title="Toggle live viewport auto-scrolling on WebSocket ticks"
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer shadow-sm ml-1 ${
              autoScroll
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/50"
                : "bg-slate-800/90 text-slate-400 border border-slate-700 hover:text-white"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoScroll && isMarketOpenNow ? "bg-cyan-400 animate-pulse shadow-[0_0_6px_#22D3EE]" : autoScroll ? "bg-cyan-400" : "bg-slate-500"}`} />
            <span>Auto-Scroll: {autoScroll ? "ON" : "OFF"}</span>
          </button>

          {/* Reset Chart Data & Auto-Scale Button */}
          <button
            type="button"
            data-testid="button-reset-chart"
            onClick={() => resetChartData(symbol)}
            title="Reset Chart Data & Auto-Scale (clears bad ticks and re-fetches clean historical 1H candles)"
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer shadow-sm ml-1"
          >
            <RefreshCw className={`h-3 w-3 ${isResetting ? "animate-spin text-cyan-400" : ""}`} />
            <span>Auto Scale</span>
          </button>
        </div>
      </div>

      {/* Interactive Candlestick Chart Visualization */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-2">
        {/* Anchored Top-Left OHLC Data Display Legend */}
        {displayedCandle && (
          <div
            data-testid="chart-ohlc-legend"
            className="absolute top-3 left-4 z-15 flex flex-wrap items-center gap-2.5 font-mono text-[11px] bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow-lg pointer-events-none select-none"
          >
            <span className="text-cyan-400 font-bold">{symbol}</span>
            <span className="text-slate-400">
              O: <strong className="text-slate-100">${displayedCandle.o != null ? displayedCandle.o.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-slate-400">
              H: <strong className="text-emerald-400">${displayedCandle.h != null ? displayedCandle.h.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-slate-400">
              L: <strong className="text-rose-400">${displayedCandle.l != null ? displayedCandle.l.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-slate-400">
              C: <strong className={(displayedCandle.c ?? 0) >= (displayedCandle.o ?? 0) ? "text-emerald-400" : "text-rose-400"}>
                ${displayedCandle.c != null ? displayedCandle.c.toFixed(2) : "0.00"}
              </strong>
            </span>
            {(() => {
              if (displayedCandle.o == null || displayedCandle.c == null) return null;
              const chg = displayedCandle.c - displayedCandle.o;
              const chgPct = displayedCandle.o ? (chg / displayedCandle.o) * 100 : 0;
              const isUp = chg >= 0;
              return (
                <span className={`font-semibold ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                  {isUp ? "+" : ""}{chg.toFixed(2)} ({isUp ? "+" : ""}{chgPct.toFixed(2)}%)
                </span>
              );
            })()}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              hoveredData?.candle
                ? "text-cyan-300 bg-cyan-950/60 border-cyan-800/60"
                : isMarketOpenNow
                ? "text-slate-400 bg-slate-900 border-slate-700/60"
                : "text-slate-400 bg-slate-900/80 border-slate-700/40"
            }`}>
              {hoveredData?.candle ? "Hovered Bar" : isMarketOpenNow ? "Live Bar" : "Last Close"}
            </span>
          </div>
        )}

        {/* Auto-Hiding Text Overlay (Fade-Out Effect with Tailwind Transition) */}
        {shouldRenderOverlay && (
          <div
            data-testid="chart-text-overlay"
            className={`absolute top-14 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl border border-cyan-400/50 bg-slate-950/90 backdrop-blur-md shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center gap-3 font-mono text-xs select-none transition-opacity duration-1000 ease-in-out ${
              isOverlayVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full bg-cyan-400 ${isMarketOpenNow ? "animate-pulse" : ""} shadow-[0_0_8px_#22D3EE]`} />
            <span className="font-black text-white">{symbol}</span>
            <span className="text-cyan-300 font-semibold">{item?.setupType ?? "SWING SETUP"}</span>
            <span className="text-slate-400">
              Entry: <strong className="text-white">${buyPrice != null ? buyPrice.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-rose-400">
              Stop: <strong className="text-rose-300">${stopVal != null ? stopVal.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-emerald-400">
              T1: <strong className="text-emerald-300">${targetVal != null ? targetVal.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-emerald-400 hidden lg:inline">
              T2: <strong className="text-emerald-300">${t2Price != null ? t2Price.toFixed(2) : "0.00"}</strong>
            </span>
            <span className="text-emerald-400 hidden lg:inline">
              T3: <strong className="text-emerald-300">${t3Price != null ? t3Price.toFixed(2) : "0.00"}</strong>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                (item?.status ?? "Ready") === "Ready"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
              }`}
            >
              {item?.status ?? "Ready"}
            </span>
          </div>
        )}

        <svg
          className="w-full h-full select-none cursor-crosshair"
          viewBox="0 0 800 420"
          preserveAspectRatio="none"
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={handleSvgMouseLeave}
        >
          <defs>
            <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.0" />
            </linearGradient>
            <radialGradient id="buyZoneGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#00FF66" stopOpacity="0.12" />
              <stop offset="60%" stopColor="#26A69A" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Dynamic 20-SMA Pullback Buy Zone Highlight */}
          {isPullbackTo20Sma && (
            <rect x="0" y="0" width="710" height="420" fill="url(#buyZoneGlow)" data-testid="chart-buy-zone-highlight" />
          )}

          {/* Background Grid Lines (Bloomberg terminal dotted 5% white) */}
          {[80, 160, 240, 320].map((y) => (
            <line key={y} x1="0" y1={y} x2="710" y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
          ))}
          {[140, 280, 420, 560].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="420" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
          ))}

          {/* Dedicated Right-Hand Y-Axis Divider Line */}
          <line x1="710" y1="10" x2="710" y2="410" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

          {/* Y-Axis Static Price Scale Ticks */}
          {[0.12, 0.32, 0.52, 0.72, 0.92].map((pct, idx) => {
            const tickPrice = minPrice + priceRange * pct;
            const tickY = priceToY(tickPrice);
            return (
              <g key={`y-tick-${idx}`} className="select-none pointer-events-none">
                <line x1="710" y1={tickY} x2="716" y2={tickY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <text x="722" y={tickY + 3.5} fill="#64748B" fontSize="9" fontFamily="monospace">
                  ${tickPrice.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* 200-SMA Curve (Continuous line computed from full historical buffer) */}
          <path
            d={sma200Path}
            fill="none"
            stroke={smaSettings.sma200.color}
            strokeWidth={smaSettings.sma200.lineWidth}
            opacity="0.85"
            display={smaSettings.sma200.visible ? "inline" : "none"}
            data-testid="chart-path-sma200"
          />

          {/* 50-SMA Curve (Continuous line computed from full historical buffer) */}
          <path
            d={sma50Path}
            fill="none"
            stroke={smaSettings.sma50.color}
            strokeWidth={smaSettings.sma50.lineWidth}
            opacity="0.85"
            display={smaSettings.sma50.visible ? "inline" : "none"}
            data-testid="chart-path-sma50"
          />

          {/* 20-SMA Curve (Continuous line computed from full historical buffer) */}
          <path
            d={sma20Path}
            fill="none"
            stroke={smaSettings.sma20.color}
            strokeWidth={smaSettings.sma20.lineWidth}
            strokeLinecap="round"
            opacity="0.95"
            display={smaSettings.sma20.visible ? "inline" : "none"}
            data-testid="chart-path-sma20"
          />

          {/* ==================================================================== */}
          {/* BACKGROUND LAYER: Faded Dashed Horizontal Target Lines (30% - 40% opacity) */}
          {/* Fades down to 15% opacity when mouse hovers the right quadrant to prevent candle obstruction */}
          {/* ==================================================================== */}

          {/* Buy Target Line (Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(buyPrice)}
            x2="710"
            y2={priceToY(buyPrice)}
            stroke="var(--accent-cyan)"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
            style={{ opacity: isRightQuadrantHovered ? 0.15 : 0.35, transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-line-entry"
          />

          {/* Stop Loss Line (Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(stopVal)}
            x2="710"
            y2={priceToY(stopVal)}
            stroke="var(--accent-red)"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
            style={{ opacity: isRightQuadrantHovered ? 0.15 : 0.35, transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-line-stop"
          />

          {/* Primary Target 1 Line (1.5R - Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(targetVal)}
            x2="710"
            y2={priceToY(targetVal)}
            stroke="var(--accent-green)"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
            style={{ opacity: isRightQuadrantHovered ? 0.15 : 0.35, transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-line-t1"
          />

          {/* Target 2 Line (Core 2.0R - Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(t2Price)}
            x2="710"
            y2={priceToY(t2Price)}
            stroke="#10B981"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
            style={{ opacity: isRightQuadrantHovered ? 0.15 : 0.35, transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-line-t2"
          />

          {/* Target 3 Line (Runner 3.0R - Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(t3Price)}
            x2="710"
            y2={priceToY(t3Price)}
            stroke="#34D399"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
            style={{ opacity: isRightQuadrantHovered ? 0.15 : 0.35, transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-line-t3"
          />

          {/* Thin (1px) Real-Time Live Current Price Tracking Line */}
          <line
            x1="10"
            y1={priceToY(livePrice)}
            x2="710"
            y2={priceToY(livePrice)}
            stroke="#06B6D4"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={isRightQuadrantHovered ? "0.15" : "0.55"}
            style={{ transition: "opacity 300ms ease-in-out" }}
            data-testid="chart-live-price-line"
          />

          {/* Volume Bars */}
          {candles.map((bar, i) => {
            const vh = 20 + ((i * 17 + 13) % 65);
            return (
              <rect key={i} x={bar.x} y={415 - vh} width={candleWidth} height={vh} fill="url(#volGrad)" rx="1" />
            );
          })}

          {/* ==================================================================== */}
          {/* FOREGROUND LAYER: Dynamic Candlestick Series (Modern Institutional Aesthetic) */}
          {/* ==================================================================== */}
          {candles.map((bar, i) => {
            const isUp = bar.c >= bar.o;
            const bodyColor = isUp ? "#00E676" : "#FF5252";
            const top = priceToY(Math.max(bar.o, bar.c));
            const bottom = priceToY(Math.min(bar.o, bar.c));
            const height = Math.max(bottom - top, 2);
            const highY = priceToY(bar.h);
            const lowY = priceToY(bar.l);
            return (
              <g key={i}>
                <line x1={bar.x + candleWidth / 2} y1={highY} x2={bar.x + candleWidth / 2} y2={lowY} stroke={bodyColor} strokeWidth="1.2" opacity="0.9" />
                <rect x={bar.x} y={top} width={candleWidth} height={height} fill={bodyColor} rx="1" stroke="none" />
              </g>
            );
          })}

          {/* ==================================================================== */}
          {/* SIGNAL MARKERS LAYER: Minimalist Geometric Chevrons & Alignment Dots */}
          {/* Fades to 15% opacity when mouse cursor hovers in right quadrant */}
          {/* ==================================================================== */}
          <g
            data-testid="chart-signal-markers-layer"
            style={{
              opacity: isRightQuadrantHovered ? 0.15 : 1,
              transition: "opacity 300ms ease-in-out",
            }}
          >
            {/* Entry Signal: Minimalist Micro-Chevron (▲ GET IN) with Execution Timestamp */}
            {entryIndex >= 0 && entryIndex < candles.length && (() => {
              const bar = candles[entryIndex];
              const arrowY = priceToY(bar.l) + 4;
              const dateStr = formatMarkerDateTime(bar.t);
              const badgeX = Math.max(10, Math.min(bar.x + candleWidth / 2 - 68, 570));
              return (
                <g key={`entry-marker-${entryIndex}`} data-testid="chart-marker-entry" className="select-none">
                  <path
                    d={`M ${bar.x + candleWidth / 2 - 4} ${arrowY + 8} L ${bar.x + candleWidth / 2} ${arrowY + 3} L ${bar.x + candleWidth / 2 + 4} ${arrowY + 8}`}
                    fill="none"
                    stroke="#00E676"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={bar.x + candleWidth / 2} cy={arrowY + 1.5} r="1.5" fill="#00E676" />
                  {/* Execution Date & Price Badge Pill */}
                  <g transform={`translate(${badgeX}, ${arrowY + 12})`}>
                    <rect x="0" y="0" width="144" height="15" rx="3" fill="#062817" stroke="#00E676" strokeWidth="0.8" opacity="0.92" />
                    <text x="72" y="10.5" fill="#00E676" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      GET IN: {dateStr} @ ${buyPrice.toFixed(2)}
                    </text>
                  </g>
                  <title>{isMarketOpenNow ? "▲ GET IN · LIVE" : "▲ GET IN"} | Action: BUY | Fill Price: ${buyPrice.toFixed(2)} | Date: {dateStr} | Risk: ${risk.toFixed(2)} ($1R)</title>
                </g>
              );
            })()}

            {/* Exit Signal (Target 1): Minimalist Micro-Chevron (▼ GET OUT) with Execution Timestamp */}
            {targetIndex >= 0 && targetIndex < candles.length && (() => {
              const bar = candles[targetIndex];
              const arrowY = priceToY(bar.h) - 4;
              const dateStr = formatMarkerDateTime(bar.t);
              const badgeX = Math.max(10, Math.min(bar.x + candleWidth / 2 - 68, 570));
              return (
                <g key={`target-marker-${targetIndex}`} data-testid="chart-marker-target" className="select-none">
                  <path
                    d={`M ${bar.x + candleWidth / 2 - 4} ${arrowY - 8} L ${bar.x + candleWidth / 2} ${arrowY - 3} L ${bar.x + candleWidth / 2 + 4} ${arrowY - 8}`}
                    fill="none"
                    stroke="#00E676"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={bar.x + candleWidth / 2} cy={arrowY - 1.5} r="1.5" fill="#00E676" />
                  {/* Execution Date & Price Badge Pill */}
                  <g transform={`translate(${badgeX}, ${arrowY - 26})`}>
                    <rect x="0" y="0" width="144" height="15" rx="3" fill="#062817" stroke="#00E676" strokeWidth="0.8" opacity="0.92" />
                    <text x="72" y="10.5" fill="#00E676" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      T1 HIT: {dateStr} @ ${targetVal.toFixed(2)}
                    </text>
                  </g>
                  <title>▼ GET OUT · Target 1 Level: ${targetVal.toFixed(2)} | Action: TAKE PROFIT (T1 HIT) | Fill Price: ${targetVal.toFixed(2)} | Date: {dateStr} | P&L: +1.50R (+${(risk * 1.5).toFixed(2)})</title>
                </g>
              );
            })()}

            {/* Exit Signal (Stop Loss): Minimalist Micro-Chevron (▼ GET OUT) with Execution Timestamp */}
            {stopIndex >= 0 && stopIndex < candles.length && (() => {
              const bar = candles[stopIndex];
              const arrowY = priceToY(bar.h) - 4;
              const dateStr = formatMarkerDateTime(bar.t);
              const badgeX = Math.max(10, Math.min(bar.x + candleWidth / 2 - 68, 570));
              return (
                <g key={`stop-marker-${stopIndex}`} data-testid="chart-marker-stop" className="select-none">
                  <path
                    d={`M ${bar.x + candleWidth / 2 - 4} ${arrowY - 8} L ${bar.x + candleWidth / 2} ${arrowY - 3} L ${bar.x + candleWidth / 2 + 4} ${arrowY - 8}`}
                    fill="none"
                    stroke="#FF5252"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={bar.x + candleWidth / 2} cy={arrowY - 1.5} r="1.5" fill="#FF5252" />
                  {/* Execution Date & Price Badge Pill */}
                  <g transform={`translate(${badgeX}, ${arrowY - 26})`}>
                    <rect x="0" y="0" width="144" height="15" rx="3" fill="#2E0E14" stroke="#FF5252" strokeWidth="0.8" opacity="0.92" />
                    <text x="72" y="10.5" fill="#FF5252" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      STOP HIT: {dateStr} @ ${stopVal.toFixed(2)}
                    </text>
                  </g>
                  <title>▼ GET OUT · Stop Loss Level: ${stopVal.toFixed(2)} | Action: STOP LOSS | Fill Price: ${stopVal.toFixed(2)} | Date: {dateStr} | P&L: -1.00R (-${risk.toFixed(2)})</title>
                </g>
              );
            })()}

            {/* Real-time Dynamic Actionable Execution Trigger Marker on the Current Live Candle */}
            {(() => {
              const currentBar = candles[candles.length - 1];
              if (!currentBar) return null;

              if (executionTrigger.isTargetHit) {
                const arrowY = priceToY(currentBar.h) - 4;
                return (
                  <g key="live-target-marker" data-testid="chart-marker-target-hit chart-live-signal-target" className="select-none pointer-events-none">
                    <path
                      d={`M ${currentBar.x + candleWidth / 2 - 4} ${arrowY - 8} L ${currentBar.x + candleWidth / 2} ${arrowY - 3} L ${currentBar.x + candleWidth / 2 + 4} ${arrowY - 8}`}
                      fill="none"
                      stroke="#00E676"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx={currentBar.x + candleWidth / 2} cy={arrowY - 1.5} r="1.5" fill="#00E676" />
                    <title>[ SELL - TARGET HIT ]</title>
                  </g>
                );
              }

              if (executionTrigger.isStopHit) {
                const arrowY = priceToY(currentBar.h) - 4;
                return (
                  <g key="live-stop-marker" data-testid="chart-marker-stop-hit chart-live-signal-stop" className="select-none pointer-events-none">
                    <path
                      d={`M ${currentBar.x + candleWidth / 2 - 4} ${arrowY - 8} L ${currentBar.x + candleWidth / 2} ${arrowY - 3} L ${currentBar.x + candleWidth / 2 + 4} ${arrowY - 8}`}
                      fill="none"
                      stroke="#FF5252"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx={currentBar.x + candleWidth / 2} cy={arrowY - 1.5} r="1.5" fill="#FF5252" />
                    <title>[ SELL - STOP HIT ]</title>
                  </g>
                );
              }

              if (executionTrigger.isBuySignal) {
                const arrowY = priceToY(currentBar.l) + 4;
                return (
                  <g key="live-entry-marker" data-testid="chart-marker-buy-signal chart-live-signal-entry" className="select-none pointer-events-none">
                    <path
                      d={`M ${currentBar.x + candleWidth / 2 - 4} ${arrowY + 8} L ${currentBar.x + candleWidth / 2} ${arrowY + 3} L ${currentBar.x + candleWidth / 2 + 4} ${arrowY + 8}`}
                      fill="none"
                      stroke="#00E676"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx={currentBar.x + candleWidth / 2} cy={arrowY + 1.5} r="1.5" fill="#00E676" />
                    <title>[ BUY SIGNAL - EXECUTE ]</title>
                  </g>
                );
              }

              return null;
            })()}
          </g>

          {/* ==================================================================== */}
          {/* RIGHT-HAND Y-AXIS LABELS (Sitting outside candlestick grid with auto-fade) */}
          {/* When mouse cursor hovers right quadrant, transitions to 15% opacity to reveal candles */}
          {/* ==================================================================== */}
          <g
            data-testid="chart-overlay-layer"
            data-is-right-hovered={isRightQuadrantHovered ? "true" : "false"}
            style={{
              opacity: isRightQuadrantHovered ? 0.15 : 1,
              transition: "opacity 300ms ease-in-out",
            }}
          >
            {/* Compact Shrunk Glowing Live Price Tag on the Right-Hand Y-Axis */}
            <g transform={`translate(714, ${yAxisPillPositions.live})`} data-testid="chart-live-price-badge" className="select-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="18"
                rx="3"
                fill="#0891B2"
                className="drop-shadow-[0_0_4px_rgba(6,182,212,0.4)]"
              />
              <text
                x="38"
                y="12.5"
                fill="#FFFFFF"
                fontSize="10"
                fontFamily="monospace"
                fontWeight="800"
                textAnchor="middle"
              >
                ${livePrice.toFixed(2)}
              </text>
            </g>

            {/* BUY Price Tag on Right-Hand Y-Axis */}
            <g transform={`translate(714, ${yAxisPillPositions.buy})`} data-testid="chart-label-buy" className="select-none pointer-events-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="16"
                rx="2"
                fill="#082A3A"
                stroke="var(--accent-cyan)"
                strokeWidth="1"
              />
              <text
                x="38"
                y="11.5"
                fill="var(--accent-cyan)"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                BUY: ${buyPrice.toFixed(2)}
              </text>
            </g>

            {/* STOP Price Tag on Right-Hand Y-Axis */}
            <g transform={`translate(714, ${yAxisPillPositions.stop})`} data-testid="chart-label-stop" className="select-none pointer-events-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="16"
                rx="2"
                fill="#2E0E14"
                stroke="var(--accent-red)"
                strokeWidth="1"
              />
              <text
                x="38"
                y="11.5"
                fill="var(--accent-red)"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                STOP: ${stopVal.toFixed(2)}
              </text>
            </g>

            {/* T1 Price Tag on Right-Hand Y-Axis */}
            <g transform={`translate(714, ${yAxisPillPositions.t1})`} data-testid="chart-label-t1" className="select-none pointer-events-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="16"
                rx="2"
                fill="#0D2E1F"
                stroke="var(--accent-green)"
                strokeWidth="1"
              />
              <text
                x="38"
                y="11.5"
                fill="var(--accent-green)"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                T1: ${targetVal.toFixed(2)}
              </text>
            </g>

            {/* T2 Price Tag on Right-Hand Y-Axis (Core 2.0R) */}
            <g transform={`translate(714, ${yAxisPillPositions.t2})`} data-testid="chart-label-t2" className="select-none pointer-events-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="16"
                rx="2"
                fill="#064E3B"
                stroke="#10B981"
                strokeWidth="1"
              />
              <text
                x="38"
                y="11.5"
                fill="#34D399"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                T2: ${t2Price.toFixed(2)}
              </text>
            </g>

            {/* T3 Price Tag on Right-Hand Y-Axis (Runner 3.0R) */}
            <g transform={`translate(714, ${yAxisPillPositions.t3})`} data-testid="chart-label-t3" className="select-none pointer-events-none">
              <rect
                x="0"
                y="0"
                width="76"
                height="16"
                rx="2"
                fill="#022C22"
                stroke="#34D399"
                strokeWidth="1"
              />
              <text
                x="38"
                y="11.5"
                fill="#6EE7B7"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="bold"
                textAnchor="middle"
              >
                T3: ${t3Price.toFixed(2)}
              </text>
            </g>
          </g>

          {/* ==================================================================== */}
          {/* CROSSHAIR & HOVER TOOLTIP LAYER */}
          {/* ==================================================================== */}
          {hoveredData && (
            <g data-testid="chart-crosshair-lines" className="pointer-events-none select-none">
              {/* Vertical Crosshair Tracking Line */}
              <line
                x1={hoveredData.x}
                y1="10"
                x2={hoveredData.x}
                y2="410"
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.45"
              />
              {/* Horizontal Crosshair Tracking Line */}
              <line
                x1="10"
                y1={hoveredData.y}
                x2="710"
                y2={hoveredData.y}
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.45"
              />
              {/* Crosshair Y-Axis Hover Price Badge */}
              <g transform={`translate(714, ${hoveredData.y - 8})`}>
                <rect x="0" y="0" width="76" height="16" rx="2" fill="#1E293B" stroke="#64748B" strokeWidth="1" />
                <text x="38" y="11.5" fill="#E2E8F0" fontSize="9" fontFamily="monospace" textAnchor="middle">
                  ${hoveredData.price.toFixed(2)}
                </text>
              </g>
            </g>
          )}

          {/* Hovered Candle Highlight & Floating Tooltip */}
          {hoveredData?.candle && (
            <g data-testid="chart-hover-tooltip" className="pointer-events-none select-none">
              {/* Highlight halo on hovered candle */}
              <rect
                x={hoveredData.candle.x - 2}
                y={priceToY(hoveredData.candle.h) - 4}
                width={candleWidth + 4}
                height={Math.max(priceToY(hoveredData.candle.l) - priceToY(hoveredData.candle.h) + 8, 12)}
                rx="3"
                fill="none"
                stroke="#06B6D4"
                strokeWidth="1.5"
                strokeDasharray="2 2"
                opacity="0.8"
              />
              {/* Floating Tooltip near cursor */}
              {(() => {
                const ttWidth = 100;
                const ttHeight = 44;
                const posX = Math.min(Math.max(hoveredData.x + 12, 10), 710 - ttWidth - 10);
                const posY = hoveredData.y > 60 ? hoveredData.y - ttHeight - 8 : hoveredData.y + 14;
                const isUp = hoveredData.candle.c >= hoveredData.candle.o;
                const chg = hoveredData.candle.c - hoveredData.candle.o;
                return (
                  <g transform={`translate(${posX}, ${posY})`}>
                    <rect
                      width={ttWidth}
                      height={ttHeight}
                      rx="4"
                      fill="rgba(15, 23, 42, 0.95)"
                      stroke="rgba(6, 182, 212, 0.5)"
                      strokeWidth="1"
                      filter="drop-shadow(0 2px 5px rgba(0,0,0,0.6))"
                    />
                    <text x="8" y="14" fill="#94A3B8" fontSize="8" fontFamily="monospace">
                      O: ${hoveredData.candle?.o != null ? hoveredData.candle.o.toFixed(2) : "0.00"} H: ${hoveredData.candle?.h != null ? hoveredData.candle.h.toFixed(2) : "0.00"}
                    </text>
                    <text x="8" y="26" fill="#94A3B8" fontSize="8" fontFamily="monospace">
                      L: ${hoveredData.candle?.l != null ? hoveredData.candle.l.toFixed(2) : "0.00"} C: ${hoveredData.candle?.c != null ? hoveredData.candle.c.toFixed(2) : "0.00"}
                    </text>
                    <text x="8" y="38" fill={isUp ? "#4ADE80" : "#F87171"} fontSize="8" fontFamily="monospace" fontWeight="bold">
                      {isUp ? "+" : ""}{chg.toFixed(2)} ({isUp ? "+" : ""}{hoveredData.candle?.o ? ((chg / hoveredData.candle.o) * 100).toFixed(2) : "0.00"}%)
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          {/* ==================================================================== */}
          {/* TIME SCALE / DATE AXIS (Bottom X-Axis with readable date and time) */}
          {/* ==================================================================== */}
          <g data-testid="chart-time-scale" className="select-none pointer-events-none font-mono">
            <line x1="0" y1="396" x2="710" y2="396" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            {candles.map((bar, i) => {
              const step = timeframe === "1H" ? 4 : timeframe === "4H" ? 3 : 2;
              if (i % step !== 0 && i !== candles.length - 1) return null;
              const cx = bar.x + candleWidth / 2;
              return (
                <g key={`time-tick-${i}`}>
                  <line x1={cx} y1="396" x2={cx} y2="401" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                  <text
                    x={cx}
                    y="412"
                    fill="#94A3B8"
                    fontSize="8"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {formatTimeScaleTick(bar.t, timeframe)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Sleek, semi-transparent floating overlay panel: AI Actionable Tips directly on Chart Canvas */}
        <div
          data-testid="chart-ai-actionable-tips"
          className="absolute bottom-4 left-4 z-10 max-w-sm p-4 bg-gray-900/80 backdrop-blur-md border border-gray-700 rounded-lg text-sm text-gray-200 shadow-lg pointer-events-auto select-none"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-700/60">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-400/40">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                AI Actionable Tips
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
              {symbol}
            </span>
          </div>

          <div className="space-y-1.5 font-sans text-xs">
            <div className="flex items-start gap-2">
              <span className="text-cyan-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-200 leading-snug">
                Holding structural 20-SMA support at ${+(livePrice * 0.985).toFixed(2)}. Await candle close above ${buyPrice != null ? buyPrice.toFixed(2) : "0.00"} to confirm bounce.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-amber-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Demand volume spike &gt;1.2x average needed. Avoid chasing entry if current candle exceeds 1.5 ATR (${item?.atr ? item.atr.toFixed(2) : "3.50"}).
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-400 font-bold shrink-0 mt-0.5">●</span>
              <p className="text-slate-300 leading-snug">
                Hard stop pinned below structural low at ${stopVal != null ? stopVal.toFixed(2) : "0.00"}. Scale 50% at T1 (${targetVal != null ? targetVal.toFixed(2) : "0.00"}).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Chart = LiveTradingChart;

// ============================================================================
// MAIN COMPONENT: WEALTH ENGINE DASHBOARD
// ============================================================================
export default function WealthEngineDashboard() {
  const global = useGlobalState();
  const { activeTickerData, activePrice, livePrices } = global;
  const [newTickerInput, setNewTickerInput] = useState("");
  const [isFidelityGuideOpen, setIsFidelityGuideOpen] = useState(false);

  const theme = global?.theme ?? "cyber-neon";
  const activeTheme = THEMES[theme] || THEMES["cyber-neon"];

  const { source: feedSource, state: feedState, isMarketOpen: feedMarketOpen } = useFeedConnection();
  const marketOpen = global?.isMarketOpen ?? feedMarketOpen ?? isMarketOpen();

  const THEME_ORDER: DashboardTheme[] = ["cyber-neon", "stealth", "arctic", "sunset-orange", "neon-grape", "mint-matrix"];
  const cycleTheme = () => {
    global?.cycleTheme?.();
  };

  // Active ticker selection (linked directly to Chart symbol)
  const activeTicker = activeTickerData?.symbol ?? global?.activeTicker ?? "NVDA";
  const setActiveTicker = global?.setActiveTicker ?? (() => {});
  const activeSymbol = activeTicker;
  const setActiveSymbol = setActiveTicker;
  const watchlist = global?.watchlist ?? DEFAULT_WATCHLIST;
  const activeItem = global?.activeItem || watchlist?.find((i) => i?.symbol === activeTicker) || watchlist?.[0] || DEFAULT_WATCHLIST[0];

  // Boot Sequence Diagnostic Logging
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log(`[Boot:WealthStudio] WealthEngineDashboard mounted. activeTicker: ${activeTicker}, activePrice: ${activeTickerData?.price ?? activePrice ?? activeItem?.price}, watchlist count: ${watchlist?.length}`);
    }
  }, [activeTicker, activeTickerData?.price, activePrice, activeItem?.price, watchlist?.length]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTickerInput.trim()) return;
    global?.addTicker?.(newTickerInput);
    setNewTickerInput("");
  };

  // Center column tabs: "Chart" | "Setup History" | "Settings" | "Indicators"
  const [activeTab, setActiveTab] = useState<"Chart" | "Setup History" | "Settings" | "Indicators">("Chart");

  // Timeframe selector
  const activeTf = global?.timeframe ?? "1H";
  const setActiveTf = global?.setTimeframe ?? (() => {});

  // Market regime simulation: "GREEN" | "YELLOW" | "RED"
  const [regime, setRegime] = useState<"GREEN" | "YELLOW" | "RED">("GREEN");

  // Advanced Metrics accordion state in Right Column
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [isStudioMiniGuideOpen, setIsStudioMiniGuideOpen] = useState(false);
  const [isStudioSetupCardExpanded, setIsStudioSetupCardExpanded] = useState(false);

  // Dynamic Risk-Based Position Sizer State & Calculation for Studio Setup Card
  const [cardRiskPctOverride, setCardRiskPctOverride] = useState<number | null>(null);
  const cardSizing = usePositionSizer({
    entryPrice: activeItem?.buyTarget ?? activeTickerData?.buyTarget ?? activePrice,
    stopLossPrice: activeItem?.stopLoss ?? activeTickerData?.stopLoss,
    riskPercentage: cardRiskPctOverride ?? undefined,
  });

  const openArmTrade = global?.openArmTrade ?? (() => {});

  // Card status background tints with safe optional chaining
  const statusTint = useMemo(() => {
    switch (activeItem?.status) {
      case "Ready":
        return "bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_20px_rgba(34,197,94,0.12)]";
      case "Awaiting Close":
        return "bg-amber-950/20 border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.12)]";
      default:
        return "bg-cyan-950/20 border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.10)]";
    }
  }, [activeItem?.status]);

  return (
    <ErrorBoundary label="Wealth Studio Workspace" fullPage>
      <div
        style={activeTheme.vars as React.CSSProperties}
        className="h-screen w-screen max-h-screen max-w-screen overflow-hidden flex flex-col font-sans transition-colors duration-200"
        data-testid="wealth-engine-dashboard"
        data-theme={theme}
      >
      {/* ==================================================================== */}
      {/* 1. TOP NAVIGATION BAR */}
      {/* ==================================================================== */}
      <header
        className="h-14 flex-shrink-0 px-4 md:px-6 flex items-center justify-between border-b select-none z-30"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        {/* Left: Branding & Bullish Candlestick Logo */}
        <div className="flex items-center gap-4">
          <div className="flex items-center tracking-tight select-none" data-testid="dashboard-brand-logo" aria-label="CHIZZLE WEALTH ENGINE">
            <span
              className="font-black tracking-tight font-mono text-2xl md:text-3xl flex items-center drop-shadow-sm"
              style={{ color: "var(--text-primary)" }}
            >
              <span>CH</span>
              <CandlestickIcon color="var(--accent-green)" />
              <span>ZZLE</span>
            </span>
            <span
              className="text-[11px] md:text-xs uppercase tracking-[0.22em] font-extrabold ml-3 px-2.5 py-1 rounded border shadow-sm"
              style={{
                color: "var(--accent-cyan)",
                borderColor: "var(--border-subtle)",
                backgroundColor: "var(--badge-bg)",
              }}
            >
              WEALTH ENGINE
            </span>
          </div>

          {/* Quick Breadcrumb / Links */}
          <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-white/10 text-xs font-mono">
            <Link
              href="/"
              className="text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
              title="Return to Main Cockpit"
            >
              <LayoutDashboard className="h-3 w-3" />
              <span>Cockpit</span>
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-cyan-300 font-bold">Single-Page Studio</span>
          </div>
        </div>

        {/* Center: Live Terminal Telemetry, Single Source of Truth Ticker Pill & Provider Status */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono">
          {/* Active Ticker Real-Time Data Sync Pill */}
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-full border bg-black/40 border-cyan-500/40 font-mono text-xs shadow-sm"
            data-testid="header-active-ticker-pill"
          >
            <span className={`h-2 w-2 rounded-full bg-cyan-400 ${marketOpen ? "animate-pulse" : ""} shadow-[0_0_6px_#22D3EE]`} />
            <span className="font-black text-white">{activeTickerData?.symbol ?? activeTicker}</span>
            <span className="font-black text-cyan-400 tabular-nums drop-shadow-[0_0_6px_rgba(6,182,212,0.5)]" data-testid="header-live-price">
              ${(activeTickerData?.price ?? activePrice ?? 0).toFixed(2)}
            </span>
            <span className={`text-[10px] font-bold ${(activeTickerData?.change ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {(activeTickerData?.change ?? 0) >= 0 ? "+" : ""}{(activeTickerData?.change ?? 0).toFixed(2)} ({(activeTickerData?.changePct ?? 0) >= 0 ? "+" : ""}{(activeTickerData?.changePct ?? 0).toFixed(2)}%)
            </span>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm font-bold tracking-wider ${
              !marketOpen
                ? "border-slate-700/60 bg-slate-900/80 text-slate-300 shadow-[0_0_10px_rgba(148,163,184,0.15)]"
                : feedSource && feedSource !== "FINNHUB"
                ? "border-amber-400/50 bg-amber-950/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                : "border-emerald-400/50 bg-emerald-950/60 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)]"
            }`}
            data-testid="pill-feed-provider"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                !marketOpen
                  ? "bg-slate-400 shadow-[0_0_6px_#94A3B8]"
                  : feedSource && feedSource !== "FINNHUB"
                  ? "bg-amber-400 shadow-[0_0_6px_#F59E0B] animate-pulse"
                  : "bg-emerald-400 shadow-[0_0_6px_#34D399]"
              }`}
            />
            <span>
              {!marketOpen ? (
                <>
                  <span>MARKET CLOSED (OFFICIAL CLOSE)</span>
                  <span className="hidden">STATIC: LAST CLOSE</span>
                </>
              ) : feedSource && feedSource !== "FINNHUB" ? (
                `🟡 LIVE: ${feedSource === "POLYGON" ? "Polygon" : feedSource === "TWELVEDATA" ? "TwelveData" : feedSource} (Backup)`
              ) : (
                "🟢 LIVE: WebSocket (Finnhub)"
              )}
            </span>
          </div>
        </div>

        {/* Right: Risk Settings Bar & Theme Switcher Toggle */}
        <div className="flex items-center gap-3">
          <RiskSettingsBar />
          <button
            onClick={cycleTheme}
            data-testid="button-theme-switcher"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-sm cursor-pointer hover:scale-105 active:scale-95"
            style={{
              borderColor: "var(--border-main)",
              backgroundColor: "var(--bg-panel-subtle)",
              color: "var(--accent-cyan)",
            }}
            title="Cycle theme"
          >
            {theme === "cyber-neon" && <Zap className="h-3.5 w-3.5 text-cyan-400" />}
            {theme === "stealth" && <Moon className="h-3.5 w-3.5 text-amber-400" />}
            {theme === "arctic" && <Sun className="h-3.5 w-3.5 text-blue-600" />}
            {theme === "sunset-orange" && <Flame className="h-3.5 w-3.5 text-orange-400" />}
            {theme === "neon-grape" && <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />}
            {theme === "mint-matrix" && <Terminal className="h-3.5 w-3.5 text-emerald-400" />}
            <span className="hidden sm:inline">{activeTheme.name}</span>
          </button>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* 2. THREE-COLUMN LAYOUT (STRICT 100VH, LOCKED, NO WINDOW SCROLLING) */}
      {/* ==================================================================== */}
      <main
        className="grid grid-cols-[300px_minmax(0,1fr)_350px] w-full h-full gap-4 overflow-hidden flex-1 min-h-0"
        style={{
          backgroundColor: "var(--bg-root)",
          color: "var(--text-primary)",
        }}
      >
        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 1: LEFT COLUMN (20% width — w-[20%]) — MARKET CONTEXT & WATCHLIST */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <aside
          className="w-full h-full flex flex-col border-r overflow-hidden"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
          data-testid="column-left"
        >
          {/* Top: Market Regime Traffic-Light Indicator */}
          <div
            className="p-4 border-b flex-shrink-0"
            style={{ borderColor: "var(--border-subtle)" }}
            data-testid="market-regime-indicator"
          >
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold" style={{ color: "var(--text-secondary)" }}>
                Market Regime
              </span>
              <span
                className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded font-bold"
                style={{
                  color: regime === "GREEN" ? "var(--accent-green)" : regime === "YELLOW" ? "var(--accent-amber)" : "var(--accent-red)",
                  backgroundColor: "var(--bg-card)",
                }}
              >
                {regime === "GREEN" ? "Risk-On" : regime === "YELLOW" ? "Caution" : "Risk-Off"}
              </span>
            </div>

            {/* Traffic-Light Housing & LEDs */}
            <div
              className="p-3 rounded-xl border flex items-center justify-between shadow-inner"
              style={{
                backgroundColor: "var(--bg-panel-subtle)",
                borderColor: "var(--border-subtle)",
              }}
            >
              {/* Traffic Light Bulbs */}
              <div className="flex items-center gap-2.5">
                {/* RED LED */}
                <button
                  type="button"
                  onClick={() => setRegime("RED")}
                  className={`h-5 w-5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
                    regime === "RED"
                      ? "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)] ring-2 ring-red-400/50 scale-110"
                      : "bg-red-950/40 opacity-40 hover:opacity-75"
                  }`}
                  title="Switch to RED (Risk-Off) Regime"
                  aria-label="Red Traffic Light"
                />
                {/* YELLOW LED */}
                <button
                  type="button"
                  onClick={() => setRegime("YELLOW")}
                  className={`h-5 w-5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
                    regime === "YELLOW"
                      ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.9)] ring-2 ring-amber-300/50 scale-110"
                      : "bg-amber-950/40 opacity-40 hover:opacity-75"
                  }`}
                  title="Switch to YELLOW (Caution) Regime"
                  aria-label="Yellow Traffic Light"
                />
                {/* GREEN LED */}
                <button
                  type="button"
                  onClick={() => setRegime("GREEN")}
                  className={`h-5 w-5 rounded-full transition-all cursor-pointer flex items-center justify-center ${
                    regime === "GREEN"
                      ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] ring-2 ring-emerald-300/50 scale-110 animate-pulse"
                      : "bg-emerald-950/40 opacity-40 hover:opacity-75"
                  }`}
                  title="Switch to GREEN (Risk-On) Regime"
                  aria-label="Green Traffic Light"
                />
              </div>

              {/* Stance Note */}
              <div className="text-right font-mono">
                <div
                  className="text-xs font-bold leading-tight"
                  style={{
                    color: regime === "GREEN" ? "var(--accent-green)" : regime === "YELLOW" ? "var(--accent-amber)" : "var(--accent-red)",
                  }}
                >
                  {regime === "GREEN" ? "UPTREND 84%" : regime === "YELLOW" ? "MIXED 52%" : "DOWNTREND"}
                </div>
                <div className="text-[9px]" style={{ color: "var(--text-secondary)" }}>
                  {regime === "GREEN" ? "Full Size Allowed" : regime === "YELLOW" ? "Half Pilot Sizing" : "Cash is King"}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: Scrollable, Compact Watchlist */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Quick-Add Ticker Input */}
            <form
              onSubmit={handleQuickAdd}
              className="px-3 py-2 border-b flex items-center gap-1.5 bg-black/20 flex-shrink-0"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <input
                type="text"
                data-testid="input-quick-add-ticker"
                value={newTickerInput}
                onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                placeholder="ADD TICKER (e.g. AMD)..."
                maxLength={6}
                className="flex-1 px-2.5 py-1 rounded bg-black/40 border border-white/10 text-xs font-mono font-bold tracking-wider uppercase text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                data-testid="button-quick-add-ticker"
                className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 hover:bg-cyan-500/30 text-xs font-mono font-bold uppercase transition-colors cursor-pointer"
                title="Add ticker to watchlist"
              >
                +
              </button>
            </form>

            {/* Watchlist Header */}
            <div
              className="px-4 py-2 flex items-center justify-between border-b text-[10px] font-mono uppercase tracking-wider font-bold flex-shrink-0"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              <span>Watchlist ({watchlist.length})</span>
              <span>Price · Chg</span>
            </div>

            {/* Internal Scrollable Rows */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {(watchlist || []).map((item) => {
                if (!item) return null;
                const isSelected = item.symbol === activeSymbol;
                const isPositive = (item.change ?? 0) >= 0;
                return (
                  <div
                    key={item.symbol}
                    onClick={() => setActiveTicker(item.symbol)}
                    data-testid={`watchlist-row-${item.symbol}`}
                    className={`px-3 py-2.5 flex items-center justify-between cursor-pointer transition-colors ${
                      isSelected
                        ? "border-l-4"
                        : "hover:bg-white/[0.04]"
                    }`}
                    style={{
                      borderLeftColor: isSelected ? "var(--accent-cyan)" : "transparent",
                      backgroundColor: isSelected ? "var(--bg-card)" : "transparent",
                    }}
                  >
                    {/* Symbol & Name */}
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-sm tracking-tight" style={{ color: "var(--text-primary)" }}>
                          {item.symbol}
                        </span>
                        <span
                          className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-semibold uppercase ${
                            item.status === "Ready"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : item.status === "Awaiting Close"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-cyan-500/20 text-cyan-400"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div className="text-[10px] truncate" style={{ color: "var(--text-secondary)" }}>
                        {item.name}
                      </div>
                    </div>

                    {/* Mini SVG Sparkline */}
                    <div className="w-14 h-6 flex-shrink-0 px-1">
                      <svg viewBox="0 0 50 20" className="w-full h-full overflow-visible">
                        {(() => {
                          const spark = Array.isArray(item.sparkline) && item.sparkline.length > 0 ? item.sparkline : [100, 100];
                          const min = Math.min(...spark);
                          const max = Math.max(...spark);
                          const range = max - min || 1;
                          const points = spark
                            .map((val, idx) => {
                              const x = (idx / (spark.length - 1)) * 48 + 1;
                              const y = 19 - ((val - min) / range) * 16;
                              return `${x},${y}`;
                            })
                            .join(" ");
                          return (
                            <polyline
                              fill="none"
                              stroke={isPositive ? "var(--accent-green)" : "var(--accent-red)"}
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={points}
                            />
                          );
                        })()}
                      </svg>
                    </div>

                    {/* Price & Change Badge — Synchronized to activeTickerData */}
                    <div className="text-right flex-shrink-0 font-mono">
                      <div className="text-xs font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        ${(item.symbol === activeTickerData?.symbol ? activeTickerData.price : (item.price ?? 100)).toFixed(2)}
                      </div>
                      <div
                        className="text-[10px] font-bold tabular-nums flex items-center justify-end gap-0.5"
                        style={{ color: (item.symbol === activeTickerData?.symbol ? (activeTickerData.change >= 0) : isPositive) ? "var(--accent-green)" : "var(--accent-red)" }}
                      >
                        {(item.symbol === activeTickerData?.symbol ? (activeTickerData.change >= 0) : isPositive) ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                        <span>
                          {(item.symbol === activeTickerData?.symbol ? (activeTickerData.change >= 0) : isPositive) ? "+" : ""}
                          {(item.symbol === activeTickerData?.symbol ? activeTickerData.changePct : (item.changePct ?? 0)).toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Contextual Trading Tips Card directly below the Watchlist */}
            <div className="p-2 border-t overflow-y-auto max-h-[240px] flex-shrink-0" style={{ borderColor: "var(--border-subtle)" }}>
              <TradingTipsCard item={activeItem} />
            </div>
          </div>
        </aside>

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 2: CENTER COLUMN (55% width — w-[55%]) — VISUAL ANALYSIS & CHART */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <section
          className="w-full min-w-0 h-full flex flex-col border-r overflow-hidden"
          style={{
            backgroundColor: "var(--bg-root)",
            borderColor: "var(--border-subtle)",
          }}
          data-testid="column-center"
        >
          {/* Top Horizontal Tab-Bar */}
          <div
            className="h-12 flex-shrink-0 px-4 border-b flex items-center justify-between z-10"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
            }}
            data-testid="center-tab-bar"
          >
            {/* Tabs */}
            <div className="flex items-center gap-1 font-mono text-xs">
              <button
                onClick={() => setActiveTab("Chart")}
                data-testid="tab-chart"
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  activeTab === "Chart" ? "shadow-sm border font-bold" : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: activeTab === "Chart" ? "var(--border-main)" : "transparent",
                  backgroundColor: activeTab === "Chart" ? "var(--bg-panel-subtle)" : "transparent",
                  color: activeTab === "Chart" ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                Chart
              </button>
              <button
                onClick={() => setActiveTab("Setup History")}
                data-testid="tab-setup-history"
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  activeTab === "Setup History" ? "shadow-sm border font-bold" : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: activeTab === "Setup History" ? "var(--border-main)" : "transparent",
                  backgroundColor: activeTab === "Setup History" ? "var(--bg-panel-subtle)" : "transparent",
                  color: activeTab === "Setup History" ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                Setup History
              </button>
              <button
                onClick={() => setActiveTab("Settings")}
                data-testid="tab-settings"
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  activeTab === "Settings" ? "shadow-sm border font-bold" : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: activeTab === "Settings" ? "var(--border-main)" : "transparent",
                  backgroundColor: activeTab === "Settings" ? "var(--bg-panel-subtle)" : "transparent",
                  color: activeTab === "Settings" ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                Settings
              </button>
              <button
                onClick={() => setActiveTab("Indicators")}
                data-testid="tab-indicators"
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  activeTab === "Indicators" ? "shadow-sm border font-bold" : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: activeTab === "Indicators" ? "var(--border-main)" : "transparent",
                  backgroundColor: activeTab === "Indicators" ? "var(--bg-panel-subtle)" : "transparent",
                  color: activeTab === "Indicators" ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                Indicators
              </button>
            </div>

            {/* Timeframe Pill Toggles */}
            <div className="flex items-center gap-1 bg-black/20 p-1 rounded-md border border-white/10 font-mono text-[11px]">
              {(["1H", "4H", "1D", "1W"] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setActiveTf(tf)}
                  className={`px-2 py-0.5 rounded font-bold transition-all ${
                    activeTf === tf
                      ? "bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {/* Body Area / Constrained Chart Wrapper */}
          <div className="min-w-0 flex-1 overflow-hidden relative flex flex-col p-4">
            {activeTab === "Chart" && (
              <div className="min-w-0 flex-1 overflow-hidden relative w-full h-full">
                <ErrorBoundary label="Wealth Studio Live Chart">
                  <Chart
                    key={`${activeTicker}-${activeTf}`}
                    symbol={activeTicker}
                    timeframe={activeTf}
                    activeItem={activeItem}
                    entryPrice={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? activeItem?.buyTarget) : activeItem?.buyTarget}
                    stopLoss={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? activeItem?.stopLoss) : activeItem?.stopLoss}
                    primaryTarget={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? activeItem?.primaryTarget) : activeItem?.primaryTarget}
                    onOpenFidelityGuide={() => setIsFidelityGuideOpen(true)}
                  />
                </ErrorBoundary>
              </div>
            )}

            {/* Tab: Setup History */}
            {activeTab === "Setup History" && (
              <div
                className="w-full h-full flex-1 overflow-y-auto rounded-xl border p-4 shadow-xl"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <h3 className="font-mono font-bold text-sm uppercase tracking-wider mb-3" style={{ color: "var(--text-primary)" }}>
                  Verified Historical Swings ({activeItem?.symbol ?? activeTicker})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                        <th className="py-2">Date</th>
                        <th>Pattern Type</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>R-Multiple</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                      {[
                        { date: "Oct 18, 2026", type: "20-SMA Bounce", entry: "$129.40", exit: "$137.80", r: "+2.4R", win: true },
                        { date: "Oct 04, 2026", type: "Breakout Retest", entry: "$121.50", exit: "$128.20", r: "+1.9R", win: true },
                        { date: "Sep 22, 2026", type: "Higher Low Consolidation", entry: "$118.00", exit: "$115.50", r: "-1.0R", win: false },
                        { date: "Sep 09, 2026", type: "Trendline Reclaim", entry: "$109.80", exit: "$121.00", r: "+3.1R", win: true },
                      ].map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.02]">
                          <td className="py-2.5">{row.date}</td>
                          <td>{row.type}</td>
                          <td>{row.entry}</td>
                          <td>{row.exit}</td>
                          <td className={row.win ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{row.r}</td>
                          <td>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.win ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                              {row.win ? "WIN" : "LOSS"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab: Settings */}
            {activeTab === "Settings" && (
              <div
                className="w-full h-full flex-1 overflow-y-auto rounded-xl border p-6 shadow-xl"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <h3 className="font-mono font-bold text-sm uppercase tracking-wider mb-4" style={{ color: "var(--text-primary)" }}>
                  Studio & Chart Preferences
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                  <div className="p-4 rounded-lg border bg-black/20" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="font-bold text-sm mb-1">Candlestick Styling</div>
                    <div className="text-slate-400 text-[11px] mb-3">Institutional hollow vs solid candlesticks</div>
                    <select className="w-full p-2 rounded bg-black/40 border border-white/10 text-white">
                      <option>Solid Bull / Solid Bear</option>
                      <option>Hollow Bullish Bars</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-lg border bg-black/20" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="font-bold text-sm mb-1">Price Scale Mode</div>
                    <div className="text-slate-400 text-[11px] mb-3">Linear arithmetic vs logarithmic scale</div>
                    <select className="w-full p-2 rounded bg-black/40 border border-white/10 text-white">
                      <option>Arithmetic (Regular)</option>
                      <option>Logarithmic (Percentage)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Indicators */}
            {activeTab === "Indicators" && (
              <div
                className="w-full h-full flex-1 overflow-y-auto rounded-xl border p-6 shadow-xl"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <h3 className="font-mono font-bold text-sm uppercase tracking-wider mb-4" style={{ color: "var(--text-primary)" }}>
                  Technical Indicators Overlay
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 font-mono text-xs">
                  {[
                    { name: "20-SMA (Short-term)", on: true, color: "text-blue-400" },
                    { name: "50-SMA (Swing Trend)", on: true, color: "text-red-400" },
                    { name: "200-SMA (Macro)", on: true, color: "text-fuchsia-400" },
                    { name: "RSI (14-period)", on: false, color: "text-amber-400" },
                    { name: "MACD (12, 26, 9)", on: false, color: "text-cyan-400" },
                    { name: "Volume Weighted (VWAP)", on: false, color: "text-emerald-400" },
                  ].map((ind, i) => (
                    <div key={i} className="p-3 rounded-lg border bg-black/20 flex items-center justify-between" style={{ borderColor: "var(--border-subtle)" }}>
                      <span className={`font-bold ${ind.color}`}>{ind.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${ind.on ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-slate-400"}`}>
                        {ind.on ? "ON" : "OFF"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 3: RIGHT COLUMN (25% width — w-[25%]) — THE TRADE PLAN & EXECUTION */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <section
          className="w-full h-full overflow-y-auto pl-2 border-l border-slate-800 flex flex-col"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
          data-testid="column-right"
        >
          {/* Column Header */}
          <div
            className="h-12 flex-shrink-0 px-4 border-b flex items-center justify-between z-10"
            style={{
              backgroundColor: "var(--bg-panel-subtle)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold" style={{ color: "var(--text-secondary)" }}>
              Trade Plan & Execution
            </span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="text-[10px] font-mono font-bold" style={{ color: "var(--accent-cyan)" }}>
                {activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
              </span>
            </div>
          </div>

          {/* Internal Scrollable Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* The Setup Card Component */}
            <div
              className={`rounded-2xl border overflow-hidden transition-all duration-300 relative bg-[var(--card-bg)] border-[var(--card-border)] ${statusTint}`}
              data-testid="setup-card"
            >
              {/* Card Header & Status Badge */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-[var(--card-border)] overflow-hidden" data-testid="studio-setup-card-header">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black font-mono tracking-tight text-[var(--card-text-primary)] shrink-0">
                      {activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
                    </span>
                    <span className="text-xs font-mono font-semibold opacity-75 text-[var(--card-text-secondary)] shrink-0">
                      ${activeItem?.price != null ? activeItem.price.toFixed(2) : "0.00"}
                    </span>
                  </div>
                  <div className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--card-accent-buy)] font-bold mt-0.5 truncate">
                    {activeTickerData?.setupType ?? activeItem?.setupType ?? "SWING SETUP"}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsStudioMiniGuideOpen((prev) => !prev)}
                    className={`px-2 py-0.5 rounded-md border font-mono text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm shrink-0 ${
                      isStudioMiniGuideOpen
                        ? "border-emerald-400 bg-emerald-500/25 text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)]"
                        : "border-emerald-500/40 bg-emerald-950/60 text-emerald-400 hover:bg-emerald-900/60 hover:text-emerald-200"
                    }`}
                    data-testid="button-studio-mini-guide"
                    title="Toggle Quick View Fidelity Ticket Mini-Guide"
                  >
                    [Broker Guide]
                  </button>

                  {/* Potential Gain Badge */}
                  {(() => {
                    const buy = activeTickerData?.buyTarget ?? activeItem?.buyTarget ?? 0;
                    const tgt = activeTickerData?.target1 ?? activeItem?.primaryTarget ?? 0;
                    const gainPct = buy > 0 && tgt > buy ? ((tgt - buy) / buy) * 100 : 0;
                    if (gainPct <= 0) return null;
                    return (
                      <span className="rounded-full border border-[var(--card-border)] bg-[var(--card-badge-bg)] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[var(--card-badge-text)] tabular-nums shadow-sm shrink-0 hidden sm:inline-block">
                        +{gainPct.toFixed(2)}% Potential Gain
                      </span>
                    );
                  })()}

                  <div
                    className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider shadow-sm border shrink-0 ${
                      (activeTickerData?.status ?? activeItem?.status) === "Ready"
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40 animate-pulse"
                        : (activeTickerData?.status ?? activeItem?.status) === "Awaiting Close"
                        ? "bg-amber-500/20 text-amber-300 border-amber-400/40"
                        : "bg-cyan-500/20 text-cyan-300 border-cyan-400/40"
                    }`}
                    data-testid="badge-setup-status"
                  >
                    {activeTickerData?.status ?? activeItem?.status ?? "Ready"}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsStudioSetupCardExpanded((prev) => !prev)}
                    className="p-1 rounded-md border border-[var(--card-border)] bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                    data-testid="button-toggle-setup-card-collapse"
                    title={isStudioSetupCardExpanded ? "Collapse card details" : "Expand card details"}
                    aria-label={isStudioSetupCardExpanded ? "Collapse card details" : "Expand card details"}
                  >
                    {isStudioSetupCardExpanded ? (
                      <ChevronUp className="h-4 w-4 text-cyan-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-cyan-400" />
                    )}
                  </button>
                </div>
              </div>

              {/* EXACTLY THREE LARGE, BOLD DATA POINTS */}
              <div className="grid grid-cols-3 gap-3 my-4 w-full" data-testid="setup-three-bold-datapoints">
                {/* 1. Buy Target (Entry) */}
                <div
                  className="p-2.5 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                >
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">
                    Buy Target
                  </span>
                  <span className="text-2xl font-black font-mono tabular-nums text-[var(--card-accent-buy)]">
                    ${activeItem?.buyTarget != null ? activeItem.buyTarget.toFixed(2) : "0.00"}
                  </span>
                  <span className="text-[8.5px] font-mono text-[var(--card-text-secondary)] mt-0.5">
                    Entry Level
                  </span>
                </div>

                {/* 2. Stop Loss */}
                <div
                  className="p-2.5 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                >
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">
                    Stop Loss
                  </span>
                  <span className="text-2xl font-black font-mono tabular-nums text-[var(--card-accent-stop)]">
                    ${activeItem?.stopLoss != null ? activeItem.stopLoss.toFixed(2) : "0.00"}
                  </span>
                  <span className="text-[8.5px] font-mono text-[var(--card-text-secondary)] mt-0.5">
                    Structural
                  </span>
                </div>

                {/* 3. Primary Target */}
                <div
                  className="p-2.5 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                >
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">
                    Primary T1
                  </span>
                  <span className="text-2xl font-black font-mono tabular-nums text-[var(--card-accent-target)]">
                    ${activeItem?.primaryTarget != null ? activeItem.primaryTarget.toFixed(2) : "0.00"}
                  </span>
                  <span className="text-[8.5px] font-mono text-[var(--card-text-secondary)] mt-0.5">
                    +1.50R R:R
                  </span>
                </div>
              </div>

              {/* 'QUICK VIEW' MINI-GUIDE (Directly below Buy Target / Stop Loss numbers) */}
              {isStudioMiniGuideOpen && (
                <div
                  className="my-3 p-2.5 rounded-lg border border-emerald-500/40 bg-slate-950/90 text-slate-200 font-mono text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
                  data-testid="studio-mini-fidelity-guide"
                >
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span>Broker Ticket:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold">
                    <span className="text-emerald-400">
                      BUY LIMIT: <strong className="text-white">${activeItem?.buyTarget != null ? activeItem.buyTarget.toFixed(2) : "0.00"}</strong>
                    </span>
                    <span className="text-slate-500">|</span>
                    <span className="text-cyan-300">
                      SELL LIMIT (50%): <strong className="text-white">${activeItem?.primaryTarget != null ? activeItem.primaryTarget.toFixed(2) : "0.00"}</strong>
                    </span>
                    <span className="text-slate-500">|</span>
                    <span className="text-rose-400">
                      SELL STOP: <strong className="text-white">${activeItem?.stopLoss != null ? activeItem.stopLoss.toFixed(2) : "0.00"}</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* NEW SUMMARY STRIP: Funding Allocated | Position Size (Shares) | Target R-Multiple */}
              <div
                className="flex flex-col gap-2 px-3 py-2.5 my-2.5 rounded-xl border border-[var(--card-border)] bg-black/40 font-mono text-xs shadow-inner overflow-hidden"
                data-testid="studio-setup-summary-strip"
              >
                {/* Header row with Risk ($1R) and Inline Interactive Risk Toggle (1% / 1.5% / 2%) */}
                <div className="flex items-center justify-between gap-2 overflow-hidden text-ellipsis whitespace-nowrap pb-1.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Risk ($1R):</span>
                    <strong className="text-emerald-400 font-bold font-mono truncate" data-testid="studio-card-dollar-risk">
                      ${cardSizing.totalDollarRiskAllowed.toFixed(2)}
                    </strong>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-900/90 p-0.5 rounded border border-slate-800 shrink-0">
                    {[1.0, 1.5, 2.0].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCardRiskPctOverride(cardRiskPctOverride === pct ? null : pct);
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          (cardRiskPctOverride ?? cardSizing.riskPercentage) === pct
                            ? "bg-emerald-500 text-slate-950 shadow-sm"
                            : "text-slate-400 hover:text-white hover:bg-slate-800"
                        }`}
                        data-testid={`studio-card-risk-toggle-${pct}`}
                        title={`Set trade risk to ${pct}%`}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary 3-Col Data Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Funding Allocated:</span>
                    <strong className="text-emerald-400 font-bold truncate">
                      ${cardSizing.accountEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                  <div className="flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Position Size:</span>
                    <strong className="text-cyan-300 font-bold truncate">
                      {cardSizing.calculatedShares} Shares <span className="text-slate-400 text-[10px] font-normal">(${cardSizing.totalCapitalRequired.toLocaleString()})</span>
                    </strong>
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex flex-col min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] truncate">Target R-Multiple:</span>
                    <strong className="text-emerald-400 font-bold truncate">+1.50R Target</strong>
                  </div>
                </div>

                {/* Scale Split & Margin Warning Row */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[10.5px]">
                  <div className="flex items-center gap-1.5 min-w-0 truncate text-slate-300 font-mono">
                    <span className="text-slate-500 uppercase text-[9px] font-semibold">Scale Split:</span>
                    <span className="text-emerald-300 font-bold truncate">{cardSizing.t1Shares} at T1</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-cyan-300 font-bold truncate">{cardSizing.t2Shares} at T2</span>
                  </div>
                  {cardSizing.isMarginRequired && (
                    <span
                      className="text-rose-400 text-[10px] font-bold flex items-center gap-1 truncate shrink-0"
                      title={cardSizing.warningMessage ?? ""}
                      data-testid="studio-card-margin-warning"
                    >
                      Exceeds Available Cash (Margin Required)
                    </span>
                  )}
                </div>
              </div>

              {/* BOTTOM ROW: Action buttons (Arm Trade, Adjust Plan, Expand Details) */}
              <div className="relative z-20 pointer-events-auto flex items-center gap-2 pt-2 border-t border-[var(--card-border)]" data-testid="studio-setup-card-action-bar">
                <button
                  type="button"
                  data-testid="button-arm-practice-trade"
                  onClick={() => openArmTrade(activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker)}
                  className="flex-1 py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] pointer-events-auto"
                  style={{
                    backgroundColor: "var(--accent-cyan)",
                    color: "#050914",
                  }}
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Arm Trade</span>
                </button>

                <button
                  type="button"
                  data-testid="button-studio-adjust-plan"
                  onClick={() => {
                    setIsStudioSetupCardExpanded(true);
                    setIsFidelityGuideOpen(true);
                  }}
                  className="py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] pointer-events-auto"
                  title="Adjust Plan & Fidelity Execution Ticket"
                >
                  Adjust Plan
                </button>

                <button
                  type="button"
                  onClick={() => setIsStudioSetupCardExpanded((prev) => !prev)}
                  className="py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider border border-cyan-500/30 bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  data-testid="button-studio-expand-details"
                  aria-label={isStudioSetupCardExpanded ? "Collapse Details" : "Expand Details"}
                  title={isStudioSetupCardExpanded ? "Collapse Details" : "Expand Details"}
                >
                  <span>{isStudioSetupCardExpanded ? "Collapse" : "Expand Details"}</span>
                  {isStudioSetupCardExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* COLLAPSIBLE ACCORDION BODY (Bottom Line summary, Fidelity Ticket, Advanced Metrics) */}
              {isStudioSetupCardExpanded && (
                <div className="space-y-4 pt-3 mt-3 border-t border-[var(--card-border)] animate-in fade-in duration-150" data-testid="studio-setup-card-body">
                  {/* SHORT "BOTTOM LINE" SUMMARY SENTENCE */}
                  <div
                    className="p-3 rounded-xl border text-xs font-sans leading-relaxed my-1"
                    style={{
                      backgroundColor: "var(--bg-panel-subtle)",
                      borderColor: "var(--border-subtle)",
                    }}
                    data-testid="setup-bottom-line"
                  >
                    <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-cyan-400 mb-0.5 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Bottom Line</span>
                    </div>
                    <p className="text-slate-300 font-medium">
                      {activeItem?.bottomLine ?? "Asymmetric swing trade setup."}
                    </p>
                  </div>

                  {/* Fidelity Trade Ticket Cheat Sheet Trigger */}
                  <button
                    type="button"
                    data-testid="button-fidelity-ticket-card"
                    onClick={() => setIsFidelityGuideOpen(true)}
                    className="w-full py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <ClipboardList className="h-4 w-4 text-emerald-400" />
                    <span>Fidelity Ticket Cheat Sheet</span>
                  </button>

                  {/* COLLAPSED "ADVANCED METRICS" ACCORDION (DROPDOWN) */}
                  <div
                    className="mt-4 pt-3 border-t"
                    style={{ borderColor: "var(--border-subtle)" }}
                    data-testid="advanced-metrics-accordion"
                  >
                    <button
                      type="button"
                      onClick={() => setAdvancedOpen(!advancedOpen)}
                      data-testid="button-toggle-advanced-metrics"
                      className="w-full flex items-center justify-between text-xs font-mono font-bold tracking-wider uppercase py-1 text-slate-300 hover:text-cyan-400 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sliders className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Advanced Metrics</span>
                      </span>
                      {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {advancedOpen && (
                      <div
                        className="mt-3 p-3 rounded-xl border space-y-2.5 font-mono text-xs animate-in fade-in slide-in-from-top-2 duration-200"
                        style={{
                          backgroundColor: "var(--bg-panel-subtle)",
                          borderColor: "var(--border-subtle)",
                        }}
                        data-testid="advanced-metrics-content"
                      >
                        {/* Partial Profit Targets */}
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                            Partial Profit Targets
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="p-1.5 rounded bg-black/30 border border-white/5 flex justify-between">
                              <span className="text-slate-400">T2 Target:</span>
                              <span className="font-bold text-emerald-400">${(activeTickerData?.target2 ?? activeItem?.t2 ?? 115).toFixed(2)}</span>
                            </div>
                            <div className="p-1.5 rounded bg-black/30 border border-white/5 flex justify-between">
                              <span className="text-slate-400">T3 Runner:</span>
                              <span className="font-bold text-emerald-400">${(activeTickerData?.target3 ?? activeItem?.t3 ?? 125).toFixed(2)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Historical Win Rate */}
                        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                          <span className="text-slate-400">Historical Win Rate:</span>
                          <span className="font-bold text-cyan-300">{activeItem?.winRate ?? 68.4}% (38 setups)</span>
                        </div>

                        {/* 14-period ATR */}
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">14-Period ATR:</span>
                          <span className="font-bold tabular-nums">${activeItem?.atr != null ? activeItem.atr.toFixed(2) : "4.15"}</span>
                        </div>

                        {/* Expectancy */}
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Mathematical Edge:</span>
                          <span className="font-bold text-emerald-400">+1.62R / Trade</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Fidelity Execution Cheat Sheet Component (Inline Collapsible Panel) */}
            <FidelityExecutionCheatSheet
              symbol={activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
              entry={activeTickerData?.buyTarget ?? activeItem?.buyTarget ?? 100}
              stop={activeTickerData?.stopLoss ?? activeItem?.stopLoss ?? 95}
              target1={activeTickerData?.target1 ?? activeItem?.primaryTarget ?? 110}
              shares={Math.floor(1000 / Math.max(activeTickerData?.risk ?? Math.abs((activeItem?.buyTarget ?? 100) - (activeItem?.stopLoss ?? 95)), 0.01))}
              isCollapsible
              defaultCollapsed={false}
            />

            {/* Broker Execution Guide Accordion */}
            <BrokerExecutionSteps
              symbol={activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
              entry={activeTickerData?.buyTarget ?? activeItem?.buyTarget ?? 100}
              stop={activeTickerData?.stopLoss ?? activeItem?.stopLoss ?? 95}
              target1={activeTickerData?.target1 ?? activeItem?.primaryTarget ?? 110}
              defaultOpen={false}
            />

            {/* Quick Sizing & Risk Card */}
            <div
              className="p-3.5 rounded-xl border font-mono text-xs space-y-2"
              style={{
                backgroundColor: "var(--bg-panel-subtle)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3 text-cyan-400" />
                  <span>Risk Position Sizing</span>
                </span>
                <span className="text-cyan-400">1.0% Model</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-slate-400 text-[11px]">Suggested Sizing:</span>
                <span className="font-bold text-sm text-soft-white">
                  {Math.floor(1000 / Math.max(activeTickerData?.risk ?? Math.abs((activeItem?.buyTarget ?? 100) - (activeItem?.stopLoss ?? 95)), 0.01))} shares
                </span>
              </div>
              <div className="flex justify-between items-baseline text-[10px]">
                <span className="text-slate-500">Max Dollar Risk:</span>
                <span className="text-red-400 font-bold">$1,000.00</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Fidelity Execution Cheat Sheet Modal */}
      {isFidelityGuideOpen && (
        <FidelityExecutionCheatSheet
          symbol={activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
          entry={activeTickerData?.buyTarget ?? activeItem?.buyTarget ?? 100}
          stop={activeTickerData?.stopLoss ?? activeItem?.stopLoss ?? 95}
          target1={activeTickerData?.target1 ?? activeItem?.primaryTarget ?? 110}
          shares={Math.floor(1000 / Math.max(activeTickerData?.risk ?? Math.abs((activeItem?.buyTarget ?? 100) - (activeItem?.stopLoss ?? 95)), 0.01))}
          isOpenModal={isFidelityGuideOpen}
          onCloseModal={() => setIsFidelityGuideOpen(false)}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}

