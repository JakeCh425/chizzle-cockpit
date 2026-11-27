// ============================================================================
//  Server-Side Trade Alert Dispatcher (Telegram + Resend Email)
//  Shared by MarketEngine (automatic READY transitions) and /api/alerts/*
// ============================================================================

export interface DispatchTradeAlertInput {
  ticker: string;
  stage?: string;
  isTest?: boolean;
  entryPrice?: number;
  stopLoss?: number;
  livePrice?: number;
  shares?: number;
  allocated?: number;
  dollarRisk?: number;
  equityRiskPct?: number;
  target1_5R?: number;
  profit1_5R?: number;
  target2_0R?: number;
  profit2_0R?: number;
  confirmedTime?: string;
}

export interface DispatchTradeAlertResult {
  ok: boolean;
  skipped: boolean;
  dedupeKey?: string;
  telegramSent: boolean;
  telegramStatus: number | null;
  telegramError: string | null;
  emailSent: boolean;
  emailStatus: number | null;
  emailError: string | null;
  errors?: string[];
}

const dispatchAlertsCache = new Map<string, number>();
let lastAlertSentAt: string | null = null;
let lastError: string | null = null;

export function getAlertDiagnosticsStatus() {
  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const emailConfigured = Boolean(
    (process.env.RESEND_API_KEY || process.env.SMTP_HOST) && process.env.ALERT_EMAIL_TO
  );
  return {
    ok: true,
    telegramConfigured,
    emailConfigured,
    alertEmailTo: Boolean(process.env.ALERT_EMAIL_TO),
    lastAlertSentAt,
    lastError,
  };
}

export async function dispatchTradeAlert(
  input: DispatchTradeAlertInput
): Promise<DispatchTradeAlertResult> {
  const ticker = String(input.ticker || "SPY").trim().toUpperCase();
  const stage = String(input.stage || "READY").trim().toUpperCase();
  const isTest = Boolean(input.isTest);
  const entryPrice = Number(input.entryPrice || 100);
  const stopLoss = Number(input.stopLoss || +(entryPrice * 0.98).toFixed(2));
  const livePrice = Number(input.livePrice || entryPrice);
  const shares = Number(input.shares || 1);
  const allocated = Number(input.allocated || shares * entryPrice);
  const dollarRisk = Number(input.dollarRisk || Math.abs(entryPrice - stopLoss) * shares);
  const equityRiskPct = Number(input.equityRiskPct || 1.0);
  const riskPerShare = Math.max(0.01, Math.abs(entryPrice - stopLoss));
  const target1_5R = Number(input.target1_5R || entryPrice + riskPerShare * 1.5);
  const profit1_5R = Number(input.profit1_5R || (target1_5R - entryPrice) * shares);
  const target2_0R = Number(input.target2_0R || entryPrice + riskPerShare * 2.0);
  const profit2_0R = Number(input.profit2_0R || (target2_0R - entryPrice) * shares);
  const confirmedTime = String(
    input.confirmedTime ||
      new Date().toLocaleTimeString("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " CT"
  );

  const setupDate = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${ticker}_${setupDate}_${stage}_${entryPrice.toFixed(2)}`;
  const now = Date.now();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  if (!isTest) {
    const prevSentAt = dispatchAlertsCache.get(dedupeKey);
    if (prevSentAt && now - prevSentAt < TWELVE_HOURS_MS) {
      return {
        ok: true,
        skipped: true,
        dedupeKey,
        telegramSent: false,
        telegramStatus: null,
        telegramError: null,
        emailSent: false,
        emailStatus: null,
        emailError: null,
      };
    }
    dispatchAlertsCache.set(dedupeKey, now);
  }

  const orderType = livePrice > 0 && entryPrice > livePrice ? "BUY STOP-LIMIT" : "BUY LIMIT";
  const textBody = [
    `${isTest ? "🧪 TEST ALERT — " : ""}⚡ CHIZZLE READY TO TRADE: ${ticker}`,
    `Confirmed: ${confirmedTime} | Live: $${livePrice.toFixed(2)}`,
    `• ${orderType}: $${entryPrice.toFixed(2)} (${shares} sh • $${allocated.toFixed(2)} capital)`,
    `• Hard Stop: $${stopLoss.toFixed(2)} (-$${dollarRisk.toFixed(2)} / ${equityRiskPct.toFixed(2)}% eq)`,
    `• Target 1 (1.5R): $${target1_5R.toFixed(2)} (+$${profit1_5R.toFixed(2)})`,
    `• Target 2 (2.0R): $${target2_0R.toFixed(2)} (+$${profit2_0R.toFixed(2)})`,
    ``,
    `Fidelity OCO: ${orderType} ${shares} @ $${entryPrice.toFixed(2)} | Sell Limit $${target1_5R.toFixed(2)} / Sell Stop $${stopLoss.toFixed(2)}`,
  ].join("\n");

  let telegramSent = false;
  let telegramStatus: number | null = null;
  let telegramError: string | null = null;
  let emailSent = false;
  let emailStatus: number | null = null;
  let emailError: string | null = null;
  const errors: string[] = [];

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChatId, text: textBody }),
      });
      telegramStatus = tgRes.status;
      telegramSent = tgRes.ok;
      if (!tgRes.ok) {
        const bodyText = await tgRes.text().catch(() => "");
        telegramError = `HTTP ${tgRes.status}${bodyText ? `: ${bodyText.slice(0, 180)}` : ""}`;
        errors.push(`Telegram ${telegramError}`);
      }
    } catch (err: any) {
      telegramError = err?.message || String(err);
      errors.push(`Telegram: ${telegramError}`);
    }
  } else {
    telegramError = "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID";
  }

  const resendKey = process.env.RESEND_API_KEY;
  const emailTo = process.env.ALERT_EMAIL_TO;
  if (resendKey && emailTo) {
    try {
      const subject = `${isTest ? "[TEST] " : ""}⚡ READY TO TRADE: ${ticker} @ $${entryPrice.toFixed(2)} (${shares} sh)`;
      const emRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: process.env.ALERT_EMAIL_FROM || "Chizzle Engine <alerts@chizzle.app>",
          to: [emailTo],
          subject,
          text: textBody,
        }),
      });
      emailStatus = emRes.status;
      emailSent = emRes.ok;
      if (!emRes.ok) {
        const bodyText = await emRes.text().catch(() => "");
        emailError = `HTTP ${emRes.status}${bodyText ? `: ${bodyText.slice(0, 180)}` : ""}`;
        errors.push(`Email ${emailError}`);
      }
    } catch (err: any) {
      emailError = err?.message || String(err);
      errors.push(`Email: ${emailError}`);
    }
  } else {
    emailError = "Missing RESEND_API_KEY or ALERT_EMAIL_TO";
  }

  if (telegramSent || emailSent) {
    lastAlertSentAt = new Date().toISOString();
  }
  if (errors.length > 0) {
    lastError = errors.join(" | ");
  } else if (telegramSent || emailSent) {
    lastError = null;
  }

  return {
    ok: true,
    skipped: false,
    dedupeKey,
    telegramSent,
    telegramStatus,
    telegramError,
    emailSent,
    emailStatus,
    emailError,
    errors: errors.length > 0 ? errors : undefined,
  };
}
