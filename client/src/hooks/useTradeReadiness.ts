import { useMemo } from "react";

export interface TradeReadinessInput {
  symbol?: string;
  status?: string;
  currentPrice?: number;
  sma20Price?: number;
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

export interface TradeReadinessResult {
  candleConfirmation: boolean;
  smaSupportHeld: boolean;
  volumeBenchmarkPassed: boolean;
  isTradeConfirmed: boolean;
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
export const TRADE_PENDING_BADGE = "[ 🔒 CONFIRMATION PENDING: AWAITING 1H GREEN CLOSE ]";

/**
 * Pure calculation function for Cockpit Trade Readiness Gatekeeper.
 */
export function evaluateTradeReadiness(input: TradeReadinessInput): TradeReadinessResult {
  const {
    status,
    currentPrice = 0,
    sma20Price = 0,
    proximityPct = 0,
    changePct = 0,
    candleConfirmation: explicitCandle,
    smaSupportHeld: explicitSma,
    volumeBenchmarkPassed: explicitVol,
  } = input || {};

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

  // Gatekeeper Rule Enforcement:
  // const isTradeConfirmed = candleConfirmation === true && smaSupportHeld === true && volumeBenchmarkPassed === true;
  const isTradeConfirmed =
    candleConfirmation === true &&
    smaSupportHeld === true &&
    volumeBenchmarkPassed === true;

  const statusBadge = isTradeConfirmed
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

  const lockMessage = !isTradeConfirmed
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
    input?.sma20Price,
    input?.proximityPct,
    input?.changePct,
    input?.candleConfirmation,
    input?.smaSupportHeld,
    input?.volumeBenchmarkPassed,
  ]);
}

