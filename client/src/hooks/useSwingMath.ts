import { useMemo } from "react";
import type { SwingDecision } from "@shared/swingDecision";
import { STATUS_THEME, type SetupVisualStage } from "@/lib/statusTheme";

export type LifecycleStep = 1 | 2 | 3 | 4;
export type SetupStage = SetupVisualStage;
export type MacroRegime = "STAND_DOWN" | "SELECTIVE" | "CAUTION" | "GO" | "green" | "yellow" | "red" | string;

export const NEW_SWING_CANDIDATES = ["XLF", "JPM", "CAT", "COST", "AAPL"] as const;
export const DEFAULT_WATCHLIST = [
  "SMH",
  "QQQ",
  "SPY",
  "XLE",
  "XLV",
  "XLI",
  ...NEW_SWING_CANDIDATES,
] as const;

export interface IndexDailyCheck {
  price?: number | null;
  sma20?: number | null;
  sma50?: number | null;
}

export interface MacroRegimeEvaluation {
  regime: "GO" | "SELECTIVE" | "STAND_DOWN";
  reason: string | null;
  isSynced: boolean;
  spyBelowBoth: boolean;
  qqqBelowBoth: boolean;
}

/**
 * Strict Verified Macro Check:
 * Only returns 'STAND_DOWN' when live/verified Daily data confirms BOTH SPY and QQQ
 * are trading below their Daily 20-SMA and 50-SMA (unless user enabled Selective Override).
 * Defaults to 'SELECTIVE' while syncing or when index data is incomplete.
 */
export function evaluateMacroRegime(params: {
  spy?: IndexDailyCheck | null;
  qqq?: IndexDailyCheck | null;
  isSyncing?: boolean;
  allowSelectiveOverride?: boolean;
}): MacroRegimeEvaluation {
  const { spy, qqq, isSyncing = false, allowSelectiveOverride = false } = params;
  const spyPrice = Number(spy?.price || 0);
  const spy20 = Number(spy?.sma20 || 0);
  const spy50 = Number(spy?.sma50 || 0);
  const qqqPrice = Number(qqq?.price || 0);
  const qqq20 = Number(qqq?.sma20 || 0);
  const qqq50 = Number(qqq?.sma50 || 0);

  const hasVerifiedSpy = spyPrice > 0 && spy20 > 0 && spy50 > 0;
  const hasVerifiedQqq = qqqPrice > 0 && qqq20 > 0 && qqq50 > 0;
  const isSynced = !isSyncing && hasVerifiedSpy && hasVerifiedQqq;

  if (!isSynced) {
    return {
      regime: "SELECTIVE",
      reason: null,
      isSynced: false,
      spyBelowBoth: false,
      qqqBelowBoth: false,
    };
  }

  const spyBelowBoth = spyPrice < spy20 && spyPrice < spy50;
  const qqqBelowBoth = qqqPrice < qqq20 && qqqPrice < qqq50;

  if (spyBelowBoth && qqqBelowBoth && !allowSelectiveOverride) {
    return {
      regime: "STAND_DOWN",
      reason: "SPY & QQQ below Daily 20-SMA & 50-SMA",
      isSynced: true,
      spyBelowBoth,
      qqqBelowBoth,
    };
  }

  if (spyBelowBoth || qqqBelowBoth || allowSelectiveOverride) {
    return {
      regime: "SELECTIVE",
      reason: allowSelectiveOverride
        ? "Selective Override Active"
        : spyBelowBoth
        ? "SPY below Daily 20/50-SMA"
        : "QQQ below Daily 20/50-SMA",
      isSynced: true,
      spyBelowBoth,
      qqqBelowBoth,
    };
  }

  return {
    regime: "GO",
    reason: null,
    isSynced: true,
    spyBelowBoth: false,
    qqqBelowBoth: false,
  };
}

/**
 * Computes the underlying technical setup stage (ignoring macro regime) so cards
 * never erase their real technical progress even when macro caution is active.
 */
export function getTechnicalStage(ticker: any, proximityOverride?: number): Exclude<SetupStage, "BLOCKED"> {
  const status = (ticker?.setupStatus ?? ticker?.status ?? "").toString().trim().toUpperCase();
  const entry = Number(ticker?.projectedEntry ?? ticker?.entryPrice ?? 0);
  const stop = Number(ticker?.stopLoss ?? ticker?.structuralStop ?? 0);
  const live = Number(ticker?.livePrice ?? ticker?.currentPrice ?? 0);
  const proximity =
    typeof proximityOverride === "number" && Number.isFinite(proximityOverride)
      ? proximityOverride
      : entry > 0 && live > 0
      ? Math.abs((live - entry) / entry) * 100
      : 999;

  const isRetestOrInvalid = Boolean(
    ticker?.isWaitAndRetest ||
      status === "WATCH_RETEST" ||
      status === "WAIT_AND_RETEST" ||
      status === "WAIT_FOR_RETEST" ||
      status === "NO_TRADE" ||
      status === "SIGNAL_EXPIRED" ||
      status === "IGNORED"
  );
  const hasValidLevels = entry > 0 && (stop <= 0 || entry > stop);
  const withinChaseTolerance = proximity <= 0.75;
  const isReadyStatus =
    status === "READY_TO_TRADE" || status === "SETUP_CONFIRMED" || status === "READY";
  const candleConfirmed = Boolean(ticker?.hasClosed1HReversal || isReadyStatus);

  if (!isRetestOrInvalid && isReadyStatus && candleConfirmed && hasValidLevels && withinChaseTolerance) {
    return "READY";
  }

  if (proximity <= 1.5) {
    return "IMMINENT";
  }

  if (proximity <= 4.5) {
    return "APPROACHING";
  }

  return "FORMING";
}

/**
 * Centralized Single-Source-of-Truth stage evaluator controlling BOTH the card badge
 * AND which bucket (READY TO TRADE vs PENDING & WAITING) the setup renders in.
 */
export function getSetupStage(
  ticker: any,
  macroRegime?: MacroRegime | null,
  isPracticeMode = false,
  proximityOverride?: number
): SetupStage {
  const regime = (macroRegime ?? "").toString().trim().toUpperCase();
  const isMacroStandDown = regime === "STAND_DOWN";

  const status = (ticker?.setupStatus ?? ticker?.status ?? "").toString().trim().toUpperCase();
  const isBlockedAsset = Boolean(
    ticker?.hasHardBlock ||
      ticker?.isStandbyDay ||
      status === "STANDBY_DAY" ||
      status === "BLOCKED"
  );

  if ((isMacroStandDown && !isPracticeMode) || isBlockedAsset) {
    return "BLOCKED";
  }

  return getTechnicalStage(ticker, proximityOverride);
}

export type SizingMode = "risk_cap" | "capital";

export function getRecommendedRiskPct(params: {
  macroRegime?: MacroRegime | null;
  setup?: any;
}): { recommendedPct: number; label: string } {
  const regime = String(params.macroRegime ?? "").trim().toUpperCase();
  const hasCaution = regime === "SELECTIVE" || regime === "STAND_DOWN" || Boolean(params.setup?.hasHardBlock);
  if (hasCaution) {
    return { recommendedPct: 0.01, label: "Recommended: 1.0%" };
  }
  const confirmed1H = Boolean(params.setup?.hasClosed1HReversal || params.setup?.setupStatus === "READY_TO_TRADE");
  const bullish4H = String(params.setup?.marketRegime ?? "").toUpperCase() === "BULLISH" || regime === "GO";
  if (bullish4H && confirmed1H) {
    return { recommendedPct: 0.02, label: "A+ Setup • Up to 2.0%–3.0%" };
  }
  return { recommendedPct: 0.015, label: "Standard Trend: 1.5%" };
}

export interface ClampedSharesResult {
  shares: number;
  maxRiskBudget: number;
  actualDollarRisk: number;
  actualEquityRiskPct: number;
  capitalAllocated: number;
  isRiskClamped: boolean;
  exceedsRiskCap: boolean;
  maxAllowedCapitalByRisk: number;
}

/**
 * Dual-Constraint Position Sizing: Math.min(CapitalShares, RiskShares).
 * Strictly enforces 1.0% Max Equity Risk Budget even if userCapitalInput is higher.
 */
export function calculateClampedShares({
  totalAccountEquity,
  userCapitalInput,
  entryPrice,
  stopLossPrice,
  isFractional = false,
  riskPct = 0.01,
  sizingMode = "risk_cap",
}: {
  totalAccountEquity: number;
  userCapitalInput: number;
  entryPrice: number;
  stopLossPrice: number;
  isFractional?: boolean;
  riskPct?: number;
  sizingMode?: SizingMode;
}): ClampedSharesResult {
  const maxRiskBudget = Number((Math.max(0, totalAccountEquity) * riskPct).toFixed(2));
  const riskPerShare = Math.abs(entryPrice - stopLossPrice);

  if (entryPrice <= 0 || riskPerShare <= 0) {
    return {
      shares: 0,
      maxRiskBudget,
      actualDollarRisk: 0,
      actualEquityRiskPct: 0,
      capitalAllocated: 0,
      isRiskClamped: false,
      exceedsRiskCap: false,
      maxAllowedCapitalByRisk: 0,
    };
  }

  const rawRiskShares = maxRiskBudget / riskPerShare;
  const rawCapitalShares = Math.max(0, userCapitalInput) / entryPrice;
  const targetRawShares = sizingMode === "capital" ? rawCapitalShares : Math.min(rawRiskShares, rawCapitalShares);

  const shares = isFractional
    ? Number(targetRawShares.toFixed(3))
    : Math.floor(targetRawShares);

  const capitalAllocated = Number((shares * entryPrice).toFixed(2));
  const actualDollarRisk = Number((shares * riskPerShare).toFixed(2));
  const actualEquityRiskPct =
    totalAccountEquity > 0
      ? Number(((actualDollarRisk / totalAccountEquity) * 100).toFixed(2))
      : 0;

  const isRiskClamped = sizingMode === "risk_cap" && rawCapitalShares > rawRiskShares;
  const exceedsRiskCap = sizingMode === "capital" && actualDollarRisk > maxRiskBudget;
  const maxAllowedCapitalByRisk = isFractional
    ? Number((rawRiskShares * entryPrice).toFixed(2))
    : Math.floor(rawRiskShares) * entryPrice;

  return {
    shares,
    maxRiskBudget,
    actualDollarRisk,
    actualEquityRiskPct,
    capitalAllocated,
    isRiskClamped,
    exceedsRiskCap,
    maxAllowedCapitalByRisk,
  };
}

export interface SwingPositionMath {
  entryPrice: number;
  stopLoss: number;
  stopPct: number;
  shares: number;
  isFractional: boolean;
  actualCapitalDeployed: number;
  riskPerShare: number;
  totalRisk: number;
  equityRiskPct: number;
  maxRiskBudget: number;
  isRiskClamped: boolean;
  exceedsRiskCap: boolean;
  maxAllowedCapitalByRisk: number;
  scale50Shares: number;
  core30Shares: number;
  runner20Shares: number;
  target1_5R: number;
  targetPct1_5: number;
  profit1_5: number;
  roi1_5: number;
  roc1_5: number;
  target2_0R: number;
  targetPct2_0: number;
  profit2_0: number;
  roi2_0: number;
  roc2_0: number;
  target3_0R: number;
  targetPct3_0: number;
  profit3_0: number;
  roi3_0: number;
  roc3_0: number;
}

export interface ReadinessTier {
  label: string;
  capsuleClass: string;
  textClass: string;
  tickerAccentClass: string;
}

/** Hardcoded Tailwind capsule classes from shared STATUS_THEME so Tailwind never purges them. */
export function getCapsuleColor(prox: number, stage?: SetupStage): string {
  if (stage) return STATUS_THEME[stage].progressBarClass;
  if (prox <= 1.0) return STATUS_THEME.APPROACHING.progressBarClass;
  if (prox <= 3.0) return STATUS_THEME.FORMING.progressBarClass;
  return "bg-slate-700";
}

export function getReadinessTier(
  prox: number,
  setupStatus?: string | null,
  stage?: SetupStage
): ReadinessTier {
  const resolvedStage: SetupStage =
    stage ??
    (setupStatus === "READY_TO_TRADE"
      ? "READY"
      : prox <= 1.0
      ? "APPROACHING"
      : "FORMING");
  const theme = STATUS_THEME[resolvedStage];
  return {
    label: theme.label,
    capsuleClass: theme.progressBarClass,
    textClass: theme.textClass,
    tickerAccentClass: theme.borderAccentClass,
  };
}

/** Shared proximity calculation used by both ActionCenter and UnifiedSwingEngine. */
export function getProximityForSetup(item: any, livePriceOverride?: number | null): number {
  const livePrice =
    livePriceOverride && livePriceOverride > 0
      ? livePriceOverride
      : item?.currentPrice ?? 0;
  const tgtSma =
    item?.sma20 ??
    item?.structureLevels?.sma20 ??
    (livePrice > 0 ? +(livePrice * 0.985).toFixed(2) : 0);
  const entryPrice =
    item?.entryPrice && item.entryPrice > 0
      ? item.entryPrice
      : tgtSma > 0
      ? tgtSma
      : livePrice;
  if (!entryPrice || entryPrice <= 0 || !livePrice || livePrice <= 0) return 999;
  return Math.abs((livePrice - entryPrice) / entryPrice) * 100;
}

export function resolveLifecycleStep(
  setupStatus?: string | null,
  hasEntryPlan = false
): LifecycleStep {
  if (setupStatus === "READY_TO_TRADE") return 4;
  if (
    setupStatus === "SETUP_CONFIRMED" ||
    setupStatus === "WATCH_RETEST" ||
    setupStatus === "WATCH_EXTENDED" ||
    setupStatus === "WATCH_STOP_TOO_WIDE" ||
    setupStatus === "WATCH_RR_TOO_LOW" ||
    hasEntryPlan
  ) {
    return 3;
  }
  if (setupStatus === "SETUP_FORMING") return 2;
  return 1;
}

export function computeSwingPositionMath(params: {
  entryPrice: number;
  stopLoss: number;
  capital: number;
  fractional?: boolean;
  accountEquity?: number;
  riskPct?: number;
  sizingMode?: SizingMode;
}): SwingPositionMath | null {
  const {
    entryPrice,
    stopLoss,
    capital,
    fractional,
    accountEquity,
    riskPct = 0.01,
    sizingMode = "risk_cap",
  } = params;
  if (!entryPrice || entryPrice <= 0) return null;

  const safeStop = stopLoss > 0 && stopLoss < entryPrice ? stopLoss : +(entryPrice * 0.98).toFixed(2);
  const riskPerShare = Math.max(0.01, entryPrice - safeStop);
  const safeCapital = Math.max(0, capital || 0);
  const isFractional = fractional !== undefined ? fractional : safeCapital < entryPrice;
  const safeEquity = accountEquity && accountEquity > 0 ? accountEquity : 1614.95;

  const clamped = calculateClampedShares({
    totalAccountEquity: safeEquity,
    userCapitalInput: safeCapital,
    entryPrice,
    stopLossPrice: safeStop,
    isFractional,
    riskPct,
    sizingMode,
  });

  const shares = clamped.shares;
  const actualCapitalDeployed = clamped.capitalAllocated;
  const totalRisk = clamped.actualDollarRisk;
  const equityRiskPct = clamped.actualEquityRiskPct;

  const scale50Shares = isFractional ? Number((shares * 0.5).toFixed(3)) : Math.floor(shares * 0.5);
  const core30Shares = isFractional ? Number((shares * 0.3).toFixed(3)) : Math.floor(shares * 0.3);
  const runner20Shares = isFractional
    ? Number(Math.max(0, shares - scale50Shares - core30Shares).toFixed(3))
    : Math.max(0, shares - scale50Shares - core30Shares);

  const target1_5R = entryPrice + riskPerShare * 1.5;
  const target2_0R = entryPrice + riskPerShare * 2.0;
  const target3_0R = entryPrice + riskPerShare * 3.0;

  // Independent Price % Move (never 0.0% even if shares === 0)
  const stopPct = ((safeStop - entryPrice) / entryPrice) * 100;
  const targetPct1_5 = ((target1_5R - entryPrice) / entryPrice) * 100;
  const targetPct2_0 = ((target2_0R - entryPrice) / entryPrice) * 100;
  const targetPct3_0 = ((target3_0R - entryPrice) / entryPrice) * 100;

  const profit1_5 = +((target1_5R - entryPrice) * shares).toFixed(2);
  const roc1_5 = actualCapitalDeployed > 0 ? (profit1_5 / actualCapitalDeployed) * 100 : targetPct1_5;

  const profit2_0 = +((target2_0R - entryPrice) * shares).toFixed(2);
  const roc2_0 = actualCapitalDeployed > 0 ? (profit2_0 / actualCapitalDeployed) * 100 : targetPct2_0;

  const profit3_0 = +((target3_0R - entryPrice) * shares).toFixed(2);
  const roc3_0 = actualCapitalDeployed > 0 ? (profit3_0 / actualCapitalDeployed) * 100 : targetPct3_0;

  return {
    entryPrice,
    stopLoss: safeStop,
    stopPct,
    shares,
    isFractional,
    actualCapitalDeployed,
    riskPerShare,
    totalRisk,
    equityRiskPct,
    maxRiskBudget: clamped.maxRiskBudget,
    isRiskClamped: clamped.isRiskClamped,
    exceedsRiskCap: clamped.exceedsRiskCap,
    maxAllowedCapitalByRisk: clamped.maxAllowedCapitalByRisk,
    scale50Shares,
    core30Shares,
    runner20Shares,
    target1_5R,
    targetPct1_5,
    profit1_5,
    roi1_5: roc1_5,
    roc1_5,
    target2_0R,
    targetPct2_0,
    profit2_0,
    roi2_0: roc2_0,
    roc2_0,
    target3_0R,
    targetPct3_0,
    profit3_0,
    roi3_0: roc3_0,
    roc3_0,
  };
}

/**
 * Automatic Signal Expiration Check:
 * Marks setup expired if status is SIGNAL_EXPIRED, signalTimestamp is older than
 * 2 trading sessions, or livePrice has drifted > 3.0% away from entryPrice.
 */
export function isSetupExpired(
  decision: any,
  livePrice?: number | null,
  entryPrice?: number | null
): boolean {
  if (!decision) return false;
  if (decision.isExpired) return true;
  if (decision.setupStatus === "SIGNAL_EXPIRED") return true;

  const live = Number(livePrice ?? decision.currentPrice ?? 0);
  const entry = Number(entryPrice ?? decision.entryPrice ?? 0);
  if (live > 0 && entry > 0) {
    const driftPct = Math.abs((live - entry) / entry) * 100;
    if (driftPct > 3.0) return true;
  }

  const rawTs =
    decision.signalTimestamp ??
    decision.triggeredAt ??
    decision.evaluatedAt ??
    decision.quoteTimestamp;
  if (rawTs) {
    const tsMs = typeof rawTs === "number" ? (rawTs < 1e12 ? rawTs * 1000 : rawTs) : Date.parse(String(rawTs));
    if (Number.isFinite(tsMs) && tsMs > 0) {
      // Count weekdays elapsed between signal timestamp and now (> 2 trading sessions => expired)
      const now = Date.now();
      if (now - tsMs > 4 * 24 * 3600 * 1000) return true;
      let tradingDays = 0;
      const cursor = new Date(tsMs);
      cursor.setHours(0, 0, 0, 0);
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      while (cursor < today) {
        cursor.setDate(cursor.getDate() + 1);
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) tradingDays++;
        if (tradingDays > 2) return true;
      }
    }
  }

  return false;
}

/** Shared hook synchronizing ActionCenter & UnifiedSwingEngine math, colors, and lifecycle state. */
export function useSwingMath(
  decision: SwingDecision | undefined | null,
  livePriceOverride?: number | null,
  capital = 1000
) {
  const livePrice =
    livePriceOverride && livePriceOverride > 0
      ? livePriceOverride
      : decision?.currentPrice ?? 0;

  const entryPrice = useMemo(() => {
    if (!decision) return livePrice > 0 ? +(livePrice * 0.985).toFixed(2) : 0;
    if (decision.entryPrice && decision.entryPrice > 0) return decision.entryPrice;
    const sma20 = decision.sma20 ?? (decision.structureLevels as any)?.sma20;
    if (sma20 && sma20 > 0) return sma20;
    return livePrice > 0 ? +(livePrice * 0.985).toFixed(2) : 0;
  }, [decision, livePrice]);

  const stopLoss = useMemo(() => {
    if (decision?.structuralStop && decision.structuralStop > 0 && decision.structuralStop < entryPrice) {
      return decision.structuralStop;
    }
    return entryPrice > 0 ? +(entryPrice * 0.98).toFixed(2) : 0;
  }, [decision?.structuralStop, entryPrice]);

  const proximity = useMemo(() => {
    if (!entryPrice || entryPrice <= 0 || !livePrice || livePrice <= 0) return 999;
    return Math.abs((livePrice - entryPrice) / entryPrice) * 100;
  }, [livePrice, entryPrice]);

  const isExpired = useMemo(
    () => isSetupExpired(decision, livePrice, entryPrice),
    [decision, livePrice, entryPrice]
  );

  const readiness = useMemo(
    () => getReadinessTier(proximity, isExpired ? "SCANNING" : decision?.setupStatus),
    [proximity, decision?.setupStatus, isExpired]
  );

  const lifecycleStep = useMemo(
    () => (isExpired ? (1 as LifecycleStep) : resolveLifecycleStep(decision?.setupStatus, entryPrice > 0)),
    [decision?.setupStatus, entryPrice, isExpired]
  );

  const math = useMemo(
    () => (isExpired ? null : computeSwingPositionMath({ entryPrice, stopLoss, capital })),
    [entryPrice, stopLoss, capital, isExpired]
  );

  return {
    livePrice,
    entryPrice,
    stopLoss,
    proximity,
    isExpired,
    readiness,
    lifecycleStep,
    math,
  };
}
