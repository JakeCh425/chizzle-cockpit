import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

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
  telegramChatId: "",
  emailAddress: "",
  email: "",
  smsEnabled: false,
  telegramEnabled: false,
  emailEnabled: false,
};

export type PreEntryTriggerContext =
  | "Price within 0.25% of SMA"
  | "3 mins to 1H Close";

export interface PreEntryAlertPayload {
  ticker: string;
  entryPrice: number | string;
  target1: number | string;
  currentPrice?: number;
  context: PreEntryTriggerContext | string;
}

export interface PreEntryTriggerInput {
  ticker: string;
  currentPrice: number;
  entryPrice: number;
  target1: number;
  status?: string;
  now?: Date | number;
  alreadyFiredKeys?: Set<string>;
}

export interface PreEntryTriggerEvaluation {
  shouldFire: boolean;
  triggerType: "PROXIMITY_025_PCT" | "TIME_3MIN_BEFORE_CLOSE" | null;
  context: PreEntryTriggerContext | null;
  dedupeKey: string | null;
  distancePct: number;
  isWithin025Pct: boolean;
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

  return [
    `🚨 CHIZZLE ALERT: ${ticker} is approaching ${entryStr}.`,
    `Context: ${context}.`,
    `Fidelity Plan: Limit BUY at ${entryStr}. Scale 50% at ${target1Str}.`,
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

  if (isWithin025Pct && (!alreadyFiredKeys || !alreadyFiredKeys.has(proximityKey))) {
    triggerType = "PROXIMITY_025_PCT";
    context = "Price within 0.25% of SMA";
    dedupeKey = proximityKey;
  } else if (
    isFormingThreeMinBeforeClose &&
    (!alreadyFiredKeys || !alreadyFiredKeys.has(timeKey))
  ) {
    triggerType = "TIME_3MIN_BEFORE_CLOSE";
    context = "3 mins to 1H Close";
    dedupeKey = timeKey;
  }

  const shouldFire = Boolean(triggerType && context && dedupeKey);
  const formattedMessage =
    shouldFire && context
      ? formatPreEntryAlertMessage({
          ticker: cleanTicker,
          entryPrice,
          target1,
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
    const res = await fetchImpl("/api/alerts/pre-entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "sms",
        phoneNumber,
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
  status?: string;
}

export function useOffScreenPreEntryAlerts(input: UseOffScreenPreEntryAlertsInput) {
  const { ticker, currentPrice, entryPrice, target1, status } = input;
  const { toast } = useToast();

  const [settings, setSettings] = useState<OffScreenAlertSettings>(() =>
    loadOffScreenAlertSettings()
  );
  const [lastDispatchedMessage, setLastDispatchedMessage] = useState<string | null>(null);
  const firedKeysRef = useRef<Set<string>>(new Set());

  const updateSettings = useCallback((patch: Partial<OffScreenAlertSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveOffScreenAlertSettings(next);
      return next;
    });
  }, []);

  const dispatchFormattedAlert = useCallback(
    async (message: string, currentSettings: OffScreenAlertSettings) => {
      setLastDispatchedMessage(message);

      const tasks: Promise<any>[] = [];
      if (currentSettings.telegramEnabled && currentSettings.telegramChatId.trim()) {
        tasks.push(sendTelegramAlert(message, currentSettings.telegramChatId.trim()));
      }
      if (currentSettings.smsEnabled && currentSettings.phoneNumber.trim()) {
        tasks.push(sendSmsAlert(message, currentSettings.phoneNumber.trim()));
      }
      const userEmail = (currentSettings.emailAddress || currentSettings.email || "").trim();
      if (currentSettings.emailEnabled && userEmail) {
        tasks.push(
          sendEmailAlert(message, userEmail, {
            ticker,
            entryPrice,
            target1,
          })
        );
      }

      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }

      toast({
        title: `🚨 Off-Screen Pre-Entry Alert Dispatched (${ticker})`,
        description: message,
      });
    },
    [ticker, toast]
  );

  // Evaluate triggers on live price updates & 1H clock ticks
  useEffect(() => {
    const checkTriggers = () => {
      const evalResult = evaluatePreEntryAlertTriggers({
        ticker,
        currentPrice,
        entryPrice,
        target1,
        status,
        now: new Date(),
        alreadyFiredKeys: firedKeysRef.current,
      });

      if (evalResult.shouldFire && evalResult.dedupeKey && evalResult.formattedMessage) {
        firedKeysRef.current.add(evalResult.dedupeKey);
        if (settings.smsEnabled || settings.telegramEnabled || settings.emailEnabled) {
          void dispatchFormattedAlert(evalResult.formattedMessage, settings);
        }
      }
    };

    checkTriggers();
    const interval = setInterval(checkTriggers, 10000);
    return () => clearInterval(interval);
  }, [ticker, currentPrice, entryPrice, target1, status, settings, dispatchFormattedAlert]);

  const sendTestPreEntryAlert = useCallback(async () => {
    const msg = formatPreEntryAlertMessage({
      ticker,
      entryPrice,
      target1,
      currentPrice,
      context: "Price within 0.25% of SMA",
    });
    await dispatchFormattedAlert(msg, settings);
    return msg;
  }, [ticker, entryPrice, target1, currentPrice, settings, dispatchFormattedAlert]);

  return {
    settings,
    updateSettings,
    lastDispatchedMessage,
    sendTestPreEntryAlert,
    previewMessage: formatPreEntryAlertMessage({
      ticker,
      entryPrice,
      target1,
      currentPrice,
      context: "Price within 0.25% of SMA",
    }),
  };
}

