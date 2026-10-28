import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";

export const PROXIMITY_ALERT_PERCENT = 0.3; // 0.3%

export interface ProximityAlertInput {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  chatId?: string;
  email?: string;
  enabled?: boolean;
  onAlertTriggered?: (payload: ProximityAlertPayload) => void;
}

export interface ProximityAlertPayload {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  alertThreshold: number;
  distancePct: number;
  message: string;
  chatId?: string;
  email?: string;
}

export interface ProximityTriggerEvaluation {
  shouldFire: boolean;
  alertThreshold: number;
  distancePct: number;
  isWithinThreshold: boolean;
  message: string;
  dedupeKey: string;
}

/**
 * Calculates warning threshold: alertThreshold = entryPrice * 1.003 (within 0.3% of entry).
 */
export function calculateProximityAlertThreshold(entryPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  return +(entryPrice * 1.003).toFixed(4);
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
 * Pure evaluation function for proximity trigger:
 * - Warning threshold: alertThreshold = entryPrice * 1.003
 * - When live price crosses into this threshold for the first time, shouldFire = true.
 */
export function evaluateProximityAlertTrigger(params: {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  alreadyFiredKeys?: Set<string>;
}): ProximityTriggerEvaluation {
  const { ticker, currentPrice, entryPrice, alreadyFiredKeys } = params;
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const alertThreshold = calculateProximityAlertThreshold(entryPrice);

  const isValid =
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    Number.isFinite(entryPrice) &&
    entryPrice > 0;

  if (!isValid) {
    return {
      shouldFire: false,
      alertThreshold,
      distancePct: Infinity,
      isWithinThreshold: false,
      message: formatProximityEarlyWarningMessage({ ticker: cleanTicker, entryPrice }),
      dedupeKey: `${cleanTicker}::PROXIMITY_03`,
    };
  }

  // Distance pct from entry
  const distancePct = +((Math.abs(currentPrice - entryPrice) / entryPrice) * 100).toFixed(4);

  // Crosses into threshold: currentPrice <= alertThreshold (within 0.3% of entry, above stop/structure)
  // i.e., currentPrice <= entryPrice * 1.003 and currentPrice >= entryPrice * 0.96
  const isWithinThreshold = currentPrice <= alertThreshold && currentPrice >= entryPrice * 0.96;
  const dedupeKey = `${cleanTicker}::${entryPrice.toFixed(2)}::PROXIMITY_03`;
  const alreadyFired = alreadyFiredKeys ? alreadyFiredKeys.has(dedupeKey) : false;

  const message = formatProximityEarlyWarningMessage({
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
  };
}

/**
 * Continuously evaluates the distance between live currentPrice and entryPrice,
 * and fires a server-side Telegram/Email alert when price enters within 0.3% of entry.
 */
export function useProximityAlert(input: ProximityAlertInput) {
  const {
    ticker,
    currentPrice,
    entryPrice,
    chatId,
    email,
    enabled = true,
    onAlertTriggered,
  } = input;

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
          toast({
            title: "Early Warning Alert Sent",
            description: `${payload.ticker} within 0.3% of entry ($${payload.entryPrice.toFixed(2)}). Sent to Telegram / Email.`,
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

    const evaluation = evaluateProximityAlertTrigger({
      ticker,
      currentPrice,
      entryPrice,
      alreadyFiredKeys: firedAlertsRef.current,
    });

    if (evaluation.shouldFire) {
      firedAlertsRef.current.add(evaluation.dedupeKey);
      const payload: ProximityAlertPayload = {
        ticker: ticker.toUpperCase(),
        currentPrice,
        entryPrice,
        alertThreshold: evaluation.alertThreshold,
        distancePct: evaluation.distancePct,
        message: evaluation.message,
        chatId,
        email,
      };

      setLastAlertPayload(payload);
      if (onAlertTriggered) {
        onAlertTriggered(payload);
      }
      void dispatchProximityAlert(payload);
    }
  }, [enabled, ticker, currentPrice, entryPrice, chatId, email, onAlertTriggered, dispatchProximityAlert]);

  return {
    alertThreshold,
    lastAlertPayload,
    firedKeys: firedAlertsRef.current,
  };
}

