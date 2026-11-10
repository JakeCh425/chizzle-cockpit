import { useMemo } from "react";
import type { SwingDecision } from "@shared/swingDecision";
import { obstacleBefore } from "@shared/practicePlan";
import { useOptionalGlobalState } from "@/lib/globalState";

export interface QualityTradeValidation {
  regimeValid: boolean;           // 4H 20-SMA or 10-EMA intact and sloping favorably
  supportInteraction: boolean;   // Price touched/tested the moving average within 0.5%
  confirmationBar: boolean;       // 1H closed green candle holding the SMA line
  structuralResistanceOk: boolean;// Target 1 sits strictly BEFORE any overhead resistance
  riskRewardRatio: number;        // (Target1 - Entry) / (Entry - Stop) >= 1.5, Target 2 >= 2.0
  cashRequirementMet: boolean;    // Total capital allocated <= available cash balance
}

export interface QualityValidationInput {
  symbol?: string;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  target1?: number | null;
  target2?: number | null;
  currentPrice?: number | null;
  structureLevels?: { price: number; kind?: string }[];
  resistanceZone?: { low?: number; high?: number } | null;
  availableCash?: number | null;
  allocatedCapital?: number | null;
  shares?: number | null;
  marketRegime?: string | null;
  isStandbyDay?: boolean;
  sma4h20?: number | null;
  sma4h50?: number | null;
  sma20Price?: number | null;
  ema10Price?: number | null;
  testedLine?: string | null;
  supportHeld?: boolean;
  is1HCandleClosedGreen?: boolean;
  candleConfirmation?: boolean;
  setupStatus?: string;
  riskRewardRatio?: number | null;
  decision?: SwingDecision | null;
}

export interface QualityValidationResult {
  validation: QualityTradeValidation;
  isValid: boolean;
  unmetKey: keyof QualityTradeValidation | null;
  unmetReason: string | null;
  unmetBadge: string | null;
}

export const UNMET_BADGES: Record<keyof QualityTradeValidation, string> = {
  regimeValid: "[ 🔒 BEARISH REGIME: 4H TREND DOWN ]",
  supportInteraction: "[ 🔒 PRICE DID NOT TEST SUPPORT (0.5%) ]",
  confirmationBar: "[ 🔒 CONFIRMATION PENDING: AWAITING 1H GREEN CLOSE ]",
  structuralResistanceOk: "[ 🔒 OVERHEAD RESISTANCE SITS BEFORE T1 ]",
  riskRewardRatio: "[ 🔒 INSUFFICIENT RISK/REWARD (MIN 1.5R) ]",
  cashRequirementMet: "[ 🔒 INSUFFICIENT CASH BALANCE ]",
};

export const UNMET_REASONS: Record<keyof QualityTradeValidation, string> = {
  regimeValid: "4H trend is bearish (20-SMA is below 50-SMA); long setups are blocked.",
  supportInteraction: "Price has not touched/tested the 20-SMA or 10-EMA support within 0.5%.",
  confirmationBar: "Awaiting 1H green candle close holding the moving average support.",
  structuralResistanceOk: "Target 1 sits beyond an overhead structural resistance level.",
  riskRewardRatio: "Risk/Reward ratio is below the 1.50R minimum execution threshold.",
  cashRequirementMet: "Total capital required exceeds available cash balance.",
};

/**
 * Pure evaluation function for Execution-Quality Gatekeeper.
 * Returns QualityTradeValidation booleans and specific unmet criteria.
 */
export function evaluateQualityTradeValidation(input: QualityValidationInput): QualityValidationResult {
  const d = input.decision;
  const entry = input.entryPrice ?? d?.entryPrice ?? null;
  const stop = input.stopLossPrice ?? d?.structuralStop ?? null;
  const t1 = input.target1 ?? d?.target1 ?? null;
  const price = input.currentPrice ?? d?.currentPrice ?? entry;

  // 1. Regime Valid (4H 20-SMA > 50-SMA or 10-EMA favorable, Standby Day blocks)
  const isStandby = Boolean(input.isStandbyDay ?? (d as any)?.isStandbyDay ?? (d as any)?.marketRegime === "BEARISH");
  const sma4h20 = input.sma4h20 ?? (d as any)?.sma4h20;
  const sma4h50 = input.sma4h50 ?? (d as any)?.sma4h50;
  const regimeBearish = (sma4h20 != null && sma4h50 != null && sma4h20 < sma4h50);
  const regimeValid = !isStandby && !regimeBearish;

  // 2. Support Interaction (Touched/tested moving average within 0.5%)
  const sma20 = input.sma20Price ?? (d as any)?.sma20Price ?? (d as any)?.sma20;
  const ema10 = input.ema10Price ?? (d as any)?.ema10Price ?? (d as any)?.ema10;
  let supportInteraction = Boolean(
    input.testedLine ||
    input.supportHeld ||
    (d as any)?.testedLine ||
    (d as any)?.supportHeld ||
    input.setupStatus === "CONFIRMED_1H_CLOSE" ||
    input.setupStatus === "READY_TO_TRADE" ||
    d?.setupStatus === "READY_TO_TRADE" ||
    d?.setupStatus === "CONFIRMED_1H_CLOSE"
  );
  if (!supportInteraction && price != null) {
    if (sma20 != null && sma20 > 0) {
      supportInteraction = Math.abs(price - sma20) / sma20 <= 0.005;
    }
    if (!supportInteraction && ema10 != null && ema10 > 0) {
      supportInteraction = Math.abs(price - ema10) / ema10 <= 0.005;
    }
  }

  // 3. Confirmation Bar (1H closed green candle holding the SMA line)
  const is1HGreen = input.is1HCandleClosedGreen ?? input.candleConfirmation ?? (d as any)?.is1HCandleClosedGreen ?? (d as any)?.candleConfirmation;
  const isStatusConfirmed = input.setupStatus === "CONFIRMED_1H_CLOSE" || input.setupStatus === "READY_TO_TRADE" || d?.setupStatus === "READY_TO_TRADE";
  const confirmationBar = Boolean(is1HGreen !== false && (is1HGreen === true || isStatusConfirmed));

  // 4. Structural Resistance OK (Target 1 sits strictly BEFORE any overhead resistance)
  const levels = input.structureLevels ?? d?.structureLevels ?? [];
  const obstacle = obstacleBefore(levels, entry, t1);
  let structuralResistanceOk = true;
  if (obstacle && t1 != null && obstacle.price < t1 - 0.005) {
    structuralResistanceOk = false;
  }
  const rz = input.resistanceZone ?? d?.resistanceZone;
  if (structuralResistanceOk && rz?.low != null && entry != null && t1 != null) {
    if (rz.low > entry * 1.001 && t1 > rz.low + 0.005) {
      structuralResistanceOk = false;
    }
  }

  // 5. Risk Reward Ratio ((Target1 - Entry) / (Entry - Stop) >= 1.5)
  let riskRewardRatio = input.riskRewardRatio ?? d?.rewardRiskT1 ?? 0;
  if ((riskRewardRatio == null || riskRewardRatio <= 0) && entry != null && stop != null && t1 != null) {
    const risk = Math.abs(entry - stop);
    if (risk > 0.0001) {
      riskRewardRatio = Math.round(((t1 - entry) / risk) * 100) / 100;
    }
  }
  const isRrValid = riskRewardRatio >= 1.49; // 1.5R allowing float rounding

  // 6. Cash Requirement Met (Total capital allocated <= available cash balance)
  const cash = input.availableCash;
  const cost = input.allocatedCapital ?? (input.shares != null && entry != null ? input.shares * entry : null);
  let cashRequirementMet = true;
  if (cash != null && cost != null) {
    cashRequirementMet = cost <= cash && cost > 0;
  } else if (input.shares === 0) {
    cashRequirementMet = false;
  }

  const validation: QualityTradeValidation = {
    regimeValid,
    supportInteraction,
    confirmationBar,
    structuralResistanceOk,
    riskRewardRatio: riskRewardRatio || 0,
    cashRequirementMet,
  };

  let unmetKey: keyof QualityTradeValidation | null = null;
  if (!regimeValid) unmetKey = "regimeValid";
  else if (!supportInteraction) unmetKey = "supportInteraction";
  else if (!confirmationBar) unmetKey = "confirmationBar";
  else if (!structuralResistanceOk) unmetKey = "structuralResistanceOk";
  else if (!isRrValid) unmetKey = "riskRewardRatio";
  else if (!cashRequirementMet) unmetKey = "cashRequirementMet";

  const isValid = unmetKey === null;
  const unmetReason = unmetKey ? UNMET_REASONS[unmetKey] : null;
  const unmetBadge = unmetKey ? UNMET_BADGES[unmetKey] : null;

  return {
    validation,
    isValid,
    unmetKey,
    unmetReason,
    unmetBadge,
  };
}

/**
 * React hook to evaluate Quality Trade Validation for active setup.
 */
export function useQualityTradeValidation(input: QualityValidationInput): QualityValidationResult {
  const global = useOptionalGlobalState();
  const availableCash = input.availableCash ?? global?.availableCash;

  return useMemo(() => {
    return evaluateQualityTradeValidation({
      ...input,
      availableCash,
    });
  }, [
    input.symbol,
    input.entryPrice,
    input.stopLossPrice,
    input.target1,
    input.target2,
    input.currentPrice,
    input.structureLevels,
    input.resistanceZone,
    availableCash,
    input.allocatedCapital,
    input.shares,
    input.marketRegime,
    input.isStandbyDay,
    input.sma4h20,
    input.sma4h50,
    input.sma20Price,
    input.ema10Price,
    input.testedLine,
    input.supportHeld,
    input.is1HCandleClosedGreen,
    input.candleConfirmation,
    input.setupStatus,
    input.riskRewardRatio,
    input.decision,
  ]);
}

export default useQualityTradeValidation;
