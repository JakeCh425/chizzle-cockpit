import { useMemo } from "react";

export interface ExecutionTriggerStatus {
  isBuySignal: boolean;
  isTargetHit: boolean;
  isStopHit: boolean;
  activeSignalText: string | null;
  signalType: "BUY" | "TARGET_HIT" | "STOP_HIT" | null;
}

/**
 * Pure evaluation function that compares the live candle's close price and current live price
 * against the user's defined Entry, StopLoss, and Target state variables.
 */
export function computeExecutionTriggers(
  livePrice: number | null | undefined,
  candleClose: number | null | undefined,
  entryPrice: number | null | undefined,
  stopLoss: number | null | undefined,
  targetPrice: number | null | undefined
): ExecutionTriggerStatus {
  const p = livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : null;
  const c = candleClose != null && Number.isFinite(candleClose) && candleClose > 0 ? candleClose : p;
  const entry = entryPrice != null && Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null;
  const stop = stopLoss != null && Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : null;
  const target = targetPrice != null && Number.isFinite(targetPrice) && targetPrice > 0 ? targetPrice : null;

  if (!p && !c) {
    return {
      isBuySignal: false,
      isTargetHit: false,
      isStopHit: false,
      activeSignalText: null,
      signalType: null,
    };
  }

  const current = c ?? p!;

  // 1. Target Hit check (Highest priority take-profit exit)
  if (target != null && p != null && p >= target) {
    return {
      isBuySignal: false,
      isTargetHit: true,
      isStopHit: false,
      activeSignalText: "SELL - TARGET HIT",
      signalType: "TARGET_HIT",
    };
  }

  // 2. Stop Loss Hit check (Risk protection exit)
  if (stop != null && p != null && p <= stop) {
    return {
      isBuySignal: false,
      isTargetHit: false,
      isStopHit: true,
      activeSignalText: "SELL - STOP HIT",
      signalType: "STOP_HIT",
    };
  }

  // 3. Buy Signal (Live candle closes above defined Entry line)
  if (entry != null && current >= entry) {
    return {
      isBuySignal: true,
      isTargetHit: false,
      isStopHit: false,
      activeSignalText: "BUY SIGNAL - EXECUTE",
      signalType: "BUY",
    };
  }

  return {
    isBuySignal: false,
    isTargetHit: false,
    isStopHit: false,
    activeSignalText: null,
    signalType: null,
  };
}

/**
 * Logic hook that compares the live candle's close price and current live price
 * against the user's defined Entry, StopLoss, and Target state variables.
 *
 * - If live 1-hour candle closes or trades above Entry -> [ BUY SIGNAL - EXECUTE ]
 * - If live price hits or exceeds Target -> [ SELL - TARGET HIT ]
 * - If live price hits or drops below StopLoss -> [ SELL - STOP HIT ]
 */
export function useExecutionTriggers(
  livePrice: number | null | undefined,
  candleClose: number | null | undefined,
  entryPrice: number | null | undefined,
  stopLoss: number | null | undefined,
  targetPrice: number | null | undefined
): ExecutionTriggerStatus {
  return useMemo(
    () => computeExecutionTriggers(livePrice, candleClose, entryPrice, stopLoss, targetPrice),
    [livePrice, candleClose, entryPrice, stopLoss, targetPrice]
  );
}

export default useExecutionTriggers;
