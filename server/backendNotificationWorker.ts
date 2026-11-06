// ─── Backend 24/7 Notification Engine & Setup Scanner Worker ───────────────
// Migrates useProximityAlert & useSetupScanner evaluation to a persistent
// server-side worker so Telegram, Resend Email, and Twilio SMS payloads
// execute 24/7 even when the browser tab is asleep or the laptop is closed.

import {
  sendTelegramAlert,
  sendTwilioSmsAlert,
  sendPreEntryEmail,
  formatProximityEarlyWarningMessage,
  shouldDispatchAlert,
  canDispatchProximityAlert,
  recordPriceBoundaryExit,
  formatTelegramTradeDeskAlert,
  getVerifiedTelegramChatId,
} from "./pre-entry-alerts";

export {
  shouldDispatchAlert,
  canDispatchProximityAlert,
  recordPriceBoundaryExit,
  formatTelegramTradeDeskAlert,
  getVerifiedTelegramChatId,
};

export const DEFAULT_MONITORED_WATCHLIST: string[] = [
  "QQQ",
  "SMH",
  "SPY",
  "AAPL",
  "MSFT",
  "NVDA",
  "XLV",
  "XLE",
  "XLF",
  "XLI",
  "JPM",
  "CAT",
  "COST",
];

export interface ServerBar1H {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  closed?: boolean;
}

export interface ServerSetupEvaluation {
  symbol: string;
  confirmed: boolean;
  proximityTriggered: boolean;
  alertType:
    | "CONFIRMED_1H_20SMA"
    | "CONFIRMED_1H_10SMA"
    | "READY_TO_TRADE"
    | "PROXIMITY_EARLY_WARNING"
    | null;
  setupType: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  calculatedShares: number;
  order1Shares: number;
  order2Shares: number;
  sma20: number | null;
  sma50?: number | null;
  sma10: number | null;
  barTimestamp: number | null;
  reason: string;
}

export interface SetupAlertState {
  symbol: string;
  alertSent: boolean;
  lastAlertTimestamp: number | null;
  tradingDay: string;
  stopLoss?: number;
  status?: string;
}

export interface ExecutionZoneGateResult {
  setupIsReady: boolean;
  shouldFire: boolean;
  conditionMet: "CONDITION_A_TRIGGER_CONFIRMED" | "CONDITION_B_PROXIMITY_05_PCT" | null;
  distanceToSma20Pct: number | null;
  distanceToSma50Pct?: number | null;
  distanceToEma10Pct: number | null;
  minDistancePct: number | null;
  reason: string;
}

export const EXECUTION_ZONE_PROXIMITY_THRESHOLD = 0.005; // 0.5% (0.005) strict proximity filter

export interface NotificationAuditEntry {
  id: string;
  symbol: string;
  alertSent: boolean;
  lastAlertTimestamp: number;
  alertType:
    | "CONFIRMED_1H_20SMA"
    | "CONFIRMED_1H_10SMA"
    | "READY_TO_TRADE"
    | "PROXIMITY_EARLY_WARNING"
    | "PRE_ENTRY_ALERT";
  setupType: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  calculatedShares: number;
  channels: Array<"telegram" | "email" | "sms">;
  delivery: {
    telegram?: { ok: boolean; status?: string; error?: string };
    email?: { ok: boolean; status?: string; id?: string; error?: string };
    sms?: { ok: boolean; status?: string; error?: string };
  };
  status: "SENT" | "STUBBED" | "FAILED";
  firedAt: number;
  isoTimestamp: string;
  formattedTime: string;
  badgeText: string;
  message: string;
  dedupeKey: string;
}

const notificationAuditLog: NotificationAuditEntry[] = [];
const firedDedupeKeys = new Set<string>();
const setupAlertStateMap = new Map<string, SetupAlertState>();
let workerIntervalHandle: ReturnType<typeof setInterval> | null = null;

export function getTradingDayKey(now: Date | number = Date.now()): string {
  const d = typeof now === "number" ? new Date(now) : now;
  try {
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function getSetupAlertState(symbol: string, now: Date | number = Date.now()): SetupAlertState {
  const clean = (symbol || "NVDA").trim().toUpperCase();
  const todayKey = getTradingDayKey(now);
  const existing = setupAlertStateMap.get(clean);
  if (!existing) {
    const initial: SetupAlertState = {
      symbol: clean,
      alertSent: false,
      lastAlertTimestamp: null,
      tradingDay: todayKey,
    };
    setupAlertStateMap.set(clean, initial);
    return initial;
  }
  // Reset alertSent to false automatically when a new trading day begins
  if (existing.tradingDay !== todayKey) {
    const resetDayState: SetupAlertState = {
      ...existing,
      alertSent: false,
      lastAlertTimestamp: null,
      tradingDay: todayKey,
    };
    setupAlertStateMap.set(clean, resetDayState);
    for (const k of Array.from(firedDedupeKeys)) {
      if (k.startsWith(`${clean}-`)) firedDedupeKeys.delete(k);
    }
    return resetDayState;
  }
  return existing;
}

export function getAllSetupAlertStates(): Record<string, SetupAlertState> {
  const out: Record<string, SetupAlertState> = {};
  for (const [sym] of setupAlertStateMap) {
    out[sym] = getSetupAlertState(sym);
  }
  return out;
}

export function updateSetup(
  symbolOrPatch: string | ({ symbol: string } & Partial<SetupAlertState>),
  patch?: Partial<SetupAlertState>
): SetupAlertState {
  const symRaw = typeof symbolOrPatch === "string" ? symbolOrPatch : symbolOrPatch.symbol;
  const clean = (symRaw || "NVDA").trim().toUpperCase();
  const resolvedPatch = typeof symbolOrPatch === "string" ? (patch || {}) : symbolOrPatch;
  const prev = getSetupAlertState(clean);
  const nextAlertSent = resolvedPatch.alertSent !== undefined ? Boolean(resolvedPatch.alertSent) : prev.alertSent;
  const nextTimestamp =
    resolvedPatch.lastAlertTimestamp !== undefined
      ? resolvedPatch.lastAlertTimestamp
      : nextAlertSent
      ? prev.lastAlertTimestamp ?? Date.now()
      : null;

  const updated: SetupAlertState = {
    ...prev,
    ...resolvedPatch,
    symbol: clean,
    alertSent: nextAlertSent,
    lastAlertTimestamp: nextTimestamp,
  };
  setupAlertStateMap.set(clean, updated);
  return updated;
}

/**
 * Resets a setup's `alertSent` boolean to `false` ONLY when:
 *   1. The setup completely invalidates (e.g. price drops below stopLoss or status is INVALIDATED / SIGNAL_EXPIRED),
 *   2. The setup gets closed out (status === "CLOSED" / "CANCELLED"), or
 *   3. A new trading day begins.
 */
export function resetSetupAlertState(
  symbol: string,
  reason: "INVALIDATED" | "CLOSED" | "NEW_TRADING_DAY" = "INVALIDATED",
  now: Date | number = Date.now()
): SetupAlertState {
  const clean = (symbol || "NVDA").trim().toUpperCase();
  const todayKey = getTradingDayKey(now);
  for (const k of Array.from(firedDedupeKeys)) {
    if (k.startsWith(`${clean}-`)) firedDedupeKeys.delete(k);
  }
  const reset: SetupAlertState = {
    symbol: clean,
    alertSent: false,
    lastAlertTimestamp: null,
    tradingDay: todayKey,
    status: reason,
  };
  setupAlertStateMap.set(clean, reset);
  return reset;
}

export function evaluateSetupAlertResetConditions(params: {
  symbol: string;
  currentPrice?: number | null;
  stopLoss?: number | null;
  status?: string | null;
  now?: Date | number;
}): SetupAlertState {
  const clean = (params.symbol || "NVDA").trim().toUpperCase();
  const state = getSetupAlertState(clean, params.now);
  const statusUpper = String(params.status || "").trim().toUpperCase();

  const isInvalidatedByPrice =
    params.currentPrice != null &&
    params.currentPrice > 0 &&
    params.stopLoss != null &&
    params.stopLoss > 0 &&
    params.currentPrice < params.stopLoss;

  const isInvalidatedByStatus =
    statusUpper === "INVALIDATED" ||
    statusUpper === "SIGNAL_EXPIRED" ||
    statusUpper === "SIGNAL EXPIRED" ||
    statusUpper === "STOP_HIT" ||
    statusUpper === "STOPPED_OUT";

  const isClosedOut =
    statusUpper === "CLOSED" ||
    statusUpper === "CANCELLED" ||
    statusUpper === "EXITED";

  if (isInvalidatedByPrice || isInvalidatedByStatus) {
    return resetSetupAlertState(clean, "INVALIDATED", params.now);
  }
  if (isClosedOut) {
    return resetSetupAlertState(clean, "CLOSED", params.now);
  }
  return state;
}

/**
 * Prop-Desk Terminal Style Message Formatter:
 * Strict format:
 * - Headline: 🚨 CHIZZLE EXECUTION READY: [TICKER]
 * - Status: [ CONFIRMED 1H CLOSE ] or [ PROXIMITY ALERT < 0.5% ]
 * - Core Math: Entry $X.XX | Stop $X.XX | Target 1 (1.5R) $X.XX | Target 2 (2.0R) $X.XX
 * - Actionable Note: Review Fidelity Guide and prepare limit order.
 */
export function formatExecutionReadyAlertMessage(params: {
  ticker: string;
  status: "CONFIRMED_1H_CLOSE" | "PROXIMITY_ALERT_05_PCT" | string;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  instruction?: string;
}): string {
  const ticker = (params.ticker || "NVDA").trim().toUpperCase();
  const entry = Number(params.entryPrice || 0);
  const stop = Number(params.stopLoss || 0);
  const risk = Math.max(0.01, Math.abs(entry - stop));
  const isShort = stop > entry;
  const t1 = Number((params.target1 ?? (isShort ? entry - 1.5 * risk : entry + 1.5 * risk)).toFixed(2));
  const t2 = Number((params.target2 ?? (isShort ? entry - 2.0 * risk : entry + 2.0 * risk)).toFixed(2));

  const statusUpper = (params.status || "").toUpperCase();
  const statusLabel =
    statusUpper.includes("PROXIMITY") || statusUpper === "PROXIMITY_ALERT_05_PCT"
      ? "[ PROXIMITY ALERT < 0.5% ]"
      : "[ CONFIRMED 1H CLOSE ]";

  const note =
    params.instruction ||
    "Review Fidelity Guide and prepare limit order.";

  const shares =
    params.calculatedShares && params.calculatedShares > 0
      ? params.calculatedShares
      : Math.max(1, Math.floor(250 / risk));
  const order1Shares = Math.floor(shares / 2);
  const order2Shares = shares - order1Shares;

  return [
    `🚨 CHIZZLE EXECUTION READY: [${ticker}]`,
    `Status: ${statusLabel}`,
    `Core Math: Entry $${entry.toFixed(2)} | Stop $${stop.toFixed(2)} | Target 1 (1.5R) $${t1.toFixed(2)} | Target 2 (2.0R) $${t2.toFixed(2)}`,
    `Actionable Note: ${note}`,
    `Fidelity Ticket: BUY ${shares} Shares Limit at $${entry.toFixed(2)}. Order 1 SELL ${order1Shares} Shares @ $${t1.toFixed(2)} (1.5R) | Order 2 STOP ${order2Shares} Shares @ $${stop.toFixed(2)}.`,
  ].join("\n");
}

/**
 * 2. Strict "Execution Zone" Proximity Filter:
 * An alert MUST ONLY fire when a setup transitions into the "Active Execution Zone" or is extremely close:
 *   - Condition A (Trade Confirmed): 1-hour candle has officially closed and validated the setup (`isTradeConfirmed === true`).
 *   - Condition B (Close Proximity / Almost Ready): Live price pulls back and is strictly within 0.5% (`<= 0.005`) of the target moving average (SMA 20, SMA 50, or 10-EMA).
 *   - Suppress and drop all alerts for general "Watch", "No Trade", "Forming", or background scanning logs.
 */
export function evaluateExecutionZoneAlertGate(params: {
  symbol: string;
  currentPrice: number;
  sma20?: number | null;
  sma50?: number | null;
  ema10?: number | null;
  sma10?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  isTradeConfirmed?: boolean;
  is1hCandleClosedGreenOffMa?: boolean;
  status?: string | null;
  now?: Date | number;
}): ExecutionZoneGateResult {
  const symbol = (params.symbol || "NVDA").trim().toUpperCase();
  const livePrice = Number(params.currentPrice || 0);
  const stopLoss = params.stopLoss != null && params.stopLoss > 0 ? Number(params.stopLoss) : null;

  // Evaluate reset conditions first (invalidation, closed out, or new trading day)
  const setup = evaluateSetupAlertResetConditions({
    symbol,
    currentPrice: livePrice,
    stopLoss,
    status: params.status,
    now: params.now,
  });

  // If price invalidated below stopLoss, never fire
  if (stopLoss != null && livePrice > 0 && livePrice < stopLoss) {
    return {
      setupIsReady: false,
      shouldFire: false,
      conditionMet: null,
      distanceToSma20Pct: null,
      distanceToSma50Pct: null,
      distanceToEma10Pct: null,
      minDistancePct: null,
      reason: `${symbol} invalidated below Stop Loss ($${stopLoss.toFixed(2)}). Alert state reset.`,
    };
  }

  const sma20Target = params.sma20 != null && params.sma20 > 0 ? Number(params.sma20) : null;
  const sma50Target = params.sma50 != null && params.sma50 > 0 ? Number(params.sma50) : null;
  const ema10Target =
    params.ema10 != null && params.ema10 > 0
      ? Number(params.ema10)
      : params.sma10 != null && params.sma10 > 0
      ? Number(params.sma10)
      : null;
  const fallbackEntryTarget =
    sma20Target == null && sma50Target == null && ema10Target == null && params.entryPrice != null && params.entryPrice > 0
      ? Number(params.entryPrice)
      : null;

  const distanceToSma20Pct =
    livePrice > 0 && sma20Target != null
      ? Math.abs(livePrice - sma20Target) / sma20Target
      : fallbackEntryTarget != null && livePrice > 0
      ? Math.abs(livePrice - fallbackEntryTarget) / fallbackEntryTarget
      : null;

  const distanceToSma50Pct =
    livePrice > 0 && sma50Target != null
      ? Math.abs(livePrice - sma50Target) / sma50Target
      : null;

  const distanceToEma10Pct =
    livePrice > 0 && ema10Target != null
      ? Math.abs(livePrice - ema10Target) / ema10Target
      : null;

  const distances = [distanceToSma20Pct, distanceToSma50Pct, distanceToEma10Pct].filter(
    (d): d is number => d != null && Number.isFinite(d)
  );
  const minDistancePct = distances.length > 0 ? Math.min(...distances) : null;

  // Condition A (Trade Confirmed): 1-hour candle has officially closed and validated the setup (`isTradeConfirmed === true`)
  const conditionAConfirmed = Boolean(params.isTradeConfirmed === true || params.is1hCandleClosedGreenOffMa === true);

  // Condition B (Close Proximity / Almost Ready): Live price is strictly within 0.5% (<= 0.005) of target MA (SMA 20, SMA 50, or 10-EMA)
  const conditionBProximity =
    minDistancePct != null && minDistancePct <= EXECUTION_ZONE_PROXIMITY_THRESHOLD;

  const setupIsReady = conditionAConfirmed || conditionBProximity;
  const conditionMet = conditionAConfirmed
    ? "CONDITION_A_TRIGGER_CONFIRMED"
    : conditionBProximity
    ? "CONDITION_B_PROXIMITY_05_PCT"
    : null;

  // Suppress and drop all alerts for general "Watch", "No Trade", "Forming", or background scanning logs
  const statusUpper = (params.status || "").trim().toUpperCase();
  const isFormingOrWatchOrNoTrade =
    statusUpper === "WATCH" ||
    statusUpper === "WATCH_LIST" ||
    statusUpper === "WATCHLIST" ||
    statusUpper === "WATCH_RETEST" ||
    statusUpper === "WATCH_EXTENDED" ||
    statusUpper === "NO_TRADE" ||
    statusUpper === "NO TRADE" ||
    statusUpper === "FORMING" ||
    statusUpper === "SETUP_FORMING" ||
    statusUpper === "SCANNING" ||
    statusUpper === "BACKGROUND_SCAN" ||
    statusUpper === "BACKGROUND_LOG";

  if (isFormingOrWatchOrNoTrade && !conditionAConfirmed && !conditionBProximity) {
    return {
      setupIsReady: false,
      shouldFire: false,
      conditionMet: null,
      distanceToSma20Pct,
      distanceToSma50Pct,
      distanceToEma10Pct,
      minDistancePct,
      reason: `${symbol} is in non-actionable status '${params.status}' (not confirmed and out of 0.5% proximity). Alert suppressed.`,
    };
  }

  if (!setupIsReady) {
    return {
      setupIsReady: false,
      shouldFire: false,
      conditionMet: null,
      distanceToSma20Pct,
      distanceToSma50Pct,
      distanceToEma10Pct,
      minDistancePct,
      reason: `${symbol} is out of Execution Zone range (${
        minDistancePct != null ? (minDistancePct * 100).toFixed(2) + "%" : "N/A"
      } > 0.5% from target MA and not confirmed). Alert suppressed.`,
    };
  }

  // Strict deduplication gate: if (setupIsReady && !setup.alertSent)
  if (setup.alertSent) {
    return {
      setupIsReady: true,
      shouldFire: false,
      conditionMet,
      distanceToSma20Pct,
      distanceToSma50Pct,
      distanceToEma10Pct,
      minDistancePct,
      reason: `${symbol} alert already sent for this setup at ${setup.lastAlertTimestamp}. Duplicate suppressed.`,
    };
  }

  return {
    setupIsReady: true,
    shouldFire: true,
    conditionMet,
    distanceToSma20Pct,
    distanceToSma50Pct,
    distanceToEma10Pct,
    minDistancePct,
    reason:
      conditionMet === "CONDITION_A_TRIGGER_CONFIRMED"
        ? `${symbol} Trigger Confirmed (1H candle closed green off moving average).`
        : `${symbol} Proximity Warning: within ${(minDistancePct! * 100).toFixed(2)}% (<= 0.5%) of target MA.`,
  };
}

function computeSimpleMovingAverage(values: number[], period: number): number | null {
  if (!values || values.length === 0) return null;
  const slice = values.length >= period ? values.slice(-period) : values;
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return Number((sum / slice.length).toFixed(2));
}

export function formatAlertTimestampCT(timestampMs: number = Date.now()): string {
  try {
    return new Date(timestampMs).toLocaleTimeString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(timestampMs).toISOString().slice(11, 16);
  }
}

/**
 * Evaluates 1-hour closed candle confirmation & proximity alerts on the server
 * for any watchlist ticker (e.g., XLV hitting and holding the 20-SMA or 10-SMA).
 */
export function evaluateServer1HCandleConfirmation(params: {
  symbol: string;
  bars1h: ServerBar1H[];
  currentPrice?: number;
  entryPriceOverride?: number;
  stopLossOverride?: number;
  target1Override?: number;
  setupStatus?: string;
  accountEquity?: number;
  riskPercentage?: number;
}): ServerSetupEvaluation {
  const symbol = params.symbol.trim().toUpperCase();
  const bars = params.bars1h || [];
  const closedBars = bars.filter((b) => b.closed !== false);
  const workingBars = closedBars.length > 0 ? closedBars : bars;
  const lastBar = workingBars.length > 0 ? workingBars[workingBars.length - 1] : null;
  const closes = workingBars.map((b) => b.c);

  const sma20 = computeSimpleMovingAverage(closes, 20);
  const sma50 = computeSimpleMovingAverage(closes, 50);
  const sma10 = computeSimpleMovingAverage(closes, 10);
  const livePrice =
    params.currentPrice != null && params.currentPrice > 0
      ? params.currentPrice
      : lastBar?.c ?? 0;

  const isRunawayMomentum =
    sma20 != null && sma10 != null && livePrice > sma20 * 1.03;

  // Check if the latest closed 1H candle touched and held the 20-SMA or 10-SMA and closed green
  const isGreenClose = lastBar != null && lastBar.c >= lastBar.o;
  const holds20Sma =
    lastBar != null &&
    sma20 != null &&
    isGreenClose &&
    lastBar.l <= sma20 * 1.006 &&
    lastBar.c >= sma20 * 0.998;

  const holds10Sma =
    lastBar != null &&
    sma10 != null &&
    isRunawayMomentum &&
    isGreenClose &&
    lastBar.l <= sma10 * 1.006 &&
    lastBar.c >= sma10 * 0.998;

  const isStatusReady =
    params.setupStatus === "READY_TO_TRADE" ||
    params.setupStatus === "SETUP_CONFIRMED" ||
    params.setupStatus === "Ready";

  const anchorSupport = holds10Sma ? sma10! : sma20 ?? livePrice * 0.99;
  const entryPrice = Number(
    (
      params.entryPriceOverride ??
      (lastBar ? Math.max(lastBar.c, anchorSupport) : livePrice)
    ).toFixed(2)
  );
  const rawStop =
    params.stopLossOverride ??
    (lastBar
      ? Math.min(lastBar.l * 0.995, entryPrice * 0.985)
      : entryPrice * 0.985);
  const stopLoss = Number(Math.min(rawStop, entryPrice - 0.05).toFixed(2));
  const riskPerShare = Math.max(0.01, entryPrice - stopLoss);
  const target1 = Number(
    (params.target1Override ?? entryPrice + 1.5 * riskPerShare).toFixed(2)
  );
  const target2 = Number((entryPrice + 2.0 * riskPerShare).toFixed(2));

  const equity = params.accountEquity && params.accountEquity > 0 ? params.accountEquity : 25000;
  const riskPct = params.riskPercentage && params.riskPercentage > 0 ? params.riskPercentage : 1.0;
  const dollarRisk = equity * (riskPct / 100);
  const calculatedShares = Math.max(1, Math.floor(dollarRisk / riskPerShare));
  const order1Shares = Math.floor(calculatedShares / 2);
  const order2Shares = calculatedShares - order1Shares;

  // Strict Execution Zone Proximity check (within 0.5% of SMA 20, SMA 50, or EMA 10 / SMA 10 and above stopLoss)
  const gateEval = evaluateExecutionZoneAlertGate({
    symbol,
    currentPrice: livePrice,
    sma20,
    sma50,
    sma10,
    entryPrice,
    stopLoss,
    isTradeConfirmed: holds10Sma || holds20Sma || isStatusReady,
    is1hCandleClosedGreenOffMa: holds10Sma || holds20Sma,
    status: params.setupStatus,
  });

  const proximityTriggered =
    gateEval.conditionMet === "CONDITION_B_PROXIMITY_05_PCT" ||
    (livePrice > 0 &&
      entryPrice > 0 &&
      Math.abs(livePrice - entryPrice) / entryPrice <= EXECUTION_ZONE_PROXIMITY_THRESHOLD &&
      livePrice >= stopLoss);

  let confirmed = false;
  let alertType: ServerSetupEvaluation["alertType"] = null;
  let setupType = "20-SMA Pullback Bounce · 1H";
  let reason = "Monitoring 1H structure";

  if (holds10Sma) {
    confirmed = true;
    alertType = "CONFIRMED_1H_10SMA";
    setupType = "[ MOMENTUM SETUP: 10-SMA ] · 1H";
    reason = `${symbol} 1H candle closed green holding 10-SMA ($${sma10?.toFixed(2)}) in runaway bull trend.`;
  } else if (holds20Sma) {
    confirmed = true;
    alertType = "CONFIRMED_1H_20SMA";
    setupType = "20-SMA Pullback Confirmed · 1H";
    reason = `${symbol} 1H candle closed green holding 20-SMA ($${sma20?.toFixed(2)}) support.`;
  } else if (isStatusReady) {
    confirmed = true;
    alertType = "READY_TO_TRADE";
    setupType = isRunawayMomentum ? "[ MOMENTUM SETUP: 10-SMA ] · 1H" : "20-SMA Swing Setup · 1H";
    reason = `${symbol} confirmed READY_TO_TRADE on 1H candle close.`;
  } else if (proximityTriggered) {
    alertType = "PROXIMITY_EARLY_WARNING";
    reason = `${symbol} trading within 0.5% of target Moving Average ($${entryPrice.toFixed(2)}).`;
  }

  return {
    symbol,
    confirmed,
    proximityTriggered,
    alertType,
    setupType,
    currentPrice: livePrice,
    entryPrice,
    stopLoss,
    target1,
    target2,
    calculatedShares,
    order1Shares,
    order2Shares,
    sma20,
    sma50,
    sma10,
    barTimestamp: lastBar?.t ?? null,
    reason,
  };
}

/**
 * Records an alert event into the server-side Notification Audit Log so the UI
 * can render the `[ 🔔 Alert Sent ]` timestamp badge on the matching Setup Card.
 */
export function recordNotificationAudit(params: {
  symbol: string;
  alertType?: NotificationAuditEntry["alertType"];
  setupType?: string;
  entryPrice?: number;
  stopLoss?: number;
  target1?: number;
  calculatedShares?: number;
  channels?: Array<"telegram" | "email" | "sms">;
  delivery?: NotificationAuditEntry["delivery"];
  status?: "SENT" | "STUBBED" | "FAILED";
  firedAt?: number;
  message?: string;
  dedupeKey?: string;
}): NotificationAuditEntry {
  const symbol = (params.symbol || "NVDA").trim().toUpperCase();
  const firedAt = params.firedAt ?? Date.now();
  const formattedTime = formatAlertTimestampCT(firedAt);
  const entryPrice = Number(params.entryPrice ?? 0);
  const stopLoss = Number(params.stopLoss ?? 0);
  const target1 = Number(params.target1 ?? 0);
  const riskPerShare = Math.max(0.01, Math.abs(entryPrice - stopLoss));
  const calculatedShares =
    params.calculatedShares && params.calculatedShares > 0
      ? params.calculatedShares
      : entryPrice > 0 && stopLoss > 0
      ? Math.max(1, Math.floor(250 / riskPerShare))
      : 10;

  updateSetup(symbol, {
    alertSent: true,
    lastAlertTimestamp: firedAt,
    stopLoss: stopLoss > 0 ? stopLoss : undefined,
  });

  const entry: NotificationAuditEntry = {
    id: `alert-${symbol}-${firedAt}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    alertSent: true,
    lastAlertTimestamp: firedAt,
    alertType: params.alertType ?? "CONFIRMED_1H_20SMA",
    setupType: params.setupType ?? "20-SMA Pullback Confirmed · 1H",
    entryPrice,
    stopLoss,
    target1,
    calculatedShares,
    channels: params.channels ?? ["telegram", "email", "sms"],
    delivery: params.delivery ?? {},
    status: params.status ?? "SENT",
    firedAt,
    isoTimestamp: new Date(firedAt).toISOString(),
    formattedTime,
    badgeText: `[ 🔔 Alert Sent · ${formattedTime} ]`,
    message:
      params.message ??
      `🚨 CHIZZLE CONFIRMED SETUP: ${symbol} 1H candle confirmed at $${entryPrice.toFixed(2)}. Stop $${stopLoss.toFixed(2)} · T1 $${target1.toFixed(2)} (${calculatedShares} shares).`,
    dedupeKey: params.dedupeKey ?? `${symbol}-${params.alertType ?? "CONFIRMED"}-${entryPrice.toFixed(2)}`,
  };

  notificationAuditLog.unshift(entry);
  if (notificationAuditLog.length > 250) {
    notificationAuditLog.length = 250;
  }
  firedDedupeKeys.add(entry.dedupeKey);
  return entry;
}

/**
 * Dispatches Twilio SMS, Resend Email, and Telegram Bot API payloads directly
 * from the backend server and logs the audit trail entry.
 * Enforces strict deduplication gate:
 *   if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }
 */
export async function dispatchServerSetupAlert(params: {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  currentPrice?: number;
  sma20?: number | null;
  sma50?: number | null;
  ema10?: number | null;
  sma10?: number | null;
  isTradeConfirmed?: boolean;
  status?: string;
  calculatedShares?: number;
  alertType?: NotificationAuditEntry["alertType"];
  setupType?: string;
  context?: string;
  barTimestamp?: number | null;
  chatId?: string;
  email?: string;
  phoneNumber?: string;
  force?: boolean;
}): Promise<{
  ok: boolean;
  suppressed: boolean;
  alertSent: boolean;
  lastAlertTimestamp: number | null;
  setupState: SetupAlertState;
  auditEntry: NotificationAuditEntry;
}> {
  const symbol = params.symbol.trim().toUpperCase();
  const alertType = params.alertType ?? "CONFIRMED_1H_20SMA";
  const barKey = params.barTimestamp ?? Math.floor(Date.now() / 3_600_000);
  const dedupeKey = `${symbol}-${alertType}-${Number(params.entryPrice || 0).toFixed(2)}-${barKey}`;

  // Evaluate reset conditions (invalidation < stopLoss, closed out, or new trading day)
  const setup = evaluateSetupAlertResetConditions({
    symbol,
    currentPrice: params.currentPrice,
    stopLoss: params.stopLoss,
    status: params.status,
  });

  // Strict Execution Zone check when live price & moving averages / status are provided
  const isConfirmedAlertType =
    alertType === "CONFIRMED_1H_20SMA" ||
    alertType === "CONFIRMED_1H_10SMA" ||
    alertType === "READY_TO_TRADE" ||
    Boolean(params.isTradeConfirmed);

  const gate = evaluateExecutionZoneAlertGate({
    symbol,
    currentPrice: params.currentPrice ?? params.entryPrice,
    sma20: params.sma20,
    sma50: params.sma50,
    ema10: params.ema10,
    sma10: params.sma10,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    isTradeConfirmed: params.isTradeConfirmed ?? isConfirmedAlertType,
    status: params.status,
  });

  const isProximityAlertType =
    alertType === "PROXIMITY_EARLY_WARNING" ||
    gate.conditionMet === "CONDITION_B_PROXIMITY_05_PCT";

  const setupIsReady = gate.setupIsReady;

  // Strict Two-Layer Gatekeeper (Candle-Bound Hash Ledger & Cooldown Gate)
  if (!params.force) {
    if (isProximityAlertType) {
      const proxGate = canDispatchProximityAlert(symbol);
      if (!proxGate.allowed) {
        return {
          ok: true,
          suppressed: true,
          alertSent: setup.alertSent,
          lastAlertTimestamp: setup.lastAlertTimestamp,
          setupState: setup,
          auditEntry: {
            id: `suppressed-${symbol}-${Date.now()}`,
            symbol,
            alertSent: setup.alertSent,
            lastAlertTimestamp: setup.lastAlertTimestamp ?? 0,
            alertType,
            setupType: params.setupType ?? "Suppressed",
            entryPrice: params.entryPrice,
            stopLoss: params.stopLoss,
            target1: params.target1,
            calculatedShares: params.calculatedShares ?? 0,
            channels: [],
            delivery: {},
            status: "STUBBED",
            firedAt: setup.lastAlertTimestamp ?? Date.now(),
            isoTimestamp: new Date().toISOString(),
            formattedTime: formatAlertTimestampCT(),
            badgeText: "[ Suppressed · Cooldown ]",
            message: proxGate.reason || "Proximity cooldown active",
            dedupeKey,
          },
        };
      }

      if (!shouldDispatchAlert(symbol, barKey, "PROXIMITY_ALERT_05_PCT", "1h")) {
        return {
          ok: true,
          suppressed: true,
          alertSent: setup.alertSent,
          lastAlertTimestamp: setup.lastAlertTimestamp,
          setupState: setup,
          auditEntry: {
            id: `suppressed-${symbol}-${Date.now()}`,
            symbol,
            alertSent: setup.alertSent,
            lastAlertTimestamp: setup.lastAlertTimestamp ?? 0,
            alertType,
            setupType: params.setupType ?? "Suppressed",
            entryPrice: params.entryPrice,
            stopLoss: params.stopLoss,
            target1: params.target1,
            calculatedShares: params.calculatedShares ?? 0,
            channels: [],
            delivery: {},
            status: "STUBBED",
            firedAt: setup.lastAlertTimestamp ?? Date.now(),
            isoTimestamp: new Date().toISOString(),
            formattedTime: formatAlertTimestampCT(),
            badgeText: "[ Suppressed · Candle Dedupe ]",
            message: "Proximity alert already dispatched for current 1H bar",
            dedupeKey,
          },
        };
      }
    } else if (isConfirmedAlertType) {
      if (!shouldDispatchAlert(symbol, barKey, "CONFIRMED_1H_CLOSE", "1h")) {
        return {
          ok: true,
          suppressed: true,
          alertSent: setup.alertSent,
          lastAlertTimestamp: setup.lastAlertTimestamp,
          setupState: setup,
          auditEntry: {
            id: `suppressed-${symbol}-${Date.now()}`,
            symbol,
            alertSent: setup.alertSent,
            lastAlertTimestamp: setup.lastAlertTimestamp ?? 0,
            alertType,
            setupType: params.setupType ?? "Suppressed",
            entryPrice: params.entryPrice,
            stopLoss: params.stopLoss,
            target1: params.target1,
            calculatedShares: params.calculatedShares ?? 0,
            channels: [],
            delivery: {},
            status: "STUBBED",
            firedAt: setup.lastAlertTimestamp ?? Date.now(),
            isoTimestamp: new Date().toISOString(),
            formattedTime: formatAlertTimestampCT(),
            badgeText: "[ Suppressed · Confirmed Dedupe ]",
            message: "Confirmed 1H close alert already dispatched for current 1H bar",
            dedupeKey,
          },
        };
      }
    }
  }

  // Strict deduplication & proximity logic gate:
  // if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }
  if (!params.force && (!setupIsReady || setup.alertSent || firedDedupeKeys.has(dedupeKey))) {
    const existing =
      notificationAuditLog.find((e) => e.dedupeKey === dedupeKey) ??
      getLatestAlertForSymbol(symbol);
    const placeholderAudit: NotificationAuditEntry =
      existing || {
        id: `suppressed-${symbol}-${Date.now()}`,
        symbol,
        alertSent: setup.alertSent,
        lastAlertTimestamp: setup.lastAlertTimestamp ?? 0,
        alertType,
        setupType: params.setupType ?? "Suppressed",
        entryPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        target1: params.target1,
        calculatedShares: params.calculatedShares ?? 0,
        channels: [],
        delivery: {},
        status: "STUBBED",
        firedAt: setup.lastAlertTimestamp ?? Date.now(),
        isoTimestamp: new Date().toISOString(),
        formattedTime: formatAlertTimestampCT(),
        badgeText: setup.alertSent ? "[ 🔔 Alert Sent ]" : "[ Suppressed ]",
        message: gate.reason,
        dedupeKey,
      };
    return {
      ok: true,
      suppressed: true,
      alertSent: setup.alertSent,
      lastAlertTimestamp: setup.lastAlertTimestamp,
      setupState: setup,
      auditEntry: placeholderAudit,
    };
  }

  const riskPerShare = Math.max(0.01, Math.abs(params.entryPrice - params.stopLoss));
  const calculatedShares =
    params.calculatedShares && params.calculatedShares > 0
      ? params.calculatedShares
      : Math.max(1, Math.floor(250 / riskPerShare));
  const order1Shares = Math.floor(calculatedShares / 2);
  const order2Shares = calculatedShares - order1Shares;

  const target1 = Number(
    (params.target1 ?? (params.entryPrice + 1.5 * riskPerShare)).toFixed(2)
  );
  const target2 = Number((params.entryPrice + 2.0 * riskPerShare).toFixed(2));

  const statusLabel =
    gate.conditionMet === "CONDITION_B_PROXIMITY_05_PCT" ||
    alertType === "PROXIMITY_EARLY_WARNING"
      ? "PROXIMITY_ALERT_05_PCT"
      : "CONFIRMED_1H_CLOSE";

  const message = formatExecutionReadyAlertMessage({
    ticker: symbol,
    status: statusLabel,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    target1,
    target2,
    calculatedShares,
    instruction: "Review Fidelity Guide and prepare limit order.",
  });

  const contextText =
    params.context ||
    (alertType === "CONFIRMED_1H_10SMA"
      ? "1H Candle Closed Green on 10-SMA Momentum Support"
      : alertType === "PROXIMITY_EARLY_WARNING"
      ? "Price within 0.5% of Target Moving Average"
      : "1H Candle Closed Green Holding 20-SMA Support");

  const targetChatId = params.chatId || process.env.TELEGRAM_CHAT_ID || "7864955612";
  const targetEmail = params.email || process.env.USER_ALERT_EMAIL || "jakechairez@gmail.com";
  const targetPhone = params.phoneNumber || process.env.ALERT_PHONE_NUMBER || "";

  // Execute inside strict gate: if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }
  let auditEntry: NotificationAuditEntry;
  let updatedState = setup;

  if (setupIsReady && (!setup.alertSent || params.force)) {
    const telegramMessage = formatTelegramTradeDeskAlert({
      ticker: symbol,
      event: isProximityAlertType ? "PROXIMITY < 0.5%" : "CONFIRMED 1H CLOSE",
      regime: "Pullback Valid (4H 20-SMA)",
      entryPrice: params.entryPrice,
      stopLoss: params.stopLoss,
      target1,
      target2,
      shares: calculatedShares,
      status: "ACTIONABLE",
    });

    const verifiedChatId = getVerifiedTelegramChatId(params.chatId) || targetChatId;

    const [telegramRes, emailRes, smsRes] = await Promise.all([
      sendTelegramAlert(telegramMessage, verifiedChatId),
      sendPreEntryEmail({
        userEmail: targetEmail,
        ticker: symbol,
        entryPrice: params.entryPrice,
        target1: target1,
        context: contextText,
        setupId: `${symbol}-${barKey}`,
        alertType,
        message,
        plan: {
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss,
          target1: target1,
          shares: calculatedShares,
        } as any,
      }),
      sendTwilioSmsAlert(targetPhone, message),
    ]);

    const nowTs = Date.now();
    updatedState = updateSetup(symbol, {
      alertSent: true,
      lastAlertTimestamp: nowTs,
      stopLoss: params.stopLoss,
    });

    const channels: Array<"telegram" | "email" | "sms"> = ["telegram", "email", "sms"];
    auditEntry = recordNotificationAudit({
      symbol,
      alertType,
      setupType: params.setupType ?? contextText,
      entryPrice: params.entryPrice,
      stopLoss: params.stopLoss,
      target1: params.target1,
      calculatedShares,
      channels,
      delivery: {
        telegram: telegramRes,
        email: emailRes,
        sms: smsRes,
      },
      status: "SENT",
      firedAt: nowTs,
      message,
      dedupeKey,
    });
  } else {
    auditEntry = getLatestAlertForSymbol(symbol)!;
  }

  return {
    ok: true,
    suppressed: false,
    alertSent: true,
    lastAlertTimestamp: updatedState.lastAlertTimestamp,
    setupState: updatedState,
    auditEntry,
  };
}

export function getNotificationAuditLog(symbol?: string): NotificationAuditEntry[] {
  if (!symbol) return [...notificationAuditLog];
  const clean = symbol.trim().toUpperCase();
  return notificationAuditLog.filter((e) => e.symbol === clean);
}

export function getLatestAlertForSymbol(symbol: string): NotificationAuditEntry | null {
  if (!symbol) return null;
  const clean = symbol.trim().toUpperCase();
  return notificationAuditLog.find((e) => e.symbol === clean) ?? null;
}

export function getLatestAlertsBySymbolMap(): Record<string, NotificationAuditEntry> {
  const map: Record<string, NotificationAuditEntry> = {};
  for (const entry of notificationAuditLog) {
    if (!map[entry.symbol]) {
      map[entry.symbol] = entry;
    }
  }
  return map;
}

export function clearNotificationAuditLog(): void {
  notificationAuditLog.length = 0;
  firedDedupeKeys.clear();
  setupAlertStateMap.clear();
}

/**
 * Runs one full server-side scan cycle across the active watchlist and immediately
 * fires Telegram, Resend Email, and Twilio SMS alerts for any setups meeting
 * Condition A (1H Trigger Confirmed) or Condition B (<= 0.5% Proximity to SMA 20 / EMA 10).
 */
export async function runBackendWatchlistAlertScan(options?: {
  symbols?: string[];
  fetchBarsForSymbol?: (symbol: string) => Promise<ServerBar1H[]>;
  getQuoteForSymbol?: (symbol: string) => { price?: number } | null | undefined;
}): Promise<{
  scannedSymbols: string[];
  firedAlerts: NotificationAuditEntry[];
}> {
  const symbols = Array.from(
    new Set(
      (options?.symbols && options.symbols.length > 0
        ? options.symbols
        : DEFAULT_MONITORED_WATCHLIST
      ).map((s) => s.trim().toUpperCase())
    )
  );

  const firedAlerts: NotificationAuditEntry[] = [];

  for (const sym of symbols) {
    try {
      let bars: ServerBar1H[] = [];
      if (options?.fetchBarsForSymbol) {
        bars = await options.fetchBarsForSymbol(sym);
      } else {
        const { fetch1H } = await import("./swing/feed");
        const feedRes = await fetch1H(sym).catch(() => null);
        if (feedRes && Array.isArray((feedRes as any).bars)) {
          bars = (feedRes as any).bars;
        }
      }

      if (!bars || bars.length === 0) continue;

      const quote = options?.getQuoteForSymbol ? options.getQuoteForSymbol(sym) : null;
      const evaluation = evaluateServer1HCandleConfirmation({
        symbol: sym,
        bars1h: bars,
        currentPrice: quote?.price,
      });

      const setup = evaluateSetupAlertResetConditions({
        symbol: sym,
        currentPrice: evaluation.currentPrice,
        stopLoss: evaluation.stopLoss,
      });

      const gate = evaluateExecutionZoneAlertGate({
        symbol: sym,
        currentPrice: evaluation.currentPrice,
        sma20: evaluation.sma20,
        sma50: evaluation.sma50,
        sma10: evaluation.sma10,
        entryPrice: evaluation.entryPrice,
        stopLoss: evaluation.stopLoss,
        isTradeConfirmed: evaluation.confirmed,
      });

      const setupIsReady = gate.setupIsReady && Boolean(evaluation.alertType);
      if (setupIsReady && !setup.alertSent) {
        const dispatched = await dispatchServerSetupAlert({
          symbol: sym,
          entryPrice: evaluation.entryPrice,
          stopLoss: evaluation.stopLoss,
          target1: evaluation.target1,
          currentPrice: evaluation.currentPrice,
          sma20: evaluation.sma20,
          sma50: evaluation.sma50,
          sma10: evaluation.sma10,
          isTradeConfirmed: evaluation.confirmed,
          calculatedShares: evaluation.calculatedShares,
          alertType: evaluation.alertType!,
          setupType: evaluation.setupType,
          context: evaluation.reason,
          barTimestamp: evaluation.barTimestamp,
        });
        if (!dispatched.suppressed) {
          firedAlerts.push(dispatched.auditEntry);
        }
      }
    } catch (err) {
      // Never let a single symbol error halt the 24/7 background worker
    }
  }

  return {
    scannedSymbols: symbols,
    firedAlerts,
  };
}

/**
 * Starts the persistent 24/7 server-side notification worker that continuously
 * monitors the active Watchlist independent of the user's browser.
 */
export function startBackendNotificationWorker(intervalMs = 60_000): {
  running: boolean;
  intervalMs: number;
} {
  if (workerIntervalHandle) {
    return { running: true, intervalMs };
  }

  workerIntervalHandle = setInterval(() => {
    void runBackendWatchlistAlertScan().catch((err) => {
      console.warn("[backend-notification-worker] scan error:", err?.message || err);
    });
  }, intervalMs);

  if (typeof (workerIntervalHandle as any)?.unref === "function") {
    (workerIntervalHandle as any).unref();
  }

  return { running: true, intervalMs };
}

export function stopBackendNotificationWorker(): void {
  if (workerIntervalHandle) {
    clearInterval(workerIntervalHandle);
    workerIntervalHandle = null;
  }
}

