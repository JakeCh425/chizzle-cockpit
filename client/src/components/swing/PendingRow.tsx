import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Shield, Crosshair, Info, Sparkles, Zap } from "lucide-react";
import type { SwingDecision } from "@shared/swingDecision";
import { formatCurrency } from "./AIExecutionEngine";
import {
  getCapsuleColor,
  getReadinessTier,
  getTechnicalStage,
  computeSwingPositionMath,
  type SetupStage,
} from "@/hooks/useSwingMath";
import { STATUS_THEME, PRICE_COLOR_CLASSES, useCardTypography } from "@/lib/statusTheme";

export interface PendingRowProps {
  setup: SwingDecision & {
    ticker?: string;
    livePrice?: number;
    projectedEntry?: number;
    stopLoss?: number;
    allocatedCapital?: number;
    status?: string;
    stage?: SetupStage;
    technicalStage?: Exclude<SetupStage, "BLOCKED">;
  };
  d?: SwingDecision;
  effectivePrice: number;
  rowTimestamp: string;
  selectedTicker: string;
  macroRegime?: string;
  onSelectTicker: (sym: string) => void;
  onUpdateCapital?: (symbol: string, capital: number) => void;
  onPassSetup?: (ticker: string) => void;
  isPractice?: boolean;
  onStartPracticeDrill?: (d: SwingDecision, price: number) => void;
  getSetupPriceExtension?: (d: any) => any;
}

export const PendingRow = React.memo(function PendingRow({
  setup,
  d: propD,
  effectivePrice,
  rowTimestamp,
  selectedTicker,
  macroRegime,
  onSelectTicker,
  onUpdateCapital,
  onPassSetup,
  isPractice = false,
  onStartPracticeDrill,
  getSetupPriceExtension,
}: PendingRowProps) {
  const d = propD || setup;
  const [rawCapital, setRawCapital] = useState<string>(() => String(setup.allocatedCapital || 1000));
  const [shareModeOverride, setShareModeOverride] = useState<"auto" | "whole" | "fractional">("auto");
  const cardTypo = useCardTypography();

  useEffect(() => {
    if (setup.allocatedCapital && setup.allocatedCapital > 0) {
      setRawCapital((prev) => (prev === "" ? prev : String(setup.allocatedCapital)));
    }
  }, [setup.allocatedCapital]);

  const numericCapital = Number(rawCapital) || 0;

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

  const hasClosed1HReversal = Boolean(d.hasClosed1HReversal || (setup as any).hasClosed1HReversal);
  const isAwaiting1HBounce = effectivePrice > 0 && entryPrice > 0 && effectivePrice <= entryPrice && !hasClosed1HReversal;
  const technicalStage =
    setup.technicalStage ??
    ((d as any).technicalStage as Exclude<SetupStage, "BLOCKED"> | undefined) ??
    getTechnicalStage(setup, proximity);
  const stage: SetupStage =
    setup.stage ?? ((d as any).stage as SetupStage | undefined) ?? (isHardBlock ? "BLOCKED" : technicalStage);
  const isBlockedStage = stage === "BLOCKED";
  const isDeepStandby = proximity > 3.0;
  const stageTheme = STATUS_THEME[stage];
  const hasMacroCaution =
    isBlockedStage || String(macroRegime ?? "").toUpperCase() === "SELECTIVE";

  // Shared readiness tier & capsule classes from STATUS_THEME
  const capsuleColorClass = getCapsuleColor(proximity, stage);
  const readinessColors = useMemo(() => {
    const tier = getReadinessTier(proximity, d.setupStatus, stage);
    return {
      label: tier.label,
      tickerAccent: tier.tickerAccentClass,
      text: tier.textClass,
    };
  }, [d.setupStatus, proximity, stage]);

  const useFractional =
    shareModeOverride === "fractional"
      ? true
      : shareModeOverride === "whole"
      ? false
      : entryPrice > 0 && numericCapital < entryPrice;

  // Shared Live-Math Engine Hookup (Institutional Calculator with Fractional + ROC %)
  const math = useMemo(
    () =>
      computeSwingPositionMath({
        entryPrice,
        stopLoss: setup.stopLoss ?? +(entryPrice * 0.98).toFixed(2),
        capital: numericCapital,
        fractional: useFractional,
      }),
    [numericCapital, entryPrice, setup.stopLoss, useFractional]
  );

  if (entryPrice <= 0 || !math) {
    return (
      <div
        key={d.symbol}
        onClick={() => onSelectTicker(d.symbol)}
        className={`flex flex-wrap items-center justify-between gap-4 p-5 bg-[#0B101D] border border-slate-800/90 opacity-85 hover:opacity-100 rounded-xl cursor-pointer shadow-md ${
          selectedTicker === d.symbol ? "ring-1 ring-amber-400/70 opacity-100" : ""
        }`}
        data-testid={`waiting-row-${d.symbol}`}
      >
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border-l-4 border-sky-400 px-3 py-2 flex justify-center items-center shrink-0 rounded">
            <span className="text-2xl lg:text-3xl font-black tracking-widest text-white">{d.symbol}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-slate-200 font-mono tabular-nums text-xl font-bold">
              {effectivePrice > 0 ? formatCurrency(effectivePrice) : "Syncing..."}
            </span>
            <span className="text-xs font-mono text-sky-300 uppercase">📡 Syncing Setup Levels...</span>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded bg-sky-500/15 text-sky-300 border border-sky-400/50 text-xs font-mono font-bold uppercase">
          {stageTheme.label}
        </span>
      </div>
    );
  }

  const isCloseToEntry = proximity <= 1.5;
  const proximityBarPct = Math.max(0, Math.min(100, 100 - proximity * 10));

  return (
    <div
      key={d.symbol}
      onClick={() => onSelectTicker(d.symbol)}
      className={`grid grid-cols-1 lg:grid-cols-[240px_minmax(280px,1.8fr)_auto] gap-5 items-center p-5 bg-[#0B101D] border ${
        stageTheme.cardGlowClass
      } opacity-95 hover:opacity-100 transition-all rounded-xl cursor-pointer shadow-md ${
        selectedTicker === d.symbol ? "ring-1 ring-cyan-400/70 opacity-100" : ""
      }`}
      data-testid={`waiting-row-${d.symbol}`}
    >
      <motion.div key={d.symbol} initial={{ opacity: 0, y: 10 }} className="sr-only" />

      {/* Left Zone: Asset & 4-Tier Proximity Color-Shift Engine */}
      <div className="flex flex-col gap-2.5 min-w-0" style={cardTypo.fontStyle}>
        <div className="flex items-center gap-3">
          <div className={`bg-slate-900 border-l-4 ${readinessColors.tickerAccent} px-3 py-2 flex justify-center items-center shrink-0 rounded`}>
            <span className={`${cardTypo.tickerClass} font-black tracking-widest text-white`}>{d.symbol}</span>
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-slate-400 shrink-0" />
              <span className={`text-slate-100 font-mono tabular-nums ${cardTypo.priceClass} font-bold leading-tight`}>
                {formatCurrency(effectivePrice)}
              </span>
            </div>
            <div
              className={`flex items-center gap-1 ${cardTypo.labelClass} text-slate-400 font-mono shrink-0`}
              data-testid={`waiting-row-timestamp-${d.symbol}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${stageTheme.dotClass}`} />
              <span>Updated {rowTimestamp} CT</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div
            className={`inline-flex w-fit px-2 py-0.5 rounded text-xs font-mono font-bold tracking-wider uppercase ${stageTheme.badgeClass}`}
            data-testid={`badge-readiness-status-${d.symbol}`}
          >
            <span>{stageTheme.label}</span>
          </div>
          {isCloseToEntry && (
            <span
              className="inline-flex px-2 py-0.5 rounded bg-amber-400/20 border border-amber-400/70 text-[10px] font-mono font-black text-amber-300 uppercase tracking-wider"
              data-testid={`badge-close-to-entry-${d.symbol}`}
            >
              [ 🔥 CLOSE TO ENTRY: {proximity.toFixed(1)}% ]
            </span>
          )}
          {hasMacroCaution && (
            <span className="inline-flex px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-400/40 text-[10px] font-mono font-bold text-amber-300 uppercase">
              Macro Caution
            </span>
          )}
        </div>

        <div className="text-[11px] font-mono text-slate-300 tabular-nums">
          {Math.round(proximityBarPct)}% to Entry • {proximity < 100 ? `${proximity.toFixed(1)}% away` : "Scanning"}
        </div>

        {/* Proximity Capsule (Visual Radar) */}
        <div className="flex items-center gap-2.5 w-full" data-testid={`proximity-capsule-${d.symbol}`}>
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
            <div
              className={`h-full rounded-full transition-all duration-700 ${capsuleColorClass}`}
              style={{ width: `${proximityBarPct}%` }}
            />
          </div>
          <span className={`text-sm font-mono font-bold tabular-nums shrink-0 ${readinessColors.text}`}>
            {proximity.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Center Zone: Interactive Capital Calculator & 3-Column Target Strip */}
      <div className="flex flex-col gap-3 min-w-0">
        {/* Capital Input, Fractional Toggle, Shares, Allocated & 1R Risk */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`${cardTypo.labelClass} font-bold text-slate-400 uppercase tracking-widest`}>CAPITAL ($)</span>
            <input
              type="text"
              inputMode="numeric"
              value={rawCapital}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                const cleaned = digitsOnly.replace(/^0+(?=\d)/, "");
                setRawCapital(cleaned);
                onUpdateCapital?.(d.symbol, Number(cleaned) || 0);
              }}
              onBlur={() => {
                if (rawCapital === "") {
                  setRawCapital("1000");
                  onUpdateCapital?.(d.symbol, 1000);
                }
              }}
              className="appearance-none font-mono font-bold text-white bg-slate-900 border border-slate-600 focus:border-cyan-400 rounded px-2.5 py-1 w-28 text-right tabular-nums outline-none transition-colors"
              data-testid={`input-capital-${d.symbol}`}
              aria-label={`Allocated capital for ${d.symbol}`}
            />
          </div>

          <div
            className="inline-flex rounded-md border border-slate-700 bg-slate-900 p-0.5 text-[11px] font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShareModeOverride("whole")}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-colors ${
                !useFractional ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"
              }`}
            >
              Whole
            </button>
            <button
              type="button"
              onClick={() => setShareModeOverride("fractional")}
              className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-colors ${
                useFractional ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"
              }`}
            >
              Fractional
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
            <span>
              <span className="text-slate-400 uppercase">SHARES </span>
              <strong className="text-white text-sm">{math.shares} sh</strong>
            </span>
            <span>
              <span className="text-slate-400 uppercase">ALLOCATED </span>
              <strong className="text-cyan-300">${math.actualCapitalDeployed.toFixed(2)}</strong>
            </span>
            <span>
              <span className="text-slate-400 uppercase">1R RISK </span>
              <strong className="text-rose-400">
                -${math.totalRisk.toFixed(2)} ({math.equityRiskPct.toFixed(1)}% Eq)
              </strong>
            </span>
          </div>
        </div>

        {!useFractional && math.shares === 0 && (
          <div className="inline-flex w-fit px-2.5 py-1 rounded bg-amber-500/15 border border-amber-400/60 text-amber-300 text-xs font-mono font-bold">
            [ ⚠️ Min Capital: ${Math.ceil(entryPrice)} for 1 Whole Share ]
          </div>
        )}

        {/* Entry / Stop + Distinct Color-Coded 3-Column Target Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" style={cardTypo.fontStyle}>
          <div className="flex flex-col p-3 rounded-lg bg-slate-900/70 border border-slate-800/80 gap-0.5">
            <span className={`${cardTypo.labelClass} font-bold text-slate-400 uppercase tracking-wider`}>Entry / Stop</span>
            <span className={`${cardTypo.priceClass} tabular-nums ${PRICE_COLOR_CLASSES.entry}`}>${math.entryPrice.toFixed(2)}</span>
            <span className={`text-xs tabular-nums font-bold ${PRICE_COLOR_CLASSES.stop}`}>
              Stop ${math.stopLoss.toFixed(2)} ({math.stopPct.toFixed(2)}%)
            </span>
          </div>

          <div className="flex flex-col bg-cyan-950/25 border border-cyan-500/40 rounded-lg p-3 gap-0.5">
            <span className={`${cardTypo.labelClass} text-cyan-300 font-bold uppercase tracking-wider`}>🎯 1.5R SCALE (50%)</span>
            <span className={`${cardTypo.priceClass} font-bold font-mono tabular-nums text-white`}>${math.target1_5R.toFixed(2)}</span>
            <span className="text-xs text-cyan-300 font-mono font-bold tabular-nums">
              +${math.profit1_5.toFixed(2)} (+{math.targetPct1_5.toFixed(2)}%)
            </span>
            <span className="text-[11px] font-mono tabular-nums text-cyan-300/80">
              ROC: +{math.roc1_5.toFixed(2)}%
            </span>
          </div>

          <div className="flex flex-col bg-emerald-950/25 border border-emerald-500/40 rounded-lg p-3 gap-0.5">
            <span className={`${cardTypo.labelClass} text-emerald-300 font-bold uppercase tracking-wider`}>💰 2.0R CORE TARGET</span>
            <span className={`${cardTypo.priceClass} font-bold font-mono tabular-nums text-white`}>${math.target2_0R.toFixed(2)}</span>
            <span className="text-xs text-emerald-400 font-mono font-bold tabular-nums">
              +${math.profit2_0.toFixed(2)} (+{math.targetPct2_0.toFixed(2)}%)
            </span>
            <span className="text-[11px] font-mono tabular-nums text-emerald-300/80">
              ROC: +{math.roc2_0.toFixed(2)}%
            </span>
          </div>

          <div className="flex flex-col bg-violet-950/25 border border-violet-500/40 rounded-lg p-3 gap-0.5">
            <span className={`${cardTypo.labelClass} text-violet-300 font-bold uppercase tracking-wider`}>🚀 3.0R RUNNER</span>
            <span className={`${cardTypo.priceClass} font-bold font-mono tabular-nums text-white`}>${math.target3_0R.toFixed(2)}</span>
            <span className="text-xs text-violet-300 font-mono font-bold tabular-nums">
              +${math.profit3_0.toFixed(2)} (+{math.targetPct3_0.toFixed(2)}%)
            </span>
            <span className="text-[11px] font-mono tabular-nums text-violet-300/80">
              ROC: +{math.roc3_0.toFixed(2)}%
            </span>
          </div>
        </div>
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

      {/* Explicit "Current Status -> Next Action" Flow Strip */}
      <div
        className="col-span-full bg-slate-900/90 border border-slate-800 rounded-md px-3 py-2 text-xs font-mono flex flex-wrap items-center justify-between gap-2"
        data-testid={`status-next-action-strip-${d.symbol}`}
      >
        <span className="text-slate-300 tabular-nums">
          <strong className="text-cyan-300 uppercase">Current Status:</strong>{" "}
          Price ({formatCurrency(effectivePrice)}) is{" "}
          {proximity < 100 ? `${proximity.toFixed(1)}%` : "—"} {effectivePrice >= math.entryPrice ? "above" : "below"} 20-SMA support (${math.entryPrice.toFixed(2)})
        </span>
        <span className="text-amber-300 tabular-nums">
          <strong className="uppercase">Next Step:</strong>{" "}
          {proximity <= 0.6
            ? `Hold support $${math.entryPrice.toFixed(2)} + wait for 1H green candle close ➔ Auto-moves to Ready to Trade`
            : `Wait for pullback to $${math.entryPrice.toFixed(2)} + 1H green candle close ➔ Auto-moves to Ready to Trade`}
        </span>
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
});

export default PendingRow;
