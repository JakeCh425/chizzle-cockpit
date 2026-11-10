import { useMemo, useEffect } from "react";
import { useGlobalState } from "@/lib/globalState";

export interface PositionSizerInput {
  accountEquity?: number | null;
  riskPercentage?: number | null;
  entryPrice?: number | null;
  stopLossPrice?: number | null;
  availableCash?: number | null;
}

export interface PositionSizerResult {
  accountEquity: number;
  availableCash: number;
  riskPercentage: number;
  entryPrice: number;
  stopLossPrice: number;
  dollarRiskPerShare: number;
  totalDollarRiskAllowed: number;
  calculatedShares: number;
  sharesAllowed: number;
  positionCost: number;
  totalCapitalRequired: number;
  portfolioAllocationPercent: number;
  t1Shares: number;
  t2Shares: number;
  isMarginRequired: boolean;
  isInsufficientCash: boolean;
  warningMessage: string | null;
}

export const DEFAULT_ACCOUNT_EQUITY = 25000;
export const DEFAULT_RISK_PERCENTAGE = 1.0;

/**
 * Pure calculation function for risk-based position sizing with cash limit guard.
 * Enforces: maxShares = Math.min(Math.floor(riskBudget / riskPerShare), Math.floor(availableCash / entryPrice))
 * Automatically downsizes shares to fit cash accounts without requiring margin.
 */
export function calculatePositionSize(input: PositionSizerInput): PositionSizerResult {
  const safeEquity = Number(input?.accountEquity) || DEFAULT_ACCOUNT_EQUITY;
  const accountEquity = safeEquity > 0 ? safeEquity : DEFAULT_ACCOUNT_EQUITY;

  const safeCash = input?.availableCash !== undefined && input?.availableCash !== null
    ? Number(input.availableCash)
    : accountEquity;
  const availableCash = !isNaN(safeCash) && safeCash >= 0 ? safeCash : accountEquity;

  const safeRiskPct = Number(input?.riskPercentage) || DEFAULT_RISK_PERCENTAGE;
  const riskPercentage = safeRiskPct > 0 ? safeRiskPct : DEFAULT_RISK_PERCENTAGE;

  const entry = typeof input?.entryPrice === "number" && !isNaN(input.entryPrice) ? input.entryPrice : 0;
  const stop = typeof input?.stopLossPrice === "number" && !isNaN(input.stopLossPrice) ? input.stopLossPrice : 0;

  // Formula: dollarRiskPerShare = |entryPrice - stopLossPrice|
  const rawRiskPerShare = Math.abs(entry - stop);
  const dollarRiskPerShare = Math.round(rawRiskPerShare * 10000) / 10000;

  // Formula: totalDollarRiskAllowed = accountEquity * (riskPercentage / 100)
  const totalDollarRiskAllowed = accountEquity * (riskPercentage / 100);

  let riskShares = 0;
  let cashShares = 0;

  // Risk limit: floor(totalDollarRiskAllowed / dollarRiskPerShare)
  if (dollarRiskPerShare > 0.0001 && entry > 0 && stop > 0) {
    riskShares = Math.floor((totalDollarRiskAllowed / dollarRiskPerShare) + 1e-9);
  }

  // Cash limit: floor(availableCash / entryPrice)
  if (entry > 0 && availableCash > 0) {
    cashShares = Math.floor((availableCash / entry) + 1e-9);
  }

  // Enforce cash guard: maxShares = Math.min(riskShares, cashShares)
  const maxShares = Math.min(riskShares, cashShares);
  const calculatedShares = Math.max(0, maxShares);

  // Formula: totalCapitalRequired = calculatedShares * entryPrice
  const totalCapitalRequired = calculatedShares * entry;

  // Formula: portfolioAllocationPercent = (totalCapitalRequired / accountEquity) * 100
  const portfolioAllocationPercent = accountEquity > 0 ? (totalCapitalRequired / accountEquity) * 100 : 0;

  // Scale-out split:
  // t1Shares = floor(calculatedShares / 2) (50% scale-out)
  // t2Shares = calculatedShares - t1Shares (Remaining 50% core runner)
  const t1Shares = Math.floor(calculatedShares / 2);
  const t2Shares = calculatedShares - t1Shares;

  // Insufficient cash guard: cash cannot afford even 1 share or calculatedShares is 0
  const isInsufficientCash = entry > 0 && (availableCash < entry || (riskShares > 0 && cashShares === 0));

  // Margin required guard: position cost exceeds available cash
  const isMarginRequired = totalCapitalRequired > availableCash;

  const warningMessage = isInsufficientCash
    ? "Insufficient Cash Balance"
    : isMarginRequired
    ? "Exceeds Available Cash (Margin Required)"
    : null;

  return {
    accountEquity,
    availableCash,
    riskPercentage,
    entryPrice: entry,
    stopLossPrice: stop,
    dollarRiskPerShare,
    totalDollarRiskAllowed,
    calculatedShares,
    sharesAllowed: calculatedShares,
    positionCost: totalCapitalRequired,
    totalCapitalRequired,
    portfolioAllocationPercent,
    t1Shares,
    t2Shares,
    isMarginRequired,
    isInsufficientCash,
    warningMessage,
  };
}

/**
 * React hook to compute dynamic risk-based position sizing using global or overridden settings.
 */
export function usePositionSizer(input?: PositionSizerInput): PositionSizerResult {
  let globalEquity: number | undefined;
  let globalRiskPct: number | undefined;
  let globalCash: number | undefined;

  try {
    const global = useGlobalState();
    globalEquity = global?.accountEquity ?? (global as any)?.equity;
    globalRiskPct = global?.riskPercentage;
    globalCash = (global as any)?.availableCash ?? (global as any)?.cash;
  } catch {
    // Graceful fallback outside GlobalStateProvider
  }

  const accountEquity = input?.accountEquity ?? globalEquity ?? DEFAULT_ACCOUNT_EQUITY;
  const safeEquity = Number(accountEquity) || DEFAULT_ACCOUNT_EQUITY;
  const effectiveRiskPct = Number(input?.riskPercentage ?? globalRiskPct) || DEFAULT_RISK_PERCENTAGE;
  const safeCash = input?.availableCash !== undefined && input?.availableCash !== null
    ? Number(input.availableCash)
    : (globalCash !== undefined && globalCash !== null ? Number(globalCash) : safeEquity);

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.log('[Risk Engine] Account Equity:', safeEquity, 'Available Cash:', safeCash);
    }
  }, [safeEquity, safeCash]);

  return useMemo(() => {
    try {
      return calculatePositionSize({
        accountEquity: safeEquity,
        availableCash: safeCash,
        riskPercentage: effectiveRiskPct,
        entryPrice: input?.entryPrice,
        stopLossPrice: input?.stopLossPrice,
      });
    } catch (err) {
      console.warn("[usePositionSizer] Calculation error fallback:", err);
      return calculatePositionSize({
        accountEquity: DEFAULT_ACCOUNT_EQUITY,
        availableCash: DEFAULT_ACCOUNT_EQUITY,
        riskPercentage: DEFAULT_RISK_PERCENTAGE,
        entryPrice: 0,
        stopLossPrice: 0,
      });
    }
  }, [safeEquity, safeCash, effectiveRiskPct, input?.entryPrice, input?.stopLossPrice]);
}

export default usePositionSizer;
