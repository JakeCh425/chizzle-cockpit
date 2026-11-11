// ─── Centralized Execution Gating Engine ──────────────────────────────────
// Strictly enforces the 3-Rule Execution Gating Contract:
// 1. NO hard regime blocks (Regime is not RED, asset is not STANDBY DAY).
// 2. Price is actively bouncing off SMA 10, SMA 20, or SMA 50.
// 3. The 1H confirmation candle has closed green.
// If ANY rule fails, the ticker is locked out of the execution zone and sent to Pending.

export interface ExecutionGatingParams {
  symbol: string;
  regimeCode?: "green" | "yellow" | "red" | string | null;
  isStandbyDay?: boolean;
  mechanicalStatus?: string | null;
  regime4H?: "Bullish" | "Bearish" | string | null;
  is4hBullish?: boolean;
  testedLine?: "10_SMA" | "20_SMA" | "50_SMA" | string | null;
  testedPrice?: number | null;
  candleConfirmedGreen?: boolean;
  setupStatus?: string | null;
}

export interface ExecutionGatingResult {
  isReady: boolean;
  passedRegime: boolean;
  passedSmaBounce: boolean;
  passedCandleClose: boolean;
  rejectionReason: string | null;
  failedGates: string[];
}

export function evaluateExecutionGating(params: ExecutionGatingParams): ExecutionGatingResult {
  const failedGates: string[] = [];

  // Rule 1: No hard regime blocks (Regime is not RED, not STANDBY DAY)
  const isRed = params.regimeCode?.toLowerCase() === "red";
  const isStandby = Boolean(
    params.isStandbyDay ||
    params.mechanicalStatus?.includes("STANDBY_DAY") ||
    params.mechanicalStatus?.includes("HARD BLOCK") ||
    params.mechanicalStatus?.includes("Red Regime") ||
    params.regime4H === "Bearish" ||
    params.is4hBullish === false
  );
  const passedRegime = !isRed && !isStandby;
  if (!passedRegime) {
    failedGates.push(isStandby ? "STANDBY_DAY_HARD_BLOCK" : "RED_REGIME_HARD_BLOCK");
  }

  // Rule 2: Price is actively bouncing off SMA 10, SMA 20, or SMA 50
  const validLines = new Set(["10_SMA", "20_SMA", "50_SMA", "SMA 10", "SMA 20", "SMA 50"]);
  const passedSmaBounce = Boolean(
    params.testedLine &&
    validLines.has(params.testedLine) &&
    (params.testedPrice == null || params.testedPrice > 0)
  );
  if (!passedSmaBounce) {
    failedGates.push("NO_ACTIVE_SMA_BOUNCE");
  }

  // Rule 3: 1H confirmation candle has closed green
  const isTestingOrWaiting = Boolean(
    params.mechanicalStatus?.includes("Wait for Close") ||
    params.setupStatus === "AWAITING_CLOSE" ||
    params.setupStatus === "TESTING_SMA"
  );
  const passedCandleClose = Boolean(
    params.candleConfirmedGreen && !isTestingOrWaiting
  );
  if (!passedCandleClose) {
    failedGates.push("1H_CANDLE_NOT_CLOSED_GREEN");
  }

  const isReady = failedGates.length === 0;

  let rejectionReason: string | null = null;
  if (!passedRegime) {
    rejectionReason = isStandby ? "STANDBY DAY (HARD BLOCK)" : "RED REGIME (HARD BLOCK)";
  } else if (!passedSmaBounce) {
    rejectionReason = "AWAITING SMA 10/20/50 BOUNCE";
  } else if (!passedCandleClose) {
    rejectionReason = "1H CANDLE AWAITING GREEN CLOSE";
  }

  return {
    isReady,
    passedRegime,
    passedSmaBounce,
    passedCandleClose,
    rejectionReason,
    failedGates,
  };
}
