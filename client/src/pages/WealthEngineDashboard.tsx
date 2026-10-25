import { BrokerExecutionSteps } from "@/components/BrokerExecutionSteps";
import React, { useState, useEffect, useMemo } from "react";
import { useFeedConnection } from "@/lib/priceFeed";
import { useLiveQuote } from "@/lib/useLivePrices";
import { Link } from "wouter";
import { useGlobalState } from "@/lib/globalState";
import { TradingTipsCard } from "@/components/swing/TradingTipsCard";
import {
  TrendingUp, TrendingDown, Activity, ChevronDown, ChevronUp, Zap, Moon, Sun, Flame, Sparkles, Terminal,
  BarChart2, Settings, Sliders, Layers, Target, Shield, CheckCircle2,
  AlertTriangle, ArrowUpRight, ArrowDownRight, RefreshCw, LayoutDashboard,
  Maximize2, Crosshair, HelpCircle, Eye, Info, Play
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
// MOCK MARKET DATA & INTERFACES
// ============================================================================
export interface WatchlistItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  sparkline: number[];
  status: "Ready" | "Awaiting Close" | "Forming" | "Retest";
  setupType: string;
  buyTarget: number;
  stopLoss: number;
  primaryTarget: number;
  bottomLine: string;
  winRate: number;
  atr: number;
  t2: number;
  t3: number;
}

export const DEFAULT_WATCHLIST: WatchlistItem[] = [
  {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    price: 138.50,
    change: 3.32,
    changePct: 2.45,
    sparkline: [132, 133.5, 131, 134, 136, 135.5, 137, 138.5],
    status: "Ready",
    setupType: "HIGHER-LOW CONSOLIDATION · 1H",
    buyTarget: 138.50,
    stopLoss: 132.80,
    primaryTarget: 152.00,
    bottomLine: "High-probability consolidation holding the 20-SMA with a 2.37R reward-to-risk ratio. Triggered and ready for execution.",
    winRate: 68.4,
    atr: 4.15,
    t2: 158.40,
    t3: 165.00,
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    price: 492.30,
    change: 4.15,
    changePct: 0.85,
    sparkline: [484, 486, 485, 488, 490, 489, 491, 492.3],
    status: "Ready",
    setupType: "20-SMA BOUNCE · 4H",
    buyTarget: 492.50,
    stopLoss: 485.60,
    primaryTarget: 508.80,
    bottomLine: "Tech benchmark holding key 4H moving average support. Favorable asymmetric setup pointing toward multi-week highs.",
    winRate: 72.1,
    atr: 5.60,
    t2: 516.00,
    t3: 525.00,
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    price: 582.40,
    change: 2.90,
    changePct: 0.50,
    sparkline: [577, 578, 576, 579, 581, 580, 581.5, 582.4],
    status: "Awaiting Close",
    setupType: "BREAKOUT RETEST · DAILY",
    buyTarget: 583.10,
    stopLoss: 576.40,
    primaryTarget: 598.50,
    bottomLine: "Testing prior all-time high resistance level converted to support. Wait for hourly candle close confirmation above $583.10.",
    winRate: 64.0,
    atr: 4.90,
    t2: 605.00,
    t3: 615.00,
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 232.15,
    change: -1.25,
    changePct: -0.54,
    sparkline: [235, 234, 236, 233, 232, 233.5, 231, 232.15],
    status: "Forming",
    setupType: "FLAT BASE PULLBACK · 4H",
    buyTarget: 234.80,
    stopLoss: 228.40,
    primaryTarget: 248.00,
    bottomLine: "Consolidating near the 50-day SMA. Pattern remains in development; awaiting volume expansion before arming trade.",
    winRate: 61.5,
    atr: 3.20,
    t2: 254.50,
    t3: 262.00,
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc.",
    price: 218.40,
    change: 7.80,
    changePct: 3.70,
    sparkline: [204, 208, 206, 212, 215, 213, 217, 218.4],
    status: "Ready",
    setupType: "V-RUN RECLAIM · 1H",
    buyTarget: 219.00,
    stopLoss: 209.50,
    primaryTarget: 242.00,
    bottomLine: "High momentum momentum reclaim through prior pivot high. Asymmetry favored for swing momentum continuation.",
    winRate: 59.2,
    atr: 8.75,
    t2: 252.00,
    t3: 265.00,
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp.",
    price: 428.90,
    change: 1.10,
    changePct: 0.26,
    sparkline: [425, 426, 424, 427, 429, 427.5, 428, 428.9],
    status: "Awaiting Close",
    setupType: "20-SMA BOUNCE · 1H",
    buyTarget: 430.00,
    stopLoss: 423.50,
    primaryTarget: 445.00,
    bottomLine: "Healthy retracement back into the 20-period moving average band. Needs clean 1H bar close to confirm bounce.",
    winRate: 66.8,
    atr: 4.80,
    t2: 452.00,
    t3: 460.00,
  },
  {
    symbol: "AMD",
    name: "Advanced Micro Devices",
    price: 156.70,
    change: -2.10,
    changePct: -1.32,
    sparkline: [161, 160, 158, 159, 157, 158.5, 155, 156.7],
    status: "Forming",
    setupType: "DOUBLE BOTTOM SUPPORT · 4H",
    buyTarget: 159.20,
    stopLoss: 152.00,
    primaryTarget: 174.00,
    bottomLine: "Testing macro horizontal demand zone. Monitor for bullish reversal hammer candle before placing orders.",
    winRate: 58.0,
    atr: 5.10,
    t2: 182.00,
    t3: 190.00,
  },
  {
    symbol: "META",
    name: "Meta Platforms",
    price: 594.20,
    change: 8.60,
    changePct: 1.47,
    sparkline: [580, 584, 582, 588, 591, 589, 592, 594.2],
    status: "Ready",
    setupType: "TRENDLINE RECLAIM · 1H",
    buyTarget: 595.00,
    stopLoss: 584.00,
    primaryTarget: 622.00,
    bottomLine: "Clean trendline break with heavy volume support. Risk defined tightly below structural swing low.",
    winRate: 70.3,
    atr: 11.20,
    t2: 635.00,
    t3: 650.00,
  },
];

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
}

export function LiveTradingChart({
  symbol,
  timeframe,
  activeItem,
  entryPrice,
  stopLoss,
  primaryTarget,
}: ChartProps) {
  const item = activeItem || DEFAULT_WATCHLIST[0];
  const { openArmTrade, activePrice: storePrice, isBadTick } = useGlobalState();
  const { quote } = useLiveQuote(symbol);
  const { state: feedState } = useFeedConnection();

  const buyPrice = entryPrice ?? item?.buyTarget ?? 100;
  const stopVal = stopLoss ?? item?.stopLoss ?? (item?.price ? item.price * 0.95 : 95);
  const targetVal = primaryTarget ?? item?.primaryTarget ?? (item?.price ? item.price * 1.1 : 110);

  // 1. Single Source of Truth for Live Price (Synchronized directly with Watchlist)
  const [livePrice, setLivePrice] = useState(item?.price ?? storePrice ?? 100);

  // Synchronize immediately when active ticker or watchlist price updates
  useEffect(() => {
    if (item?.price != null && Number.isFinite(item.price)) {
      setLivePrice(item.price);
    }
  }, [symbol, item?.price]);

  // Synchronize with incoming live quote stream with Bad-Tick Outlier Filtering
  useEffect(() => {
    if (quote?.price != null && Number.isFinite(quote.price)) {
      const ref = item?.price ?? livePrice;
      // 2. Bad Tick Outlier Rejection: Drop ticks deviating more than 3.5% from watchlist price
      const isOutlier = isBadTick ? isBadTick(symbol, quote.price) : (ref > 0 && Math.abs(quote.price - ref) / ref > 0.035);
      if (isOutlier) {
        console.warn(`[LiveTradingChart:BadTick] Dropped outlier tick for ${symbol}: $${quote.price} vs ref $${ref} (>3.5% deviation)`);
        return;
      }
      setLivePrice(quote.price);
    }
  }, [quote?.price, item?.price, symbol, isBadTick, livePrice]);

  // Smooth live-trading micro-tick updater (simulates subtle real-time movement around single source of truth)
  useEffect(() => {
    const timer = setInterval(() => {
      setLivePrice((prev) => {
        const base = item?.price ?? storePrice ?? 100;
        const tick = (Math.random() - 0.49) * 0.06;
        const next = +(prev + tick).toFixed(2);
        // Strict boundary: never drift more than 0.5% from base watchlist price
        if (Math.abs(next - base) > base * 0.005) return base;
        return next;
      });
    }, 2400);
    return () => clearInterval(timer);
  }, [symbol, item?.price, storePrice]);

  // 4. Chart Reset and Auto-Scaling Function
  const [isResetting, setIsResetting] = useState(false);
  const [fetchedBars, setFetchedBars] = useState<Array<{ o: number; h: number; l: number; c: number; x: number }> | null>(null);

  const resetChartData = useCallback(async (sym = symbol) => {
    setIsResetting(true);
    try {
      // Clear current candlestick series and re-fetch clean historical 1H candles via REST API
      const res = await fetch(`/api/candles-ohlc/${encodeURIComponent(sym)}?interval=1H`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const ref = item?.price ?? 100;
          // Filter outliers from historical bars
          const clean = data.map((b: any, idx: number) => {
            const o = Number(b.open ?? b.o ?? ref);
            const h = Number(b.high ?? b.h ?? ref);
            const l = Number(b.low ?? b.l ?? ref);
            const c = Number(b.close ?? b.c ?? ref);
            return { o, h, l, c, x: 40 + idx * 30 };
          }).filter((b: any) => Number.isFinite(b.c) && b.c > 0 && Math.abs(b.c - ref) / ref < 0.20);

          if (clean.length >= 5) {
            setFetchedBars(clean.slice(-18));
          }
        }
      }
    } catch (e) {
      console.warn("[LiveTradingChart] resetChartData fetch failed:", e);
    } finally {
      setIsResetting(false);
    }
  }, [symbol, item?.price]);

  // Trigger resetChartData on active ticker switch
  useEffect(() => {
    setFetchedBars(null);
    resetChartData(symbol);
  }, [symbol]);

  // Trigger resetChartData on recovery from stale feed
  const prevFeedState = useRef(feedState);
  useEffect(() => {
    if (prevFeedState.current === "STALE" && feedState === "LIVE") {
      console.info("[LiveTradingChart] Feed recovered from STALE -> LIVE. Auto-resetting and scaling chart.");
      resetChartData(symbol);
    }
    prevFeedState.current = feedState;
  }, [feedState, symbol, resetChartData]);

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
  const { baseCandles, candleWidth, barSpacing } = useMemo(() => {
    const p = item?.price ?? 100;
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

    const generated = basePrices.map((close, i) => {
      const prevClose = i > 0 ? basePrices[i - 1] : close - rng * 0.1;
      const open = prevClose;
      const wickDelta = rng * (0.1 + ((i % 3) * 0.05));
      const high = Math.max(open, close) + wickDelta;
      const low = Math.min(open, close) - wickDelta;
      const x = start + i * spacing;
      return { x, o: open, c: close, h: high, l: low };
    });

    return { baseCandles: generated, candleWidth: width, barSpacing: spacing };
  }, [symbol, item?.atr, timeframe, item?.price]);

  // Dynamic Candle Series: Right-most candle updates dynamically in real-time
  const candles = useMemo(() => {
    const sourceCandles = fetchedBars && fetchedBars.length > 5 ? fetchedBars : baseCandles;
    if (!sourceCandles || sourceCandles.length === 0) return [];
    const historical = sourceCandles.slice(0, sourceCandles.length - 1);
    const lastBase = sourceCandles[sourceCandles.length - 1];
    const currentClose = livePrice;
    const currentHigh = Math.max(lastBase.o, lastBase.h, currentClose);
    const currentLow = Math.min(lastBase.o, lastBase.l, currentClose);

    const activeCandle = {
      x: lastBase.x,
      o: lastBase.o,
      c: currentClose,
      h: currentHigh,
      l: currentLow,
    };
    return [...historical, activeCandle];
  }, [baseCandles, fetchedBars, livePrice]);

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

  // Auto-Scaling: Clamps bounds so anomalous wicks/ticks cannot blow out normal price action
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    const valid = candles.filter((c) => Number.isFinite(c.c) && c.c > 0);
    if (valid.length === 0) return { minPrice: 90, maxPrice: 110, priceRange: 20 };
    const ref = livePrice > 0 ? livePrice : item?.price ?? 100;

    // Normal bounds clamped within +/-12% of reference price to protect Y-axis scale
    const clampLow = ref * 0.88;
    const clampHigh = ref * 1.12;

    const rawMin = Math.min(...valid.map((c) => c.l));
    const rawMax = Math.max(...valid.map((c) => c.h));

    const boundedMin = Math.max(rawMin, clampLow);
    const boundedMax = Math.min(rawMax, clampHigh);

    const min = Math.min(boundedMin, stopVal > clampLow ? stopVal * 0.99 : boundedMin);
    const max = Math.max(boundedMax, targetVal < clampHigh ? targetVal * 1.01 : boundedMax);
    const range = max - min || 1;
    return { minPrice: min, maxPrice: max, priceRange: range };
  }, [candles, livePrice, item?.price, stopVal, targetVal]);

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
  const activeCandle = candles[candles.length - 1];
  const displayedCandle = hoveredData?.candle ?? activeCandle;

  return (
    <div
      className="w-full h-full flex-1 min-h-0 rounded-xl border flex flex-col relative overflow-hidden shadow-2xl"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
      data-testid="chart-placeholder-area"
    >
      {/* Chart Header Bar: Overlay SMA Labels */}
      <div
        className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 z-10 select-none"
        style={{
          backgroundColor: "var(--bg-panel-subtle)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {/* Active Ticker Context with Prominent Live Price */}
        <div className="flex items-baseline gap-3 font-mono" data-testid="chart-live-price-header">
          <span className="font-black text-2xl md:text-3xl tracking-tight text-white drop-shadow-sm">
            {symbol}
          </span>
          <span className="font-black text-2xl md:text-3xl tabular-nums tracking-tight text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]" data-testid="chart-live-price-value">
            ${livePrice.toFixed(2)}
          </span>
          <span className="text-xs text-slate-400 font-normal">· {timeframe} Live Candlestick Feed</span>
        </div>

        {/* OVERLAY SIMPLE TEXT LABELS: 20-SMA, 50-SMA, 200-SMA */}
        <div className="flex items-center gap-3 font-mono text-xs font-semibold select-none" data-testid="sma-overlay-labels">
          {/* 20-SMA */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30">
            <span className="h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.8)]" />
            <span className="text-blue-400 font-bold">20-SMA:</span>
            <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
              ${(livePrice * 0.985).toFixed(2)}
            </span>
          </div>

          {/* 50-SMA */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30">
            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]" />
            <span className="text-red-400 font-bold">50-SMA:</span>
            <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
              ${(livePrice * 0.952).toFixed(2)}
            </span>
          </div>

          {/* 200-SMA */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-fuchsia-500/10 border border-fuchsia-500/30">
            <span className="h-2 w-2 rounded-full bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.8)]" />
            <span className="text-fuchsia-400 font-bold">200-SMA:</span>
            <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
              ${(livePrice * 0.890).toFixed(2)}
            </span>
          </div>

          {/* Quick Arm Trade button directly from Chart */}
          <button
            type="button"
            data-testid="button-chart-arm-trade"
            onClick={() => openArmTrade(item.symbol)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/50 text-xs font-mono font-bold tracking-wider uppercase transition-colors cursor-pointer shadow-sm ml-1"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Arm Trade</span>
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
              O: <strong className="text-slate-100">${displayedCandle.o.toFixed(2)}</strong>
            </span>
            <span className="text-slate-400">
              H: <strong className="text-emerald-400">${displayedCandle.h.toFixed(2)}</strong>
            </span>
            <span className="text-slate-400">
              L: <strong className="text-rose-400">${displayedCandle.l.toFixed(2)}</strong>
            </span>
            <span className="text-slate-400">
              C: <strong className={displayedCandle.c >= displayedCandle.o ? "text-emerald-400" : "text-rose-400"}>
                ${displayedCandle.c.toFixed(2)}
              </strong>
            </span>
            {(() => {
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
                : "text-slate-400 bg-slate-900 border-slate-700/60"
            }`}>
              {hoveredData?.candle ? "Hovered Bar" : "Live Bar"}
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
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22D3EE]" />
            <span className="font-black text-white">{symbol}</span>
            <span className="text-cyan-300 font-semibold">{item.setupType}</span>
            <span className="text-slate-400">
              Entry: <strong className="text-white">${buyPrice.toFixed(2)}</strong>
            </span>
            <span className="text-rose-400">
              Stop: <strong className="text-rose-300">${stopVal.toFixed(2)}</strong>
            </span>
            <span className="text-emerald-400">
              T1: <strong className="text-emerald-300">${targetVal.toFixed(2)}</strong>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                item.status === "Ready"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                  : "bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
              }`}
            >
              {item.status}
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
          </defs>

          {/* Background Grid Lines */}
          {[80, 160, 240, 320].map((y) => (
            <line key={y} x1="0" y1={y} x2="710" y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
          ))}
          {[140, 280, 420, 560].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="420" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
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

          {/* 200-SMA Curve (Magenta) */}
          <path
            d={`M 20 ${priceToY(livePrice * 0.89)} Q 200 ${priceToY(livePrice * 0.90)} 400 ${priceToY(livePrice * 0.91)} T 700 ${priceToY(livePrice * 0.92)}`}
            fill="none"
            stroke="#C026D3"
            strokeWidth="2.2"
            opacity="0.85"
          />

          {/* 50-SMA Curve (Red) */}
          <path
            d={`M 20 ${priceToY(livePrice * 0.94)} Q 220 ${priceToY(livePrice * 0.95)} 420 ${priceToY(livePrice * 0.96)} T 700 ${priceToY(livePrice * 0.97)}`}
            fill="none"
            stroke="#DC2626"
            strokeWidth="2.2"
            opacity="0.85"
          />

          {/* 20-SMA Curve (Blue/Cyan) */}
          <path
            d={`M 20 ${priceToY(livePrice * 0.97)} Q 240 ${priceToY(livePrice * 0.98)} 440 ${priceToY(livePrice * 0.985)} T 700 ${priceToY(livePrice * 0.99)}`}
            fill="none"
            stroke="#2563EB"
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* ==================================================================== */}
          {/* BACKGROUND LAYER: Faded Dashed Horizontal Target Lines (30% - 40% opacity) */}
          {/* Rendered on background layer behind candlestick series so candles always paint on top */}
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
          />

          {/* Primary Target Line (Faded to ~35% opacity behind candles) */}
          <line
            x1="10"
            y1={priceToY(targetVal)}
            x2="710"
            y2={priceToY(targetVal)}
            stroke="var(--accent-green)"
            strokeWidth="1.2"
            strokeDasharray="5 5"
            opacity="0.35"
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
            opacity="0.55"
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
          {/* FOREGROUND LAYER: Dynamic Candlestick Series (Paints clearly ON TOP of lines) */}
          {/* ==================================================================== */}
          {candles.map((bar, i) => {
            const isUp = bar.c >= bar.o;
            const bodyColor = isUp ? "var(--accent-green)" : "var(--accent-red)";
            const top = priceToY(Math.max(bar.o, bar.c));
            const bottom = priceToY(Math.min(bar.o, bar.c));
            const height = Math.max(bottom - top, 2);
            const highY = priceToY(bar.h);
            const lowY = priceToY(bar.l);
            return (
              <g key={i}>
                <line x1={bar.x + candleWidth / 2} y1={highY} x2={bar.x + candleWidth / 2} y2={lowY} stroke={bodyColor} strokeWidth="1.5" />
                <rect x={bar.x} y={top} width={candleWidth} height={height} fill={bodyColor} rx="1" />
              </g>
            );
          })}

          {/* ==================================================================== */}
          {/* SIGNAL MARKERS (▲ GET IN / ▼ GET OUT badges on candles) */}
          {/* ==================================================================== */}

          {/* Entry Signal: Vibrant Green Up-Arrow (▲) & "GET IN" Badge */}
          {entryIndex >= 0 && entryIndex < candles.length && (() => {
            const bar = candles[entryIndex];
            const arrowY = priceToY(bar.l) + 6;
            const badgeY = arrowY + 12;
            return (
              <g key={`entry-marker-${entryIndex}`} data-testid="chart-marker-entry" className="select-none">
                <circle cx={bar.x + candleWidth / 2} cy={arrowY + 6} r="14" fill="#22C55E" opacity="0.25" filter="blur(4px)" />
                <polygon
                  points={`${bar.x + candleWidth / 2},${arrowY} ${bar.x + candleWidth / 2 - 6},${arrowY + 10} ${bar.x + candleWidth / 2 + 6},${arrowY + 10}`}
                  fill="#22C55E"
                  stroke="#16A34A"
                  strokeWidth="1"
                />
                <rect
                  x={bar.x + candleWidth / 2 - 28}
                  y={badgeY}
                  width="56"
                  height="18"
                  rx="4"
                  fill="#052E16"
                  stroke="#22C55E"
                  strokeWidth="1.5"
                />
                <text
                  x={bar.x + candleWidth / 2}
                  y={badgeY + 12}
                  fill="#4ADE80"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  ▲ GET IN
                </text>
              </g>
            );
          })()}

          {/* Exit Signal (Target 1): Vibrant Green/Emerald Down-Arrow (▼) & "GET OUT" Badge */}
          {targetIndex >= 0 && targetIndex < candles.length && (() => {
            const bar = candles[targetIndex];
            const arrowY = priceToY(bar.h) - 6;
            const badgeY = arrowY - 26;
            return (
              <g key={`target-marker-${targetIndex}`} data-testid="chart-marker-target" className="select-none">
                <circle cx={bar.x + candleWidth / 2} cy={arrowY - 6} r="14" fill="#34D399" opacity="0.25" filter="blur(4px)" />
                <polygon
                  points={`${bar.x + candleWidth / 2},${arrowY} ${bar.x + candleWidth / 2 - 6},${arrowY - 10} ${bar.x + candleWidth / 2 + 6},${arrowY - 10}`}
                  fill="#34D399"
                  stroke="#059669"
                  strokeWidth="1"
                />
                <rect
                  x={bar.x + candleWidth / 2 - 32}
                  y={badgeY}
                  width="64"
                  height="18"
                  rx="4"
                  fill="#064E3B"
                  stroke="#34D399"
                  strokeWidth="1.5"
                />
                <text
                  x={bar.x + candleWidth / 2}
                  y={badgeY + 12}
                  fill="#A7F3D0"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  ▼ GET OUT
                </text>
              </g>
            );
          })()}

          {/* Exit Signal (Stop Loss): Bright Red Down-Arrow (▼) & "GET OUT" / "STOP" Badge */}
          {stopIndex >= 0 && stopIndex < candles.length && (() => {
            const bar = candles[stopIndex];
            const arrowY = priceToY(bar.h) - 6;
            const badgeY = arrowY - 26;
            return (
              <g key={`stop-marker-${stopIndex}`} data-testid="chart-marker-stop" className="select-none">
                <circle cx={bar.x + candleWidth / 2} cy={arrowY - 6} r="14" fill="#EF4444" opacity="0.25" filter="blur(4px)" />
                <polygon
                  points={`${bar.x + candleWidth / 2},${arrowY} ${bar.x + candleWidth / 2 - 6},${arrowY - 10} ${bar.x + candleWidth / 2 + 6},${arrowY - 10}`}
                  fill="#EF4444"
                  stroke="#DC2626"
                  strokeWidth="1"
                />
                <rect
                  x={bar.x + candleWidth / 2 - 32}
                  y={badgeY}
                  width="64"
                  height="18"
                  rx="4"
                  fill="#450A0A"
                  stroke="#EF4444"
                  strokeWidth="1.5"
                />
                <text
                  x={bar.x + candleWidth / 2}
                  y={badgeY + 12}
                  fill="#FCA5A5"
                  fontSize="8.5"
                  fontFamily="monospace"
                  fontWeight="900"
                  textAnchor="middle"
                >
                  ▼ GET OUT
                </text>
              </g>
            );
          })()}

          {/* Real-time Dynamic Signal Marker on the Current Live Candle */}
          {(() => {
            const currentBar = candles[candles.length - 1];
            if (!currentBar) return null;
            const isLiveEntry = livePrice >= buyPrice * 0.995 && livePrice < targetVal;
            const isLiveTarget = livePrice >= targetVal;
            const isLiveStop = livePrice <= stopVal;

            if (isLiveTarget) {
              const arrowY = priceToY(currentBar.h) - 6;
              const badgeY = arrowY - 26;
              return (
                <g key="live-target-marker" data-testid="chart-live-signal-target" className="select-none">
                  <polygon
                    points={`${currentBar.x + candleWidth / 2},${arrowY} ${currentBar.x + candleWidth / 2 - 6},${arrowY - 10} ${currentBar.x + candleWidth / 2 + 6},${arrowY - 10}`}
                    fill="#34D399"
                  />
                  <rect
                    x={currentBar.x + candleWidth / 2 - 38}
                    y={badgeY}
                    width="76"
                    height="18"
                    rx="4"
                    fill="#064E3B"
                    stroke="#34D399"
                    strokeWidth="1.5"
                  />
                  <text
                    x={currentBar.x + candleWidth / 2}
                    y={badgeY + 12}
                    fill="#A7F3D0"
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    ▼ GET OUT · T1
                  </text>
                </g>
              );
            }

            if (isLiveStop) {
              const arrowY = priceToY(currentBar.h) - 6;
              const badgeY = arrowY - 26;
              return (
                <g key="live-stop-marker" data-testid="chart-live-signal-stop" className="select-none">
                  <polygon
                    points={`${currentBar.x + candleWidth / 2},${arrowY} ${currentBar.x + candleWidth / 2 - 6},${arrowY - 10} ${currentBar.x + candleWidth / 2 + 6},${arrowY - 10}`}
                    fill="#EF4444"
                  />
                  <rect
                    x={currentBar.x + candleWidth / 2 - 40}
                    y={badgeY}
                    width="80"
                    height="18"
                    rx="4"
                    fill="#450A0A"
                    stroke="#EF4444"
                    strokeWidth="1.5"
                  />
                  <text
                    x={currentBar.x + candleWidth / 2}
                    y={badgeY + 12}
                    fill="#FCA5A5"
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    ▼ GET OUT · STOP
                  </text>
                </g>
              );
            }

            if (isLiveEntry) {
              const arrowY = priceToY(currentBar.l) + 6;
              const badgeY = arrowY + 12;
              return (
                <g key="live-entry-marker" data-testid="chart-live-signal-entry" className="select-none">
                  <polygon
                    points={`${currentBar.x + candleWidth / 2},${arrowY} ${currentBar.x + candleWidth / 2 - 6},${arrowY + 10} ${currentBar.x + candleWidth / 2 + 6},${arrowY + 10}`}
                    fill="#22C55E"
                  />
                  <rect
                    x={currentBar.x + candleWidth / 2 - 34}
                    y={badgeY}
                    width="68"
                    height="18"
                    rx="4"
                    fill="#052E16"
                    stroke="#22C55E"
                    strokeWidth="1.5"
                  />
                  <text
                    x={currentBar.x + candleWidth / 2}
                    y={badgeY + 12}
                    fill="#4ADE80"
                    fontSize="8"
                    fontFamily="monospace"
                    fontWeight="900"
                    textAnchor="middle"
                  >
                    ▲ GET IN · LIVE
                  </text>
                </g>
              );
            }

            return null;
          })()}

          {/* ==================================================================== */}
          {/* RIGHT-HAND Y-AXIS LABELS (Sitting completely outside candlestick grid) */}
          {/* ==================================================================== */}

          {/* Compact Shrunk Glowing Live Price Tag on the Right-Hand Y-Axis */}
          <g transform={`translate(714, ${priceToY(livePrice) - 9})`} data-testid="chart-live-price-badge" className="select-none">
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
          <g transform={`translate(714, ${priceToY(buyPrice) - 8})`} data-testid="chart-label-buy" className="select-none pointer-events-none">
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
          <g transform={`translate(714, ${priceToY(stopVal) - 8})`} data-testid="chart-label-stop" className="select-none pointer-events-none">
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
          <g transform={`translate(714, ${priceToY(targetVal) - 8})`} data-testid="chart-label-t1" className="select-none pointer-events-none">
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
                      O: ${hoveredData.candle.o.toFixed(2)} H: ${hoveredData.candle.h.toFixed(2)}
                    </text>
                    <text x="8" y="26" fill="#94A3B8" fontSize="8" fontFamily="monospace">
                      L: ${hoveredData.candle.l.toFixed(2)} C: ${hoveredData.candle.c.toFixed(2)}
                    </text>
                    <text x="8" y="38" fill={isUp ? "#4ADE80" : "#F87171"} fontSize="8" fontFamily="monospace" fontWeight="bold">
                      {isUp ? "+" : ""}{chg.toFixed(2)} ({isUp ? "+" : ""}{((chg / hoveredData.candle.o) * 100).toFixed(2)}%)
                    </text>
                  </g>
                );
              })()}
            </g>
          )}
        </svg>
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
  const [newTickerInput, setNewTickerInput] = useState("");

  const theme = global.theme;
  const activeTheme = THEMES[theme] || THEMES["cyber-neon"];

  const { source: feedSource } = useFeedConnection();

  const THEME_ORDER: DashboardTheme[] = ["cyber-neon", "stealth", "arctic", "sunset-orange", "neon-grape", "mint-matrix"];
  const cycleTheme = () => {
    global.cycleTheme();
  };

  // Active ticker selection (linked directly to Chart symbol)
  const activeTicker = global.activeTicker;
  const setActiveTicker = global.setActiveTicker;
  const activeSymbol = activeTicker;
  const setActiveSymbol = setActiveTicker;
  const watchlist = global.watchlist;
  const activeItem = global.activeItem;

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTickerInput.trim()) return;
    global.addTicker(newTickerInput);
    setNewTickerInput("");
  };

  // Center column tabs: "Chart" | "Setup History" | "Settings" | "Indicators"
  const [activeTab, setActiveTab] = useState<"Chart" | "Setup History" | "Settings" | "Indicators">("Chart");

  // Timeframe selector
  const activeTf = global.timeframe;
  const setActiveTf = global.setTimeframe;

  // Market regime simulation: "GREEN" | "YELLOW" | "RED"
  const [regime, setRegime] = useState<"GREEN" | "YELLOW" | "RED">("GREEN");

  // Advanced Metrics accordion state in Right Column
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const openArmTrade = global.openArmTrade;

  // Card status background tints
  const statusTint = useMemo(() => {
    switch (activeItem.status) {
      case "Ready":
        return "bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_20px_rgba(34,197,94,0.12)]";
      case "Awaiting Close":
        return "bg-amber-950/20 border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.12)]";
      default:
        return "bg-cyan-950/20 border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.10)]";
    }
  }, [activeItem.status]);

  return (
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

        {/* Center: Live Terminal Telemetry & Provider Status Pill */}
        <div className="hidden md:flex items-center gap-3 text-xs font-mono">
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm font-bold tracking-wider ${
              feedSource && feedSource !== "FINNHUB"
                ? "border-amber-400/50 bg-amber-950/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                : "border-emerald-400/50 bg-emerald-950/60 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.2)]"
            }`}
            data-testid="pill-feed-provider"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                feedSource && feedSource !== "FINNHUB"
                  ? "bg-amber-400 shadow-[0_0_6px_#F59E0B] animate-pulse"
                  : "bg-emerald-400 shadow-[0_0_6px_#34D399]"
              }`}
            />
            <span>
              {feedSource && feedSource !== "FINNHUB"
                ? `🟡 LIVE: ${feedSource === "POLYGON" ? "Polygon" : feedSource === "TWELVEDATA" ? "TwelveData" : feedSource} (Backup)`
                : "🟢 LIVE: Finnhub"}
            </span>
          </div>
        </div>

        {/* Right: Theme Switcher Toggle */}
        <div className="flex items-center gap-3">
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
              {watchlist.map((item) => {
                const isSelected = item.symbol === activeSymbol;
                const isPositive = item.change >= 0;
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
                          const min = Math.min(...item.sparkline);
                          const max = Math.max(...item.sparkline);
                          const range = max - min || 1;
                          const points = item.sparkline
                            .map((val, idx) => {
                              const x = (idx / (item.sparkline.length - 1)) * 48 + 1;
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

                    {/* Price & Change Badge */}
                    <div className="text-right flex-shrink-0 font-mono">
                      <div className="text-xs font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                        ${item.price.toFixed(2)}
                      </div>
                      <div
                        className="text-[10px] font-bold tabular-nums flex items-center justify-end gap-0.5"
                        style={{ color: isPositive ? "var(--accent-green)" : "var(--accent-red)" }}
                      >
                        {isPositive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                        <span>{isPositive ? "+" : ""}{item.changePct.toFixed(2)}%</span>
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
                <Chart
                  symbol={activeTicker}
                  timeframe={activeTf}
                  activeItem={activeItem}
                  entryPrice={activeItem.buyTarget}
                  stopLoss={activeItem.stopLoss}
                  primaryTarget={activeItem.primaryTarget}
                />
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
                  Verified Historical Swings ({activeItem.symbol})
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
                {activeItem.symbol}
              </span>
            </div>
          </div>

          {/* Internal Scrollable Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* The Setup Card Component */}
            <div
              className={`rounded-2xl border p-5 transition-all duration-300 relative bg-[var(--card-bg)] border-[var(--card-border)] ${statusTint}`}
              data-testid="setup-card"
            >
              {/* Card Header & Status Badge */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--card-border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black font-mono tracking-tight text-[var(--card-text-primary)]">
                      {activeItem.symbol}
                    </span>
                    <span className="text-xs font-mono font-semibold opacity-75 text-[var(--card-text-secondary)]">
                      ${activeItem.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--card-accent-buy)] font-bold mt-0.5">
                    {activeItem.setupType}
                  </div>
                </div>

                <div
                  className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider shadow-sm border ${
                    activeItem.status === "Ready"
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/40 animate-pulse"
                      : activeItem.status === "Awaiting Close"
                      ? "bg-amber-500/20 text-amber-300 border-amber-400/40"
                      : "bg-cyan-500/20 text-cyan-300 border-cyan-400/40"
                  }`}
                  data-testid="badge-setup-status"
                >
                  {activeItem.status}
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
                    ${activeItem.buyTarget.toFixed(2)}
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
                    ${activeItem.stopLoss.toFixed(2)}
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
                    ${activeItem.primaryTarget.toFixed(2)}
                  </span>
                  <span className="text-[8.5px] font-mono text-[var(--card-text-secondary)] mt-0.5">
                    +2.37R R:R
                  </span>
                </div>
              </div>

              {/* SHORT "BOTTOM LINE" SUMMARY SENTENCE */}
              <div
                className="p-3 rounded-xl border text-xs font-sans leading-relaxed my-3"
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
                  {activeItem.bottomLine}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 mt-4">
                <button
                  type="button"
                  data-testid="button-arm-practice-trade"
                  onClick={() => openArmTrade(activeItem.symbol)}
                  className="w-full py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    backgroundColor: "var(--accent-cyan)",
                    color: "#050914",
                  }}
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Arm Practice Order</span>
                </button>
              </div>

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
                          <span className="font-bold text-emerald-400">${activeItem.t2.toFixed(2)}</span>
                        </div>
                        <div className="p-1.5 rounded bg-black/30 border border-white/5 flex justify-between">
                          <span className="text-slate-400">T3 Runner:</span>
                          <span className="font-bold text-emerald-400">${activeItem.t3.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Historical Win Rate */}
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                      <span className="text-slate-400">Historical Win Rate:</span>
                      <span className="font-bold text-cyan-300">{activeItem.winRate}% (38 setups)</span>
                    </div>

                    {/* 14-period ATR */}
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">14-Period ATR:</span>
                      <span className="font-bold tabular-nums">${activeItem.atr.toFixed(2)}</span>
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

            {/* Broker Execution Guide Accordion */}
            <BrokerExecutionSteps
              symbol={activeItem.symbol}
              entry={activeItem.buyTarget}
              stop={activeItem.stopLoss}
              target1={activeItem.primaryTarget}
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
                  {Math.floor(1000 / Math.abs(activeItem.buyTarget - activeItem.stopLoss))} shares
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
    </div>
  );
}

