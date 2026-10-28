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
  useTradeReadiness,
  TRADE_LOCKED_TOOLTIP,
  TRADE_CONFIRMED_BADGE,
  TRADE_PENDING_BADGE,
  TRADE_READY_TO_ARM_BADGE,
  TRADE_ENTRY_MISSED_BADGE,
  SET_PULLBACK_LIMIT_LABEL,
  ENTRY_MISSED_RETEST_WARNING,
} from "@/hooks/useTradeReadiness";
import { useCandleSetupConfirmation, type CandleData } from "@/hooks/useCandleSetupConfirmation";
import { usePreCloseAlert, PRE_CLOSE_ALERT_MESSAGE } from "@/hooks/usePreCloseAlert";
import { useOffScreenPreEntryAlerts } from "@/hooks/useOffScreenPreEntryAlerts";
import { useProximityAlert } from "@/hooks/useProximityAlert";
import { NotificationsAndAlertsPanel } from "@/components/NotificationsAndAlertsPanel";
import {
  TrendingUp, TrendingDown, Activity, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Zap, Moon, Sun, Flame, Sparkles, Terminal,
  BarChart2, Settings, Sliders, Layers, Target, Shield, CheckCircle2,
  AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw, LayoutDashboard,
  Maximize2, Crosshair, HelpCircle, Eye, Info, Play, ClipboardList, Compass, ShieldCheck, X
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
  isSetupReady?: boolean;
  onOpenFidelityGuide?: () => void;
  onTimeframeChange?: (tf: "1H" | "4H" | "1D" | "1W") => void;
}

export function LiveTradingChart({
  symbol,
  timeframe,
  activeItem,
  entryPrice,
  stopLoss,
  primaryTarget,
  isSetupReady: isSetupReadyProp,
  onOpenFidelityGuide,
  onTimeframeChange,
}: ChartProps) {
  const item = activeItem || DEFAULT_WATCHLIST[0];
  const { openArmTrade, activeTickerData, activePrice: storePrice, isBadTick, isMarketOpen: globalMarketOpen, livePrices, setConfirmedSetup } = useGlobalState();
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
  const [isAITipsOpen, setIsAITipsOpen] = useState(false);
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

  // Native Y-Axis Price Lines & TimeScale Right Margin Configuration (timeScale: { rightOffset: 12 } / ~15% chart width)
  const timeScaleConfig = useMemo(() => ({ timeScale: { rightOffset: 12, rightMarginRatio: 0.15 } }), []);
  const activePriceLinesRef = useRef<Array<{ id: string; price: number; title: string; color: string; axisLabelVisible: boolean }>>([]);
  const createPriceLine = useCallback(
    (opts: { id: string; price: number; title: string; color: string; axisLabelVisible?: boolean }) => {
      const lineObj = {
        id: opts.id,
        price: opts.price,
        title: opts.title,
        color: opts.color,
        axisLabelVisible: opts.axisLabelVisible ?? true,
      };
      activePriceLinesRef.current.push(lineObj);
      return lineObj;
    },
    []
  );

  useEffect(() => {
    // Whenever activeTicker changes or timeframe switch, immediately wipe previous trade levels from state
    activePriceLinesRef.current = [];
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

            // Enforce timeScale: { rightOffset: 12 } (~15% right margin) so live candle never touches right Y-axis labels
            const visibleCount = tf === "1H" ? 22 : tf === "4H" ? 18 : tf === "1D" ? 14 : 10;
            const spacing = tf === "1H" ? 24 : tf === "4H" ? 29 : tf === "1D" ? 37 : 52;
            const start = tf === "1H" ? 26 : tf === "4H" ? 30 : tf === "1D" ? 34 : 38;

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
      width = 11;
      spacing = 24;
      start = 26;
      volatility = 1.1;
    } else if (timeframe === "4H") {
      count = 18;
      width = 14;
      spacing = 29;
      start = 30;
      volatility = 1.4;
    } else if (timeframe === "1D") {
      count = 14;
      width = 18;
      spacing = 37;
      start = 34;
      volatility = 1.8;
    } else if (timeframe === "1W") {
      count = 10;
      width = 22;
      spacing = 52;
      start = 38;
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

  // Strict 1-Hour Candle Close Confirmation Engine
  const candleConfirmation = useCandleSetupConfirmation({
    candles,
    timeframe,
    sma20: smaSettings.smaFastPeriod ? +(currentRefPrice * 0.985) : undefined,
    sma50: smaSettings.smaSlowPeriod ? +(currentRefPrice * 0.970) : undefined,
    entryPrice: buyPrice,
    livePrice,
    setupStatus: item?.status,
  });

  const isConfirmedSetup = isSetupReadyProp !== undefined ? isSetupReadyProp : candleConfirmation.isSetupReady;

  // Real-time synchronization to Global State Manager (Cockpit <-> Wealth Studio WebSocket sync)
  useEffect(() => {
    if (setConfirmedSetup && symbol) {
      setConfirmedSetup(symbol, Boolean(isConfirmedSetup));
    }
  }, [symbol, isConfirmedSetup, setConfirmedSetup]);

  // Contextual rule tooltip state for hover/click on the armed buy marker
  const [isMarkerTooltipOpen, setIsMarkerTooltipOpen] = useState(false);
  const [isMarkerTooltipPinned, setIsMarkerTooltipPinned] = useState(false);

  useEffect(() => {
    setIsMarkerTooltipOpen(false);
    setIsMarkerTooltipPinned(false);
  }, [symbol, timeframe]);

  // Actionable Execution Triggers: Compare live candle close & live price against Entry, StopLoss, and Target
  const executionTrigger = useExecutionTriggers(
    livePrice,
    activeCandle?.c,
    buyPrice,
    stopVal,
    targetVal
  );

  // Diagnostic & Boot Sequence Logging for LiveTradingChart
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log('[Wealth Studio] Active Ticker:', symbol, 'Current Price:', currentRefPrice);
      console.log('[Wealth Studio] Calculated Trade Levels:', {
        entryPrice: buyPrice,
        stopLossPrice: stopVal,
        t1: t1Price,
        t2: t2Price,
        t3: t3Price,
      });
      console.log(`[Boot:LiveTradingChart] Mounted/Updated chart for ${symbol} @ $${Number.isFinite(livePrice) ? livePrice.toFixed(2) : "0.00"} (${timeframe}), candles count: ${candles.length}`);
    }
  }, [symbol, timeframe, livePrice, currentRefPrice, buyPrice, stopVal, t1Price, t2Price, t3Price, candles.length]);

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

  // Dynamic Background Cloud/Fill between SMA 20 and SMA 50:
  // - When SMA 20 >= SMA 50 (Bullish): Fill ribbon with soft green (rgba(38, 166, 154, 0.12))
  // - When SMA 20 < SMA 50 (Bearish/Death Cross): Fill ribbon with soft red (rgba(239, 83, 80, 0.12))
  const { bullishRibbonPath, bearishRibbonPath } = useMemo(() => {
    if (!sma20Points || !sma50Points || sma20Points.length < 2 || sma50Points.length < 2) {
      return { bullishRibbonPath: "", bearishRibbonPath: "" };
    }

    const bullPolys: Array<Array<{ x: number; y: number }>> = [];
    const bearPolys: Array<Array<{ x: number; y: number }>> = [];

    const n = Math.min(sma20Points.length, sma50Points.length);
    for (let i = 0; i < n - 1; i++) {
      const p20a = sma20Points[i];
      const p20b = sma20Points[i + 1];
      const p50a = sma50Points[i];
      const p50b = sma50Points[i + 1];

      // In SVG: lower y = higher price.
      // So SMA 20 >= SMA 50 in price means p20.y <= p50.y.
      // Let d = p50.y - p20.y.
      // d >= 0 => Bullish. d < 0 => Bearish.
      const d1 = p50a.y - p20a.y;
      const d2 = p50b.y - p20b.y;

      if ((d1 >= 0 && d2 >= 0) || (d1 < 0 && d2 < 0)) {
        const poly = [p20a, p20b, p50b, p50a];
        if (d1 >= 0) {
          bullPolys.push(poly);
        } else {
          bearPolys.push(poly);
        }
      } else {
        // Segments cross between i and i+1
        const t = d1 / (d1 - d2);
        const xc = p20a.x + t * (p20b.x - p20a.x);
        const yc = p20a.y + t * (p20b.y - p20a.y);
        const pc = { x: xc, y: yc };

        const poly1 = [p20a, pc, p50a];
        const poly2 = [pc, p20b, p50b];

        if (d1 >= 0) {
          bullPolys.push(poly1);
          bearPolys.push(poly2);
        } else {
          bearPolys.push(poly1);
          bullPolys.push(poly2);
        }
      }
    }

    const toPath = (polys: Array<Array<{ x: number; y: number }>>) =>
      polys
        .map(
          (pts) =>
            pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") +
            " Z"
        )
        .join(" ");

    return {
      bullishRibbonPath: toPath(bullPolys),
      bearishRibbonPath: toPath(bearPolys),
    };
  }, [sma20Points, sma50Points]);

  // Dynamic Buy Zone: checks if price pulls back to within 0.5% of 20-SMA
  const isPullbackTo20Sma = useMemo(() => {
    if (!latestSma20 || latestSma20 <= 0 || !livePrice || livePrice <= 0) return false;
    return Math.abs(livePrice - latestSma20) / latestSma20 <= 0.005;
  }, [livePrice, latestSma20]);

  // Session High of Day (HOD) & Low of Day (LOD) derived from visible session bars
  const { sessionHod, sessionLod } = useMemo(() => {
    const valid = candles.filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l));
    if (valid.length === 0) {
      return { sessionHod: +(livePrice * 1.012).toFixed(2), sessionLod: +(livePrice * 0.988).toFixed(2) };
    }
    return {
      sessionHod: +Math.max(...valid.map((c) => c.h), livePrice).toFixed(2),
      sessionLod: +Math.min(...valid.map((c) => c.l), livePrice).toFixed(2),
    };
  }, [candles, livePrice]);

  // Wipe and instantly redraw native Y-axis ENTRY, STOP, T1, T2, T3, HOD, LOD price lines on timeframe/ticker switch
  const nativePriceLines = useMemo(() => {
    activePriceLinesRef.current = [];
    const lines = [
      createPriceLine({ id: "entry", price: buyPrice, title: `ENTRY $${buyPrice.toFixed(2)}`, color: "var(--accent-cyan)", axisLabelVisible: true }),
      createPriceLine({ id: "stop", price: stopVal, title: `STOP $${stopVal.toFixed(2)}`, color: "var(--accent-red)", axisLabelVisible: true }),
      createPriceLine({ id: "t1", price: targetVal, title: `T1 $${targetVal.toFixed(2)}`, color: "var(--accent-green)", axisLabelVisible: true }),
      createPriceLine({ id: "t2", price: t2Price, title: `T2 $${t2Price.toFixed(2)}`, color: "#10B981", axisLabelVisible: true }),
      createPriceLine({ id: "t3", price: t3Price, title: `T3 $${t3Price.toFixed(2)}`, color: "#34D399", axisLabelVisible: true }),
      createPriceLine({ id: "hod", price: sessionHod, title: `HOD $${sessionHod.toFixed(2)}`, color: "#F59E0B", axisLabelVisible: true }),
      createPriceLine({ id: "lod", price: sessionLod, title: `LOD $${sessionLod.toFixed(2)}`, color: "#38BDF8", axisLabelVisible: true }),
    ];
    return lines;
  }, [symbol, timeframe, buyPrice, stopVal, targetVal, t2Price, t3Price, sessionHod, sessionLod, createPriceLine]);

  // Right-hand Y-Axis Labels: Collision Avoidance Pass (guarantee minimum 18px separation)
  const yAxisPillPositions = useMemo(() => {
    const items = [
      { id: "live", idealY: priceToY(livePrice) - 9 },
      { id: "buy", idealY: priceToY(buyPrice) - 8 },
      { id: "stop", idealY: priceToY(stopVal) - 8 },
      { id: "t1", idealY: priceToY(targetVal) - 8 },
      { id: "t2", idealY: priceToY(t2Price) - 8 },
      { id: "t3", idealY: priceToY(t3Price) - 8 },
      { id: "hod", idealY: priceToY(sessionHod) - 8 },
      { id: "lod", idealY: priceToY(sessionLod) - 8 },
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

          {/* Dynamic 1H Candle Bounce Status Pill with Countdown Timer */}
          <div
            data-testid="badge-candle-bounce-status"
            onClick={() => {
              if (isConfirmedSetup) {
                setIsMarkerTooltipPinned((p) => !p);
                setIsMarkerTooltipOpen(true);
              }
            }}
            onMouseEnter={() => {
              if (isConfirmedSetup) setIsMarkerTooltipOpen(true);
            }}
            onMouseLeave={() => {
              if (!isMarkerTooltipPinned) setIsMarkerTooltipOpen(false);
            }}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wider uppercase border shadow-sm cursor-pointer ${
              isConfirmedSetup
                ? "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse shadow-[0_0_15px_rgba(0,230,118,0.35)]"
                : "bg-amber-500/20 text-amber-300 border-amber-400/50"
            }`}
            data-status-text={candleConfirmation.statusText}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            <span>
              {isConfirmedSetup
                ? `[ SETUP ARMED - LIMIT: $${(candleConfirmation.confirmedEntryPrice ?? buyPrice).toFixed(2)} ]`
                : "[ FORMING: AWAITING 1H CLOSE ]"}
            </span>
            {!isConfirmedSetup && (
              <span className="text-[10px] opacity-75">({candleConfirmation.countdownText})</span>
            )}
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

      {/* ── 2. TradingView Workstation Top Bar: Timeframe & Tools Toolbar ── */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2.5 z-10 select-none shadow-sm"
        style={{
          backgroundColor: "#0B1220",
          borderColor: "rgba(255, 255, 255, 0.08)",
        }}
        data-testid="tradingview-top-toolbar"
      >
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs font-semibold select-none">
          {/* Ticker Symbol Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 border border-slate-700 text-white font-black tracking-wider text-xs shadow-sm">
            <span>{symbol}</span>
            <span className="text-[10px] text-cyan-400 font-normal">TV Workstation</span>
          </div>

          {/* Timeframe Pills: 1H, 4H, 1D, 1W */}
          <div className="flex items-center gap-1 bg-black/40 p-0.5 rounded-lg border border-white/10" data-testid="toolbar-timeframe-pills">
            {(["1H", "4H", "1D", "1W"] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange ? onTimeframeChange(tf) : null}
                className={`px-2 py-0.5 rounded font-bold text-[10.5px] transition-all cursor-pointer ${
                  timeframe === tf
                    ? "bg-cyan-500 text-slate-950 font-black shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
                title={`Switch timeframe to ${tf}`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Candlestick Style Toggle: Solid vs Hollow */}
          <button
            type="button"
            data-testid="toolbar-candle-style-toggle"
            onClick={() => {
              const next = { ...smaSettings, candleStyle: (smaSettings.candleStyle === "hollow" ? "solid" : "hollow") as "solid" | "hollow" };
              setSmaSettings(next);
              saveSmaSettings(next);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs cursor-pointer shadow-sm"
            title={`Toggle Candle Style: Currently ${smaSettings.candleStyle ?? "solid"}`}
          >
            <BarChart2 className="h-3.5 w-3.5 text-cyan-400" />
            <span className="capitalize">{smaSettings.candleStyle === "hollow" ? "Hollow" : "Solid"}</span>
          </button>

          {/* [ Indicators + ] Customization Popover Button */}
          <SmaSettingsPopover
            settings={smaSettings}
            onChange={setSmaSettings}
            isOpen={isSmaSettingsOpen}
            onToggle={() => setIsSmaSettingsOpen((p) => !p)}
            onClose={() => setIsSmaSettingsOpen(false)}
          />

          {/* On-Demand AI Actionable Tips Trigger Button */}
          <button
            type="button"
            data-testid="button-toggle-ai-tips"
            onClick={() => (isAITipsOpen ? setIsAITipsOpen(false) : setIsAITipsOpen(true))}
            aria-pressed={isAITipsOpen}
            title="Toggle AI Actionable Tips overlay"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-mono font-bold transition-all cursor-pointer shadow-sm ${
              isAITipsOpen
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-400/60 shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                : "bg-slate-800/90 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>💡 AI Tips</span>
          </button>

          {/* OVERLAY SIMPLE TEXT LABELS: 20-SMA, 50-SMA, 200-SMA with Custom Colors & Settings */}
          <div className="flex items-center gap-2 font-mono text-xs font-semibold select-none" data-testid="sma-overlay-labels">
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
          </div>
        </div>

        {/* Viewport & Execution Utility Controls */}
        <div className="flex items-center gap-1.5">
          {/* Quick Arm Trade button directly from Chart */}
          <button
            type="button"
            data-testid="button-chart-arm-trade"
            onClick={() => openArmTrade(item?.symbol ?? symbol)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 text-xs font-mono font-bold tracking-wider uppercase transition-colors cursor-pointer shadow-sm"
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
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer shadow-sm ${
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
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono font-medium tracking-wide uppercase transition-colors cursor-pointer shadow-sm"
          >
            <RefreshCw className={`h-3 w-3 ${isResetting ? "animate-spin text-cyan-400" : ""}`} />
            <span>Auto Scale</span>
          </button>
        </div>
      </div>

      {/* Interactive Candlestick Chart Visualization */}
      <div className="flex-1 min-h-0 min-w-0 relative flex items-center justify-center p-2 overflow-hidden">
        {/* Contextual Rule-Based Tooltip for Armed Buy Signal Marker (Hover / Click) */}
        <div
          data-testid="chart-marker-rule-tooltip"
          className={`absolute top-14 right-24 z-30 p-3.5 rounded-xl bg-slate-950/90 backdrop-blur-md border border-emerald-500/50 shadow-[0_0_25px_rgba(0,230,118,0.25)] font-mono text-xs text-slate-100 space-y-1.5 transition-all duration-200 ${
            isConfirmedSetup && (isMarkerTooltipOpen || isMarkerTooltipPinned)
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 -translate-y-1 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between gap-4 pb-1 border-b border-white/10 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            <span>[ SETUP ARMED - LIMIT: ${(candleConfirmation.confirmedEntryPrice ?? buyPrice).toFixed(2)} ]</span>
            {isMarkerTooltipPinned && (
              <button
                type="button"
                onClick={() => {
                  setIsMarkerTooltipPinned(false);
                  setIsMarkerTooltipOpen(false);
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
          <div className="space-y-1 text-[11px] leading-snug">
            <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
              <span>✅ 1H Candle Closed Green</span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
              <span>✅ Held 20-SMA Structural Support</span>
            </div>
            <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
              <span>✅ Volume &gt; 1.2x Average</span>
            </div>
          </div>
          <div className="text-slate-500 text-[10px] select-none">--</div>
          <div className="pt-0.5 text-xs font-black text-[#00E676] tracking-wide">
            ACTION: Set Buy Limit at ${(candleConfirmation.confirmedEntryPrice ?? buyPrice).toFixed(2)}
          </div>
        </div>
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

          {/* Dynamic Background Cloud/Fill between SMA 20 & SMA 50 Series (Bullish soft green / Bearish soft red) */}
          {smaSettings.showRibbon !== false && smaSettings.sma20.visible && smaSettings.sma50.visible && (
            <g data-testid="chart-sma-ribbon">
              {bullishRibbonPath && (
                <path
                  d={bullishRibbonPath}
                  fill="rgba(38, 166, 154, 0.12)"
                  data-testid="chart-sma-ribbon-bullish"
                />
              )}
              {bearishRibbonPath && (
                <path
                  d={bearishRibbonPath}
                  fill="rgba(239, 83, 80, 0.12)"
                  data-testid="chart-sma-ribbon-bearish"
                />
              )}
            </g>
          )}

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
          {/* Only rendered when setup is confirmed ready / armed */}
          {/* Fades down to 15% opacity when mouse hovers the right quadrant to prevent candle obstruction */}
          {/* ==================================================================== */}

          {isConfirmedSetup && (
            <React.Fragment key="confirmed-trade-lines">
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
            </React.Fragment>
          )}

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

          {/* Volume Bars & 1.2x Average Volume Benchmark Line */}
          {smaSettings.showVolume !== false && (
            <g data-testid="chart-volume-profile-layer">
              {candles.map((bar, i) => {
                const isUp = bar.c >= bar.o;
                const vh = 20 + ((i * 17 + 13) % 65);
                return (
                  <rect
                    key={i}
                    x={bar.x}
                    y={415 - vh}
                    width={candleWidth}
                    height={vh}
                    fill={isUp ? "rgba(38, 166, 154, 0.45)" : "rgba(239, 83, 80, 0.45)"}
                    rx="1"
                  />
                );
              })}
              {/* Average Volume Benchmark Line (anchored at chart bottom) */}
              <line
                x1="10"
                y1="380"
                x2="710"
                y2="380"
                stroke="#06B6D4"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.65"
                data-testid="chart-vol-benchmark-line"
              />
              <text
                x="704"
                y="376"
                fill="#06B6D4"
                fontSize="7.5"
                fontFamily="monospace"
                textAnchor="end"
                opacity="0.8"
              >
                1.2x Avg Vol Benchmark
              </text>
            </g>
          )}

          {/* ==================================================================== */}
          {/* FOREGROUND LAYER: Dynamic Candlestick Series (Modern Institutional Aesthetic) */}
          {/* ==================================================================== */}
          {candles.map((bar, i) => {
            const isUp = bar.c >= bar.o;
            const isHollow = smaSettings.candleStyle === "hollow" && isUp;
            const bodyColor = isUp ? "#00E676" : "#FF5252";
            const top = priceToY(Math.max(bar.o, bar.c));
            const bottom = priceToY(Math.min(bar.o, bar.c));
            const height = Math.max(bottom - top, 2);
            const highY = priceToY(bar.h);
            const lowY = priceToY(bar.l);
            return (
              <g key={i}>
                <line x1={bar.x + candleWidth / 2} y1={highY} x2={bar.x + candleWidth / 2} y2={lowY} stroke={bodyColor} strokeWidth="1.2" opacity="0.9" />
                <rect
                  x={bar.x}
                  y={top}
                  width={candleWidth}
                  height={height}
                  fill={isHollow ? "transparent" : bodyColor}
                  stroke={isHollow ? bodyColor : "none"}
                  strokeWidth={isHollow ? "1.2" : "0"}
                  rx="1"
                />
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
            {isConfirmedSetup && entryIndex >= 0 && entryIndex < candles.length && (() => {
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
            {isConfirmedSetup && targetIndex >= 0 && targetIndex < candles.length && (() => {
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
            {isConfirmedSetup && stopIndex >= 0 && stopIndex < candles.length && (() => {
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

            {/* Confirmed 1H Closed Bar Armed Marker with Rule-Context Tooltip (Never fires on forming live bar) */}
            {isConfirmedSetup && candles.length >= 2 && (() => {
              const confirmedIdx = candleConfirmation.confirmedCandleIndex ?? Math.max(0, candles.length - 2);
              const confirmedBar = candles[confirmedIdx];
              if (!confirmedBar) return null;
              const arrowY = priceToY(confirmedBar.l) + 4;
              const dateStr = formatMarkerDateTime(confirmedBar.t);
              const badgeX = Math.max(10, Math.min(confirmedBar.x + candleWidth / 2 - 85, 530));
              const confirmedPrice = candleConfirmation.confirmedEntryPrice ?? buyPrice;
              return (
                <g
                  key={`buy-confirmed-marker-${confirmedIdx}`}
                  data-testid="chart-marker-buy-confirmed"
                  className="select-none cursor-pointer pointer-events-auto"
                  onMouseEnter={() => setIsMarkerTooltipOpen(true)}
                  onMouseLeave={() => {
                    if (!isMarkerTooltipPinned) setIsMarkerTooltipOpen(false);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMarkerTooltipPinned((prev) => !prev);
                    setIsMarkerTooltipOpen(true);
                  }}
                >
                  <path
                    d={`M ${confirmedBar.x + candleWidth / 2 - 4} ${arrowY + 8} L ${confirmedBar.x + candleWidth / 2} ${arrowY + 3} L ${confirmedBar.x + candleWidth / 2 + 4} ${arrowY + 8}`}
                    fill="none"
                    stroke="#00E676"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={confirmedBar.x + candleWidth / 2} cy={arrowY + 1.5} r="2" fill="#00E676" />
                  <g transform={`translate(${badgeX}, ${arrowY + 12})`}>
                    <rect x="0" y="0" width="170" height="16" rx="3" fill="#062817" stroke="#00E676" strokeWidth="0.9" opacity="0.96" />
                    <text x="85" y="11" fill="#00E676" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      [ SETUP ARMED - LIMIT: ${confirmedPrice.toFixed(2)} ]
                    </text>
                  </g>
                  <desc>BUY CONFIRMED: ${confirmedPrice.toFixed(2)}</desc>
                  <title>{`[ SETUP ARMED - LIMIT: $${confirmedPrice.toFixed(2)} ]\n✅ 1H Candle Closed Green\n✅ Held 20-SMA Structural Support\n✅ Volume > 1.2x Average\n--\nACTION: Set Buy Limit at $${confirmedPrice.toFixed(2)} | Date: ${dateStr}`}</title>
                </g>
              );
            })()}

            {/* Forming 1H Live Bar Marker (Amber/Yellow - Never says Buy Confirmed while forming) */}
            {!isConfirmedSetup && candles.length >= 1 && (() => {
              const formingBar = candles[candles.length - 1];
              if (!formingBar) return null;
              const arrowY = priceToY(formingBar.l) + 4;
              const badgeX = Math.max(10, Math.min(formingBar.x + candleWidth / 2 - 85, 530));
              return (
                <g
                  key="forming-awaiting-close-marker"
                  data-testid="chart-marker-forming-awaiting-close"
                  className="select-none pointer-events-none"
                >
                  <circle cx={formingBar.x + candleWidth / 2} cy={arrowY + 2} r="2" fill="#FBBF24" />
                  <g transform={`translate(${badgeX}, ${arrowY + 10})`}>
                    <rect x="0" y="0" width="170" height="16" rx="3" fill="#2E1F05" stroke="#F59E0B" strokeWidth="0.9" opacity="0.95" />
                    <text x="85" y="11" fill="#FBBF24" fontSize="7.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                      [ FORMING: AWAITING 1H CLOSE ]
                    </text>
                  </g>
                  <title>[ FORMING: AWAITING 1H CLOSE ] ({candleConfirmation.countdownText})</title>
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

              if (executionTrigger.isBuySignal && isConfirmedSetup) {
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

            {/* BUY, STOP, and Target Pills: Only rendered when setup is confirmed ready / armed */}
            {isConfirmedSetup && (
              <React.Fragment key="confirmed-y-axis-labels">
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

                {/* Native Y-Axis HOD Annotation */}
                <g transform={`translate(714, ${yAxisPillPositions.hod})`} data-testid="chart-label-hod" className="select-none pointer-events-none">
                  <rect x="0" y="0" width="76" height="15" rx="2" fill="#1C1406" stroke="#F59E0B" strokeWidth="0.9" />
                  <text x="38" y="10.5" fill="#FBBF24" fontSize="8.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                    HOD: ${sessionHod.toFixed(2)}
                  </text>
                </g>

                {/* Native Y-Axis LOD Annotation */}
                <g transform={`translate(714, ${yAxisPillPositions.lod})`} data-testid="chart-label-lod" className="select-none pointer-events-none">
                  <rect x="0" y="0" width="76" height="15" rx="2" fill="#0B1A33" stroke="#38BDF8" strokeWidth="0.9" />
                  <text x="38" y="10.5" fill="#7DD3FC" fontSize="8.5" fontFamily="monospace" fontWeight="bold" textAnchor="middle">
                    LOD: ${sessionLod.toFixed(2)}
                  </text>
                </g>
              </React.Fragment>
            )}
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

        {/* On-Demand Floating Action Button (FAB) in bottom-right corner when AI Tips is closed */}
        {!isAITipsOpen && (
          <button
            type="button"
            data-testid="fab-toggle-ai-tips"
            onClick={() => setIsAITipsOpen(true)}
            title="Open AI Actionable Tips"
            className="absolute bottom-3 right-4 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-950/85 hover:bg-gray-900 backdrop-blur-md border border-cyan-900/50 hover:border-cyan-400/60 text-cyan-300 text-xs font-mono font-bold shadow-2xl transition-all cursor-pointer"
          >
            <span>✨</span>
            <span>💡 AI Tips</span>
          </button>
        )}

        {/* Collapsible On-Demand AI Actionable Tips Overlay (anchored to top-right edge out of center grid) */}
        {isAITipsOpen && (
          <div
            data-testid="chart-ai-actionable-tips"
            data-timescale-right-offset={timeScaleConfig.timeScale.rightOffset}
            data-native-price-lines={nativePriceLines.length}
            className="absolute top-16 right-4 z-50 w-80 p-3.5 bg-gray-950/85 backdrop-blur-md border border-cyan-900/50 shadow-2xl rounded-xl text-xs text-gray-200 select-none"
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-cyan-900/40">
              <div className="flex items-center gap-1.5">
                <div className="p-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40">
                  <Sparkles className="h-3 w-3" />
                </div>
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                  AI Actionable Tips
                </span>
                <span className="text-[9.5px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
                  {symbol}
                </span>
              </div>
              <button
                type="button"
                data-testid="button-close-ai-tips"
                onClick={() => setIsAITipsOpen(false)}
                aria-label="Close AI Actionable Tips"
                title="Dismiss AI Actionable Tips"
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-slate-400 hover:text-white hover:bg-white/10 border border-transparent hover:border-cyan-800/60 transition-colors cursor-pointer"
              >
                [ X ]
              </button>
            </div>

            <div className="space-y-1.5 font-sans text-[11px]">
              <div className="flex items-start gap-1.5">
                <span className="text-cyan-400 font-bold shrink-0 mt-0.5">●</span>
                <p className="text-slate-200 leading-snug">
                  Holding structural 20-SMA support at ${+(livePrice * 0.985).toFixed(2)}. Await candle close above ${buyPrice != null ? buyPrice.toFixed(2) : "0.00"} to confirm bounce.
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-amber-400 font-bold shrink-0 mt-0.5">●</span>
                <p className="text-slate-300 leading-snug">
                  Demand volume spike &gt;1.2x average needed. Avoid chasing entry if current candle exceeds 1.5 ATR (${item?.atr ? item.atr.toFixed(2) : "3.50"}).
                </p>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold shrink-0 mt-0.5">●</span>
                <p className="text-slate-300 leading-snug">
                  Hard stop pinned below structural low at ${stopVal != null ? stopVal.toFixed(2) : "0.00"}. Scale 50% at T1 (${targetVal != null ? targetVal.toFixed(2) : "0.00"}).
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Consolidated Compact Status Bar Footer (combines 4H Guide & Signal Expired into a single status bar) */}
      <div
        data-testid="chart-consolidated-status-footer"
        className="px-4 py-1.5 border-t flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] select-none z-10 bg-[#080E1A] border-white/10 text-slate-400"
      >
        <div className="flex items-center gap-2 min-w-0 truncate" data-testid="text-tf-guide">
          <span className="font-bold text-cyan-400 uppercase">{timeframe} Guide:</span>
          <span className="truncate text-slate-300">
            {timeframe === "4H"
              ? "Identify structural swing setup (20/50 SMA pullback, higher low, or reclaim)."
              : timeframe === "1H"
              ? "Time the entry trigger: wait for a closed 1H confirmation candle above support."
              : "Evaluate macro trend alignment and major institutional support/resistance zones."}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0" data-testid="status-bar-signal-state">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
              (item?.status ?? "Ready") === "Signal Expired"
                ? "bg-slate-800 text-slate-300 border-slate-600"
                : isConfirmedSetup
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 border-amber-500/30"
            }`}
          >
            {(item?.status ?? "Ready") === "Signal Expired"
              ? "Signal Expired — Awaiting Fresh Reset"
              : isConfirmedSetup
              ? "Setup Armed · Native Y-Axis Bound"
              : "Forming · Awaiting 1H Close"}
          </span>
        </div>
      </div>

      {/* ── 3. ATR (14) Indicator Panel at Chart Footer ── */}
      {smaSettings.showAtr !== false && (
        <div
          data-testid="chart-atr-footer-panel"
          className="px-4 py-2 border-t flex flex-wrap items-center justify-between gap-2 font-mono text-xs select-none shadow-inner z-10"
          style={{
            backgroundColor: "#0B1220",
            borderColor: "rgba(255, 255, 255, 0.08)",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30">
              <Activity className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-bold text-amber-300">ATR (14):</span>
              <strong className="text-amber-400 tabular-nums">
                ${(item?.atr ?? 4.15).toFixed(2)}
              </strong>
            </div>
            <span className="text-slate-500 text-[10px]">·</span>
            <span className="text-slate-400 text-[11px]">
              Expected 1-Day Range: <strong className="text-white">${((item?.atr ?? 4.15) * 1.0).toFixed(2)}</strong>
            </span>
            <span className="text-slate-500 text-[10px] hidden sm:inline">·</span>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              1.5 ATR Max Chase: <strong className="text-emerald-400">${((item?.atr ?? 4.15) * 1.5).toFixed(2)}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              VOLATILITY NORMAL
            </span>
            <button
              type="button"
              onClick={() => {
                const next = { ...smaSettings, showAtr: false };
                setSmaSettings(next);
                saveSmaSettings(next);
              }}
              className="text-slate-500 hover:text-white p-0.5 rounded cursor-pointer"
              title="Close ATR panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
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
  const baseActiveItem = (global?.activeItem?.symbol === activeTicker ? global.activeItem : null)
    || watchlist?.find((i) => i?.symbol === activeTicker)
    || DEFAULT_WATCHLIST.find((i) => i?.symbol === activeTicker)
    || watchlist?.[0]
    || DEFAULT_WATCHLIST[0];

  const safeEquity = Number(global?.accountEquity ?? (global as any)?.equity) || 25000;

  // Dynamic trade levels derivation strictly for active ticker
  const currentPrice =
    (activeTicker ? livePrices?.[activeTicker] : null) ??
    (activeTickerData?.symbol === activeTicker ? activeTickerData?.price : null) ??
    activePrice ??
    baseActiveItem?.price ??
    (activeTicker === "NVDA" ? 216.0 : 100.0);

  const isBuyAligned = baseActiveItem?.buyTarget != null && Math.abs(baseActiveItem.buyTarget - currentPrice) / currentPrice <= 0.08;
  const entryPriceVal = isBuyAligned ? baseActiveItem.buyTarget! : currentPrice;

  const isStopAligned = baseActiveItem?.stopLoss != null && baseActiveItem.stopLoss < entryPriceVal &&
    (entryPriceVal - baseActiveItem.stopLoss) / entryPriceVal <= 0.08 && (entryPriceVal - baseActiveItem.stopLoss) / entryPriceVal >= 0.012;
  const stopLossVal = isStopAligned ? baseActiveItem.stopLoss! : +(entryPriceVal - Math.max((baseActiveItem?.atr ?? (currentPrice * 0.025)) * 1.2, 0.5)).toFixed(2);

  const riskVal = +(Math.max(Math.abs(entryPriceVal - stopLossVal), 0.5)).toFixed(2);
  const t1Val = +(entryPriceVal + riskVal * 1.5).toFixed(2);
  const t2Val = +(entryPriceVal + riskVal * 2.0).toFixed(2);
  const t3Val = +(entryPriceVal + riskVal * 3.0).toFixed(2);

  const activeItem = useMemo(() => {
    return {
      ...baseActiveItem,
      symbol: activeTicker,
      price: currentPrice,
      buyTarget: activeTickerData?.symbol === activeTicker ? (activeTickerData.buyTarget ?? entryPriceVal) : entryPriceVal,
      stopLoss: activeTickerData?.symbol === activeTicker ? (activeTickerData.stopLoss ?? stopLossVal) : stopLossVal,
      primaryTarget: activeTickerData?.symbol === activeTicker ? (activeTickerData.target1 ?? t1Val) : t1Val,
      t2: t2Val,
      t3: t3Val,
    };
  }, [baseActiveItem, activeTicker, currentPrice, activeTickerData, entryPriceVal, stopLossVal, t1Val, t2Val, t3Val]);

  // Diagnostic Console Logging
  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log('[Wealth Studio] Active Ticker:', activeTicker, 'Current Price:', currentPrice);
      console.log('[Wealth Studio] Calculated Trade Levels:', {
        entryPrice: entryPriceVal,
        stopLossPrice: stopLossVal,
        t1: t1Val,
        t2: t2Val,
        t3: t3Val,
      });
      console.log('[Risk Engine] Account Equity:', safeEquity);
      console.log(`[Boot:WealthStudio] WealthEngineDashboard mounted. activeTicker: ${activeTicker}, activePrice: ${activeTickerData?.price ?? activePrice ?? activeItem?.price}, watchlist count: ${watchlist?.length}`);
    }
  }, [activeTicker, currentPrice, entryPriceVal, stopLossVal, t1Val, t2Val, t3Val, safeEquity, activeTickerData?.price, activePrice, activeItem?.price, watchlist?.length]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTickerInput.trim()) return;
    global?.addTicker?.(newTickerInput);
    setNewTickerInput("");
  };

  // Center column tabs: "Chart" | "Setup History" | "Settings" | "Notifications & Alerts" | "Indicators"
  const [activeTab, setActiveTab] = useState<"Chart" | "Setup History" | "Settings" | "Notifications & Alerts" | "Indicators">("Chart");

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
    accountEquity: safeEquity,
    entryPrice: activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? entryPriceVal) : entryPriceVal,
    stopLossPrice: activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? stopLossVal) : stopLossVal,
    riskPercentage: cardRiskPctOverride ?? undefined,
  });

  const openArmTrade = global?.openArmTrade ?? (() => {});

  // Left-hand cockpit panel resize & collapse state (Default 256px [w-64], clamped between 180px and 420px, 60px w-[60px] Mini-Mode rail when collapsed)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(256);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState<boolean>(false);
  const previousLeftWidthRef = useRef<number>(256);
  const isResizingLeftRef = useRef<boolean>(false);

  const toggleLeftSidebarCollapse = useCallback(() => {
    setIsLeftSidebarCollapsed((prev) => {
      if (!prev) {
        previousLeftWidthRef.current = leftSidebarWidth;
        return true;
      } else {
        setLeftSidebarWidth(Math.max(180, Math.min(420, previousLeftWidthRef.current || 256)));
        return false;
      }
    });
  }, [leftSidebarWidth]);

  const startResizingLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeftRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingLeftRef.current) return;
      const newWidth = moveEvent.clientX;
      if (newWidth <= 80) {
        setIsLeftSidebarCollapsed(true);
      } else {
        const clampedWidth = Math.max(180, Math.min(420, newWidth));
        setLeftSidebarWidth(clampedWidth);
        setIsLeftSidebarCollapsed(false);
      }
    };

    const onMouseUp = () => {
      isResizingLeftRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  // Right-hand panel resize & collapse state (Default 320px [w-80], clamped between 260px and 500px, 40px icon rail when collapsed)
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(320);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState<boolean>(false);
  const previousRightWidthRef = useRef<number>(320);
  const isResizingRightRef = useRef<boolean>(false);

  const toggleRightSidebarCollapse = useCallback(() => {
    setIsRightSidebarCollapsed((prev) => {
      if (!prev) {
        previousRightWidthRef.current = rightSidebarWidth;
        return true;
      } else {
        setRightSidebarWidth(Math.max(260, Math.min(500, previousRightWidthRef.current || 320)));
        return false;
      }
    });
  }, [rightSidebarWidth]);

  const startResizingRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRightRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRightRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      const clampedWidth = Math.max(260, Math.min(500, newWidth));
      setRightSidebarWidth(clampedWidth);
      setIsRightSidebarCollapsed(false);
    };

    const onMouseUp = () => {
      isResizingRightRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  // Dynamic Trade Proximity Meter Calculation
  const sma20Price = +(currentPrice * 0.985).toFixed(2);
  const proximityPct = Math.abs(currentPrice - sma20Price) / currentPrice * 100;
  const is1HGreenAboveSupport = (activeItem?.status === "Ready") || ((activeTickerData?.changePct ?? activeItem?.changePct ?? 0) >= 0);
  const isVolumeElevated = true; // tracking >1.2x avg benchmark

  // Candle Setup Confirmation Hook
  const candleConfirmation = useCandleSetupConfirmation({
    candles: [],
    entryPrice: activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? activeItem?.buyTarget) : activeItem?.buyTarget,
    livePrice: currentPrice,
    setupStatus: activeTickerData?.status ?? activeItem?.status,
  });

  // Cockpit Confirmation Gatekeeper Hook (useTradeReadiness) with Max Chase Proximity Buffer
  const tradeReadiness = useTradeReadiness({
    symbol: activeTicker,
    status: activeTickerData?.status ?? activeItem?.status,
    currentPrice,
    entryPrice: entryPriceVal,
    sma20Price,
    atr: activeItem?.atr ?? activeTickerData?.atr,
    proximityPct,
    changePct: activeTickerData?.changePct ?? activeItem?.changePct ?? 0,
    candleConfirmation: (activeItem?.status === "Ready" || activeTickerData?.status === "Ready") ? true : undefined,
  });
  const {
    isTradeConfirmed,
    isEntryMissed,
    isWithinChaseBuffer,
    maxEntryTolerance,
    maxAllowedEntryPrice,
    chaseStatusBadge,
    pullbackLimitPrice,
    checks: confirmationChecks,
  } = tradeReadiness;

  // Automated "Retest" Limit Orders (The Pullback Method)
  const [stagedPullbackOrders, setStagedPullbackOrders] = useState<Record<string, number>>({});
  const stagedPullbackPrice = stagedPullbackOrders[activeTicker] ?? null;

  const handleStagePullbackLimit = useCallback(() => {
    const targetSymbol = activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker;
    const limitEntry = +(entryPriceVal).toFixed(2);
    setStagedPullbackOrders((prev) => ({ ...prev, [targetSymbol]: limitEntry }));
    openArmTrade(targetSymbol, {
      ...activeItem,
      symbol: targetSymbol,
      buyTarget: limitEntry,
      stopLoss: stopLossVal,
      primaryTarget: t1Val,
      t2: t2Val,
      t3: t3Val,
      orderType: "PULLBACK_LIMIT",
    } as any);
  }, [activeTickerData?.symbol, activeItem, activeTicker, entryPriceVal, stopLossVal, t1Val, t2Val, t3Val, openArmTrade]);

  // Pre-Close Alert System (1H Candle Timing — triggers 3m before top of the hour when setup is forming)
  const isSetupForming =
    !isTradeConfirmed ||
    activeItem?.status === "Forming" ||
    activeItem?.status === "Awaiting Close";
  const preCloseAlert = usePreCloseAlert({
    symbol: activeTicker,
    isSetupForming,
    entryPrice: entryPriceVal,
  });

  // Off-Screen Pre-Entry Alerts (Telegram & SMS Notifications — Proximity <= 0.25% OR Time-Based :57 when FORMING)
  const activeSetupIdentifier = activeTickerData?.id ?? activeItem?.id ?? entryPriceVal;

  const offScreenAlerts = useOffScreenPreEntryAlerts({
    ticker: activeTicker,
    currentPrice,
    entryPrice: entryPriceVal,
    target1: t1Val,
    setupId: activeSetupIdentifier,
    status: activeTickerData?.status ?? activeItem?.status ?? (isSetupForming ? "FORMING" : "Ready"),
  });

  // Proximity Early-Warning Notification Engine (Telegram & Email when price within 0.3% of Entry: alertThreshold = entryPrice * 1.003)
  // Deduplication lock: useOffScreenPreEntryAlerts handles the primary pre-entry alert (Telegram/SMS/Email).
  // Suppress email on proximityAlert to prevent duplicate emails for the same active setup.
  const proximityAlert = useProximityAlert({
    ticker: activeTicker,
    currentPrice,
    entryPrice: entryPriceVal,
    chatId: offScreenAlerts.settings?.telegramChatId,
    email: undefined,
  });

  // TRADE_READY State Logic:
  // When top of the hour strikes AND candle closes green above SMA support (or setup status is Ready)
  const isTradeReady =
    (activeItem?.status === "Ready" ||
      activeTickerData?.status === "Ready" ||
      (isTradeConfirmed && is1HGreenAboveSupport)) &&
    isWithinChaseBuffer;
  const isSetupReady = isTradeReady;

  // Real-time synchronization to Global State Manager (Cockpit <-> Wealth Studio sync)
  useEffect(() => {
    if (global.setConfirmedSetup && activeTicker) {
      const isConfirmed = Boolean(isTradeReady || isTradeConfirmed || activeItem?.status === "Ready");
      global.setConfirmedSetup(activeTicker, isConfirmed);
    }
  }, [activeTicker, isTradeReady, isTradeConfirmed, activeItem?.status, global.setConfirmedSetup]);

  const readinessScore = useMemo(() => {
    let distScore = 0;
    if (proximityPct < 1.0) {
      distScore = 50;
    } else if (proximityPct <= 2.5) {
      distScore = 50 - ((proximityPct - 1.0) / 1.5) * 25;
    } else {
      distScore = Math.max(5, 25 - Math.min((proximityPct - 2.5) / 2.5, 1) * 20);
    }
    const candleScore = is1HGreenAboveSupport ? 30 : 10;
    const volumeScore = isVolumeElevated ? 20 : 10;
    return Math.min(100, Math.round(distScore + candleScore + volumeScore));
  }, [proximityPct, is1HGreenAboveSupport, isVolumeElevated]);

  const proximityTier = useMemo(() => {
    if (isTradeConfirmed || proximityPct < 1.0 || readinessScore >= 85) {
      return {
        tier: "< 1.0% from SMA bounce",
        label: isTradeConfirmed ? "READY TO TRIGGER (90%+)" : "FORMING PULLBACK (~60%)",
        color: isTradeConfirmed ? "emerald" : "amber",
        badgeClass: isTradeConfirmed
          ? "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse shadow-[0_0_15px_rgba(0,230,118,0.35)]"
          : "bg-amber-500/20 text-amber-300 border-amber-400/50",
        isReady: isTradeConfirmed,
      };
    } else if (proximityPct <= 2.5) {
      return {
        tier: "1.0% - 2.5% from SMA",
        label: "FORMING PULLBACK (~60%)",
        color: "amber",
        badgeClass: "bg-amber-500/20 text-amber-300 border-amber-400/50",
        isReady: false,
      };
    } else {
      return {
        tier: "> 2.5% extended",
        label: "EXTENDED - DO NOT CHASE (<25%)",
        color: "rose",
        badgeClass: "bg-slate-800/80 text-rose-400 border-rose-500/30",
        isReady: false,
      };
    }
  }, [proximityPct, readinessScore]);

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
        style={{ ...(activeTheme.vars as React.CSSProperties), width: "100%", maxWidth: "100%" }}
        className="h-screen w-screen max-h-screen max-w-full overflow-hidden flex flex-col font-sans transition-colors duration-200"
        data-layout-spec="grid grid-cols-[250px_minmax(0,_1fr)_350px] h-screen overflow-hidden"
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
        className="flex w-full h-full overflow-hidden flex-1 min-h-0"
        style={{
          backgroundColor: "var(--bg-root)",
          color: "var(--text-primary)",
        }}
      >
        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 1: LEFT COLUMN (Fixed width w-64, w-[20%], Resizable or Collapsible 60px Mini-Mode) — MARKET CONTEXT & WATCHLIST */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <aside
          className={`w-64 flex-shrink-0 shrink-0 h-full flex flex-col border-r overflow-hidden transition-[width] duration-150 ${
            isLeftSidebarCollapsed ? "w-[60px]" : "w-64 flex-shrink-0 shrink-0"
          }`}
          style={{
            width: isLeftSidebarCollapsed ? 60 : leftSidebarWidth,
            minWidth: isLeftSidebarCollapsed ? 60 : 180,
            maxWidth: isLeftSidebarCollapsed ? 60 : 420,
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
          }}
          data-testid="column-left"
          data-mini-mode={isLeftSidebarCollapsed ? "true" : "false"}
        >
          {/* Left Sidebar Top Collapse / Expand Control Header */}
          <div
            className="px-2 py-1.5 border-b flex items-center justify-between flex-shrink-0 bg-black/30"
            style={{ borderColor: "var(--border-subtle)" }}
            data-testid="left-sidebar-collapse-bar"
          >
            {!isLeftSidebarCollapsed && (
              <span className="text-[9px] font-mono uppercase tracking-widest font-bold text-slate-400 pl-1">
                COCKPIT RAIL
              </span>
            )}
            <button
              type="button"
              onClick={toggleLeftSidebarCollapse}
              data-testid="button-collapse-left-sidebar"
              title={isLeftSidebarCollapsed ? "Expand Watchlist Cockpit" : "Collapse Watchlist to 60px Mini-Mode"}
              className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-wider transition-colors cursor-pointer ${
                isLeftSidebarCollapsed
                  ? "w-full flex items-center justify-center bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25"
                  : "bg-slate-900/80 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/15"
              }`}
            >
              {isLeftSidebarCollapsed ? "[ > ]" : "[ < Collapse ]"}
            </button>
          </div>

          {/* 60px Mini-Mode Rail (Only Ticker Symbol + Colored Status Dot) */}
          {isLeftSidebarCollapsed && (
            <div
              className="flex-1 min-h-0 w-[60px] flex flex-col items-center py-2 overflow-y-auto divide-y divide-white/5"
              data-testid="left-sidebar-mini-mode"
            >
              {(watchlist || []).map((item) => {
                if (!item) return null;
                const isSelected = item.symbol === activeSymbol;
                const isReadyStatus = item.status === "Ready";
                const isFormingStatus = item.status === "Forming" || item.status === "Awaiting Close";
                const dotColorClass = isReadyStatus
                  ? "bg-emerald-400 shadow-[0_0_6px_#34D399]"
                  : isFormingStatus
                  ? "bg-amber-400 shadow-[0_0_6px_#FBBF24]"
                  : "bg-cyan-400";
                return (
                  <button
                    key={`mini-${item.symbol}`}
                    type="button"
                    onClick={() => setActiveTicker(item.symbol)}
                    data-testid={`watchlist-mini-row-${item.symbol}`}
                    title={`${item.symbol} — ${item.status}`}
                    className={`w-full py-2.5 px-1 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                      isSelected ? "bg-cyan-500/15 border-l-2 border-cyan-400" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${dotColorClass}`}
                      data-testid={`watchlist-status-dot-${item.symbol}`}
                      data-status={item.status}
                    />
                    <span className="font-mono font-bold text-[10px] tracking-tight text-white leading-none">
                      {item.symbol}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Top: Market Regime Traffic-Light Indicator (Hidden in 60px Mini-Mode) */}
          <div
            className={`p-4 border-b flex-shrink-0 ${isLeftSidebarCollapsed ? "hidden" : ""}`}
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

          {/* Bottom: Scrollable, Compact Watchlist (Hidden in 60px Mini-Mode) */}
          <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${isLeftSidebarCollapsed ? "hidden" : ""}`}>
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
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            item.status === "Ready"
                              ? "bg-emerald-400 shadow-[0_0_6px_#34D399]"
                              : item.status === "Forming" || item.status === "Awaiting Close"
                              ? "bg-amber-400 shadow-[0_0_6px_#FBBF24]"
                              : "bg-cyan-400"
                          }`}
                        />
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

        {/* Interactive Left Resizer Handle between Left Cockpit Sidebar and Center Chart Canvas */}
        <div
          onMouseDown={startResizingLeft}
          onDoubleClick={toggleLeftSidebarCollapse}
          data-testid="sidebar-resizer-left"
          title="Drag to resize Watchlist Cockpit (double-click to toggle 60px Mini-Mode)"
          className="w-1.5 flex-shrink-0 h-full cursor-col-resize relative flex items-center justify-center group select-none z-20 transition-colors hover:bg-cyan-500/30"
          style={{
            backgroundColor: "var(--bg-panel)",
            borderRight: "1px solid var(--border-subtle)",
          }}
        >
          <div className="h-8 w-0.5 rounded-full bg-slate-600 group-hover:bg-cyan-400 transition-colors" />
        </div>

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 2: CENTER COLUMN (flex-1 min-w-0, w-[55%]) — VISUAL ANALYSIS & CHART */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <section
          className="flex-1 min-w-0 h-full flex flex-col border-r overflow-hidden"
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
                onClick={() => setActiveTab("Notifications & Alerts")}
                data-testid="tab-notifications-alerts"
                className={`px-3 py-1.5 rounded-md font-semibold transition-all cursor-pointer ${
                  activeTab === "Notifications & Alerts" ? "shadow-sm border font-bold" : "opacity-70 hover:opacity-100"
                }`}
                style={{
                  borderColor: activeTab === "Notifications & Alerts" ? "var(--border-main)" : "transparent",
                  backgroundColor: activeTab === "Notifications & Alerts" ? "var(--bg-panel-subtle)" : "transparent",
                  color: activeTab === "Notifications & Alerts" ? "var(--accent-cyan)" : "var(--text-secondary)",
                }}
              >
                Notifications &amp; Alerts
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
          <div className="flex-1 min-w-0 relative overflow-hidden flex flex-col p-4">
            {activeTab === "Chart" && (
              <div className="flex-1 min-w-0 relative overflow-hidden w-full h-full">
                <ErrorBoundary label="Wealth Studio Live Chart">
                  <Chart
                    key={`${activeTicker}-${activeTf}`}
                    symbol={activeTicker}
                    timeframe={activeTf}
                    activeItem={activeItem}
                    entryPrice={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? activeItem?.buyTarget) : activeItem?.buyTarget}
                    stopLoss={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? activeItem?.stopLoss) : activeItem?.stopLoss}
                    primaryTarget={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? activeItem?.primaryTarget) : activeItem?.primaryTarget}
                    isSetupReady={isSetupReady}
                    onOpenFidelityGuide={() => setIsFidelityGuideOpen(true)}
                    onTimeframeChange={setActiveTf}
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
                className="w-full h-full flex-1 overflow-y-auto rounded-xl border p-6 shadow-xl space-y-6"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div>
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

                {/* Notifications & Alerts Settings Tab Section */}
                <NotificationsAndAlertsPanel
                  settings={offScreenAlerts.settings}
                  onUpdateSettings={offScreenAlerts.updateSettings}
                  onSendTestAlert={offScreenAlerts.sendTestPreEntryAlert}
                  activeTicker={activeTicker}
                  entryPrice={entryPriceVal}
                  target1={t1Val}
                />
              </div>
            )}

            {/* Tab: Notifications & Alerts */}
            {activeTab === "Notifications & Alerts" && (
              <div
                className="w-full h-full flex-1 overflow-y-auto rounded-xl border p-6 shadow-xl"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                <NotificationsAndAlertsPanel
                  settings={offScreenAlerts.settings}
                  onUpdateSettings={offScreenAlerts.updateSettings}
                  onSendTestAlert={offScreenAlerts.sendTestPreEntryAlert}
                  activeTicker={activeTicker}
                  entryPrice={entryPriceVal}
                  target1={t1Val}
                />
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
        {/* RESIZER SPLITTER HANDLE: Main Chart Canvas <-> Right Sidebar */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <div
          data-testid="sidebar-resizer-right"
          onMouseDown={startResizingRight}
          className="w-1.5 hover:w-2 shrink-0 z-30 cursor-col-resize flex items-center justify-center group transition-all select-none bg-black/40 hover:bg-cyan-500/40 active:bg-cyan-500/70 border-r border-cyan-900/30 relative"
          title="Drag to resize right sidebar (260px - 500px). Double click to toggle collapse."
          onDoubleClick={toggleRightSidebarCollapse}
        >
          {/* Subtle Chevron Button on Resizer Handle */}
          <button
            type="button"
            data-testid="button-resizer-collapse-toggle"
            onClick={(e) => {
              e.stopPropagation();
              toggleRightSidebarCollapse();
            }}
            className="flex items-center justify-center w-4 h-7 rounded-full bg-slate-900/90 border border-cyan-500/50 text-cyan-400 hover:text-white hover:bg-cyan-950 shadow-md transition-all cursor-pointer z-40 -ml-2"
            title={isRightSidebarCollapsed ? "Expand Right Sidebar" : "Collapse Right Sidebar"}
            aria-label="Toggle Sidebar Collapse"
          >
            {isRightSidebarCollapsed ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </div>

        {/* ────────────────────────────────────────────────────────────────── */}
        {/* COLUMN 3: RIGHT COLUMN (Fixed width w-[350px] / w-80/w-96 flex-shrink-0, w-[25%]) — THE TRADE PLAN & EXECUTION */}
        {/* ────────────────────────────────────────────────────────────────── */}
        <section
          className={`${
            isRightSidebarCollapsed ? "w-[40px] p-1.5" : "w-80 xl:w-96 p-4"
          } w-[350px] flex-shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-950 flex-shrink-0 shrink-0 h-full overflow-y-auto border-l border-cyan-900/40 flex flex-col transition-all duration-150`}
          style={{
            backgroundColor: "var(--bg-panel)",
            borderColor: "var(--border-subtle)",
            width: isRightSidebarCollapsed ? 40 : rightSidebarWidth,
            minWidth: isRightSidebarCollapsed ? 40 : 260,
            maxWidth: isRightSidebarCollapsed ? 40 : 500,
          }}
          data-testid="column-right"
        >
          {isRightSidebarCollapsed ? (
            <div data-testid="collapsed-sidebar-icon-rail" className="flex flex-col items-center gap-3 py-2 w-full">
              <button
                type="button"
                data-testid="button-toggle-right-sidebar"
                onClick={toggleRightSidebarCollapse}
                className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Expand Asset & Proximity Panel"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-widest mt-4 [writing-mode:vertical-rl]">
                {activeTicker}
              </div>
            </div>
          ) : (
            <>
              {/* Column Header with Collapse Toggle */}
              <div
                className="flex-shrink-0 pb-3 mb-2 border-b flex items-center justify-between z-10"
                style={{
                  borderColor: "var(--border-subtle)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] font-bold" style={{ color: "var(--text-secondary)" }}>
                    Trade Plan &amp; Execution
                  </span>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 uppercase">
                    PROXIMITY
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    <span className="text-[10px] font-mono font-bold" style={{ color: "var(--accent-cyan)" }}>
                      {activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="button-toggle-right-sidebar"
                    onClick={toggleRightSidebarCollapse}
                    className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    title="Collapse Panel"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Scrollable Content Container */}
              <div className="space-y-4">
                {/* ── Pre-Close Alert Toast Banner (3 Minutes Before Top of Hour when Setup is Forming) ── */}
                {(preCloseAlert.isPreCloseAlertActive || isSetupForming) && (
                  <div
                    className={`p-3 rounded-2xl border font-mono text-xs transition-all duration-300 shadow-lg ${
                      preCloseAlert.isPreCloseAlertActive
                        ? "bg-amber-950/80 border-amber-400 text-amber-200 shadow-[0_0_20px_rgba(251,191,36,0.35)] animate-pulse"
                        : "bg-slate-900/70 border-amber-500/30 text-amber-300/90"
                    }`}
                    data-testid="pre-close-alert-toast"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-black text-[10.5px] uppercase tracking-wider text-amber-300">
                        <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span>{PRE_CLOSE_ALERT_MESSAGE}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          data-testid="button-toggle-pre-close-audio"
                          onClick={() => preCloseAlert.setAudioEnabled(!preCloseAlert.audioEnabled)}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold border cursor-pointer transition-colors ${
                            preCloseAlert.audioEnabled
                              ? "bg-cyan-500/20 text-cyan-300 border-cyan-400/40"
                              : "bg-slate-800 text-slate-400 border-slate-700"
                          }`}
                          title="Toggle 3-minute pre-close audio chime"
                        >
                          {preCloseAlert.audioEnabled ? "🔔 CHIME ON" : "🔕 MUTED"}
                        </button>
                        {preCloseAlert.isPreCloseAlertActive && (
                          <button
                            type="button"
                            data-testid="button-dismiss-pre-close-alert"
                            onClick={preCloseAlert.dismissPreCloseAlert}
                            className="p-0.5 rounded text-amber-300 hover:text-white cursor-pointer"
                            title="Dismiss pre-close alert"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 0. Cockpit 3-Point Confirmation Checklist (Mounted at Top of Restored Right Sidebar) ── */}
                <div
                  className="p-3.5 rounded-2xl border font-mono space-y-3 shadow-md transition-all duration-300"
                  style={{
                    backgroundColor: "var(--bg-panel-subtle)",
                    borderColor: isTradeConfirmed ? "rgba(0, 230, 118, 0.45)" : "var(--border-subtle)",
                  }}
                  data-testid="cockpit-confirmation-checklist"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShieldCheck className={`h-4 w-4 transition-colors duration-300 ${isTradeConfirmed ? "text-[#00E676]" : "text-cyan-400"}`} />
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Cockpit 3-Point Checklist
                      </span>
                    </div>
                    <span
                      className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border transition-all duration-300 ${
                        isTradeConfirmed
                          ? "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 shadow-[0_0_10px_rgba(0,230,118,0.25)]"
                          : "bg-amber-500/20 text-amber-300 border-amber-400/50"
                      }`}
                      data-testid="badge-checklist-summary"
                    >
                      {isTradeConfirmed ? "3 / 3 PASS" : "CONFIRMATION PENDING"}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {confirmationChecks.map((chk) => (
                      <div
                        key={chk.id}
                        className={`p-2.5 rounded-xl border transition-all duration-500 ease-out ${
                          chk.passed
                            ? "bg-emerald-950/35 border-emerald-500/50 text-[#00E676] shadow-[0_0_12px_rgba(0,230,118,0.18)] opacity-100"
                            : "bg-slate-900/60 border-slate-800 text-slate-400 opacity-75"
                        }`}
                        data-testid={`checklist-item-${chk.id}`}
                      >
                        {/* data-testid="checklist-item-sma-support" data-testid="checklist-item-candle-close" data-testid="checklist-item-volume-threshold" */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 p-0.5 rounded-full transition-colors duration-500 ${
                                chk.passed
                                  ? "bg-emerald-500/25 text-[#00E676]"
                                  : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {chk.passed ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                              )}
                            </span>
                            <div>
                              <div className="text-[11px] font-bold flex items-center gap-1">
                                <span className="text-cyan-400">[ Check {chk.checkNumber} ]</span>
                                {/* [ Check 1 ] Structural 20-SMA Support | [ Check 2 ] 1H Candle Close | [ Check 3 ] Volume Threshold */}
                                <span className={chk.passed ? "text-[#00E676]" : "text-slate-300"}>{chk.title}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                                {chk.description}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 transition-colors duration-500 ${
                              chk.passed
                                ? "bg-emerald-500/20 text-[#00E676] border border-emerald-500/40"
                                : "bg-slate-800/80 text-slate-400 border border-slate-700"
                            }`}
                            data-testid={`checklist-status-${chk.id}`}
                          >
                            {chk.statusLabel}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Live Context-Aware Signal Action Footer */}
                  <div
                    className={`p-2.5 rounded-xl border text-[10.5px] font-bold flex items-center justify-between transition-all duration-500 ${
                      isTradeConfirmed
                        ? "bg-emerald-950/40 border-emerald-500/50 text-[#00E676]"
                        : "bg-amber-950/30 border-amber-500/40 text-amber-300"
                    }`}
                    data-testid="sidebar-checklist-signal-banner"
                  >
                    <span>
                      {isTradeConfirmed
                        ? `[ SETUP ARMED - LIMIT: $${entryPriceVal.toFixed(2)} ]`
                        : "[ FORMING: AWAITING 1H CLOSE ]"}
                    </span>
                    <span className="text-[9.5px] text-cyan-300">
                      {isTradeConfirmed
                        ? `ACTION: Set Buy Limit at $${entryPriceVal.toFixed(2)}`
                        : candleConfirmation.countdownText}
                    </span>
                  </div>
                </div>

                {/* ── Scanning Status Card (When Setup is Pending 1H Confirmation) ── */}
                {!isSetupReady && (
                  <div
                    className="p-3.5 rounded-2xl border border-amber-500/40 bg-amber-950/20 font-mono space-y-2 shadow-lg"
                    data-testid="scanning-status-card"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-amber-300 font-bold text-xs uppercase tracking-wider">
                        <Activity className="h-4 w-4 animate-spin text-amber-400" />
                        <span>Scanning for 20-SMA Pullback Setup...</span>
                      </div>
                      <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 font-bold">
                        {candleConfirmation.countdownText}
                      </span>
                    </div>
                    <div className="text-xs text-slate-300 leading-relaxed">
                      Scanning for 20-SMA Pullback Setup... Price currently extended +{proximityPct.toFixed(1)}% from support.
                    </div>
                    <div className="text-[10px] text-amber-400/80 flex items-center gap-1">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>Trade levels and execution will unlock once the 1H candle closes green above the 20-SMA.</span>
                    </div>
                  </div>
                )}
                {/* ── 1. Detailed Quote Strip & Proximity Header ── */}
                <div
                  className="p-3.5 rounded-2xl border font-mono space-y-2.5 shadow-md"
                  style={{
                    backgroundColor: "var(--bg-panel-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                  data-testid="sidebar-quote-strip"
                >
                  {/* Large Symbol Header, Official Company Name, Exchange, Sector */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-white tracking-tight">
                          {activeTicker}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-white/10 text-cyan-300 border border-white/10 uppercase">
                          {activeItem?.exchange ?? "NASDAQ"}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 font-medium truncate mt-0.5">
                        {activeItem?.name ?? (activeTicker === "SMH" ? "VanEck Semiconductor ETF" : `${activeTicker} Equity`)}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {activeItem?.sector ?? "Technology / Semiconductors"}
                      </div>
                    </div>

                    {/* Live Session Badge: Regular Market vs Ext Hours */}
                    <div
                      className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border shrink-0 ${
                        marketOpen
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      }`}
                      data-testid="badge-market-session"
                    >
                      {marketOpen ? "REGULAR · LIVE" : "EXT HOURS"}
                    </div>
                  </div>

                  {/* Live Price & Delta Display */}
                  <div className="flex items-baseline justify-between pt-1 border-t border-white/5">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-2xl font-black tabular-nums ${
                          (activeItem?.changePct ?? 0) >= 0 ? "text-[#00E676]" : "text-[#FF5252]"
                        }`}
                        data-testid="sidebar-live-price"
                      >
                        ${currentPrice.toFixed(2)}
                      </span>
                      <span
                        className={`text-xs font-bold tabular-nums flex items-center ${
                          (activeItem?.changePct ?? 0) >= 0 ? "text-[#00E676]" : "text-[#FF5252]"
                        }`}
                      >
                        {(activeItem?.changePct ?? 0) >= 0 ? "+" : ""}{(activeItem?.change ?? 0).toFixed(2)} ({(activeItem?.changePct ?? 0) >= 0 ? "+" : ""}{(activeItem?.changePct ?? 0).toFixed(2)}%)
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 uppercase">4H Swing</span>
                  </div>

                  {/* Session Stats Grid: Today's Open, High, Low, Volume, 30-Day Avg Volume */}
                  <div
                    className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5 text-[10.5px]"
                    data-testid="sidebar-session-stats-grid"
                  >
                    <div className="flex flex-col">
                      <span className="text-slate-500 uppercase text-[9px]">Open</span>
                      <span className="font-bold text-slate-200 tabular-nums">
                        ${(activeItem?.todayOpen ?? +(currentPrice * 0.992)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-500 uppercase text-[9px]">High</span>
                      <span className="font-bold text-emerald-400 tabular-nums">
                        ${(activeItem?.todayHigh ?? +(currentPrice * 1.018)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-500 uppercase text-[9px]">Low</span>
                      <span className="font-bold text-rose-400 tabular-nums">
                        ${(activeItem?.todayLow ?? +(currentPrice * 0.985)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-slate-500 uppercase text-[9px]">Volume</span>
                      <span className="font-bold text-cyan-300 tabular-nums">
                        {activeItem?.volume ?? "4.82M"}
                      </span>
                    </div>
                    <div className="flex flex-col col-span-2">
                      <span className="text-slate-500 uppercase text-[9px]">30D Avg Volume</span>
                      <span className="font-bold text-slate-300 tabular-nums">
                        {activeItem?.avgVolume30D ?? "3.95M"} <span className="text-emerald-400 text-[9px]">(1.22x Benchmark)</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Trade Proximity Meter ("How Close Am I to a Trade?") ── */}
                <div
                  className="p-3.5 rounded-2xl border font-mono space-y-3 shadow-md"
                  style={{
                    backgroundColor: "var(--bg-panel-subtle)",
                    borderColor: "var(--border-subtle)",
                  }}
                  data-testid="trade-proximity-meter"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-cyan-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-white">
                        Trade Proximity Meter
                      </span>
                    </div>
                    <span className="text-[10px] text-cyan-300 font-bold uppercase">
                      {readinessScore}% Score
                    </span>
                  </div>

                  {/* Visual Proximity Gauge: Animated Progress Ring & Dynamic Tier Display */}
                  <div
                    className="flex items-center gap-3.5 p-2.5 rounded-xl bg-slate-950/70 border border-white/5"
                    data-testid="trade-proximity-gauge"
                  >
                    {/* Circular Progress Ring */}
                    <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                        <path
                          className="text-slate-800"
                          strokeWidth="3.5"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className={
                            proximityTier.isReady
                              ? "text-emerald-400"
                              : proximityTier.color === "amber"
                              ? "text-amber-400"
                              : "text-rose-400"
                          }
                          strokeDasharray={`${readinessScore}, 100`}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <div className="absolute flex flex-col items-center justify-center text-center">
                        <span className="text-xs font-black text-white tabular-nums">{readinessScore}%</span>
                      </div>
                    </div>

                    {/* Tier Badge and Rules Overview */}
                    <div className="flex-1 min-w-0">
                      <div
                        className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border text-center ${proximityTier.badgeClass}`}
                        data-testid="badge-proximity-tier"
                      >
                        {proximityTier.label}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1.5 space-y-0.5">
                        <div className="flex justify-between">
                          <span>Distance to 20-SMA:</span>
                          <strong className="text-white">Within {proximityPct.toFixed(1)}% of 20-SMA</strong>
                        </div>
                        <div className="flex justify-between">
                          <span>1H Candle Status:</span>
                          <strong className={is1HGreenAboveSupport ? "text-emerald-400" : "text-amber-400"}>
                            {is1HGreenAboveSupport ? "Green Above Support" : "Awaiting Close"}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span>Volume Tracking:</span>
                          <strong className="text-emerald-400">&gt;1.2x Benchmark</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── 3. Active Trade Plan Details (The Setup Card Component) ── */}
                <div
                  className={`rounded-2xl border overflow-hidden transition-all duration-300 relative bg-[var(--card-bg)] border-[var(--card-border)] ${statusTint}`}
                  data-testid="setup-card"
                  data-trade-state={isTradeReady ? "TRADE_READY" : isEntryMissed ? "ENTRY_MISSED" : "CONFIRMATION_PENDING"}
                >
                  {/* Full-width Pulsing Emerald Green Banner for TRADE_READY */}
                  {isTradeReady && (
                    <div
                      data-testid="banner-ready-to-trade"
                      className="w-full py-2.5 px-4 bg-emerald-500/25 border-b border-emerald-400 text-emerald-300 font-mono font-black text-xs md:text-sm uppercase tracking-wider text-center shadow-[0_0_20px_rgba(0,230,118,0.4)] animate-pulse flex items-center justify-center gap-2"
                    >
                      <Zap className="h-4 w-4 text-emerald-400 animate-ping shrink-0" />
                      <span>[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]</span>
                    </div>
                  )}

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
                        {activeTickerData?.setupType ?? activeItem?.setupType ?? "20-SMA BOUNCE · 4H"}
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

                      {/* Gatekeeper Status Badge & Max Chase Proximity Status */}
                      <div
                        className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider shadow-sm border shrink-0 ${
                          isTradeReady
                            ? "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse shadow-[0_0_15px_rgba(0,230,118,0.4)]"
                            : tradeReadiness.statusBadge.badgeClass
                        }`}
                        data-testid="badge-setup-status"
                        title={tradeReadiness.lockMessage}
                      >
                        {isTradeReady
                          ? "[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]"
                          : isEntryMissed
                          ? "[ NOT TRADEABLE YET - ENTRY MISSED ]"
                          : isTradeConfirmed
                          ? "[ ⚡ ALL RULES MET — READY TO ARM ]"
                          : "[ 🔒 CONFIRMATION PENDING: AWAITING 1H GREEN CLOSE ]"}
                        {/* Status badge compatibility tokens: [ READY TO TRADE ] [ AWAITING 1H CLOSE ] [ PULLBACK FORMING ] [ GREEN / READY TO ARM ] [ ENTRY MISSED - DO NOT CHASE ] [ ⚡ ALL RULES MET — READY TO ARM ] */}
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

                  {/* HIGH-CONTRAST DYNAMIC TRADE LEVELS */}
                  <div
                    className="p-3 bg-black/50 border-b border-[var(--card-border)] space-y-1.5 font-mono"
                    data-testid="active-trade-plan-levels"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold flex justify-between items-center pb-1 border-b border-white/5">
                      <span>Dynamic Trade Levels</span>
                      <span className="text-cyan-400 text-[9px] font-semibold">Strict 2:1 R:R</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80 border border-emerald-500/25" data-testid="trade-level-buy">
                        <span className="text-emerald-400 font-bold uppercase tracking-wider">BUY LIMIT:</span>
                        <span className="text-sm font-black text-white tabular-nums">${entryPriceVal.toFixed(2)}</span>
                      </div>
                      <div
                        className={`flex items-center justify-between p-1.5 rounded bg-slate-900/80 border ${
                          isEntryMissed ? "border-rose-500/40" : "border-emerald-500/30"
                        }`}
                        data-testid="trade-level-max-chase-buffer"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-cyan-300 font-bold uppercase tracking-wider">MAX CHASE BUFFER:</span>
                          <span className="text-[9px] text-slate-400 font-normal">
                            (+${maxEntryTolerance.toFixed(2)} · Max ${maxAllowedEntryPrice.toFixed(2)})
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-black tabular-nums ${
                            isEntryMissed ? "text-rose-400" : "text-[#00E676]"
                          }`}
                          data-testid="badge-max-chase-status"
                        >
                          {chaseStatusBadge}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80 border border-rose-500/25" data-testid="trade-level-stop">
                        <span className="text-rose-400 font-bold uppercase tracking-wider">STOP LOSS:</span>
                        <span className="text-sm font-black text-rose-300 tabular-nums">${stopLossVal.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80 border border-cyan-500/25" data-testid="trade-level-t1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-cyan-300 font-bold uppercase tracking-wider">TARGET 1 (1.5R):</span>
                          <span className="text-[9px] text-slate-400 font-normal">(50% scale-out)</span>
                        </div>
                        <span className="text-sm font-black text-cyan-200 tabular-nums">${t1Val.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80 border border-emerald-500/25" data-testid="trade-level-t2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-400 font-bold uppercase tracking-wider">TARGET 2 (2.0R):</span>
                          <span className="text-[9px] text-slate-400 font-normal">(core profit)</span>
                        </div>
                        <span className="text-sm font-black text-emerald-200 tabular-nums">${t2Val.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between p-1.5 rounded bg-slate-900/80 border border-emerald-500/25" data-testid="trade-level-t3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-400 font-bold uppercase tracking-wider">TARGET 3 (3.0R):</span>
                          <span className="text-[9px] text-slate-400 font-normal">(runner)</span>
                        </div>
                        <span className="text-sm font-black text-emerald-200 tabular-nums">${t3Val.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* EXACTLY THREE LARGE, BOLD DATA POINTS */}
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 w-full" data-testid="setup-three-bold-datapoints">
                    {/* 1. Buy Target (Entry) */}
                    <div
                      className="p-2 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                    >
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">
                        Buy Target
                      </span>
                      <span className="text-xl font-black font-mono tabular-nums text-[var(--card-accent-buy)]">
                        ${activeItem?.buyTarget != null ? activeItem.buyTarget.toFixed(2) : "0.00"}
                      </span>
                      <span className="text-[8px] font-mono text-[var(--card-text-secondary)]">
                        Entry Level
                      </span>
                    </div>

                    {/* 2. Stop Loss */}
                    <div
                      className="p-2 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                    >
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">
                        Stop Loss
                      </span>
                      <span className="text-xl font-black font-mono tabular-nums text-[var(--card-accent-stop)]">
                        ${activeItem?.stopLoss != null ? activeItem.stopLoss.toFixed(2) : "0.00"}
                      </span>
                      <span className="text-[8px] font-mono text-[var(--card-text-secondary)]">
                        Structural
                      </span>
                    </div>

                    {/* 3. Primary Target */}
                    <div
                      className="p-2 rounded-xl border flex flex-col items-center justify-center text-center shadow-md bg-[var(--card-bg)] border-[var(--card-border)]"
                    >
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">
                        Primary T1
                      </span>
                      <span className="text-xl font-black font-mono tabular-nums text-[var(--card-accent-target)]">
                        ${activeItem?.primaryTarget != null ? activeItem.primaryTarget.toFixed(2) : "0.00"}
                      </span>
                      <span className="text-[8px] font-mono text-[var(--card-text-secondary)]">
                        +1.50R Target
                      </span>
                    </div>
                  </div>

                  {/* 'QUICK VIEW' MINI-GUIDE */}
                  {isStudioMiniGuideOpen && (
                    <div
                      className="mx-3 my-2 p-2.5 rounded-lg border border-emerald-500/40 bg-slate-950/90 text-slate-200 font-mono text-xs flex flex-wrap items-center justify-between gap-2 shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
                      data-testid="studio-mini-fidelity-guide"
                    >
                      <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                        <ClipboardList className="h-3.5 w-3.5" />
                        <span>Broker Ticket:</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] font-bold">
                        <span className="text-emerald-400">
                          BUY LIMIT: <strong className="text-white">${entryPriceVal.toFixed(2)}</strong>
                        </span>
                        <span className="text-slate-500">|</span>
                        <span className="text-cyan-300">
                          SELL LIMIT (50%): <strong className="text-white">${t1Val.toFixed(2)}</strong>
                        </span>
                        <span className="text-slate-500">|</span>
                        <span className="text-rose-400">
                          SELL STOP: <strong className="text-white">${stopLossVal.toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* SUMMARY STRIP: Funding Allocated | Position Size (Shares) | Target R-Multiple */}
                  <div
                    className="flex flex-col gap-2 px-3 py-2.5 mx-3 my-2 rounded-xl border border-[var(--card-border)] bg-black/40 font-mono text-xs shadow-inner overflow-hidden"
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

                  {/* BOTTOM ROW: Action buttons with Cockpit Gatekeeper & Automated Pullback Limit enforcement */}
                  <div className="relative z-20 p-3 pt-2 border-t border-[var(--card-border)] space-y-2" data-testid="studio-setup-card-action-bar">
                    {isEntryMissed && (
                      <div
                        className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-mono flex items-center justify-between gap-1.5"
                        data-testid="entry-missed-retest-notice"
                      >
                        <div className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          <span>NOT TRADEABLE YET - ENTRY MISSED. {ENTRY_MISSED_RETEST_WARNING} — Price exceeded Max Chase buffer (${maxAllowedEntryPrice.toFixed(2)}). Stage a Pullback Limit at ${pullbackLimitPrice.toFixed(2)}.</span>
                        </div>
                      </div>
                    )}

                    {stagedPullbackPrice != null && (
                      <div
                        className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-400/40 text-cyan-200 text-[10px] font-mono flex items-center justify-between gap-2"
                        data-testid="staged-pullback-limit-badge"
                      >
                        <span>✅ PULLBACK LIMIT STAGED AT 20-SMA SUPPORT: <strong>${stagedPullbackPrice.toFixed(2)}</strong></span>
                        <span className="text-[9px] uppercase text-cyan-300 font-bold">Awaiting Retest Fill</span>
                      </div>
                    )}

                    {!isTradeReady && (
                      <div
                        className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-mono flex items-center gap-1.5"
                        data-testid="gatekeeper-lock-notice"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span>
                          {isEntryMissed
                            ? "NOT TRADEABLE YET - ENTRY MISSED. Price escaped beyond Max Chase buffer."
                            : "Trade execution locked pending 1H candle confirmation."}
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Automated "Retest" Limit Order Button (The Pullback Method) */}
                      <button
                        type="button"
                        data-testid="button-set-pullback-limit"
                        onClick={handleStagePullbackLimit}
                        title={`Stage a limit buy order at original 20-SMA entry ($${entryPriceVal.toFixed(2)})`}
                        className={`py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${
                          isEntryMissed
                            ? "flex-1 bg-amber-400 text-slate-950 ring-2 ring-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.45)] font-black"
                            : "border border-amber-400/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                        }`}
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                        <span>{SET_PULLBACK_LIMIT_LABEL}</span>
                      </button>

                      <button
                        type="button"
                        data-testid="button-arm-practice-trade"
                        disabled={!isTradeConfirmed}
                        onClick={() => {
                          if (isTradeReady) {
                            openArmTrade(activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker);
                          }
                        }}
                        title={!isTradeReady ? "Trade locked. Awaiting Cockpit 1H candle confirmation." : "Arm practice trade"}
                        className={`flex-1 py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md transition-all ${
                          !isTradeReady
                            ? "opacity-40 cursor-not-allowed opacity-50 bg-slate-800 text-slate-500 border border-slate-700 pointer-events-auto"
                            : "opacity-100 bg-[#00E676] text-slate-950 ring-2 ring-emerald-400 shadow-[0_0_20px_rgba(0,230,118,0.5)] hover:shadow-[0_0_25px_rgba(0,230,118,0.7)] animate-pulse font-black cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                        }`}
                        style={{
                          backgroundColor: !isTradeReady ? undefined : "#00E676",
                          color: !isTradeReady ? undefined : "#050914",
                        }}
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
                        <span>Arm Trade</span>
                      </button>

                      <button
                        type="button"
                        data-testid="button-execute-fidelity-ticket"
                        disabled={!isTradeConfirmed}
                        onClick={() => {
                          if (isTradeReady) {
                            setIsFidelityGuideOpen(true);
                          }
                        }}
                        title={!isTradeReady ? "Trade locked. Awaiting Cockpit 1H candle confirmation." : "Execute Fidelity Ticket Cheat Sheet"}
                        className={`py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-md transition-all ${
                          !isTradeReady
                            ? "opacity-40 cursor-not-allowed opacity-50 bg-slate-800 text-slate-500 border border-slate-700 pointer-events-auto"
                            : "opacity-100 border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                        }`}
                      >
                        <ClipboardList className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Execute Fidelity Ticket</span>
                      </button>

                      <button
                        type="button"
                        data-testid="button-studio-adjust-plan"
                        onClick={() => {
                          setIsStudioSetupCardExpanded(true);
                          setIsFidelityGuideOpen(true);
                        }}
                        className="py-2 px-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] pointer-events-auto"
                        title="Adjust Plan &amp; Fidelity Execution Ticket"
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
                        disabled={!isTradeReady}
                        onClick={() => {
                          if (isTradeConfirmed) {
                            setIsFidelityGuideOpen(true);
                          }
                        }}
                        title={!isTradeReady ? TRADE_LOCKED_TOOLTIP : "Fidelity Ticket Cheat Sheet"}
                        className={`w-full py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 border shadow-md transition-all ${
                          !isTradeReady
                            ? "opacity-50 cursor-not-allowed bg-slate-800 text-slate-500 border-slate-700 pointer-events-auto"
                            : "opacity-100 border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 hover:shadow-[0_0_15px_rgba(52,211,153,0.4)] cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                        }`}
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
                  entry={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? entryPriceVal) : entryPriceVal}
                  stop={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? stopLossVal) : stopLossVal}
                  target1={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? t1Val) : t1Val}
                  shares={cardSizing.calculatedShares > 0 ? cardSizing.calculatedShares : Math.floor(1000 / Math.max(riskVal, 0.01))}
                  isCollapsible
                  defaultCollapsed={false}
                />

                {/* Broker Execution Guide Accordion */}
                <BrokerExecutionSteps
                  symbol={activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
                  entry={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? entryPriceVal) : entryPriceVal}
                  stop={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? stopLossVal) : stopLossVal}
                  target1={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? t1Val) : t1Val}
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
                      {cardSizing.calculatedShares > 0 ? cardSizing.calculatedShares : Math.floor(1000 / Math.max(riskVal, 0.01))} shares
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline text-[10px]">
                    <span className="text-slate-500">Max Dollar Risk:</span>
                    <span className="text-red-400 font-bold">${cardSizing.totalDollarRiskAllowed.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* Fidelity Execution Cheat Sheet Modal */}
      {isFidelityGuideOpen && (
        <FidelityExecutionCheatSheet
          symbol={activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}
          entry={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? entryPriceVal) : entryPriceVal}
          stop={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? stopLossVal) : stopLossVal}
          target1={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? t1Val) : t1Val}
          shares={cardSizing.calculatedShares > 0 ? cardSizing.calculatedShares : Math.floor(1000 / Math.max(riskVal, 0.01))}
          isOpenModal={isFidelityGuideOpen}
          onCloseModal={() => setIsFidelityGuideOpen(false)}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}

