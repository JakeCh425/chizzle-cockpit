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

  if (proximity <= 1.0) {
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

export interface SwingPositionMath {
  entryPrice: number;
  stopLoss: number;
  shares: number;
  actualCapitalDeployed: number;
  riskPerShare: number;
  totalRisk: number;
  target1_5R: number;
  profit1_5: number;
  roi1_5: number;
  target2_0R: number;
  profit2_0: number;
  roi2_0: number;
  target3_0R: number;
  profit3_0: number;
  roi3_0: number;
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
}): SwingPositionMath | null {
  const { entryPrice, stopLoss, capital } = params;
  if (!entryPrice || entryPrice <= 0) return null;

  const safeStop = stopLoss > 0 && stopLoss < entryPrice ? stopLoss : +(entryPrice * 0.98).toFixed(2);
  const riskPerShare = Math.max(0.01, entryPrice - safeStop);
  const safeCapital = Math.max(0, capital || 0);
  const shares = Math.floor(safeCapital / entryPrice);
  const actualCapitalDeployed = shares * entryPrice;
  const totalRisk = shares * riskPerShare;

  const profit1_5 = totalRisk * 1.5;
  const roi1_5 = actualCapitalDeployed > 0 ? (profit1_5 / actualCapitalDeployed) * 100 : 0;

  const profit2_0 = totalRisk * 2.0;
  const roi2_0 = actualCapitalDeployed > 0 ? (profit2_0 / actualCapitalDeployed) * 100 : 0;

  const profit3_0 = totalRisk * 3.0;
  const roi3_0 = actualCapitalDeployed > 0 ? (profit3_0 / actualCapitalDeployed) * 100 : 0;

  return {
    entryPrice,
    stopLoss: safeStop,
    shares,
    actualCapitalDeployed,
    riskPerShare,
    totalRisk,
    target1_5R: entryPrice + riskPerShare * 1.5,
    profit1_5,
    roi1_5,
    target2_0R: entryPrice + riskPerShare * 2.0,
    profit2_0,
    roi2_0,
    target3_0R: entryPrice + riskPerShare * 3.0,
    profit3_0,
    roi3_0,
  };
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

  const readiness = useMemo(
    () => getReadinessTier(proximity, decision?.setupStatus),
    [proximity, decision?.setupStatus]
  );

  const lifecycleStep = useMemo(
    () => resolveLifecycleStep(decision?.setupStatus, entryPrice > 0),
    [decision?.setupStatus, entryPrice]
  );

  const math = useMemo(
    () => computeSwingPositionMath({ entryPrice, stopLoss, capital }),
    [entryPrice, stopLoss, capital]
  );

  return {
    livePrice,
    entryPrice,
    stopLoss,
    proximity,
    readiness,
    lifecycleStep,
    math,
  };
}
