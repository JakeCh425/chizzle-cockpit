import { useMemo } from "react";

export interface TradeReadinessInput {
  symbol?: string;
  status?: string;
  currentPrice?: number;
  entryPrice?: number;
  sma20Price?: number;
  atr?: number;
  maxEntryTolerance?: number;
  tolerancePct?: number;
  proximityPct?: number;
  changePct?: number;
  // Direct boolean overrides if provided by upstream feed or user toggle
  candleConfirmation?: boolean;
  smaSupportHeld?: boolean;
  volumeBenchmarkPassed?: boolean;
}

export interface TradeCheckItem {
  id: "sma-support" | "candle-close" | "volume-threshold";
  checkNumber: 1 | 2 | 3;
  title: string;
  description: string;
  passed: boolean;
  statusLabel: string;
}

export interface EntryChaseEvaluation {
  entryPrice: number;
  currentPrice: number;
  maxEntryTolerance: number;
  maxChaseBuffer: number;
  maxAllowedEntryPrice: number;
  isWithinChaseBuffer: boolean;
  isEntryMissed: boolean;
  chaseStatusBadge: "[ GREEN / READY TO ARM ]" | "[ ENTRY MISSED - DO NOT CHASE ]";
  notTradeableReason: string | null;
  primaryActionLabel: "Arm Trade" | "[ SET PULLBACK LIMIT ]";
  isMarketExecutionDisabled: boolean;
  pullbackLimitPrice: number;
}

export interface TradeReadinessResult {
  candleConfirmation: boolean;
  smaSupportHeld: boolean;
  volumeBenchmarkPassed: boolean;
  isTradeConfirmed: boolean;
  isTradeReady: boolean;
  isWithinChaseBuffer: boolean;
  isEntryMissed: boolean;
  maxChaseBuffer: number;
  maxEntryTolerance: number;
  maxAllowedEntryPrice: number;
  chaseStatusBadge: "[ GREEN / READY TO ARM ]" | "[ ENTRY MISSED - DO NOT CHASE ]";
  primaryActionLabel: "Arm Trade" | "[ SET PULLBACK LIMIT ]";
  pullbackLimitPrice: number;
  statusBadge: {
    text: string;
    badgeClass: string;
    isConfirmed: boolean;
  };
  lockMessage: string;
  checks: TradeCheckItem[];
}

export const TRADE_LOCKED_TOOLTIP = "Trade locked. Awaiting Cockpit 1H candle confirmation.";
export const TRADE_CONFIRMED_BADGE = "[ ⚡ ALL RULES MET — READY TO ARM ]";
export const TRADE_READY_BANNER_TEXT = "[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]";
export const TRADE_PENDING_BADGE = "[ 🔒 CONFIRMATION PENDING: AWAITING 1H GREEN CLOSE ]";
export const TRADE_READY_TO_ARM_BADGE = "[ GREEN / READY TO ARM ]";
export const TRADE_ENTRY_MISSED_BADGE = "[ ENTRY MISSED - DO NOT CHASE ]";
export const TRADE_NOT_TRADEABLE_ENTRY_MISSED_BADGE = "NOT TRADEABLE YET - ENTRY MISSED";
export const ENTRY_MISSED_RETEST_WARNING = "ENTRY MISSED, WAIT FOR RETEST";
export const SET_PULLBACK_LIMIT_LABEL = "[ SET PULLBACK LIMIT ]";

/**
 * Computes maxChaseBuffer equal to 0.20% of the asset's price or 15% of the asset's ATR:
 * maxChaseBuffer = Math.max(0.0020 * basePrice, 0.15 * atr)
 */
export function calculateMaxChaseBuffer(params: {
  entryPrice: number;
  currentPrice?: number;
  atr?: number;
}): number {
  const { entryPrice, currentPrice = 0, atr } = params || {};
  const basePrice = entryPrice > 0 ? entryPrice : currentPrice;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;

  const pctBuffer = basePrice * 0.002; // 0.20% of asset price
  const atrBuffer = atr != null && Number.isFinite(atr) && atr > 0 ? atr * 0.15 : 0; // 15% of asset ATR
  return +(Math.max(pctBuffer, atrBuffer)).toFixed(4);
}

/**
 * Computes the Max Chase Proximity Buffer (`maxEntryTolerance`) tied to the asset's ATR
 * or a fixed percentage (0.15% to 0.25% of entry/current price).
 */
export function calculateMaxEntryTolerance(params: {
  entryPrice: number;
  currentPrice?: number;
  atr?: number;
  tolerancePct?: number;
}): number {
  const { entryPrice, currentPrice = 0, atr, tolerancePct = 0.0025 } = params || {};
  const basePrice = entryPrice > 0 ? entryPrice : currentPrice;
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;

  const clampedPct = Math.max(0.0015, Math.min(0.0025, tolerancePct));
  const pctTolerance = basePrice * clampedPct;

  if (atr != null && Number.isFinite(atr) && atr > 0) {
    // Tie to asset's ATR (0.10 * ATR) bounded within [0.15%, 0.25%] of price so small ticks pass without degrading R:R
    const minTol = basePrice * 0.0015;
    const maxTol = basePrice * 0.0025;
    return +(Math.min(maxTol, Math.max(minTol, atr * 0.1))).toFixed(4);
  }

  return +pctTolerance.toFixed(4);
}

/**
 * Evaluates whether currentPrice is within the Max Chase Proximity Buffer:
 * - If currentPrice <= entryPrice + maxEntryTolerance -> [ GREEN / READY TO ARM ]
 * - If currentPrice > entryPrice + maxEntryTolerance  -> [ ENTRY MISSED - DO NOT CHASE ] / NOT TRADEABLE YET - ENTRY MISSED
 */
export function evaluateEntryChaseStatus(params: {
  entryPrice: number;
  currentPrice: number;
  atr?: number;
  maxEntryTolerance?: number;
  tolerancePct?: number;
}): EntryChaseEvaluation {
  const { entryPrice, currentPrice, atr, tolerancePct = 0.0025 } = params;
  const maxChaseBuffer = calculateMaxChaseBuffer({ entryPrice, currentPrice, atr });
  const maxEntryTolerance =
    params.maxEntryTolerance != null && Number.isFinite(params.maxEntryTolerance)
      ? params.maxEntryTolerance
      : Math.max(calculateMaxEntryTolerance({ entryPrice, currentPrice, atr, tolerancePct }), maxChaseBuffer);

  const maxAllowedEntryPrice = +(entryPrice + maxEntryTolerance).toFixed(4);
  const isWithinChaseBuffer = entryPrice <= 0 || currentPrice <= entryPrice + maxEntryTolerance + 1e-9;
  const isEntryMissed = entryPrice > 0 && currentPrice > entryPrice + maxEntryTolerance + 1e-9;

  return {
    entryPrice,
    currentPrice,
    maxEntryTolerance,
    maxChaseBuffer,
    maxAllowedEntryPrice,
    isWithinChaseBuffer,
    isEntryMissed,
    chaseStatusBadge: isEntryMissed ? TRADE_ENTRY_MISSED_BADGE : TRADE_READY_TO_ARM_BADGE,
    notTradeableReason: isEntryMissed ? TRADE_NOT_TRADEABLE_ENTRY_MISSED_BADGE : null,
    primaryActionLabel: isEntryMissed ? SET_PULLBACK_LIMIT_LABEL : "Arm Trade",
    isMarketExecutionDisabled: isEntryMissed,
    pullbackLimitPrice: +(entryPrice > 0 ? entryPrice : currentPrice).toFixed(2),
  };
}

/**
 * Pure calculation function for Cockpit Trade Readiness Gatekeeper.
 */
export function evaluateTradeReadiness(input: TradeReadinessInput): TradeReadinessResult {
  const {
    status,
    currentPrice = 0,
    entryPrice = 0,
    sma20Price = 0,
    atr,
    maxEntryTolerance: explicitTolerance,
    tolerancePct = 0.0025,
    proximityPct = 0,
    changePct = 0,
    candleConfirmation: explicitCandle,
    smaSupportHeld: explicitSma,
    volumeBenchmarkPassed: explicitVol,
  } = input || {};

  // Evaluate Max Chase Proximity Buffer when entryPrice is provided
  const chaseEval = evaluateEntryChaseStatus({
    entryPrice,
    currentPrice,
    atr,
    maxEntryTolerance: explicitTolerance,
    tolerancePct,
  });

  const isStatusExtendedOrRetest =
    status === "Retest" ||
    status === "Extended" ||
    status === "WATCH_RETEST" ||
    status === "WATCH_EXTENDED" ||
    status === "ENTRY_MISSED";

  const isEntryMissed = chaseEval.isEntryMissed || isStatusExtendedOrRetest;
  const isWithinChaseBuffer = !isEntryMissed;

  // 1. Structural 20-SMA Support: Is price actively bouncing/holding support?
  let smaSupportHeld = false;
  if (typeof explicitSma === "boolean") {
    smaSupportHeld = explicitSma;
  } else if (status === "Ready" || status === "Awaiting Close") {
    smaSupportHeld = true;
  } else if (status === "Forming") {
    smaSupportHeld = false;
  } else {
    smaSupportHeld = proximityPct <= 2.5 || (sma20Price > 0 && currentPrice >= sma20Price * 0.99);
  }

  // 2. 1H Candle Close: Has the 1-hour execution candle closed green above trigger price?
  let candleConfirmation = false;
  if (typeof explicitCandle === "boolean") {
    candleConfirmation = explicitCandle;
  } else if (status === "Ready") {
    candleConfirmation = true;
  } else if (status === "Awaiting Close" || status === "Forming") {
    candleConfirmation = false;
  } else {
    candleConfirmation = changePct >= 0 && proximityPct < 2.0;
  }

  // 3. Volume Threshold: Is volume tracking >= 1.2x average benchmark volume?
  let volumeBenchmarkPassed = false;
  if (typeof explicitVol === "boolean") {
    volumeBenchmarkPassed = explicitVol;
  } else if (status === "Ready" || status === "Awaiting Close") {
    volumeBenchmarkPassed = true;
  } else if (status === "Forming") {
    volumeBenchmarkPassed = false;
  } else {
    volumeBenchmarkPassed = true;
  }

  // Gatekeeper Rule Enforcement + Max Chase Proximity Buffer:
  // If currentPrice > entryPrice + maxEntryTolerance, isEntryMissed is true -> disables market execution!
  const rulesMet =
    candleConfirmation === true &&
    smaSupportHeld === true &&
    volumeBenchmarkPassed === true;

  const isTradeConfirmed = rulesMet && isWithinChaseBuffer;
  const isTradeReady = isTradeConfirmed && isWithinChaseBuffer;

  const statusBadge = isEntryMissed
    ? {
        text: TRADE_ENTRY_MISSED_BADGE,
        badgeClass:
          "bg-rose-500/20 text-rose-300 border-rose-500/50 bg-rose-950/30 shadow-[0_0_15px_rgba(244,63,94,0.3)]",
        isConfirmed: false,
      }
    : isTradeConfirmed
    ? {
        text: TRADE_CONFIRMED_BADGE,
        badgeClass:
          "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse bg-emerald-950/20 shadow-[0_0_15px_rgba(0,230,118,0.4)]",
        isConfirmed: true,
      }
    : {
        text: TRADE_PENDING_BADGE,
        badgeClass: "bg-amber-500/20 text-amber-300 border-amber-400/50 bg-amber-950/20",
        isConfirmed: false,
      };

  const lockMessage = isEntryMissed
    ? "NOT TRADEABLE YET - ENTRY MISSED. Price escaped beyond Max Chase tolerance. Market execution disabled; use [ SET PULLBACK LIMIT ] to stage a limit buy at original 20-SMA support."
    : !isTradeConfirmed
    ? TRADE_LOCKED_TOOLTIP
    : "All rules met. Ready to arm practice trade.";

  const checks: TradeCheckItem[] = [
    {
      id: "sma-support",
      checkNumber: 1,
      title: "Structural 20-SMA Support",
      description: "Is price actively bouncing/holding support?",
      passed: smaSupportHeld,
      statusLabel: smaSupportHeld ? "Holding Support" : "Testing Support",
    },
    {
      id: "candle-close",
      checkNumber: 2,
      title: "1H Candle Close",
      description: "Has the 1-hour execution candle closed green above trigger price?",
      passed: candleConfirmation,
      statusLabel: candleConfirmation ? "Green Close Confirmed" : "Awaiting 1H Close",
    },
    {
      id: "volume-threshold",
      checkNumber: 3,
      title: "Volume Threshold",
      description: "Is volume tracking ≥ 1.2x average benchmark volume?",
      passed: volumeBenchmarkPassed,
      statusLabel: volumeBenchmarkPassed ? "≥ 1.2x Benchmark" : "Below 1.2x Benchmark",
    },
  ];

  return {
    candleConfirmation,
    smaSupportHeld,
    volumeBenchmarkPassed,
    isTradeConfirmed,
    isTradeReady,
    isWithinChaseBuffer,
    isEntryMissed,
    maxChaseBuffer: chaseEval.maxChaseBuffer,
    maxEntryTolerance: chaseEval.maxEntryTolerance,
    maxAllowedEntryPrice: chaseEval.maxAllowedEntryPrice,
    chaseStatusBadge: isEntryMissed ? TRADE_ENTRY_MISSED_BADGE : TRADE_READY_TO_ARM_BADGE,
    primaryActionLabel: isEntryMissed ? SET_PULLBACK_LIMIT_LABEL : "Arm Trade",
    pullbackLimitPrice: chaseEval.pullbackLimitPrice,
    statusBadge,
    lockMessage,
    checks,
  };
}

/**
 * Cockpit Confirmation Gatekeeper Hook (useTradeReadiness)
 */
export function useTradeReadiness(input: TradeReadinessInput): TradeReadinessResult {
  return useMemo(() => evaluateTradeReadiness(input), [
    input?.symbol,
    input?.status,
    input?.currentPrice,
    input?.entryPrice,
    input?.sma20Price,
    input?.atr,
    input?.maxEntryTolerance,
    input?.tolerancePct,
    input?.proximityPct,
    input?.changePct,
    input?.candleConfirmation,
    input?.smaSupportHeld,
    input?.volumeBenchmarkPassed,
  ]);
}

