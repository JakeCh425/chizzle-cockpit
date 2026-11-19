import { useMemo } from "react";
import type { SwingDecision } from "@shared/swingDecision";

export type LifecycleStep = 1 | 2 | 3 | 4;
export type SetupStage = "READY" | "PENDING" | "BLOCKED";
export type MacroRegime = "STAND_DOWN" | "CAUTION" | "GO" | "green" | "yellow" | "red" | string;

/**
 * Centralized Single-Source-of-Truth stage evaluator controlling BOTH the card badge
 * AND which bucket (READY TO TRADE vs PENDING & WAITING) the setup renders in.
 */
export function getSetupStage(
  ticker: any,
  macroRegime?: MacroRegime | null,
  isPracticeMode = false
): SetupStage {
  const regime = String(macroRegime ?? "").trim().toUpperCase();
  const isMacroStandDown = regime === "STAND_DOWN" || regime === "RED";

  const status = String(ticker?.setupStatus ?? ticker?.status ?? "").trim().toUpperCase();
  const isBlockedAsset = Boolean(
    ticker?.hasHardBlock ||
      ticker?.isStandbyDay ||
      status === "STANDBY_DAY" ||
      status === "BLOCKED"
  );

  // Rule 1 (Macro Stand-Down): No ticker may display READY when macro is STAND_DOWN (unless Practice Mode)
  if ((isMacroStandDown && !isPracticeMode) || isBlockedAsset) {
    return "BLOCKED";
  }

  const isRetestOrInvalid = Boolean(
    ticker?.isWaitAndRetest ||
      status === "WATCH_RETEST" ||
      status === "WAIT_AND_RETEST" ||
      status === "WAIT_FOR_RETEST" ||
      status === "NO_TRADE" ||
      status === "SIGNAL_EXPIRED" ||
      status === "IGNORED"
  );

  const entry = Number(ticker?.projectedEntry ?? ticker?.entryPrice ?? 0);
  const stop = Number(ticker?.stopLoss ?? ticker?.structuralStop ?? 0);
  const live = Number(ticker?.livePrice ?? ticker?.currentPrice ?? 0);
  const hasValidLevels = entry > 0 && (stop <= 0 || entry > stop);
  const withinChaseTolerance =
    entry > 0 && live > 0 ? Math.abs((live - entry) / entry) * 100 <= 0.75 : true;

  const isReadyStatus =
    status === "READY_TO_TRADE" || status === "SETUP_CONFIRMED" || status === "READY";
  const candleConfirmed = Boolean(ticker?.hasClosed1HReversal || isReadyStatus);

  // Rule 2 (Auto-Promotion): Confirmed 1H candle + valid levels + no macro/asset block
  if (!isRetestOrInvalid && isReadyStatus && candleConfirmed && hasValidLevels && withinChaseTolerance) {
    return "READY";
  }

  return "PENDING";
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

/** Hardcoded Tailwind capsule classes so Tailwind never purges them. */
export function getCapsuleColor(prox: number, stage?: SetupStage): string {
  if (stage === "BLOCKED") return "bg-rose-500/80";
  if (stage === "READY") return "bg-emerald-400 shadow-[0_0_10px_#00F5A0]";
  if (stage === "PENDING") {
    if (prox <= 0.5) return "bg-[#FFB800] shadow-[0_0_12px_rgba(255,184,0,0.65)] animate-pulse";
    if (prox <= 1.5) return "bg-[#FFB800] shadow-[0_0_8px_rgba(255,184,0,0.4)]";
    if (prox <= 3.0) return "bg-amber-500/80";
    return "bg-slate-700";
  }
  if (prox <= 0.5) return "bg-amber-400 shadow-[0_0_12px_#fbbf24] animate-pulse"; // Trigger Zone
  if (prox <= 1.5) return "bg-emerald-500 shadow-[0_0_10px_#10b981]"; // Ready Zone
  if (prox <= 3.0) return "bg-cyan-500"; // Monitoring
  return "bg-slate-700"; // Cold
}

export function getReadinessTier(
  prox: number,
  setupStatus?: string | null,
  stage?: SetupStage
): ReadinessTier {
  if (stage === "BLOCKED") {
    return {
      label: "BLOCKED (MACRO STAND-DOWN)",
      capsuleClass: getCapsuleColor(prox, "BLOCKED"),
      textClass: "text-rose-400",
      tickerAccentClass: "border-rose-500/50",
    };
  }
  const isReady = stage ? stage === "READY" : setupStatus === "READY_TO_TRADE";
  if (isReady) {
    return {
      label: "READY",
      capsuleClass: getCapsuleColor(prox, "READY"),
      textClass: "text-emerald-400",
      tickerAccentClass: "border-emerald-400",
    };
  }
  if (prox <= 0.5) {
    return {
      label: "TRIGGER ZONE",
      capsuleClass: getCapsuleColor(prox, "PENDING"),
      textClass: "text-[#FFB800]",
      tickerAccentClass: "border-[#FFB800]",
    };
  }
  if (prox <= 1.5) {
    return {
      label: "NEAR ENTRY",
      capsuleClass: getCapsuleColor(prox, "PENDING"),
      textClass: "text-[#FFB800]",
      tickerAccentClass: "border-[#FFB800]",
    };
  }
  if (prox <= 3.0) {
    return {
      label: "MONITORING",
      capsuleClass: getCapsuleColor(prox, "PENDING"),
      textClass: "text-amber-400/90",
      tickerAccentClass: "border-amber-500/50",
    };
  }
  return {
    label: "DEEP STANDBY",
    capsuleClass: getCapsuleColor(prox, "PENDING"),
    textClass: "text-slate-400",
    tickerAccentClass: "border-slate-700",
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
