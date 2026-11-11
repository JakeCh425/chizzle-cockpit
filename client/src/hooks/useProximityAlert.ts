import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { globalStore } from "@/lib/useMarketDataStore";

export const PROXIMITY_ALERT_PERCENT = 0.3; // 0.3%
export const STRICT_EXECUTION_ZONE_PROXIMITY_PCT = 0.5; // 0.5% (0.005) strict proximity to SMA 20 / EMA 10

export interface ProximityAlertInput {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  shares?: number;
  sma20?: number;
  sma50?: number;
  ema10?: number;
  sma10?: number;
  isTradeConfirmed?: boolean;
  status?: string;
  chatId?: string;
  email?: string;
  enabled?: boolean;
  onAlertTriggered?: (payload: ProximityAlertPayload) => void;
}

export interface ProximityAlertPayload {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  shares?: number;
  alertThreshold: number;
  distancePct: number;
  message: string;
  chatId?: string;
  email?: string;
  alertSent?: boolean;
  lastAlertTimestamp?: number;
}

export interface ProximityTriggerEvaluation {
  shouldFire: boolean;
  alertThreshold: number;
  distancePct: number;
  isWithinThreshold: boolean;
  message: string;
  dedupeKey: string;
  conditionMet?: "CONDITION_A_TRIGGER_CONFIRMED" | "CONDITION_B_PROXIMITY_05_PCT" | null;
}

/**
 * Calculates warning threshold: alertThreshold = entryPrice * 1.003 (within 0.3% of entry).
 */
export function calculateProximityAlertThreshold(entryPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  return +(entryPrice * 1.003).toFixed(4);
}

/**
 * Standard prop-desk formatted execution ready message with exact live calculated shares
 */
export function formatExecutionReadyAlertMessage(params: {
  ticker: string;
  status: "CONFIRMED_1H_CLOSE" | "PROXIMITY_ALERT_05_PCT" | string;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  shares?: number;
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
    Number(params.calculatedShares || params.shares || 0) > 0
      ? Number(params.calculatedShares || params.shares)
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
 * Standard message template:
 * "🚨 CHIZZLE EARLY WARNING: {Ticker} is within 0.3% of your Entry Price (${entryPrice}). Open your Fidelity app now and prepare for 1H candle close."
 */
export function formatProximityEarlyWarningMessage(params: {
  ticker: string;
  entryPrice: number;
}): string {
  const ticker = (params.ticker || "NVDA").trim().toUpperCase();
  const entryStr = `$${Number(params.entryPrice || 0).toFixed(2)}`;
  return `🚨 CHIZZLE EARLY WARNING: ${ticker} is within 0.3% of your Entry Price (${entryStr}). Open your Fidelity app now and prepare for 1H candle close.`;
}

/**
 * Strict "Execution Zone" Proximity Filter (Condition A & Condition B):
 *   - Condition A (Trigger Confirmed): 1-hour candle closes green off the SMA/EMA and setup state is `isTradeConfirmed === true`.
 *   - Condition B (Proximity Warning): Live price pulls back and is strictly within 0.5% (`<= 0.005`) of the target moving average (SMA 20 or EMA 10 / SMA 10).
 *   - Never fires for setups that are simply "Forming" or sitting on the Watchlist out of range (> 0.5% away and not confirmed).
 */
export function evaluateExecutionZoneProximityFilter(params: {
  ticker: string;
  currentPrice: number;
  sma20?: number | null;
  sma50?: number | null;
  ema10?: number | null;
  sma10?: number | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  isTradeConfirmed?: boolean;
  alertSent?: boolean;
}): {
  setupIsReady: boolean;
  shouldFire: boolean;
  conditionMet: "CONDITION_A_TRIGGER_CONFIRMED" | "CONDITION_B_PROXIMITY_05_PCT" | null;
  minDistancePct: number | null;
} {
  const livePrice = Number(params.currentPrice || 0);
  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    return { setupIsReady: false, shouldFire: false, conditionMet: null, minDistancePct: null };
  }
  if (params.stopLoss != null && params.stopLoss > 0 && livePrice < params.stopLoss) {
    return { setupIsReady: false, shouldFire: false, conditionMet: null, minDistancePct: null };
  }

  const sma20Target = params.sma20 != null && params.sma20 > 0 ? Number(params.sma20) : null;
  const sma50Target = params.sma50 != null && params.sma50 > 0 ? Number(params.sma50) : null;
  const ema10Target =
    params.ema10 != null && params.ema10 > 0
      ? Number(params.ema10)
      : params.sma10 != null && params.sma10 > 0
      ? Number(params.sma10)
      : null;
  const entryTarget =
    sma20Target == null && sma50Target == null && ema10Target == null && params.entryPrice != null && params.entryPrice > 0
      ? Number(params.entryPrice)
      : null;

  const distSma20 =
    sma20Target != null
      ? Math.abs(livePrice - sma20Target) / sma20Target
      : entryTarget != null
      ? Math.abs(livePrice - entryTarget) / entryTarget
      : null;
  const distSma50 = sma50Target != null ? Math.abs(livePrice - sma50Target) / sma50Target : null;
  const distEma10 = ema10Target != null ? Math.abs(livePrice - ema10Target) / ema10Target : null;

  const validDists = [distSma20, distSma50, distEma10].filter((d): d is number => d != null && Number.isFinite(d));
  const minDistanceRatio = validDists.length > 0 ? Math.min(...validDists) : null;
  const minDistancePct = minDistanceRatio != null ? +(minDistanceRatio * 100).toFixed(4) : null;

  const conditionA = Boolean(params.isTradeConfirmed === true);
  const conditionB = minDistanceRatio != null && minDistanceRatio <= 0.005; // strictly within 0.5%
  const setupIsReady = conditionA || conditionB;
  const conditionMet = conditionA
    ? "CONDITION_A_TRIGGER_CONFIRMED"
    : conditionB
    ? "CONDITION_B_PROXIMITY_05_PCT"
    : null;

  return {
    setupIsReady,
    shouldFire: setupIsReady && !params.alertSent,
    conditionMet,
    minDistancePct,
  };
}

/**
 * Pure evaluation function for proximity trigger:
 * - Warning threshold: alertThreshold = entryPrice * 1.003 (or <= 0.5% of SMA20/EMA10 when moving averages are provided)
 * - When live price crosses into this threshold for the first time, shouldFire = true.
 */
export function evaluateProximityAlertTrigger(params: {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  sma20?: number;
  sma50?: number;
  ema10?: number;
  sma10?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  shares?: number;
  isTradeConfirmed?: boolean;
  alertSent?: boolean;
  alreadyFiredKeys?: Set<string>;
}): ProximityTriggerEvaluation {
  const { ticker, currentPrice, entryPrice, alreadyFiredKeys } = params;
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const alertThreshold = calculateProximityAlertThreshold(entryPrice);
  const shares = Number(params.calculatedShares || params.shares || 0) || undefined;

  const isValid =
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    Number.isFinite(entryPrice) &&
    entryPrice > 0;

  if (!isValid) {
    const invalidMsg = shares && shares > 0
      ? formatExecutionReadyAlertMessage({
          ticker: cleanTicker,
          status: params.isTradeConfirmed ? "CONFIRMED_1H_CLOSE" : "APPROACHING",
          entryPrice,
          stopLoss: params.stopLoss ?? entryPrice * 0.985,
          target1: params.target1,
          calculatedShares: shares,
        })
      : formatProximityEarlyWarningMessage({ ticker: cleanTicker, entryPrice });

    return {
      shouldFire: false,
      alertThreshold,
      distancePct: Infinity,
      isWithinThreshold: false,
      message: invalidMsg,
      dedupeKey: `${cleanTicker}::PROXIMITY_03`,
      conditionMet: null,
    };
  }

  // Distance pct from entry
  const distancePct = +((Math.abs(currentPrice - entryPrice) / entryPrice) * 100).toFixed(4);

  // If moving averages or confirmation state are explicitly passed, evaluate strict Execution Zone filter
  const hasMaParams =
    params.sma20 != null ||
    params.sma50 != null ||
    params.ema10 != null ||
    params.sma10 != null ||
    typeof params.isTradeConfirmed === "boolean";

  let isWithinThreshold = currentPrice <= alertThreshold && currentPrice >= entryPrice * 0.96;
  let conditionMet: ProximityTriggerEvaluation["conditionMet"] = isWithinThreshold
    ? "CONDITION_B_PROXIMITY_05_PCT"
    : null;

  if (hasMaParams) {
    const gate = evaluateExecutionZoneProximityFilter({
      ticker: cleanTicker,
      currentPrice,
      sma20: params.sma20,
      sma50: params.sma50,
      ema10: params.ema10,
      sma10: params.sma10,
      entryPrice,
      stopLoss: params.stopLoss,
      isTradeConfirmed: params.isTradeConfirmed,
      alertSent: params.alertSent,
    });
    isWithinThreshold = gate.setupIsReady;
    conditionMet = gate.conditionMet;
  }

  const dedupeKey = `${cleanTicker}::${entryPrice.toFixed(2)}::PROXIMITY_03`;
  const alreadyFired =
    Boolean(params.alertSent) || (alreadyFiredKeys ? alreadyFiredKeys.has(dedupeKey) : false);

  const message = shares && shares > 0
    ? formatExecutionReadyAlertMessage({
        ticker: cleanTicker,
        status: params.isTradeConfirmed ? "CONFIRMED_1H_CLOSE" : "APPROACHING",
        entryPrice,
        stopLoss: params.stopLoss ?? entryPrice * 0.985,
        target1: params.target1,
        calculatedShares: shares,
      })
    : formatProximityEarlyWarningMessage({
        ticker: cleanTicker,
        entryPrice,
      });

  return {
    shouldFire: isWithinThreshold && !alreadyFired,
    alertThreshold,
    distancePct,
    isWithinThreshold,
    message,
    dedupeKey,
    conditionMet,
  };
}

/**
 * Continuously evaluates the distance between live currentPrice and target Moving Average / entryPrice,
 * and fires a deduplicated server-side Telegram/Email alert ONLY when Condition A (isTradeConfirmed)
 * or Condition B (within 0.5% of SMA 20 / EMA 10) is met and !setup.alertSent.
 */
export function useProximityAlert(input: ProximityAlertInput) {
  const {
    ticker,
    currentPrice,
    entryPrice,
    stopLoss,
    target1,
    target2,
    calculatedShares,
    shares: inputShares,
    sma20,
    sma50,
    ema10,
    sma10,
    isTradeConfirmed,
    status,
    chatId,
    email,
    enabled = true,
    onAlertTriggered,
  } = input;

  const effectiveShares = Number(calculatedShares || inputShares || 0) || undefined;

  const { toast } = useToast();
  const firedAlertsRef = useRef<Set<string>>(new Set());
  const [lastAlertPayload, setLastAlertPayload] = useState<ProximityAlertPayload | null>(null);

  const alertThreshold = useMemo(() => calculateProximityAlertThreshold(entryPrice), [entryPrice]);

  const dispatchProximityAlert = useCallback(
    async (payload: ProximityAlertPayload) => {
      try {
        const res = await fetch("/api/alerts/proximity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          globalStore.updateSetup(payload.ticker, {
            alertSent: true,
            lastAlertTimestamp: data?.lastAlertTimestamp ?? Date.now(),
          });
          toast({
            title: "Early Warning Alert Sent",
            description: `${payload.ticker} within Execution Zone ($${payload.entryPrice.toFixed(2)}). Sent to Telegram / Email.`,
          });
        }
      } catch (err) {
        console.warn("[useProximityAlert] Server alert delivery note:", err);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (!enabled || !ticker || currentPrice <= 0 || entryPrice <= 0) return;
    const cleanTicker = (ticker ?? "").toString().trim().toUpperCase();
    const cleanStatus = (status ?? "").toString().trim();
    const statusUpper = cleanStatus.toUpperCase();
    if (
      (stopLoss != null && stopLoss > 0 && currentPrice < stopLoss) ||
      statusUpper === "INVALIDATED" ||
      statusUpper === "CLOSED" ||
      statusUpper === "CANCELLED"
    ) {
      globalStore.resetSetupAlert(cleanTicker, statusUpper === "CLOSED" ? "CLOSED" : "INVALIDATED");
      for (const k of Array.from(firedAlertsRef.current)) {
        if (k.startsWith(`${cleanTicker}::`)) firedAlertsRef.current.delete(k);
      }
      return;
    }

    const setup = globalStore.getSetupAlertState(cleanTicker);
    const evaluation = evaluateProximityAlertTrigger({
      ticker: cleanTicker,
      currentPrice,
      entryPrice,
      sma20,
      sma50,
      ema10,
      sma10,
      stopLoss,
      target1,
      target2,
      calculatedShares: effectiveShares,
      shares: effectiveShares,
      isTradeConfirmed,
      alertSent: setup.alertSent,
      alreadyFiredKeys: firedAlertsRef.current,
    });

    const setupIsReady = evaluation.isWithinThreshold;

    // Strict logic gate: if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }
    if (setupIsReady && !setup.alertSent && evaluation.shouldFire) {
      firedAlertsRef.current.add(evaluation.dedupeKey);
      const nowTs = Date.now();
      globalStore.updateSetup(cleanTicker, {
        alertSent: true,
        lastAlertTimestamp: nowTs,
        stopLoss,
      });

      const payload: ProximityAlertPayload = {
        ticker: cleanTicker,
        currentPrice,
        entryPrice,
        stopLoss,
        target1,
        target2,
        calculatedShares: effectiveShares,
        shares: effectiveShares,
        alertThreshold: evaluation.alertThreshold,
        distancePct: evaluation.distancePct,
        message: evaluation.message,
        chatId,
        email,
        alertSent: true,
        lastAlertTimestamp: nowTs,
      };

      setLastAlertPayload(payload);
      if (onAlertTriggered) {
        onAlertTriggered(payload);
      }
      void dispatchProximityAlert(payload);
    }
  }, [
    enabled,
    ticker,
    currentPrice,
    entryPrice,
    stopLoss,
    target1,
    target2,
    effectiveShares,
    sma20,
    sma50,
    ema10,
    sma10,
    isTradeConfirmed,
    status,
    chatId,
    email,
    onAlertTriggered,
    dispatchProximityAlert,
  ]);

  const setupState = ticker ? globalStore.getSetupAlertState(ticker) : null;

  return {
    alertThreshold,
    lastAlertPayload,
    alertSent: Boolean(setupState?.alertSent),
    lastAlertTimestamp: setupState?.lastAlertTimestamp ?? null,
    firedKeys: firedAlertsRef.current,
  };
}

