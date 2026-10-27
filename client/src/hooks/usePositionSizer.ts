import { useMemo, useEffect } from "react";
import { useGlobalState } from "@/lib/globalState";

export interface PositionSizerInput {
  accountEquity?: number | null;
  riskPercentage?: number | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
}

export interface PositionSizerResult {
  accountEquity: number;
  riskPercentage: number;
  entryPrice: number;
  stopLossPrice: number;
  dollarRiskPerShare: number;
  totalDollarRiskAllowed: number;
  calculatedShares: number;
  totalCapitalRequired: number;
  portfolioAllocationPercent: number;
  t1Shares: number;
  t2Shares: number;
  isMarginRequired: boolean;
  warningMessage: string | null;
}

export const DEFAULT_ACCOUNT_EQUITY = 25000;
export const DEFAULT_RISK_PERCENTAGE = 1.0;

/**
 * Pure calculation function for risk-based position sizing.
 */
export function calculatePositionSize(input: PositionSizerInput): PositionSizerResult {
  const safeEquity = Number(input?.accountEquity) || DEFAULT_ACCOUNT_EQUITY;
  const accountEquity = safeEquity > 0 ? safeEquity : DEFAULT_ACCOUNT_EQUITY;

  const safeRiskPct = Number(input?.riskPercentage) || DEFAULT_RISK_PERCENTAGE;
  const riskPercentage = safeRiskPct > 0 ? safeRiskPct : DEFAULT_RISK_PERCENTAGE;

  const entry = typeof input?.entryPrice === "number" && !isNaN(input.entryPrice) ? input.entryPrice : 0;
  const stop = typeof input?.stopLossPrice === "number" && !isNaN(input.stopLossPrice) ? input.stopLossPrice : 0;

  // Formula: dollarRiskPerShare = |entryPrice - stopLossPrice|
  const rawRiskPerShare = Math.abs(entry - stop);
  const dollarRiskPerShare = Math.round(rawRiskPerShare * 10000) / 10000;

  // Formula: totalDollarRiskAllowed = accountEquity * (riskPercentage / 100)
  const totalDollarRiskAllowed = accountEquity * (riskPercentage / 100);

  let calculatedShares = 0;
  // Safety guard: If dollarRiskPerShare <= 0 or invalid (or entry <= 0 or stop <= 0), return 0 shares to prevent division by zero
  if (dollarRiskPerShare > 0.0001 && entry > 0 && stop > 0) {
    // Formula: calculatedShares = floor(totalDollarRiskAllowed / dollarRiskPerShare)
    // Adding 1e-9 prevents float division floor imprecision (e.g. 249.999999999999 / 2.5)
    calculatedShares = Math.floor((totalDollarRiskAllowed / dollarRiskPerShare) + 1e-9);
  }

  // Formula: totalCapitalRequired = calculatedShares * entryPrice
  const totalCapitalRequired = calculatedShares * entry;

  // Formula: portfolioAllocationPercent = (totalCapitalRequired / accountEquity) * 100
  const portfolioAllocationPercent = accountEquity > 0 ? (totalCapitalRequired / accountEquity) * 100 : 0;

  // Scale-out split:
  // t1Shares = floor(calculatedShares / 2) (50% scale-out)
  // t2Shares = calculatedShares - t1Shares (Remaining 50% core runner)
  const t1Shares = Math.floor(calculatedShares / 2);
  const t2Shares = calculatedShares - t1Shares;

  // Safety guard: If totalCapitalRequired > accountEquity, display subtle warning flag
  const isMarginRequired = totalCapitalRequired > accountEquity;
  const warningMessage = isMarginRequired ? "Exceeds Available Cash (Margin Required)" : null;

  return {
    accountEquity,
    riskPercentage,
    entryPrice: entry,
    stopLossPrice: stop,
    dollarRiskPerShare,
    totalDollarRiskAllowed,
    calculatedShares,
    totalCapitalRequired,
    portfolioAllocationPercent,
    t1Shares,
    t2Shares,
    isMarginRequired,
    warningMessage,
  };
}

/**
 * React hook to compute dynamic risk-based position sizing using global or overridden settings.
 */
export function usePositionSizer(input?: PositionSizerInput): PositionSizerResult {
  let globalEquity: number | undefined;
  let globalRiskPct: number | undefined;

  try {
    const global = useGlobalState();
    globalEquity = global?.accountEquity ?? (global as any)?.equity;
    globalRiskPct = global?.riskPercentage;
  } catch {
    // Graceful fallback outside GlobalStateProvider
  }

  const accountEquity = input?.accountEquity ?? globalEquity ?? DEFAULT_ACCOUNT_EQUITY;
  const safeEquity = Number(accountEquity) || DEFAULT_ACCOUNT_EQUITY;
  const effectiveRiskPct = Number(input?.riskPercentage ?? globalRiskPct) || DEFAULT_RISK_PERCENTAGE;

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log('[Risk Engine] Account Equity:', safeEquity);
    }
  }, [safeEquity]);

  return useMemo(() => {
    try {
      return calculatePositionSize({
        accountEquity: safeEquity,
        riskPercentage: effectiveRiskPct,
        entryPrice: input?.entryPrice,
        stopLossPrice: input?.stopLossPrice,
      });
    } catch (err) {
      console.warn("[usePositionSizer] Calculation error fallback:", err);
      return calculatePositionSize({
        accountEquity: DEFAULT_ACCOUNT_EQUITY,
        riskPercentage: DEFAULT_RISK_PERCENTAGE,
        entryPrice: 0,
        stopLossPrice: 0,
      });
    }
  }, [safeEquity, effectiveRiskPct, input?.entryPrice, input?.stopLossPrice]);
}

export default usePositionSizer;

