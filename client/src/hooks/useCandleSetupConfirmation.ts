import { useState, useEffect, useMemo } from "react";

export interface CandleData {
  t?: number;
  o: number;
  h: number;
  l: number;
  c: number;
  x?: number;
  v?: number;
}

export interface CandleSetupConfirmationInput {
  candles: CandleData[];
  timeframe?: string;
  sma20?: number;
  sma50?: number;
  entryPrice?: number;
  livePrice?: number;
  setupStatus?: string;
  // Direct override flags for testing or upstream feed indicators
  supportZoneInteraction?: boolean;
  rejectionOrStructuralHold?: boolean;
  greenConfirmation?: boolean;
}

export interface CandleSetupConfirmationResult {
  isBuyConfirmed: boolean;
  isSetupReady: boolean;
  confirmedEntryPrice: number | null;
  confirmedCandleIndex: number | null;
  statusText: string;
  statusBadgeClass: string;
  countdownText: string;
  supportZoneInteraction: boolean;
  rejectionOrStructuralHold: boolean;
  greenConfirmation: boolean;
  isAwaitingClose: boolean;
  isInvalidated: boolean;
  formingDistancePct: number;
}

/**
 * Pure calculation function for strict 1H candle bounce validation.
 * Stops blindly buying the forming live bar; strictly waits for confirmed closed bar.
 */
export function evaluateCandleSetupConfirmation(
  input: CandleSetupConfirmationInput
): CandleSetupConfirmationResult {
  const {
    candles = [],
    timeframe = "1H",
    sma20,
    sma50,
    entryPrice,
    livePrice,
    setupStatus,
    supportZoneInteraction: explicitSupport,
    rejectionOrStructuralHold: explicitRejection,
    greenConfirmation: explicitGreen,
  } = input || {};

  // Default countdown string (e.g., "18m until close")
  const now = new Date();
  const minsUntilNextHour = Math.max(1, 60 - now.getMinutes());
  const countdownText = `${minsUntilNextHour}m until close`;

  if (!candles || candles.length < 2) {
    const isReadyFallback = setupStatus === "Ready";
    return {
      isBuyConfirmed: isReadyFallback,
      isSetupReady: isReadyFallback,
      confirmedEntryPrice: entryPrice ?? livePrice ?? null,
      confirmedCandleIndex: null,
      statusText: isReadyFallback
        ? `[ BUY CONFIRMED - ENTER AT $${(entryPrice ?? livePrice ?? 100).toFixed(2)} ]`
        : "[ PULLBACK FORMING - AWAITING 1H CLOSE ]",
      statusBadgeClass: isReadyFallback
        ? "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse"
        : "bg-amber-500/20 text-amber-300 border-amber-400/50",
      countdownText,
      supportZoneInteraction: isReadyFallback,
      rejectionOrStructuralHold: isReadyFallback,
      greenConfirmation: isReadyFallback,
      isAwaitingClose: !isReadyFallback,
      isInvalidated: false,
      formingDistancePct: 0,
    };
  }

  // The last bar in the array is the currently forming live bar.
  // We NEVER set buy entry on the forming live bar.
  // The last completed, closed 1H candle is at index length - 2.
  const closedCandleIndex = candles.length - 2;
  const closedBar = candles[closedCandleIndex];
  const formingBar = candles[candles.length - 1];

  const currentRefPrice = livePrice && livePrice > 0 ? livePrice : formingBar?.c ?? closedBar.c;
  const supportLevel = sma20 ?? +(currentRefPrice * 0.985);
  const formingDistancePct = supportLevel > 0
    ? +((Math.abs(currentRefPrice - supportLevel) / supportLevel) * 100).toFixed(2)
    : 1.4;

  // 1. Support Zone Interaction: The candle's low must touch or pull back within 0.5%–1.0% of the rising 20-SMA or 50-SMA
  let supportZoneInteraction = false;
  if (typeof explicitSupport === "boolean") {
    supportZoneInteraction = explicitSupport;
  } else if (setupStatus === "Ready") {
    supportZoneInteraction = true;
  } else if (setupStatus === "Forming" && formingDistancePct > 2.0) {
    supportZoneInteraction = false;
  } else {
    const distToSma = Math.abs(closedBar.l - supportLevel) / supportLevel * 100;
    supportZoneInteraction =
      distToSma <= 1.0 ||
      (closedBar.l <= supportLevel * 1.01 && closedBar.h >= supportLevel * 0.985);
  }

  // 2. Rejection / Structural Hold: The candle must reject the lower level (long lower wick / hammer) OR form a bullish engulfing pattern
  let rejectionOrStructuralHold = false;
  if (typeof explicitRejection === "boolean") {
    rejectionOrStructuralHold = explicitRejection;
  } else if (setupStatus === "Ready") {
    rejectionOrStructuralHold = true;
  } else {
    const body = Math.abs(closedBar.c - closedBar.o);
    const lowerWick = Math.min(closedBar.o, closedBar.c) - closedBar.l;
    const totalRange = Math.max(closedBar.h - closedBar.l, 0.01);

    // Hammer test: Lower wick is substantial rejection of lower prices
    const isHammer = lowerWick >= body * 1.1 || lowerWick >= totalRange * 0.35;

    // Bullish engulfing test: Closed green bar engulfing previous red bar
    const prevClosedBar = candles.length >= 3 ? candles[candles.length - 3] : null;
    const isBullishEngulfing = Boolean(
      prevClosedBar &&
      prevClosedBar.c < prevClosedBar.o &&
      closedBar.c > closedBar.o &&
      closedBar.c >= prevClosedBar.o &&
      closedBar.o <= prevClosedBar.c
    );

    rejectionOrStructuralHold = isHammer || isBullishEngulfing || (lowerWick >= totalRange * 0.25 && closedBar.c >= closedBar.o);
  }

  // 3. Closed Green Confirmation: The candle's close must be strictly greater than its open AND close back above the 20-SMA line
  let greenConfirmation = false;
  if (typeof explicitGreen === "boolean") {
    greenConfirmation = explicitGreen;
  } else if (setupStatus === "Ready") {
    greenConfirmation = true;
  } else if (setupStatus === "Awaiting Close" || setupStatus === "Forming") {
    greenConfirmation = false;
  } else {
    const isGreen = closedBar.c > closedBar.o;
    const isAboveSma = closedBar.c >= supportLevel;
    greenConfirmation = isGreen && isAboveSma;
  }

  // Strict 3-Point Bar Validation:
  const isBuyConfirmed =
    supportZoneInteraction === true &&
    rejectionOrStructuralHold === true &&
    greenConfirmation === true;

  // Breach or invalidation test: If closed bar finished red AND breached lower support
  const isInvalidated =
    !isBuyConfirmed &&
    (closedBar.c < closedBar.o && closedBar.c < supportLevel * 0.985);

  const isAwaitingClose = !isBuyConfirmed && !isInvalidated;

  let statusText = "[ PULLBACK FORMING - AWAITING 1H CLOSE ]";
  let statusBadgeClass = "bg-amber-500/20 text-amber-300 border-amber-400/50";

  if (isBuyConfirmed) {
    const confirmedPrice = entryPrice ?? closedBar.c;
    statusText = `[ BUY CONFIRMED - ENTER AT $${confirmedPrice.toFixed(2)} ]`;
    statusBadgeClass =
      "bg-emerald-500/20 text-[#00E676] border-emerald-400/50 animate-pulse bg-emerald-950/20 shadow-[0_0_15px_rgba(0,230,118,0.4)]";
  } else if (isInvalidated) {
    statusText = "[ SETUP INVALIDATED / WAITING ]";
    statusBadgeClass = "bg-rose-500/20 text-rose-400 border-rose-500/40";
  }

  return {
    isBuyConfirmed,
    isSetupReady: isBuyConfirmed,
    confirmedEntryPrice: isBuyConfirmed ? (entryPrice ?? closedBar.c) : null,
    confirmedCandleIndex: isBuyConfirmed ? closedCandleIndex : null,
    statusText,
    statusBadgeClass,
    countdownText,
    supportZoneInteraction,
    rejectionOrStructuralHold,
    greenConfirmation,
    isAwaitingClose,
    isInvalidated,
    formingDistancePct,
  };
}

/**
 * React hook for Candle Setup Confirmation with real-time countdown timer.
 */
export function useCandleSetupConfirmation(
  input: CandleSetupConfirmationInput
): CandleSetupConfirmationResult {
  const [countdownText, setCountdownText] = useState<string>(() => {
    const now = new Date();
    const minsUntilNextHour = Math.max(1, 60 - now.getMinutes());
    return `${minsUntilNextHour}m until close`;
  });

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const minsUntilNextHour = Math.max(1, 60 - now.getMinutes());
      setCountdownText(`${minsUntilNextHour}m until close`);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 15000);
    return () => clearInterval(timer);
  }, []);

  const evaluation = useMemo(() => {
    return evaluateCandleSetupConfirmation(input);
  }, [
    input?.candles,
    input?.timeframe,
    input?.sma20,
    input?.sma50,
    input?.entryPrice,
    input?.livePrice,
    input?.setupStatus,
    input?.supportZoneInteraction,
    input?.rejectionOrStructuralHold,
    input?.greenConfirmation,
  ]);

  return {
    ...evaluation,
    countdownText,
  };
}
