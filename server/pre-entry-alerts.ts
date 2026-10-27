// ─── Off-Screen Pre-Entry Alerts (Telegram Bot API & Twilio SMS Serverless Handler) ───

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
 */
export async function sendTelegramAlert(
  message: string,
  chatId?: string,
  botToken?: string
): Promise<{ ok: boolean; error?: string; status: "sent" | "stubbed" | "failed" }> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !targetChatId) {
    return {
      ok: true,
      error: "TELEGRAM_BOT_TOKEN or chatId not configured (stubbed)",
      status: "stubbed",
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `Telegram ${res.status}: ${txt.slice(0, 200)}`, status: "failed" };
    }
    return { ok: true, status: "sent" };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), status: "failed" };
  }
}

/**
 * Lightweight Twilio SMS sender (compatible with Twilio Node.js SDK / REST API and serverless handlers).
 */
export async function sendTwilioSmsAlert(
  toPhoneNumber: string,
  message: string
): Promise<{ ok: boolean; error?: string; status: "sent" | "stubbed" | "failed" }> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from || !toPhoneNumber) {
    return {
      ok: true,
      error: "Twilio credentials or destination phone number not configured (stubbed)",
      status: "stubbed",
    };
  }

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const body = new URLSearchParams({ To: toPhoneNumber, From: from, Body: message });
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
 * for dispatching SMS & Telegram Pre-Entry Alerts.
 */
export async function serverlessPreEntryAlertHandler(req: {
  body?: {
    channel?: "sms" | "telegram" | "both";
    phoneNumber?: string;
    chatId?: string;
    message?: string;
    ticker?: string;
    entryPrice?: number;
    target1?: number;
    context?: string;
  };
  channel?: "sms" | "telegram" | "both";
  phoneNumber?: string;
  chatId?: string;
  message?: string;
  ticker?: string;
  entryPrice?: number;
  target1?: number;
  context?: string;
  smsEnabled?: boolean;
  telegramEnabled?: boolean;
}): Promise<{ ok: boolean; sms?: any; telegram?: any; message: string }> {
  const body = req?.body || req || {};
  const formattedMessage =
    body.message ||
    formatServerPreEntryAlertMessage({
      ticker: body.ticker || "NVDA",
      entryPrice: Number(body.entryPrice || 0),
      target1: Number(body.target1 || 0),
      context: body.context || "Price within 0.25% of SMA",
    });

  const channel = body.channel || "both";
  let smsResult: any = null;
  let telegramResult: any = null;

  if (channel === "sms" || channel === "both") {
    smsResult = await sendTwilioSmsAlert(body.phoneNumber || "", formattedMessage);
  }
  if (channel === "telegram" || channel === "both") {
    telegramResult = await sendTelegramAlert(formattedMessage, body.chatId);
  }

  return {
    ok: true,
    sms: smsResult,
    telegram: telegramResult,
    message: formattedMessage,
  };
}
