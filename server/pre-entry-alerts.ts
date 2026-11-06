// ─── Off-Screen Pre-Entry Alerts (Telegram Bot API & Twilio SMS Serverless Handler) ───

import {
  sendPreEntryEmail,
  formatPreEntryEmailHtml,
  formatPreEntryEmailSubject,
  type PreEntryEmailPayload,
} from "./sendEmailAlert";

export {
  sendPreEntryEmail,
  formatPreEntryEmailHtml,
  formatPreEntryEmailSubject,
  type PreEntryEmailPayload,
};

import { formatExecutionReadyAlertMessage } from "./backendNotificationWorker";
export { formatExecutionReadyAlertMessage };

import {
  getVerifiedTelegramChatId,
  sendTelegramMessage,
  formatTelegramTradeDeskAlert,
  shouldDispatchAlert,
  canDispatchProximityAlert,
  recordPriceBoundaryExit,
  clearAlertLedger,
  getAlertLedger,
  type TelegramTradeAlertPayload,
} from "./telegramDispatcher";

export {
  getVerifiedTelegramChatId,
  sendTelegramMessage,
  formatTelegramTradeDeskAlert,
  shouldDispatchAlert,
  canDispatchProximityAlert,
  recordPriceBoundaryExit,
  clearAlertLedger,
  getAlertLedger,
  type TelegramTradeAlertPayload,
};

export interface ServerPreEntryAlertInput {
  ticker: string;
  entryPrice: number;
  target1: number;
  context: "3 mins to 1H Close" | "Price within 0.25% of SMA" | string;
}

export function formatServerPreEntryAlertMessage(input: ServerPreEntryAlertInput): string {
  const ticker = (input.ticker || "NVDA").trim().toUpperCase();
  const entryStr = `$${Number(input.entryPrice || 0).toFixed(2)}`;
  const target1Str = `$${Number(input.target1 || 0).toFixed(2)}`;
  const context = input.context || "Price within 0.25% of SMA";

  return [
    `🚨 CHIZZLE ALERT: ${ticker} is approaching ${entryStr}.`,
    `Context: ${context}.`,
    `Fidelity Plan: Limit BUY at ${entryStr}. Scale 50% at ${target1Str}.`,
  ].join("\n");
}

/**
 * Utility function `sendTelegramAlert(message)` using the standard Telegram Bot API
 * (`https://api.telegram.org/bot<token>/sendMessage`).
 * Enforces verified numeric TELEGRAM_TARGET_CHAT_ID and blocks @username strings.
 */
export async function sendTelegramAlert(
  message: string,
  chatId?: string,
  botToken?: string
): Promise<{ ok: boolean; error?: string; status: "sent" | "stubbed" | "failed" }> {
  const result = await sendTelegramMessage(message, chatId, { botToken });
  return {
    ok: result.ok,
    error: result.error,
    status: result.status,
  };
}

/**
 * Lightweight Twilio SMS sender (compatible with Twilio Node.js SDK / REST API and serverless handlers).
 */
export async function sendTwilioSmsAlert(
  toPhoneNumber: string,
  message: string
): Promise<{ ok: boolean; error?: string; status: "sent" | "stubbed" | "failed" }> {
  const sanitizedPhone = toPhoneNumber.replace(/[^\d+]/g, "");
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from || !sanitizedPhone) {
    return {
      ok: true,
      error: "Twilio credentials or destination phone number not configured (stubbed)",
      status: "stubbed",
    };
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const body = new URLSearchParams({ To: sanitizedPhone, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `Twilio ${res.status}: ${txt.slice(0, 200)}`, status: "failed" };
    }
    return { ok: true, status: "sent" };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), status: "failed" };
  }
}

/**
 * Serverless function handler (Vercel / Supabase / AWS Lambda / Express compatible)
 * for dispatching SMS, Telegram, and Email Pre-Entry Alerts.
 */
export async function serverlessPreEntryAlertHandler(req: {
  body?: {
    channel?: "sms" | "telegram" | "email" | "both" | "all";
    phoneNumber?: string;
    chatId?: string;
    email?: string;
    emailAddress?: string;
    message?: string;
    ticker?: string;
    entryPrice?: number;
    stopLoss?: number;
    target1?: number;
    target2?: number;
    shares?: number;
    calculatedShares?: number;
    plan?: any;
    context?: string;
    smsEnabled?: boolean;
    telegramEnabled?: boolean;
    emailEnabled?: boolean;
  };
  channel?: "sms" | "telegram" | "email" | "both" | "all";
  phoneNumber?: string;
  chatId?: string;
  email?: string;
  emailAddress?: string;
  message?: string;
  ticker?: string;
  entryPrice?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  shares?: number;
  calculatedShares?: number;
  plan?: any;
  context?: string;
  smsEnabled?: boolean;
  telegramEnabled?: boolean;
  emailEnabled?: boolean;
}): Promise<{ ok: boolean; sms?: any; telegram?: any; email?: any; message: string }> {
  const body = req?.body || req || {};
  const shares = Number(body.calculatedShares || body.shares || (typeof body.plan === "object" ? body.plan?.shares : 0) || 0) || undefined;
  const stopLoss = Number(body.stopLoss || (typeof body.plan === "object" ? body.plan?.stopLoss : 0) || 0) || undefined;
  const entryPrice = Number(body.entryPrice || 0);
  const target1 = Number(body.target1 || (typeof body.plan === "object" ? body.plan?.target1 : 0) || 0) || undefined;
  const ticker = (body.ticker || "NVDA").trim().toUpperCase();

  const formattedMessage =
    body.message ||
    (shares && shares > 0
      ? formatExecutionReadyAlertMessage({
          ticker,
          status: "CONFIRMED_1H_CLOSE",
          entryPrice,
          stopLoss: stopLoss ?? entryPrice * 0.985,
          target1,
          calculatedShares: shares,
        })
      : formatServerPreEntryAlertMessage({
          ticker,
          entryPrice,
          target1: target1 || entryPrice * 1.03,
          context: body.context || "Price within 0.25% of SMA",
        }));

  const channel = body.channel || (body.emailEnabled ? "all" : "both");
  let smsResult: any = null;
  let telegramResult: any = null;
  let emailResult: any = null;

  if (channel === "sms" || channel === "both" || channel === "all") {
    smsResult = await sendTwilioSmsAlert(body.phoneNumber || "", formattedMessage);
  }
  if (channel === "telegram" || channel === "both" || channel === "all") {
    telegramResult = await sendTelegramAlert(formattedMessage, body.chatId);
  }

  const userEmail = (body.emailAddress || body.email || "").trim();
  if (channel === "email" || channel === "all" || body.emailEnabled || (userEmail && channel === "both")) {
    if (userEmail) {
      emailResult = await sendPreEntryEmail({
        userEmail,
        ticker,
        entryPrice,
        price: entryPrice,
        target1,
        stopLoss,
        calculatedShares: shares,
        shares,
        context: body.context || "Price within 0.25% of SMA",
        plan: body.plan,
        message: formattedMessage,
      });
    }
  }

  return {
    ok: true,
    sms: smsResult,
    telegram: telegramResult,
    email: emailResult,
    message: formattedMessage,
  };
}

/**
 * Standard message template for early-warning notifications (within 0.3% of entry price):
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
 * Proximity Early-Warning Notification dispatcher (Telegram & Email via Resend/SendGrid):
 * Connects to Telegram Bot API (sendMessage endpoint) and lightweight email service.
 */
export async function sendProximityEarlyWarningAlert(params: {
  ticker: string;
  entryPrice: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  calculatedShares?: number;
  shares?: number;
  chatId?: string;
  email?: string;
  currentPrice?: number;
  message?: string;
  force?: boolean;
}): Promise<{ ok: boolean; suppressed?: boolean; telegram?: any; email?: any; message: string }> {
  const sym = (params.ticker || "NVDA").trim().toUpperCase();

  // Strict Two-Layer Gatekeeper:
  // 1. Minimum 60-min Cooldown & Max Once-per-day per ticker
  if (!params.force) {
    const proxGate = canDispatchProximityAlert(sym);
    if (!proxGate.allowed) {
      return {
        ok: true,
        suppressed: true,
        telegram: { ok: true, status: "suppressed", error: proxGate.reason },
        email: { ok: true, status: "suppressed", error: proxGate.reason },
        message: proxGate.reason || "Proximity alert suppressed (cooldown/daily limit)",
      };
    }

    // 2. Candle-bound hash tracking ledger
    const candleKey = Math.floor(Date.now() / 3_600_000);
    if (!shouldDispatchAlert(sym, candleKey, "PROXIMITY_ALERT_05_PCT", "1h")) {
      return {
        ok: true,
        suppressed: true,
        telegram: { ok: true, status: "suppressed", error: "Already dispatched for this 1H candle" },
        email: { ok: true, status: "suppressed", error: "Already dispatched for this 1H candle" },
        message: `${sym} Proximity Alert already dispatched for current 1H candle.`,
      };
    }
  }

  const shares = params.calculatedShares ?? params.shares;
  const message =
    params.message ||
    (shares && shares > 0
      ? formatExecutionReadyAlertMessage({
          ticker: params.ticker,
          status: "PROXIMITY_ALERT_05_PCT",
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss ?? params.entryPrice * 0.985,
          target1: params.target1,
          target2: params.target2,
          calculatedShares: shares,
        })
      : formatProximityEarlyWarningMessage({
          ticker: params.ticker,
          entryPrice: params.entryPrice,
        }));

  const telegramPayloadText = formatTelegramTradeDeskAlert({
    ticker: params.ticker,
    event: "PROXIMITY < 0.5%",
    regime: "Pullback Valid (4H 20-SMA)",
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss ?? params.entryPrice * 0.985,
    target1: params.target1,
    target2: params.target2,
    shares,
    status: "ACTIONABLE",
  });

  const targetEmail = params.email || process.env.USER_ALERT_EMAIL;

  let telegramRes: any = null;
  let emailRes: any = null;

  // 1. Telegram Bot API: Validates numeric ID & uses clean trade desk formatting
  telegramRes = await sendTelegramAlert(telegramPayloadText, params.chatId);

  // 2. Email Service (Resend or SendGrid via shared sendPreEntryEmail)
  if (targetEmail) {
    const emailResult = await sendPreEntryEmail({
      userEmail: targetEmail,
      ticker: params.ticker,
      entryPrice: params.entryPrice,
      price: params.entryPrice,
      stopLoss: params.stopLoss,
      target1: params.target1,
      calculatedShares: shares,
      shares,
      context: "Price within 0.5% of Target Moving Average",
      message,
    });
    emailRes = { ok: emailResult.ok, status: emailResult.status, error: emailResult.error };
  } else {
    emailRes = { ok: true, status: "stubbed", error: "Email address not configured" };
  }

  return {
    ok: true,
    telegram: telegramRes,
    email: emailRes,
    message,
  };
}
