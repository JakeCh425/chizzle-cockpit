import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { globalStore } from "@/lib/useMarketDataStore";
import { evaluateExecutionZoneProximityFilter } from "./useProximityAlert";

/**
 * Sanitizes an SMS phone number for Twilio (E.164 format):
 * Strips all non-numeric characters (except the leading +).
 * Example: "+1 417-483-1318" -> "+14174831318"
 */
export function sanitizePhoneNumber(rawPhone: string | undefined | null): string {
  if (!rawPhone) return "";
  return rawPhone.replace(/[^\d+]/g, "");
}

/**
 * Validates whether a Telegram Chat ID consists strictly of numbers (and optional leading - for group chats).
 */
export function isValidTelegramChatId(chatId: string | undefined | null): boolean {
  if (!chatId || !chatId.trim()) return true;
  return /^-?\d+$/.test(chatId.trim());
}

/**
 * Creates a unique alert key for strict execution locking:
 * `${ticker}-${setupId}-${alertType}`
 */
export function createAlertDedupeKey(
  ticker: string,
  setupId: string | number,
  alertType: string
): string {
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const cleanSetupId = String(setupId || "ACTIVE").trim();
  const cleanType = (alertType || "PRE_ENTRY").trim().toUpperCase();
  return `${cleanTicker}-${cleanSetupId}-${cleanType}`;
}

export const STORAGE_KEY_OFFSCREEN_ALERTS = "chizzle-offscreen-alert-settings";
export const OFFSCREEN_ALERT_SETTINGS_KEY = STORAGE_KEY_OFFSCREEN_ALERTS;
export const PROXIMITY_THRESHOLD_PCT = 0.25;
export const PRE_CLOSE_MINUTE_TRIGGER = 57;
export const PROXIMITY_ALERT_CONTEXT = "Price within 0.25% of SMA" as const;
export const TIME_BASED_ALERT_CONTEXT = "3 mins to 1H Close" as const;

export interface OffScreenAlertSettings {
  phoneNumber: string;
  telegramChatId: string;
  emailAddress?: string;
  email?: string;
  smsEnabled: boolean;
  telegramEnabled: boolean;
  emailEnabled: boolean;
}

export const DEFAULT_OFFSCREEN_ALERT_SETTINGS: OffScreenAlertSettings = {
  phoneNumber: "",
  telegramChatId: "7864955612",
  emailAddress: "jakechairez@gmail.com",
  email: "jakechairez@gmail.com",
  smsEnabled: false,
  telegramEnabled: true,
  emailEnabled: true,
};

export type PreEntryTriggerContext =
  | "Price within 0.25% of SMA"
  | "3 mins to 1H Close";

export interface PreEntryAlertPayload {
  ticker: string;
  entryPrice: number | string;
  target1: number | string;
  target2?: number | string;
  stopLoss?: number | string;
  shares?: number;
  calculatedShares?: number;
  currentPrice?: number;
  context: PreEntryTriggerContext | string;
}

export interface PreEntryTriggerInput {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  target1: number;
  target2?: number;
  stopLoss?: number;
  shares?: number;
  calculatedShares?: number;
  sma20?: number;
  sma50?: number;
  ema10?: number;
  sma10?: number;
  isTradeConfirmed?: boolean;
  alertSent?: boolean;
  strictExecutionZoneOnly?: boolean;
  setupId?: string | number;
  status?: string;
  now?: Date | number;
  alreadyFiredKeys?: Set<string>;
}

export interface PreEntryTriggerEvaluation {
  shouldFire: boolean;
  triggerType: "PROXIMITY_025_PCT" | "TIME_3MIN_BEFORE_CLOSE" | "TRIGGER_CONFIRMED" | "PROXIMITY_05_PCT" | null;
  context: PreEntryTriggerContext | string | null;
  dedupeKey: string | null;
  distancePct: number;
  isWithin025Pct: boolean;
  isWithin05Pct?: boolean;
  isFormingThreeMinBeforeClose: boolean;
  formattedMessage: string | null;
  message: string | null;
}

function parsePriceValue(val: number | string | undefined): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = Number(val.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

/**
 * Formats the outgoing off-screen message so the user can read it instantly on their
 * lock screen and know exactly what to type into Fidelity:
 *
 * 🚨 CHIZZLE ALERT: {Ticker} is approaching {EntryPrice}.
 * Context: {3 mins to 1H Close OR Price within 0.25% of SMA}.
 * Fidelity Plan: Limit BUY at {EntryPrice}. Scale 50% at {Target1}.
 */
export function formatPreEntryAlertMessage(payload: PreEntryAlertPayload): string {
  const ticker = (payload.ticker || "NVDA").trim().toUpperCase();
  const entryStr = `$${parsePriceValue(payload.entryPrice).toFixed(2)}`;
  const target1Str = `$${parsePriceValue(payload.target1).toFixed(2)}`;
  const context = payload.context || "Price within 0.25% of SMA";
  const shares = Number(payload.calculatedShares || payload.shares || 0) || 0;

  let fidelityPlan = `Limit BUY at ${entryStr}. Scale 50% at ${target1Str}.`;
  if (shares > 0) {
    const order1Shares = Math.floor(shares / 2);
    const order2Shares = shares - order1Shares;
    const stopLossNum = parsePriceValue(payload.stopLoss);
    const stopStr = stopLossNum > 0 ? `$${stopLossNum.toFixed(2)}` : "";
    fidelityPlan = `BUY ${shares} Shares Limit at ${entryStr}. Order 1 SELL ${order1Shares} Shares @ ${target1Str} (1.5R)${stopStr ? ` | Order 2 STOP ${order2Shares} Shares @ ${stopStr}` : ""}`;
  }

  return [
    `🚨 CHIZZLE ALERT: ${ticker} is approaching ${entryStr}.`,
    `Context: ${context}.`,
    `Fidelity Plan: ${fidelityPlan}`,
  ].join("\n");
}

/**
 * Pure evaluator for the two Pre-Entry Alert Triggers:
 * - Trigger 1 (Proximity Warning): Live price comes within 0.25% of entryPrice (20/50 SMA support level).
 * - Trigger 2 (Time-Based Warning): Setup is marked as FORMING and current time is 3 minutes before 1H close (:57).
 * Ensures each setup trigger fires only once per setup via `alreadyFiredKeys`.
 */
export function evaluatePreEntryAlertTriggers(
  input: PreEntryTriggerInput,
  externalFiredKeys?: Set<string>
): PreEntryTriggerEvaluation {
  const {
    ticker,
    currentPrice,
    entryPrice,
    target1,
    stopLoss,
    sma20,
    sma50,
    ema10,
    sma10,
    isTradeConfirmed,
    alertSent = false,
    strictExecutionZoneOnly = false,
    status = "",
    now = new Date(),
    alreadyFiredKeys = externalFiredKeys,
  } = input;

  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  const validPrices =
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    Number.isFinite(entryPrice) &&
    entryPrice > 0;

  const distancePct = validPrices
    ? +((Math.abs(currentPrice - entryPrice) / entryPrice) * 100).toFixed(4)
    : Infinity;

  // Strict Execution Zone Proximity Filter when enabled or when moving averages / confirmation state are provided:
  // Condition A (Trigger Confirmed): isTradeConfirmed === true
  // Condition B (Proximity Warning): live price within <= 0.5% (0.005) of SMA 20 or EMA 10
  // Never fires for setups that are simply "Forming" or sitting on the Watchlist out of range (> 0.5%).
  if (strictExecutionZoneOnly || sma20 != null || sma50 != null || ema10 != null || sma10 != null || typeof isTradeConfirmed === "boolean") {
    const gate = evaluateExecutionZoneProximityFilter({
      ticker: cleanTicker,
      currentPrice,
      sma20,
      sma50,
      ema10,
      sma10,
      entryPrice,
      stopLoss,
      isTradeConfirmed,
      alertSent,
    });
    const dedupeKey = `${cleanTicker}::EXEC_ZONE::${entryPrice.toFixed(2)}`;
    const alreadyFired = alertSent || Boolean(alreadyFiredKeys && alreadyFiredKeys.has(dedupeKey));
    const shouldFire = gate.setupIsReady && !alreadyFired;
    const context: PreEntryTriggerContext = "Price within 0.25% of SMA";
    const formattedMessage = shouldFire
      ? formatPreEntryAlertMessage({
          ticker: cleanTicker,
          entryPrice,
          target1,
          target2: input.target2,
          stopLoss,
          shares: input.shares,
          calculatedShares: input.calculatedShares,
          currentPrice,
          context,
        })
      : null;

    return {
      shouldFire,
      triggerType: shouldFire
        ? gate.conditionMet === "CONDITION_A_TRIGGER_CONFIRMED"
          ? "TRIGGER_CONFIRMED"
          : "PROXIMITY_025_PCT"
        : null,
      context: shouldFire ? context : null,
      dedupeKey: shouldFire ? dedupeKey : null,
      distancePct: gate.minDistancePct ?? distancePct,
      isWithin025Pct: gate.setupIsReady,
      isWithin05Pct: gate.setupIsReady,
      isFormingThreeMinBeforeClose: false,
      formattedMessage,
      message: formattedMessage,
    };
  }

  // Trigger 1 (Proximity Warning): Live price within 0.25% of entryPrice
  const isWithin025Pct = validPrices && distancePct <= 0.25 + 1e-9;

  // Trigger 2 (Time-Based Warning): Setup is marked as FORMING and time is 3 minutes before 1H close (minute === 57)
  const dateObj = typeof now === "number" ? new Date(now) : now;
  const minutes = dateObj.getMinutes();
  const normStatus = status.trim().toUpperCase();
  const isForming =
    normStatus === "FORMING" ||
    normStatus === "SETUP_FORMING" ||
    normStatus === "AWAITING CLOSE";
  const isFormingThreeMinBeforeClose = Boolean(isForming && minutes === 57);

  let triggerType: "PROXIMITY_025_PCT" | "TIME_3MIN_BEFORE_CLOSE" | null = null;
  let context: PreEntryTriggerContext | null = null;
  let dedupeKey: string | null = null;

  const proximityKey = `${cleanTicker}::PROXIMITY_025::${entryPrice.toFixed(2)}`;
  const timeKey = `${cleanTicker}::TIME_3MIN::${entryPrice.toFixed(2)}`;

  if (!alertSent && isWithin025Pct && (!alreadyFiredKeys || !alreadyFiredKeys.has(proximityKey))) {
    triggerType = "PROXIMITY_025_PCT";
    context = "Price within 0.25% of SMA";
    dedupeKey = proximityKey;
  } else if (
    !alertSent &&
    isFormingThreeMinBeforeClose &&
    (!alreadyFiredKeys || !alreadyFiredKeys.has(timeKey))
  ) {
    triggerType = "TIME_3MIN_BEFORE_CLOSE";
    context = "3 mins to 1H Close";
    dedupeKey = timeKey;
  }

  const shouldFire = Boolean(triggerType && context && dedupeKey && !alertSent);
  const formattedMessage =
    shouldFire && context
      ? formatPreEntryAlertMessage({
          ticker: cleanTicker,
          entryPrice,
          target1,
          target2: input.target2,
          stopLoss,
          shares: input.shares,
          calculatedShares: input.calculatedShares,
          currentPrice,
          context,
        })
      : null;

  return {
    shouldFire,
    triggerType,
    context,
    dedupeKey,
    distancePct,
    isWithin025Pct,
    isFormingThreeMinBeforeClose,
    formattedMessage,
    message: formattedMessage,
  };
}

/**
 * Loads saved user notification settings from localStorage.
 */
export function loadOffScreenAlertSettings(
  storage?: Pick<Storage, "getItem">
): OffScreenAlertSettings {
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (!store) return DEFAULT_OFFSCREEN_ALERT_SETTINGS;
  try {
    const raw = store.getItem(STORAGE_KEY_OFFSCREEN_ALERTS);
    if (!raw) return DEFAULT_OFFSCREEN_ALERT_SETTINGS;
    const parsed = JSON.parse(raw);
    const emailVal =
      typeof parsed.emailAddress === "string"
        ? parsed.emailAddress
        : typeof parsed.email === "string"
        ? parsed.email
        : "";
    return {
      phoneNumber: typeof parsed.phoneNumber === "string" ? parsed.phoneNumber : "",
      telegramChatId: typeof parsed.telegramChatId === "string" ? parsed.telegramChatId : "",
      emailAddress: emailVal,
      email: emailVal,
      smsEnabled: Boolean(parsed.smsEnabled),
      telegramEnabled: Boolean(parsed.telegramEnabled),
      emailEnabled: Boolean(parsed.emailEnabled),
    };
  } catch {
    return DEFAULT_OFFSCREEN_ALERT_SETTINGS;
  }
}

/**
 * Saves user notification settings to localStorage and syncs with backend profile.
 */
export function saveOffScreenAlertSettings(
  settings: OffScreenAlertSettings,
  storage?: Pick<Storage, "setItem">
): OffScreenAlertSettings {
  const normalized: OffScreenAlertSettings = {
    ...DEFAULT_OFFSCREEN_ALERT_SETTINGS,
    ...settings,
  };
  const store = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  if (store) {
    try {
      store.setItem(STORAGE_KEY_OFFSCREEN_ALERTS, JSON.stringify(normalized));
    } catch {}
  }
  if (!storage && typeof fetch !== "undefined") {
    void fetch("/api/alerts/offscreen-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
    }).catch(() => {});
  }
  return normalized;
}

/**
 * Sends a Telegram alert using the standard Telegram Bot API (`https://api.telegram.org/bot<token>/sendMessage`)
 * or via the server-side `/api/alerts/pre-entry` endpoint when the token is stored in server env vars.
 */
export async function sendTelegramAlert(
  message: string,
  chatId?: string,
  botToken?: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string; via: string }> {
  try {
    if (botToken && chatId) {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return { ok: false, error: `Telegram ${res.status}: ${errText}`, via: "direct" };
      }
      return { ok: true, via: "direct" };
    }

    const res = await fetchImpl("/api/alerts/pre-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        chatId,
        message,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      ok: Boolean(data.ok),
      error: data.error,
      via: "server",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
      via: "error",
    };
  }
}

/**
 * Sends an SMS alert via the backend Twilio serverless handler (`/api/alerts/pre-entry`).
 */
export async function sendSmsAlert(
  message: string,
  phoneNumber: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sanitizedPhone = sanitizePhoneNumber(phoneNumber);
    const res = await fetchImpl("/api/alerts/pre-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "sms",
        phoneNumber: sanitizedPhone,
        message,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      ok: Boolean(data.ok),
      error: data.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

/**
 * Sends an Email alert via the backend transactional email service.
 */
export async function sendEmailAlert(
  message: string,
  emailAddress: string,
  options?: {
    ticker?: string;
    entryPrice?: number | string;
    target1?: number | string;
    target2?: number | string;
    stopLoss?: number | string;
    shares?: number;
    calculatedShares?: number;
    context?: string;
    plan?: string;
  },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchImpl("/api/alerts/pre-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "email",
        email: emailAddress,
        emailAddress,
        message,
        ticker: options?.ticker,
        entryPrice: options?.entryPrice,
        target1: options?.target1,
        target2: options?.target2,
        stopLoss: options?.stopLoss,
        shares: options?.shares ?? options?.calculatedShares,
        calculatedShares: options?.calculatedShares ?? options?.shares,
        context: options?.context,
        plan: options?.plan,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      ok: Boolean(data.ok),
      error: data.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}

export interface UseOffScreenPreEntryAlertsInput {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  target1: number;
  target2?: number;
  stopLoss?: number;
  calculatedShares?: number;
  shares?: number;
  sma20?: number;
  sma50?: number;
  ema10?: number;
  sma10?: number;
  isTradeConfirmed?: boolean;
  setupId?: string | number;
  status?: string;
}

export function useOffScreenPreEntryAlerts(input: UseOffScreenPreEntryAlertsInput) {
  const {
    ticker,
    currentPrice,
    entryPrice,
    target1,
    target2,
    stopLoss,
    calculatedShares,
    shares: inputShares,
    sma20,
    sma50,
    ema10,
    sma10,
    isTradeConfirmed,
    setupId,
    status,
  } = input;
  const effectiveShares = Number(calculatedShares || inputShares || 0) || undefined;
  const { toast } = useToast();

  const [settings, setSettings] = useState<OffScreenAlertSettings>(() =>
    loadOffScreenAlertSettings()
  );
  const [lastDispatchedMessage, setLastDispatchedMessage] = useState<string | null>(null);

  // Strict execution lock (debounce/cache) per active setup
  const firedAlerts = useRef<Set<string>>(new Set());

  const updateSettings = useCallback((patch: Partial<OffScreenAlertSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveOffScreenAlertSettings(next);
      return next;
    });
  }, []);

  const dispatchFormattedAlert = useCallback(
    async (
      message: string,
      currentSettings: OffScreenAlertSettings,
      alertType: string = "PROXIMITY",
      isTest: boolean = false
    ) => {
      const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
      const effectiveSetupId = setupId ?? entryPrice.toFixed(2);
      const alertKey = createAlertDedupeKey(cleanTicker, effectiveSetupId, alertType);
      const setup = globalStore.getSetupAlertState(cleanTicker);

      if (!isTest && (setup.alertSent || firedAlerts.current.has(alertKey))) {
        return; // Already fired for this setup, abort.
      }
      firedAlerts.current.add(alertKey);
      const nowTs = Date.now();
      globalStore.updateSetup(cleanTicker, {
        alertSent: true,
        lastAlertTimestamp: nowTs,
        stopLoss,
      });

      setLastDispatchedMessage(message);

      const tasks: Promise<any>[] = [];
      if (currentSettings.telegramEnabled && currentSettings.telegramChatId.trim()) {
        const cleanChatId = currentSettings.telegramChatId.trim();
        if (isValidTelegramChatId(cleanChatId)) {
          tasks.push(sendTelegramAlert(message, cleanChatId));
        }
      }
      if (currentSettings.smsEnabled && currentSettings.phoneNumber.trim()) {
        const cleanPhone = sanitizePhoneNumber(currentSettings.phoneNumber);
        if (cleanPhone) {
          tasks.push(sendSmsAlert(message, cleanPhone));
        }
      }
      const userEmail = (currentSettings.emailAddress || currentSettings.email || "").trim();
      if (currentSettings.emailEnabled && userEmail) {
        const order1 = effectiveShares ? Math.floor(effectiveShares / 2) : 0;
        const order2 = effectiveShares ? effectiveShares - order1 : 0;
        const stopLossNum = parsePriceValue(stopLoss);
        const stopStr = stopLossNum > 0 ? `$${stopLossNum.toFixed(2)}` : "";
        const entryStr = `$${Number(entryPrice).toFixed(2)}`;
        const t1Str = `$${Number(target1).toFixed(2)}`;
        const planText =
          effectiveShares && effectiveShares > 0
            ? `BUY ${effectiveShares} Shares Limit at ${entryStr}. Order 1 SELL ${order1} Shares @ ${t1Str} (1.5R)${stopStr ? ` | Order 2 STOP ${order2} Shares @ ${stopStr}` : ""}`
            : `Limit BUY at ${entryStr}. Scale 50% at ${t1Str}.`;

        tasks.push(
          sendEmailAlert(message, userEmail, {
            ticker: cleanTicker,
            entryPrice,
            target1,
            target2,
            stopLoss,
            shares: effectiveShares,
            calculatedShares: effectiveShares,
            plan: planText,
          })
        );
      }

      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }

      toast({
        title: `🚨 Off-Screen Pre-Entry Alert Dispatched (${cleanTicker})`,
        description: message,
      });
    },
    [ticker, entryPrice, target1, target2, stopLoss, effectiveShares, setupId, toast]
  );

  // Evaluate triggers on live price updates & 1H clock ticks with strict Execution Zone Proximity Filter
  useEffect(() => {
    const checkTriggers = () => {
      if (!ticker || currentPrice <= 0 || entryPrice <= 0) return;
      const cleanTicker = ticker.trim().toUpperCase();
      const statusUpper = String(status || "").toUpperCase();

      // Reset alertSent if setup invalidates (< stopLoss) or gets closed out
      if (
        (stopLoss != null && stopLoss > 0 && currentPrice < stopLoss) ||
        statusUpper === "INVALIDATED" ||
        statusUpper === "CLOSED" ||
        statusUpper === "CANCELLED"
      ) {
        globalStore.resetSetupAlert(cleanTicker, statusUpper === "CLOSED" ? "CLOSED" : "INVALIDATED");
        for (const k of Array.from(firedAlerts.current)) {
          if (k.startsWith(`${cleanTicker}-`) || k.startsWith(`${cleanTicker}::`)) {
            firedAlerts.current.delete(k);
          }
        }
        return;
      }

      const setup = globalStore.getSetupAlertState(cleanTicker);
      const evalResult = evaluatePreEntryAlertTriggers({
        ticker: cleanTicker,
        currentPrice,
        entryPrice,
        target1,
        target2,
        stopLoss,
        shares: effectiveShares,
        calculatedShares: effectiveShares,
        sma20: sma20 ?? entryPrice,
        ema10,
        sma10,
        isTradeConfirmed: Boolean(isTradeConfirmed || statusUpper === "READY" || statusUpper === "READY_TO_TRADE"),
        alertSent: setup.alertSent,
        strictExecutionZoneOnly: true,
        status,
        now: new Date(),
        alreadyFiredKeys: firedAlerts.current,
      });

      const setupIsReady = Boolean(evalResult.isWithin05Pct || evalResult.isWithin025Pct);

      // Strict logic gate: if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }
      if (setupIsReady && !setup.alertSent && evalResult.shouldFire && evalResult.formattedMessage && evalResult.triggerType) {
        const alertType = evalResult.triggerType === "TIME_3MIN_BEFORE_CLOSE" ? "TIME_3MIN" : "PROXIMITY";
        const effectiveSetupId = setupId ?? entryPrice.toFixed(2);
        const alertKey = createAlertDedupeKey(cleanTicker, effectiveSetupId, alertType);

        if (firedAlerts.current.has(alertKey)) return; // Already fired, abort.
        firedAlerts.current.add(alertKey);
        globalStore.updateSetup(cleanTicker, {
          alertSent: true,
          lastAlertTimestamp: Date.now(),
          stopLoss,
        });

        if (settings.smsEnabled || settings.telegramEnabled || settings.emailEnabled) {
          void dispatchFormattedAlert(evalResult.formattedMessage, settings, alertType);
        }
      }
    };

    checkTriggers();
    const interval = setInterval(checkTriggers, 10000);
    return () => clearInterval(interval);
  }, [
    ticker,
    currentPrice,
    entryPrice,
    target1,
    target2,
    stopLoss,
    effectiveShares,
    sma20,
    sma50,
    ema10,
    sma10,
    isTradeConfirmed,
    setupId,
    status,
    settings,
    dispatchFormattedAlert,
  ]);

  const sendTestPreEntryAlert = useCallback(async () => {
    const msg = formatPreEntryAlertMessage({
      ticker,
      entryPrice,
      target1,
      target2,
      stopLoss,
      shares: effectiveShares,
      calculatedShares: effectiveShares,
      currentPrice,
      context: "Price within 0.25% of SMA",
    });
    await dispatchFormattedAlert(msg, settings, "TEST", true);
    return msg;
  }, [ticker, entryPrice, target1, target2, stopLoss, effectiveShares, currentPrice, settings, dispatchFormattedAlert]);

  const setupState = ticker ? globalStore.getSetupAlertState(ticker) : null;

  return {
    settings,
    updateSettings,
    lastDispatchedMessage,
    alertSent: Boolean(setupState?.alertSent),
    lastAlertTimestamp: setupState?.lastAlertTimestamp ?? null,
    sendTestPreEntryAlert,
    previewMessage: formatPreEntryAlertMessage({
      ticker,
      entryPrice,
      target1,
      target2,
      stopLoss,
      shares: effectiveShares,
      calculatedShares: effectiveShares,
      currentPrice,
      context: "Price within 0.25% of SMA",
    }),
  };
}

