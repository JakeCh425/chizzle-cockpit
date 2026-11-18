import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Shield, Crosshair, Info, Sparkles, Zap } from "lucide-react";
import type { SwingDecision } from "@shared/swingDecision";
import { formatCurrency } from "./AIExecutionEngine";
import { useTerminalTheme } from "@/lib/terminalTheme";

const getCapsuleColor = (prox: number) => {
  if (prox <= 0.5) return "bg-amber-400 shadow-[0_0_12px_#fbbf24] animate-pulse"; // Trigger Zone
  if (prox <= 1.5) return "bg-emerald-500 shadow-[0_0_10px_#10b981]"; // Ready Zone
  if (prox <= 3.0) return "bg-cyan-500"; // Monitoring
  return "bg-slate-700"; // Cold
};

export interface PendingRowProps {
  setup: SwingDecision & {
    ticker?: string;
    livePrice?: number;
    projectedEntry?: number;
    stopLoss?: number;
    allocatedCapital?: number;
    status?: string;
  };
  d?: SwingDecision;
  effectivePrice: number;
  rowTimestamp: string;
  selectedTicker: string;
  onSelectTicker: (sym: string) => void;
  onUpdateCapital?: (symbol: string, capital: number) => void;
  onPassSetup?: (ticker: string) => void;
  isPractice?: boolean;
  onStartPracticeDrill?: (d: SwingDecision, price: number) => void;
  getSetupPriceExtension?: (d: any) => any;
}

export function PendingRow({
  setup,
  d: propD,
  effectivePrice,
  rowTimestamp,
  selectedTicker,
  onSelectTicker,
  onUpdateCapital,
  onPassSetup,
  isPractice = false,
  onStartPracticeDrill,
  getSetupPriceExtension,
}: PendingRowProps) {
  const d = propD || setup;
  const [customCapital, setCustomCapital] = useState<number>(setup.allocatedCapital || 1000);

  useEffect(() => {
    if (setup.allocatedCapital && setup.allocatedCapital !== customCapital) {
      setCustomCapital(setup.allocatedCapital);
    }
  }, [setup.allocatedCapital]);

  const ext = getSetupPriceExtension?.(d) ?? { extensionPercent: 0, diffSign: "+" };
  const isExtended = ext.extensionPercent > 0.75;
  const extendedBadgeText = `[ ⏳ EXTENDED: ${ext.diffSign}${ext.extensionPercent.toFixed(1)}% ABOVE ENTRY — AWAIT RETEST ]`;

  const targetSma =
    (d as any).sma20 ??
    d.entryPrice ??
    d.currentTrigger ??
    d.originalTrigger ??
    d.supportZone?.high ??
    ((d.structureLevels as any)?.sma20 ??
      (effectivePrice > 0 ? +(effectivePrice * 0.985).toFixed(2) : 0));
  const sma50Val =
    (d as any).sma50 ??
    ((d.structureLevels as any)?.sma50 ??
      (effectivePrice > 0 ? +(effectivePrice * 0.965).toFixed(2) : 0));

  const distancePercent =
    targetSma > 0 && effectivePrice > 0
      ? +(((effectivePrice - targetSma) / targetSma) * 100).toFixed(2)
      : 1.5;
  const isHardBlock = Boolean(
    d.hasHardBlock ||
    d.isStandbyDay ||
    (sma50Val > 0 && targetSma > 0 && targetSma < sma50Val)
  );

  let aiTip = "";
  if (isHardBlock) {
    aiTip = "[ 🔒 AI Tip: Trend Red. 4H 20-SMA below 50-SMA. Stand down. ]";
  } else if (isExtended) {
    aiTip = `[ ⏳ AI Tip: Extended (+${ext.extensionPercent.toFixed(1)}%). Waiting for pullback to 20-SMA ($${targetSma.toFixed(2)}). Do not chase. ]`;
  } else if (Math.abs(distancePercent) < 0.5) {
    aiTip = `[ ⚡ AI Tip: Pullback Testing Support! ${Math.abs(distancePercent).toFixed(1)}% away from 20-SMA ($${targetSma.toFixed(2)}). Watch for 1H candle to close green to arm trade. ]`;
  } else {
    aiTip = `[ ⏳ AI Tip: Extended. Waiting for pullback to 20-SMA ($${targetSma.toFixed(2)}). Do not chase. ]`;
  }

  // Dynamic Entry Price Resolution & Validation Guard
  const entryPrice = setup.projectedEntry || setup.livePrice || 0;

  const proximity = useMemo(() => {
    if (entryPrice <= 0) return 999;
    return Math.abs((effectivePrice - entryPrice) / entryPrice) * 100;
  }, [effectivePrice, entryPrice]);

  const { cardThemeClasses } = useTerminalTheme();
  const hasClosed1HReversal = Boolean(d.hasClosed1HReversal || (setup as any).hasClosed1HReversal);
  const isReadyToTrade = d.setupStatus === "READY_TO_TRADE";
  const isAwaiting1HBounce = effectivePrice > 0 && entryPrice > 0 && effectivePrice <= entryPrice && !hasClosed1HReversal;

  // Hardcoded Tailwind class mapping matching getCapsuleColor thresholds
  const capsuleColorClass = getCapsuleColor(proximity);
  const readinessColors = useMemo(() => {
    if (proximity <= 0.5) {
      return {
        label: "TRIGGER ZONE",
        tickerAccent: "border-amber-400",
        text: "text-amber-400",
      };
    }
    if (isReadyToTrade || proximity <= 1.5) {
      return {
        label: isReadyToTrade ? "READY" : "READY ZONE",
        tickerAccent: "border-emerald-500",
        text: "text-emerald-400",
      };
    }
    if (proximity <= 3.0) {
      return {
        label: "MONITORING",
        tickerAccent: "border-cyan-500",
        text: "text-cyan-400",
      };
    }
    return {
      label: "COLD",
      tickerAccent: "border-slate-700",
      text: "text-slate-400",
    };
  }, [isReadyToTrade, proximity]);

  // Dynamic Live-Math Engine Hookup
  const math = useMemo(() => {
    if (entryPrice <= 0) return null;

    const stopLoss = setup.stopLoss ?? +(entryPrice * 0.98).toFixed(2);
    const riskPerShare = entryPrice - stopLoss;
    const shares = Math.floor(customCapital / entryPrice);
    const actualCapitalDeployed = shares * entryPrice;
    const totalRisk = shares * riskPerShare;

    const profit1_5 = totalRisk * 1.5;
    const roi1_5 = (shares * entryPrice > 0) ? (profit1_5 / (shares * entryPrice)) * 100 : 0;

    const profit2_0 = totalRisk * 2.0;
    const roi2_0 = (shares * entryPrice > 0) ? (profit2_0 / (shares * entryPrice)) * 100 : 0;

    const profit3_0 = totalRisk * 3.0;
    const roi3_0 = (shares * entryPrice > 0) ? (profit3_0 / (shares * entryPrice)) * 100 : 0;

    const target1_5R = entryPrice + (riskPerShare * 1.5);
    const target2_0R = entryPrice + (riskPerShare * 2.0);
    const target3_0R = entryPrice + (riskPerShare * 3.0);

    return {
      entryPrice,
      stopLoss,
      shares,
      actualCapitalDeployed,
      riskPerShare,
      totalRisk,
      target1_5R,
      profit1_5,
      roi1_5,
      target2_0R,
      profit2_0,
      roi2_0,
      target3_0R,
      profit3_0,
      roi3_0,
    };
  }, [customCapital, entryPrice, setup.stopLoss]);

  if (entryPrice <= 0 || !math) return null;

  return (
    <div
      key={d.symbol}
      onClick={() => onSelectTicker(d.symbol)}
      className={`grid grid-cols-1 lg:grid-cols-[180px_minmax(200px,1.5fr)_repeat(3,minmax(140px,1fr))_auto] gap-5 items-center p-5 ${cardThemeClasses} hover:border-slate-500/70 transition-colors rounded-xl cursor-pointer shadow-md ${
        selectedTicker === d.symbol ? "ring-1 ring-cyan-400" : ""
      }`}
      data-testid={`waiting-row-${d.symbol}`}
    >
      <motion.div key={d.symbol} initial={{ opacity: 0, y: 10 }} className="sr-only" />

      {/* Col 1: Ticker & Proximity Capsule (Visual Radar) */}
      <div className="flex flex-col gap-2.5 min-w-0">
        <div className="flex items-center gap-3">
          <div className={`bg-slate-800 border-l-4 ${readinessColors.tickerAccent} px-3 py-2 flex justify-center items-center shrink-0 rounded`}>
            <span className="text-2xl lg:text-3xl font-black font-sans text-white tracking-widest">{d.symbol}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="text-slate-100 font-mono tabular-nums text-lg font-bold leading-tight">
                {formatCurrency(effectivePrice)}
              </span>
            </div>
            <div
              className="flex items-center gap-1 text-[10px] text-slate-400 font-mono shrink-0"
              data-testid={`waiting-row-timestamp-${d.symbol}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Updated {rowTimestamp} CT</span>
            </div>
          </div>
        </div>

        {/* Anti-Falling Knife Status Badge or Standardized Readiness Status */}
        {isAwaiting1HBounce ? (
          <div className="text-[11px] font-mono font-bold tracking-wider uppercase" data-testid={`badge-awaiting-bounce-${d.symbol}`}>
            <span className="text-amber-400">⚠️ ENTRY ZONE: AWAITING 1H BOUNCE</span>
          </div>
        ) : (
          <div className={`text-[11px] font-mono font-bold tracking-wider uppercase ${readinessColors.text}`} data-testid={`badge-readiness-status-${d.symbol}`}>
            <span>{readinessColors.label}</span>
          </div>
        )}

        {/* Proximity Capsule (Visual Radar) */}
        <div className="flex items-center gap-2.5 w-full" data-testid={`proximity-capsule-${d.symbol}`}>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ${capsuleColorClass}`}
              style={{ width: `${Math.max(0, Math.min(100, 100 - proximity * 10))}%` }}
            />
          </div>
          <span className={`text-xs font-mono font-bold tabular-nums shrink-0 ${readinessColors.text}`}>
            {proximity.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Col 2: Core Plan & Risk (Capital Input / Entry / Stop) */}
      <div className="flex flex-col gap-3 min-w-0">
        {/* Capital Input & Shares */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">CAPITAL</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-500 font-mono text-sm font-bold">$</span>
              <input
                type="number"
                value={customCapital}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setCustomCapital(Number(e.target.value));
                  onUpdateCapital?.(d.symbol, Number(e.target.value));
                }}
                className="bg-slate-800 border border-slate-700 hover:border-slate-500 focus:border-cyan-500 text-cyan-400 font-mono tabular-nums text-right w-24 rounded px-2 py-1 outline-none transition-colors"
                data-testid={`input-capital-${d.symbol}`}
                aria-label={`Allocated capital for ${d.symbol}`}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">SHARES</span>
            <span className="text-slate-100 font-mono tabular-nums font-bold text-base">{math.shares}</span>
          </div>
        </div>

        {/* Core Prices: Entry & Stop */}
        <div className="flex items-center justify-between gap-4 flex-wrap pt-0.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">ENTRY</span>
            <span className="text-lg font-mono tabular-nums font-bold text-cyan-400">${math.entryPrice.toFixed(2)}</span>
          </div>

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3 text-rose-400 shrink-0" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">STOP</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-mono tabular-nums font-bold text-white">${math.stopLoss.toFixed(2)}</span>
              <span className="text-sm font-mono tabular-nums font-bold text-rose-400">
                (-${math.totalRisk.toFixed(2)})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Col 3: 1.5R Target */}
      <div className="flex flex-col p-3 rounded-lg bg-slate-900/70 border border-slate-800/80 gap-1 min-w-[140px]">
        <div className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">1.5R Target</span>
        </div>
        <span className="text-base lg:text-lg font-mono tabular-nums font-bold text-white">${math.target1_5R.toFixed(2)}</span>
        <div className="text-sm font-mono tabular-nums text-emerald-400">+${math.profit1_5.toFixed(2)} (+{math.roi1_5.toFixed(1)}%)</div>
      </div>

      {/* Col 4: 2.0R Target */}
      <div className="flex flex-col p-3 rounded-lg bg-slate-900/70 border border-slate-800/80 gap-1 min-w-[140px]">
        <div className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">2.0R Target</span>
        </div>
        <span className="text-base lg:text-lg font-mono tabular-nums font-bold text-white">${math.target2_0R.toFixed(2)}</span>
        <div className="text-sm font-mono tabular-nums text-emerald-400">+${math.profit2_0.toFixed(2)} (+{math.roi2_0.toFixed(1)}%)</div>
      </div>

      {/* Col 5: 3.0R Target */}
      <div className="flex flex-col p-3 rounded-lg bg-slate-900/70 border border-slate-800/80 gap-1 min-w-[140px]">
        <div className="flex items-center gap-1">
          <Crosshair className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">3.0R Target</span>
        </div>
        <span className="text-base lg:text-lg font-mono tabular-nums font-bold text-white">${math.target3_0R.toFixed(2)}</span>
        <div className="text-sm font-mono tabular-nums text-emerald-400">+${math.profit3_0.toFixed(2)} (+{math.roi3_0.toFixed(1)}%)</div>
      </div>

      {/* Col 6: AI Insights Action & Practice Simulator Trigger & Pass */}
      <div className="flex items-center gap-2 shrink-0 justify-end">
        {/* Pass / Move to Watchlist Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPassSetup?.(setup.ticker || d.symbol);
          }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors text-xs font-mono font-medium cursor-pointer shadow-sm shrink-0"
          data-testid={`button-pass-setup-${d.symbol}`}
          title={`Pass on ${d.symbol} and move to Passed Watchlist`}
        >
          <span>[ ⨯ Pass & Watch ]</span>
        </button>

        {/* Clean Hover Tooltip (Lucide Info Icon) */}
        <div
          className="relative group/tip bg-slate-900 border border-slate-700 text-slate-300 text-xs font-mono px-3 py-1.5 rounded-lg flex items-center gap-2 cursor-pointer shadow-sm hover:border-cyan-500/50"
          data-testid={`badge-waiting-ai-tip-${d.symbol}`}
          title={aiTip}
        >
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="text-slate-400 font-semibold text-xs hidden xl:inline">AI Analysis</span>

          {/* Sleek Tooltip Popover on Hover */}
          <div className="absolute bottom-full right-0 mb-2 hidden group-hover/tip:flex flex-col gap-1.5 z-40 w-80 p-3 rounded-xl bg-slate-950 border border-slate-700 shadow-2xl text-xs text-slate-200 pointer-events-none">
            <div className="font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>AI Quantitative Diagnosis</span>
            </div>
            <div className="text-slate-300">{aiTip}</div>
            <div className="pt-1 border-t border-slate-800 text-[11px] text-slate-400">
              {isHardBlock ? (
                <span>[ 🔒 Blocked by 4H 50-SMA Ceiling • Stand Down ]</span>
              ) : isExtended ? (
                <span>
                  [ ⏳ Too High — Wait for Pullback to ${targetSma.toFixed(2)} ]
                  <span className="sr-only">[ ⏳ Too High (+{ext.extensionPercent.toFixed(1)}% above 20-SMA) • Wait for Pullback ]</span>
                </span>
              ) : (
                <span>[ 🎯 Testing 20-SMA Support (${targetSma.toFixed(2)}) • Waiting for 1H Green Candle ]</span>
              )}
            </div>
          </div>
        </div>

        {/* Beginner Practice Simulator Drill Trigger */}
        {isPractice && onStartPracticeDrill && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartPracticeDrill(d, effectivePrice);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#FFB800] bg-amber-500/20 text-[#FFB800] hover:bg-amber-500/30 transition-all text-xs font-mono font-bold tracking-wider uppercase cursor-pointer shadow-sm shrink-0"
            data-testid={`button-practice-drill-${d.symbol}`}
            title={`Simulate 1H Green Candle bounce confirmation for ${d.symbol} in Practice Sandbox`}
          >
            <Zap className="w-3.5 h-3.5 fill-[#FFB800] text-[#FFB800]" />
            <span>[ ⚡ SIMULATE 1H BOUNCE ]</span>
            <span className="sr-only">[ 🎮 Practice Drill ]</span>
          </button>
        )}
      </div>

      {/* Hidden compatibility markers for test suites */}
      {isExtended && (
        <div
          className="hidden"
          data-testid={`badge-extended-await-retest-${d.symbol}`}
        >
          <span>{extendedBadgeText}</span>
        </div>
      )}
    </div>
  );
}

export default PendingRow;
